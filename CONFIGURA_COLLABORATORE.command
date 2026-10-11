#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
node scripts/configure-admin.mjs --staff
