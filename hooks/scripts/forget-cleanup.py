#!/usr/bin/env python3
"""Cleanup engine for claude-forget. Reads the pending flag and the hook payload
and, when safe, performs the armed wipe.

  scope=session  → delete this session's transcript + project memory
  scope=project  → delete every Claude-realm reference to the project

Inputs via env: FORGET_FLAG, FORGET_CLAUDE_DIR, FORGET_PAYLOAD, FORGET_DRY_RUN.
Set FORGET_DRY_RUN=1 to print planned actions instead of performing them.
"""
import json
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forget_common as fc

FLAG       = os.environ["FORGET_FLAG"]
CLAUDE_DIR = os.environ["FORGET_CLAUDE_DIR"]
PAYLOAD    = os.environ.get("FORGET_PAYLOAD", "")
DRY        = os.environ.get("FORGET_DRY_RUN", "0") == "1"

CLAUDE_JSON = os.path.expanduser("~/.claude.json")
HISTORY     = os.path.join(CLAUDE_DIR, "history.jsonl")
SECLOG      = os.path.join(CLAUDE_DIR, "security", "log.txt")
BACKUPS     = os.path.join(CLAUDE_DIR, "backups")
SESSIONS    = os.path.join(CLAUDE_DIR, "sessions")


def done():
    raise SystemExit(0)


def rp(p):
    try:
        return os.path.realpath(p)
    except Exception:
        return p


def rm(path, label):
    if not path:
        return
    if DRY:
        exists = os.path.exists(path) or os.path.islink(path)
        kind = "dir " if os.path.isdir(path) and not os.path.islink(path) else "file"
        print(f"[dry-run] {'DELETE' if exists else 'skip  '} {kind} {label}: {path}")
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


def atomic_write(path, data):
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d)
    with os.fdopen(fd, "w") as out:
        out.write(data)
    os.replace(tmp, path)


def scrub_jsonl(path, drop_pred, label):
    """Drop JSONL lines for which drop_pred(parsed_obj) is True."""
    if not os.path.isfile(path):
        return
    try:
        kept, dropped = [], 0
        with open(path, errors="replace") as fh:
            for ln in fh:
                s = ln.strip()
                if not s:
                    continue
                try:
                    obj = json.loads(s)
                except Exception:
                    kept.append(ln if ln.endswith("\n") else ln + "\n")
                    continue
                if drop_pred(obj):
                    dropped += 1
                    continue
                kept.append(ln if ln.endswith("\n") else ln + "\n")
        if DRY:
            print(f"[dry-run] scrub {label}: drop {dropped} line(s)")
            return
        atomic_write(path, "".join(kept))
    except Exception:
        pass


def scrub_text_lines(path, contains, label):
    if not os.path.isfile(path):
        return
    try:
        kept, dropped = [], 0
        with open(path, errors="replace") as fh:
            for ln in fh:
                if contains in ln:
                    dropped += 1
                    continue
                kept.append(ln)
        if DRY:
            print(f"[dry-run] scrub {label}: drop {dropped} line(s)")
            return
        atomic_write(path, "".join(kept))
    except Exception:
        pass


def remove_project_from_json(path, cwd, label, backup=False):
    """Remove projects[cwd] from a .claude.json-style file (re-read fresh)."""
    if not os.path.isfile(path):
        return
    try:
        d = json.load(open(path))
    except Exception:
        return
    if not (isinstance(d.get("projects"), dict) and cwd in d["projects"]):
        return
    if DRY:
        print(f"[dry-run] {label}: remove projects[\"{cwd}\"]"
              + (" (after backup)" if backup else ""))
        return
    try:
        if backup:
            shutil.copy2(path, os.path.join(BACKUPS, f".claude.json.prenuke.{int(time.time()*1000)}"))
        del d["projects"][cwd]
        atomic_write(path, json.dumps(d, indent=2))
    except Exception:
        pass


# ---- load flag + payload ---------------------------------------------------
if not os.path.isfile(FLAG):
    done()
try:
    flag = json.load(open(FLAG))
except Exception:
    done()
try:
    ev = json.loads(PAYLOAD) if PAYLOAD.strip() else {}
except Exception:
    ev = {}

event  = ev.get("hook_event_name", "")
source = ev.get("source", "")
ev_cwd = ev.get("cwd", "") or os.getcwd()
ev_tx  = ev.get("transcript_path", "")
ev_sid = ev.get("session_id", "")

scope  = flag.get("scope", "session")
f_tx   = flag.get("transcript", "")
f_sid  = flag.get("session_id", "")
f_cwd  = flag.get("cwd", "")

# Only act in the project the wipe was armed in.
if f_cwd and ev_cwd and rp(f_cwd) != rp(ev_cwd):
    done()

same_as_active = bool(ev_tx) and rp(ev_tx) == rp(f_tx)


def drop_flag():
    if not DRY:
        try:
            os.remove(FLAG)
        except Exception:
            pass
    else:
        print("[dry-run] would remove flag:", FLAG)


def update_flag(extra):
    """Keep the flag but merge in extra fields (so the next SessionStart can
    finish cleaning up — e.g. the one-line ghost transcript /exit leaves behind)."""
    if DRY:
        print("[dry-run] keep flag, set:", extra)
        return
    try:
        d = json.load(open(FLAG))
        d.update(extra)
        atomic_write(FLAG, json.dumps(d))
    except Exception:
        pass


# ===========================================================================
# SESSION SCOPE
# ===========================================================================
if scope == "session":
    f_mem = flag.get("memory_dir", "")
    # finalize=True  → remove the flag (job done, stable)
    # finalize=False → keep the flag so the NEXT SessionStart re-runs and clears
    #                  the one-line ghost transcript that /exit recreates post-hook.
    if event == "SessionStart":
        if source == "compact":
            done()                       # same session continues mid-flight
        if same_as_active:
            if source == "resume":
                drop_flag()              # resumed the armed session → cancel
            done()
        finalize = True                  # startup / clear / resume-other → armed is closed
    elif event == "SessionEnd":
        if ev_sid and f_sid and ev_sid != f_sid:
            done()
        if (not ev_sid) and ev_tx and not same_as_active:
            done()
        finalize = False                 # delete now, but keep flag for the ghost sweep
    else:
        done()

    sid = f_sid or (os.path.splitext(os.path.basename(f_tx))[0] if f_tx else "")
    rm(f_tx, "transcript")
    rm(f_tx + ".meta", "transcript meta")
    if f_tx.endswith(".jsonl"):
        rm(f_tx[:-len(".jsonl")], "session subdir")
    if sid:
        rm(os.path.join(CLAUDE_DIR, "session-env", sid), "session-env")
        scrub_jsonl(HISTORY, lambda o: o.get("sessionId") == sid, "history.jsonl")
    rm(f_mem, "project memory")
    drop_flag() if finalize else update_flag({"ghost_sweep": True})
    done()


# ===========================================================================
# PROJECT SCOPE
# ===========================================================================
project_dir = flag.get("project_dir", "")
cwd = f_cwd
heavy_done = flag.get("heavy_done", False)

# Decide whether (and how) to fire.
preserve_sid = None
preserve_tx = None
finalize = True
if event == "SessionEnd":
    if not ((f_sid and ev_sid and ev_sid == f_sid)
            or (ev_tx and rp(ev_tx) == rp(f_tx))
            or (not ev_sid and not ev_tx)):
        done()  # a different session ended; not the one that armed the nuke
    finalize = False  # nuke now, but keep flag so the next start sweeps the ghost
elif event == "SessionStart":
    if source == "resume" and same_as_active:
        drop_flag()  # user resumed the armed session → cancel the nuke
        done()
    if source in ("startup", "resume"):
        preserve_sid, preserve_tx = ev_sid, ev_tx  # keep the new session
    else:
        done()  # /clear and compact do NOT complete a project nuke
else:
    done()

# On the follow-up ghost sweep (SessionEnd already did the heavy global scrubs)
# only clean leftover transcripts/per-session refs — do NOT re-scrub global config,
# so the freshly-reopened project's new ~/.claude.json entry is left intact.
do_globals = not heavy_done

ids = fc.project_session_ids(project_dir, HISTORY, cwd)
if preserve_sid:
    ids.discard(preserve_sid)

# 1) the project's session/memory directory
if preserve_tx and project_dir and rp(os.path.dirname(preserve_tx)) == rp(project_dir):
    keep_base = os.path.basename(preserve_tx)
    keep_sub = keep_base[:-len(".jsonl")] if keep_base.endswith(".jsonl") else None
    for n in (os.listdir(project_dir) if os.path.isdir(project_dir) else []):
        if n == keep_base or (keep_sub and n == keep_sub):
            continue
        rm(os.path.join(project_dir, n), "project entry")
else:
    rm(project_dir, "project dir")

# 2) per-session references for every project session id
for i in sorted(ids):
    for p in fc.per_session_paths(CLAUDE_DIR, i):
        rm(p, f"per-session ({i[:8]})")

# 3) sessions/*.json (PID→cwd map) pointing at this project
if os.path.isdir(SESSIONS):
    for n in os.listdir(SESSIONS):
        p = os.path.join(SESSIONS, n)
        try:
            txt = open(p, errors="replace").read()
        except Exception:
            continue
        if cwd in txt and not (preserve_sid and preserve_sid in txt):
            rm(p, "sessions map")

if do_globals:
    # 4) prompt history lines for this project (keep the preserved session's, if any)
    scrub_jsonl(HISTORY,
                lambda o: o.get("project") == cwd and o.get("sessionId") != preserve_sid,
                "history.jsonl")

    # 5) ~/.claude.json project entry (best-effort; backed up first)
    remove_project_from_json(CLAUDE_JSON, cwd, "~/.claude.json", backup=True)

    # 6) security audit log lines mentioning the path
    scrub_text_lines(SECLOG, cwd, "security/log.txt")

    # 7) strip the project entry from rotating ~/.claude.json backups
    for bp in fc.backups_with_project(BACKUPS, cwd):
        remove_project_from_json(bp, cwd, f"backup {os.path.basename(bp)}")

drop_flag() if finalize else update_flag({"heavy_done": True})
done()
