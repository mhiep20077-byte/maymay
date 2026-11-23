#!/usr/bin/env bash
# Chạy toàn bộ test offline. Không cần mạng, không cần Spotify.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Cần Node.js (>=16) để chạy test. Cài: https://nodejs.org" >&2
  exit 1
fi

node "$ROOT/tests/test-patch.js"
