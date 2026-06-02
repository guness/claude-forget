"""Shared helpers for claude-forget arm/cleanup scripts."""
import json
import os


def project_session_ids(project_dir, history_path, cwd):
    """All session ids that belong to a project: transcript basenames under
    project_dir, unioned with history.jsonl lines whose project == cwd."""
    ids = set()
    if project_dir and os.path.isdir(project_dir):
        for n in os.listdir(project_dir):
            if n.endswith(".jsonl"):
                ids.add(n[:-len(".jsonl")])
    if history_path and os.path.isfile(history_path):
        try:
            with open(history_path) as fh:
                for ln in fh:
                    ln = ln.strip()
                    if not ln:
                        continue
                    try:
                        d = json.loads(ln)
                    except Exception:
                        continue
                    if d.get("project") == cwd and d.get("sessionId"):
                        ids.add(d["sessionId"])
        except Exception:
            pass
    return ids


def per_session_paths(claude_dir, sid):
    """The per-session reference paths keyed by a session id."""
    return [
        os.path.join(claude_dir, "session-env", sid),
        os.path.join(claude_dir, "file-history", sid),
        os.path.join(claude_dir, "tasks", sid),
        os.path.join(claude_dir, "security", f"security_warnings_state_{sid}.json"),
        os.path.join(claude_dir, "security", f"security_warnings_state_{sid}.lock"),
    ]


def count_history_lines(history_path, cwd):
    n = 0
    if history_path and os.path.isfile(history_path):
        try:
            with open(history_path) as fh:
                for ln in fh:
                    ln = ln.strip()
                    if not ln:
                        continue
                    try:
                        if json.loads(ln).get("project") == cwd:
                            n += 1
                    except Exception:
                        pass
        except Exception:
            pass
    return n


def count_security_log_lines(log_path, cwd):
    n = 0
    if log_path and os.path.isfile(log_path):
        try:
            with open(log_path, errors="replace") as fh:
                for ln in fh:
                    if cwd in ln:
                        n += 1
        except Exception:
            pass
    return n


def backups_with_project(backups_dir, cwd):
    """List of ~/.claude.json backup files that still contain projects[cwd]."""
    hits = []
    if not (backups_dir and os.path.isdir(backups_dir)):
        return hits
    for n in os.listdir(backups_dir):
        if ".claude.json.backup" not in n:
            continue
        p = os.path.join(backups_dir, n)
        try:
            d = json.load(open(p))
            if isinstance(d.get("projects"), dict) and cwd in d["projects"]:
                hits.append(p)
        except Exception:
            pass
    return hits
