# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [0.2.1] - 2026-06-02

### Fixed
- Hook load failure on Claude Code 2.1.x (`expected record, received undefined`
  at `hooks`): `hooks/hooks.json` now wraps the event map under a top-level
  `"hooks"` key, matching the runtime loader's schema. No behavior change.

## [0.2.0] - 2026-06-02

### Added
- `/forget-project` — nukes **every** Claude-realm reference to the current
  project: the whole `projects/<proj>/` dir (all sessions + memory), per-session
  state (`session-env`, `file-history`, `tasks`, `security_warnings_state_*`) for
  every session id (gathered from the project dir and `history.jsonl`), the
  `sessions/<pid>.json` cwd map, project lines in `history.jsonl`, the
  `~/.claude.json` project entry (backed up first), `security/log.txt` audit lines,
  and the project entry in rotating `~/.claude.json` backups.
- `/forget-project cancel` to abort.
- Project nuke fires on **SessionEnd** (closing the session), with a SessionStart
  crash-recovery path that preserves the new session. It deliberately does **not**
  fire on `/clear` (the live process would re-create the project).

### Changed
- Cleanup logic moved from inline bash into a Python engine (`forget-cleanup.py`,
  `forget_common.py`); `forget-cleanup.sh` is now a thin hook wrapper.
- `forget-arm.sh` now takes a scope argument (`session` | `project`).
- Source files on disk are never touched by either command.

## [0.1.0] - 2026-06-02

### Added
- `/forget` slash command that arms a wipe of the current session.
- `/forget cancel` to back out of an armed wipe.
- SessionStart + SessionEnd hook that, when armed, permanently deletes the
  session transcript (`.jsonl`, `.jsonl.meta`, and the per-session subdir),
  the `session-env` entry, this session's `history.jsonl` lines, and the
  project `memory/` directory.
- Safety guards: never wipes the live session (`compact`, resume-of-armed),
  scopes `SessionEnd` to the exact ending session, and matches the project the
  wipe was armed in.
- `FORGET_DRY_RUN=1` mode on the cleanup script for safe testing.
- Self-hosted `marketplace.json` and community-marketplace submission entry.

[0.2.1]: https://github.com/guness/claude-forget/releases/tag/v0.2.1
[0.2.0]: https://github.com/guness/claude-forget/releases/tag/v0.2.0
[0.1.0]: https://github.com/guness/claude-forget/releases/tag/v0.1.0
