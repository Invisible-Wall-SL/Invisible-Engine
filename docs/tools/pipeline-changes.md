# Invisible Pipeline Changes

> **Early access.** The **Changes** tab works: every open change, its two checks, the changed
> screens and their approval. **Agents** and **History** are still empty; merging and rolling back
> from this page come with them.

Invisible Pipeline Changes lists every change to tools, engine, templates, blueprints and agent
definitions, each on its own branch, shows whether it is proven safe, and lets the people allowed
to merge approve a screen that changed on purpose.

## What it is

A pipeline change is any change that is not a game: tools, engine, templates, blueprints and
Director's runtime-agent definitions. Each one is a pull request into `main` of the engine
repository. It merges only when every pipeline test passes, every current game still builds and
looks the same, and someone allowed to merge approves it. GitHub is the record: the page reads the
pull requests and their checks; the launcher adds only the approval of a changed screen.

- **Where it runs:** the launcher itself, at `/pipeline`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it has its own **Pipeline** section. Invisible
  Director never links to it.
- **Access:** the `pipelineChanges` tool. By default the `admin` and `pipelineTester` (Pipeline
  Tester) roles have it. Admins can grant or revoke it per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Pipeline Changes."
- **Approving and merging** are a separate capability, **Merge pipeline changes**
  (`pipelineMerge`). By default only `admin` has it; it is also set in Admin › Roles. Seeing this
  tool does not mean you can approve: without the capability the page is read-only, and the header
  says so (`<your name> · <role> · read-only` instead of `· can merge`).
- **Needs the GitHub App.** The launcher reads GitHub as an App installed on the engine
  repository (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, see
  `docs/INFRA.md` "GitHub App (Pipeline Changes)"). Until they are set, the Changes tab shows one
  sentence naming the missing variables instead of a list.

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`).
2. Open the **Invisible Pipeline Changes** card in the Pipeline section, or go to `/pipeline`.
3. The **Changes · N** tab lists every open pull request into `main` (Director games never make
   one; Dependabot's updates are listed apart under **Dependabot · N**, folded). Each card shows
   the branch, the title, who opened it and when, and its status:
   - **Testing · done of total** — checks are still running.
   - **Blocked** — a check failed, there is a merge conflict, or a current game looks different and
     nobody approved it. The reason is under the title in red: the failed workflow and job, or
     what `current-games` reported.
   - **Ready to merge** — every check is green and every changed screen is approved.

   Pull requests from forks are not listed; a note says how many were skipped. They are merged by
   hand after review, like any change the page cannot vouch for. The list refreshes itself every
   minute while the tab is visible; **Refresh** in the header refreshes it now.
4. Click a card to open the change. The address gains `?change=<number>`, so the link can be
   shared. The detail shows:
   - the branch, title, status, and a link to the pull request on GitHub (`#<number>`);
   - for a Blocked change, **why** in one sentence at the top: "Merge conflict with main", "Lint:
     lint failed", or what breaks — "Breaks Book of Borut: 2 of 12 screens look different (win,
     bigwin)", "Breaks HotFruits: the build failed";
   - **Why** — the reason the author gave in the pull request (a `Why` heading or `**Why:**` line,
     else its first paragraph), shown as written;
   - **Files · N changed** — each file with `+added −removed`, `new` for a new file, `deleted` for
     a removed one, and `old → new` for a rename; **Show all N files** unfolds the rest past the
     first forty, and a note says when GitHub listed only the first 3000. **View diff** opens the
     pull request's diff on GitHub.
   - **Check 1 · Pipeline tests** — the repository's check runs grouped by workflow (Lint, Checks,
     svelte-check, Python, Secrets, …), each tile `passed / total` jobs and a link to the run; the
     header pill reads "N of M passed", "running · N of M" or "failed". **Jobs** unfolds every job
     with its state and link. The harness's own jobs are not here: they are Check 2.
   - **Check 2 · Current games** — the `current-games` harness on this head. Every game in Game
     Maker is rebuilt with the branch, its tests run, and its key screens are compared with
     `main`. When the report is in, a table lists each game with **Build**, **Game tests** (gates
     passed / run) and **Looks the same** ("Same on 12 screens", "2 of 12 changed", "not
     rendered"); **Show all N** unfolds the rest past the first five. Otherwise one plain sentence
     says where the report stands: not started, still running, nothing to render (the change
     cannot reach a game), the run made no report, the report expired (GitHub keeps it 3 days),
     the report is for another commit or another attempt, or it could not be read.
   - **Changed screens** — under the table, one block per screen that looks different: the game,
     the screen and scenario, the harness's reason, and the three images **before** (main),
     **after** (this change) and **diff**, side by side or one at a time (switch above them; click
     an image to open it full size). When the images are gone (the artifact expired) the block says
     so and keeps the difference listed.
5. **Approve a changed screen** (needs Merge pipeline changes). Under each changed screen,
   **Approve** asks for an optional note and records that the difference is intended. The block
   then reads "Approved by <name> · <when>" with the note. When the last screen on the head is
   approved, the launcher posts `success` to the `current-games` status on GitHub naming the
   approvers, and a green banner says so: that status is the one required check, so "harness
   green **or** every difference approved" is what lets the change merge.
   - A new push on the branch voids every approval: the ids embed the commit, so the new head
     starts with none.
   - An approval only counts while its approver still holds Merge pipeline changes and the account
     is active. One that lapsed is shown in amber ("<name>'s approval no longer counts"); someone
     in standing approves the screen again beside it.
   - A re-run of `current-games` on the same head resets the status GitHub shows. The page then
     says every screen is approved but the status was reset, and offers **Post approval again**.
   - When the approval completes the set but cannot be posted (a render job of the run failed, the
     run rendered nothing), the reason is shown instead and nothing is posted.
   - **No Approve buttons, "Merge by hand after review":** a change that edits the harness itself
     (`.github/workflows/**`, `scripts/current-games/**`, renames included) or has more files than
     GitHub lists cannot be vouched for by its own report, and a change from a fork is never
     listed. A build or test failure, an error row or an aborted run is not a difference an
     approval can clear either; the banner says which game.
6. The bar at the bottom of a change sums it up: **All checks passed** for a Ready change (merging
   from this page is not built yet: a maintainer merges the pull request on GitHub), or **Still
   testing**.

**Agents** and **History** show what they will hold ("No agent definitions to show yet.",
"Nothing has been merged yet.") and nothing else. Click a tab, or focus the tab bar and use the
arrow keys, Home and End.

## What's coming

This is the plan, not working features. Source: `docs/director/SPEC.md` §2 and
`docs/director/DECISIONS/0007-pipeline-change-mechanics.md`.

- **Merge into main** and **Discard branch** on a Ready change, for Merge pipeline changes holders:
  a squash merge pinned to the head the checks ran on, recorded with who merged it.
- **History.** Each merge with who approved it, and **Roll back**, which opens a revert pull
  request that goes through the same checks.
- **Agents.** Editing a runtime-agent definition creates a branch and a pull request labelled
  `agent-definition`; its extra check is a short evaluation on a fixed sample, shown before and
  after.

## Known limitations / TODOs

- Merging, discarding and rolling back are not on the page yet (Director card 5C); the Agents tab
  is empty (card 5D).
- The screen images are read out of the run's artifact on GitHub, which keeps it for 3 days; after
  that the report still lists the differences but shows no pictures.
- The list and the open change refresh every minute, not live.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
