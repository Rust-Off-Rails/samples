#!/bin/sh
# Regression checks for tools/install.sh's dependency resolution and optional wiring, on fixture
# samples in a temporary copy of the repo layout (no cargo, no real samples):
#   - a diamond (top -> base, top -> mid -> base) installs base once, before mid, before top;
#   - the same diamond with base already installed is not a cycle (the false "dependency cycle"
#     when a sample listed both mailer and dev-mailbox);
#   - a real cycle is still refused;
#   - an optional wire (`when = "<sample>"`) waits until that sample is installed, in either order.
# tools/ci.sh runs it first. Exit status: 0 when every check passed.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/tools" "$tmp/samples"
cp "$root/tools/install.sh" "$tmp/tools/install.sh"

# sample <name> <depends_on…>: a sample with no crates, no files and no wiring.
sample() {
  name=$1
  shift
  deps=""
  for d in "$@"; do deps="$deps${deps:+, }\"$d\""; done
  mkdir -p "$tmp/samples/$name"
  cat > "$tmp/samples/$name/sample.toml" <<EOF
name = "$name"
version = "0.0.0"
summary = "fixture"
depends_on = [$deps]
extracted_from = "fixture"
crates = []
EOF
}

app() {
  rm -rf "$tmp/app"
  mkdir -p "$tmp/app/docs"
  printf '[package]\nname = "fixture_app"\n' > "$tmp/app/Cargo.toml"
  : > "$tmp/app/docs/decisions.md"
}

failed=0
check() {
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    printf 'FAIL %s\n  expected: %s\n  got:      %s\n' "$1" "$2" "$3" >&2
    failed=$((failed + 1))
  fi
}

# The order install.sh would install, from its --dry-run output.
order() { sh "$tmp/tools/install.sh" --dry-run "$1" "$tmp/app" 2>&1 | awk '/^install / { printf "%s ", $2 } /cycle/ { printf "CYCLE " }'; }

sample base
sample mid base
sample top base mid

app
check "a diamond installs each sample once, dependencies first" "base mid top " "$(order top)"

app
echo "2026-01-01: installed sample base 0.0.0" >> "$tmp/app/docs/decisions.md"
check "a diamond over an installed sample is not a cycle" "mid top " "$(order top)"

sample loop-a loop-b
sample loop-b loop-a
app
check "a real cycle is still refused" "CYCLE " "$(order loop-a)"

# Optional wiring: `opt` has a wire with `when = "dep"`, into src/x.rs of the app.
sample dep
sample opt
cat >> "$tmp/samples/opt/sample.toml" <<'TOML'

[[wire]]
file = "src/x.rs"
anchor = "x"
when = "dep"
text = '''
// wired for dep
'''
TOML
app_with_anchor() {
  app
  mkdir -p "$tmp/app/src"
  printf '// samples: x\n' > "$tmp/app/src/x.rs"
}
install() { sh "$tmp/tools/install.sh" "$1" "$tmp/app" > /dev/null 2>&1 || echo "install $1 failed" >&2; }
wired() { if grep -q "wired for dep" "$tmp/app/src/x.rs"; then echo yes; else echo no; fi; }

app_with_anchor
install opt
check "an optional wire waits while its sample is missing" "no" "$(wired)"
install dep
check "installing the awaited sample applies the waiting wire" "yes" "$(wired)"

app_with_anchor
install dep
install opt
check "an optional wire applies when its sample is already in" "yes" "$(wired)"
check "and only once" "1" "$(grep -c "wired for dep" "$tmp/app/src/x.rs")"

[ "$failed" = 0 ] || { echo "install-test: $failed check(s) failed" >&2; exit 1; }
echo "install-test: all checks passed"
