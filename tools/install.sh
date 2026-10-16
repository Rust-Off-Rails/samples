#!/bin/sh
# Install a sample into a Rust off Rails app: what samples/<name>/README.md asks an agent to do by
# hand, done mechanically.
#
#   tools/install.sh [--force] [--dry-run] <sample> <app-dir>
#
# For <sample> and, first, every sample it depends on (depends_on, recursively) that the app
# doesn't have yet:
#   1. checks that no file it brings exists in the app (unless --force) and that every wiring
#      anchor is present, before changing anything;
#   2. runs its `cargo add` lines in the app;
#   3. copies samples/<name>/files/ into the app at the same paths, with the host crate name
#      (offrails_host) replaced by the app's;
#   4. applies its wiring: each [[wire]] text goes on the lines above the `samples: <anchor>`
#      comment in that file, indented like the comment (already-present lines are skipped);
#   5. records `YYYY-MM-DD: installed sample <name> <version>` in docs/decisions.md.
#
# The format is documented in samples/FORMAT.md. Exit status: 0 done, 1 refused or failed, 2 usage.
set -eu

usage() {
  echo "usage: tools/install.sh [--force] [--dry-run] <sample> <app-dir>" >&2
  exit 2
}

force=0
dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    -h | --help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) usage ;;
    *) break ;;
  esac
  shift
done
[ $# -eq 2 ] || usage
target=$1
app=$2

root=$(cd "$(dirname "$0")/.." && pwd)
samples="$root/samples"
[ -d "$app" ] || { echo "install: $app is not a directory" >&2; exit 2; }
app=$(cd "$app" && pwd)
[ -f "$app/Cargo.toml" ] || { echo "install: $app has no Cargo.toml (not an app root)" >&2; exit 2; }
[ -f "$samples/$target/sample.toml" ] || { echo "install: no sample named '$target' (see samples/)" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The app's crate name: the first `name = "…"` after [package].
crate=$(awk '/^\[package\]/ { p = 1; next } /^\[/ { p = 0 } p && $1 == "name" { gsub(/[" ]/, "", $3); print $3; exit }' "$app/Cargo.toml")
[ -n "$crate" ] || { echo "install: can't read the package name from $app/Cargo.toml" >&2; exit 1; }

# parse <sample>: sample.toml -> $work/<sample>/{meta,deps,crates,wires,wire.N}
parse() {
  dir="$work/$1"
  mkdir -p "$dir"
  awk -v out="$dir" '
    function unquote(s) { sub(/^[ \t]*"/, "", s); sub(/"[ \t,]*$/, "", s); return s }
    function value(line) { sub(/^[^=]*=[ \t]*/, "", line); return line }
    BEGIN { n = 0; in_text = 0; in_crates = 0; section = "" }
    in_text {
      if ($0 ~ /^'"'''"'[ \t]*$/) { in_text = 0; close(text_file); next }
      print > text_file; next
    }
    in_crates {
      if ($0 ~ /^[ \t]*\]/) { in_crates = 0; next }
      if ($0 ~ /^[ \t]*"/) print unquote($0) > (out "/crates")
      next
    }
    /^[ \t]*#/ || /^[ \t]*$/ { next }
    /^\[\[wire\]\]/ { n++; section = "wire"; next }
    /^\[/ { section = $0; next }
    {
      key = $1
      if (section == "wire") {
        if (key == "file") file[n] = unquote(value($0))
        else if (key == "anchor") anchor[n] = unquote(value($0))
        else if (key == "text") {
          text_file = out "/wire." n
          printf "" > text_file
          in_text = 1
        }
        next
      }
      if (key == "crates") {
        v = value($0)
        if (v ~ /^\[[ \t]*$/) { in_crates = 1; next }
        gsub(/^\[|\][ \t]*$/, "", v)
        if (v != "") { m = split(v, parts, ","); for (i = 1; i <= m; i++) if (parts[i] ~ /"/) print unquote(parts[i]) > (out "/crates") }
        next
      }
      if (key == "depends_on") {
        v = value($0); gsub(/[\[\]" \t]/, "", v)
        m = split(v, parts, ",")
        for (i = 1; i <= m; i++) if (parts[i] != "") print parts[i] > (out "/deps")
        next
      }
      if (key == "name" || key == "version") print key "\t" unquote(value($0)) > (out "/meta")
    }
    END { for (i = 1; i <= n; i++) print file[i] "\t" anchor[i] "\t" i > (out "/wires") }
  ' "$samples/$1/sample.toml"
  touch "$dir/deps" "$dir/crates" "$dir/wires" "$dir/meta"
}

meta() { awk -F '\t' -v k="$2" '$1 == k { print $2 }' "$work/$1/meta"; }

installed() { [ -f "$app/docs/decisions.md" ] && grep -q "installed sample $1 " "$app/docs/decisions.md"; }

# Resolve the install order: dependencies first, each once, already-installed ones skipped.
order=""
visiting=""
resolve() {
  case " $order " in *" $1 "*) return ;; esac
  case " $visiting " in *" $1 "*) echo "install: dependency cycle at $1" >&2; exit 1 ;; esac
  [ -f "$samples/$1/sample.toml" ] || { echo "install: depends on unknown sample '$1'" >&2; exit 1; }
  visiting="$visiting $1"
  parse "$1"
  while IFS= read -r dep; do
    [ -n "$dep" ] && resolve "$dep"
  done < "$work/$1/deps"
  if installed "$1" && [ "$1" != "$target" ]; then
    echo "skip   $1 (already installed)"
  else
    order="$order $1"
  fi
}
resolve "$target"

if installed "$target" && [ "$force" = 0 ]; then
  echo "install: $target is already installed in $app (docs/decisions.md); --force reinstalls" >&2
  exit 1
fi

# A copy of <file> with the host crate name replaced by the app's.
rename() { sed "s/offrails_host/$crate/g" "$1"; }

# Check everything before changing anything.
problems=0
for s in $order; do
  files=$(cd "$samples/$s/files" 2>/dev/null && find . -type f | sed 's|^\./||' | sort || true)
  for f in $files; do
    if [ -e "$app/$f" ] && [ "$force" = 0 ]; then
      if rename "$samples/$s/files/$f" | cmp -s - "$app/$f"; then
        continue
      fi
      echo "refuse $s: $f already exists in the app and differs (--force overwrites it)" >&2
      problems=$((problems + 1))
    fi
  done
  while IFS="$(printf '\t')" read -r file anchor _n; do
    [ -n "$file" ] || continue
    if [ ! -f "$app/$file" ]; then
      # A file this same install creates is fine (a sample may wire into its own dependency).
      found=0
      for o in $order; do [ -f "$samples/$o/files/$file" ] && found=1; done
      if [ "$found" = 0 ]; then
        echo "refuse $s: wiring target $file doesn't exist in the app" >&2
        problems=$((problems + 1))
      fi
    elif ! grep -q "samples: $anchor\$" "$app/$file" && ! grep -q "samples: $anchor " "$app/$file"; then
      echo "refuse $s: $file has no 'samples: $anchor' anchor; apply this wiring by hand (README.md, Wiring)" >&2
      problems=$((problems + 1))
    elif ! grep -E "samples: $anchor( |\$)" "$app/$file" | grep -qE '^[[:space:]]*(//|\{#|#|/\*)'; then
      # WHY: an anchor trailing code (`} // samples: x`, as rustfmt may leave it) would put the
      # insertion inside that code.
      echo "refuse $s: the 'samples: $anchor' anchor in $file shares its line with code; move it onto its own line" >&2
      problems=$((problems + 1))
    fi
  done < "$work/$s/wires"
done
[ "$problems" = 0 ] || { echo "install: nothing changed ($problems problem(s))" >&2; exit 1; }

# insert_at <file> <anchor> <text-file>: the text's lines above the anchor line, with its indent.
# Idempotent: when the text's lines already appear together in the file, nothing is inserted.
insert_at() {
  awk -v anchor="samples: $2" -v textf="$3" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN {
      while ((getline t < textf) > 0) { text[++tn] = t; if (trim(t) != "") want = want trim(t) "\n" }
      close(textf)
    }
    FNR == NR { if (trim($0) != "") have = have trim($0) "\n"; next }
    FNR == 1 { present = (want == "" || index(have, want) > 0) }
    !done && !present && (index($0, anchor " ") || substr($0, length($0) - length(anchor) + 1) == anchor) {
      indent = $0; sub(/[^ \t].*$/, "", indent)
      for (i = 1; i <= tn; i++) print (trim(text[i]) == "" ? "" : indent text[i])
      done = 1
    }
    { print }
  ' "$1" "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}

today=$(date -u +%F)
for s in $order; do
  version=$(meta "$s" version)
  echo "install $s $version -> $app"
  if [ "$dry" = 1 ]; then
    sed 's/^/  cargo add /' "$work/$s/crates"
    (cd "$samples/$s/files" 2>/dev/null && find . -type f | sed 's|^\./|  copy |' | sort) || true
    awk -F '\t' '{ print "  wire " $1 " @ samples: " $2 }' "$work/$s/wires"
    continue
  fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    echo "  cargo add $line"
    # shellcheck disable=SC2086 # a cargo add line is several words on purpose
    (cd "$app" && cargo add -q $line)
  done < "$work/$s/crates"
  if [ -d "$samples/$s/files" ]; then
    (cd "$samples/$s/files" && find . -type f | sed 's|^\./||' | sort) | while IFS= read -r f; do
      mkdir -p "$(dirname "$app/$f")"
      rename "$samples/$s/files/$f" > "$app/$f"
      [ -x "$samples/$s/files/$f" ] && chmod +x "$app/$f"
      echo "  copy $f"
    done
  fi
  while IFS="$(printf '\t')" read -r file anchor n; do
    [ -n "$file" ] || continue
    sed "s/offrails_host/$crate/g" "$work/$s/wire.$n" > "$work/$s/wire.$n.renamed"
    insert_at "$app/$file" "$anchor" "$work/$s/wire.$n.renamed"
    echo "  wire $file @ $anchor"
  done < "$work/$s/wires"
  mkdir -p "$app/docs"
  echo "$today: installed sample $s $version (tools/install.sh; procedure and checks: samples/$s/README.md, CHECKS.md)" >> "$app/docs/decisions.md"
done

[ "$dry" = 1 ] || cat <<EOF
done. Next, in $app:
  cargo fmt --all && cargo run -q -- routes      # docs/routes.md
  then the Definition of Done (.offrails/workflow.md), and each sample's README "After installing".
EOF
