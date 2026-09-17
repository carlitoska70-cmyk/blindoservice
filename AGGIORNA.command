#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Installa Node.js e riapri Terminale."
  exit 1
fi
echo "Ferma Presidio prima di aggiornare."
echo "Incolla il percorso della nuova cartella blindoservice, senza virgolette:"
IFS= read -r presidio_update_dir
node scripts/pc.mjs update "$presidio_update_dir"
