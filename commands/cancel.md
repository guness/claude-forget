---
description: Cancel any armed forget — disarms a pending /forget:session or /forget:project so nothing will be deleted.
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/forget-arm.mjs" cancel`

Relay the script output above to the user in one line. There is a single shared
arm-flag, so this disarms whatever was pending (session or project). Do not take
any other action.
