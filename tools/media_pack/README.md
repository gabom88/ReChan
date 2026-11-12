# Paquete ZIP de ReChan (modo experimental)

> ¿Solo quieres crear tu paquete? Sigue la **[guía sencilla](../../GUIA-PAQUETE-ZIP.md)**. Esta página es la referencia técnica.

`make_rechan_pack.py` convierte **tu propia** imagen del disco de *Jackie Chan Stuntmaster* (NTSC-U, SLUS-00684) en un ZIP listo para ReChan Web. El ZIP trae los mismos assets que se extraen del BIN, pero con el audio y el vídeo en formatos modernos:

| Contenido | Original (PSX) | En el ZIP |
|---|---|---|
| Música `sound/music/*.fag` | ADPCM de SPU, 22 050 Hz | `media/music/<pista>_sNN.m4a` (AAC 96 kbps) |
| Voces `sound/dialog/*.dlg` | ADPCM de SPU, 11 025 Hz | `media/dialog/cCC_dDDD_vVV.m4a` (AAC 32 kbps) |
| Vídeos `fe/movies/*.str` | MDEC (STR) | `media/movies/<nombre>.mp4` (H.264 + AAC) |

En los archivos originales se ponen a cero los datos que ya se convirtieron. Se mantienen el tamaño y las cabeceras, así que el motor los sigue encontrando, y los ceros apenas ocupan en el ZIP. Lo que no se pueda convertir se queda tal cual.

> ⚠️ **Solo para uso personal.** El ZIP contiene el juego. No lo subas a ningún sitio ni lo compartas.

## Requisitos

- **Python 3.9 o superior** ([python.org](https://www.python.org/downloads/); en Windows, marca *Add Python to PATH*).
- **ffmpeg** con `libx264` y `aac`, en el PATH o indicado con `--ffmpeg`. Los builds de [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) y [BtbN](https://github.com/BtbN/FFmpeg-Builds/releases) para Windows ya los incluyen. En Linux: `sudo apt install ffmpeg`. En macOS: `brew install ffmpeg`.
- Este repositorio completo: el script usa `tools/extract_assets/extract_psx_bin.py`.

## Uso

**Doble clic:** `make_rechan_pack.command` en Mac o `make_rechan_pack.bat` en Windows. Busca el `.bin` en la carpeta del conversor, en Descargas, en el Escritorio y en Documentos, encuentra ffmpeg (también un `ffmpeg.exe` copiado en la carpeta) y guarda el ZIP junto al `.bin`. `web/Makefile` publica todo esto como `rechan-conversor.zip` (lo genera `build_tool_zip.py`).

**Windows:** también puedes arrastrar el `.bin` sobre `make_rechan_pack.bat`, o ejecutar:

```bat
make_rechan_pack.bat "D:\Juegos\Jackie Chan Stuntmaster (USA).bin"
```

**Cualquier sistema:**

```bash
python3 tools/media_pack/make_rechan_pack.py "Jackie Chan Stuntmaster (USA).bin" -o rechan-pack.zip
```

Si no indicas `--quality`, el script muestra un **selector de calidad** en la terminal (tamaños aproximados para el disco completo):

```text
=== Calidad del paquete ===
  1) Alta      - la mejor calidad: música 128k, voces 48k, vídeo CRF 21 + audio 128k  (≈ 184 MB)
  2) Normal    - equilibrio calidad/tamaño: música 96k, voces 32k, vídeo CRF 24 + audio 96k  (≈ 137 MB)
  3) Pequeña   - la más ligera (menos de 100 MB): música 64k, voces 24k, vídeo CRF 28 + audio 64k  (≈ 98 MB)
  4) Personalizada - elegir cada parte
```

Con **Personalizada** eliges por separado la calidad de la música, las voces, el vídeo y el audio de los vídeos, y el script te muestra el tamaño estimado. Si lo ejecutas sin el `.bin`, te lo pide: arrastra el archivo a la terminal y pulsa Enter. El ZIP se llama `rechan-pack-<calidad>.zip` salvo que uses `-o`.

Después abre ReChan Web y pulsa **Cargar paquete ZIP (experimental)**.

### Opciones

| Opción | Qué hace |
|---|---|
| `-o archivo.zip` | Nombre del ZIP (por defecto `rechan-pack.zip`) |
| `--ffmpeg RUTA` | Ruta a `ffmpeg` si no está en el PATH |
| `--jobs N` | Conversiones en paralelo (por defecto, núcleos − 1) |
| `--no-music` / `--no-dialog` / `--no-video` | Deja esa parte en su formato original |
| `--keep-temp` | Conserva la carpeta de trabajo (para depurar) |
| `--quality high/normal/small` | Calidad general. `normal` (por defecto): música 96k, voces 32k, vídeo CRF 24. `small`: 64k / 24k / CRF 28, el más ligero. `high`: 128k / 48k / CRF 21 |
| `--music-bitrate 80k`, `--dialog-bitrate 32k`, `--movie-crf 26`, `--movie-audio-bitrate 96k` | Ajustan cada valor por separado (en el CRF, más alto = archivo más pequeño) |

Al terminar, el script muestra cuánto ocupa cada carpeta del ZIP y cuáles son los archivos más grandes.

## Notas

- El decodificador ADPCM de `psx_audio.py` es una traducción exacta del que usa el motor (`src/snd`), así que el audio de partida es el mismo que oirías en modo BIN, solo que comprimido en AAC.
- Las voces se suben a 22 050 Hz antes de codificarlas porque AAC no admite 11 025 Hz con buena calidad.
- El modo ZIP es **experimental**. Si algo falla, pulsa **Borrar assets extraídos** (las partidas se conservan) y vuelve a cargar el `.bin` (modo estable).
- **No se ha probado todavía con el disco real.** La conversión de vídeo depende del demuxer `psxstr` de ffmpeg. Si algún vídeo falla, el script lo avisa y deja el `.str` original, que el juego reproduce con su reproductor de siempre.
