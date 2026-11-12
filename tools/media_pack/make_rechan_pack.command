#!/bin/bash
# Conversor ReChan (macOS): doble clic para crear el paquete ZIP a partir de tu .bin.
# La primera vez macOS puede bloquearlo: clic derecho -> Abrir -> Abrir.
# Uso personal: no compartas el ZIP.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v python3 >/dev/null 2>&1; then
  echo "No encuentro Python 3. Instálalo desde https://www.python.org/downloads/ y vuelve a abrir este archivo."
  read -r -p "Pulsa Enter para cerrar..."
  exit 1
fi
python3 make_rechan_pack.py "$@"
echo
read -r -p "Pulsa Enter para cerrar..."
