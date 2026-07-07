#!/usr/bin/env bash
# Run the Interlaken implementation prompts through Claude Code, in order,
# with full permission bypass. Auto-commits after each so diffs stay reviewable.
#
# Usage:
#   ./prompts/run-prompts.sh            # run all (01..20)
#   ./prompts/run-prompts.sh 1 5        # run 01..05 only
#   ./prompts/run-prompts.sh 8 8        # run just prompt 08
#   NOCOMMIT=1 ./prompts/run-prompts.sh # don't auto-commit

set -uo pipefail
FROM="${1:-1}"
TO="${2:-20}"
MODEL="${MODEL:-opus}"

cd "$(dirname "$0")/.."            # repo root
mkdir -p prompts/logs

for f in prompts/[0-9]*.md; do
  base="$(basename "$f")"
  n="$(printf '%s' "$base" | sed -E 's/^0*([0-9]+)-.*/\1/')"
  [ "$n" -lt "$FROM" ] && continue
  [ "$n" -gt "$TO" ]   && continue

  echo ""
  echo "=== [$n] $base ============================="
  claude --dangerously-skip-permissions --model "$MODEL" -p "$(cat "$f")" 2>&1 \
      | tee "prompts/logs/$(printf '%02d' "$n").log"
  status=${PIPESTATUS[0]}

  if [ "$status" -ne 0 ]; then
    echo "Prompt $n exited with $status — stopping." >&2
    exit "$status"
  fi

  if [ -z "${NOCOMMIT:-}" ]; then
    git add -A
    git commit -m "prompt ${base%.md}: automated run

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" >/dev/null 2>&1 || true
  fi
  echo "=== [$n] done ==="
done
