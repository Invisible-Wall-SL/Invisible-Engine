# Invisible Game Bug Reports

Invisible Game Bug Reports is one project's own bug list: report what is wrong in this game, with
screenshots. Triage sets each bug's priority and status. Its fix brief asks for a fix in this
project alone, never in the engine or a tool. A triager can have Invisible Director repair a bug, or
hand it to the pipeline when the cause is in the engine or a tool.

## What it is

Every project has its own list of game bugs: a wrong win, a broken screen, a missing sound, a
mistranslated line. The page, the rules and the numbering are the same as
[Invisible Pipeline Bug Reports](pipeline-bugs.md). The difference is the scope: a game bug always
belongs to one project, and it is fixed in that project's own content (its game config, scenes,
flow, symbols, win text, sound, text or art), the way Game Maker makes a game. It is never sent to
Invisible Pipeline Changes. **A bug in the engine or a tool is a pipeline bug**: a triager hands it
to the pipeline with **Escalate to pipeline** (see "Repair a bug" below), or you report it in
Pipeline Bug Reports, even if you found it while playing one game.

- **Where it runs:** the launcher itself, at `/game-bugs`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it sits in the **Create** section, with Game
  Maker, Game Config and Director. In the tool bar it is **Game bugs**.
- **Scope:** one card for every game, one list per game. It opens on the **active project**: the
  top bar shows it as `<client> / <project>`, and the **Game** picker under the heading names it.
  Pick another game there to open its list (it becomes your active project too); only the projects
  you can open are offered. A link with `?project=<key>` opens that project's list, as long as you
  can open it; otherwise the page opens your active project. The list only ever shows the chosen
  game's bugs.
- **Access:** the `gameBugs` tool. By default every role has it: `admin`, `developer`, `artist`,
  `animator`, `pipelineTester`, `localizationReviewer` and `audio`. Admins turn it on or off per
  role in **Admin › Roles** (group **Game bug reports**), or per user in **Admin › Users** (block
  **Game bug reports**), apart from Pipeline Bug Reports.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Game Bug Reports."
  - You see a project's game bugs only if you can open the project. Admins see every project's.
- **Triage** (changing a bug's priority or status) needs **Triage game bugs** (`gameBugTriage`),
  its own capability: triaging pipeline bugs does not give it. By default `admin`, `developer` and
  `pipelineTester` have it; admins set it per role in Admin › Roles or per user in Admin › Users,
  beside the card. The header shows `<your name> · <role> · can triage` or `· can report`, and
  without it the triage card reads "Read-only: needs “Triage game bugs”."
- **Who can do what on a bug:** anyone with the tool who can open the project can see a bug,
  comment, add screenshots, copy its link and copy its fix brief. The reporter or a triager can
  edit its text. The person who added a screenshot, the reporter or a triager can remove it.
  Priority and status are for triagers only.

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`).
2. Open the **Invisible Game Bug Reports** card in the Create section, or go to `/game-bugs`, and
   pick the game in the **Game** picker. The page has the filters at the top, that game's bugs on
   the left and the open bug (or the report form) on the right. The list refreshes itself every
   minute while the tab is visible. Click **Refresh** in the header to update it now.

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
   - **Screenshots** (`N of 10`): drop images on the box, paste one with Ctrl+V (in the form, or
     with nothing else selected), or click **choose files**. You can add PNG, JPEG or WebP
     images, up to 10 MB each and 10 per bug. A file that does not fit is left out, with the
     reason.
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
     is refused with "Someone else edited this bug since you opened it. …". **Reload** closes the
     form and shows their version; click **Edit** to start again from it.
8. **Triage** (needs the capability): **Priority** and **Status** (Open, Working on, Resolved,
   Won't fix). There is no **Send to Pipeline Changes** button. Instead the card reads: "A game bug
   is fixed in this project's own content, not through Pipeline Changes. The fix brief asks for
   exactly that; if the cause turns out to be in the engine or a tool, escalate it to the
   pipeline."
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
    image inside the bug, or with nothing selected, uploads it to that bug straight away. Comments
    can be up to 5,000 characters.

### Repair a bug

11. A game bug has a **Repair** card under Triage. It shows what the repair tools did with the bug,
    and the two ways to move it on. Both are for triagers (**Triage game bugs**), and only on a
    bug that is **Open** or **Working on**.
    - **Repair with Director** needs the Director tool too (see [Invisible Director](director.md)),
      and no Director run live on this project. It creates a draft repair run for this bug and
      opens its page. You see the estimate and the cap there, and press **Start** yourself. While a
      run is live on the project the button is not shown. If the server refuses, the card shows its
      words: the bug is closed (Resolved or Won't fix), the project is a Director template, a
      run is already live on the project, or you lack triage.
    - **Escalate to pipeline** needs the Pipeline Bug Reports tool too, and a bug that has not been
      escalated. It opens a small form: **Tool or area**, **Title** and **What is wrong in the
      pipeline**. **File it from BUG-`<n>`** files one pipeline bug in this project, Open and not
      sent to Pipeline Changes, links the two bugs and moves this one to **Working on**. Write the
      text in your own words: the filed bug names this bug and its project, not the reporter's
      text. A bug is escalated once.
12. The card lists the bug's **repair runs** ("Director repair run · running / fixed / needs a
    person / handed to the pipeline / stopped"), each a link to the run. A run answers only to the
    person who started it, so someone else sees "No such run." Beside the status, in the card and
    in the list, a bug can carry one of these labels:
    - **Waiting on pipeline · BUG-`<m>`** while its pipeline bug is Open or Working on. **Open it
      there** opens that bug.
    - **Pipeline fix merged: check the game** when the pipeline bug is Resolved. The game bug is not
      resolved by itself: play the game, then resolve it or repair it again.
    - **Pipeline: won't fix** when the pipeline bug is Won't fix. A triager decides what is next.
    - **Fixed, waiting on publish** after you approved a repair run's fix. The bug stays **Working
      on** until the project's next publish in Game Maker, which resolves it ("Game Maker publish").
13. **Activity** reads the run's work in plain words: "Director run `<id>` started a repair", "…
    fixed it: it ships with the next publish" (with the doctor's summary under it), "… ended the
    repair: needs a person", "… handed it to the pipeline as BUG-`<m>`", and "Game Maker publish
    published the fix". A bug escalated from a game bug shows "Escalated from a game bug" on the
    pipeline side, with **Open it there** for people who have Game Bug Reports.

A game bug is not fixed with a pull request, so it has no **Pull requests** card, and a pull
request that names its `BUG-<n>` does not link it or move its status. If the cause is in the engine
or a tool, escalate it to the pipeline.

## Known limitations / TODOs

- A game bug cannot be moved to another project. Report it again in the right list.
- A game bug is escalated once. A second escalation answers the first.
- A repair run's fix is not published by Director. The bug waits as "Fixed, waiting on publish"; if
  a publish misses it, resolve it by hand.
- The **Report bug** button on every tool's top bar opens Pipeline Bug Reports (a bug in that
  tool), not this list. Open this card to report a game bug.
- Nobody is notified when a bug is reported or changes. Open the list to check.
- A bug cannot be deleted. Mark a duplicate or a non-bug **Won't fix**. Comments cannot be edited
  or deleted.
- When an admin purges a project, its game bugs and their screenshots are deleted with it.
