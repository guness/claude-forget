# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [0.4.1] - 2026-06-04

### Fixed
- **Multiple armed sessions are no longer dropped.** Arming `/forget:session` (or
  `/forget:project`) in more than one session previously overwrote a single shared
  flag file, so only the last-armed session was processed and the others survived
  (visible later in `/resume`). Each armed session now gets its own flag under
  `~/.claude/forget-pending/<session-id>.json`, and the cleanup hook iterates **all**
  pending flags on every `SessionStart`/`SessionEnd` — so every armed session is
  tracked and swept independently. `/forget:cancel` disarms all pending flags.

## [0.4.0] - 2026-06-04

### Changed
- **Cross-platform port to Node.** The cleanup engine and arm/cancel logic were
  rewritten from bash + python3 to dependency-free Node (`.mjs`), and hooks now use
  the shell-free **exec form** (`command: "node"`). This removes the `bash` and
  `python3` assumptions, so the plugin works on **macOS, Linux, and Windows** using
  the Node runtime Claude Code already ships. No behavior change — verified against
  the same session + project sandbox tests (dry-run and real-run).
- Files: `hooks/scripts/*.sh|*.py` → `hooks/forget-arm.mjs`, `hooks/forget-cleanup.mjs`,
  `hooks/forget-common.mjs`. Commands now invoke `node` instead of `bash`.

## [0.3.1] - 2026-06-02

### Changed
- Reframed the description around privacy + decluttering `/resume` (prune throwaway
  sessions), and refreshed keywords (`privacy`, `cleanup`, `session`, `resume`,
  `forget`, `history`, `declutter`). Metadata only — no behavior change.

## [0.3.0] - 2026-06-02

### Changed (breaking)
- Plugin renamed `claude-forget` → **`forget`**, so commands are now namespaced as
  **`/forget:session`** and **`/forget:project`** (were `/claude-forget:forget` and
  `/claude-forget:forget-project`). Command files renamed `forget.md`→`session.md`,
  `forget-project.md`→`project.md`. The marketplace stays `claude-forget`; install
  is now `/plugin install forget@claude-forget`.

### Added
- **`/forget:cancel`** — disarms whatever is pending (session or project) via the
  single shared arm-flag. (`/forget:session cancel` / `/forget:project cancel` still
  work too.)

### Migration
- Reinstall: `/plugin marketplace update claude-forget`, then
  `/plugin uninstall claude-forget@claude-forget` and
  `/plugin install forget@claude-forget`. Headless `enabledPlugins` key changes from
  `claude-forget@claude-forget` to `forget@claude-forget`.

## [0.2.2] - 2026-06-02

### Fixed
- `/exit` after arming left a one-line "ghost" session containing only `/exit`:
  the `SessionEnd` hook deleted the transcript, but Claude flushed the `/exit`
  event afterward, recreating it. The flag is now kept through `SessionEnd` and
  the next `SessionStart` sweeps the ghost and clears the flag. For project
  scope, that follow-up sweep is light (transcripts/per-session refs only) and
  does **not** re-scrub global config, so a reopened project keeps its fresh
  `~/.claude.json` entry.

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

[0.4.1]: https://github.com/guness/claude-forget/releases/tag/v0.4.1
[0.4.0]: https://github.com/guness/claude-forget/releases/tag/v0.4.0
[0.3.1]: https://github.com/guness/claude-forget/releases/tag/v0.3.1
[0.3.0]: https://github.com/guness/claude-forget/releases/tag/v0.3.0
[0.2.2]: https://github.com/guness/claude-forget/releases/tag/v0.2.2
[0.2.1]: https://github.com/guness/claude-forget/releases/tag/v0.2.1
[0.2.0]: https://github.com/guness/claude-forget/releases/tag/v0.2.0
[0.1.0]: https://github.com/guness/claude-forget/releases/tag/v0.1.0
