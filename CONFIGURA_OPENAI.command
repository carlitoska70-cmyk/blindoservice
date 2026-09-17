#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Installa Node.js 22 o 24 da https://nodejs.org, poi riapri Terminale."
  exit 1
fi
echo "Incolla la chiave OpenAI. Non apparirà sullo schermo."
IFS= read -r -s presidio_api_key
printf '\n'
printf '%s' "$presidio_api_key" | node scripts/pc.mjs key
unset presidio_api_key
