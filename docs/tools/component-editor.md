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
- **Access:** granted to the `admin`, `developer`, and `artist` roles — the
  same roles that get the Scene Editor. The page gates on the **`editor`** tool
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
  - **Library** — drag elements onto the canvas: a **Text** node, a **Container**
    (group), atlas pages, **spines**, and sheet/atlas-manifest **regions** (expand
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

For text nodes there is also an **Expose as params** shortcut: it creates grouped
author params for the node's text / font / size / colour and binds the node's
fields to them in one click, so every placed instance can edit that text. The
inverse un-exposes them and restores the static values. A bound field shows a
"bound to … — static value ignored in instances" note so you know the instance,
not the static value, wins.

### 4. Save

Click **Save component** in the top bar. It POSTs the draft to
`/api/editor/component` scoped to the active project; the header pill shows
*Saving… → Component saved* (or a *Save failed* pill with the error). On success
the sidebar list updates without a reload. Use **← All components** to return to
the library (it confirms first if you have unsaved edits).

### 5. Use it in the Scene Editor

Open the Scene Editor and find the component in its **Components** panel (grouped by
the same categories). From there you can:

- **Place** an instance into the active scene (drops a `componentInstance` node),
  then edit its param overrides and per-layout transform in the scene's Properties.
- **Open in the Component Editor** (the `◇ Open …` link or a component row), which
  deep-links back here on that component's id.

You can also start a component from the Scene Editor's "Edit as component" on a
container, then refine it here.

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
- **Versioning is by design but partly unspecified.** Components are versioned and
  instances pin a version; the "update an instance to latest" action and how a
  bumped component flags its outdated instances are still to be specced.
- **Nesting depth is not finalised.** Components-inside-components is recommended
  at 1–2 levels with a hard cycle guard; the exact depth is unconfirmed.
- **Unsaved drafts are in-memory only.** A never-saved component exists only as the
  open draft; closing the tool or navigating away discards it (you are warned
  first). There is no autosave.
- **Components are project-scoped on save.** Authoring here always writes a
  project component (which shadows a shared one of the same id); promoting to the
  shared global library is not exposed in this UI.
