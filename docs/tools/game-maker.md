# Invisible Game Maker

Turn an online-authored project into a published, playable game — no desktop
launcher, no per-game repo, no build. Pick a client and a game type, name it, and
the tool creates the project + its cloud scaffold; author it with the editor and
asset tools, then click **Publish** and the game is immediately playable against a
mock RGS.

## What it is

The missing rung in the all-online pipeline. Everything else is already authored
in the browser — create the project, lay out scenes from a game-type template,
make atlases / sheets / fonts / symbols / strings — but until now the only way to
_ship_ that into a runnable game was to drop to the CLI, stand up a standalone
GitHub repo, and click **Build & publish** in the desktop launcher. Game Maker
closes that gap.

It does so with **one prebuilt generic engine runtime** that boots any project
from its authoring data. "Publish" is therefore a **data + manifest operation, not
a build** — it freezes the project's current data as a **published version** and
re-registers the game; it never rebuilds a bundle. Players always get the published
version; your later edits reach them only when you publish again.

- **Where it runs:** the launcher itself, at `/game-maker` — a real full-page
  route inside `(app)`, behind the auth + role gate. It is **never an iframe** and
  never a redirect; it renders the shared tool top bar like every other launcher
  tool. The published game plays elsewhere, on the Invisible Test Server at
  `https://games.invisiblewall.org/<key>/`.
- **Access:** the `gameMaker` tool, granted by default to `admin`, `developer` and
  `pipelineTester` roles (overridable per role/user in the admin panel like any tool). **Creating**
  a project is available to any holder of the tool; **Publishing** additionally requires the
  **Build & publish games** (`gamePublish`) capability, which is default-ON for `admin` **only** —
  a `developer` or `pipelineTester` sees the page but gets a 403 on Publish until it is granted per
  role or per user in `/admin → Roles`. The same one capability
  covers the whole chain — this page's Publish, the bulk republish, and every step of a
  desktop ☁ Publish — so a granted role works end to end.

## How to use it

The page has two cards: **Create a game** and **Your projects**. Each project in
the second card shows what kind of game it is and which features it uses, can be
filtered/sorted/grouped by client, can be duplicated onto a new key, and can take the pots
overlay add-on.

### Create a game

1. Fill in the **Name** (e.g. `Book of Borut`). As you type, a URL-safe **Key**
   is auto-derived (lowercased, non-alphanumerics collapsed to `-`); it stops
   auto-following once you edit the Key by hand. The key must match
   `a-z 0-9 _ -` (max 64 characters) and becomes the project key **and** the
   eventual game key.
2. Pick a **Client** from the dropdown, or leave it **Unassigned**.
3. Pick a **Game type**. The list is the same union the `/admin` create-project
   action offers — the built-in scene sets (`lines`, `ways`, `cluster`,
   `scatter`, `holdAndWin`) plus any author-created custom kinds. The game type seeds
   the project's starting layout template. **Book of** is no longer a game type of its own (its
   existing projects keep it until they are moved to lines): a Book-of game is a **Lines** game with
   the expanding symbol.
   - **Lines** shows a **Preset** dropdown: _None — the lines template_ (the default) or **Book of
     Thermopylae** — a copy of the captured Book of Thermopylae: 5×3, ten lines, the book `S` as
     scatter and wild, the captured paytable, the expanding symbol's weights and thresholds, +10 on a
     retrigger and a 100× buy. It is saved as the project's own [Game Config](/docs/game-config) and
     the project's screens are scaffolded from the Book-of reference layout (Borut's look), saved as
     a lines layout. Change it later in Game Config (Free spins → Expanding symbol).
   - **Hold and Win** shows a **Jackpots** dropdown: **On (MINI · MINOR · MAJOR · GRAND)** (the
     default) or **Off**. Either way you get the plain Hold and Win: a 5×3, 5-line base game with
     coin symbols on the base reels; 6 or more coins start 3 respins, every coin sticks, a new coin
     resets the count to 3, and the coins pay at the end. No pots, no dropped tokens, no collector,
     no specials. **On** adds four fixed jackpots (MINI 15×, MINOR 30×, MAJOR 100×, GRAND 1000×),
     jackpot coins on the reels, and a full board pays GRAND; **Off** has no jackpots, no jackpot
     coins and no full-board prize. This is saved as the project's own
     [Game Config](/docs/game-config), so the mock RGS deals the feature from the first spin: a
     lines base game, its coin trigger (Game Config's **Coin overlay**, style Classic) and one
     `holdAndWin` respin mode under **Bonus modes**. The coin symbols are bound to placeholder art
     in the project's own [Symbols](/docs/symbols-state-machine) doc, so they draw from the first
     spin; replace that art in Symbols. Win Text starts on the engine's defaults. The project has
     no **Pots** screen, and with Jackpots **Off** no **Jackpot bar** either (its starter Flow
     does not show them). Pots come from a coin overlay (step 4, or **＋ Coin overlay…** on the
     card later). For one of the three reference games (Pots, Classic sticky, Collector streak),
     use **Reset to preset** in Game Config (the symbols doc is not re-seeded — bind any new preset
     symbol in Symbols). Projects created before 2026-10-09 keep the preset they were made with.
4. Optionally tick **Add a coin overlay** and pick its preset from the dropdown beside it. The
   new project then gets the same add-on as the card's **＋ Coin overlay…** (see
   [Add a coin overlay](#add-a-coin-overlay-to-a-project) below), run on its fresh scaffold.
   This route never grafts the Flow, so the overlay plays its coded beats. On a new Hold and Win
   game the only preset that fits is **Pots to free spins** (see the style list below), and its
   pots are dealt once the mock-composition work (#1152) lands: until then they save but never fill
   on the test server.
5. Click **Create project**. This creates the launcher project and scaffolds its
   cloud tree (the same scaffold the `/admin` create action produces:
   `editor/scenes.json`, `editor/flow-v2.json` — the game type's starter
   [flow](/docs/flow) — `atlas_config.json`, `manifests/`, `input/refs/`,
   `sheet_config.json`, `localization/strings.json`; a **Hold and Win** project
   also gets the plain Hold and Win as its own [Game Config](/docs/game-config)
   and `symbols/symbols.json` binding its Hold and Win symbols, so its first publish
   already deals and draws the feature). A confirmation appears and
   the project shows up under **Your projects** below. With the overlay ticked, the confirmation
   reads _"… with the coin overlay"_ and the add-on's report shows under the form.

From here you author the game with the existing online tools — the Scene Editor,
Atlas Maker, Sheet Maker, Font Maker, Symbols State Machine, and Localization —
all scoped to this project. Nothing about authoring lives in Game Maker itself; it
is the create-and-publish surface.

### Reading a project card

Every card under **Your projects** answers "what _is_ this game?" in two rows of
chips, derived live from the project's own authoring data — nothing to fill in and
nothing that can go stale:

- **Game** — its identity: the game kind, how it pays (line pays / _N_ ways /
  cluster / scatter, with the threshold and direction), the board (`5 × 3`, or
  `5 reels · 3/4/5/4/3 rows` for a stepped one), payline count, RTP, max win, and
  — once published — _shared runtime_ plus which mock-RGS protocol it is dealt.
  A last chip says whether the project has authored its own Game Config or is
  still inheriting its game type's template.
- **Using** — the optional mechanics and presentation features it actually has
  switched on: wild / scatter / multiplier symbols, cascading (tumble) reels,
  multiplier collect, expanding book symbol, buy feature, ante bet, stacked
  pictures, the win-line display and full-payline trace, per-line win colours,
  winning-symbol replay (and its dim / hold-after-big-win variants), win-frame
  highlight, free-spin board glow, book-symbol VFX, reel anticipation, explosion
  animations, named symbols, big-win tiers and tier escalation.

Hover any chip for what it means and where it comes from. A project that has
switched nothing on says _"no optional features yet"_ rather than listing the
engine's whole menu — the list reports what a game **uses**, not what it could.

Two of those chips deserve a note, because they are the only ones that do **not**
read live state:

- **`shared runtime`** names no game type on purpose. Every online game is served
  from the same prebuilt bundle, so printing its id said nothing about _this_
  game — and the id is historically `lines`, which read as a game type (a cluster
  game showing "lines runtime" looks misconfigured). If a second bundle ever
  exists, that one _is_ named.
- **An amber `re-publish — dealing …, kind wants …` chip** means the mock-RGS
  protocol is behind the game kind. `protocol` is stamped into the test-server
  manifest at **publish** time, while the kind chip beside it is live, so the two
  drift whenever a kind changes — or gains a protocol it did not have when the
  game was last published. While it shows, the test server decides that game's
  wins the old way (a cluster game paid by paylines). **Publish** clears it.

The feature list grows with the engine: each new optional mechanic adds one entry
to the detector table in `src/lib/server/gameProfile.ts`, so a shipped mechanic is
never invisible here.

### Finding a project

Above the list is a browse toolbar, because the list only grows:

- **Search** matches the name, key, client **and the profile chips** — so
  `stacked`, `cluster` or `buy feature` finds the games that use them. Multiple
  words all have to match.
- **All clients** / **All types** / **Any status** narrow the list. _Status_ covers
  Published, Not published, and **Engine stale** (the amber badge below) so you can
  pull up exactly the games that need a republish.
- **Sort** by recently edited (default), recently published, name, or key.
- **Group by client** (on by default) splits the list into per-client sections with
  a count each. Turn it off for one flat, globally sorted list; the client then
  shows as a pill on each card instead.

The heading shows `N of M` whenever a filter is narrowing the list, and **Clear**
resets every filter at once.

### Duplicate (reskin for another client)

**Duplicate…** on a card copies the whole game onto a new project key — the same
client for a variant, a different client to reskin it for them. You choose:

- **New name / new key / client** — name and key start empty, and **Duplicate** stays
  greyed out until both are filled. The key auto-follows the name until you edit it,
  same as the create form; typing a key never fills in the name. To rename a copy
  afterwards, use **/admin → Projects**.
- **What to copy:**
  - **Game setup only (no art, sounds or fonts)** (default) — scenes, both flow
    docs, Game Config, symbols, win text, strings, the project's editor components
    and their defaults, plus the atlas/sheet config seeds. It copies **no art,
    sounds or fonts**: the copy plays on placeholder art until you add your own, and
    everything that used the original's art draws blank. Pick it only when new art
    is coming. The message after the copy says so again.
  - **Everything, including atlases, rigs, fonts and sounds** — the whole project:
    every asset folder, the Atlas Maker's deployed pages, effects, clips and
    cinematics. The copy plays as the original does and you replace art in place.
    Use it to try something on a copy of a working game (the
    [pots overlay walkthrough](../guides/add-pots-overlay.md) does). The original's
    published versions and its rolling doc backups stay with the original. Over 4000
    files the copy is refused outright, before anything is written; only files that
    are copied count. Move a bigger project with the [FTP Browser](ftp-browser.md).
    The copy is never silently truncated.

Asset references **inside** the copied documents are re-pointed at the new project
as they are copied, so the duplicate never quietly reads the original's files (and
does not break when the original is edited or deleted). The copy inherits the
source's game type, starts unpublished with either choice (no published versions,
nothing for players until you Publish it), and mints its own read token on its
first publish.

You need the Game Maker tool and access to the source project; unlike Publish, it
needs no extra capability.

Invisible Director creates its projects through this same duplicate (**Everything**),
from a published game an admin marked as a
[Director template](director.md#mark-a-game-as-a-director-template).

### Add a coin overlay to a project

A coin overlay lays coins over a game you already have: value coins (and, with pots, tokens) drop on
top of the board's symbols, tokens fly into pots, and a full pot (or enough coins on one spin)
starts a bonus. The game keeps its own kind, lines and features. A walkthrough from duplicate
to playtest is in [Add a pots overlay to an existing game](../guides/add-pots-overlay.md).

Try it on a **duplicate**, never on a live game: the add-on writes to the project's Game Config at
once. **Live ↗** shows it straight away and players get it with the next Publish, except on a game
published before versioned snapshots (the amber note on its card): its players boot the live
authoring data, so they get the overlay at once. It needs the tools whose docs it writes, beside the Game Maker:
Game Config, Symbols and the Scene Editor (and Invisible Flow for the Flow steps). Without one, the
dialog says which, and the new-game checkbox creates the game without the overlay. It also adds
nothing while someone else has this project's Game Config, Scene Editor, Symbols (or, with the Flow
steps, Flow) open: the dialog names who is editing, and you try again once they close it.

1. On the project's card, click **＋ Coin overlay…**. (On a project that already has the overlay the
   button reads **Coin overlay parts…**; see _Running it again_ below.)
2. Pick a **Style**, then a **Preset** of that style:
   - **Classic** — value coins drop; enough start a Hold and Win. Preset **Coins only (6+ value
     coins start a classic Hold and Win)**: no pots, and enough coins on one spin start a classic
     Hold and Win with those coins held.
   - **3 Pots** — tokens fill pots; a full pot starts its bonus. Presets **3 Pots (each pot a Hold
     and Win with its special)** — red, blue and green pots, each starting the Hold and Win feature
     with a different special active, plus value coins — and **Pots to free spins**, one gold pot
     that starts free spins.
   - **Collector** — listed, but no preset builds it: a collector lands on the base reels, and the
     add-on never edits the game's strips. The dialog says so and **Add** stays off. For a collector
     game, use **Reset to preset** → **Collector streak** in [Game Config](game-config.md) instead.

   Only the presets that fit the game's Game Config are offered; a style with none shows why in red.
   On a Hold and Win game **Coins only** never fits (its own reels start its feature), and **3 Pots**
   only on a game reset to the Pots preset in Game Config (its pots start specials the plain Hold and
   Win, Classic and Collector do not have), so a new Hold and Win game is offered **Pots to free
   spins** only. On a Hold and Win game the overlay brings no value coins either, for the same
   reason.
3. Leave **Also add the overlay steps to the Flow** off unless you want them. Without the Flow
   steps the overlay plays its built-in beats, so the game needs no flow edit. Ticked, it adds the
   steps [Invisible Flow](flow.md#pots-overlay-and-hold-and-win-on-any-kind--add-ons)'s **＋ Add
   overlay steps** adds, to a flow the project has stored.
4. Click **Add**. When the report appears, click **Done**.
5. **Reload your own open Game Config, Scene Editor, Symbols or Flow tabs for this project.** A tab
   opened before the add-on still holds the old doc, and its next save is refused as a conflict.

**What it adds.** It first merges the overlay into the project's
[Game Config](game-config.md#coin-overlay), where it shows under **Coin overlay** (the 3 Pots and
Coins only presets also bring a Hold and Win bonus, unless the project already has a Hold and Win
block). Then it seeds the parts a playable
overlay needs:

- **Symbols** — placeholder art for each token and for the Hold and Win bonus's symbols, so they
  draw from the first spin. Replace it in [Symbols](symbols-state-machine.md#pots-overlay-projects).
- **Screens** — the Scene Editor's **＋ Add overlay screens**, done for you: the **Pots** screen
  (one Pot Meter per pot) and, with a Hold and Win bonus, the Jackpot bar and the feature's screens.
  Coins only has no pots, so it adds no Pots screen and no token. A pot that already has a Pot Meter
  on any screen gets no second one. On a Hold and Win game it adds the Pots screen when the project
  has none (a game made from the plain template), else appends a Pot Meter for each new pot beside
  the existing ones.
- **Win Text** — nothing. Every pot, jackpot and respin line already has a built-in default that
  [Win Text](win-text.md) and Localization offer once the config has the overlay. Writing the
  defaults in would freeze them as your own copy, so name the pots in Win Text yourself.
- **Flow** — only when you ticked the checkbox.

**It only adds.** It never overwrites a layout, a Flow, a symbol binding or any config setting you
authored, and it never reseeds a layout or Flow the project already has: it merges in the screens
and steps that are missing and leaves the rest alone. A Flow graft never touches a node you made.

**Reading the report.** One line per part:

- **Game Config** — _coin overlay added_, or _already has the overlay_.
- **Renamed** — shown when the project already used a name the preset brings (a symbol or a pot
  id). The new one takes the first free `_2`, `_3`… suffix everywhere the overlay names it, and the
  line lists each change, e.g. `red → red_2`. Use the new names in the other tools.
- **Symbols / Screens / Win Text / Flow** — _added_ (with what was added), _nothing to add_,
  _changed meanwhile_, _skipped_ or _failed_, with a note when there is something to do by hand.
  For example, a project with no stored flow skips the Flow graft (the built-in beats play), and a
  custom game kind skips the screens (add them with **＋ Add overlay screens** in the
  [Scene Editor](invisible-editor.md)).

**Running it again.** Each part is saved separately and only if nobody saved that doc in between.
A part that lost that race reads **changed meanwhile** (or **failed** on an error), and the dialog
offers **Run again for the rest**. Running again is safe: it adds only what is still missing and
never duplicates a part. The same goes for **Coin overlay parts…** on the card later: it has no
style or preset, only the Flow checkbox and **Seed missing parts**. A run that does not add the
overlay never adds a screen, so a screen you deleted stays deleted: it only adds a Pot Meter for a
pot that has none on any screen (or names it, when there is no Pots screen to put it on). If the
Game Config itself was saved by someone else meanwhile, the dialog says so and nothing was added;
click **Add** again.
**Seed missing parts** binds placeholder art to every token or bonus symbol that has no binding,
including one you cleared on purpose.

To tune the pots, the drops and each pot's bonus, or to remove the overlay, use
[Game Config → Coin overlay](game-config.md#coin-overlay). The Game Maker only adds it.

### Add a bonus mode from another project

Every project card has **Add a bonus mode…**: it copies one bonus mode of another project of the
**same client** into this one as a **new** mode. It never replaces a mode this project has. The other
project is only read.

1. On the card, click **Add a bonus mode…**.
2. Pick the source project under **From**, then the **Mode**: one of its bonus modes. A Hold and Win
   (respin) mode with rules, or a free spins on the reels, can be added. Any other (a wheel, a respin
   mode with no rules, one with no strips) is marked **(not yet)**, with the reason under the picker.
3. Under **What starts it**, tick what should start the new mode. Each line shows the mode it starts
   now as **(now _mode_)**:
   - this project's coin overlay **pots**;
   - its triggers: **Coin count**, **Pattern**, **Lucky Spin**, **Random metre**;
   - its **meters**;
   - a **Buy** tier on each buy-bonus bet mode.

   Scatters are never offered. Only what this game actually plays is listed. On a **Hold and Win**
   project every route above is offered. On any other game (Lines, Book of…) a Hold and Win mode is
   started only by a **pot**, or by the **Coin count** when the overlay drops value coins: a buy or a
   trigger route there would save but never play, so it is not offered (it arrives in a later
   phase). A **free spins** is started only by a pot. Either way, a game without a coin overlay
   with pots needs one first (**＋ Coin overlay…** → **3 Pots**). A **Hold and Win** mode can be left
   with nothing ticked and routed later in
   [Game Config → Coin overlay](game-config.md#coin-overlay), except when it would be this project's
   only Hold and Win: then something must start it, and the dialog refuses with that reason.
4. Click **Add**, read the report, then **Done**, and reload your own open tabs of the tools below
   for this project.

**A Hold and Win mode** arrives under a new id. An id this project already uses takes `_2`, `_3`…:
adding `hw-classic-sample`'s `holdAndWin` to a project that already has `holdAndWin` makes
`holdAndWin_2`. What travels with it:

- its rules, including **Play** (Automatic / Manual), shown in
  [Game Config → Bonus modes](game-config.md#bonus-modes);
- its strips and the symbols they deal (a name this project already uses is renamed, listed under
  **Renamed**), with those symbols' [Symbols](symbols-state-machine.md) art. Rigs the art or screens
  use are copied into the shared library under `imported/<this project>/<source project>/…`, so they
  ship with the game;
- its screens, copied as `<screen id>-<new mode id>` (e.g. `featureIntro-holdAndWin_2`); this
  project's other screens stay;
- its [Flow](flow.md) tab, re-pointed at the new mode and its screens, into a flow the project has
  stored. If the source has no tab for it and this flow has none either, the new mode gets the Hold
  and Win starter tab;
- its [Win Text](win-text.md) lines, under the new mode. If it becomes this project's first Hold and
  Win, its lines become the project's Hold and Win lines; the pot lines stay this project's.

**A free spins** arrives as a mode of this project's own, beside its own free spins: the source's
name with `_2` added (`freeSpins_2`), playing on its own strips with this game's free-spin
presentation. A symbol this project defines exactly as the source does is shared rather than
copied, so only what differs arrives. The source's mode screens are copied for the new mode, and its
Flow section with it. Win Text is not copied: the added free spins speak this game's own free-spin
lines.

Adding the same source mode twice is refused: the dialog names the mode it already is here and says
**Re-sync it instead**.

**Re-sync.** Each added mode puts a **Re-sync _mode_ from _project_…** button on the card. It copies
that mode again as the source is now and touches no other mode: its rules (with Play), strips and
symbols, screens, Flow tab and Win Text. Its id, label, HUD and everything that starts it stay. A
pot that starts it with a special the re-synced rules no longer deal starts it plain (**Special
dropped**). A mode renamed in Game Config since is re-synced under its new name, and its pieces
under the old one are cleared. A bonus brought in by the older **Import a bonus…** re-syncs exactly
as before.

**Re-sync replaces what you changed here.** Any edit made in this project to that mode's rules,
symbols, screens, Flow tab, Win Text or presentation (music, counter…) is overwritten by the
source's; only its label and HUD are kept. Only the Game Config keeps a backup of the version
before (in [Game Config](game-config.md)'s backups): the screens, the Flow tab and the Win Text
have none. Make lasting changes in the source project, then re-sync.

**Who else is editing.** Nothing is written while someone else has this project's Game Config,
Symbols, Scene Editor, Flow or Win Text open. The report has one line per part (Symbols, rigs,
Screens, Flow, Win Text): _added_, _nothing to add_, _changed meanwhile_, _skipped_ or _failed_. A
part that lost a race to someone else's save is filled in by running **Re-sync**.

### Publish (and Re-publish)

Each project card under **Your projects** carries a **Publish** button (it reads
**Re-publish** once the game already exists). Clicking it runs the server-side
publish, which:

1. **Freezes a published version.** It exports the project's current layout, art,
   fonts, sounds, symbols, flow and config once, checks the flow it is about to
   ship (see the refusals below), and stores the result — the game data plus a copy
   of every asset file it uses — as an **immutable version**. Players boot that
   version: nothing they load changes until the next publish, however much you edit
   in the meantime. The last five versions are kept, for rollback.
2. **Mints (or reuses) a per-project read-only token** that gates the public
   fetches the running game makes back to the launcher (its game data + asset
   files). The shared deploy token is never exposed to the browser.
3. **Merges the test server's manifest** (`test_server/games.json`,
   read-modify-write so siblings are never dropped) with this game's
   `{ protocol, name, runtime }` — `protocol` is the mock RGS to spin against, from
   the game kind (`book` for book-of games, `ways` / `cluster` / `scatter` for those
   kinds, otherwise `lines`); `runtime` is the shared engine bundle id. It also writes
   the pointer (launcher origin + read token) the test server uses to re-read the
   project's [Game Config](/docs/game-config), so the **mock** deals each game the board it
   draws: **Live ↗** is dealt your saved config, picking up a new grid, payline set or win
   model within seconds of a save, and players are dealt the published version's math. A math
   change therefore reaches players, game and server together, at the next **Publish**. The
   board/cascade values written here are only the fallback for when the launcher can't be
   reached.
4. **Registers the portal game** with a launch URL that points the generic
   runtime at _this_ project's published version
   (`…/<key>/?runtime=1&project=<key>&k=<readToken>&…`), gated by the read token,
   wired to the per-key mock RGS proxy.
5. **Refreshes the test server** (best-effort — a slow or failed refresh never
   fails the publish; the server re-hydrates on its own cadence too).

A publish takes as long as one export of the project (about 20–30 s for a full
game) plus a few seconds to copy its files.

**Publish can refuse, before anything is written:**

- **Sounds still marked draft** in Invisible Sound. The dialog names them; **Publish anyway**
  ships them.
- **Flow errors.** The saved [flow](/docs/flow) is validated the way its Validation panel does,
  and any red error stops the publish with the list. It is checked again on the exact flow the
  version freezes, so an edit saved while the publish runs cannot slip an error past it. An **admin** gets a **Publish anyway**
  button (a flow error can hang or skip a round for players); anyone else is told to fix it in
  Invisible Flow or ask an admin.
- **Paytable drift.** Only when the project keeps a captured partner paytable as a reference
  ([Game Config](game-config.md#the-partner-reference-and-the-publish-check) → Symbols → import
  from a pasted capture): if the paytable the info page would show disagrees with it, the dialog
  lists the differing rows. Same rule as flow errors — an **admin** gets **Publish anyway**;
  anyone else fixes the rows in `/config` or asks an admin.
- **A game with its own desktop build.** Final — republish it from the desktop launcher.

Step by step, with what to do after each refusal: the
[publish and deliver runbook](../guides/publish-and-deliver.md).

A project with **no** saved flow still publishes, with a note under the card that it plays
without the free-spin intro and outro (see [Flow](/docs/flow) for how to give it one).

After a successful publish, notes under the card can also flag (never blocking): sounds with a
non-commercial or missing licence, and **⚠ rig bundles that resolved to nothing** — a rig
placed in a scene or bound to a symbol that will be missing in-game. Re-pick the rig in the
Scene Editor or Invisible Symbols and publish again. **⚠ The flow names N screens the Scene Editor
no longer has** lists flow screens whose scene was deleted (or lost to a bad save): nothing draws
for them, and a step waiting on one never continues, so a game can sit on its background forever.
Restore the screen from the Scene Editor's **History…**, or remove it from the flow (its
Validation panel marks each step that uses one). A **Hold and Win** game whose Game Config has
no Hold and Win block (a project created before its config was seeded) gets **⚠ dealt plain
lines** — open Game Config, save, and publish again.

When it finishes, the page reloads the row to show the new state: a **Play ↗**
link that opens the game exactly as players get it (the published version), a
**Live ↗** link that opens the same game on your **current, unpublished** authoring
data (use it to check edits before you publish them), a **Copy URL** button, and
the full play URL beneath. The game also appears in the launcher portal's **Games** section — whose cards,
like **Live ↗**, open your current authoring data, not the published version — and
plays at `https://games.invisiblewall.org/<key>/`, spinning against the mock RGS
(fake money, no real spend).

The two small dropdowns beside **Play ↗** choose the **language** and the
**currency** both links open the game in (`?lang=` / `?currency=`) — the same pair
of pickers as the portal's **Games** section, and the choice is remembered across
both. Currency changes only how amounts are _formatted_: the mock wallet holds the
same fake money whatever you pick, so this is the way to check a HUD in `EUR`,
`BRL`, or a long code like `XGC` without touching the RGS. The **Copy URL** button
deliberately copies the _player's_ URL, without these authoring overrides.

A language the project has no translations for renders in the source language — an
untranslated locale falls back by design, so the game looks like it "ignored" the
setting. Check the row is actually translated **and reviewed** in `/localization`:
only reviewed strings reach a player or the published bake. (**Live ↗** also shows
unreviewed machine translations, so you can see them in context before vetting.)

### Published versions and rollback

Under a published game's buttons, a line says which version players get —
_"Players get the version published Sep 29 by …"_ — and adds **Scenes edited since —
publish to ship them** when the scene layout has been saved after that version.

When the game has more than one retained version, **Published versions (n)** opens
the list: date, who published it, **engine <commit>** (the engine release that was
live when it was published), a red **flow errors** tag on one an admin published
past the flow check, and **live** on the one players get. **Make live**
on any other version switches players back to it after a confirmation. Nothing is
rebuilt — it takes effect on each player's next load (the mock RGS deals players that
version's math too), and you can switch forward again the same way. Making a version live changes the game's DATA only: the game
stays on the engine that is live now, and the confirmation names the engine the
version was published on. Taking the engine back is a separate step — the
**Runtime rollback** workflow (see [games-deploy](../design/games-deploy.md)).
Publishing always creates a new version and makes it live.
Five versions are kept: the newest ones, except that the live one is always among
them even when you have rolled back further than that. A version tagged **flow
errors** can be made live again only by an admin — the same rule as publishing
past the flow check.

A game last published **before versions existed** shows an amber note instead:
its players still get live authoring data (slower to load, and every save reaches
them). **Republish** it — or use **Republish all** — to freeze its first version.

If a player's game cannot load its published data at all (the launcher is
unreachable, the link's token is wrong), the game stops on a **"This game could
not load"** screen with a **Reload** button — it never falls back to showing the
engine's sample game in its place.

### Engine update available (the staleness badge)

Online games all run **one shared engine runtime bundle**, not a per-game build,
so an engine change reaches a live game only through a **Runtime release** — not
your Publish. To stop the "my fix built and shipped but the game still runs the
old behavior" ghost-chase, each published project row shows an engine-freshness
signal:

- **Amber "Engine update available" badge** — the shared engine runtime shipped
  _after_ this game was last published, so the running game may still be on the
  old engine. It carries a **Republish + Reconcile** button (the same publish flow
  as above — it re-exports the project and refreshes the test server, which
  re-hydrates it against the current runtime). Admins also get a _"still stale?
  purge edge cache"_ link to `/admin` for the rarer case where the Cloudflare edge
  is holding a stale file. The badge clears itself once you republish. Hover it for
  the exact runtime-release vs. last-publish dates.
- **Subtle "engine up to date"** — the game was published against (or after) the
  current runtime; nothing to do.
- **Nothing** — the tool can't compare (e.g. the game has no shared-runtime entry,
  or timestamps are missing); it deliberately stays silent rather than false-alarm.

This is a read-only indicator: it never changes how a game runs, only tells you
when a republish would pick up newer engine code.

### Republish every game at once (bulk)

After an engine release, every published game is stale at once, and pressing
**Republish + Reconcile** on each row in turn is the chore this replaces. The
**Your projects** header carries two bulk buttons (the same `gamePublish` gate as
Publish itself):

- **Republish N stale games** — appears only while at least one game shows the
  amber badge. It runs the exact same publish flow, once per stale game.
- **Republish all (N)** — every published game you can access, stale or not.

Both cover **all** your projects, not just the ones the current filters show —
the confirmation dialog says so, and states how many games and roughly how long
(a publish re-exports the project, so budget ~20 seconds each).

The run happens **on the server, one game at a time**. A progress panel appears
under the header with a bar, a live per-game list (_queued · publishing… ·
republished · skipped · failed_), and who started it. Because the work is a
background job you can **leave the page** — come back and the panel re-attaches to
the run in progress. **Stop after this game** ends the run cleanly: the game being
published finishes (a half-written publish would half-register a game), and the
rest stay queued.

Games that have their own desktop build are **skipped** with the reason shown,
never overwritten — so are games whose flow has validation errors (a bulk run
never overrides a refusal; publish those one at a time) — and a game that fails is reported in place while the run
carries on — one bad project can't strand the other twenty. While a bulk run is
going, the per-project Publish buttons are disabled: publishes are deliberately
serialised, because a publish is the launcher's most memory-hungry operation.

Only one bulk run exists at a time; a second admin pressing the button gets told
one is already going, and sees the same panel.

## The model (no repo, no build)

A game does **not** need rebuilding to change its art, layout, fonts, strings,
symbols, or math — those are all authoring data in R2. Game Maker leans on that:
it ships **one** prebuilt generic engine runtime and boots a specific game by
fetching that project's authoring data at load time. So:

- **Authoring stays in the existing online tools** (editor / atlas / fonts /
  symbols / localization). Game Maker neither replaces nor embeds them.
- **No desktop launcher** is involved (the desktop launcher remains only for the
  submodule-repo publishing path).
- **No per-game GitHub repo and no build** — publishing re-exports + re-registers
  data, it does not compile a bundle.

The standalone submodule-repo path (see
[`../design/games-deploy.md`](../design/games-deploy.md)) still exists for games
that outgrow this — those that need bespoke compiled code or pin a specific engine
version and ship on their own cadence. A project can start in Game Maker and
graduate later; its R2 authoring data carries over.

## Traps

- **A Hold and Win game plays plain lines (no coins, `PIC*` symbols).** — The project has no
  Game Config of its own, so the mock deals its base game as lines. Projects created before the
  scaffold seeded it (2026-10-01) can be in this state; Publish warns **⚠ dealt plain lines**. Open [Game Config](/docs/game-config), press
  **Save** (or **Reset to preset**), then **Publish**.
- **Hold and Win coins show only their value, no art (`[game-config] … no entry in the symbol
  map`).** — The project's Symbols doc does not bind its coin and special symbols. Projects
  created before the scaffold seeded them (2026-10-01) have no such doc: ask an admin to
  **Rescaffold** the project in `/admin` (it writes the bindings only if the project has no
  symbols doc yet), or bind each symbol in [Symbols](/docs/symbols-state-machine); then **Publish**.

- **A save is refused as a conflict right after adding a coin overlay or a bonus mode.** — The tab was open
  before the add-on wrote the project's docs. Reload it (your unsaved edits in it are lost), redo
  them, and save.
- **A pots overlay token draws nothing.** — The token has no art bound in
  [Symbols](symbols-state-machine.md#pots-overlay-projects). The add-on binds placeholder art, and
  its report names any symbol it found none for; bind those by hand. A token added by hand in Game
  Config gets no art until you bind it, or run **Coin overlay parts…**.

- **"My edit isn't in the game."** — **Play ↗**, **Copy URL** and every player link boot the
  _published_ version, so anything saved since the last Publish is missing there by design. Check
  the edit with **Live ↗** (or the portal's Games card), then **Publish** to ship it.
- **No "Scenes edited since" note, yet players still get the old wording, sound or math.** — That
  note watches the scene layout only. Edits to Game Config, Win Text, strings, sounds, symbols and
  the flow are not tracked by it; if you changed any of them after the version shown, publish.
- **Live ↗ sits on "Fetching from R2…" for a minute or more.** — A live load rebuilds all of the
  project's data every time it opens, and a big project takes that long. Players never wait for
  it, because they read the frozen published version. Let it finish; if it ends on "This game
  could not load", press **Reload** — the retry usually picks up the rebuild already under way.
- **The engine's sample game (sample art, sample board) appears instead of yours.** — The game was
  opened without its launch parameters, most often from the list on the test server's own page
  (`games.invisiblewall.org`). Open it from here (**Play ↗** / **Live ↗**) or from the portal's
  **Games** section.
- **"This game could not load" on a link someone sent you.** — The link's read token (the `k=`
  value) is wrong, usually because the URL was retyped by hand, or the launcher was restarting
  for a moment. Reload once; if it stays, send the link from **Copy URL** instead of retyping it.

## Known limitations / TODOs

- **One shared runtime for every kind.** There is a single prebuilt engine bundle (its id is
  historically `lines`); it adapts to the win model the project's
  [Game Config](game-config.md) declares and stands payline-only surfaces down off-lines, so
  ways, cluster and scatter games play as themselves — once that config is **saved** (see
  _Making a ways game_ there). A kind that needs bespoke compiled code the shared bundle cannot
  carry would need a bundle of its own; none exists yet.
- **Reskin / template games, not yet fully custom behavior.** Background, scenery,
  HUD, free-spin intro/counter/outro, loading splash, board position/shape/spin
  feel, fonts, localized text, and per-instance prefab art are already driven by
  the online doc + R2 assets, so reskins and template-composed games work. Truly
  **novel** game behavior — the per-event animation timeline — is still per-game
  TypeScript; the declarative behavior-track format that unlocks it fully online
  is the **Phase 4** engine project (`tracks?: BehaviorTrack[]`, reserved but not
  built).
- **Per-game math is not authored here.** Symbols, paytable, paylines, win model, bet modes, reel
  strips and board size live in [Invisible Game Config](game-config.md); a project that never
  saves a config there runs the engine's compiled `lines` template, whatever its game type.
- **Publish needs a capability, not just the tool** — see **Access** above. Granting
  **Build & publish games** to `developer` / `pipelineTester` is an explicit act in
  `/admin → Roles`.
- **Mock RGS only.** Published games spin against the faithful-but-fake mock RGS
  on the Invisible Test Server (a fake balance per browser tab, resets on
  restart). This is a test/preview surface, not a real-money deploy. See
  [`test-server.md`](test-server.md).
- **The pots overlay is dealt on Book of and lines-family hosts.** The test server's mock deals the
  overlay over a `book`, `lines`, `ways`, `cluster` or `scatter` game (a stepped board excepted). A
  Hold and Win game that adds the overlay is dealt without pots until the mock-composition work
  (#1152) lands.
- **Pots overlay on a Hold and Win game:** a project created before 2026-10-09 (or a sample) already
  has its Pots screen, so the add-on only appends a Pot Meter for each new pot (`red_2`…) beside the
  existing ones. Arrange them in the [Scene Editor](invisible-editor.md). **Coins only** is not
  offered there: the game's own Hold and Win starts from its reels, so dropped coins alone would
  start nothing.
- **Only a Hold and Win mode with rules or a reels free spins can be added.** A wheel, a `none`
  mode or a respin mode with no rules is listed as **(not yet)**: nothing plays one yet.
- **A free spins is added only on a project with pots.** It is started only by a pot, never by a
  trigger, meter or buy tier.
- **A pot route needs a game whose base reels deal no Hold and Win symbols.** On a project whose
  base strips deal coins or other Hold and Win symbols, or on a stepped board, the overlay's pots
  are not dealt (the same limit as the older import), so a pot route there starts nothing.
- **Added free spins look like this game's free spins** unless the source has mode screens for
  them: a source's free-game screens that show by the free-game gate rather than as mode screens
  are not copied.
- **The coin overlay can only be added here.** Tuning and removing it are in
  [Game Config → Coin overlay](game-config.md#coin-overlay). The new-game checkbox never grafts
  the Flow; use **Coin overlay parts…** with the checkbox, or **＋ Add overlay steps** in
  Invisible Flow.
- **A published version freezes data, not the engine.** Every online game runs the live
  engine release; after an engine change that needs new game data, republish (the amber
  badge above is the prompt). Rolling a game back to an old version does not roll its engine
  back.
