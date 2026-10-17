#!/bin/sh
# Real-browser checks that need the running app: every interactive page reached through a boosted
# link or form, the way people reach it (tools/screenshots/e2e-boosted.mjs). CI runs it.
#
#   tools/e2e.sh                 uses the demo started here if it runs, else builds and starts one
#                                with every sample (port $PORT, default 4000) and stops it after
#   HEADED=1 tools/e2e.sh        watch it in a visible Chrome
#
# Needs Node >= 22.12, pnpm and Google Chrome (Playwright's `chrome` channel).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
started=0
if ! tools/demo.sh status | grep -q running; then
  tools/demo.sh all --port "${PORT:-4000}"
  started=1
fi
stop() { if [ "$started" = 1 ]; then tools/demo.sh stop; fi; }
trap stop EXIT
base=$(cat demo/demo.url)
(cd tools/screenshots && pnpm install --frozen-lockfile --silent)
BASE="$base" node tools/screenshots/e2e-boosted.mjs
