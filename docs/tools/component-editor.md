# Invisible Component Editor

Author reusable game components — overlays, UI groups, and scenery you build once
and drop across scenes in the Invisible Editor. You compose a component's element
tree on a canvas, declare the engine variables it consumes, and save it to the
project's component library.

## What it is

A standalone authoring tool for **components** (prefabs): a named tree of layout
elements — text, containers, atlas regions, spines — that the Scene Editor places
as a single reusable instance. It reuses the Scene Editor's own canvas, outline,
and properties machinery, so editing a component feels exactly like editing a
scene — except you are editing one self-contained object in a fixed `desktop`
design box rather than a whole game screen. A component is one design; the Scene
Editor owns the responsive per-layout overrides when an instance is placed.

Each component is a `ComponentDef` with a `root` container and three kinds of
metadata you author here:

- **Params** — typed inputs an instance (or the engine) feeds in: engine-provided
  values (bet, win, balance, …), an `action` for a button, or custom author
  params you bind to a node's image / tint / text.
- **Signals** — named moments the engine fires (enter, exit, win, …). You declare
  the names; the game wires book events to them in code.
- A **category** (`UI`, `Overlay`, or `Scenery`) used to group it in the library.

The tool only **declares** the engine contract — the game supplies the values and
fires the signals. This is the "declare ≠ implement" split from the editor design
(`docs/design/invisible-editor.md` §8): the editor says *"show the live `value`
of `win` here"*; the game says *"`win` is the `winInfo` book event."*

- **Where it runs:** the launcher itself, at `/components` — a real full-page
  route inside `(app)`, behind the auth + role gate. It is not a redirect and
  never an iframe. SSR is disabled (it is a client-only canvas/WebGL app); only
  `load` runs server-side to fetch the components, assets, and saved defaults.
- **Access:** granted to the `admin`, `developer`, `artist` and `pipelineTester`
  roles — the same roles that get the Scene Editor. The page gates on the **`editor`** tool
  (the component storage + `/api/editor/component[s]` API are gated there too), so
  anyone who can open this page can always read and write its components. The
  separate `componentEditor` tool entry only controls whether the home grid shows
  the tool card. Both are overridable per role/user from the admin panel.
- **Scope:** components are loaded for the session's **active client/project**
  (shown in the top bar as `client/project`). The library is the project's
  components plus the shared global library; a project component shadows a shared
  one of the same id. Saving from here writes a **project**-scoped component.

## How to use it

### 1. Create or open a component

Open **Invisible Component Editor** from the launcher home. The home state shows a
**Components** sidebar with two sections:

- **New component** — type a name, choose a **type** and (for blank) a **category**,
  then **Create**:
  - **Blank** — an empty root in the category you pick (`UI` / `Overlay` /
    `Scenery`). You drop your own art onto it.
  - **Button** — a pre-wired clickable component (always filed under `UI`). It
    starts blank too, but is pre-declared with the `action` param: drop your art
    on the canvas and the whole component becomes the click area; you then pick the
    **Action** (spin, menu, turbo, …) on each placed instance back in the Scene
    Editor. No extra wiring needed.
- **Library** — existing components grouped by category. Click a row to open it for
  editing; the `✕` button deletes it (with a confirm) from R2 and the list.

Creating opens the new component immediately. The Scene Editor's "Open Component
Editor" also deep-links here (`/components?id=<id>`) and opens that component on
load. A newly created component lives only in memory until you save it — closing
or navigating away warns you it will be discarded.

### 2. Build the element tree

With a component open, the layout switches to the familiar three-pane editor:

- **Left** has two tabs:
  - **Library** — drag elements onto the canvas: a **Text** node, a **Rect** fill,
    atlas pages, **spines**, and sheet/atlas-manifest **regions** (expand
    a sheet or manifest to see its named regions and drag one in).
  - **Outline** — the open component's node tree; click to select (shift/⌘/ctrl-click
    to multi-select), and rename a node's outline label.
- **Centre** is the canvas: a fixed standard design frame around just this
  component. Drag, transform, and arrange nodes exactly as in the Scene Editor.
  Selecting a node here drives the right panel — no tab switch needed.
- **Right** is **Properties** for the selected node, plus the **Component variables**
  block at the top (see below).

The footer shows the component name and its node count. Panel widths are
resizable and persist under this tool's own key.

### 3. Bind the engine variables

The **Component variables** block at the top of Properties is where you declare the
component's contract. It has three parts:

- **Engine params** — tick the engine-provided values this component consumes from
  the curated catalog (bet, win, balance, …). When a component is bound to a live
  value feed (a `source` param), Properties shows the bound feed and where to set
  its default instead of a checklist.
- **Your params** — custom author inputs. The flow is three steps: **(1)** add a
  param here (give it a name like `bg` and a kind — string / image / number /
  color / boolean); **(2)** select a node and, under its **Bind to param**, point a
  field at the param — an image/region or tint on a sprite, or text / font / size /
  colour on a text node; **(3)** set the value per instance when you place the
  component in a scene. Each param can carry a **default** used by the preview and
  by every placed instance until overridden.
- **Engine signals** — tick the named moments the engine should fire for this
  component (enter, exit, win, …). You declare the names only; the game maps book
  events to them.

Steps 1 and 2 have a **one-click shortcut per node kind**, which is the usual way
to do this:

- **text** — **Expose as params** creates grouped author params for the node's
  text / font / size / colour and binds the node's fields to them.
- **sprite** — **Expose image as param** creates an `image` param and binds the
  node's frame to it, so each placed instance picks its own art (the sprite's
  current frame becomes the default).
- **spine** — **Expose spine as param** does the same for the rig bundle.

Each has an inverse that un-exposes and restores the static value. A bound field
shows a "bound to … — static value ignored in instances" note so you know the
instance, not the static value, wins.

**If an instance control does nothing, the node is not bound.** A component that
replaces a coded part with its own node (say a HUD Readout whose coded background
tile was swapped for a project frame) still lists the coded params — the engine
adds them to every saved copy of a built-in — but nothing in *your* copy reads
them until you bind a node to one. Expose or bind the node and the control comes
alive.

### 4. Save

Click **Save component** in the top bar. It POSTs the draft to
`/api/editor/component` scoped to the active project; the header pill shows
*Saving… → Component saved* (or a *Save failed* pill with the error). On success
the sidebar list updates without a reload. Use **← All components** to return to
the library (it confirms first if you have unsaved edits).

The server **bumps the component's `version`** automatically when the saved draft
differs from the stored one (a re-save with no change keeps the version; a brand-new
component keeps its starting version). This is by design (§8.9, pin-by-default):
existing scene instances keep the version they pinned and are never silently moved
to your edit — they stay on their pinned version until you explicitly **update each
one to latest** from its Properties panel in the Scene Editor (see §5). Every save
also **retains the superseded def**: the server keeps each historical version (a
`<id>.v<N>.json` snapshot beside the `<id>.json` latest pointer), so a pinned instance
resolves the EXACT def it was authored against — in the editor preview, in the bake,
and in the shipped game. Loading an older version is available via
`GET /api/editor/component?id=…&version=<N>` (the UI to browse versions is not built
yet).

**Promote to shared.** Holders of the **`componentPublish`** capability (admin by
default, grantable per role/user in `/admin`) also see a **Promote to shared** button
in the top bar while a component is open. It saves a repo-wide copy to the shared
library (`_shared/editor-components/<id>.json`) that every project inherits, gated
behind a confirm. It is a **snapshot**: the component you keep editing here stays a
**project** component, and a project component of the same id still **shadows** the
shared copy wherever it loads — promoting does not move or delete your project copy.
Users without the capability never see the button (the API enforces the same gate
server-side, so there is no button that would 403).

### 5. Use it in the Scene Editor

Open the Scene Editor and find the component in its **Components** panel (grouped by
the same categories). From there you can:

- **Place** an instance into the active scene (drops a `componentInstance` node),
  then edit its param overrides and per-layout transform in the scene's Properties.
- **Open in the Component Editor** (the `◇ Open …` link or a component row), which
  deep-links back here on that component's id.
- **Update an outdated instance to latest.** When you bump a component here, any
  placed instance still pinned to the older version shows an amber note in its
  Properties panel — *"Component vN available (instance pinned vM)"* — with an
  **↑ Update to latest** button. Clicking it re-pins **that one instance** to the new
  version (never bulk/auto), keeping your param overrides where the param still
  exists and dropping overrides for params the new version removed. Up-to-date
  instances show no note.

You can also start a component from the Scene Editor's "Edit as component" on a
container, then refine it here.

## Win Overlay — per-tier presentation

The built-in **Win Overlay** (`win`) component owns the big-win **presentation**,
split from the **structure** the `/config` **Big win tiers** panel owns (count / name
/ threshold / escalation — see [the Game Config guide](./game-config.md)). Its
Properties panel is **generated from the active game config's big tiers**: one
collapsible group **per tier, keyed by the tier's alias**, so authoring `big` / `mega`
/ `max` in `/config` yields exactly those three presentation groups (an un-authored
project shows the built-in default tiers). Each group has:

- a **spine bundle** picker (the tier's art);
- **intro / idle / outro** dropdowns of that spine's animations (no blind typing —
  when a tier's spine is unset the dropdowns list the base `winSpine` bundle's
  animations);
- a **duration** (ms) and **sfx** / **bgm** dropdowns of the game's real sounds (BGM lists the
  `bgm_*` music beds, SFX lists the one-shot cues). Empty ⇒ the config/coded sound.

Above the per-tier groups sit the base params (`winSpine` big-win bundle, count
`slotName`, coin-fountain toggle) and a shared **Animations (all tiers)** group that
applies to every tier unless a per-tier group overrides it.

**Live preview:** focusing a tier's spine or intro/idle/outro dropdown previews that bundle
playing that animation on the canvas (a spine field previews the bundle's idle), so the pick
is WYSIWYG. It's preview-only — nothing is written until you actually change a value.

**Resolution / fallback** (per field): the per-tier value ?? the shared set ?? the
config/coded tier's own value (`spineKey` / `animation` / `durationMs` / `sound`).
Every per-tier field is empty by default, so an un-authored Win Overlay renders
byte-identically to the built-in table. The animation + spine are consumed inside the
overlay; the duration + sound are bridged to the out-of-tree consumers (the win gate's
hold time and the win-level sound cues) at boot.

## Known limitations / TODOs

These reflect the registered editor design (`docs/design/invisible-editor.md`
§8.5–§8.10) and the current build:

- **Authoring is static + metadata only.** You can place elements and declare
  params/signals, but the **behaviour/timeline** layer (signal-triggered tweens,
  spine playback, particle bursts, count-up text from an engine param) is the
  next, large phase and is **not authored here yet**. The `Component variables`
  block is purely the *declare* half.
- **The behaviour ceiling is intentionally low (v1).** Even once timelines land,
  the design caps v1 at node-prop tweens + spine playback + signal-triggered
  tracks + a single count-up data binding. Anything needing branching, RGS math,
  or stateful logic stays a coded `mount` for now (a migration scaffold, not the
  destination).
- **No timeline / signal-track UI.** Signals can be declared but there is no
  per-signal track editor yet.
- **Versioning is pin-by-default with a true multi-version store (v2 landed).**
  Saving bumps the `version` on a changed def AND retains every historical version, so
  the engine resolves an instance's pin to the **exact** def it was authored against
  (the bake ships each pinned version too). When a pinned version isn't available the
  engine still renders the latest def and surfaces a `versionMismatch` warning rather
  than silently passing it off as the pin — the pin is never mutated or auto-upgraded.
  Outdated instances are **flagged** in the Scene Editor's Properties panel and can be
  **updated to latest** per instance (§5). A **version browser** lives in the top bar
  while a component is open: a `Version` dropdown lists every retained snapshot (the
  latest is marked), and **Inspect** loads the selected version **read-only** onto the
  canvas (an amber `Inspecting vN (read-only)` pill shows; Save / Promote / editing are
  blocked) so you can review an older def without touching the saved latest. **Back to
  latest** restores the editable current def. Inspection never writes to R2 — it GETs
  the immutable `<id>.v<N>.json` snapshot and discards it; there is no "restore to this
  version" action yet (restoring would just be a normal save of the inspected def, which
  bumps a new version on top — deliberately left out so browsing stays purely
  non-destructive). One precise engine remainder: the bake walks only top-level scene
  pins, not the transitive nested-pin closure — to be widened when a game first nests a
  pinned instance (no game pins any version yet).
- **Nesting depth is capped at 2.** Components-inside-components expand to
  `MAX_COMPONENT_DEPTH = 2` (`engine-layout` `registerComponents.ts`), enforced by
  both renderers with a transitive cycle guard (`ComponentInstance.svelte`); beyond
  that, expansion stops rather than recursing.
- **Unsaved drafts are in-memory only.** A never-saved component exists only as the
  open draft; closing the tool or navigating away discards it (you are warned
  first). There is no autosave.
- **Save writes a project component; promote-to-shared is now exposed.** The primary
  **Save component** always writes a **project** component (which shadows a shared one
  of the same id). A separate **Promote to shared** button — gated on the
  `componentPublish` capability (admin-only by default, grantable per role in
  `/admin`) — writes a `scope:'shared'` snapshot to the `_shared/editor-components/`
  library. Authoring a SHARED component as its only copy (no project shadow), and a
  promote-from-the-Library-row affordance for components you are not currently editing,
  are not built yet.
