#!/usr/bin/env bash
# forget-arm.sh — arm (or cancel) a wipe for the CURRENT session or project.
# Writes a reversible flag file; performs NO deletion. The actual wipe is done
# by forget-cleanup.sh:
#   scope=session  → on /clear or session close
#   scope=project  → on session CLOSE (SessionEnd), or startup recovery
#
# Usage: forget-arm.sh <session|project> [cancel]
set -uo pipefail

claude_dir="${HOME}/.claude"
projects_dir="${claude_dir}/projects"
flag="${claude_dir}/forget-pending.json"

scope="${1:-session}"
arg="${2:-}"

if [ "$arg" = "cancel" ]; then
  if [ -f "$flag" ]; then
    rm -f "$flag"
    echo "✗ Forget cancelled — nothing will be deleted."
  else
    echo "Nothing was armed; nothing to cancel."
  fi
  exit 0
fi

cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
enc="$(printf '%s' "$cwd" | sed 's#/#-#g')"
proj="${projects_dir}/${enc}"

# Identify the live transcript: newest .jsonl in this project's dir, falling
# back to the globally newest transcript (the one being actively written).
transcript=""
if [ -d "$proj" ]; then
  transcript="$(ls -t "$proj"/*.jsonl 2>/dev/null | head -n1 || true)"
fi
if [ -z "$transcript" ]; then
  transcript="$(ls -t "$projects_dir"/*/*.jsonl 2>/dev/null | head -n1 || true)"
fi

if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
  echo "⚠️  Could not locate this session's transcript — nothing armed."
  exit 0
fi

session_id="$(basename "$transcript" .jsonl)"
proj_dir="$(dirname "$transcript")"
mem_dir="${proj_dir}/memory"

if [ "$scope" = "project" ]; then
  # Write the project-scope flag and print a full inventory of what will go.
  FORGET_FLAG="$flag" FORGET_CWD="$cwd" FORGET_TX="$transcript" \
  FORGET_SID="$session_id" FORGET_PROJDIR="$proj_dir" FORGET_MEMDIR="$mem_dir" \
  FORGET_CLAUDE_DIR="$claude_dir" \
  python3 "$(dirname "$0")/forget-arm-project.py"
  exit 0
fi

# --- session scope ----------------------------------------------------------
mem_count=0
if [ -d "$mem_dir" ]; then
  mem_count="$(find "$mem_dir" -type f 2>/dev/null | wc -l | tr -d ' ')"
fi

python3 - "$flag" "$transcript" "$session_id" "$cwd" "$mem_dir" <<'PY'
import json, sys
flag, transcript, session_id, cwd, mem_dir = sys.argv[1:6]
with open(flag, "w") as fh:
    json.dump({
        "scope": "session",
        "transcript": transcript,
        "session_id": session_id,
        "cwd": cwd,
        "memory_dir": mem_dir,
    }, fh)
PY

echo "🧹 Forget armed for this session (nothing deleted yet)."
echo "   • transcript : ${transcript}"
echo "   • memory     : ${mem_dir} (${mem_count} file(s))"
echo
echo "Press /clear to confirm: it wipes both and drops you into a fresh, 0-context session."
echo "Closing the session also triggers the wipe."
echo "To back out, run:  /forget cancel"
