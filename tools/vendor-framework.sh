#!/bin/sh
# Vendor the Rust off Rails framework into an app's .offrails/, as generators/new.md step 1 does.
#
#   tools/vendor-framework.sh <app-dir>
#
# The version is FRAMEWORK_VERSION at the repo root. By default the release tarball is downloaded
# from GitHub and checked against the release's checksums.txt. OFFRAILS_FW=<path to a framework
# git checkout> exports that version's tag from the checkout instead (offline, same content).
set -eu

usage() { echo "usage: tools/vendor-framework.sh <app-dir>" >&2; exit 2; }
[ $# -eq 1 ] || usage
app=$1
[ -d "$app" ] || { echo "vendor-framework: $app is not a directory" >&2; exit 2; }

root=$(cd "$(dirname "$0")/.." && pwd)
version=$(head -n1 "$root/FRAMEWORK_VERSION" | tr -d '[:space:]')
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -n "${OFFRAILS_FW:-}" ]; then
  git -C "$OFFRAILS_FW" archive "v$version" | tar -x -C "$work"
  src=$work
else
  base="https://github.com/rust-off-rails/rustoffrails/releases/download/v$version"
  curl -sSLf "$base/rustoffrails.tar.gz" -o "$work/rustoffrails.tar.gz"
  curl -sSLf "$base/checksums.txt" -o "$work/checksums.txt"
  expected=$(awk '$2 == "rustoffrails.tar.gz" { print $1 }' "$work/checksums.txt")
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$work/rustoffrails.tar.gz" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$work/rustoffrails.tar.gz" | awk '{ print $1 }')
  fi
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "vendor-framework: checksum mismatch for v$version (expected $expected, got $actual)" >&2
    exit 1
  fi
  tar -xzf "$work/rustoffrails.tar.gz" -C "$work"
  src=$work/rustoffrails
fi

[ "$(head -n1 "$src/VERSION" | tr -d '[:space:]')" = "$version" ] || {
  echo "vendor-framework: the fetched framework is not version $version" >&2
  exit 1
}
mkdir -p "$app/.offrails"
rsync -a --delete --exclude /.git --exclude /.claude-plugin --exclude /skills --exclude /hooks \
  --exclude /evals --exclude /brand --exclude /.in_use "$src"/ "$app/.offrails/"
date -u +"vendored %F" >> "$app/.offrails/VERSION"
echo "vendored Rust off Rails $version into $app/.offrails"
