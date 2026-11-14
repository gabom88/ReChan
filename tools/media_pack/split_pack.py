#!/usr/bin/env python3
"""Split a ReChan ZIP pack into parts small enough for GitHub (web upload
limit: 25 MB per file), for ReChan Web's "Download the game" option.

    python3 tools/media_pack/split_pack.py rechan-pack-small.zip

Writes, next to the ZIP, a folder "data" with:
    pack.json                   list of parts + SHA-256 of each part and of the whole pack
    rechan-pack.part001 ...     parts of 19 MB (the last one smaller)

Upload the *contents* of that folder to web/shell/data/ in the repository
(replacing any previous parts). The web build publishes them on GitHub Pages
and the page downloads, verifies and joins them in the browser.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import zipfile
from pathlib import Path

PART_SIZE = 19 * 1024 * 1024          # < 20 MB, comfortably under GitHub's 25 MB upload limit
FORMAT = "rechan-pack-parts"


def main() -> int:
    ap = argparse.ArgumentParser(description="Split a ReChan ZIP pack into parts for GitHub Pages.")
    ap.add_argument("zip", type=Path, help="pack created by make_rechan_pack.py")
    ap.add_argument("-o", "--out", type=Path, help="output folder (default: 'data' next to the ZIP)")
    ap.add_argument("--part-mb", type=int, default=19, help="part size in MB (default 19)")
    args = ap.parse_args()

    src = args.zip.expanduser().resolve()
    if not src.is_file():
        sys.exit(f"Error: no existe {src}")
    try:
        with zipfile.ZipFile(src) as z:
            manifest = json.loads(z.read("manifest.json"))
    except (zipfile.BadZipFile, KeyError, ValueError):
        sys.exit("Error: el archivo no es un paquete de ReChan (falta manifest.json).")
    if manifest.get("format") != "rechan-media-pack":
        sys.exit("Error: el archivo no es un paquete de ReChan.")

    part_size = max(1, args.part_mb) * 1024 * 1024
    out = (args.out or src.parent / "data").expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("rechan-pack.part*"):
        old.unlink()

    total = hashlib.sha256()
    parts = []
    with open(src, "rb") as f:
        index = 1
        while True:
            chunk = f.read(part_size)
            if not chunk:
                break
            total.update(chunk)
            name = f"rechan-pack.part{index:03d}"
            (out / name).write_bytes(chunk)
            parts.append({"name": name, "size": len(chunk), "sha256": hashlib.sha256(chunk).hexdigest()})
            print(f"  {name}  {len(chunk) / 1048576:5.1f} MB")
            index += 1

    info = {
        "format": FORMAT,
        "version": 1,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "file": src.name,
        "size": src.stat().st_size,
        "sha256": total.hexdigest(),
        "serial": manifest.get("serial"),
        "packVersion": manifest.get("version"),
        "parts": parts,
    }
    (out / "pack.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    print()
    print(f"Listo: {len(parts)} partes en {out}")
    print("Sube el CONTENIDO de esa carpeta (pack.json y todas las partes) a web/shell/data/ del repositorio.")
    print("Si había partes de una versión anterior, bórralas primero.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
