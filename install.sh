#!/bin/sh
set -eu

if [ "${1:-}" = '--pause' ] && [ -t 0 ]; then
  trap 'printf "\nPress Return to close. "; read -r answer' EXIT
fi
if [ "${1:-}" = '--pause' ]; then shift; fi
install_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$install_root"

# Finder starts Terminal with a smaller PATH than an interactive shell.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
export PATH
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node; do
    if [ -x "$candidate" ]; then PATH="$(dirname "$candidate"):$PATH"; export PATH; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  printf '\nInstall Node.js 22.13 or newer from https://nodejs.org, then run this installer again.\n' >&2
  exit 1
fi
node --input-type=module -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error("Install Node.js 22.13 or newer from https://nodejs.org, then run this installer again.");
  process.exit(1);
}
await import("node:sqlite");
'

# Source checkouts build here. Release downloads are already built.
if [ -f package-lock.json ] && [ -d src ]; then
  npm ci --include=dev --no-audit --no-fund
  npm run build
fi
node scripts/install.mjs "$@"
