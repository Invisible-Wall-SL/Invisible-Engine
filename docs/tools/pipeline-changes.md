# Invisible Pipeline Changes

> **Early access.** The page and its tabs exist, but every tab is empty for now.

Invisible Pipeline Changes will list changes to tools, engine, templates, blueprints and agent
definitions, each on its own branch, and merge them only when they are proven safe.

## What it is

A pipeline change is any change that is not a game: tools, engine, templates, blueprints and
Director's runtime-agent definitions. Each one is planned to live on its own branch and merge only
when every pipeline test passes, every current game still builds and looks the same, and someone
allowed to merge approves it.

- **Where it runs:** the launcher itself, at `/pipeline`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it has its own **Pipeline** section. Invisible
  Director never links to it.
- **Access:** the `pipelineChanges` tool. By default the `admin` and `pipelineTester` (Pipeline
  Tester) roles have it. Admins can grant or revoke it per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Pipeline Changes."
- **Merging** is a separate capability, **Merge pipeline changes** (`pipelineMerge`). By default
  only `admin` has it, and it is also set in Admin › Roles. Seeing this tool does not mean you can
  merge.

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`).
2. Open the **Invisible Pipeline Changes** card in the Pipeline section, or go to `/pipeline`.
3. Switch between the three tabs at the top. Click a tab, or focus the tab bar and use the arrow
   keys, Home and End. Each tab shows an empty state and what it will hold:
   - **Changes** — "No pipeline changes yet." Each open pipeline branch will be listed here with its
     status: Testing, Ready to merge or Blocked.
   - **Agents** — "No agent definitions to show yet." Director's runtime-agent definitions will be
     shown and edited here. An edit will create a pipeline change.
   - **History** — "Nothing has been merged yet." Merges, who approved them, and rollbacks will be
     listed here.

There is nothing to click inside the tabs yet.

## What's coming

This is the plan, not working features. Source: `docs/director/SPEC.md` §2.

- **Changes.** Per change: what changed and why, the files changed, and a link to the diff. Two
  checks: every pipeline test, and every current game rebuilt with the branch, tested and compared
  with `main`. Any visible difference blocks the merge until the owner approves it. "Merge into
  main" needs the Merge pipeline changes capability; "Discard branch" closes a change.
- **Agents.** Editing a definition creates a branch. Its check is a short evaluation on a fixed
  sample, shown before and after.
- **History.** Each merge with who approved it, and a "Roll back" action. Every merge can be rolled
  back.

## Known limitations / TODOs

- All three tabs are empty states. The Changes data already exists behind the launcher's
  `/api/pipeline/changes` endpoints (the list, a change's detail with both checks, and diff
  approval); the screens that show it come next. Merges and rollbacks are not wired up yet.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
