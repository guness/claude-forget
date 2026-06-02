---
description: Forget this session — arms a wipe of this session's transcript + the project memory. Confirm with /clear (or by closing the session); you land in a fresh, 0-context session with no trace left.
argument-hint: "[cancel]"
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/forget-arm.sh" session "$ARGUMENTS"`

Relay the script output above to the user, then state these points concisely (do not run any other tools or take any other action):

- Nothing has been deleted yet — `/forget` only **armed** the wipe. (A slash command cannot reset the context window or safely delete the live transcript on its own; this is a verified Claude Code limitation, so the wipe is finished at the moment the session ends.)
- **To confirm and finish:** press **`/clear`**. The instant they do, a hook permanently deletes this session's transcript (so it won't be resumable or appear in `/resume`) and the project's memory — and `/clear` itself drops them into a fresh, zero-context session.
- The wipe also fires automatically if they **close the session** without `/clear`.
- **To back out, the only safe way is `/forget cancel`.** Simply not pressing `/clear` is NOT an abort — closing the session would still trigger the wipe.
