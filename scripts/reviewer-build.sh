#!/bin/sh
set -eu
review_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$review_root"
if [ "$(node --version)" != 'v26.2.0' ] || [ "$(npm --version)" != '12.2.2' ]; then
  printf '%s\n' 'Use Node.js 26.2.0 and npm 12.2.2. Installation steps: docs/reviewer/README.md' >&2
  exit 1
fi
npm ci --include=dev --no-audit --no-fund
npm run package
