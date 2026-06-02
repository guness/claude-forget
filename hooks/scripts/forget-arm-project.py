#!/usr/bin/env python3
"""Arm a PROJECT-scope nuke: write the flag and print a full inventory of every
Claude-realm reference that will be deleted when the session closes."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forget_common as fc

flag       = os.environ["FORGET_FLAG"]
cwd        = os.environ["FORGET_CWD"]
transcript = os.environ["FORGET_TX"]
sid        = os.environ["FORGET_SID"]
proj_dir   = os.environ["FORGET_PROJDIR"]
mem_dir    = os.environ["FORGET_MEMDIR"]
claude_dir = os.environ["FORGET_CLAUDE_DIR"]

history    = os.path.join(claude_dir, "history.jsonl")
seclog     = os.path.join(claude_dir, "security", "log.txt")
backups    = os.path.join(claude_dir, "backups")
claude_json = os.path.expanduser("~/.claude.json")

ids = fc.project_session_ids(proj_dir, history, cwd)
sess_count = sum(1 for n in (os.listdir(proj_dir) if os.path.isdir(proj_dir) else [])
                 if n.endswith(".jsonl"))
mem_count = sum(len(files) for _, _, files in os.walk(mem_dir)) if os.path.isdir(mem_dir) else 0
hist_count = fc.count_history_lines(history, cwd)
seclog_count = fc.count_security_log_lines(seclog, cwd)
backup_hits = fc.backups_with_project(backups, cwd)

# Count existing per-session reference files across all ids.
persess = 0
for i in ids:
    for p in fc.per_session_paths(claude_dir, i):
        if os.path.exists(p) or os.path.islink(p):
            persess += 1

# ~/.claude.json entry present?
cj_has = False
try:
    cj = json.load(open(claude_json))
    cj_has = isinstance(cj.get("projects"), dict) and cwd in cj["projects"]
except Exception:
    cj_has = False

with open(flag, "w") as fh:
    json.dump({
        "scope": "project",
        "cwd": cwd,
        "transcript": transcript,
        "session_id": sid,
        "project_dir": proj_dir,
        "memory_dir": mem_dir,
    }, fh)

print("☢️  PROJECT NUKE armed (nothing deleted yet).")
print(f"   project: {cwd}")
print("   This removes every Claude-realm reference to this project:")
print(f"     • sessions + memory     : {proj_dir}/  ({sess_count} session(s), {mem_count} memory file(s))")
print(f"     • per-session refs       : {persess} file(s)/dir(s) across {len(ids)} session id(s)")
print(f"                                (session-env, file-history, tasks, security state)")
print(f"     • prompt history         : {hist_count} line(s) in history.jsonl")
print(f"     • ~/.claude.json entry   : {'yes — trust, allowedTools, mcpServers (best-effort, backed up)' if cj_has else 'none'}")
print(f"     • security audit log     : {seclog_count} line(s) in security/log.txt")
print(f"     • config backups         : {len(backup_hits)} backup file(s) scrubbed")
print()
print("   Your actual source files on disk are NOT touched — only Claude's data.")
print()
print("To execute: CLOSE this session (Ctrl+D or /exit). The nuke runs on exit.")
print("  (Note: /clear will NOT complete a project nuke — the live process re-creates")
print("   the project. You must close the session.)")
print("To back out:  /forget:cancel")
