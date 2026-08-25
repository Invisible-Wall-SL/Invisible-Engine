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
straight from its live authoring data. "Publish" is therefore a **data + manifest
operation, not a build** — re-publishing re-exports the project's assets and
re-registers it; it never rebuilds a bundle.

- **Where it runs:** the launcher itself, at `/game-maker` — a real full-page
  route inside `(app)`, behind the auth + role gate. It is **never an iframe** and
  never a redirect; it renders the shared tool top bar like every other launcher
  tool. The published game plays elsewhere, on the Invisible Test Server at
  `https://games.invisiblewall.org/<key>/`.
- **Access:** the `gameMaker` tool, granted by default to `admin`, `developer` and
  `pipelineTester` roles (overridable per role/user in the admin panel like any tool). **Creating**
  a project is available to any holder of the tool; **Publishing** currently
  requires the admin-panel capability — i.e. publish is an `admin`-only operation
  in Phase 1.

## How to use it

The page has two cards: **Create a game** and **Your projects**. Each project in
the second card shows what kind of game it is and which features it uses, can be
filtered/sorted/grouped by client, and can be duplicated onto a new key.

### Create a game

1. Fill in the **Name** (e.g. `Book of Borut`). As you type, a URL-safe **Key**
   is auto-derived (lowercased, non-alphanumerics collapsed to `-`); it stops
   auto-following once you edit the Key by hand. The key must match
   `a-z 0-9 _ -` (max 64 characters) and becomes the project key **and** the
   eventual game key.
2. Pick a **Client** from the dropdown, or leave it **Unassigned**.
3. Pick a **Game type**. The list is the same union the `/admin` create-project
   action offers — the built-in scene sets (`lines`, `ways`, `cluster`,
   `scatter`, `bookOf`) plus any author-created custom kinds. The game type seeds
   the project's starting layout template.
4. Click **Create project**. This creates the launcher project and scaffolds its
   cloud tree (the same scaffold the `/admin` create action produces:
   `editor/scenes.json`, `atlas_config.json`, `manifests/`, `input/refs/`,
   `sheet_config.json`, `localization/strings.json`). A confirmation appears and
   the project shows up under **Your projects** below.

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
  — once published — which shared engine runtime serves it and which mock-RGS
  protocol it is dealt. A last chip says whether the project has authored its own
  Game Config or is still inheriting its game type's template.
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

- **New name / new key / client** — the key auto-follows the name until you edit it,
  same as the create form.
- **What to copy:**
  - **Game setup only** (default) — scenes, both flow docs, Game Config, symbols,
    win text, strings, the project's editor components and their defaults, plus the
    atlas/sheet config seeds. Fast; the copy keeps the entire game and points at no
    art yet, which is what you want when new art is coming.
  - **Everything, including atlases, spines and fonts** — additionally copies the
    asset folders, so the copy plays immediately and you replace art in place.
    Large projects take a while and very large ones are refused outright (move
    those with the [FTP Browser](ftp-browser.md) instead) — the copy is never
    silently truncated.

Asset references **inside** the copied documents are re-pointed at the new project
as they are copied, so the duplicate never quietly reads the original's files (and
does not break when the original is edited or deleted). The copy inherits the
source's game type, is created unpublished, and mints its own read token on its
first publish.

You need the Game Maker tool and access to the source project; unlike Publish, it
is not admin-only.

### Publish (and Re-publish)

Each project card under **Your projects** carries a **Publish** button (it reads
**Re-publish** once the game already exists). Clicking it runs the server-side
publish, which:

1. **Freshens the `deploy/` exports** so the live runtime serves the project's
   current art, fonts, and symbols (the same export step the live editor runtime
   uses — `ensureDeployExports`).
2. **Mints (or reuses) a per-project read-only token** that gates the public live
   fetches the running game makes back to the launcher (its layout doc + deploy
   assets). The shared deploy token is never exposed to the browser.
3. **Merges the test server's manifest** (`test_server/games.json`,
   read-modify-write so siblings are never dropped) with this game's
   `{ protocol, name, runtime }` — `protocol` is the mock RGS to spin against
   (`book` for book-of games, otherwise `lines`); `runtime` is the prebuilt
   generic bundle id. It also writes the pointer (launcher origin + read token)
   the test server uses to re-read the project's [Game Config](/docs/game-config)
   live, so **changing the game's math afterwards does not need a re-publish** —
   the mock picks up a new grid, payline set or win model within seconds of a save.
   The board/cascade values written here are only the fallback for when the
   launcher can't be reached.
4. **Registers the portal game** with a launch URL that points the generic
   runtime at _this_ project's live data
   (`…/<key>/?runtime=1&project=<key>&k=<readToken>&…`), gated by the read token,
   wired to the per-key mock RGS proxy.
5. **Refreshes the test server** (best-effort — a slow or failed refresh never
   fails the publish; the server re-hydrates on its own cadence too).

When it finishes, the page reloads the row to show the new state: a **Play ↗**
link that opens the game in a new tab, a **Copy URL** button, and the full play
URL beneath. The game also appears in the launcher portal's **Games** section, and
plays at `https://games.invisiblewall.org/<key>/`, spinning against the mock RGS
(fake money, no real spend).

The two small dropdowns beside **Play ↗** choose the **language** and the
**currency** that link opens the game in (`?lang=` / `?currency=`) — the same pair
of pickers as the portal's **Games** section, and the choice is remembered across
both. Currency changes only how amounts are _formatted_: the mock wallet holds the
same fake money whatever you pick, so this is the way to check a HUD in `EUR`,
`BRL`, or a long code like `XGC` without touching the RGS. The **Copy URL** button
deliberately copies the _player's_ URL, without these authoring overrides.

A language the project has no translations for renders in the source language — an
untranslated locale falls back by design, so the game looks like it "ignored" the
setting. Check the row is actually translated **and reviewed** in `/localization`:
only reviewed strings reach a player or the published bake.

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
**Your projects** header carries two bulk buttons (admins only, the same gate as
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
never overwritten, and a game that fails is reported in place while the run
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

## Known limitations / TODOs

- **Phase 1 supports `lines`-type games only.** The Game-type picker lets you
  create any kind, but **publish currently maps every project to the `lines`
  generic runtime** — the only prebuilt generic runtime that exists today
  (Phase 0). `ways` / `cluster` / `scatter` / `bookOf` runtimes arrive in
  **Phase 3** (each is one prebuilt bundle plus the `gameType` runtime switch).
  Publishing a non-`lines` kind today will run it through the `lines` runtime.
- **Reskin / template games, not yet fully custom behavior.** Background, scenery,
  HUD, free-spin intro/counter/outro, loading splash, board position/shape/spin
  feel, fonts, localized text, and per-instance prefab art are already driven by
  the online doc + R2 assets, so reskins and template-composed games work. Truly
  **novel** game behavior — the per-event animation timeline — is still per-game
  TypeScript; the declarative behavior-track format that unlocks it fully online
  is the **Phase 4** engine project (`tracks?: BehaviorTrack[]`, reserved but not
  built).
- **Per-game math is not yet authored here.** Reelstrips / paylines / paytable /
  bet modes still ship compiled per runtime; moving them to R2 JSON with a loader
  is **Phase 2**. Until then a published game runs on its runtime's default math.
- **Publish is admin-only for now.** Any tool holder can create projects, but the
  publish endpoint is gated by the admin-panel capability. Widening this to
  `developer` is a deliberate later decision.
- **Mock RGS only.** Published games spin against the faithful-but-fake mock RGS
  on the Invisible Test Server (shared `sessionID=demo`, fake balance, resets on
  restart). This is a test/preview surface, not a real-money deploy. See
  [`test-server.md`](test-server.md).
- **Runtime-mode localization is a known deferred gap** — i18n initialises at
  module-eval, before the live bundle fetch, so the runtime merge of project
  strings is not yet wired.
