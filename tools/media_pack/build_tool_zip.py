#!/usr/bin/env python3
"""Bundle the media-pack converter into one downloadable ZIP (published with
the web build as rechan-conversor.zip), so users don't need the repository:

    ReChan-Conversor/
        Convertir (Mac).command      double-click on macOS
        Convertir (Windows).bat      double-click on Windows
        LEEME.txt
        make_rechan_pack.py, psx_audio.py, extract_psx_bin.py
"""
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
GUIDE_URL = "https://github.com/gabom88/ReChan/blob/main/GUIA-PAQUETE-ZIP.md"

README = f"""CONVERSOR DE RECHAN - de tu .bin a un paquete ZIP con audio y video modernos
================================================================================

1. Instala lo necesario (solo la primera vez):
   - Python 3:  https://www.python.org/downloads/
                (en Windows marca "Add Python to PATH" al instalar)
   - ffmpeg:    Mac:     brew install ffmpeg      (Homebrew: https://brew.sh)
                Windows: winget install Gyan.FFmpeg
                         o copia ffmpeg.exe dentro de esta carpeta

2. Pon tu imagen del juego (.bin, Jackie Chan Stuntmaster NTSC-U) en esta
   carpeta, en Descargas, en el Escritorio o en Documentos.

3. Doble clic en:
   - Mac:     "Convertir (Mac).command"
              (si macOS lo bloquea: clic derecho -> Abrir -> Abrir)
   - Windows: "Convertir (Windows).bat"
   El conversor encuentra tu .bin, te deja elegir la calidad y crea
   rechan-pack-<calidad>.zip junto al .bin. "Pequeña" ocupa menos de 100 MB.

4. Abre ReChan Web y pulsa "Cargar paquete ZIP".

Guía completa con capturas y solución de problemas:
{GUIDE_URL}

El ZIP contiene el juego: es solo para tu uso personal, no lo compartas.
"""


def add(z: zipfile.ZipFile, name: str, data: bytes, mode: int = 0o644) -> None:
    info = zipfile.ZipInfo("ReChan-Conversor/" + name, time.localtime()[:6])
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3  # Unix, so the permission bits below are honoured
    info.external_attr = (0o100000 | mode) << 16
    z.writestr(info, data)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "rechan-conversor.zip")
    crlf = lambda b: b.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    lf = lambda b: b.replace(b"\r\n", b"\n")
    with zipfile.ZipFile(out, "w") as z:
        add(z, "Convertir (Mac).command", lf((HERE / "make_rechan_pack.command").read_bytes()), 0o755)
        add(z, "Convertir (Windows).bat", crlf((HERE / "make_rechan_pack.bat").read_bytes()))
        add(z, "LEEME.txt", crlf(README.encode("utf-8")))
        add(z, "make_rechan_pack.py", lf((HERE / "make_rechan_pack.py").read_bytes()), 0o755)
        add(z, "psx_audio.py", lf((HERE / "psx_audio.py").read_bytes()))
        add(z, "extract_psx_bin.py", lf((TOOLS / "extract_assets" / "extract_psx_bin.py").read_bytes()))
    print(f"{out}: {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
