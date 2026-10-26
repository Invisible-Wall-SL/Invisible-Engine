# Invisible Pipeline Bug Reports

Invisible Pipeline Bug Reports is where you report something broken in a tool, the engine or the
launcher, with screenshots. People who triage set its priority and status and send it to
Invisible Pipeline Changes to be fixed. A pull request that names the bug moves it along by itself.

## What it is

One shared list of pipeline bugs. Each bug gets a number, `BUG-<n>`, and a page with its
screenshots, triage, linked pull requests and activity. A bug in one game (a wrong win, a broken
screen in that game) does not belong here. Report it in that project's
[Invisible Game Bug Reports](game-bugs.md), which runs on the same page and the same rules.
Pipeline bugs and game bugs share one numbering, so the numbers in this list skip the ones game
bugs took.

- **Where it runs:** the launcher itself, at `/bugs`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it sits in the **Pipeline** section beside
  Invisible Pipeline Changes. In the tool bar it is **Pipeline bugs**.
- **Access:** the `pipelineBugs` tool. By default every role has it: `admin`, `developer`,
  `artist`, `animator`, `pipelineTester`, `localizationReviewer` and `audio`. Admins can grant or
  revoke it per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Pipeline Bug Reports."
- **Triage** (changing a bug's priority or status, and sending it to Pipeline Changes or taking it
  back) needs a separate capability, **Triage bug reports** (`bugTriage`). By default `admin`,
  `developer` and `pipelineTester` have it, and it is also set in Admin › Roles. The same
  capability covers Invisible Game Bug Reports. The page header shows which one you are:
  `<your name> · <role> · can triage` or `· can report`.
- **Who can do what on a bug:**
  - See it, comment, add a screenshot, copy its link and its fix brief: anyone with the tool who
    can see the bug.
  - Edit its text: the person who reported it, or a triager.
  - Remove a screenshot: the person who added it, the reporter, or a triager.
  - Priority, status, Send to Pipeline Changes and Take back: triagers only.
- **Which bugs you see:** a bug that names no project is visible to everyone with the tool. A bug
  that names a project is only visible to people who can open that project. Admins see every bug.
  A link to a bug you cannot see reads "There is no BUG-`<n>`.", which does not tell you whether
  it exists.
- **Linked pull requests need the GitHub App**, the same one Invisible Pipeline Changes uses
  (`docs/INFRA.md` "GitHub App (Pipeline Changes)"). Until it is configured, a line above the list
  says "Linked pull requests are not read: the GitHub App is not configured (…)." Everything else
  works without it.

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`).
2. Open the **Invisible Pipeline Bug Reports** card in the Pipeline section, or go to `/bugs`. The
   page has the filters at the top, the list of bugs on the left and the open bug (or the report
   form) on the right. The list refreshes itself every minute while the tab is visible. Click
   **Refresh** in the header to update it now.

### Report a bug

3. Click **Report a bug**. The form **Report a pipeline bug** opens on the right. You are recorded
   as the reporter, by your account name (or the first part of your email if you have no name).
   - **Title** (required, up to 200 characters), for example "The Rigger freezes when I delete a
     bone".
   - **Tool or area** (required): every tool in the launcher by name, then **Game runtime
     (engine)**, **Launcher / portal** and **Something else**.
   - **Project** (optional): **Not about one project**, or one of the projects you can open. If you
     name a project, people who cannot open it will not see the bug.
   - **Priority** (optional): **Let triage decide**, or Critical, High, Medium or Low.
   - **Where it happened** (optional): the page address, `http://` or `https://` only. It is shown
     on the bug as a link.
   - **Description** (up to 20,000 characters): what happened, what you expected, and the steps to
     make it happen again. The placeholder text suggests this layout.
   - **Screenshots** (`N of 10`): drop images on the box, paste one with Ctrl+V anywhere on the
     page, or click **choose files**. You can add PNG, JPEG or WebP images, up to 10 MB each and
     10 per bug. A file that does not fit is left out, with the reason: "Some files were left
     out: only PNG, JPEG or WebP images up to 10 MB; room for N more." Each thumbnail shows its
     size and a **Remove** button.
4. Click **Report bug**. The button is enabled once the bug has a title and an area. It reads
   "Reporting…" and then "Uploading screenshot 1 of N…". The new bug then opens with "BUG-`<n>` is
   reported. Thank you." The report is saved before the screenshots upload. If an image is
   refused, the bug still exists and the notice names the file and the reason ("…but not every
   screenshot uploaded: …. Add them again below."). **Cancel** closes the form without reporting
   anything.

A link can open the form already filled in: `/bugs?new=1&for=<tool id>&page=<address>` fills in
**Tool or area** and **Where it happened**. An unknown tool id leaves the area blank.

### Find a bug

5. The list opens on the bugs that are still to do (**Open** and **Working on**), newest first, and
   says "Showing N of M bugs." The filters:
   - **Status chips**: Open, Working on, Resolved and Won't fix. Each chip shows how many of all
     your visible bugs have that status. Click a chip to turn it on or off. With no chip on, every
     status shows.
   - **Priority chips**: Critical, High, Medium, Low and **No priority**. With no chip on, every
     priority shows.
   - **Search** ("Search title, description, BUG-12, #1234…"): every word you type must appear in
     the bug's reference, title, description, area, project, reporter, or a linked pull request
     (`#<number> <title>`). Case does not matter. The match is on part of the text, so `BUG-1`
     also finds BUG-10 to BUG-19.
   - **Every tool and area**: lists only the areas that have bugs.
   - **Every project**: lists the projects named on bugs you can see.
   - **Anyone**: filter by reporter.
   - **Sent or not** / **In Pipeline Changes** / **Not sent**.
   - Sort: **Newest first**, **Recently updated** or **Highest priority first**.
   - **Reported by me**.
   - **Reset filters** appears as soon as anything differs from the defaults.

   The filters are kept in the address (`?status=…&priority=…&q=…&area=…&project=…&reporter=…`
   `&sent=…&mine=1&sort=…`, with `status=all` for every status), and so is the open bug
   (`&bug=<n>`). Copy the address to share a filtered view.

6. Each card shows `BUG-<n>`, its priority (**Not set** when there is none) and status, the title,
   the area and project, the reporter (with "(you)" on yours), when it was reported, how many
   screenshots it has, an `in Pipeline Changes` tag once it has been sent, and a `#<number> <state>`
   tag for each linked pull request. With nothing reported the list says "No bugs reported yet."
   When the filters hide everything it says "No bug matches these filters."

### Work on a bug

7. Click a card to open the bug. The address gains `?bug=<n>`. At the top: `BUG-<n>`, the title,
   the status, `Priority · <priority>` and the `in Pipeline Changes` tag. Under them: **Reported
   by** (who and when), **Tool or area**, **Project** ("—" when none), **Where** (a link) and
   **Status set** ("by `<name>`", or "by `#<pr>` (automatic)" when a pull request moved it, and
   when). Then the description, or "No description."
   - **Copy link** copies the bug's address (`/bugs?bug=<n>`): "Link to BUG-`<n>` copied."
   - **Edit** (the reporter or a triager) lets you change the title, tool or area, project, where
     it happened and the description. Click **Save** or **Cancel**. If someone else saved the bug
     after you opened it, Save is refused: "Someone else edited this bug since you opened it.
     Reload to see their text, then edit again." Click **Reload**, then **Cancel**, then **Edit**
     again to start from their text. The form that is still open keeps your old text and is
     refused again.
8. **Triage.** **Priority** (Not set, Critical, High, Medium, Low) and **Status** (Open, Working
   on, Resolved, Won't fix). Without the capability both are greyed out and the card says
   "Read-only: needs “Triage bug reports”." A status you set by hand shows your name under
   **Status set**. It stays until a linked pull request changes (see "How a pull request moves a
   bug" below).
9. **Send it to Pipeline Changes.** Under Triage:
   - Not sent yet: "Not sent to Pipeline Changes. …" Triagers see **Send to Pipeline Changes**,
     which puts the bug on the **Bugs** tab of
     [Invisible Pipeline Changes](pipeline-changes.md), where whoever fixes it picks it up. The
     fix is a pipeline change like any other.
   - Sent: "In Pipeline Changes since `<when>`, sent by `<name>`." **Open in Pipeline Changes**
     (shown if you have that tool) opens `/pipeline?tab=bugs`. Triagers also see **Take back**,
     which takes the bug off that tab.
   - **Copy fix brief** is there for everyone. It copies the bug as plain text to paste where the
     fix starts, such as a Claude Code session or an issue: "Fix brief copied: …". The brief
     reads:

     ```text
     Fix BUG-12: <title>

     Priority: High
     Area: <tool or area>
     Project: <project key>          (only when the bug names one)
     Where: <page address>           (only when given)
     Reported by <name> on 2026-10-26

     <description>

     Screenshots and discussion: <launcher>/bugs?bug=12 (2 screenshots)

     Name BUG-12 in the pull request's title or branch (for example `fix/bug-12-…`). …
     ```

10. **Screenshots · N.** Each thumbnail shows who added it and its size. Click one to see it full
    size, and click again or press Escape to close it. **Remove** appears for the person who added
    it, the reporter and triagers. Anyone who can see the bug can add more, up to 10, by dropping
    them on the box, choosing files, or pasting. While a bug is open, pasting an image anywhere on
    the page uploads it to that bug straight away. Adding screenshots is paused while you edit the
    text.
11. **Pull requests · N.** Every pull request that names this bug, with its state (`open`,
    `merged`, `closed`) and a link to it on GitHub. A line here also says when linked pull requests
    cannot be read (the App is not configured, or "Linked pull requests could not be read. …").
12. **Activity.** Everything that happened to the bug, oldest first. Each line names who did it:
    "reported the bug", "edited the title, description", "set the priority to High" or "cleared
    the priority", "marked it Resolved", "sent it to Pipeline Changes" or "took it back from
    Pipeline Changes", "added a screenshot" or "removed a screenshot", "linked `#<pr>` “`<title>`”",
    and comments with their text. Moves made by a pull request are shown under the name **Pipeline
    Changes**, for example "marked it Working on: #1234 opened". Under the list, **Add a comment**
    (up to 5,000 characters) and **Comment**. Anyone who can see the bug can comment.

### How a pull request moves a bug

A pull request is linked to a bug when its title, branch name or description says `BUG-12` (or
`bug-12`, as in a branch `fix/bug-12-rigger-freeze`). `debug-12` does not count. Only pull
requests into `main` of the engine repository, from a branch of that repository, are read; pull
requests from a fork are not.

- A linked pull request is **opened** while the bug is Open: the bug becomes **Working on**.
- One **merges** while the bug is Open or Working on: the bug becomes **Resolved**. A bug that is
  already Resolved or Won't fix stays as it is.
- One **closes without merging**: the bug goes back to **Open**, but only if a pull request (not a
  person) set Working on and no other linked pull request is still open.
- Only a change counts (a new link, or a pull request changing state). A status someone set by
  hand stays until the next time a linked pull request changes.

The launcher reads GitHub when someone loads a bug list (this page, Game Bug Reports or the
Pipeline Changes Bugs tab), at most once a minute. Each move is recorded in the bug's Activity,
and **Status set** names the pull request.

## Known limitations / TODOs

- No tool opens the report form for you yet. The `?new=1&for=…&page=…` link works, but you open
  Bug Reports yourself and fill in the area.
- Nobody is notified when a bug is reported, sent or moved. Open the list to check (it refreshes
  every minute).
- A bug cannot be deleted. Mark a duplicate or a non-bug **Won't fix**. Comments cannot be edited
  or deleted.
- A pipeline bug cannot be turned into a game bug, or a game bug into a pipeline bug. Report it
  again in the right list.
- Automatic status needs the GitHub App, and only runs while someone has a bug list open. GitHub
  is asked for the open pull requests and the hundred most recently updated closed ones, so a pull
  request that closed long before anyone looked may never be linked.
