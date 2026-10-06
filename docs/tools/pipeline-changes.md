# Invisible Pipeline Changes

> **Early access.** The **Changes** and **History** tabs work: every open change, its two checks,
> the changed screens and their approval, merging a Ready change, and rolling a merge back.
> **Agents** is still empty, and **Discard branch** is not on the page yet.

Invisible Pipeline Changes lists every change to tools, engine, templates, blueprints and agent
definitions, each on its own branch, shows whether it is proven safe, and lets the people allowed
to merge approve a screen that changed on purpose, merge the change into main, and roll a merge
back.

## What it is

A pipeline change is any change that is not a game: tools, engine, templates, blueprints and
Director's runtime-agent definitions. Each one is a pull request into `main` of the engine
repository. It merges only when every pipeline test passes, every current game still builds and
looks the same, and someone allowed to merge approves it. GitHub is the record: the page reads the
pull requests and their checks, and a merge is GitHub's own squash merge of the pull request; the
launcher adds only the approval of a changed screen and its record of each merge made from here
(who merged, the approvals that counted, when).

- **Where it runs:** the launcher itself, at `/pipeline`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it has its own **Pipeline** section. Invisible
  Director never links to it.
- **Access:** the `pipelineChanges` tool. By default the `admin` and `pipelineTester` (Pipeline
  Tester) roles have it. Admins can grant or revoke it per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Pipeline Changes."
- **Approving, merging and rolling back** are a separate capability, **Merge pipeline changes**
  (`pipelineMerge`). By default only `admin` has it; it is also set in Admin › Roles. Seeing this
  tool does not mean you can merge: without the capability the page is read-only, and the header
  says so (`<your name> · <role> · read-only` instead of `· can merge`).
- **Needs the GitHub App.** The launcher reads and writes GitHub as an App installed on the engine
  repository (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`). Merging
  and rolling back need more of it than reading did — the permissions, and how a raised one is
  accepted, are in `docs/INFRA.md` "GitHub App (Pipeline Changes)". Until the variables are set,
  the Changes tab shows one sentence naming the missing ones instead of a list. Branch protection
  on `main` stays the real gate: the App is not above it, and the page never asks to bypass it.

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
   then reads "Approved by `<name>` · `<when>`" with the note. When the last screen on the head is
   approved, the launcher posts `success` to the `current-games` status on GitHub naming the
   approvers, and a green banner says so: that status is the one required check, so "harness
   green **or** every difference approved" is what lets the change merge.
   - A new push on the branch voids every approval: the ids embed the commit, so the new head
     starts with none.
   - An approval only counts while its approver still holds Merge pipeline changes and the account
     is active. One that lapsed is shown in amber ("`<name>`'s approval no longer counts"); someone
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
6. The bar at the bottom of a change sums it up: **Still testing · done of total** while checks
   run, **All checks passed** for a Ready change. Under "All checks passed" it says what comes
   next:
   - **Merge into main** (needs Merge pipeline changes), with "Squash-merges head `<sha>` into
     main. You can roll back from History." Click it: a dialog titled "Merge `#<n>` into main" names
     the change, the head it will merge — the 7-character and the full SHA — and the squash
     subject `<title> (#<n>)`, and reminds you that branch protection still applies. **Merge**
     merges it (the button reads "Merging…" meanwhile). The bar then reads "Merged into main as
     `<sha>` by `<your name>` · just now", the byline says the pull request is closed, and the
     change leaves the list (the detail stays until you pick another). The merge is recorded: who
     merged, the approvals that counted (game, screen, approver, note), when, the head and the
     merge commit.
   - A **draft** shows you the button disabled: "Mark the pull request ready for review on GitHub
     first."
   - "**Merge by hand on GitHub after review**: this change edits the harness." (or "… is too large
     to check"): no button, for anyone — the same changes step 5 cannot approve.
   - Without the capability: "Merging needs the “Merge pipeline changes” permission."
   - A server error (or a dropped connection) leaves **Try again** under the bar: "Try again
     resends the same request, so it never merges twice." When the merge did go through, the
     resend answers with it ("Already merged into main as …") rather than making another.

   The merge is checked again on the server, against a fresh read of the pull request, before
   GitHub is asked; a refusal is one red sentence under the bar, and nothing merges. The change
   must still be open, not a draft, Ready ("Still testing: 3 of 5 checks have passed.", or the
   blocked reason), without a conflict, and at the head you confirmed: "The head moved: you looked
   at `abc1234` and the branch is now at `def5678`. Reload the change." — the page re-reads it so
   you can look again. A title carrying a CI-skip directive (`[skip ci]` and its variants) is
   refused too: GitHub reads the whole squash message, title included, and such a merge would skip
   main's own checks and the runtime release. So is a title without a commit scope ("The title has
   no commit scope …"): the squash subject must pass the same rule as every local commit
   (`launcher(pipeline): …`, `docs: …`; `revert: …` passes), so fix the pull request's title on
   GitHub first. If someone else is merging the same change at that moment, the sentence names
   them; reload in a moment. GitHub's own refusal comes back verbatim as
   `GitHub <status>: <its sentence>` — the `main` ruleset not satisfied ("Required status check
   "current-games" is expected."), or a head pushed in the instant between the read and the merge
   ("Head branch was modified. Review and try the merge again."). Nothing is recorded for a
   refusal. While GitHub is still working out whether the change merges cleanly, the sentence says
   to try again in a moment. On GitHub the squash commit is authored by the App's bot user, titled
   `<title> (#<n>)` as GitHub's own merge button would title it, and its message names who merged
   it from here. The record is claimed before GitHub is asked and completed after it answers, so a
   merge interrupted in between (the launcher restarting, the tab closed) is finished into History
   the next time History is opened — only when GitHub shows the App's own bot merged that very
   head; a merge made on GitHub by hand, or by another App, is never recorded here.

7. **History · N** lists every merge made from this page, newest first (the newest 200). Each row
   shows `#<n>` and the merge commit (a link to it on GitHub), the title (a link to the pull
   request), "Merged by `<name>` · `<when>`", and the approvals that counted: "No changed
   screens", or "2 approved screens · by `<names>`" that unfolds to one line per screen,
   `game · screen — approver (“note”)`. A revert is tagged `revert` and says which change it rolls
   back ("Rolls back `#<m>` — `<title>`"); a change that was rolled back says "Rolled back by
   `#<m>` · `<when>`"; one whose revert has not merged yet says "Rollback `#<m>` is open". Before
   the first merge the tab says "Nothing has been merged yet." Merges made on GitHub by hand are
   not listed: the page records only its own. A change whose revert was itself rolled back is live
   again: its row loses "Rolled back by" and offers Roll back once more. The tab reads when you
   first open it and then with every Refresh and the minute tick — first finishing any merge
   interrupted midway (see step 6), then from the launcher's own record, so it shows even while
   GitHub cannot be read; only those and "Rollback `#<m>` is open" are then unknown.
8. **Roll back** (needs Merge pipeline changes) on a History row. A dialog titled "Roll back `#<n>`"
   names the change, the merge it undoes and the branch `revert/<n>-<sha>`, says the revert goes
   through the same checks and approvals and that nothing changes on main until it merges, and
   asks **Why (optional)** (up to 500 characters). **Open revert** opens a revert pull request
   titled `revert: <title>` on that branch, with one commit that puts every file the merge changed
   back to how it was before the merge (the button reads "Opening…" meanwhile). The page switches
   to the Changes tab on it (`?change=<m>`): it is a pipeline change like any other — the same two
   checks, the same approval of any changed screen, merged from its own bar like any other — and
   the reason you gave is its **Why**. Once it merges, its History row carries the `revert` tag
   and the original's says "Rolled back by `#<m>`".
   - A merge rolls back once: a row currently rolled back, or with a revert still open, offers no
     Roll back. When a revert is already open by the time you click (the row was stale), the page
     shows that one instead of opening another. Only a revert this page opened counts as the
     change's rollback: a pull request someone else named or titled like one neither hides the
     button nor marks the change rolled back when it merges.
   - When a file the merge touched has changed again on main since, the revert is refused — "The
     revert does not apply cleanly: 2 files changed on main since the merge (`<paths>`). Revert
     `#<n>` by hand." — and nothing is created, no branch and no pull request: revert it by hand
     on GitHub. The same for a file the merge turned into a folder (or the other way round), a
     merge that is not a squash commit, a repository GitHub cannot list whole, a merge main already
     holds nothing of ("there is nothing to revert"), a revert of the same merge that was already
     merged or closed on GitHub, and a branch of that name that is not the launcher's own revert
     (in both cases the sentence names the branch to delete before trying again).
   - Without the capability, History still shows, with "Rolling back needs the Merge pipeline
     changes capability." and no buttons.

**Agents** shows what it will hold ("No agent definitions to show yet.") and nothing else. Click a
tab, or focus the tab bar and use the arrow keys, Home and End.

## What's coming

This is the plan, not working features. Source: `docs/director/SPEC.md` §2 and
`docs/director/DECISIONS/0007-pipeline-change-mechanics.md`.

- **Discard branch** on a change, for Merge pipeline changes holders: closing it from the page
  (the mockup's second button beside Merge into main). Until then, close the pull request on
  GitHub.
- **Agents.** Editing a runtime-agent definition creates a branch and a pull request labelled
  `agent-definition`; its extra check is a short evaluation on a fixed sample, shown before and
  after.

## Known limitations / TODOs

- Discard branch is not on the page; the Agents tab is empty (Director card 5D).
- Merging and rolling back need the GitHub App's Contents and Pull requests permissions at read &
  write (`docs/INFRA.md` "GitHub App (Pipeline Changes)"); until the installation has accepted
  them, both answer "GitHub 403: Resource not accessible by integration" and nothing changes.
- History lists only merges made from this page (the newest 200); a change merged on GitHub by
  hand is neither listed nor rolled back from here.
- A revert that does not apply cleanly is refused, never resolved here: it is done by hand on
  GitHub, like the revert of a merge that is not a squash commit.
- The screen images are read out of the run's artifact on GitHub, which keeps it for 3 days; after
  that the report still lists the differences but shows no pictures.
- The list, the open change and History refresh every minute, not live.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
