# claude-forget

A Claude Code plugin that adds **`/forget`** — a deliberate "wipe the slate" for the
current session. It clears your context (via `/clear`) **and** permanently deletes
this session's transcript and the project's memory, so the conversation can't be
resumed, won't appear in `/resume`, and leaves no trace.

## How it works

A slash command cannot reset the context window or restart Claude Code on its own —
only **you** typing `/clear` resets context, and deleting the *live* transcript
mid-session doesn't stick (Claude Code keeps re-writing it). So `/forget` is a small
two-piece system that works *with* those constraints:

```
/forget            → ARMS the wipe for this session (writes a flag; deletes nothing yet)
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
/plugin install claude-forget@claude-forget
```

Or, once listed on Anthropic's community marketplace:

```text
/plugin marketplace add anthropics/claude-plugins-community
/plugin install claude-forget@claude-community
```

Local development / testing (from a clone):

```text
/plugin marketplace add ./claude-forget
/plugin install claude-forget@claude-forget
```

## Usage

```
/forget          Arm the wipe for the current session.
/forget cancel   Back out (the only safe way to abort).
```

After `/forget`, press **`/clear`** to confirm and start fresh.

> ⚠️ Once armed, **closing the session also triggers the wipe.** Not pressing
> `/clear` is *not* an abort — use `/forget cancel`.

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

## Known limitations

- **Hard kill / crash:** if the process is killed outright, no hook runs, so the
  flag survives; the next `/clear` (or close) in that project cleans up the dead
  session.
- **Multiple terminals in the same project at once:** the arm-flag is per-project.
  A `/clear` in a *second* terminal of the same project could trigger the armed
  wipe early. `SessionEnd` is scoped to the exact session to avoid this; `/clear`
  is not fully scopable. Uncommon, but noted.
- **Memory dir:** `/forget` removes the whole project memory directory (memory is
  project-level, not per-session). Claude Code recreates it on next use.

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
├── .claude-plugin/plugin.json
├── commands/forget.md
└── hooks/
    ├── hooks.json
    └── scripts/
        ├── forget-arm.sh        # /forget → arm or cancel
        └── forget-cleanup.sh    # SessionStart/SessionEnd → wipe if armed
```
