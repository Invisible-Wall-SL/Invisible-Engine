# Invisible Director

> **Early access.** The New game and Mockup breakdown screens work. The Live run screen (steps 2–5
> in detail, region review, the activity feed, messages to the coordinator) is the next card; until
> it lands, a run past the breakdown shows its state and the owner actions only.

Invisible Director makes a new game by re-theming a game that already works. Runtime agents do the
work inside the existing tools, and the run stops at checkpoints for you to review. Agents never
publish and never change the template's math. You publish in Invisible Game Maker.

- **Where it runs:** the launcher itself, at `/director` (a run at `/director/<run id>`). It opens
  full-page behind the launcher's sign-in, never in an iframe. On the launcher home it sits in the
  **Create** section, next to Game Maker and Game Config.
- **Access:** the `director` tool. By default only the `admin` role has it. Admins can grant or
  revoke it per role in **Admin › Roles**, or per user. Creating a game also needs Invisible Game
  Maker, as in Game Maker itself.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Director."
  - A run answers only to the person who created it: anyone else gets "No such run."

## Before you start: mark a template

Director starts every new game from a **template**: a published game an admin has marked for it.

1. Publish the game in [Invisible Game Maker](game-maker.md) first. An unpublished project cannot be
   marked.
2. Open **Admin › Projects**. Each project row has a **Director template** button.
   - Greyed out: the project is not published. Hovering says so.
   - Click it to mark the project. It turns purple and reads **✓ Director template**.
   - Click it again to unmark it. Unmarking is always allowed.

Only admins see Admin › Projects. A template must be a project the person running Director can
open; Director never lists a template they cannot reach. Without a template for a game type, the
New game screen says so under **Template**.

## New game (`/director`)

The same project setup as Game Maker's "Create a game", plus what the agents need.

1. **Project.** Name, key (filled in from the name until you edit it; `a-z`, `0-9`, `_`, `-`, 64
   at most), client (the clients you may create under, as Game Maker lists them) and game type.
   The key must be free: a key that names an existing project is refused with Game Maker's words.
2. **Template.** The published games marked for Director, for the game type you picked. Under the
   pick, the template's **GAME** and **USING** chips (the same as its Game Maker card) and its
   **LOCKED** items: math contract, paytable, bet modes, paylines, feature rules. The agents never
   change these; a mockup that clashes with one is reported, not worked around.
3. **Preset.** The Atlas Maker blueprint id (`sdxl` by default), draft and final render sizes,
   variants per region (1–8) and the RunPod GPU the estimate prices renders at. Named presets are
   not stored yet: these are the run's settings.
4. **Starting point.** Upload design mockups (PNG or JPG, 20 MB each, 12 at most) and tag each with
   the screen it shows: Base game, Hold and Win bonus, Big win, Paytable, … or **Style reference
   only** (palette and mood, never a region). Each card shows the stored file and a tag picker; ×
   removes it. Mockups are stored under the key and client of the game you are about to create,
   so once one is uploaded the key and client lock until you remove them all.
   - **Match the mockups closely / Use them as a starting point** sets the fidelity the art agents
     work to.
   - **These designs belong to us or to the client** is required before the run can be created or
     started whenever there are mockups. Every new upload clears it, so no image is covered by a
     check made before it existed. Once ticked it shows who confirmed.
   - **Notes and style** are optional with mockups and required without: a run with no mockups
     builds a style board from them instead.
5. **Checkpoints.** Where the agents stop and wait for you: **Mockup breakdown** (recommended),
   **After each region batch**, and **Before publishing**, which is always on.
6. **What this run will do** (right): the agents and their models, the template's regions per
   atlas, and the **estimate** — Claude API and RunPod ranges, your reviews, and the total against
   the budget cap a run started now would get (Settings' `DIRECTOR_RUN_BUDGET_USD`). The bar turns
   amber when the high end is over the cap: the run would pause there and ask you. The figures are
   placeholders until the pilot measures real runs, and the panel says so. No RunPod or model call
   is made for an estimate.
7. **Create project & start agents.** Creates the project the way Game Maker does — the template
   copied with "Duplicate · full", the math contract recorded — then starts the run and opens its
   page. Pressing again after a lost connection resends the same request, never a second one
   ("This request is still being created" means the first is still copying; wait a moment). A key
   taken meanwhile says so; so does a missing ownership check.
8. **Your runs** (below the form): every run you created, with its state, spend and a link.

## Mockup breakdown (`/director/<run id>`)

The first checkpoint. The Mockup analyst reads each mockup, and the run waits for you before
anything renders.

- **Header:** the game, its key, the state pill ("Waiting for you · step 1 of 5"), the client,
  template and mockup count, who confirmed ownership; elapsed time, Claude API and RunPod spend
  ("Idle until you confirm" before the first render), spend against the cap; **Pause** and
  **Stop** when the run allows them (Stop asks first).
- **Steps:** the five steps with the current one marked.
- **Banner:** what the run is waiting for. "Nothing renders until you confirm."
- **Images:** one tab per mockup ("Base game · 8 found", "Style reference"). The picture shows the
  numbered dashed boxes the analyst found: amber dotted for one that needs you, red for one that
  clashes with a locked item.
- **Found in …:** every element with its template region(s) and status — **Matched**, **Needs
  you** (no region for it, or a clash the template's facts do not confirm) or **Left out** (a
  confirmed clash, naming the locked item). The pill counts regions matched across all mockups.
- **Needs your call:** the left-out and needs-you elements with the analyst's reason, the font
  gaps ("No matching font in Font Maker yet"), and the template regions no mockup covers, which
  the agents design from your notes and the palette.
- **Fonts to bake:** the bakes the Builder staged. Bake and save each one in Invisible Font Maker
  (**Open Font Maker** opens the project there), then **Mark done**. Marking is refused until a
  font with that folder is in the project's fonts.
- **Crops per region:** what was cut from your mockups for each matched region; the art director
  judges every variant against these.
- **Palette from your mockups:** the swatches the images support; proposed colours the images do
  not support are listed as dropped.
- **Confirm:** **Looks right, start rendering** approves the checkpoint — the one action that lets
  RunPod work begin. **Send my changes** sends the analyst back with your note (the note is
  required for that). A 200 means recorded: the page follows the run's live stream and shows the
  worker's answer, including a refusal when the run had already moved on ("The worker refused your
  last request: …"). Pressing again after a lost connection resends the same request.

Without mockups the checkpoint shows the coordinator's **style board** text with the same two
buttons.

**Other states on this page.** A draft shows **Start agents** (and why a start was refused, such as
a missing ownership check). A paused run shows the reason and **Resume**, with a field to raise the
cap when the budget stopped it (never above what Settings allows). A run waiting at a later
checkpoint shows **Approve** only; the review panels for those are the Live run screen. Stopped,
failed and handed-off runs say so.

**Live updates.** The page subscribes to the run's event stream and refreshes on every event; if the
stream cannot be opened it polls the run every few seconds and says "polling" beside the latest
event.

## How a run works

- **Creating a run creates the game.** The same fields and validation as Game Maker's "Create a
  game" plus the template; the project is copied from the template and the run starts in `draft`.
  The project's math contract is recorded at that moment, so the agents can never move it
  unnoticed.
- **The budget cap is fixed when the run starts**, from Settings' `DIRECTOR_RUN_BUDGET_USD`.
  Changing the setting later never moves a run that has started.
- **Your actions each leave one entry** that the agents' worker reads: start, pause, resume
  (optionally raising the cap), stop, approve or redo a checkpoint, and a message to the
  coordinator. An action the run cannot take right now is refused with the reason, and nothing is
  written. Sending the same action twice (a double click, a retry) records it once. If the run has
  moved on by the time the worker reads an entry, the worker refuses that entry and the page shows
  it.
- **Nothing renders before you confirm the breakdown.**
- **Fonts stay yours to bake** (see "Fonts to bake" above).
- **A run is its owner's.** Someone else with access to the project sees the live stream; the run's
  page and actions answer only to the person who created it.

## Known limitations / TODOs

- **The Live run screen is not built yet** (PLAN 4.3): steps 2–5 show their state and the owner
  actions, not the region galleries, the activity feed or the message box.
- Named presets ("Save as preset") are not stored yet.
- A mockup's tag can be changed on its card; its stored name is the upload id, not the file name
  you uploaded.
- "Skip it" / "Request an FX region" shortcuts for a needs-you element are not actions yet: say it
  in the note and send the breakdown back.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
