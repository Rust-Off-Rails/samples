#!/bin/sh
# A running demo: host/ plus samples, with seed data, served in development mode.
#
#   tools/demo.sh [sample… | all] [--port N]   build demo/app, seed it, serve it (default: all, 3900)
#   tools/demo.sh stop                          stop the demo started here (by its PID file)
#   tools/demo.sh status                        is it running, and where
#
# demo/ is git-ignored. The server's PID is in demo/demo.pid; it is stopped by that PID only.
# Every detail it shows is synthetic: example.com addresses, a localhost URL.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
demo="$root/demo"
pidfile="$demo/demo.pid"
port=3900
samples=""

running() { [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }

case "${1:-}" in
  stop)
    if running; then
      kill "$(cat "$pidfile")"
      echo "stopped demo (PID $(cat "$pidfile"))"
    else
      echo "no demo running"
    fi
    rm -f "$pidfile"
    exit 0
    ;;
  status)
    if running; then echo "running: PID $(cat "$pidfile"), $(cat "$demo/demo.url" 2>/dev/null)"; else echo "not running"; fi
    exit 0
    ;;
  -h | --help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --port) port=$2; shift ;;
    all) samples="" ;;
    -*) echo "demo: unknown option $1" >&2; exit 2 ;;
    *) samples="$samples $1" ;;
  esac
  shift
done
if [ -z "$samples" ]; then
  samples=$(cd "$root/samples" && for d in */; do [ -f "$d/sample.toml" ] && printf '%s ' "${d%/}"; done)
fi

if running; then
  echo "demo: already running (PID $(cat "$pidfile")); tools/demo.sh stop first" >&2
  exit 1
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "demo: port $port is taken; pick another with --port" >&2
  exit 1
fi

[ -f "$root/host/.offrails/VERSION" ] || "$root/tools/vendor-framework.sh" "$root/host"
app="$demo/app"
rm -rf "$app"
mkdir -p "$app"
tar -C "$root/host" --exclude ./target --exclude './storage/*' --exclude ./.env -cf - . | tar -C "$app" -xf -
for s in $samples; do
  grep -q "installed sample $s " "$app/docs/decisions.md" && continue
  "$root/tools/install.sh" "$s" "$app" > "$demo/install-$s.log"
done

export CARGO_TARGET_DIR="$root/.cache/target"
cd "$app"
cargo fmt --all
bin/setup-tailwind >/dev/null
bin/tailwindcss -i assets/app.css -o static/app.css --minify 2>/dev/null
echo "building the demo app (samples:$samples)…"
cargo build -q
# WHY: a copy, so a later build in the shared target dir never swaps the binary under the demo.
cp "$CARGO_TARGET_DIR/debug/offrails_host" "$demo/app-bin"

url="http://localhost:$port"
cat > .env <<EOF
APP_ENV=development
PORT=$port
DATABASE_URL=sqlite://storage/demo.sqlite3?mode=rwc
MAIL_FROM="Acme <hello@example.com>"
RUST_LOG=info
EOF
"$demo/app-bin" db migrate >/dev/null
if grep -q "installed sample dev-mailbox " docs/decisions.md; then
  "$demo/app-bin" mailbox seed --app-url "$url" >/dev/null
fi
if grep -q "installed sample jobs-dashboard " docs/decisions.md; then
  "$demo/app-bin" task jobs_demo >/dev/null
fi

nohup "$demo/app-bin" serve > "$demo/demo.log" 2>&1 &
echo $! > "$pidfile"
echo "$url" > "$demo/demo.url"
i=0
until curl -fsS "$url/up" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ] || ! running; then
    echo "demo: the server didn't come up; see $demo/demo.log" >&2
    tail -20 "$demo/demo.log" >&2
    exit 1
  fi
  sleep 1
done
echo "demo running: $url (PID $(cat "$pidfile")); stop with tools/demo.sh stop"
