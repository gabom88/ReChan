#!/usr/bin/env python3
"""Build a ReChan "media pack" ZIP from your own Jackie Chan Stuntmaster disc.

    python make_rechan_pack.py "Jackie Chan Stuntmaster (USA).bin"

Requires Python 3.9+ and ffmpeg (with libx264 and aac) on PATH, or pass
--ffmpeg C:\\path\\to\\ffmpeg.exe.

What it does:
  1. Extracts the same files the web/PC version uses (same whitelist as
     tools/extract_assets/extract_psx_bin.py) and checks the disc serial.
  2. Converts the bulky media to modern formats:
       music     sound/music/*.fag    -> media/music/<name>_sNN.m4a (AAC)
       speech    sound/dialog/*.dlg   -> media/dialog/cCC_dDDD_vVV.m4a (AAC)
       movies    fe/movies/*.str      -> media/movies/<name>.mp4 (H.264 + AAC)
  3. Blanks the converted audio/video data inside the original files (size
     and headers kept, so the engine still finds them) -- zeros compress to
     almost nothing.
  4. Writes rechan-pack.zip: manifest.json, assets/..., media/...

The pack is for YOUR OWN use (e.g. load it on your phone instead of the .bin).
It contains the game's content: do not upload or share it.

Load it in ReChan Web with "Cargar paquete ZIP (experimental)".
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _find_dir(filename: str) -> Path | None:
    """Locate a helper module whether the script runs from tools/media_pack,
    was copied to the repository root, or is started from any folder inside
    the repository."""
    subdirs = ("", "media_pack", "extract_assets", "tools/media_pack", "tools/extract_assets")
    starts = [HERE, Path.cwd()]
    for start in starts:
        for base in [start, *start.parents]:
            for sub in subdirs:
                d = base / sub
                if (d / filename).is_file():
                    return d
    return None


for _mod in ("psx_audio.py", "extract_psx_bin.py"):
    _d = _find_dir(_mod)
    if _d is None:
        sys.exit(f"ERROR: no encuentro {_mod}.\n"
                 "Ejecuta el script desde el repositorio ReChan completo, p. ej.:\n"
                 '  python3 tools/media_pack/make_rechan_pack.py "juego.bin"')
    if str(_d) not in sys.path:
        sys.path.insert(0, str(_d))

import psx_audio as pa  # noqa: E402
import extract_psx_bin as xbin  # noqa: E402

PACK_FORMAT = "rechan-media-pack"
PACK_VERSION = 1
EXPECTED_SERIAL = "SLUS-00684"

MUSIC_BITRATE = "96k"
DIALOG_BITRATE = "48k"
MOVIE_AUDIO_BITRATE = "96k"
MOVIE_CRF = "23"


# ----------------------------------------------------------------- helpers

def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return str(n)


def run_ffmpeg(ffmpeg: str, args: list[str]) -> None:
    proc = subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", *args],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        lines = [l for l in proc.stderr.decode("utf-8", "replace").splitlines() if l.strip()]
        raise RuntimeError("ffmpeg: " + (lines[-1].strip() if lines else "failed"))


def check_ffmpeg(ffmpeg: str) -> None:
    try:
        enc = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
        dem = subprocess.run([ffmpeg, "-hide_banner", "-demuxers"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        sys.exit(f"Error: ffmpeg not found ({ffmpeg}). Install it or pass --ffmpeg PATH.")
    missing = [n for n, ok in (("libx264", "libx264" in enc), ("aac", " aac " in enc),
                                ("psxstr demuxer", "psxstr" in dem)) if not ok]
    if missing:
        sys.exit("Error: this ffmpeg lacks: " + ", ".join(missing))


def read_disc_serial(bin_path: Path) -> str | None:
    reader = xbin.IsoBinReader(bin_path)
    try:
        root = xbin.read_root(reader)
        for e in xbin.walk_tree(reader, root):
            if not e.is_dir and e.path_parts == ["system.cnf"]:
                text = reader.read_extent_logical(e.extent_lba, e.size).decode("latin-1", "replace")
                for line in text.splitlines():
                    if line.strip().upper().startswith("BOOT"):
                        value = line.split("=", 1)[-1].strip()
                        name = value.replace("\\", "/").split("/")[-1].split(":")[-1].split(";")[0].strip()
                        return name.replace(".", "").replace("_", "-").upper()
        return None
    finally:
        reader.close()


# ------------------------------------------------------- conversion workers
# Top-level functions so they can run in worker processes (Windows-safe).

def job_music_song(ffmpeg: str, fag_path: str, start: int, end: int, out_m4a: str) -> str:
    data = Path(fag_path).read_bytes()
    pcm = pa.decode_fag_song(data, start, end)
    if not len(pcm):
        raise RuntimeError("empty song")
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "s.wav")
        Path(wav).write_bytes(pa.wav_bytes(pcm, pa.FAG_RATE, 2))
        run_ffmpeg(ffmpeg, ["-i", wav, "-c:a", "aac", "-b:a", MUSIC_BITRATE, "-movflags", "+faststart", out_m4a])
    return out_m4a


def job_dialog_batch(ffmpeg: str, dlg_path: str, clips: list[tuple[str, int, int]], out_dir: str) -> int:
    data = Path(dlg_path).read_bytes()
    done = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, start, size in clips:
            pcm = pa.decode(data[start:start + size], stop_at_end=True)
            if not len(pcm):
                continue
            wav = os.path.join(tmp, name + ".wav")
            Path(wav).write_bytes(pa.wav_bytes(pcm, pa.DIALOG_RATE, 1))
            # 22.05 kHz output: every browser's AAC decoder handles it.
            run_ffmpeg(ffmpeg, ["-i", wav, "-ar", "22050", "-c:a", "aac", "-b:a", DIALOG_BITRATE,
                                "-movflags", "+faststart", os.path.join(out_dir, name + ".m4a")])
            done += 1
    return done


def job_movie(ffmpeg: str, str_path: str, out_mp4: str) -> str:
    data = Path(str_path).read_bytes()
    if len(data) % 2336 != 0:
        raise RuntimeError("not raw XA sectors (an .iso image cannot carry the movie audio)")
    sync = b"\x00" + b"\xff" * 10 + b"\x00"
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "movie.str")
        with open(raw, "wb") as f:
            for i in range(len(data) // 2336):
                lba = i + 150
                msf = bytes(((v // 10) << 4) | (v % 10) for v in (lba // 4500, (lba // 75) % 60, lba % 75))
                f.write(sync + msf + b"\x02" + data[i * 2336:(i + 1) * 2336])
        run_ffmpeg(ffmpeg, ["-f", "psxstr", "-i", raw, "-map", "0:v:0", "-map", "0:a:0?",
                            "-c:v", "libx264", "-preset", "slow", "-crf", MOVIE_CRF, "-pix_fmt", "yuv420p",
                            "-c:a", "aac", "-b:a", MOVIE_AUDIO_BITRATE, "-movflags", "+faststart", out_mp4])
    return out_mp4


# ------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description="Build a ReChan media pack ZIP from your own disc image.")
    ap.add_argument("bin", type=Path, help="your Jackie Chan Stuntmaster (NTSC-U) .bin image")
    ap.add_argument("-o", "--output", type=Path, default=Path("rechan-pack.zip"), help="output ZIP (default: rechan-pack.zip)")
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "ffmpeg", help="path to ffmpeg")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1), help="parallel workers")
    ap.add_argument("--no-music", action="store_true", help="keep the original music")
    ap.add_argument("--no-dialog", action="store_true", help="keep the original speech")
    ap.add_argument("--no-video", action="store_true", help="keep the original movies")
    ap.add_argument("--keep-temp", action="store_true", help="keep the working folder")
    args = ap.parse_args()

    t0 = time.time()
    bin_path = args.bin.resolve()
    if not bin_path.exists():
        sys.exit(f"Error: {bin_path} does not exist")
    check_ffmpeg(args.ffmpeg)

    print(f"Disc: {bin_path.name} ({human(bin_path.stat().st_size)})")
    serial = read_disc_serial(bin_path)
    if serial != EXPECTED_SERIAL:
        sys.exit(f"Error: wrong disc ({serial or 'unknown'}). Only the NTSC-U release {EXPECTED_SERIAL} is supported.")
    print(f"Serial {serial} OK")

    work = Path(tempfile.mkdtemp(prefix="rechan-pack-"))
    assets = work / "assets"
    media = work / "media"
    for sub in ("music", "dialog", "movies"):
        (media / sub).mkdir(parents=True, exist_ok=True)
    try:
        print("Extracting game files...")
        count = xbin.run_extraction(bin_path, assets, quiet=True)
        original_bytes = sum(p.stat().st_size for p in assets.rglob("*") if p.is_file())
        print(f"  {count} files, {human(original_bytes)}")

        summary = {"music": [], "dialog": 0, "movies": [], "failed": []}
        with cf.ProcessPoolExecutor(max_workers=args.jobs) as pool:
            futures = {}

            # Music: one AAC per song of every FAG.
            fags = sorted(assets.glob("sound/music/*.fag"))
            if not args.no_music:
                for fag in fags:
                    data = fag.read_bytes()
                    for i, r in enumerate(pa.fag_song_ranges(data)):
                        if r:
                            out = media / "music" / f"{fag.stem}_s{i:02d}.m4a"
                            futures[pool.submit(job_music_song, args.ffmpeg, str(fag), r[0], r[1], str(out))] = ("music", fag, out)

            # Speech: batches of clips per worker.
            dlg = assets / "sound" / "dialog" / "rsdialog.dlg"
            if not args.no_dialog and dlg.exists():
                clips = list(pa.dialog_clips(dlg.read_bytes()))
                step = max(1, len(clips) // (args.jobs * 4) + 1)
                for i in range(0, len(clips), step):
                    futures[pool.submit(job_dialog_batch, args.ffmpeg, str(dlg), clips[i:i + step], str(media / "dialog"))] = ("dialog", dlg, None)
                print(f"  speech clips: {len(clips)}")

            # Movies.
            movies = sorted(assets.glob("fe/movies/*.str"))
            if not args.no_video:
                for m in movies:
                    out = media / "movies" / f"{m.stem}.mp4"
                    futures[pool.submit(job_movie, args.ffmpeg, str(m), str(out))] = ("movie", m, out)

            print(f"Converting {len(futures)} job(s) with {args.jobs} worker(s)...")
            failed_music_files: set[Path] = set()
            for n, fut in enumerate(cf.as_completed(futures), 1):
                kind, src, out = futures[fut]
                try:
                    res = fut.result()
                    if kind == "music":
                        summary["music"].append(Path(res).name)
                    elif kind == "dialog":
                        summary["dialog"] += res
                    else:
                        summary["movies"].append(Path(res).name)
                except Exception as e:  # keep the original for anything that failed
                    summary["failed"].append(f"{src.name}: {e}")
                    if kind == "music":
                        failed_music_files.add(src)
                    if out and Path(out).exists():
                        Path(out).unlink()
                print(f"\r  {n}/{len(futures)}", end="", flush=True)
            print()

        # Blank what was converted (originals stay intact where conversion failed).
        if not args.no_music:
            for fag in fags:
                if fag not in failed_music_files:
                    b = bytearray(fag.read_bytes()); pa.zero_fag_audio(b); fag.write_bytes(b)
        if not args.no_dialog and dlg.exists() and summary["dialog"] > 0 and not any(f.startswith("rsdialog") for f in summary["failed"]):
            b = bytearray(dlg.read_bytes()); pa.zero_dialog_audio(b); dlg.write_bytes(b)
        converted_movies = {Path(x).stem for x in summary["movies"]}
        for m in sorted(assets.glob("fe/movies/*.str")):
            if m.stem in converted_movies:
                m.write_bytes(bytes(m.stat().st_size))

        manifest = {
            "format": PACK_FORMAT,
            "version": PACK_VERSION,
            "serial": serial,
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "media": {
                "music": sorted(summary["music"]),
                "dialogClips": summary["dialog"],
                "movies": sorted(summary["movies"]),
            },
            "notes": "Personal media pack generated from the owner's disc. Do not distribute.",
        }

        print("Writing ZIP...")
        out_zip = args.output.resolve()
        with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
            for p in sorted(assets.rglob("*")):
                if p.is_file():
                    z.write(p, "assets/" + p.relative_to(assets).as_posix())
            for p in sorted(media.rglob("*")):
                if p.is_file():  # already compressed: store as-is
                    z.write(p, "media/" + p.relative_to(media).as_posix(), compress_type=zipfile.ZIP_STORED)

        zip_bytes = out_zip.stat().st_size
        print()
        print(f"Done in {time.time() - t0:.0f}s: {out_zip}")
        print(f"  music tracks:  {len(summary['music'])}")
        print(f"  speech clips:  {summary['dialog']}")
        print(f"  movies:        {len(summary['movies'])}")
        print(f"  game files {human(original_bytes)} -> pack {human(zip_bytes)}")
        if summary["failed"]:
            print("  kept original (could not convert):")
            for f in summary["failed"]:
                print("   -", f)
        print()
        print("This pack contains the game's content: keep it for yourself, do not share it.")
        return 0
    finally:
        if args.keep_temp:
            print(f"Working folder kept: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
