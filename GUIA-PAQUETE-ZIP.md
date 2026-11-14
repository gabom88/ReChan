# Guía: crea tu paquete ZIP para ReChan Web

El **modo experimental** de ReChan Web usa un paquete ZIP en lugar del `.bin`. La música, las voces y los vídeos van en formatos que el navegador reproduce de forma nativa (AAC y H.264). Así:

- el audio no se entrecorta y los vídeos se ven mejor;
- el paquete ocupa **menos de 100 MB**, frente a los ~600 MB del `.bin`;
- carga más rápido en el móvil.

El paquete se crea **una vez en tu ordenador** a partir de tu propia copia del juego. Después lo puedes pasar al móvil o a la tablet.

> ⚠️ El ZIP contiene el juego. Es **solo para tu uso personal**: no lo subas a internet ni lo compartas.

---

## Qué necesitas

| | |
|---|---|
| 🎮 Tu imagen del juego | *Jackie Chan Stuntmaster* **NTSC-U (SLUS-00684)**, en formato `.bin` |
| 🐍 Python 3 | Gratis, en [python.org](https://www.python.org/downloads/) |
| 🎞️ ffmpeg | Gratis; abajo se explica cómo instalarlo |
| 📦 El conversor | [**Descargar rechan-conversor.zip**](https://gabom88.github.io/ReChan/rechan-conversor.zip) |

> **¿Dónde está `rechan-conversor.zip`?** No está entre los archivos del repositorio: se genera automáticamente con cada versión y se descarga del enlace de arriba. También está en la pantalla de inicio de ReChan Web, dentro del recuadro **Experimental**.
>
> **Alternativa:** en la página del repositorio pulsa **Code → Download ZIP**, descomprímelo y abre la carpeta `tools/media_pack`. Ahí están los mismos lanzadores: `make_rechan_pack.command` en Mac y `make_rechan_pack.bat` en Windows. Funcionan igual.

---

## En Mac

**1. Instala Python y ffmpeg (solo la primera vez)**

1. Instala Python 3 desde [python.org](https://www.python.org/downloads/).
2. Abre la app **Terminal**, pega esto y pulsa Enter. Instala [Homebrew](https://brew.sh), el instalador de programas:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
3. Instala ffmpeg:
   ```bash
   brew install ffmpeg
   ```

**2. Convierte el juego**

1. Descarga y descomprime [rechan-conversor.zip](https://gabom88.github.io/ReChan/rechan-conversor.zip). Se crea la carpeta **ReChan-Conversor**.
2. Deja tu `.bin` en esa carpeta, en **Descargas**, en el **Escritorio** o en **Documentos**.
3. Haz doble clic en **`Convertir (Mac).command`**.
   - Si macOS dice que no puede abrirlo porque es de un desarrollador no identificado, haz **clic derecho → Abrir → Abrir**. Solo hace falta la primera vez.
4. Sigue los pasos en la ventana (ver [Qué te pregunta el conversor](#qué-te-pregunta-el-conversor)).

## En Windows

**1. Instala Python y ffmpeg (solo la primera vez)**

1. Instala Python 3 desde [python.org](https://www.python.org/downloads/). **Marca la casilla «Add Python to PATH»** en la primera pantalla del instalador.
2. Abre **PowerShell** (búscalo en el menú Inicio), pega esto y pulsa Enter:
   ```powershell
   winget install Gyan.FFmpeg
   ```
   Si no tienes `winget`, descarga `ffmpeg-release-essentials.zip` de [gyan.dev](https://www.gyan.dev/ffmpeg/builds/). Copia `bin\ffmpeg.exe` dentro de la carpeta **ReChan-Conversor**.

**2. Convierte el juego**

1. Descarga y descomprime [rechan-conversor.zip](https://gabom88.github.io/ReChan/rechan-conversor.zip): clic derecho → **Extraer todo**.
2. Deja tu `.bin` en la carpeta **ReChan-Conversor**, en **Descargas**, en el **Escritorio** o en **Documentos**. También puedes arrastrarlo sobre el archivo del paso 3.
3. Haz doble clic en **`Convertir (Windows).bat`**.
   - Si aparece «Windows protegió su PC», pulsa **Más información → Ejecutar de todas formas**.
4. Sigue los pasos en la ventana.

---

## Qué te pregunta el conversor

**1. Tu disco.** Si encuentra el `.bin`, te lo propone; pulsa **Enter** para aceptarlo. Si no lo encuentra, arrastra el `.bin` a la ventana y pulsa Enter.

```text
Encontré tu disco de Jackie Chan Stuntmaster:
  1) /Users/tu/Descargas/Jackie Chan Stuntmaster (USA).bin  <- por defecto
  2) Otro archivo (arrastrarlo a esta ventana)
Elige [1-2, Enter = 1]:
```

**2. La calidad.** Escribe el número y pulsa Enter.

```text
=== Calidad del paquete ===
  1) Alta      - la mejor calidad ...   (≈ 184 MB)
  2) Normal    - equilibrio ...         (≈ 137 MB)  <- por defecto
  3) Pequeña   - la más ligera ...      (≈ 98 MB)
  4) Personalizada - elegir cada parte
```

| Opción | Recomendada para |
|---|---|
| **Pequeña** | iPhone y móviles. Se ve y se oye bien, y ocupa lo mínimo. |
| **Normal** | Tablets y ordenadores. |
| **Alta** | Ordenador con pantalla grande. |

Tarda unos **2 minutos**. Al terminar se abre la carpeta con tu paquete, que se crea junto al `.bin` con el nombre `rechan-pack-small.zip`, `rechan-pack-normal.zip` o similar.

## Cargar el paquete en ReChan Web

1. Si vas a jugar en el móvil, pasa el ZIP con AirDrop, iCloud Drive, Google Drive, un cable…
2. Abre [ReChan Web](https://gabom88.github.io/ReChan/) y pulsa **Cargar paquete ZIP** en el recuadro **Modo experimental**.
3. Elige el archivo. Cuando termine de importarlo, pulsa **Jugar**. La pantalla de inicio mostrará **Modo ZIP · experimental**.

Después ya no necesitas el ZIP en el dispositivo: el juego queda guardado en el navegador. Para volver al modo estable, ve a **Opciones → Borrar assets extraídos** y carga el `.bin`. Tus partidas guardadas se conservan.

---

## Problemas frecuentes

| Problema | Solución |
|---|---|
| «No encuentro ffmpeg» | Instálalo como se explica arriba y vuelve a abrir el conversor. En Windows, cierra y abre la ventana después de instalarlo. |
| «No encuentro Python» | Instálalo desde [python.org](https://www.python.org/downloads/). En Windows, marca **Add Python to PATH**. |
| «wrong disc» | El conversor solo admite la versión **NTSC-U (SLUS-00684)**, la americana. |
| No encuentra el `.bin` | Arrástralo a la ventana del conversor y pulsa Enter. |
| Al pulsar Enter sale `^M` (Mac) | Escribe `stty sane`, pulsa Enter y vuelve a abrir el conversor. |
| Algún vídeo «could not convert» | No pasa nada: ese vídeo se queda en el formato original y el juego lo reproduce igual. Si te pasa, avísanos con el mensaje. |

## Publicarlo para la opción «Descargar el juego»

Solo para quien mantiene el sitio. Las condiciones de distribución están en [LICENSE-GAME-DATA.md](LICENSE-GAME-DATA.md).

1. Parte el paquete en trozos de 19 MB:
   ```bash
   python3 tools/media_pack/split_pack.py rechan-pack-small.zip
   ```
2. Sube el **contenido** de la carpeta `data` que se crea junto al ZIP (`pack.json` y `rechan-pack.part001`…) a [`web/shell/data/`](web/shell/data/) del repositorio. En GitHub: entra en esa carpeta → **Add file → Upload files**.
3. Al hacer *commit* en `main`, el sitio se vuelve a publicar solo y la pantalla de inicio muestra la opción **Descargar el juego**.

¿Usas la línea de comandos? Las opciones avanzadas (`--quality`, `--movie-crf`…) están en [tools/media_pack/README.md](tools/media_pack/README.md).
