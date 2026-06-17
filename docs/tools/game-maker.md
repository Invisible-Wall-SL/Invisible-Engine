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
*ship* that into a runnable game was to drop to the CLI, stand up a standalone
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
- **Access:** the `gameMaker` tool, granted by default to `admin` and `developer`
  roles (overridable per role/user in the admin panel like any tool). **Creating**
  a project is available to any holder of the tool; **Publishing** currently
  requires the admin-panel capability — i.e. publish is an `admin`-only operation
  in Phase 1.

## How to use it

The page has two cards: **Create a game** and **Your projects**.

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

### Publish (and Re-publish)

Each project row under **Your projects** shows its name, key, and client, plus a
**Publish** button (it reads **Re-publish** once the game already exists).
Clicking it runs the server-side publish, which:

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
   generic bundle id.
4. **Registers the portal game** with a launch URL that points the generic
   runtime at *this* project's live data
   (`…/<key>/?runtime=1&project=<key>&k=<readToken>&…`), gated by the read token,
   wired to the per-key mock RGS proxy.
5. **Refreshes the test server** (best-effort — a slow or failed refresh never
   fails the publish; the server re-hydrates on its own cadence too).

When it finishes, the page reloads the row to show the new state: a **Play ↗**
link that opens the game in a new tab, a **Copy URL** button, and the full play
URL beneath. The game also appears in the launcher portal's **Games** section, and
plays at `https://games.invisiblewall.org/<key>/`, spinning against the mock RGS
(fake money, no real spend).

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
