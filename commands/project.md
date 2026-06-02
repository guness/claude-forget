---
description: Nuke this project from the Claude realm — arms deletion of EVERY reference to this project (all sessions, memory, history, per-session state, the ~/.claude.json entry, audit-log lines, and config backups). Close the session to execute. Does NOT touch your source files.
argument-hint: "[cancel]"
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/forget-arm.sh" project "$ARGUMENTS"`

Relay the inventory printed above to the user, then state these points concisely (do not run any other tools or take any other action):

- This is **far** more destructive than `/forget:session`: it removes **every** Claude-realm reference to this project — *all* sessions and memory, prompt history, per-session state, the `~/.claude.json` project entry (trust, allowedTools, MCP), security audit-log lines, and config backups.
- It does **NOT** delete the project's actual source files on disk — only Claude's data about it.
- Nothing is deleted yet — it is **armed**. To execute, the user must **close the session** (Ctrl+D or `/exit`); the nuke runs on `SessionEnd`.
- **`/clear` will NOT complete a project nuke** — the live process re-creates the project as you keep working. Closing the session is required. (If the app is hard-killed before exit, the nuke runs on the next launch in this project.)
- The `~/.claude.json` edit is best-effort (it races with the live process and is backed up first); the entry may be re-created fresh on next launch, which still resets trust/allowedTools.
- **To back out, run `/forget:cancel`.**
