# Arcade prop components — a component that carries its own collision (Salmons' bridge first)

**Status: planned, 2026-11-26. No feature code.** Owner ask of 2026-11-26. Agents:
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
	/** Optional extra blockers in the deck's own cell frame (a railing post, a gate). The vocabulary
	 *  is `TileCollide`'s: `solid` from every side, `oneWay` from the side it names. */
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

/** The compiled shape: plain JSON, what the server and the generator read. No art, no nodes. */
interface PropShape {
	from: { component: string; version: number };
	zoneKind: 'bridge';
	characters?: string[];
	height: number;           // cells, the default when a level names none
	snap: number;             // cells
	ramp: { near: number; far: number };   // cells
	hole: 'deckAndRamps' | 'deck' | 'none';
	solids?: PropCollider['solids'];
}
// game-config: arcade.online.props?: { [zoneFamily: string]: PropShape }   (e.g. 'bridge#')
```

Lengths are cells, measured along the zone. Because of this a generated bridge of any length fits
the same def: the generator places bridges by seed, with a variable deck `gyStart..gyEnd`
(`salmonsMap.js`). `deck.to` is `{ param: 'length', plus: -1 }`. `deck.height` and the ramps may be
numbers or params.

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
   launcher share one function): `compilePropShape(def.prop) → PropShape`. A field equal to the
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

**The fingerprint.** `levelHash` hashes the generator's geometry (field, zones, zone rules,
spawns) and nothing else. The shape lands in zones and zone rules, so a collision change moves the
hash, and an art change cannot. A default shape adds no field, so its hash is today's.
`check:room-levels` pins all three cases.

**One river on both sides.** In an authoring boot the device runs the live config while the room
runs the published one ([salmons-levels §3](salmons-levels.md)). A collider saved but not yet
published would make the device refuse the room. So the room state carries the props it played
beside `levels`, and the device adopts them (`roomLevelGame`), as it adopts the levels. The existing
notice names "bridges" when they differ.

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
   `pnpm --filter engine-layout build`.
2. **P2 — the rules read the shape.** `normalizeOnlineProps`; `salmonsGeometry` writes the rule
   fields and cuts the holes from them; `bridges.deckOf` takes per-end ramps and `snap`.
   *Proof:* `check:prop-shape` §2 (the lift at every eighth of a cell, over the deck and both ramps,
   is identical to today's with no props; an asymmetric near 3 / far 2 ramps as asked).
   `pnpm check:online-rules`, `check:salmons-levels`, `check:salmons-heights`, `check:room-sim`,
   `check:room-bots`. `check:room-levels`: no props gives the same hash as main, a ramp change
   gives a new hash, and a zone-art-only change gives the same hash.
3. **P3 — one river on both sides.** The room state carries `props` beside `levels`, and the
   device adopts them. The authoring notice names bridges.
   *Proof:* `check:room-levels` (a new section). `scripts/playtest/salmons-rejoin-play.mjs` still
   joins.
4. **P4 — the seed def.** A shared built-in `bridgeProp` (`builtinComponents.ts`,
   `category: 'scenery'`, inert until a zone-art entry names it). Its collider is today's. Its art
   is placeholder nodes close to the code bridge (reflections `water`, pillars and slopes
   `behind`, a deck segment repeater `sorted`). Its state machine has `idle` and `occupied` states
   and `stepOn` / `stepOff` cue timelines. A project starts from it with **Save a copy**.
   *Proof:* `check:prop-shape` §3 (the seed compiles to defaults). `check:component-state-machine`.
   `pnpm --filter engine-layout build`.
5. **P5 — the runtime draw and the inputs.** `propMount.ts`, the band placement, per-cell
   segments, and `occupied` / `stepOn` / `stepOff` from the room state in `online.ts`.
   *Proof:* `pnpm check:salmons-art` (no component ⇒ the river's pieces and depths are unchanged).
   New `check:prop-depth`: each band's zIndex for the seed equals today's `Z` table at the same
   cells, and a character with `z > 0` sorts over `sorted` and under `over`.
   `salmons-play.mjs --bridge-component` (new flag) screenshots a fisherman under, on the ramp and on
   the deck, and logs the triggers.
6. **P6 — the ship chain.** Zone art `component` source (normalizer + card); compile on config
   save and Publish; `zoneArtComponentRoots` in the bake and the export; boot registration.
   *Proof:* `pnpm --filter launcher-api check:zone-art` (new sections: the source round-trips, the
   compiled block is written and stamped, a stale pin warns, the def and its art are in the bundle's
   closure), `check:component-links`. Then a real bake + pull of Salmons with the seed copy.
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

1. Should `occupied` count only the characters the bridge carries (fishermen), or also a salmon
   or bear passing under (a second input, `under`)?
2. When the component gets a new version, does `/config` re-pin it automatically on the next save,
   or only when the author chooses it (the plan's default: the author chooses)?
3. Should railings be able to stop a fisherman stepping off the deck's side (`solids`)? It is new
   behaviour, opt-in only, and the default bridge has none.
4. Should a bear or a salmon ever be stopped by a bridge (a low bridge), or do they always pass
   under?
5. Should one level be able to use two bridge looks (a variant per bridge, picked by seed, as zone
   art variants are), each with its own collider? The plan has one shape per family.
6. Once the seed def has been checked against the code look, can the code-drawn bridge be deleted
   (a later parity-checked PR), or does it stay the no-component default for good?
