# Invisible Director

> **Early access.** The page exists so you can find it. It does not do anything yet.

Invisible Director will make a new game by re-theming a game that already works. Today the page only
explains the plan.

## What it is

Director is planned to build a new game from a working template game. Runtime agents will do the
work inside the existing tools, and the run will stop at checkpoints for you to review. Agents will
never publish and never change the template's math. You publish in Invisible Game Maker.

- **Where it runs:** the launcher itself, at `/director`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it sits in the **Create** section, next to Game
  Maker and Game Config.
- **Access:** the `director` tool. By default only the `admin` role has it. Admins can grant or
  revoke it per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Director."

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`).
2. Open the **Invisible Director** card in the Create section, or go to `/director`.
3. Read the page. It shows an **early access** tag, a short explanation and three cards for the
   screens that are coming:
   - **New game** — name the project and pick its client, game type and a template game to re-theme.
     Choose an art preset, upload mockups or describe the style, and set the checkpoints.
   - **Mockup breakdown** — the first checkpoint. Each mockup element is mapped to a template
     region, and anything that clashes with the locked math is flagged. Nothing renders until you
     confirm.
   - **Live run** — agents work across Atlas Maker, Symbols, Scene Editor and the other tools. You
     approve or redo each region and can message the coordinator mid-run.

The cards are not buttons. As the page says: "Nothing on this page does anything yet." To make a
game today, use [Invisible Game Maker](game-maker.md).

## Mark a game as a Director template

Director starts every new game from a **template**: a published game an admin has marked for it.

1. Publish the game in [Invisible Game Maker](game-maker.md) first. An unpublished project cannot be
   marked.
2. Open **Admin › Projects**. Each project row has a **Director template** button.
   - Greyed out: the project is not published. Hovering says so.
   - Click it to mark the project. It turns purple and reads **✓ Director template**.
   - Click it again to unmark it. Unmarking is always allowed.

Only admins see Admin › Projects. A template must be a project the person running Director can
open; Director never lists or copies a template they cannot reach.

## How a run works (the server side exists; the screens come next)

The owner API behind the three screens is built, so these rules already hold. Until the screens
ship, nothing on the page calls it.

- **Creating a run creates the game.** A run takes the same fields as Game Maker's "Create a game"
  (name, key, client, game type) plus the template to re-theme, your notes, the art preset and the
  checkpoints. It creates the project the way Game Maker does — the template is copied with
  "Duplicate · full" — and the run starts in `draft`. The project's math contract is recorded at
  that moment, so the agents can never move it unnoticed.
- **Mockups come first.** You upload mockups and tag them before the run exists, under the key and
  client of the game you are about to create. If there are mockups, the run cannot be created, and
  cannot start, until you have ticked "These designs belong to us or to the client". Every new upload
  clears the tick, so no image is covered by a check made before it existed. The check is copied
  onto the run and shown in the run header. Without mockups, the notes are required: that is the
  style board.
- **The budget cap is fixed when the run is created**, from Settings' `DIRECTOR_RUN_BUDGET_USD`.
  Changing the setting later never moves a run that already exists.
- **Your actions each leave one entry** that the agents' worker reads: start, pause, resume
  (optionally raising the cap, never above what Settings allows), stop, approve or redo a
  checkpoint, and a message to the coordinator. An action the run cannot take right now is refused
  with the reason, and nothing is written. Sending the same action twice (a double click, a retry)
  records it once.
- **Nothing renders before you confirm the breakdown.** Approving the Mockup breakdown checkpoint is
  the one action that lets RunPod work begin. "Redo with my note" sends the analyst back instead.
- **The estimate is a range**, computed from the template's regions, your mockups, the preset and
  the checkpoints — never from a RunPod or model call. Its figures are placeholders until the pilot
  measures real runs; the panel says so.
- **Fonts stay yours to bake.** When the Builder needs a font that Font Maker does not have, it stages
  a request (the source TTF and the exact bake recipe) under the project. You bake and save it in
  Invisible Font Maker, then mark the request done. Marking is refused until a font with that
  folder is in the project's fonts.
- **A run is its owner's.** Someone else with access to the project sees the live run stream, but
  the run's summary and actions answer only to the person who created it.

## What's coming

This is the plan, not working features. Source: `docs/director/SPEC.md` §1.

- **New game screen.** The same project fields as Game Maker, a template (an existing project of the
  chosen game type), an art preset, mockups and/or a style description, and the checkpoints. The
  template's math, reel strips and feature rules are locked. You must confirm the mockups belong to
  us or to the client before a run can start.
- **Mockup breakdown.** Shows what was found in each mockup, which template region it maps to, and
  what clashes with the locked math. Nothing goes to RunPod until you confirm.
- **Live run.** Progress by step and by region group, a review panel to approve or redo each region,
  an activity feed, and a message box to the coordinator. "Play draft" opens the authoring build,
  never a publish.

## Known limitations / TODOs

- The page is an explanation only: no form, no runs, no agents. The template flag above, the
  server-side tool adapters and the owner API (runs, actions, estimate, font requests) exist;
  nothing in the UI calls them yet.
- Named presets ("Save as preset") are not stored yet: a run takes its preset fields directly, with
  the built-in `sdxl` blueprint as the default.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
