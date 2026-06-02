#!/usr/bin/env bash
# forget-cleanup.sh — runs on SessionStart and SessionEnd. If a /forget wipe is
# armed for this project, and it's safe (the armed session is not the one we're
# starting into / actively in), permanently delete that session's transcript and
# the project memory, then remove the flag.
#
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
python3 <<'PY'
import json, os, shutil, tempfile

flag_path  = os.environ["FORGET_FLAG"]
claude_dir = os.environ["FORGET_CLAUDE_DIR"]
payload    = os.environ.get("FORGET_PAYLOAD", "")
dry        = os.environ.get("FORGET_DRY_RUN", "0") == "1"

def done(): raise SystemExit(0)

try:
    flag = json.load(open(flag_path))
except Exception:
    done()

try:
    ev = json.loads(payload) if payload.strip() else {}
except Exception:
    ev = {}

event  = ev.get("hook_event_name", "")
source = ev.get("source", "")
ev_cwd = ev.get("cwd", "") or os.getcwd()
ev_tx  = ev.get("transcript_path", "")
ev_sid = ev.get("session_id", "")

f_tx  = flag.get("transcript", "")
f_sid = flag.get("session_id", "")
f_cwd = flag.get("cwd", "")
f_mem = flag.get("memory_dir", "")

def rp(p):
    try: return os.path.realpath(p)
    except Exception: return p

# Only act in the project the wipe was armed in.
if f_cwd and ev_cwd and rp(f_cwd) != rp(ev_cwd):
    done()

same_as_active = bool(ev_tx) and rp(ev_tx) == rp(f_tx)

# ---- Decide whether to wipe now -------------------------------------------
if event == "SessionStart":
    if source == "clear":
        if same_as_active:        # safety: never wipe the live session
            done()
        # armed session is the one just cleared → wipe
    elif source == "resume":
        if same_as_active:        # user resumed the armed session → cancel forget
            if not dry:
                try: os.remove(flag_path)
                except Exception: pass
            else:
                print("[dry-run] resume of armed session → would cancel flag")
        done()
    else:                          # startup / compact / unknown → do nothing
        done()
elif event == "SessionEnd":
    # Only wipe if the ending session is the armed one (when identifiable).
    if ev_sid and f_sid and ev_sid != f_sid:
        done()
    if (not ev_sid) and ev_tx and not same_as_active:
        done()
    # else: matches armed (or unidentifiable, single-terminal case) → wipe
else:
    done()

# ---- Perform the wipe ------------------------------------------------------
def rm(path, label):
    if not path:
        return
    if dry:
        exists = os.path.exists(path) or os.path.islink(path)
        print(f"[dry-run] {'DELETE' if exists else 'skip  '} {label}: {path}")
        return
    try:
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path)
        elif os.path.exists(path) or os.path.islink(path):
            os.remove(path)
    except FileNotFoundError:
        pass
    except Exception:
        pass

sid = f_sid or (os.path.splitext(os.path.basename(f_tx))[0] if f_tx else "")

# 1) transcript + sidecar meta + per-session subdir (subagents/, tool-results/)
rm(f_tx, "transcript")
rm(f_tx + ".meta", "transcript meta")
if f_tx.endswith(".jsonl"):
    rm(f_tx[:-len(".jsonl")], "session subdir")

# 2) session-env entry
if sid:
    rm(os.path.join(claude_dir, "session-env", sid), "session-env")

# 3) scrub history.jsonl lines for this session
hist = os.path.join(claude_dir, "history.jsonl")
if sid and os.path.isfile(hist):
    if dry:
        def _line_sid(ln):
            try: return json.loads(ln).get("sessionId")
            except Exception: return None
        try:
            n = sum(1 for ln in open(hist)
                    if ln.strip() and _line_sid(ln) == sid)
            print(f"[dry-run] scrub history.jsonl: {n} line(s) for {sid}")
        except Exception:
            pass
    else:
        try:
            kept = []
            with open(hist) as fh:
                for ln in fh:
                    s = ln.strip()
                    if not s:
                        continue
                    try:
                        if json.loads(s).get("sessionId") == sid:
                            continue
                    except Exception:
                        pass
                    kept.append(ln if ln.endswith("\n") else ln + "\n")
            d = os.path.dirname(hist)
            fd, tmp = tempfile.mkstemp(dir=d)
            with os.fdopen(fd, "w") as out:
                out.writelines(kept)
            os.replace(tmp, hist)
        except Exception:
            pass

# 4) project memory
rm(f_mem, "project memory")

# 5) remove the flag (forget completed)
if not dry:
    try: os.remove(flag_path)
    except Exception: pass
else:
    print("[dry-run] would remove flag:", flag_path)
PY
exit 0
