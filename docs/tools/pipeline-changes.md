# Invisible Pipeline Changes

> **Early access.** The **Changes**, **Agents** and **History** tabs work: every open change, its
> two checks, the changed screens and their approval, merging a Ready change, rolling a merge back,
> and Director's runtime-agent definitions with an editor that checks the text as you type and
> submits an edit as a change with its own evaluation. **Discard branch** is not on the page yet.

Invisible Pipeline Changes lists every change to tools, engine, templates, blueprints and agent
definitions, each on its own branch, shows whether it is proven safe, and lets the people allowed
to merge approve a screen that changed on purpose, merge the change into main, roll a merge back,
and edit a Director runtime-agent definition as a change of its own.

## What it is

A pipeline change is any change that is not a game: tools, engine, templates, blueprints and
Director's runtime-agent definitions. Each one is a pull request into `main` of the engine
repository. It merges only when every pipeline test passes, every current game still builds and
looks the same, and someone allowed to merge approves it. GitHub is the record: the page reads the
pull requests and their checks, and a merge is GitHub's own squash merge of the pull request; the
launcher adds only the approval of a changed screen, the opening of an agent-definition change, and
its record of each merge made from here (who merged, the approvals that counted, when).

- **Where it runs:** the launcher itself, at `/pipeline`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it has its own **Pipeline** section. Invisible
  Director never links to it.
- **Access:** the `pipelineChanges` tool. By default the `admin` and `pipelineTester` (Pipeline
  Tester) roles have it. Admins can grant or revoke it per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Pipeline Changes."
- **Approving, editing an agent definition, merging and rolling back** are a separate
  capability, **Merge pipeline changes** (`pipelineMerge`). By default only `admin` has it; it is
  also set in Admin › Roles. Seeing this tool does not mean you can approve, edit or merge: without
  the capability the page is read-only, and the header says so (`<your name> · <role> · read-only`
  instead of `· can merge`).
- **Needs the GitHub App.** The launcher reads and writes GitHub as an App installed on the engine
  repository (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`). Merging,
  rolling back and opening an agent-definition change need more of it than reading did — the
  permissions, and how a raised one is accepted, are in `docs/INFRA.md` "GitHub App (Pipeline
  Changes)". Until the variables are set, the Changes and Agents tabs show one sentence naming the
  missing ones instead of a list. The App is the author of every branch and pull request the page
  opens; you are named in the pull request's body. Branch protection on `main` stays the real gate:
  the App is not above it, and the page never asks to bypass it.
- **The evaluation spends real money.** An agent-definition change is scored by a GitHub Actions
  workflow that calls the model with the `ANTHROPIC_API_KEY` Actions secret the owner adds
  (`docs/INFRA.md` "Agent eval"), up to $20 per run, and every push to the branch runs it again.
  Until the secret is there every evaluation fails, naming it.

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`).
2. Open the **Invisible Pipeline Changes** card in the Pipeline section, or go to `/pipeline`.
3. The **Changes · N** tab lists every open pull request into `main` (Director games never make
   one; Dependabot's updates are listed apart under **Dependabot · N**, folded). Each card shows
   the branch, the title, who opened it and when, a `draft` tag on a draft pull request, an
   `agent definition` tag on a change that carries the `agent-definition` label (one opened from
   the Agents tab, step 9), and its status:
   - **Testing · done of total** — checks are still running. On an agent-definition change the
     evaluation counts as one more check.
   - **Blocked** — a check failed, there is a merge conflict, the evaluation of an
     agent-definition change failed, or a current game looks different and nobody approved it.
     The reason is under the title in red: the failed workflow and job, `agent-eval: …`, or what
     `current-games` reported.
   - **Ready to merge** — every check is green and every changed screen is approved.

   Pull requests from forks are not listed; a note says how many were skipped. They are merged by
   hand after review, like any change the page cannot vouch for. The list refreshes itself every
   minute while the tab is visible; **Refresh** in the header refreshes it now.

4. Click a card to open the change. The address gains `?change=<number>`, so the link can be
   shared. The detail shows:
   - the branch, title, status, and a link to the pull request on GitHub (`#<number>`);
   - for a Blocked change, **why** in one sentence at the top: "Merge conflict with main", "Lint:
     lint failed", `agent-eval: …` followed by what the evaluation reported, or what breaks —
     "Breaks Book of Borut: 2 of 12 screens look different (win, bigwin)", "Breaks HotFruits: the
     build failed";
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
   - **Agent evaluation** — only on a change with the `agent definition` tag, between Check 1 and
     Check 2. The `agent-eval` workflow runs the edited definition and `main`'s version of it on
     the agent's reference set and scores each against the expected result. It runs on `main`'s
     code, for a pull request from a branch of this repository that carries the `agent-definition`
     label and edits exactly one agent definition; a definition the worker's loader refuses fails
     before any model call; every push to the branch runs it again and replaces the run in
     progress. The pill in the header says where it stands:
     - `before 72% → after 80%` once both ran: green when the score held or rose, amber when it
       fell; `new · after 80%` for an agent `main` does not have yet.
     - `no eval set` — the agent has no reference set: "This agent has no reference set yet, so
       there was nothing to compare and nothing was spent." This passes.
     - `invalid` — the edited definition fails the loader (nothing was spent). `capped` — the
       run hit the $20 cap. `failed` — the run failed for another reason, or the `agent-eval`
       status on GitHub is a failure (the secret is missing, or the change does not edit exactly
       one definition). All three block the merge.
     - `running`, `not started` (no `agent-eval` status on this head yet), or the state of a
       report the page cannot show: `missing`, `expired`, `stale`, `unreadable`.

     A blocking evaluation puts its reason in a red callout with **Details ↗**; the same text is
     the change's Blocked sentence, `agent-eval: …`. A labelled change that does not edit exactly
     one definition is blocked too: "This change carries the agent-definition label but does not
     edit exactly one agent definition (N files): remove the label or split the change." Without a
     report, one sentence says why — "agent-eval has not reported on this head.", "agent-eval is
     still running on this head.", "The run made no report; see its log.", "The report expired. A
     new push makes a new one.", "The report is for <commit>, not this head." — with **View the
     run ↗** and **agent-eval status ↗** beside it.

     With a report: its one-line summary, the same line the GitHub status carries (for example
     "mockup-analyst: 72% → 80% on N elements · $3.20 of $20.00"); the errors the run recorded,
     if any; for a scored run, a table **Before (main)** / **After (this change)**, each column
     headed by that side's model and effort, with the rows **Score**, **Status agreement**,
     **Region agreement**, **Extra elements**, **Calls** and **Cost** (a side that did not run
     reads "—"); then **Reference set** (`mockups · 2 images · N elements`, or "No reference
     set") and **Spent** (`$3.20 of $20.00`), with `capped` in red and "The run stopped at the
     cap; the most it can spend is $20.00." when it was. **Elements · N of M changed** lists every
     expected element with its image, the **Expected** status and regions, and each side's answer
     under **Before** and **After**: green when status and regions match, amber when the status
     matches but the regions only partly (`regions 50%`), red when the status differs or the
     element was `not found`. **Show changed only** starts ticked when anything changed and clear
     when nothing did; ticked with nothing changed, the list reads "Both definitions answered
     every element the same way." **Show all N** unfolds the rest past the first twenty.

     The reference set today is `mockups`: the mockups we own in `docs/director/eval/mockups/`,
     with the expected breakdown of each (the style reference carries no elements and is left
     out). Only `mockup-analyst` has one; every other agent gets `no eval set`. A side's **Score**
     is the mean over the expected elements of half a point for the status the element ended on
     and half for how much of its region set it named; elements are matched by where their boxes
     are, not by their names, and an expected element nothing matched scores nothing.

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

9. The **Agents** tab lists Director's runtime agents as `main` holds them, one card per
   definition in `services/director-worker/agents/`. A card shows the agent's name, its model, its
   effort (`medium effort`, or `thinking budget` for a model steered that way) and `N tools`, and
   when the file last changed and by whom ("Changed 2 h ago by Ana", "Changed on 2026-08-01 by
   Ana", or "no change recorded"). Tags: `N open changes` when an open agent-definition change
   edits it, `invalid` when the file on `main` does not load (its model, effort and tools are then
   not shown). Under the list, "Read from main at <commit>" names the commit that was read. The
   tab reads nothing until you first open it, then refreshes with the rest every minute while it
   is visible.
10. Click a card to open the agent. The address gains `?agent=<name>`, so the link can be shared
    (it opens on the Agents tab). The detail shows:

- the file path, the name, pills for the model, the effort and the tool count, the role line,
  and **Last change** — the commit (`<sha> ↗`), its message, its author and when — or "No
  change recorded.";
- **Open changes · N** — every open agent-definition change that edits this file, each with
  its branch, title, `#<number> ↗`, status pill, a `draft` tag when it is one, and **Open
  change**, which shows it in the Changes tab; else "No open change edits this definition.";
- **Definition** — the file in a text editor (**Definition text**), and beside it
  **Validation**, re-checked as you type: `Valid` with a preview of what the worker would load
  (Name, Model, Effort, Tools, Role, Inputs, Outputs, and Prompt as `N characters`), or
  `N errors` and the list. "Unchanged from main" shows while the text is what `main` has.
- When `main`'s own file does not load, a red "The definition on main does not load." with the
  loader's errors sits at the top.

Without Merge pipeline changes the editor is read-only, the line "Editing needs the Merge
pipeline changes capability." says so, and there is no **Why** field or submit button: you can
read the definition, the validation preview and the open changes, and open those changes.

11. **Edit a definition and submit it as a change** (needs Merge pipeline changes). Change the text
    until Validation reads `Valid`, write one line in **Why** ("One line: why the definition
    changes", at most 120 characters, counted as `N/120`; the hint under it reads "This becomes the
    pull request title." or what is wrong: "Say in one line why the definition changes.", "The
    reason is one line."), and click **Submit as a pipeline change**. The button stays off, with
    the reason beside it, while the text is unchanged ("Change the definition to submit it."),
    invalid ("Fix the validation errors first."), already open as a change ("This text is already
    open as a change."), or older than `main` ("Reload first: main has a newer version of this
    definition.").

- **Valid** means the worker itself would load the file: YAML frontmatter between `---` lines
  holding only `key: value` lines and `key:` lists of `  - item`; the keys `name`, `model`,
  `effort` (optional), `role`, `tools`, `inputs`, `outputs` and no other, none empty; `name`
  lower-case kebab and equal to the file name; a `model` the worker runs and prices; `effort`
  one of `low`, `medium`, `high`, `xhigh`, `max`; a non-empty `tools` list of known tools, none
  twice; and a system prompt (the body after the frontmatter) that is not empty. Each error
  names its line or key in the loader's own words — `model: x is not in pricing.json`,
  `tools: x is not a known tool`, `line 4: expected "key: value", "key:" or "  - item"`.
- **Adapter tools are fixed.** The launcher's registry decides which adapter operations are
  served to which agent, and the definition must name exactly those: "tools: <op> is served to
  <name> (the launcher's adapter allow-list); dropping it is a launcher change, not a definition
  change", "tools: <op> is not served to <name> (the launcher's adapter allow-list); adding it
  is a launcher change, not a definition change". Adding or dropping an adapter operation is a
  launcher change, opened like any other pipeline change, not something this tab can submit.
- A dialog confirms what will happen: "Open a pipeline change for <name>?" — a branch
  `agents/<name>-…` gets one commit that changes `services/director-worker/agents/<name>.md`,
  a pull request titled `agents: <name> — <why>` is opened, its evaluation runs the edited and
  the current definition on the reference set and spends up to $20, and it merges only after
  every check passes and someone allowed to merge approves it. **Open the change** goes ahead.
- What the submit does: through the launcher's GitHub App, a branch `agents/<name>-<short>` off
  `main`'s current commit, **one** commit that changes that one file and nothing else, and a
  pull request labelled `agent-definition` with your **Why** in its title and your name in its
  body. It never pushes to `main`, never adds a second commit and never touches another file.
  Each submit carries a request id, so submitting the same text again after a lost answer finds
  the change it already opened instead of opening a second one.
- What comes back:
  - green "`#<number> ↗` opened on `agents/<name>-<short>`." (or "already open", when a resend
    found it) with **Open change**, which shows it in the Changes tab, where it carries the
    `agent definition` tag. The agent's **Open changes** lists it too.
  - red "The launcher refused this definition:" with the errors: the server checks the same
    rules the panel does, so this happens only when the rules changed under you (a model or
    an adapter allow-list changed on `main` since the page loaded).
  - amber, with **Reload**: "The definition changed on main since it was opened (now <commit>);
    reload it and make the edit again.", "The definition is unchanged from main; nothing to
    submit.", "main moved twice while the change was being made; try again.", "This requestId
    already opened a change with other content; submit again with a new one.", or "This
    requestId's change #N is already closed." for a change closed or merged in the meantime.
  - red "There is no agent definition <name> on main." when the file was removed from `main`
    since it was read; "Editing an agent definition needs the "Merge pipeline changes"
    capability." when yours lapsed; "The launcher could not be reached. Submit again: the same
    request is sent, so a change that was opened is not opened twice." when the request never
    arrived; or GitHub's own sentence (`GitHub <status> …`) when it refused a write.
- **Reload** reads `main` again. "Main still has the version you started from. Your edits are
  kept: submit again." when nothing moved; when `main` moved and you have edits, "Replace your
  edits to <name>?" asks before the editor takes the new text (**Replace**). The minute refresh
  also notices a newer file and shows the amber banner "Main has a newer version of this
  definition (<commit>, <when>). Reload to edit the current version." with **Reload**.
- Your edits live only in the editor: switching to another agent asks "Discard your edits to
  <name>?" ("The text you changed is not saved anywhere, and no change has been opened for
  it.") with **Discard**; leaving the page loses them.
- The change then goes through the same checks as any change, plus the **Agent evaluation**
  (step 4), and merges the same way, from its own bar (step 6) once every check and the
  evaluation are green: an evaluation that failed, was capped, or cannot be read keeps the
  change Blocked, and **Merge into main** refuses it with that reason.

Every tab is live. Click a
tab, or focus the tab bar and use the arrow keys, Home and End.

## What's coming

This is the plan, not working features. Source: `docs/director/SPEC.md` §2 and
`docs/director/DECISIONS/0007-pipeline-change-mechanics.md`.

- **Discard branch** on a change, for Merge pipeline changes holders: closing it from the page
  (the mockup's second button beside Merge into main). Until then, close the pull request on
  GitHub.

## Known limitations / TODOs

- Discard branch is not on the page.
- Merging, rolling back and opening an agent-definition change need the GitHub App's Contents and
  Pull requests permissions at read & write (`docs/INFRA.md` "GitHub App (Pipeline Changes)");
  until the installation has accepted them, each answers "GitHub 403: Resource not accessible by
  integration" and nothing changes.
- History lists only merges made from this page (the newest 200); a change merged on GitHub by
  hand is neither listed nor rolled back from here.
- A revert that does not apply cleanly is refused, never resolved here: it is done by hand on
  GitHub, like the revert of a merge that is not a squash commit.
- The evaluation's reference set covers only `mockup-analyst` (`docs/director/eval/mockups/`). A
  change to any other agent gets `no eval set` and passes that check unscored.
- `agent-eval` is not a check GitHub requires on `main` yet (an open owner question,
  `docs/INFRA.md`): this page reads a failed or capped evaluation as Blocked and **Merge into
  main** refuses it; GitHub itself does not refuse a merge made by hand.
- The evaluation spends real money, up to $20 per run, and every push to the branch runs it again.
  It needs the `ANTHROPIC_API_KEY` Actions secret the owner adds; until then every evaluation
  fails naming it, and every agent-definition change reads Blocked.
- The evaluation report is read from the run's artifact on GitHub, kept 90 days; the screen images
  of Check 2 are kept 3 days. After that the page says the report expired, or lists the
  differences without pictures.
- The list, the open change, the open agent and History refresh every minute, not live.
- The editor keeps your text only on screen: reloading the page loses it, and switching agent or
  replacing it with `main`'s newer version asks first.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
