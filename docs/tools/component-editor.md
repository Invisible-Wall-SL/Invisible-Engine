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
  one of the same id. A component you create here is **project**-scoped. Saving writes a
  component back where it came from — so one opened from the shared library (every built-in
  is one) saves to the shared library; see [Traps](#traps).

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
  - **HUD readout** — an empty value readout (filed under `UI`), pre-declared with a
    **source** (balance / win / bet …) and the engine-fed **value**. Drop your own
    background and text, then on the text that shows the number set **Bind to param →
    Text ← value**. You pick the **source** on each placed instance.
  - **Free-Spin Counter** — a project copy of the built-in counter (frame, **FREE SPIN**
    caption and **X OF Y** value), already wired to the engine. Swap the frame art,
    restyle the text or edit the label, then save.
  - **Pot Meter**, **Respin Counter**, **Jackpot Tile**, **Jackpot Bar** and **Total Win Bar
    (Hold and Win)** — project copies of those built-ins, all but the Jackpot Bar with their coded
    part. Put your own nodes inside the part (see
    [Skin a coded part](#skin-a-coded-part)). Offered in a
    Hold and Win project only.
- **Library** — existing components grouped by category. Click a row to open it for
  editing; the `✕` button deletes it from R2 and the list. The confirm asks you to type the
  component's name, and every saved version goes with it.

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

The editor bar above the panes shows the open component (**◇ name**) and a **Space**
selector:

- **Game (main box)** — the default. The component is positioned in the game's main box,
  relative to the board, so the canvas matches this project's layout.
- **Canvas (full-window overlay)** — for a full-window layer such as a free-spin intro dim
  or a modal backdrop, authored in raw window pixels. Place a Canvas component on a
  Canvas-space screen in the Scene Editor so the editor and the game match.

### 3. Bind the engine variables

The **Component variables** block at the top of Properties is where you declare the
component's contract — the *declare* half; the game supplies the values and fires the
signals. It has two lists, each with its own add button:

- **Variables in use** — click **+ Add variable** to open a searchable picker with two
  groups:
  - **Live game values** — Bet, Win, Balance, Total Win, Free Spins, Free-spin Outro Total,
    Message, Loading Progress, the Auto Spins values and the rest of the engine catalog. A
    value already added shows *in use*. Adding one only **declares** it — it does not feed a
    hand-built component (see [Traps](#traps)).
  - **Custom input** — type a name (e.g. `bg`), pick a kind (**string / image / number /
    color / boolean**) and click **Add**.

  Each row shows a badge — **engine** or **yours** — and its kind, and **×** removes it
  (*Unsubscribe value* / *Delete custom input*). A custom input also gets a **default**
  field (a region picker for an image, a colour field, a checkbox, a number or text box; a
  font dropdown when the input drives a font), and a string input gets an **options** box:
  type comma-separated values and every placed instance shows that input as a dropdown.
  A component that already carries a live-value **source** (a Text Box, a HUD Readout) has
  no **+ Add variable** — the block says it is *Engine-fed* and names the source options
  instead.
- **Signals in use** — click **+ Add signal** to open a searchable picker of the signals this
  project's kind fires, grouped by family. Every kind gets Enter, Win, Big Win, Win —
  count-up complete, Free-spin start / end, the Free-spin outro signals, Book reveal / hide,
  Board glow show / hide and **Platform jackpot won**. A Hold and Win project also gets:
  - **Pots**: specials take off, special lands, level up, size stage up, full, activate.
  - **Respins**: counter reset, last respin.
  - **Coins**: land, collected, boosted, upgraded.
  - **Jackpots**: jackpot won.
  - **Letters**: letter lit.
  - **Wheel**: spin, land.
  - **Feature**: enter, exit.

  The game fires all of these from its own beats; no Flow wiring is needed. The Hold and Win
  ones are fired only in a Hold and Win game, so in any other kind those names stay free for
  your own Flow cues. Under **Flow cue**
  you can type any name a Flow **Fire Cue** node broadcasts (e.g. `frogCheer`) and click
  **Add**. A row marked *per meter*, *per tier* or *per reel* is a scoped signal (see
  **scoped by** below). **×** removes a signal.

  A declared signal is a suggestion, not a requirement. The **signal** field of a spine's or a
  flipbook's **Plays on signal** cue, a node's **hidden until signal** and a Tap to Continue's
  arming signal are all free text, and they suggest the declared names first. Any name works.
- **scoped by** … **as a** — the param that says which part of a repeated feature a placement
  stands for, and what kind of part it is (**meter**, **tier** or **reel**). Picking a param
  named `meter`, `tier` or `reel` fills in the kind for you.

  A placement then hears only its own part's signals of that kind. Put the component on the red
  pot (`meter` = `red`, as a meter), give its frog spine a cue on **Pot — activate**, and it
  plays when the red pot activates and stays idle when the blue one does.

  Everything inside it is scoped the same way: its cues, its reveal gates, a component nested in
  it, and an Invisible FX effect placed in it. Two kinds of signal still reach every placement:
  those about another kind of part (the red pot still hears **Jackpot won** on GRAND) and those
  about no part (Win, Feature — enter). **(none)** means every placement hears every fire.

  A source key scopes by its id: `jackpot.grand` is `grand`, `meter.red.level` is `red`. The
  built-in **Pot Meter** is scoped by `meter` as a meter, and the **Jackpot Tile** by its
  `source` as a tier.

Between the two lists, **Show button images** opens the per-state image set for a button:
tick the interaction states you need and pick each state's art (bind your background
sprite's region to **normal**; the engine swaps it on hover / press / selected / …). Each
state can still be overridden per placement.

A custom input does nothing until a node reads it. Select a node and use its **Bind to
param** section to point a field at an input: **Image — atlas frame ← param** or the tint
on a sprite, **Text ← param** and the font / size / colour fields on a text node. Then set
the value per placement when you drop the component in a scene; until then the default
applies.

Most of the time you skip the manual steps and use the **one-click button per node
kind**, which creates the inputs and binds them for you:

- **text** — **✨ Expose text as params (per instance)** creates inputs for the node's
  content, font, size and colour, grouped under the node's name.
- **sprite** — **✨ Expose image as param (per instance)** creates an `image` input bound to
  the frame; the current frame becomes its default.
- **spine** — **✨ Expose spine as param (per instance)** does the same for the rig.

Each has an undo button — **Remove exposed parameters**, **Remove exposed image**, **Remove
exposed spine** — that drops the binding and the input it made and restores the fixed
value. A field bound by hand shows a *"bound to … — static value ignored in instances"*
note, so you know the placement's value, not the one typed above, is what shows.

**If an instance control does nothing, the node is not bound.** A component that
replaces a coded part with its own node (say a HUD Readout whose coded background
tile was swapped for a project frame) still lists the coded params — the engine
adds them to every saved copy of a built-in — but nothing in *your* copy reads
them until you bind a node to one. Expose or bind the node and the control comes
alive.

### 3b. Drive a node from a number (Bind to value)

**Bind to param** sets a field once per placement. **Bind to value** makes a node follow a
number while the game runs: a pot's liquid fills with its level, a character's belly bone
grows, a badge shows once the pot is full, a bar drains as the respins run down. Select a
node and use the **Bind to value** section at the bottom of Properties. **+ drive…** adds a
binding; a node can carry several. Each binding has these parts:

- **drives** — what the number changes:
  - **Move x / Move y** — pixels added to the node's position (y positive moves down).
  - **Scale / Scale x / Scale y** — multiplies the size; 1 is the size as drawn.
  - **Rotate** — degrees added, clockwise.
  - **Opacity** — multiplies the node's alpha.
  - **Show / hide** — shows the node while the number is at or above a **threshold**, or
    below it with **show below instead**. Pot size stage ≥ 2 and pot full ≥ 1 are typical. A
    hidden node is taken out like any hidden node, so when it shows again a spine starts its
    animation from the top and a component plays its *enter*.
  - **Fill (reveal)** — sprite, flipbook and rect only. Shows the node from one edge
    (**left → right**, **bottom → top**, …): 0 is hidden, 1 is whole. This is how a bar or a
    pot's liquid fills.
  - **Clip frame** — flipbook only. Holds the clip on one frame instead of playing it; the
    frame counts the clip as authored, first frame = 0.
  - **Scrub animation** — spine only. Holds one of the rig's animations at a point: 0 is its
    first frame, 1 its last. It sits over whatever the rig is playing (only the parts that
    animation moves are held, so the rest keeps moving), and it fires none of that animation's
    events.
  - **Spine bone** — spine only. Offsets one **bone**'s scale, rotation or position on top of
    whatever the rig is playing.
- **from** — where the number comes from:
  - **This component's params** — a number or boolean param of the component.
  - **Pot (this instance's meter)** — offered when the component has a `meter` param (the Pot
    Meter, or your own pot). The level, maximum, size stage and full flag are each read for the
    meter the placed instance names, so one pot design serves every pot.
  - **Hold and Win** — respins left and the respins cap, cells held and cells open, rows open
    and rows at most (an expanding board), collector level, letters lit, feature total.
  - **Game values** — the readout feeds: bet, win, balance, free-spin counts, jackpots…
  - **Custom source…** — any engine source by name. `{key}` reads one of the component's
    params, so `meter.{meter}.level` is the level of the instance's own meter.
- **divide by (normalise)** — a second source to divide by. It is filled in when the
  source has a known maximum (pot level ÷ pot maximum, respins left ÷ cap), so the number
  runs 0..1. Clear it to read the raw number.
- **in from / in to → out from / out to** — the input range maps onto the output range, in
  the unit the line under it names. By default the input stops at its ends (**stop at the
  ends of the in range**). **curve** shapes the mapping (ease in / out, overshoot, five
  steps). **glide (s)** makes the output travel to each new value over that many seconds
  instead of jumping.
- **test value** — drag it to preview the binding on the canvas: the input it stands for,
  and what it turns into. It is never saved, and it clears when you select another node.
  **Stop preview** puts the node back as authored. Selection handles and dragging always use
  the authored position. A binding that still lacks a number (or its animation / bone) says
  *Does nothing yet*.

The node is drawn as authored until its source reports, and in a game that doesn't
register the source at all (a pot source with no meter of that id in the Game Config).
A binding changes nothing you save but the binding itself.

### 4. Set this game's defaults

A **shared** component is one design used by several games, and a game usually needs
its own art and copy in it. **This game's defaults** — the teal block under
*Component variables* — is how you do that **without forking the def**: it stores the
open component's param values for the **active project only**, in a small sidecar
beside the component (`editor/<project>/component-defaults/<id>.json`), so the shared
def itself is untouched and every other game keeps its own look.

The panel lists **every settable param** of the open component (everything the engine
does not feed itself), grouped exactly like the instance panel in the Scene Editor —
images get the region picker, colours the colour field, fonts the font dropdown, a
param with a fixed option list its dropdown, booleans a checkbox, and everything else
a text or number box. It is hidden when no project is active, and while you are
inspecting a historical version (that canvas is a read-only snapshot) — entering an
inspect drops any unsaved default back to its last saved value, after warning you.

One gap to know about: the **spine animation / slot / bone** and **symbol state**
params fall back to a free-text box here, while the same param on a placed instance
in the Scene Editor gets a validated dropdown. Type those carefully, or set them per
instance instead.

**Inherit is the empty state.** A field you have not set reads *(inherit default: …)*
or shows the component's own default as its placeholder, and that key is simply
**absent** from the sidecar. Set one and a **×** appears next to it — click it to drop
back to inherit. Clearing a text box does the same thing. So the sidecar only ever
contains the handful of values this game actually overrides.

The canvas updates as you type, because the preview resolves the same three layers the
game does:

> component's own default ◁ **this game's defaults** ◁ the placed instance's override

so a placement in a scene can still override anything you set here.

**Saving is separate from the component.** The panel has its own **Saved / Unsaved**
badge and its own **Save for this game** button — the defaults are a different file
with its own version, so *Save component* does not write them and this does not write
the component. If someone else changed this game's defaults for the same component
while you had the panel open, the badge turns into a conflict with **Reload theirs**
and **Overwrite with mine** rather than quietly clobbering their values. Leaving the
tool (closing the component, or navigating away) warns while either store is unsaved.

**History…** next to *Save for this game* lists earlier saved versions of this game's
defaults for the open component, newest first. Each save keeps a copy of the version it
replaces (at most one every five minutes; the newest 20 per component are kept), and an
**Overwrite with mine** always keeps one. Pick a version and **Restore**: it is saved like
any other save — refused if someone else saved these defaults since you opened them — and
it keeps a copy of the version it replaces, so a restore can be undone from the same list.
The panel then shows the restored values; the component you are editing is left as it is.

### 5. Save

Click **Save component** in the editor bar. It saves the draft to the active project; the
pill beside it shows *Saving… → Component saved* (or a *Save failed* pill with the error).
On success the sidebar list updates without a reload. Use **← All components** to return
to the library (it confirms first if the component or this game's defaults have unsaved
edits).

If someone else saved the component after you opened it, Save asks **Save yours as a NEW
version on top of theirs?** — **Save on top** keeps their save as its own version, so
nothing is lost. Only one person edits a component at a time: when someone else (or
another tab of yours) has it open, a banner reads "*name* is editing this — read-only",
Save is disabled, and **Take over** moves editing to you.

The server **bumps the component's `version`** automatically when the saved draft
differs from the stored one (a re-save with no change keeps the version; a brand-new
component keeps its starting version). This is by design (§8.9, pin-by-default):
existing scene instances keep the version they pinned and are never silently moved
to your edit — they stay on their pinned version until you explicitly **update each
one to latest** from its Properties panel in the Scene Editor (see §6). Every save
also **retains the superseded def**: the server keeps each historical version (a
`<id>.v<N>.json` snapshot beside the `<id>.json` latest pointer), so a pinned instance
resolves the EXACT def it was authored against — in the editor preview, in the bake,
and in the shipped game.

**Browse older versions.** While a component is open, the editor bar has a **Version**
dropdown listing every saved version (the latest is marked). Pick one and click
**Inspect** to load it **read-only** onto the canvas — an amber **◷ Inspecting vN
(read-only)** pill shows, and Save, Promote and editing are blocked. **← Back to latest**
returns to the editable current version. Inspecting never changes what is saved.

**Spines from another project are re-pointed on save.** A spine node's rig belongs to the
project it was rigged in, and the build only ever ships rigs from the project being built (or
from the shared spine library). So if a component holds a rig under a *different* project's
prefix, that art would be missing in every game — the component would render, the spine simply
would not be there, and the browser console would say `Spine: key "…" is not found in
loadedAssets`. On save the server fixes it for you where it can:

- the same rig is already in the **shared spine library** → the node is re-pointed at it,
  silently, and everything keeps working;
- the node's rig is driven by a **spine variable** → the stale rig on the node is cleared, since
  the variable is what actually picks the rig;
- otherwise the save is **refused**, naming the rig. Ask an admin to promote it in
  **/admin → Spines**, then save again — the component will then point at the shared copy by
  itself. (This also applies to **Promote to shared** below: once shared, a component is
  inherited by every project, so it may not depend on any one project's rigs.)

**Promote to shared.** Holders of the **`componentPublish`** capability (admin by
default, grantable per role/user in `/admin`) also see a **Promote to shared** button
in the top bar while a component is open. It saves a repo-wide copy to the shared
library (`_shared/editor-components/<id>.json`) that every project inherits, gated
behind a confirm. It is a **snapshot**: the component you keep editing here stays a
**project** component, and a project component of the same id still **shadows** the
shared copy wherever it loads — promoting does not move or delete your project copy.
Users without the capability never see the button (the API enforces the same gate
server-side, so there is no button that would 403).

### 6. Use it in the Scene Editor

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

## Skin a coded part

Some built-ins draw a **coded part**: the game draws it, and the canvas shows a grey stand-in box.
The Hold and Win **Pot Meter**, **Respin Counter** and **Jackpot Tile** have parts you can skin.
The Pot takes two ways, which you can use together.

**1. Pick art on the placed pot.** Select a Pot Meter instance in the Scene Editor. Its
**Pot art** group sets that one pot's look, so red, blue and green can each have their own art:

- **pot**: the pot body.
- **fill**: revealed by the meter's level. **fill grows towards** picks the edge it grows to:
  **up** for liquid rising in a pot, **right** for a bar.
- **frame**: drawn over the fill.
- **pot from size stage 1–3**: the body from that size stage on. A stage with no image keeps the
  one below it.
- **width / height**: a box for every layer. Blank means each image's own size.

Any pot image replaces the coded bar as a whole. The **Label** group shows or hides the level
(`RED 3/12`) and what a full pot activates, and sets their font, colour and size. The **Motion**
group sets the growth per size stage (0 = none) and the pulse when the pot fills (1 = none). With
nothing set, the pot draws exactly the coded bar. The canvas shows the art, with the fill drawn
part-full so you can see which way it grows. The labels and the size stages show only in the game.

**2. Put your own nodes inside the part.** Create a component of type **Pot Meter (Hold and Win)**,
a copy of the Pot Meter for this project. Click **Edit inside Pot ›** in the editor bar. The canvas,
Outline and Library now work on the part's own nodes. Drop a spine, an effect, sprites or text
there, at positions relative to the pot's centre. In the game, your nodes replace the coded bar and
both labels. Any art picked on the instance still draws under them. The part keeps its behaviour:

- It follows its meter's level.
- It grows at each size stage and pulses when the pot fills.
- The specials still fly into it.
- It still counts as that meter's pot, so the game does not draw its own pot for that meter.

You can also delete the **Pot** part and draw the pot entirely with your own nodes. The
component still counts as that meter's pot, and the specials fly to the centre of your nodes. It
no longer grows or pulses on its own. To make your nodes follow the level, use
[Bind to value](#3b-drive-a-node-from-a-number-bind-to-value) on `meter.{meter}.level`.

**↩ Back to …** returns to the component. Save it, then in the Scene Editor select each Pot Meter
on the **Pots** screen and switch its **component** to yours in Properties. It keeps its position
and its **meter** param.
Do not skin the built-in **Pot Meter** itself: saving it writes the shared library (see
[Traps](#traps)).

**The Respin Counter.** Its frame, caption and value sit inside its **Counter** part. Create a
component of type **Respin Counter (Hold and Win)** and click **Edit inside Counter ›** to restyle
them, or add your own nodes there. The part keeps its behaviour:

- The "+N" of an add-respins special flies to it.
- It counts as the respin counter, so the game does not draw its own.
- It pulses on every reset and "+N" when you set **pulseScale** on the instance (the game's own
  counter uses 1.35). The default, 1, keeps it still, as it always was.

Delete everything inside the part and it draws the game's own counter look, "RESPINS 3" with the
active modifiers under it, at your position. On the **Respin counter** screen, switch the Respin
Counter's **component** to yours.

**The Jackpot Tile and Bar.** A tile's frame, caption and value sit inside its **Tile** part.
Create a **Jackpot Tile (Hold and Win)** and click **Edit inside Tile ›** to restyle them or add
your own nodes. The part pulses the tile when its own tier is won, if you set **winPulseScale** on
the placement; the default, 1, keeps it still. Its tier comes from **source**: `jackpot.grand`
pulses on a GRAND jackpot win, `platformJackpot.grand` on the platform's.

The bar is four tiles. Create a **Jackpot Bar (Hold and Win)** to skin it:

- Add your own frame around the tiles.
- Restyle each tile on its placement (frame image, label, colours).
- To use your own tile, select a tile and switch its **component** to your Jackpot Tile copy.

On the **Jackpot bar** screen, switch the Jackpot Bar's **component** to yours.

**The Total Win Bar.** Its frame, caption and value sit inside its **Bar** part. Create a **Total
Win Bar (Hold and Win)** and click **Edit inside Bar ›** to restyle them or add your own nodes. Two
settings on the placement, both off by default:

- **catchesCoins** — the feature end's coins, and a swept Grand column's, fly into this bar instead
  of the win meter. While the bar is hidden they still fly to the win meter.
- **landPulseScale** — the bar pulses on each coin that lands (1 = still).

On the **Total win bar** screen, switch the Total Win Bar's **component** to yours.

## Traps

- **You edited a built-in or shared component and it changed in another game — or Save was
  refused.** A component opened from the shared library saves back to the shared library. With
  the `componentPublish` capability that changes it in every project without its own copy;
  without it, Save fails with *"Your role cannot publish to the shared component library."* To
  make one game look different, use [This game's defaults](#4-set-this-games-defaults); for a
  design of your own, create a new component.
- **You added a live game value with + Add variable, and the game still shows the placeholder.**
  Adding a live value only *declares* it; nothing feeds a hand-built component by that name. The
  only live feed is a **source** param, which the built-in **Text Box** carries. Place a Text Box
  in the Scene Editor, pick its **live value source**, and remove the unused variable.
- **A placed instance has no Tap to continue section.** Tap to continue (and On loaded) are offered
  only on instances of an **Overlay** component, and a component's category is chosen once, when
  you create it — a Button is always UI. Create it as **Blank** with category **Overlay**.
- **An instance control does nothing.** The node it should drive isn't bound — see the note at the
  end of [Bind the engine variables](#3-bind-the-engine-variables).
- **A value-bound node never moves in the game.** Its source isn't registered there. A pot source
  needs a meter with that id in the project's Game Config, and the Hold and Win sources exist only in
  a Hold and Win game. Check the instance's `meter` param, or pick the source from the list rather
  than typing it.
- **A Fill binding shows the whole sprite in the game.** The fill is measured from the art's size,
  so it waits until the art has loaded. A cover node (a full-bleed background) never fills.

## Known limitations / TODOs

These reflect the registered editor design (`docs/design/invisible-editor.md`
§8.5–§8.10) and the current build:

- **The behaviour/timeline layer is not authored here yet.** Numbers can drive a node
  ([Bind to value](#3b-drive-a-node-from-a-number-bind-to-value)), and a spine or
  flipbook can play on a signal. Signal-triggered tweens and particle bursts are
  the next, large phase. The `Component variables` block is purely the *declare*
  half.
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
  **updated to latest** per instance (§6). The version browser (§5) is read-only: there is
  no "restore to this version" action yet (restoring would just be a normal save of the
  inspected def, which bumps a new version on top — deliberately left out so browsing
  stays purely non-destructive). One precise engine remainder: the bake walks only
  top-level scene pins, not the transitive nested-pin closure — to be widened when a game
  first nests a pinned instance (no game pins any version yet).
- **Nesting depth is capped at 2.** Components-inside-components expand to
  `MAX_COMPONENT_DEPTH = 2` (`engine-layout` `registerComponents.ts`), enforced by
  both renderers with a transitive cycle guard (`ComponentInstance.svelte`); beyond
  that, expansion stops rather than recursing.
- **Unsaved drafts are in-memory only.** A never-saved component exists only as the
  open draft; closing the tool or navigating away discards it (you are warned
  first). There is no autosave — and **This game's defaults** (§4) is a second,
  separate manual save, warned about the same way.
- **A shipped game only picks up new defaults on its next publish.** Both editor
  canvases resolve the sidecar live, but a built game reads the defaults baked into
  its bundle — so re-publish (or re-bake) the game after changing them.
- **Save writes back to the component's own scope; promote-to-shared is exposed.** The
  primary **Save component** writes a project component to the project (where it shadows a
  shared one of the same id) and a shared or built-in one to the shared library. There is no
  "copy to this project" action yet. A separate **Promote to shared** button — gated on the
  `componentPublish` capability (admin-only by default, grantable per role in
  `/admin`) — writes a `scope:'shared'` snapshot to the `_shared/editor-components/`
  library. Creating a component straight into the shared library (no project copy), and a
  promote-from-the-Library-row affordance for components you are not currently editing,
  are not built yet.
