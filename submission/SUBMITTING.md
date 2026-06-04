# Submitting / distributing `claude-forget`

This repo is **both** a valid standalone plugin and a self-hostable marketplace.

## Prerequisites (one time)

1. Create the GitHub repo `guness/claude-forget` and push this directory.
2. Tag the release so sources that pin `ref: v0.4.0` resolve:
   ```bash
   git tag v0.4.0
   git push origin main --tags
   ```
3. Validate before publishing:
   ```bash
   claude plugin validate .
   ```

## Path A — Self-hosted marketplace (works immediately after push)

Users add your repo as a marketplace and install:

```text
/plugin marketplace add guness/claude-forget
/plugin install forget@claude-forget
```

The manifest lives at `.claude-plugin/marketplace.json` (plugin `source: "./"`).

## Path B — Anthropic community marketplace (PR-based)

The community marketplace is curated via pull request to
**https://github.com/anthropics/claude-plugins-community**.

1. Fork that repo.
2. Add the entry from [`community-marketplace-entry.json`](./community-marketplace-entry.json)
   to the `plugins` array in its `.claude-plugin/marketplace.json`.
   (It uses a `github` source pinned to `v0.4.0`, so the tag above must exist.)
3. From the fork root, validate:
   ```bash
   claude plugin validate .
   ```
4. Open a PR. On merge, users install with:
   ```text
   /plugin marketplace add anthropics/claude-plugins-community
   /plugin install forget@claude-community
   ```

> The **official** Anthropic marketplace (`claude-plugins-official`) is curated by
> Anthropic and not open to direct submission; the in-app `/plugin` → Discover
> submission form routes to the community marketplace.

## Releasing a new version

1. Bump `version` in `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json`
   (and the `ref`/`version` in `community-marketplace-entry.json`).
2. Update `CHANGELOG.md`.
3. Commit, tag `vX.Y.Z`, push tags.
4. For the community listing, open a PR updating the `ref`/`version` in their manifest.
