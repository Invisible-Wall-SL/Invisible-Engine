<!--
  This repo is squash-merged: the PR TITLE becomes the single commit on main.
  → Give the title a scope prefix, e.g.  launcher: add session colour tags
    (allowed scopes: see scripts/check-commit-scope.mjs / .github/CODEOWNERS)
-->

## What & why

<!-- One or two sentences. What changed and the reason. -->

## Area

<!-- Tick the area(s) this touches — matches the commit scope / CODEOWNERS. -->

- [ ] engine / packages / games
- [ ] launcher / editor / admin
- [ ] pipeline tool (atlas-tool / atlas-backend / sheet-tool / test-server)
- [ ] docs / infra / scripts

## Checklist

- [ ] PR title has a scope prefix (it becomes the squashed commit subject)
- [ ] `docs/STATUS.md` updated if this is meaningful work
- [ ] No secrets committed (pre-commit hook enabled: `git config core.hooksPath scripts/git-hooks`)
- [ ] Pushed to **origin** (`Invisible-Wall-SL`), not upstream
