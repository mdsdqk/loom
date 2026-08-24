#!/usr/bin/env bash
set -euo pipefail

# One-off migration: copies a pre-imports/ candidate/ directory's loose
# files into candidate/imports/, without deleting the originals. Run once,
# manually, before the first /build-profile invocation against an
# existing candidate directory that predates the imports/ split. Not
# invoked automatically by the skill itself (see
# docs/plans/profile-build-implementation.md).
#
# Usage: tools/scripts/migrate-candidate-imports.sh [candidate-dir]
# Defaults to ./candidate relative to wherever it's run from.
#
# Deliberately dumb: copies recognized file *types* (resume .md/.pdf,
# LinkedIn export CSVs) wholesale. It does not curate "which LinkedIn
# files actually matter" -- that's source-normalize's / SKILL.md's job,
# not this script's.

CANDIDATE_DIR="${1:-candidate}"
IMPORTS_DIR="$CANDIDATE_DIR/imports"

if [ ! -d "$CANDIDATE_DIR" ]; then
  echo "No such directory: $CANDIDATE_DIR" >&2
  exit 1
fi

mkdir -p "$IMPORTS_DIR"

copied=0
skipped=0

# Copies $1 into directory $2 only if it isn't already there, so reruns are
# genuinely idempotent -- both in effect (cp -n already guaranteed that) and
# in what gets reported (it doesn't, on its own: it silently no-ops on an
# existing file, which made a rerun falsely claim "copied" on every file).
copy_if_new() {
  local src="$1" destdir="$2"
  local dest="$destdir/$(basename "$src")"
  if [ -e "$dest" ]; then
    skipped=$((skipped + 1))
  else
    cp -n "$src" "$destdir/"
    echo "Copied $(basename "$src") -> $destdir/"
    copied=$((copied + 1))
  fi
}

# Resume files directly under candidate/.
for f in "$CANDIDATE_DIR"/*.md "$CANDIDATE_DIR"/*.pdf; do
  [ -e "$f" ] || continue
  copy_if_new "$f" "$IMPORTS_DIR"
done

# LinkedIn export: any directory under candidate/ matching *LinkedIn*Export*,
# copy its top-level *.csv files into imports/linkedin/. Subfolders (e.g.
# Jobs/, Verifications/) are skipped -- not CSVs.
for dir in "$CANDIDATE_DIR"/*LinkedIn*Export*/; do
  [ -d "$dir" ] || continue
  mkdir -p "$IMPORTS_DIR/linkedin"
  for csv in "$dir"*.csv; do
    [ -e "$csv" ] || continue
    copy_if_new "$csv" "$IMPORTS_DIR/linkedin"
  done
done

if [ "$copied" -eq 0 ] && [ "$skipped" -eq 0 ]; then
  echo "Nothing to migrate -- no loose resume/LinkedIn files found directly under $CANDIDATE_DIR."
else
  echo "Done. $copied file(s) copied into $IMPORTS_DIR, $skipped already present (originals untouched)."
fi
