# Invisible Game Bug Reports

Invisible Game Bug Reports is one project's own bug list: report what is wrong in this game, with
screenshots. Triage sets each bug's priority and status. Its fix brief asks for a fix in this
project alone, never in the engine or a tool.

## What it is

Every project has its own list of game bugs: a wrong win, a broken screen, a missing sound, a
mistranslated line. The page, the rules and the numbering are the same as
[Invisible Pipeline Bug Reports](pipeline-bugs.md). The difference is the scope: a game bug always
belongs to one project, and it is fixed in that project's own content (its game config, scenes,
flow, symbols, win text, sound, text or art), the way Game Maker makes a game. It is never sent to
Invisible Pipeline Changes. **A bug in the engine or a tool is a pipeline bug**, so report it in
Pipeline Bug Reports instead, even if you found it while playing one game.

- **Where it runs:** the launcher itself, at `/game-bugs`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it sits in the **Build** section with the other
  project tools. In the tool bar it is **Game bugs**.
- **Scope:** the **active project**. The top bar shows it as `<client> / <project>`, and the page
  heading reads **Game bugs · `<client> · <project>`**. Switch projects with the project selector on
  the launcher home. A link with `?project=<key>` opens that project's list and makes it your
  active project, as long as you can open it. Otherwise the page opens your active project. The
  list only ever shows that project's game bugs.
- **Access:** the `gameBugs` tool. By default every role has it: `admin`, `developer`, `artist`,
  `animator`, `pipelineTester`, `localizationReviewer` and `audio`. Admins can grant or revoke it
  per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Game Bug Reports."
  - You see a project's game bugs only if you can open the project. Admins see every project's.
- **Triage** (changing a bug's priority or status) needs **Triage bug reports** (`bugTriage`), the
  same capability as in Pipeline Bug Reports. By default `admin`, `developer` and
  `pipelineTester` have it, and it is also set in Admin › Roles. The header shows
  `<your name> · <role> · can triage` or `· can report`.
- **Who can do what on a bug:** anyone with the tool who can open the project can see a bug,
  comment, add screenshots, copy its link and copy its fix brief. The reporter or a triager can
  edit its text. The person who added a screenshot, the reporter or a triager can remove it.
  Priority and status are for triagers only.

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`) and pick the project on the launcher home.
2. Open the **Invisible Game Bug Reports** card in the Build section, or go to `/game-bugs`. The
   page has the filters at the top, the project's bugs on the left and the open bug (or the report
   form) on the right. The list refreshes itself every minute while the tab is visible. Click
   **Refresh** in the header to update it now.

### Report a bug

3. Click **Report a bug**. The form **Report a bug in `<project>`** opens on the right. The bug
   goes into this project's list, and you are recorded as the reporter.
   - **Title** (required, up to 200 characters), for example "The free spins counter shows 0
     after the third spin".
   - **Part of the game** (required): Gameplay and flow · Wins, paytable and math · Bonus and free
     spins · Art and animation · Buttons, menus and HUD · Text and translations · Sound · Loading
     and speed · Something else.
   - **Priority** (optional): **Let triage decide**, or Critical, High, Medium or Low.
   - **Where it happened** (optional): the game's address (`http://` or `https://`), shown on the
     bug as a link.
   - **Description** (up to 20,000 characters): what happened in the game, on which screen, bet
     and mode (base game, free spins, bonus), what you expected, and the steps to make it happen
     again.
   - **Screenshots** (`N of 10`): drop images on the box, paste one with Ctrl+V anywhere on the
     page, or click **choose files**. You can add PNG, JPEG or WebP images, up to 10 MB each and
     10 per bug. A file that does not fit is left out, with the reason.
4. Click **Report bug**. The new bug opens with "BUG-`<n>` is reported. Thank you." If a screenshot
   is refused, the bug is still reported and the notice names the file to add again. **Cancel**
   closes the form.

A link can open the form already filled in:
`/game-bugs?project=<key>&new=1&for=<part>&page=<address>`, where `<part>` is one of `gameplay`,
`wins`, `features`, `art`, `ui`, `text`, `sound`, `loading` or `other`.

### Find a bug

5. The list opens on the bugs still to do (**Open** and **Working on**), newest first. The filters
   work as in [Pipeline Bug Reports](pipeline-bugs.md#find-a-bug), without Project and without
   Sent:
   - **Status chips** with counts, and **Priority chips** including **No priority**.
   - **Search** ("Search title, description, BUG-12, #1234…").
   - **Every part of the game**, **Anyone** (the reporter), the sort (**Newest first**,
     **Recently updated**, **Highest priority first**), **Reported by me** and **Reset filters**.

   The address keeps the project, the filters and the open bug, so a filtered view or a bug is a
   link you can share.

6. Each card shows `BUG-<n>`, its priority and status, the title, the part of the game, the
   reporter, when it was reported and how many screenshots it has. Every bug in both bug tools
   takes the next number from one shared count, so a project's list skips numbers. With nothing
   reported the list says "No bugs reported in this game yet."

### Work on a bug

7. Click a card to open the bug. The address gains `&bug=<n>`. The detail shows the same things as
   a pipeline bug: the status, priority, reporter, **Part of the game**, **Game**, **Where**,
   **Status set**, the description, and these controls:
   - **Copy link** copies `/game-bugs?project=<key>&bug=<n>`, so the link opens the right project.
   - **Edit** (the reporter or a triager): title, part of the game, where it happened and the
     description. A game bug cannot be moved to another project. If someone else saved first, Save
     is refused with "Someone else edited this bug since you opened it. …". Click **Reload**, then
     **Cancel** and **Edit** again.
8. **Triage** (needs the capability): **Priority** and **Status** (Open, Working on, Resolved,
   Won't fix). There is no **Send to Pipeline Changes** button. Instead the card reads: "A game bug
   is fixed in this project's own content, not through Pipeline Changes. The fix brief asks for
   exactly that; if the cause turns out to be in the engine or a tool, report it as a pipeline
   bug."
9. **Copy fix brief** copies the bug as text to paste into a Claude Code session or an issue. It
   reads:

   ```text
   Fix BUG-12 in the game <project>: <title>

   This is a problem in one game, the project <project>. Fix it in that project's own content —
   its game config, scenes, flow, symbols, win text, sound, text or art — the way Game Maker makes
   a game, and check it in the game. Do not change the engine, a tool, a template or another
   project: if the cause is there, stop and report it as a pipeline bug instead.

   Priority: High
   Part of the game: Bonus and free spins
   Where: <game address>           (only when given)
   Reported by <name> on 2026-10-26

   <description>

   Screenshots and discussion: <launcher>/game-bugs?project=<project>&bug=12 (1 screenshot)
   ```

10. **Screenshots**, **Activity** and comments work as in Pipeline Bug Reports: click a thumbnail
    to see it full size, and remove one if you added it, reported the bug or triage. Pasting an
    image anywhere on the page while a bug is open uploads it to that bug straight away. Comments
    can be up to 5,000 characters.

A game bug is not fixed with a pull request, so it has no **Pull requests** card. If a pull
request into the engine repository does name a game bug's `BUG-<n>`, the card appears and the
status moves the same way a pipeline bug's does.

## Known limitations / TODOs

- A game bug cannot be turned into a pipeline bug, or moved to another project. Report it again in
  the right list.
- No tool opens the report form for you yet. The `?new=1&for=…&page=…` link works, but you open
  the page yourself.
- Nobody is notified when a bug is reported or changes. Open the list to check.
- A bug cannot be deleted. Mark a duplicate or a non-bug **Won't fix**. Comments cannot be edited
  or deleted.
- When an admin purges a project, its game bugs and their screenshots are deleted with it.
