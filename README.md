# claude-forget

A Claude Code plugin for deliberately erasing your footprint:

- **`/forget:session`** — wipe the current **session**: clears context (via `/clear`)
  and permanently deletes this session's transcript and the project's memory, so the
  conversation can't be resumed, won't appear in `/resume`, and leaves no trace.
- **`/forget:project`** — nuke the whole **project** from the Claude realm: removes
  *every* reference to this project (all sessions, memory, prompt history,
  per-session state, the `~/.claude.json` entry, security audit-log lines, and config
  backups). Your actual source files are never touched.
- **`/forget:cancel`** — disarm whatever is pending (session or project).

> Commands are namespaced by the plugin name `forget`, so they read as
> `/forget:session`, `/forget:project`, `/forget:cancel`.

## How it works

A slash command cannot reset the context window or restart Claude Code on its own —
only **you** typing `/clear` resets context, and deleting the *live* transcript
mid-session doesn't stick (Claude Code keeps re-writing it). So `/forget:session` is a
small two-piece system that works *with* those constraints:

```
/forget:session    → ARMS the wipe for this session (writes a flag; deletes nothing yet)
   ↓
/clear  (or close) → a hook fires and DELETES:
                       • the session transcript (.jsonl, .jsonl.meta, and its
                         per-session subdir: subagents/, tool-results/)
                       • the session-env entry
                       • this session's lines in history.jsonl
                       • the project memory dir (projects/<proj>/memory/)
                     /clear also gives you the fresh, 0-context session.
```

The cleanup runs on **both** `SessionStart(source=clear)` and `SessionEnd`, so the
armed wipe completes on whichever comes first — clearing **or** closing the session.

## Install

From the self-hosted marketplace:

```text
/plugin marketplace add guness/claude-forget
/plugin install forget@claude-forget
```

Or, once listed on Anthropic's community marketplace:

```text
/plugin marketplace add anthropics/claude-plugins-community
/plugin install forget@claude-community
```

Local development / testing (from a clone):

```text
/plugin marketplace add ./claude-forget
/plugin install forget@claude-forget
```

> The marketplace is `claude-forget`; the plugin inside it is `forget` — hence
> `forget@claude-forget`.

## Usage

### `/forget:session` — current session

```
/forget:session   Arm the wipe for the current session.
/forget:cancel    Back out (the only safe way to abort).
```

After `/forget:session`, press **`/clear`** to confirm and start fresh.

> ⚠️ Once armed, **closing the session also triggers the wipe.** Not pressing
> `/clear` is *not* an abort — use `/forget:cancel`.

### `/forget:project` — whole project (☢️ destructive)

```
/forget:project   Arm the project nuke (prints a full inventory first).
/forget:cancel    Back out.
```

After `/forget:project`, **close the session** (`Ctrl+D` / `/exit`) to execute —
the nuke runs on `SessionEnd`.

> ⚠️ **`/clear` does NOT complete a project nuke.** A live `/clear` keeps the same
> process in the same directory, which immediately re-creates the project's data.
> You must close the session. (If the app is hard-killed first, the nuke runs on
> the next launch in this project, preserving that new session.)

## What gets deleted (scope: current session)

| Item | Path |
|------|------|
| Transcript | `~/.claude/projects/<proj>/<id>.jsonl` (+ `.jsonl.meta`) |
| Session subdir | `~/.claude/projects/<proj>/<id>/` (subagents, tool-results) |
| Session env | `~/.claude/session-env/<id>` |
| Prompt history | matching `sessionId` lines in `~/.claude/history.jsonl` |
| Project memory | `~/.claude/projects/<proj>/memory/` |

Not touched: other sessions' transcripts, and `sessions/*.json` / `shell-snapshots/`
(keyed by PID/timestamp, not safely mappable to a session).

## What gets deleted (scope: whole project — `/forget:project`)

Session IDs are gathered from the project dir **and** `history.jsonl`, so even
already-`/forget:session`-ed sessions are cleaned up.

| Item | Path |
|------|------|
| All sessions + memory | `~/.claude/projects/<proj>/` (whole dir) |
| Per-session env | `~/.claude/session-env/<id>` (every project session) |
| Per-session file history | `~/.claude/file-history/<id>/` |
| Per-session tasks | `~/.claude/tasks/<id>/` |
| Per-session security state | `~/.claude/security/security_warnings_state_<id>.json` (+ `.lock`) |
| PID→cwd map | `~/.claude/sessions/<pid>.json` (where cwd = this project) |
| Prompt history | `~/.claude/history.jsonl` lines where `project` = this path |
| Project config entry | `~/.claude.json` → `projects["<path>"]` (backed up to `backups/.claude.json.prenuke.*` first) |
| Security audit lines | `~/.claude/security/log.txt` lines mentioning the path |
| Config backups | the project entry stripped from `~/.claude/backups/*.json.backup.*` |

**Never touched:** your actual source files on disk, and any other project's data.

## Known limitations

- **Hard kill / crash:** if the process is killed outright, no hook runs, so the
  flag survives; the next `/clear` (or close) in that project cleans up the dead
  session.
- **Multiple terminals in the same project at once:** the arm-flag is per-project.
  A `/clear` in a *second* terminal of the same project could trigger the armed
  wipe early. `SessionEnd` is scoped to the exact session to avoid this; `/clear`
  is not fully scopable. Uncommon, but noted.
- **Memory dir:** `/forget:session` removes the whole project memory directory (memory is
  project-level, not per-session). Claude Code recreates it on next use.
- **`~/.claude.json` entry (project nuke):** editing the global config races with
  the live process, so the edit is best-effort and backed up first. The entry may
  be re-created (fresh, without the old `allowedTools`/trust) the next time you open
  the project — which is the intended reset. This is why a project nuke fires on
  **close**, not `/clear`.

## Testing the cleanup safely

The cleanup script supports a dry run — it prints what it *would* delete instead of
deleting:

```bash
echo '{"hook_event_name":"SessionStart","source":"clear","cwd":"'"$PWD"'","session_id":"NEW","transcript_path":"/tmp/NEW.jsonl"}' \
  | FORGET_DRY_RUN=1 bash hooks/scripts/forget-cleanup.sh
```

## Layout

```
claude-forget/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── commands/
│   ├── session.md               # /forget:session
│   ├── project.md               # /forget:project
│   └── cancel.md                # /forget:cancel
└── hooks/
    ├── hooks.json               # SessionStart + SessionEnd
    └── scripts/
        ├── forget-arm.sh        # arm/cancel (session or project)
        ├── forget-arm-project.py# project inventory + flag
        ├── forget-cleanup.sh    # hook entrypoint (thin wrapper)
        ├── forget-cleanup.py    # cleanup engine (both scopes)
        └── forget_common.py     # shared helpers
```
