#!/usr/bin/env bash
# forget-cleanup.sh — hook entrypoint for SessionStart and SessionEnd.
# Thin wrapper: if a wipe is armed, hand the payload to the Python engine.
# Set FORGET_DRY_RUN=1 to print planned deletions instead of performing them.
set -uo pipefail

claude_dir="${HOME}/.claude"
flag="${claude_dir}/forget-pending.json"

# Fast exit: nothing armed.
[ -f "$flag" ] || exit 0

payload="$(cat 2>/dev/null || true)"

FORGET_PAYLOAD="$payload" \
FORGET_FLAG="$flag" \
FORGET_CLAUDE_DIR="$claude_dir" \
FORGET_DRY_RUN="${FORGET_DRY_RUN:-0}" \
python3 "$(dirname "$0")/forget-cleanup.py"
exit 0
