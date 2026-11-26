# Arcade prop components — a component that carries its own collision (Salmons' bridge first)

**Status: P1 (model and compile) and P2 (the rules read the shape) built 2026-11-26; P3 (one
river on both sides) built 2026-11-26; P4 (the seed def) built 2026-11-26; P5's mount and the
seed's code look built 2026-11-26; P5 built 2026-11-26 (the river draws the seed, the inputs
are fed, the code-drawn bridge is deleted); P6 (the ship chain) built 2026-11-26, in review;
P7–P8 planned; other obstacles (§9) planned after P8.** Owner ask of
2026-11-26, open questions answered the same day (§8). Agents:
`invisible-components` (the def, the editor, the ship chain) and `arcade-games` (the rules, the
generator, the room, the Salmons runtime). State, once building starts, goes in
[status/salmons](../status/salmons.md) (the rules and the runtime) and
[status/component-editor](../status/component-editor.md) (the editor and the def).

Builds on: [invisible-editor §8](invisible-editor.md) (the component contract),
[zone-art](zone-art.md) (what a zone family is drawn with), [salmons-levels](salmons-levels.md)
(generated levels, the room's `levelHash`), [realtime-multiplayer](realtime-multiplayer.md) (the
server owns the game).

## 1. The ask and what is decided

> "I would like to be able to author [the Salmon Bridge] as a component, with all it needs in the
> state machine, so I can change collisions and art easily." (owner, 2026-11-26)

Decided by the owner, not to be re-asked:

1. **Collision is authored in the component.** The def carries the walkable deck, the slopes and
   the height as shapes. The export turns them into the zone rules the server plays. Art and
   collision are edited in one place.
2. **The state machine reacts to** an *occupied* input, *step on* and *step off* triggers, and
   idle ambience. It stays **open**: the author adds inputs and states of their own.
3. **The component window sets depth per part:** which parts draw behind a character and which in
   front. For example, the deck and the railings over a fisherman walking under, and a fisherman
   standing on the deck drawn over the planks.
4. **`occupied` counts only the characters the prop carries** (§8 Q1): no `under` input.
5. **Railings may stop a fisherman stepping off the deck's side** (§8 Q3): a prop's `solids`,
   opt-in. The seed bridge has none.
6. **The code-drawn bridge is deleted** once the seed def matches it (§8 Q6, P5): no dual path.

Today's bridge is drawn in code (`salmonsArt/river.ts`, sizes shared with the rule through
`salmonsArt/bridge.ts`). Its collision is two constants and a hole cut in the water
(`salmonsRules.js` `bridges`, `salmons.js` `originalBounds`). `zoneArt` lists `bridge#` as
"drawn in code" (`/config` `zoneArtBuiltIn.ts`).

A **prop component** is a `ComponentDef` with a `prop` block. It is a piece of scenery placed on
every zone of one family. It is parametric in that zone's size, and its collider is data that the
rules read. The bridge is the first one. Others (a log, a jetty, a low branch) use the same block
later, with their own zone kind.

## 2. The model

The `stateMachine` stays presentation-only (`types.ts`: "it never decides game logic"). Collision is
therefore **not** in the state machine. It is a separate, declarative `prop.collider`. The **rules**
decide from it (on the server, and in the device's prediction). The **component** presents what the
rules decided, through inputs the arcade runtime sets.

```ts
// engine-layout types.ts (ComponentDef gains one optional block; absent ⇒ parity)
interface ComponentDef {
	prop?: ArcadeProp;
}

/** A length in cells: a number, or a param of the def plus an offset (parametric decks). */
type PropLength = number | { param: string; plus?: number };

interface ArcadeProp {
	/** The rules module's zone kind it compiles to (`ONLINE_ZONE_KINDS`): `'bridge'`. */
	zoneKind: string;
	/** The params the runtime fills per placed zone, all `engineProvided: true` on the def:
	 *  the deck's length in cells (the zone's `w / CELL`: the generator's gyEnd − gyStart + 1),
	 *  its height in cells (the zone's `height`, else the collider's). */
	fromZone: { length: string; height?: string };
	collider: PropCollider;
	/** Editor-only: the params the canvas previews at (a 6-cell deck, 6 high). Stripped for a game. */
	preview?: Record<string, number>;
}

interface PropCollider {
	/** Who it carries. Absent ⇒ the zone rule's own `characters` (Salmons: fisherman). */
	characters?: string[];
	/** The walkable top: along the deck from `from` to `to` cells (cell middles, as the rule's
	 *  `d.x + CELL/2` … `d.x + d.w − CELL/2`), `height` cells up. */
	deck: { from: PropLength; to: PropLength; height: PropLength };
	/** A character is put on the deck when its centre is within `snap` cells of the deck's row. */
	snap: number;
	/** The ramps from each bank to the deck end, `length` cells; the lift falls linearly to 0. */
	ramps: { near: { length: PropLength }; far: { length: PropLength } };
	/** How the water under it opens to `characters`: deck + ramps, padded by the body. */
	hole: 'deckAndRamps' | 'deck' | 'none';
	/** Optional extra blockers in the deck's own cell frame (a railing, a post, a gate). The
	 *  vocabulary is `TileCollide`'s: `solid` from every side, `oneWay` from the side it names (a
	 *  side exactly when one-way). Absent `characters` ⇒ the collider's. */
	solids?: { x: number; y: number; w: number; h: number; collide: 'solid' | 'oneWay';
		side?: 'below' | 'above' | 'left' | 'right'; characters?: string[] }[];
}

/** Per node (any node in `root`; a child inherits its parent's): how it sorts against characters. */
type PropDepth =
	| 'water'   // on the water surface, under everything that stands (the reflections)
	| 'behind'  // standing, under every character (the pillars, the slopes: today's upright layer)
	| 'sorted'  // among the characters by ground depth, with an old-px `zOffset` (default 1100, the deck)
	| 'over';   // over every character, the ones aloft on this prop included (an overhead arch)
// BaseNode gains `propDepth?: PropDepth; propZOffset?: number`; read only inside a `prop` def.

/** The compiled shape: plain JSON, what the server and the generator read. No art, no nodes.
 *  A field is present only when it differs from today's rule (§3). */
interface PropShape {
	from: { component: string; version: number };
	zoneKind: 'bridge';
	characters?: string[];
	height?: number;          // cells, the default when a level names none
	snap?: number;            // cells
	ramp?: { near: number; far: number };  // cells, both ends when either differs
	hole?: 'deckAndRamps' | 'deck' | 'none';
	solids?: PropCollider['solids'];
}
// game-config: arcade.online.props?: { [zoneFamily: string]: PropShape }   (e.g. 'bridge#')
```

Lengths are cells, measured along the zone. Because of this a generated bridge of any length fits
the same def: the generator places bridges by seed, with a variable deck `gyStart..gyEnd`
(`salmonsMap.js`). `deck.to` is `{ param: 'length', plus: -1 }`. `deck.height` and the ramps may be
numbers or params.

As built (P1): the types are in `engine-layout` `types.ts` (`PropSolid`, `PropHole` beside the
above; `PROP_DEPTHS` the band list). The collider's own lists (`PROP_ZONE_KINDS`, `PROP_HOLES`,
`PROP_SOLID_COLLIDES`, `PROP_SOLID_SIDES`) are defined once, in `engine-mechanics`
`propShape.js`, which the launcher's normalizer imports. The compile resolves a param length by
the param's default. It refuses what the rules cannot play. That is a deck that does not run from
0 to `{ param: <fromZone.length>, plus: -1 }` (the rule's deck is the zone's), a ramp or height
that follows the zone's length or is not more than 0, a `plus` on the zone's height, a snap
outside (0, 1] cell, an unknown hole or zone kind, and a malformed solid.

The deck tiles repeat per cell. The `sorted` band holds a **count-mode repeater** whose `first` /
`middle` / `last` variants are the near, middle and far deck tiles. This is today's `RepeaterNode`
`count` + `variants` (`check:component-repeat-segments`). Inside a prop, the prop mount places
each segment at its cell's projected place and depth, not along a screen row. A pillar every third
tile is a `variants` stride, or a visibility binding on `index`.

## 3. How the rules read the collider (and stay today's by default)

Today's constants, all of which the default reproduces:

| What | Today | Where |
|---|---|---|
| Ramp length, both ends | `BRIDGE_SLOPE = 2` cells | `salmonsRules.js` (the original server's `slopeLen`) |
| Deck height | `BRIDGE_HEIGHT = 6` cells (`zone.height`) | `salmonsMap.js` `C.BRIDGE_HEIGHT` |
| Snap to the deck row | centre within `CELL / 2` of `d.y + CELL/2` | `bridges.deckOf` |
| Lift | `height · (1 − off / BRIDGE_SLOPE)`, `z = lift · CELL` | `bridges.deckOf` / `step` |
| Holes | water solid to fishermen everywhere but `x − 2·CELL … w + 4·CELL`, rows `y − fisher.y … CELL + 2·fisher.y` | `salmons.js` `originalBounds` |
| Who | `characters: ['fisherman']`; salmon and bear pass under | `salmonsGeometry` |

The pipeline, server side (the server never loads a component):

1. **Compile** (`engine-mechanics` `propShape.js`, plain JS so the game server, the device and the
   launcher share one function): `compilePropShape(def) → PropShape` (the def, for its `from`
   stamp and its params; `propShapeErrors(def)` lists the problems for the editor). A field equal to the
   table's value is **dropped**. A def that reproduces today's bridge therefore compiles to
   `{ from, zoneKind }` only.
2. **Normalize** (`game-config` `normalizeOnlineProps`, called by `normalizeArcadeOnline`). The
   server needs this block, so it is normalized, not carried past the normalizer like `zoneArt`. A
   game with no `props` normalizes byte-identically.
3. **Generate** (`salmons.js` `salmonsGeometry`): for each bridge, the zone rule gains the shape's
   non-default fields (`{ kind: 'bridge', characters, ramp?: {near, far}, snap?, solids? }`), the
   zone takes `height` when the level names none, and `originalBounds` cuts the holes from the
   rule's ramps (`near` on the `x` side, `far` on the `x + w` side), not from `BRIDGE_SLOPE`.
4. **Play** (`salmonsRules.js` `bridges`): `deckOf` reads `rule.ramp?.near ?? BRIDGE_SLOPE`,
   `rule.ramp?.far ?? BRIDGE_SLOPE` and `rule.snap ?? 0.5`, and ramps each end over its own length.
   `solids` become ordinary solid zones in step 3, so the existing solid path (and the device's
   prediction) stops a body at them. No new rule kind is added.

As built (P2), where it differs from the steps above:

- **The block is carried, not normalized.** `normalizeArcadeOnline` is in every runtime's shared
  normalizer, and the slot, match-3 and card runtimes must stay the same bytes
  (`check:runtime-bytes`). So `normalizeOnlineProps` lives in `game-config` `onlineProps.ts`, as
  the levels' shape lives in `levelsShape.ts`, and `normalizeGameConfigDoc` drops `props`. The
  room and the device read it off the raw doc through `shapedOnlineGame`, which already gives both
  their generator's inputs and now also sets `online.props` (`withOnlineProps`). The
  normalizer drops a default field, as the compile does, so a shape that restates today's bridge
  plays today's level. Its lists and defaults are mirrored (`ONLINE_PROP_*`), not imported from
  `propShape.js`: the import kept `PROP_SHAPE_DEFAULTS` in the slot runtime. `check:prop-shape`
  holds the mirror equal to `propShape.js`. The launcher's load and save do not yet carry the block back
  (`withProps`, beside `withLevelsShape`). P6 adds that with the compile on save.
- **The generator seam** is `geometry(made, props)`. `generatedOnlineGame` and `levelHash` pass
  `game.online.props`, the same way `make(seed, levels)` gets `game.online.levels`. A shape
  applies to the zones of its key's family (`bridge#` ⇒ `bridge0`, `bridge1`, …) when its
  `zoneKind` is the zone's.
- **Height.** The levels name no bridge height (no overlay sets one), and the generator writes
  `BRIDGE_HEIGHT` on every bridge. A shape's `height` therefore replaces the generator's height on
  the zone.
- **Holes.** `hole` is read from the shape, not written on the rule. The ramps are read from the
  rule. A generated bridge spans its water, so a ramp's hole lies on the bank, and a longer ramp
  opens no more water there (`check:prop-shape` shows the extra cell with a bridge shorter than
  its water).
- **Solids** are zones `bridge<i>Solid<k>`, in cells from the bridge zone's top-left corner (`x`
  along the deck, `y` across it). A one-way solid is a rule's `solid: '<side>'`. They stop a body
  at any height, as every zone solid does. **For §8 Q3:** while a fisherman is within `snap` of
  the row over the deck or a ramp, the rule puts him back on the row every step (his step is
  about a sixth of a cell). So he cannot step off the side there today, and a side railing changes
  nothing until a smaller snap or a higher speed lets him. A post on the row (stopping him short of
  the bank) and a low bridge for bears (Q4) work now. Hence the side exit, below.
- **The side exit** (owner, 2026-11-26: "add the side-exit switch, off by default"). The
  collider's `sideExit` defaults to false, which is dropped by the compile and both normalizers
  (`PropShape.sideExit` is present only as `true`). On, the zone rule carries `sideExit: true`,
  and `bridges` records each step whether the body's last input moves it across the row
  (`moveY !== 0`: the deck runs along x). While it does, the rule does not put the body back on
  the row:
  - the room's solids (a railing) stop it;
  - with no railing it walks off and is on the ground (`z` 0) once further than `snap` from the
    row;
  - with no across input it is held on the row again.

  Off, the rule has no input hook and steps exactly as before: a scripted walk's trace hash is
  pinned against the rule before the switch existed. The seed `bridgeProp` leaves it off. Bot
  fishermen steer diagonally, so nearly every step they spend on a deck has `moveY !== 0`. A game
  that turns the switch on lets its bots drift off the sides of ramps. The device does not predict
  the deck (P2), so it predicts the railing as an ordinary solid, and the room corrects the rest.
- **The art still draws 2 and 2.** `salmonsArt/bridge.ts` `slopeEnds` and `BRIDGE.slope` draw
  today's ramps. Until P5 draws the shape, a non-default ramp plays right and is drawn wrong. No
  game has props yet.
- **One river on both sides** is built in P3; see the as-built note under that heading below.

**The fingerprint.** `levelHash` hashes the generator's geometry (field, zones, zone rules,
spawns) and nothing else. The shape lands in zones and zone rules, so a collision change moves the
hash, and an art change cannot. A default shape adds no field, so its hash is today's.
`check:room-levels` pins all three cases.

**One river on both sides.** In an authoring boot the device runs the live config while the room
runs the published one ([salmons-levels §3](salmons-levels.md)). A collider saved but not yet
published would make the device refuse the room. So the room state carries the props it played
beside `levels`, and the device adopts them (`roomLevelGame`), as it adopts the levels. The existing
notice names "bridges" when they differ.

As built (P3):

- **The wire.** The state field is `props`, a string beside `levels` and `levelHash` in
  `services/game-server` `schema.ts` `roomFields`. It holds the JSON of the props the room's game
  played (`roomLevelState`), and the room writes it once. It is written only for a game that has
  props, so a room of any current game sends no new field. Props longer than `ROOM_LEVELS_MAX`
  are not sent, and the fingerprint alone decides.
- **The device** (`roomLevelGame`) reads the field with `engine-mechanics` `propShape.js`
  `readPropShapes`, the same reading as `game-config` `normalizeOnlineProps` (`check:prop-shape`
  holds the two equal). It plays the room's props, or none when the field is unset or unreadable.
  `differs` names the kind (`bridges`) when the room's colliders are not the device's own. A shape
  whose `from` stamp alone differs is the same collider and is not named.
- **Older sides.**
  - A room from before the field (a game server older than P3) played no props. Its devices play
    none and make its level.
  - A device from before P3 plays its own config's props. Where they match the room's it plays
    on. Where they differ its level has another fingerprint, so a P2 runtime refuses the room
    with its existing message. A runtime older than P2 reads no props: in a room that has some
    it makes today's level, and it is refused if it holds the fingerprint (every runtime since
    the levels change does).
  - One gap: a game server built at P2, which plays props but does not send them, would get its
    devices refused. P2 is not deployed.

## 4. Inputs, the state machine and who drives them

The state machine runs on the device only, per placed instance, as every component's does
(`stateMachine.ts`). The **arcade runtime** (`apps/lines` `online.ts`) sets the inputs from the
room state it already receives. The server sends nothing new.

| Input | Kind | Set by | From |
|---|---|---|---|
| `occupied` | number | `<ComponentInstance engineValues>` | how many of the prop's `characters` are on this zone: `z > 0` and the body within the deck row ± `snap`, over the deck or a ramp (the room's synced `x y z`; `memo.bridge` is not synced and need not be) |
| `stepOn` | trigger | fired on the instance's bus | `occupied` of one character goes 0 → on |
| `stepOff` | trigger | fired on the instance's bus | on → 0 |

- These three are **reserved prop inputs** (`PROP_INPUTS`, `componentInterface.ts`). The editor
  seeds them when a def becomes a prop and locks their id and kind. Every reader still goes through
  `componentInputs(def)`.
- **Ambience** needs no input. It is the entry state's looping timeline (water shimmer, a flag).
- **Open.** The author adds any other input (a `source` value, a Flow `var:`) and any states,
  layers and transitions. The prop adds no rule to the state machine.
- Each instance is scoped by its zone id (`signalScope` from an engine-provided `zone` param), so
  stepping onto `bridge0` does not fire `bridge2`'s triggers.
- The device's own player is predicted, so its step fires at once. Others fire on the room's patch.
- **Events** (`ComponentDef.events`) may raise to Flow for sound or FX. They never reach the room:
  the rules have already decided.

## 5. Depth: behind and in front of characters

Every node takes a `propDepth` (§2). The prop mount puts each band where today's code bridge
draws, so the bands are today's `Z` table (`river.ts`), not a new scale:

| Band | Drawn in | Today's piece | Depth |
|---|---|---|---|
| `water` | the river's reflections container (kept over the bloodstains by `aboveWater`) | pillar and deck reflections | the water's order |
| `behind` | the upright layer, under the spawn layer | pillars (`Z.pillar` 400), slopes (`Z.slope` 500) | `zOf(x, y, propZOffset)` |
| `sorted` | among the players (the `among` list in the spawn layer) | deck tiles (`Z.deck` 1100) | `amongZ(x, y, propZOffset)`, per segment cell |
| `over` | among the players, at the on-deck order + 1 | — (new) | over `aloftDepth` |

A character on the prop is drawn over its `sorted` nodes. This rule is decided by the collider,
not by the art: a character with `z > 0` takes `aloftDepth` (the original's `sortSY + 10000`,
`bridge.ts` `BRIDGE.onDeckZ`). A fisherman walking under the deck sorts by ground depth, so a deck
tile in front of him covers him. To show railings in front of a fisherman *on* the deck, mark them
`over`. Nothing marked ⇒ `sorted` at 1100 (the deck's).

The `sorted` and `over` bands are meant for nodes inside a segment, since one container sorted at
one depth mis-sorts a long deck against a player walking along it. The editor warns of a `sorted`
node that lies outside a segment and spans more than a cell.

As built (P5, the mount):
- **A prop is cut into pieces** (`engine-layout` `propPieces.ts`, pure). Each root child of a prop
  def is one band. A count-mode repeater gives one piece per zone cell: its variant, with `index`
  / `count` as params and held inputs. A component instance gives one piece at its `propCell` (a
  new `BaseNode` field, a `PropLength`, e.g. the far slope's `{ param: 'length', plus: 1 }`).
  Every piece is a plain `<ComponentInstance>` of a piece def, so its machine and timelines run.
  Each piece takes the zone's params: `length`, `height`, and `zone` (the param the def is scoped
  by). So `stepOn` on `bridge0` reaches only `bridge0`'s pieces. A band's depth offset is the
  child's `propZOffset`, in the original's old px.
- **Salmons places them** (`salmonsArt/propPlacement.ts` `placeSalmonsProp`):
  - `sorted` gets `amongBias` (the code's `amongZ`: `⌈(zOffset − 1000) · 3⌉` ground depth px);
  - `over` gets `aloftDepth(deckLift(height)) + CELL`, which is over a character standing anywhere
    on its cell;
  - `behind` gets the code's `zOf` as `zIndex`;
  - `water` keeps cell order, and each water piece gets the code shimmer's `phase`.
- **`sorted` / `over` stand among the players.** This is the owner's "extend `<SpawnLayer>`" done
  without touching `SpawnLayer.svelte`, which every runtime carries through `<LayoutNodeView>`:
  any change there moves the slot, match-3 and card bytes. Instead `<IsoWorld>`, which only the
  arcade seam registers, mounts `<SpawnProps>` for each spawn layer. It reads the registry the
  arcade runtime fills (`arcadeProps.svelte.ts` `setSpawnProps(layer, pieces)`, in a module of
  its own: `arcadeArt.svelte.ts` is in every runtime). `<PropsInto>` then draws each piece IN the
  container the layer's instances are drawn in, through a pixi-svelte context parent
  (`spawnInstancesOf`, the walk `river.ts` `spawnLayerOf` does). There it sorts by
  `isoDepthOrder(x, y, 0, bias)`, raised by its `lift`. With no pieces published, nothing is
  searched or drawn.
- **`water` / `behind` seam.** The same registry holds them, read by `spawnPropsOf(layer, band)`
  for the field art that draws those layers. The river wiring is the next step.
- **Drawing.** The layout has no polygon node, and adding one would reach every runtime. So the
  pieces draw through `PropGraphic`, a bound part the arcade seam registers (`propGraphic.ts`). Its
  `bind.props.ops` are polys, rects and lines, each filled and stroked in order, as `river.ts`
  draws them. A point is a ground point projected by the screen's projector, plus a screen `dy`. A
  scalar may be a param × `times` + `plus` (the deck lift is `{ param: 'height', times: −24 }`).
  The editor does not run bound parts, so in the editor the pieces show as bind anchors until P7.

## 6. The ship chain (rule 8)

1. **Author.** Components side of `/editor`. The def is saved project-scoped
   (`editor/<project>/components/<id>.v<N>.json`, `componentStorage.ts`, which normalizes `prop`).
2. **Place.** `/config` → Zone art: the `bridge#` row gets a third source kind,
   `{ kind: 'component', component, version }` (`game-config` `zoneArt.ts`; the card's picker lists
   the project's prop defs whose `zoneKind` matches the family). Cosmetic, as zone art is.
3. **Compile.** The config **save** (and Publish) reads that def by its pinned version and writes
   `arcade.online.props['bridge#']`, stamped `from: {component, version}`. `/config` shows the
   block read-only, with a link to the component. If the def has a newer version than the one
   pinned, the card warns, and the author re-pins by choosing it.
4. **Export / bake.** `runtimeBundle` and `editorArtExport` add the zone-art components to their
   roots (`zoneArtComponentRoots`), walked by `resolveComponentClosure` (never a hand-rolled walk).
   This ships the def, its segment variants and their art, the same way `zoneArtStillRoots` ships
   frames. `bake:doc` before `pull:assets`.
5. **Pull / register.** The def is in the bundle and is registered at boot by `registerComponents`.
   Its sheets are kept loaded through `characterArt`, as zone-art frames are.
6. **Draw.** `river.ts` skips its code-drawn bridge for a zone whose family has a component source,
   and hands it to `salmonsArt/propMount.ts`. The mount makes one `<ComponentInstance>` per bridge
   zone, with `length`, `height` and `zone` as engine values, and splits the nodes into the §5
   bands.
7. **Server.** It reads the published config's `arcade.online.props` through the normalizer. It
   never sees the def, the art or `zoneArt`.

**Parity.** With no component source for `bridge#`, there is no `props` block, the rule reads its
constants, the river draws its code bridge, the hash is unchanged, and every other game is
untouched (the `prop` block is absent from every other def).

## 7. Build plan

Each phase is its own PR off `main`, merged when its gates and every current game's gates pass.
Phases 5 and 6 touch `river.ts`, so they start after the 2026-11-26 bridge draw fix (deck z and
the 2-cell near slope) has merged.

1. **P1 — model and compile.** `ArcadeProp`, `PropDepth` and the per-node fields in `types.ts`.
   `componentStorage.ts` normalizes `prop` (an unknown key survives a save). `PROP_INPUTS` goes in
   `componentInterface.ts`. `engine-mechanics/src/propShape.js` (+ `.d.ts`) gets
   `compilePropShape`, with defaults dropped.
   *Proof:* new `pnpm check:prop-shape` (root): a def written as today's bridge compiles to
   `{from, zoneKind}`, each non-default field survives, and a bad length is refused.
   `pnpm --filter launcher-api check:save-keeps-unknown-blocks` (a `prop` section).
   `pnpm --filter engine-layout build`. **Built 2026-11-26, in review** (detail:
   [status/component-editor](../status/component-editor.md)).
2. **P2 — the rules read the shape.** `normalizeOnlineProps`; `salmonsGeometry` writes the rule
   fields and cuts the holes from them; `bridges.deckOf` takes per-end ramps and `snap`.
   *Proof:* `check:prop-shape` §2 (the lift at every eighth of a cell, over the deck and both ramps,
   is identical to today's with no props; an asymmetric near 3 / far 2 ramps as asked).
   `pnpm check:online-rules`, `check:salmons-levels`, `check:salmons-heights`, `check:room-sim`,
   `check:room-bots`. `check:room-levels`: no props gives the same hash as main, a ramp change
   gives a new hash, and a zone-art-only change gives the same hash. **Built 2026-11-26, in review** (as built: §3;
   detail: [status/salmons](../status/salmons.md)).
3. **P3 — one river on both sides.** The room state carries `props` beside `levels`, and the
   device adopts them. The authoring notice names bridges.
   *Proof:* `check:room-levels` (a new section). `scripts/playtest/salmons-rejoin-play.mjs` still
   joins. **Built 2026-11-26, in review** (as built: §3 "One river on both sides";
   detail: [status/salmons](../status/salmons.md)).
4. **P4 — the seed def.** A shared built-in `bridgeProp` (`builtinComponents.ts`,
   `category: 'scenery'`, inert until a zone-art entry names it). Its collider is today's. Its art
   is placeholder nodes close to the code bridge (reflections `water`, pillars and slopes
   `behind`, a deck segment repeater `sorted`). Its state machine has `idle` and `occupied` states
   and `stepOn` / `stepOff` cue timelines. A project starts from it with **Save a copy**.
   *Proof:* `check:prop-shape` §3 (the seed compiles to defaults). `check:component-state-machine`.
   `pnpm --filter engine-layout build`. **Built 2026-11-26, in review** (detail:
   [status/component-editor](../status/component-editor.md)). As built:
   - **Where it lives.** The defs are in `engine-layout` `propComponents.ts`: `BRIDGE_PROP_DEF`,
     its four segment defs and `PROP_TIMELINES`. They are in `BUILTIN_COMPONENTS` /
     `BUILTIN_TIMELINES`, the launcher's lowest layer. They are NOT in the lists every runtime
     carries, `RUNTIME_BUILTIN_COMPONENTS` (which the boot's stock-asset walk resolves a doc's ids
     against) and `RUNTIME_BUILTIN_TIMELINES` (which `registerGameTimelines` registers). A prop is
     placed by zone art, never by a doc, so all five runtimes stay their bytes. P5 registers the
     prop built-ins through the arcade seam. Two measured traps: a top-level call that builds a
     def is kept by the bundler unless it is one `/* @__PURE__ */` call (+1.1 kB gzip until they
     were), and a new import edge reorders the shared modules (+18 B). So `propComponents.ts`
     imports only `types.ts`, and writes out `PROP_INPUTS` and Salmons' sizes (`BRIDGE_PROP_SIZES`),
     which `check:prop-shape` §3 holds equal to their sources. All five defs are `internal` (no palette offers them)
     and are pinned in `test-hold-and-win-template.mjs`, as `segmentedCounter` is.
   - **The tree.** The origin is the first deck cell's middle on the deck top.
     - `Reflections`: a count-mode repeater of `bridgePropReflection`, in the `water` band.
     - `Near slope` and `Far slope`: `behind`, at 500. The far slope follows `length` by two
       `valueBindings`.
     - `Deck`: a count-mode repeater in the `sorted` band at 1100. Its variants are
       `bridgePropDeckNear`, `bridgePropDeckMiddle` and `bridgePropDeckFar`. Each segment has a
       tile (`sorted`, 1100), a pillar (`behind`, 400) and the pillar's reflection (`water`).
   - **Pillars.** Neither a variant stride nor a modulo binding exists. So the middle segment's own
     machine shows its pillar on `index` 4, 7, … 49, and the ends always have one. That is the
     code's `i % 3 === 0` plus both ends, pinned for decks of 1–30 cells.
   - **What P5 must take over.** The repeaters' row layout is only the editor's flat preview: the
     P5 mount places each segment at its cell. The pillar is drawn for the default 6-cell height:
     the mount scales the behind band by `height`, or a copy binds it.
   - **The machine.** `ambience` has `idle`, which loops the water's sway on `Reflections`. That is
     the code shimmer with one phase for the whole bridge, where the code has one per cell. Its
     `occupied` state holds still while `occupied > 0`. `steps` has `still`, `stepOn` and
     `stepOff`: a short dip of the `Deck` fired by the triggers from any state. The inputs are
     `PROP_INPUTS`, and `signalScope` is the engine-provided `zone` param.
5. **P5 — the runtime draw and the inputs.** `propMount.ts`, the band placement, per-cell
   segments, and `occupied` / `stepOn` / `stepOff` from the room state in `online.ts`.
   *Proof:* `pnpm check:salmons-art` (no component ⇒ the river's pieces and depths are unchanged).
   New `check:prop-depth`: each band's zIndex for the seed equals today's `Z` table at the same
   cells, and a character with `z > 0` sorts over `sorted` and under `over`.
   `salmons-play.mjs --bridge-component` (new flag) screenshots a fisherman under, on the ramp and on
   the deck, and logs the triggers.
   *Started 2026-11-26:* the inputs' derivation is built and gated. `salmonsRules.js`
   `bridgeOccupancy(game, players)` gives `occupied` per bridge zone from the synced `x y z`, and
   `occupancySteps` gives `stepOn` / `stepOff` (`check:prop-shape` §4). The mount is not built,
   for two reasons recorded in [status/salmons](../status/salmons.md):
   - The `sorted` band must interleave with the players inside the spawn layer, and no
     layout-doc path puts a component there.
   - The seed's placeholder art cannot reproduce the code bridge's fills, so `check:salmons-art`
     cannot stay identical, and §8 Q6 deletes the code bridge only "once the seed def matches the
     code look".
   *Built 2026-11-26 (in review):* the mount (§5 "As built") and the seed's code look.
   `bridgeProp` is now its pieces: `bridgePropWater` (the reflection, swaying from its cell's
   `phase`, and under a pillar the pillar's reflection), `bridgePropPillar`,
   `bridgePropDeckNear` / `…Middle` / `…Far` (the side, the plank tile and its two lines) and
   `bridgePropSlope` (`run` ± 2). Each draws as `river.ts` draws, piece for piece.
   - The per-cell shimmer phase is the cleanest thing the model already has: `SmState.offsetParam`
     on a looping sway timeline keyed every frame over its 20π period, from an engine-provided
     `phase` param the placement sets.
   - The pillar cells are a machine on `index` (`== count` or 1, 4, 7, …).
   - `check:prop-depth` draws the code river and the seed in Node on three Salmons levels,
     mirrored and not. It checks that every piece has the same fills, strokes, alphas, widths and
     path points at the same place and depth (the deck cells against the ones the code stands in
     its view), that the sway matches the shimmer frame by frame, and that a character on the deck
     sorts over its cell and under an `over` piece.
   - The river still draws its code bridge (`check:salmons-art` unchanged). **Next, the arcade
     agent:** `river.ts` takes its water / behind pieces from the registry, `online.ts` publishes
     `placeSalmonsProp`'s pieces and the inputs, and the code bridge is deleted.
   *Built 2026-11-26 (P5b, in review):* the swap, the inputs and the deletion.
   - **Publishing.** `online.ts` `showBridges` publishes the pieces of every `bridge<i>` zone for
     the field's spawn layer (`setSpawnProps`) before the river is drawn. It uses the art kit's
     `bridges(zones)`, which calls `propPlacement.ts` `placeSalmonsBridges`: the seed placed on the
     river's raised ground. The prop built-ins are registered once a page, from the art's lazy
     chunk. The defs go in as built-ins. The timelines are registered again as the engine's, the
     props' and then the project's (`registerComponentTimelines`), because a registration replaces
     the last one and the boot has already registered.
   - **Inputs.** On every room state, `bridgeOccupancy` gives each zone's `occupied`. It is a value
     source, `prop.<zone>.occupied`, that every piece follows. `occupancySteps` fires `stepOn` /
     `stepOff` on the open bus scoped to the zone (`emitComponentSignal(signal, zone)`), so only
     that zone's pieces hear it. The probe's `online.bridges` says the counts and the triggers fired.
   - **The river** (`river.ts`) draws the published `water` and `behind` pieces in its own layers
     (`salmonsArt/propDraw.ts`). There it draws each `PropGraphic` node, shows a node by the state
     its machine settles in, and plays a looping state's property keys on its ticker (the sway).
     Those layers are the river's, sorted once with the rocks and trees, and no
     `<ComponentInstance>` is mounted in them. The deck cells stand among the players
     (`<SpawnProps>`).
   - **Deleted.** `river.ts`'s bridge drawing and shimmer, its `PILLAR_W`, and `Z.pillar`,
     `Z.slope` and `Z.deck`. From `bridge.ts`, `slopeEnds` and `BRIDGE.slope`.
     `check:salmons-levels` reads the slopes off the seed (`run` ±2 from their `propCell`).
   - **`<SpawnProps>` fix.** It looks for the layer's instance container again each frame until
     it is found. Mounted inside `<ProjectedLayer>`, its effect ran before the layer registered
     (a child's effects run first), so pieces published before a remount were never placed:
     the decks were missing in the browser.
   - **Proof.**
     - `check:prop-depth` 26 holds the river's water and behind pieces and the placed deck cells
       to the code bridge's drawing as recorded at c63f0be.
     - `check:salmons-art` 44 has its fingerprints re-pinned. With the bridge pieces taken away,
       both rivers hash as at c63f0be. Of the bridge rows, only the slopes moved (drawn at their
       land cell, path relative, the same points on screen), and the deck cells left the river's
       layer for `<SpawnProps>`.
     - `salmons-play.mjs --bridge-component`: 7 verdicts.
   *Out of the bundle (2026-11-26):* the prop defs, their registration and the inputs are loaded
   with the Salmons art (`salmonsArt/bridgeProps.ts`). No runtime reaches `propComponents.ts`
   statically now: the launcher's library with the props is `builtinLibrary.ts`.
   **Then delete the code-drawn bridge** (owner, §8 Q6), in the same phase once the parity check
   passes: the seed component replaces `river.ts`'s bridge drawing, which is deleted, with what of
   `salmonsArt/bridge.ts` only that drawing used. No dual path is left. The no-component
   default is the seed `bridgeProp`. `check:prop-depth` and `check:salmons-art` then pin the seed's
   bands and depths against the deleted code's recorded `Z` values, not against the code.
6. **P6 — the ship chain.** Zone art `component` source (normalizer + card); compile on config
   save and Publish; `zoneArtComponentRoots` in the bake and the export; boot registration;
   `loadComponentForGame` strips the editor-only `prop.preview`, as it strips `guides`.
   *Proof:* `pnpm --filter launcher-api check:zone-art` (new sections: the source round-trips, the
   compiled block is written and stamped, a stale pin warns, the def and its art are in the bundle's
   closure), `check:component-links`. Then a real bake + pull of Salmons with the seed copy.
   **Built 2026-11-26, in review.** As built, mirroring #1931's rig source:
   - **Source.** `game-config` `zoneArt.ts` gains `ZoneArtComponent`
     `{ kind: 'component', component, version }`. It is a zone family's source only: a variant or
     scenery drops it, and the validator says so. `zoneArtPropKind(family)` gives the kind
     (`bridge#` ⇒ `bridge`). `zoneArtComponentRoots(rawDoc)` lists the components, and
     `zoneArtStamps` never stamps one.
   - **Compile.** `apps/launcher-api` `zoneArtProps.ts` `compileZoneArtProps(doc, load)` runs in
     `saveGameConfigDoc`, so every save writes `arcade.online.props`. That covers `/config`, the
     backups restore, the scaffold and the add-on imports. The props belong to the zone art: a
     family no component draws loses its pasted collider, and the save says so. Publish ships the
     saved config, and a pin is a fixed version, so Publish does not compile again. Load and paste
     carry the block (`withProps` in `gameConfigStorage.ts` `withStoredBlocks` and in `pageDoc.ts`
     `applyPasted`).
   - **Card.** Zone art's **Component** choice (`ZoneArtSection.svelte`, `zoneArtDoc.ts`
     `zoneArtPropsFor` / `componentSourceOf` / `zoneArtPinNote` / `compiledPropText`). The page
     sends the project's non-internal prop defs (`+page.server.ts` `props`).
   - **Ship.** `zoneArtPropSeeds.ts` seeds the closure in `runtimeBundle` and `editorArtExport`
     with each component and the ids its pinned def names. The bundle also ships the pinned def
     beside the latest, as a pinned instance's version. `loadComponentForGame` strips
     `prop.preview`.
   - **Boot.** A baked def is registered as every baked def is (`registerBakedComponents`).
   - **Runtime.** `apps/lines` `game/zoneArt.ts` `zonePropOf('bridge#')` resolves the pinned def
     from the registry. `online.ts` hands it to the art's `bridges`, which falls back to the seed.
   - **Not done.**
     - The `/config` level preview (`config/zones.ts`) still draws the generator's bridges without
       their props' ramps, as it draws no collision.
     - A real bake and pull need R2 and the network: not run here.
     - No playbook plays a project component in the game yet. The runtime path is the seed's, with
       the def swapped.
7. **P7 — the editor.** See the bullets below.
   *Proof:* new `pnpm --filter launcher-api check:component-prop-editor` (pure edits: the collider
   handles, the depth fold, the locked inputs), `check:component-state-machine-editor`,
   `check:component-repeat-segments-editor`, `pnpm --filter launcher-api build`. Docs ship in
   the same change (rule 9): `docs/tools/component-editor.md` (Prop section),
   `docs/tools/game-config.md` (Zone art → Component), `docs/tools/README.md` rows.
8. **P8 — live.** Publish Salmons with a project bridge. The owner changes a ramp and the art in the
   component window. The room plays the new ramp, and the device draws it.
   *Proof:* `salmons-play.mjs` against `rooms.invisiblewall.org`, then the owner's look.

**Editor additions (P7)**, on `/editor?view=components`, to the rule 10 style (section intros are
`SectionCard` `info` tooltips, help on a control is `InfoTip`):

- **Prop** card in Properties (shown once the def has `prop`; a **Make a prop** icon action adds
  it). It holds the zone kind, the preview length and height, and number fields for snap, the two
  ramps and the height, each with a param toggle.
- **Collider on the canvas.** The deck, the ramps, the snap band, the hole and the solids are drawn
  as an overlay over the isometric preview. Drag handles change a ramp's length (whole cells) and
  the snap; a solid is drawn and resized like a region. The overlay toggles from the toolbar.
- **Depth** select per node in Properties (*On the water* / *Behind characters* / *Sorted with
  characters* + z offset / *Over characters*). The layers panel shows a band chip per node. A
  **Show a character** toggle drops a stand-in fisherman you can drag under, onto and over the
  prop, lifted by the collider.
- **Inputs.** `occupied`, `stepOn` and `stepOff` appear locked, with an engine badge, in the
  existing Inputs block. The stand-in drives them in preview, so the State machine tab's preview
  steps the states.

## 8. Open questions for the owner

Answered by the owner on 2026-11-26 unless marked open.

1. **Decided: no.** `occupied` counts only the characters the prop carries (the fishermen). There
   is no `under` input for a salmon or a bear passing under.
2. **Open.** When the component gets a new version, does `/config` re-pin it automatically on the
   next save, or only when the author chooses it? The plan keeps its default: the author chooses.
3. **Decided: yes.** A prop's `solids` may stop a fisherman stepping off the deck's side (a
   railing). It is new behaviour and opt-in: the default and seed bridge have none, so parity holds.
   Because the per-step snap held him on the row, the railing only matters with the **side exit**.
   **Decided (owner, 2026-11-26):** a per-shape switch, `sideExit`, off by default (§3 "As built
   (P2)").
4. **Expressible, not used by the default; owner to confirm.** A bear or a salmon stopped by a low
   bridge needs no new field: it is a solid whose `characters` name them (`solids[].characters`,
   the vocabulary of Q3). The seed bridge has none, so they pass under as today.
5. **Open.** Should one level be able to use two bridge looks (a variant per bridge, picked by
   seed, as zone art variants are), each with its own collider? The plan keeps one shape per
   family.
6. **Decided: delete it.** Once the seed def matches the code look, the code-drawn bridge is
   deleted, an explicit, parity-checked step of P5 (§7). No dual path is left.

## 9. Other obstacles (waterfall first)

> "We should also have a way to build waterfalls the same way, and probably other kinds of
> obstacles." (owner, 2026-11-26)

Decided with the owner: the bridge goes first, end to end (P4–P8), and then the model is
generalised. The plumbing P1–P4 added is keyed by zone kind, not by bridge. That covers
`PROP_ZONE_KINDS` / `PROP_SHAPE_DEFAULTS` (`propShape.js`), the launcher's `normalizeProp`, the
`PROP_COMPONENTS` / `PROP_TIMELINES` lists and `propOf(props, id, kind)` (`salmons.js`). A new
obstacle adds an entry to each list, its own collider fields, and its rule's `?? <constant>`
reads. It needs no new channel. Each obstacle below keeps §2's split: the collider is data the
rules read, and the art only presents what the rules decided.

| | Waterfall `waterfall#` | Rock `rock#` | Whirlpool `whirlpool#` | Sandbank `sandbank#` |
|---|---|---|---|---|
| Rule today (`salmons.js` `salmonsGeometry`) | `solid: 'below'`, `kind: 'waterfall'`, `characters: ['salmon']`, `aloft` on an original level; a bear blocker `waterfall<i>Bear` (`originalBounds`) | `solid: true`, every character | original: `pull: WHIRLPOOL_PULL`; band river: a `force` | `kind: 'sandbank'`, `characters: ['salmon']`, `cell: CELL` on an original level |
| Rules module | `waterfallClimbing`, `fall` | `lowPieces` | `lowPieces` | `sandbanks` |
| Collider fields (parity default, where it lives) | `climb: { reach: 2, step: 2.4, slide: 0.8 }` (`CLIMB.radiusSq` 4, `step`, `slidePerSecond`, `salmonsRules.js`); `bearReach: 1.5` (`SALMONS_BOUNDS.fallReach`, `salmons.js`); `aloft` (the generator's choice, kept); `characters` (`['salmon']`) | `over: 0.5` (`OVER.rock`); `characters` (every one); a footprint scale (the generator's `rock` box) | `pull: { radius: 4, strength: 14 }` cells (`WHIRLPOOL_PULL`); `over: 0.5` (`OVER.whirlpool`) | `reach: 0.8` (`SAND_REACH`); `clear: 0.05` (`CLEAR.sand`) |
| Reserved inputs | `climbing` (number, salmon on it), `climbed` / `slipped` triggers (top reached / let go below), `bearAt` (number, bears within `bearReach`) | `struck` trigger (a body stopped on it) | `caught` (number, salmon in its pull) | `grounded` (number), `freed` trigger |
| Art bands (`river.ts` `Z` today) | `water`: the splash clips (`Z.splash` 100 + p); `behind`: the lip (`Z.lip` 50); the cliff is drawn by the elevation pass under the upright layer, not by a prop band (see below) | `behind`: the rock (`Z.rock` 300) | `water`: the pool (`Z.whirlpool` −50) | `water` (a flat stamp) |
| Hash | every field lands in zones / zone rules, as a bridge's | same | same | same |

**What is hard, and stays out of the component.**

- **A waterfall's height is the level's, not the prop's.** The generator draws each height by seed
  (`salmonsMap.js`, H in `WATERFALL_HEIGHT_MIN`..`MAX`, capped towards the sea). An overlay `set`
  re-heights one, and `riverElevation` (`salmonsElevation.ts`) raises everything upstream by
  `elevStepFor(H)`. So the river's elevation, the cliff art under the lip and the climb's top all
  follow the generator's height. A waterfall prop cannot carry a height: `fromZone.height` is
  engine-provided and read-only, and the cliff stays drawn by the elevation pass. A prop that needs
  its own height range sets the levels' `waterfalls.heightMin` / `heightMax` (salmons-levels), never
  the art.
- **Rules defined by the original.** `CLIMB`, `OVER`, `SAND_REACH` and `WHIRLPOOL_PULL` are the old
  server's numbers, pinned by `check:salmons-heights`, `check:online-rules` and
  `check:salmon-bots`. A default shape compiles to `{ from, zoneKind }`, exactly as the bridge's
  does, so those traces cannot move. Changing one value is a new collider with its own hash.
- **Bots read the same pieces.** `BOT_SWIM` weighs rocks, pools and sand by fixed pads (`SWIM_WEIGH`
  `rock` / `pool` / `sand`). A shape that widens a pull must widen the bot's pad from the same
  field, or the bots swim into it. Each P-step below names its bot gate.
- **Rocks and whirlpools are many small zones.** One def per family is placed per zone, like a
  bridge, but a level can hold dozens. The P5 mount must instance cheaply (cull with the river's
  `uprightCulled` boxes) before a rock prop ships.

**Plan (each its own PR, after P8):**

9. **P9 — generalise the shape.** `PROP_SHAPE_DEFAULTS.waterfall` and its compile fields (`climb`,
   `bearReach`, `characters`). Give the `game-config` mirror (`ONLINE_PROP_*`) a per-kind table.
   `propOf` already takes the kind.
   *Proof:* `check:prop-shape` §4 (a default waterfall compiles to `{from, zoneKind}`; each field
   survives; a bad climb is refused; the mirror equals `propShape.js`), `check:runtime-bytes` (the
   slot, match-3 and card runtimes unchanged).
10. **P10 — the waterfall rule reads it.** `salmonsGeometry` writes `climb` and `bearReach` on the
    rule and the bear blocker. `waterfallClimbing` reads `rule.climb?.… ?? CLIMB.…`.
    *Proof:* `check:salmons-heights` (every height's taps unchanged with no props, and a step of
    3 takes fewer taps), `check:online-rules`, `check:salmon-bots`, `check:room-sim`, and
    `check:room-levels` (no props gives main's hash; a climb change gives a new one).
11. **P11 — the seed `waterfallProp`** (`PROP_COMPONENTS`, internal, inert): splashes `water`, the lip
    `behind`, a lip segment repeater across the river's width, and inputs `climbing`, `climbed` and
    `slipped`. *Proof:* `check:prop-shape` §5 (it compiles to defaults),
    `check:component-state-machine`, runtime bytes.
12. **P12 — draw and ship.** The waterfall goes through the P5 mount and the P6 zone-art source.
    `river.ts` deletes its code lips and splashes (as P5 does the bridge's) and keeps the cliffs
    on the elevation pass. *Proof:* `check:salmons-art`, `check:prop-depth` (the lip's and
    splash's Z), and `salmons-play.mjs` screenshots of a salmon climbing.
13. **P13 — rock, whirlpool, sandbank**, one PR each, in that order, each with P9–P12's four gates
    and the bot gate (`check:salmon-bots`).
