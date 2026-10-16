#!/bin/sh
# Prove samples the way an app would: a fresh copy of host/, the sample installed with
# tools/install.sh, then the Definition of Done on SQLite and Postgres.
#
#   tools/ci.sh                    every sample alone, then all of them together
#   tools/ci.sh mailer dev-mailbox  just these (each alone)
#   tools/ci.sh all                every sample installed into one app
#
# Postgres: set TEST_DATABASE_URL to a server where the suite may create databases (one per test,
# dropped after it), e.g. postgres://postgres:postgres@localhost:5432/postgres. Without it the run
# fails, unless --no-postgres says to skip that step (it then says so in the summary).
#
# Each run builds in .cache/ci/<name>/app with one shared target dir (.cache/target), so later
# runs only rebuild what changed. Exit status: 0 when every run passed.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
postgres=1
targets=""
for arg in "$@"; do
  case "$arg" in
    --no-postgres) postgres=0 ;;
    -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "ci: unknown option $arg" >&2; exit 2 ;;
    *) targets="$targets $arg" ;;
  esac
done

all_samples=$(cd "$root/samples" && for d in */; do [ -f "$d/sample.toml" ] && printf '%s ' "${d%/}"; done)
[ -n "$targets" ] || targets="$all_samples all"

if [ "$postgres" = 1 ] && [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "ci: TEST_DATABASE_URL is not set (the Postgres run is required; --no-postgres skips it)" >&2
  exit 2
fi
# The SQLite runs must not see it; the Postgres step passes it explicitly.
pg_url="${TEST_DATABASE_URL:-}"
unset TEST_DATABASE_URL

[ -f "$root/host/.offrails/VERSION" ] || "$root/tools/vendor-framework.sh" "$root/host"
# install.sh's dependency resolution, on fixtures (seconds; no cargo).
sh "$root/tools/install-test.sh" || exit 1

export CARGO_TARGET_DIR="$root/.cache/target"
export CARGO_TERM_COLOR="${CARGO_TERM_COLOR:-never}"
summary=""
failed=0
name=""
app=""

# step <label> <command…>: runs in the app dir, prints a header, records the result.
step() {
  label=$1
  shift
  printf '\n== %s: %s\n' "$name" "$label"
  if (cd "$app" && "$@"); then
    return 0
  fi
  echo "FAIL $name: $label" >&2
  return 1
}

# The files a sample ships must come out of `cargo fmt` unchanged: shipped code is formatted.
# A shipped file that another installed sample wires into (a `[[wire]] file =`, e.g. mailer's
# src/mailers/previews.rs once auth-core is in) legitimately differs from it in the app, so the
# comparison with the app's copy skips it; rustfmt checks the shipped file by itself instead.
check_formatted() {
  installed=$(sed -n 's/^.*: installed sample \([^ ]*\) .*$/\1/p' "$app/docs/decisions.md")
  wired=$(for i in $installed; do
    sed -n 's/^file = "\(.*\)"[[:space:]]*$/\1/p' "$root/samples/$i/sample.toml"
  done | sort -u)
  for s in $1; do
    (cd "$root/samples/$s/files" && find . -name '*.rs' -type f | sed 's|^\./||') | while IFS= read -r f; do
      if printf '%s\n' "$wired" | grep -qxF "$f"; then
        # Still rustfmt-clean as shipped: stdin mode formats the file alone (no `mod` lookups).
        (cd "$app" && rustfmt --edition 2024 --emit stdout < "$root/samples/$s/files/$f" > "$app/../shipped-fmt.rs" 2>/dev/null) || true
        if ! cmp -s "$app/../shipped-fmt.rs" "$root/samples/$s/files/$f"; then
          echo "samples/$s/files/$f is not rustfmt-formatted as shipped" >&2
          return 1
        fi
        echo "fmt: samples/$s/files/$f checked as shipped (another installed sample wires into it)"
        continue
      fi
      crate=$(awk '/^\[package\]/ { p = 1; next } /^\[/ { p = 0 } p && $1 == "name" { gsub(/[" ]/, "", $3); print $3; exit }' "$app/Cargo.toml")
      if ! sed "s/offrails_host/$crate/g" "$root/samples/$s/files/$f" | cmp -s - "$app/$f"; then
        echo "samples/$s/files/$f is not rustfmt-formatted (run cargo fmt in an installed app and copy it back)" >&2
        return 1
      fi
    done || return 1
  done
}

run_one() {
  name=$1
  case "$name" in
    all) samples=$all_samples ;;
    *) [ -f "$root/samples/$name/sample.toml" ] || { echo "ci: no sample $name" >&2; return 1; }; samples=$name ;;
  esac
  app="$root/.cache/ci/$name/app"
  rm -rf "$app"
  mkdir -p "$app"
  # tar, not cp -R: host/target and local databases stay behind.
  tar -C "$root/host" --exclude ./target --exclude './storage/*' --exclude ./.env -cf - . | tar -C "$app" -xf -

  for s in $samples; do
    # In "all", a sample may already be in as an earlier one's dependency.
    grep -q "installed sample $s " "$app/docs/decisions.md" && continue
    if ! "$root/tools/install.sh" "$s" "$app" > "$app/../install-$s.log" 2>&1; then
      cat "$app/../install-$s.log" >&2
      echo "FAIL $name: install $s" >&2
      return 1
    fi
  done

  step "cargo fmt" cargo fmt --all || return 1
  check_formatted "$samples" || { echo "FAIL $name: shipped files not formatted" >&2; return 1; }
  step "css" sh -c 'bin/setup-tailwind && bin/tailwindcss -i assets/app.css -o static/app.css --minify 2>&1 | tail -1' || return 1
  step "routes" sh -c 'cargo run -q -- routes > /dev/null' || return 1
  step "clippy" cargo clippy -q --all-targets -- -D warnings || return 1
  # The framework's lint set for shipped code: no unwrap/expect outside tests (workflow.md DoD).
  step "clippy (no unwrap/expect)" cargo clippy -q --lib --bins -- -D warnings -D clippy::unwrap_used -D clippy::expect_used || return 1
  step "tests (SQLite)" cargo nextest run --no-fail-fast --status-level fail --final-status-level fail || return 1
  if [ "$postgres" = 1 ]; then
    step "tests (Postgres)" env TEST_DATABASE_URL="$pg_url" cargo nextest run --no-fail-fast --status-level fail --final-status-level fail || return 1
  fi
  step "offrails-check" sh .offrails/tools/offrails-check || return 1
  step "cargo deny" cargo deny --log-level error check || return 1
  step "cargo audit" cargo audit -q --deny warnings || return 1
  step "fmt --check" cargo fmt --all --check || return 1
}

for t in $targets; do
  if run_one "$t"; then
    result="ok  "
  else
    result="FAIL"
    failed=$((failed + 1))
  fi
  if [ "$postgres" = 1 ]; then dbs="SQLite + Postgres"; else dbs="SQLite only (Postgres skipped)"; fi
  summary="$summary
$result $t ($dbs)"
done

printf '\n== summary%s\n' "$summary"
[ "$failed" = 0 ]
