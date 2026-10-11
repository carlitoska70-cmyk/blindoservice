#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
node scripts/pc.mjs db
node scripts/pc.mjs admin "${1:-}"
