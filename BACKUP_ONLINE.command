#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
node scripts/backup-online.mjs "$@"
