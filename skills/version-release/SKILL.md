---
name: version-release
description: Run repeatable extension version releases for this repository. Use when asked to bump a release version, run version-deploy, package Chrome/Firefox zip assets, create or update a GitHub Release, attach artifacts, and publish release notes.
---

# Version Release

Use this workflow for this repository's release tasks.

## Preconditions

- Confirm the target version (for example `2.0.0`).
- Confirm `gh` is installed and authenticated.
- Use `main` as the release base branch.
- Update local `main` to the latest remote state before running any release step.
- Confirm the working tree is clean before release work. If unrelated changes exist, stop and ask before proceeding.

## Release Steps

1. Switch to `main`.
2. Pull the latest `main` from remote.
3. Run `version-deploy` for Chrome with `<version>`.
4. Run `version-deploy` for Firefox with `<version>`.
5. Verify both `manifest.json` and `manifest-firefox.json` have `version: <version>`.
6. Verify release artifacts were generated in `outputs/`.

Expected artifact names:
- `outputs/text-highlighter-<version>-chrome.zip`
- `outputs/text-highlighter-<version>-firefox.zip`

7. Commit the manifest version bump and only release-related files.
8. Push the release commit to `main`.
9. Prepare release notes in English.
- Summarize user-visible changes first.
- Group items by categories (UI/UX, sync and reliability, architecture/tests).
- Keep notes concise and factual.

10. Create GitHub Release with tag `v<version>`, set title to `v<version>`, target `main`, and attach both zip assets.
11. If the release already exists, edit release notes and re-upload assets with overwrite behavior.
12. Verify release metadata and attached assets after publishing.

## Response Format To User

Report:
- Release URL
- Tag name and target branch
- Attached artifact names and sizes
- Commit hash for manifest bump
- Any caveats (for example, release notes kept only on GitHub and not in repo)
