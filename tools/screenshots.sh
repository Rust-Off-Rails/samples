#!/bin/sh
# Regenerates docs/screenshots/ from the demo (tools/demo.sh), with Playwright and the installed
# Chrome: every screen, light and dark, desktop (1440x900) and mobile (390x844).
#
#   tools/screenshots.sh [sample…]     (needs Node >= 22.12 and pnpm; starts the demo if it isn't running)
#   AXE=1 tools/screenshots.sh          also runs axe-core (WCAG 2.2 AA) on every shot
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if ! tools/demo.sh status | grep -q running; then
  tools/demo.sh all --port "${PORT:-3900}"
fi
base=$(cat demo/demo.url)
(cd tools/screenshots && pnpm install --frozen-lockfile --silent)
BASE="$base" OUT="$root/docs/screenshots" node tools/screenshots/shoot.mjs "$@"
if [ $# -eq 0 ] || printf '%s\n' "$@" | grep -qx jobs-dashboard; then
  if grep -q "installed sample jobs-dashboard " demo/app/docs/decisions.md 2>/dev/null; then
    BASE="$base" OUT="$root/docs/screenshots/jobs-dashboard" node tools/screenshots/shoot-jobs-dashboard.mjs
  fi
fi
if [ $# -eq 0 ] || printf '%s\n' "$@" | grep -qx dev-dashboard; then
  if grep -q "installed sample dev-dashboard " demo/app/docs/decisions.md 2>/dev/null; then
    BASE="$base" OUT="$root/docs/screenshots/dev-dashboard" node tools/screenshots/shoot-dev-dashboard.mjs
  fi
fi
