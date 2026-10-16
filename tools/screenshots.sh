#!/bin/sh
# Regenerates docs/screenshots/ from the demo (tools/demo.sh), with Playwright and the installed
# Chrome: every screen, light and dark, desktop (1440x900) and mobile (390x844).
#
#   tools/screenshots.sh [sample…]     every sample installed in the demo, or just these
#                                      (needs Node >= 22.12 and pnpm; starts the demo with every
#                                      sample if it isn't running)
#   AXE=1 tools/screenshots.sh          also runs axe-core (WCAG 2.2 AA) on every shot
#
# Screens: tools/screenshots/shoot.mjs (host, mailer, dev-mailbox, the auth samples from
# samples/auth-core/screenshots.mjs, realtime from tools/screenshots/realtime.mjs) and
# tools/screenshots/shoot-jobs-dashboard.mjs.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if ! tools/demo.sh status | grep -q running; then
  tools/demo.sh all --port "${PORT:-3900}"
fi
base=$(cat demo/demo.url)
installed=$(sed -n 's/^.*: installed sample \([^ ]*\) .*$/\1/p' demo/app/docs/decisions.md | sort -u | tr '\n' ' ')
echo "demo: $base; installed: $installed"
(cd tools/screenshots && pnpm install --frozen-lockfile --silent)
BASE="$base" OUT="$root/docs/screenshots" INSTALLED="$installed" node tools/screenshots/shoot.mjs "$@"
if [ $# -eq 0 ] || printf '%s\n' "$@" | grep -qx jobs-dashboard; then
  case " $installed " in
    *" jobs-dashboard "*)
      BASE="$base" OUT="$root/docs/screenshots/jobs-dashboard" node tools/screenshots/shoot-jobs-dashboard.mjs
      ;;
  esac
fi
