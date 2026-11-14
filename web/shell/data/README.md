# Datos del juego (opción «Descargar el juego»)

Sube aquí el **contenido** de la carpeta `data` que genera:

```bash
python3 tools/media_pack/split_pack.py rechan-pack-small.zip
```

- `pack.json`: lista de partes con su huella SHA-256.
- `rechan-pack.part001`, `part002`…: partes de 19 MB.

Al publicar una versión nueva, borra antes las partes anteriores. Sin `pack.json`, la pantalla de inicio no muestra la opción.

Estos archivos contienen el juego *Jackie Chan Stuntmaster* © Radical Entertainment / Midway Games y se distribuyen bajo las condiciones de [LICENSE-GAME-DATA.md](../../../LICENSE-GAME-DATA.md).
