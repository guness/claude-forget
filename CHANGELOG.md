# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

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

[0.1.0]: https://github.com/guness/claude-forget/releases/tag/v0.1.0
