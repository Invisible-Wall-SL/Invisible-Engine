# Invisible Director

Invisible Director makes a new game by re-theming a game that already works. Runtime agents do the
work inside the existing tools, and the run stops at checkpoints for you to review. Agents never
publish and never change the template's math. You publish in Invisible Game Maker.

Three screens: **New game** (`/director`), then the run's page (`/director/<run id>`), which is the
**Mockup breakdown** while the first checkpoint waits and the **Live run** screen from then on.

- **Where it runs:** the launcher itself, at `/director` (a run at `/director/<run id>`). It opens
  full-page behind the launcher's sign-in, never in an iframe. On the launcher home it sits in the
  **Create** section, next to Game Maker and Game Config.
- **Access:** the `director` tool. By default only the `admin` role has it. Admins can grant or
  revoke it per role in **Admin › Roles**, or per user. Creating a game also needs Invisible Game
  Maker, as in Game Maker itself.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Director."
  - A run answers only to the person who created it: anyone else gets "No such run." The same
    rule covers every image the run page shows (variants, crops, exported art).

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
   So is a key that differs from a project's under the same client only by `-` vs `_` (`my_game`
   beside `my-game`): both would store their files in one folder, so the hint asks for another key.
2. **Template.** The published games marked for Director, for the game type you picked. Under the
   pick, the template's **GAME** and **USING** chips (the same as its Game Maker card) and its
   **LOCKED** items: math contract, paytable, bet modes, paylines, feature rules. The agents never
   change these; a mockup that clashes with one is reported, not worked around.
3. **Starting point.** Upload design mockups (PNG or JPG, 20 MB each, 12 at most) and tag each with
   the screen it shows: Base game, Hold and Win bonus, Big win, Paytable, … or **Style reference
   only** (palette and mood, never a region). Each card shows the stored file and a tag picker; ×
   removes it. Mockups are stored under the key and client of the game you are about to create,
   so once one is uploaded the key and client lock until you remove them all. Removing the last
   one deletes that key's stored mockups, and mockups left under a key that never became a game
   are cleared by an admin after 14 days without an upload (Admin › Settings › Invisible Director).
   - **Match the mockups closely / Use them as a starting point** sets the fidelity the art agents
     work to.
   - **These designs belong to us or to the client** is required before the run can be created or
     started whenever there are mockups. Every new upload clears it, so no image is covered by a
     check made before it existed. Once ticked it shows who confirmed.
   - **Notes and style** are optional with mockups and required without: a run with no mockups
     builds a style board from them instead.
4. **Checkpoints.** Where the agents stop and wait for you: **Mockup breakdown** (recommended),
   **Art plan** (recommended: how each region will be made — the Atlas Maker pipelines, sizes and
   variants — and what it costs, before anything renders), **After each region batch**, and
   **Before publishing**, which is always on. The first three start ticked.
5. **What this run will do** (right): the agents and their models, the template's regions per
   atlas, and the **estimate** — Claude API and RunPod ranges, your reviews, and the total against
   the budget cap a run started now would get (Settings' `DIRECTOR_RUN_BUDGET_USD`). The RunPod
   line is priced per recipe chain, at the GPU atlas-tool reports, from the reviewed blueprint
   cards and the GPU seconds measured on past runs. Each template atlas is listed with the chain it
   was priced at ("12 × symbols" · `sdxl 1024 ×3 → birefnet → finish`); hover the chain to see
   whether it is the fallback (the reviewed `fallbackRecipe` in the estimate profiles) or the
   template's own default ("template default v2", see "How a run
   works"). The bar turns amber when the high end is over the cap: the run would pause there and
   ask you. The figures are placeholders until the pilot measures real runs, and the panel says
   so: a card whose GPU seconds are a guess is priced from its own figure at the low end up to
   `pricing.json`'s `seedSecondsPerRender` per image at the high end, the floor the Art plan is
   priced at, so the high end is what the Art plan of those chains will show. Cold start counts
   once per region and step, as the Art plan counts it. No RunPod or model call is made for an
   estimate.
   - **A priced estimate does not promise a priced plan.** A chain step whose card has no GPU
     seconds at all is estimated from the profiles' fallback figure, but the Art plan cannot price
     that step, so the plan cannot be approved and nothing renders (it fails closed) until the
     card has its seconds or the technician picks another pipeline.
   - **An estimate with no price blocks the run.** When the GPU side cannot be priced — the
     blueprint catalogue cannot be read from atlas-tool, atlas-tool reports no GPU
     (`RUNPOD_ENDPOINT_GPU`), `pricing.json` has no price for that GPU, or a chain uses a blueprint
     billed in credits — the total reads **Unknown**, a red line lists why, and **Create project &
     start agents** is disabled. The server refuses to start such a run too.
6. **Create project & start agents.** Creates the project the way Game Maker does — the template
   copied with "Duplicate · full", the math contract recorded — then starts the run and opens its
   page. Pressing again after a lost connection resends the same request, never a second one
   ("This request is still being created" means the first is still copying; wait a moment). A key
   taken meanwhile says so; so does a missing ownership check, or an estimate that has not arrived
   yet ("Wait for the estimate: a run starts only on a priced estimate.").
7. **Your runs** (below the form): every run you created, with its state, spend and a link.

## Mockup breakdown (`/director/<run id>`)

The first checkpoint. The Mockup analyst reads each mockup, and the run waits for you before
anything renders.

- **Header, meters and steps:** the same as on the Live run screen (below). Here the pill reads
  "Waiting for you · step 1 of 5" and the RunPod meter "Idle until you confirm".
- **Banner:** "Waiting for you: check what the agents found in your mockups. Nothing renders until
  you confirm."
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
  font with that folder is in the project's fonts. The card stays on the Live run screen too, so
  a bake staged later is never out of sight.
- **Crops per region:** what was cut from your mockups for each matched region; the art director
  judges every variant against these.
- **Palette from your mockups:** the swatches the images support; proposed colours the images do
  not support are listed as dropped.
- **Confirm:** **Looks right, start rendering** approves the checkpoint. No RunPod work begins
  before it, nor, with the Art plan checkpoint on, before you approve the Art plan (below).
  **Send my changes** sends the analyst back with your note (the note is required for that). A 200
  means recorded: the page follows the run's live stream and shows the worker's answer, including
  a refusal when the run had already moved on ("The worker refused your last request: …").
  Pressing again after a lost connection resends the same request.
- **Latest:** under the banner, the newest row of the run's stream while you are here, with
  "reconnecting" when the stream dropped (the browser reopens it) or "the live stream could not be
  opened; polling every 5 s" when it never opened.

Without mockups the checkpoint shows the coordinator's **style board** text with the same two
buttons. A breakdown the page cannot read still opens the checkpoint, with its text and the two
buttons of the generic checkpoint panel (see below).

Every other state of the run — not started, agents working, a later checkpoint, paused, stopped,
failed, handed off — is the Live run screen.

## Live run (`/director/<run id>`)

The same page once the breakdown is confirmed (or whenever no breakdown is waiting): the Art plan
and each region batch stop for your review, the galleries fill in as the agents render, and the
run ends in your hands. Everything on it is read from the run's event stream, so it is the same
picture on a reload.

- **Header:** the game, its key and the state pill — "Not started", "Agents working · step 3 of 5",
  "Waiting for you · step 3 of 5", "Paused · step 3 of 5", "Stopping", "Stopped", "Failed",
  "Handed off". Under them: client · "from `<template key>`" · the mockup count (and style
  references) · "ownership confirmed by …" · **Open in Game Maker ↗** (once the project exists) ·
  **Play draft ↗** when the project has a game URL. Play draft is the authoring Live link in a new
  tab, never a publish.
- **Meters:** **Elapsed** since the run was created; **Claude API** spend; **RunPod `<GPU>`**
  spend with "· n jobs queued" while renders wait on the GPU ("Idle until you confirm" before the
  first). The label names the GPU renders bill on: the latest render's, else the one atlas-tool
  reports. **Cap** — "$x of $y" with a bar, marked over once the cap is reached. Then
  **Pause** and **Stop**, each shown only when the run allows it. Stop asks first — "Stop this
  run? The agents stop after their current call and every queued render is cancelled. The project
  stays as it is." — and the button to confirm is **Stop the run**.
- **Steps:** five cards — **1 · Mockup breakdown**, **2 · Style pack**, **3 · Regions**,
  **4 · Build**, **5 · Hand-off**. A done step shows ✓; the current one is outlined in amber. The
  line under each is its figures ("3 mockups · 34 of 39 regions matched", "Palette and refs taken
  from your mockups · Art plan ✓" (before that, "Art plan waiting" or "Art plan being revised"),
  "21 of 39 approved" with a progress bar on Regions, "Scene Editor, Symbols SM, Win Text", "You
  publish it in Game Maker") or its state in words first: "Waiting for you · …", "Paused · …",
  "Failed · …", "Stopped · …", and "Not reached · …" on the steps a stopped or failed run never
  got to. A handed-off run shows all five done.
- **Banner:** one line for the run's state, with the one button that matters there.
  - Waiting on the Art plan: "Waiting for you: the Art plan is ready. See how each region will be
    made and what it costs. Nothing renders until you approve." **Review the plan** scrolls to it.
  - Waiting on a region batch: "Waiting for you: 6 regions are ready to review. The agents keep
    working on the rest." **Review 6 now** opens the first region in the review panel.
  - Waiting before publish: "Waiting for you: the draft is built. Play it, then approve to hand it
    off — you publish it in Game Maker." **Review the build**.
  - Waiting at a checkpoint this page has no panel for: "Waiting for you at the … checkpoint."
    **Review now**.
  - Not started: "Not started. Start the agents when the mockups are ready." **Start agents**. A
    draft whose project was never created cannot start; the banner says to create the game again.
  - Agents working: "Agents are working on step 3, Regions." then "n renders queued on RunPod" or
    the latest thing an agent did.
  - Paused at the budget cap: "Paused at the budget cap: $x of $y spent." with a **New cap, $**
    field and **Raise cap and resume** (enabled once a figure is typed; never above what Settings
    allows).
  - Paused for you: "Paused for you." with the worker's reason, and **Resume**.
  - "Stopping. The agents finish their current call and every queued render is cancelled." ·
    "Failed." with the last error · "Stopped. Nothing more happens on this run; the project stays
    as it is." · "Done: the draft is yours. Publish it in Invisible Game Maker when you are happy
    with it." with **Play draft ↗** and **Open in Game Maker ↗**.
  - Under the banner: a red "The worker refused your last request: …" when the run had moved on
    before the worker read your action; a green "Recorded. …" line after each action that was
    taken; a red line when a request failed ("Press the button again: the same request is resent,
    never a second one." after a lost connection).
- **Region groups:** one tab per batch of the coordinator's plan, with its count — "7 of 11 · 2 to
  review", "2 of 2 · done", "4 of 6 · 1 to redo", "9 of 14 · drafting", "0 of 4 · queued",
  "3 of 6 · 1 failed". Regions
  no batch names sit under **Other regions**. The page opens on the first tab with something to
  review.
- **The group card:** the group's name with an **Atlas Maker · `<atlas>`** chip when all its
  regions render on one atlas, and the filters **All · n**, **To review · n** (only while there is
  something to review), **Approved · n**, **Drafting · n** (drafting and queued together), and
  **Redo · n** / **Failed · n** when there are any. One
  tile per region: the thumbnail is the art director's pick, else the first variant, else your
  mockup's crop, else the region's short name; under it the region ("H2 · Coral mask") and a status
  chip — **Queued**, **Drafting** (a render is on RunPod; the tile pulses), **To review**,
  **Approved**, **Redo** (the art director rejected the latest variants; they go back to the
  queue) or **Failed** (the render failed, was cancelled or produced nothing; hover for why). Click
  a tile to open it below.
- **Region review** (under the tiles while a batch waits): "TO REVIEW · 1 of 6" with ‹ › to step
  through the batch, the region's name, then **Your mockup** (the crop) beside **Variant A**,
  **Variant B**, **Variant C**… with **Art director's pick** on the one the art director chose,
  then the **Finished tile** ("Committed") once the region's chain has committed it. Click any
  image for full size (click or Escape closes it). Under them, **Art director:** the verdict and
  its reason, and **QA:** when QA looked at it. **Your note** is optional for approving and needed
  to redo. **Approve these 6 regions** (or **Approve this region**) approves the whole batch —
  "Approved art goes into this project's Atlas Maker sheet." **Redo with my note** sends the batch
  back to the agents with your note. If the batch's renders have not reached the page, the panel
  shows the coordinator's words and offers **Approve the batch** / **Redo with my note** instead.
  When no batch is waiting, clicking a tile opens the same panel without the note and buttons.
- **How this was made** (in the region panel, for a region with a recipe; folded until its tile
  is committed): the recipe revision, "approved", "approved automatically" or "not approved", and
  "edited by you" when you edited it. Then one line per step — kind, pipeline, size × variants, the
  atlas/region it ran on, its settings, status, the card's purpose and licence chip — with the
  image that step left as a thumbnail; click it for full size.
- **Before hand-off** (while the run waits before publishing): "The draft is built", the
  coordinator's summary, **Play draft ↗** (or "No game URL is recorded for this project yet, so
  there is nothing to play."), **Open in Game Maker ↗** and **The agents' link ↗** when the
  checkpoint names one. Your note is optional for approving and needed to send it back.
  **Licence-flagged art in this build** lists every step of the plan's recipes, and every step
  whose art reached the project even if a later plan dropped its region, whose blueprint is
  blocked or conditional for its licence: the worse of the licence it was planned with and its
  card's now (a card no longer reviewed counts as conditional). It is grouped by blueprint
  (blocked first) and names each region and step ("H1 (step 2)"), for you to check before you
  publish; with none, a line says so. **Approve and hand off** waits until the list is read
  ("Reading the licence list…"; if it cannot be read, **Try again**). **Approve and hand off** /
  **Send back with my note**. "Approving ends the run. Director
  never publishes: you do, in Game Maker."
- **Any other checkpoint:** its name and the agents' text, the note, **Approve** / **Send back
  with my note**. This is also the panel for a breakdown the page could not read.
- **Art plan** (in step 2, Style pack): opens by itself once the atlas technician has a recipe —
  the chain of Atlas Maker steps — for every region the coordinator's plan names, in place of the
  region panel: "How each region will be made". Nothing renders on RunPod before you approve it.
  - **The plan:** the recipes grouped by region group, each group with its region count and price.
    Regions with the same chain share one row: the chain (`sdxl 1024 ×3 → birefnet → finish`),
    "11 × H1, H2, H3, H4 and 7 more", the row's price, and a **guess** chip when a card's GPU
    seconds are a guess with nothing measured yet. Under it, one line per step: kind, pipeline,
    size and variants, the card's purpose, and a licence chip when the card's licence is blocked
    or conditional. Beside the title, the plan's GPU projection against what is left of the cap
    ("GPU ~$0.62 · $11.40 left of the cap"), amber when it is more than that: the run will then
    pause for you before the render that crosses it. Every chain is priced again from the current
    cards and the GPU seconds measured so far. It fails closed: a card whose GPU seconds are a
    guess is priced at no less than `pricing.json`'s `seedSecondsPerRender` per image, and a
    pipeline with no measured queue delay yet adds its `seedDelaySecondsPerJob`: the same figures
    as the high end of the New game estimate for the same chains.
  - **Edit a row** (an edit applies to every region in it): the pipeline (only reviewed image
    pipelines that fit the step, never one billed in credits; a new pipeline drops the step's
    settings), the size, the variants, a setting under **Settings** within the card's range (left
    empty, the card's default applies), or ✕ to remove a process step. An edited row says **Your
    edit**. Edits are checked with the same rules the worker uses: a broken rule shows a red line
    under the chain and blocks sending.
  - **Looks right, start rendering** approves the plan as you see it. It is disabled while you
    have unsent edits, while the plan cannot be priced (a red box lists why) and while a planned
    region has no recipe yet ("Not planned yet: …"). The plan is priced again when you approve: if
    it changed since you saw it ("the Art plan changed since you saw it"), or can no longer be
    priced (a card lost its review, the GPU lost its price, the catalogue cannot be read), the
    approval is refused and the plan stays open.
  - **Send my edits (N regions)** goes to the worker, not to an agent: it checks the edits again
    against the plan with all of them applied (so a size or pipeline change across a whole row
    passes as a whole), stores them as each region's next revision and brings the plan back for
    you to approve. Each edit names the revision it was made on: one made on an older revision (a
    second tab, or a technician's revision since) is refused. If one breaks a rule, none is
    stored, Activity lists why, and your edits stay on the page to fix. Steps before the first one
    you changed keep what they already rendered. A note sent with edits is read by the agents once
    you approve the plan. **Discard edits** drops them.
  - With no edits, **Send my changes** sends your note (required) back to the agents: the atlas
    technician revises the plan and brings it back.
  - A region a newer coordinator plan leaves out loses its recipe's approval and is listed under
    "Left out of the plan": its recipe no longer renders, and anything it already made stays in
    the project. A later revision that changes a pipeline or where a step runs, costs more on
    today's prices, or would render again a step that has already rendered (a changed setting
    restarts that step and every step after it), needs your approval again.
  - **A step that keeps failing comes back to you.** Under one approval a failed render is retried
    twice; if it fails a third time its region's recipe loses its approval, nothing more of it
    renders, and the Art plan opens again with that region in it ("H1 step 1 failed again after 2
    retries" in Activity). Approving it gives it two more tries. With the Art plan checkpoint off,
    the run pauses instead, saying which step; **Resume** approves it again.
  - Outside the checkpoint — while the technician is still planning, after you approve, or with
    the checkpoint off — the same plan shows read-only below the region panel, folded behind one
    line ("Every recipe is approved · show the recipes", or how many still wait for approval).
- **Fonts to bake:** as on the breakdown (above).
- **As they land:** one gallery per place the agents saved an image under the project — **Atlas
  pages**, **Sheets**, **Atlases**, **Symbols**, **Scenes**, **Renders**, **References**,
  **Spines**, **Fonts** — newest first, up to 60 each; click one for full size. A region's mockup
  crop is on its tile and in its review, not here. Until the first image lands, **Your mockups**
  shows the uploads instead: "The galleries fill in as the agents' renders land."
- **Activity** (right column): the run's rows newest first, grouped under the step they happened
  in, each with the time, who (**You**, **Coordinator**, **Mockup analyst**, **Art director**,
  **Atlas artist**, **Animator**, **Builder**, **QA**, **Worker**), what they did, a tool chip
  when a tool was used (Atlas Maker, ComfyUI · RunPod, Game Maker, Scene Editor, Symbols SM, Win
  Text, Localization, Font Maker, Rigger, Flipbook, Build) and a cost chip on billing rows
  ("$0.22 · RunPod 4090 · 38 s", "$0.40 · Opus 5.5"). **hide costs** hides the billing rows. The
  pill says **Live** while the stream is open, **Reconnecting** while the browser reopens a dropped
  one, **Polling** when it could not be opened (the page then asks for the run every 5 s). 150 rows
  show at a time; **Show older · n more** pages back.
- **Message the coordinator:** a text box and **Send**, while the run is running, waiting or
  paused. Otherwise the box is disabled and says "The run is not live, so nobody reads a message
  now." Your message appears in the feed as **You** "…", and the coordinator answers there with
  what changed in the plan ("Sent. The coordinator answers in the activity feed.").

Every button here is one request with one id: a double click or a retry after a lost connection
resends the same request and is recorded once. The note, the message and the cap field lock while
their request is outstanding, so nothing you typed is lost.

## How a run works

- **Creating a run creates the game.** The same fields and validation as Game Maker's "Create a
  game" plus the template; the project is copied from the template and the run starts in `draft`.
  The project's math contract is recorded at that moment, so the agents can never move it
  unnoticed.
- **The budget cap is fixed when the run starts**, from Settings' `DIRECTOR_RUN_BUDGET_USD`.
  Changing the setting later never moves a run that has started; raising it on a resume does.
- **Your actions each leave one entry** that the agents' worker reads: start, pause, resume
  (optionally raising the cap), stop, approve or redo a checkpoint, and a message to the
  coordinator. An action the run cannot take right now is refused with the reason, and nothing is
  written. Sending the same action twice (a double click, a retry) records it once. If the run has
  moved on by the time the worker reads an entry, the worker refuses that entry and the page shows
  it.
- **Nothing renders before you confirm the breakdown and the Art plan is approved.** With the Art
  plan checkpoint off, the worker approves the plan itself once its GPU projection fits what is
  left of the cap (How this was made then says "approved automatically"); a plan it cannot price,
  or one over the cap, pauses the run at the budget cap instead, and Activity says why.
- **An Art plan you approve becomes the template's default.** Each region group's chain (its first
  region's, if they differ) is stored as the template's default recipe for that group: the next
  run of the same template starts from it, and the New game estimate prices it ("template default
  v2").
- **You approve a batch, the art director picks the variant.** Approving a region batch approves
  every region in it; the variant that goes into the project's Atlas Maker sheet is the art
  director's pick unless your note says otherwise. Approving the build before hand-off accepts
  whatever was still to review.
- **Fonts stay yours to bake** (see "Fonts to bake" above).
- **A run is its owner's.** Someone else with access to the project sees the live stream; the run's
  page, its actions and its images answer only to the person who created it.

## Known limitations / TODOs

- There is no Preset and no "Save as preset" (ADR-0008 card 8C removed them): the atlas technician
  plans each region from the reviewed blueprint cards, starting from the template's approved default
  recipes, else the fallback chain `sdxl 1024 ×3 → birefnet → finish`, and an approved Art plan
  leaves its chains on the template as the next run's defaults.
- The Art plan edits a whole row (every region with that chain), can remove a process step but
  not add one, and projects the GPU spend only, not the Claude spend. To change one region alone or
  add a step, say so in your note and **Send my changes**.
- A mockup's tag can be changed on its card; its stored name is the upload id, not the file name
  you uploaded.
- "Skip it" / "Request an FX region" shortcuts for a needs-you element are not actions yet: say it
  in the note and send the breakdown back.
- You approve a whole region batch, not one variant. To take a variant other than the art
  director's pick, say which in the note (for example "use variant B for H2") — that is what the
  agents read; there is no per-variant Approve button yet.
- The galleries show what the agents' events name. A tool that writes an image without posting an
  event does not appear there (the image is still in the project, and in its own tool).
- The page keeps the newest ~6000 rows of a run; on a longer run the feed and the galleries start
  from there.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
