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
if ! tools/demo.sh status | grep -q '^running'; then
  tools/demo.sh all --port "${PORT:-3900}"
fi
base=$(cat demo/demo.url)
installed=$(sed -n 's/^.*: installed sample \([^ ]*\) .*$/\1/p' demo/app/docs/decisions.md | sort -u | tr '\n' ' ')
echo "demo: $base; installed: $installed"
(cd tools/screenshots && pnpm install --frozen-lockfile --silent)
# The jobs dashboard first: its running and retrying examples are seeded (app task jobs_demo) and
# the demo's workers finish them within minutes. A demo running for a while: restart it first.
if [ $# -eq 0 ] || printf '%s\n' "$@" | grep -qx jobs-dashboard; then
  case " $installed " in
    *" jobs-dashboard "*)
      BASE="$base" OUT="$root/docs/screenshots/jobs-dashboard" node tools/screenshots/shoot-jobs-dashboard.mjs
      ;;
  esac
fi
BASE="$base" OUT="$root/docs/screenshots" INSTALLED="$installed" node tools/screenshots/shoot.mjs "$@"
if [ $# -eq 0 ] || printf '%s\n' "$@" | grep -qx dev-dashboard; then
  case " $installed " in
    *" dev-dashboard "*)
      # "Ask AI" as an agent: a loopback mock provider (tools/screenshots/ai-mock.mjs: a scripted,
      # clearly fake tool-calling investigation, no real API) and a second demo server pointed at
      # it, with the watcher on (incident cards); both stopped by PID after.
      port=${base##*:}
      mock_port=$((port + 9))
      ai_port=$((port + 1))
      ai_base=""
      if ! lsof -nP -iTCP:"$ai_port" -sTCP:LISTEN >/dev/null 2>&1 && ! lsof -nP -iTCP:"$mock_port" -sTCP:LISTEN >/dev/null 2>&1; then
        node tools/screenshots/ai-mock.mjs "$mock_port" > demo/ai-mock.log 2>&1 &
        mock_pid=$!
        (cd demo/app && PORT=$ai_port DASHBOARD_AI_PROVIDER=openai-compatible \
          DASHBOARD_AI_BASE_URL="http://127.0.0.1:$mock_port/v1" DASHBOARD_AI_MODEL=demo-model \
          DASHBOARD_AI_PROACTIVE=true \
          exec ../app-bin serve) > demo/ai-server.log 2>&1 &
        ai_pid=$!
        trap 'kill "$ai_pid" "$mock_pid" 2>/dev/null || true' EXIT
        i=0
        until curl -fsS "http://localhost:$ai_port/up" >/dev/null 2>&1 || [ "$i" -gt 30 ]; do sleep 1; i=$((i + 1)); done
        ai_base="http://localhost:$ai_port"
      else
        echo "screenshots: port $ai_port or $mock_port is taken; skipping the Ask AI answer screens"
      fi
      BASE="$base" AI_BASE="$ai_base" OUT="$root/docs/screenshots/dev-dashboard" node tools/screenshots/shoot-dev-dashboard.mjs
      ;;
  esac
fi
