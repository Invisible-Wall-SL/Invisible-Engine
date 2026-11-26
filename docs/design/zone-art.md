# Zone art — what an arcade game's zones are drawn with

> Status: **phase 1 built 2026-11-25; the rig source of phase 2 built 2026-11-26 (in review)**;
> the rest of phase 2 and phase 3 planned. State:
> [status/salmons](../status/salmons.md), [status/game-config](../status/game-config.md). Guide:
> [tools/game-config](../tools/game-config.md) "Zone art". Agent: `arcade-games` (the card:
> `invisible-game-config`).

**Owner report (2026-11-25):** `/config` → Zones lists Salmons' zone families (`sandbank#`, `rock#`,
`whirlpool#`, `waterfall#`, `bridge#`, `source`, `sea`, and invisible `band#…` walls), but nothing
says what they are drawn with. Salmons' art is drawn by code that looks up fixed region names
(`rock_0` … `rock_8`, `whirlpool_0` … `whirlpool_3`, …), so a person can only swap pixels and keep
the names and sizes. **Owner decision (same day):** a general arcade feature, not Salmons-only. It
applies to any arcade game's zones, the config's own and a generator's alike, and Salmons is the
first game that uses it.

## 1. The model

`arcade.zoneArt` in the Game Config, keyed by zone **family**: a zone id with its numbers as `#`
(`game-config` `zoneFamilyOf`, the grouping `/config`'s Zones chips use), so `rock0` … `rock99`
are `rock#`.

```
zoneArt: { [family]: { source, variants?: source[], placement: 'stamp', scale? } }
source:  { kind: 'sprite', region: '<manifest key>::<frame>' }
       | { kind: 'flipbook', clip: '<clip id>', fps? }
       | { kind: 'rig', rig: '<bundle name>', animation: '<name>', loop?: false }
```

- **Stamp.** Each zone of the family draws one picture, centred on the zone and fitted inside it
  with its own ratio kept, times `scale` (0.05–20; 1 is not stored).
- **Variants.** Each zone draws one of `[source, ...variants]` (at most 8 variants). The pick is
  a 32-bit FNV-1a of the room's seed and the zone id, so every device draws the same picture
  (`zoneArtSourceFor`). Offline the seed is 0.
- **Rig.** One of the project's rigs by its bundle name (a character sheet's rig names it so) and
  one of its animations; both are needed, or the picture is dropped. Looped unless `loop: false`
  (a one-shot plays once from its start and holds its last pose). A looped rig starts at a point
  of its animation picked per zone by the seed (`zoneArtPhaseFor`: another FNV-1a, put through
  murmur3's finalizer, since FNV's high bits barely move between `rock1` and `rock2`), so
  neighbours do not move in step and every device starts each at the same point. A zone family
  takes a rig; scenery never does (`zoneArtTakesRig`, §3).
- **No entry, no change.** A family with no entry draws exactly as it did before. An empty map is
  no map.
- **Scenery keys.** A few reserved keys in the same map name pieces a generator's own art places
  on no zone: today only `@trees`, Salmons' forest and bank trees (`game-config`
  `ZONE_ART_SCENERY`; everything derives from that list). An entry has the same shape as a
  family's. Each piece draws one of `[source, ...variants]`, picked by the room's seed and the
  piece's cell (`sceneryArtSourceFor`). `@` is in no zone id a generator makes, and `/config`
  refuses one in a zone it edits. A stored zone whose family is a scenery key is never stamped
  (`zoneArtStamps`). The validator does not judge a generated game. In a game with no generator,
  a scenery key is warned of as scenery nobody draws, never as "no zone of this family". Its
  pictures are never a rig (§3).
- **Cosmetic.** No rule, room, level or fingerprint reads it. A room's `levelHash` covers only the
  generator's geometry ([salmons-levels §3](salmons-levels.md)), so a device whose config has zone
  art plays and adopts exactly as one without (`check:zone-art` §5).
- **Carried, not normalized.** This follows `arcade.online.slide` and the touch schemes. The
  normalizer every runtime carries drops the field. The launcher's save and Raw JSON's Apply put it
  back normalized (`withZoneArt`), and the arcade runtime reads it off the baked config
  (`zoneArtOf`). So the slot, match-3 and card runtimes do not change by a byte.

## 2. How it is drawn

- **A game of its config's own zones** (no generator): the arcade seam (`apps/lines`
  `families/arcade.ts`) passes the loaded layout through `game/zoneArt.ts` `withZoneArt`. That
  puts one `container` node (`zone-art`, `engine-layout/zone-art` `withZoneArtNodes`) just before
  the play field's top-level spawn layer: the online room's `layer`, else the first one on a world
  screen, else on any screen. The container takes the layer's x, y, scale, rotation, zIndex,
  parallax and overrides. Each stamp in it is an ordinary `sprite` node (`keepAspect`) or
  `flipbook` node, so stamps sit under the bodies and every screen draws them with nodes it already
  draws. A clip keeps its ratio when it has a Bounds box; a clip without one fills the zone. A rig
  stamp is a `container` node bound to `ZoneArtRig` (`engine-layout/zone-art` `ZONE_ART_RIG`),
  which `game/zoneArt.ts` registers only for a config whose zone art names a rig. The component
  (`apps/lines` `ZoneArtRig.svelte`) imports `engine-layout/zone-art-rig` (`zoneArtRig.ts`, a
  930 B gzip chunk no game without a rig stamp fetches) and mounts one `RigView` fitted inside the
  stamp's box with its ratio kept (the rig's Bounds box, else its bounds in its first pose),
  centred, playing its animation from its zone's start, moved on by the app's ticker.
- **A game drawn by its generator's art** (Salmons): the river (`salmonsArt/river.ts`) takes the
  room's stamps, worked out from the zones the room made. For a **rock** or a **whirlpool** whose
  zone has a stamp, the stamp's picture takes the built-in one's place, at the built-in size times
  the scale. Any other family's stamp stands upright on its zone's centre, fitted inside the zone,
  in the upright layer at the rock depth. A rig picture is drawn the same way: one `RigView` per
  piece, its box standing for the picture's, moved on by the river's ticker while it is in view.
  The runtime hands the art a loader for the rig drawing only when zone art names a rig
  (`online.ts` `roomZoneArt`), and the art loads it beside its textures (`loadSalmonsArt`). With
  `@trees` set, every scattered and forest tree draws
  its picked picture in place of `tree_N`: a built-in tree's width (`TREE_W`) times the scale, its
  ratio kept, at the same place and depth, anchored at its foot. A clip plays on the river's
  ticker, and neighbouring trees start on different frames. Every seeded choice is made as before
  (a rock still draws both of its numbers, a tree still draws its built-in kind), so nothing else
  on the river moves. A picture that is not loaded falls back to the built-in piece.
- **Rule 8.** `editorArtExport` ships the sheet of every frame zone art names, a scenery key's
  too (`zoneArtStillRoots`; the frame is counted as used, so a lost frame is reported). Clip
  reachability counts every clip zone art names as played (`zoneArtClipRoots`), so the clip and
  its sheets ship. Every rig it names is a bundle name in the export's `rigNames`
  (`zoneArtRigRoots`), the path a character sheet's rig takes: skeleton and atlas under
  `deploy/editor-art/<name>/`, pages in the shared `deploy/_pages/` store. A frame, clip or rig
  that no scene places still ships. The runtime's normalizer drops the field, so the index lists
  each frame and each rig in `characterArt` (`zoneArtArtNames`, beside a character sheet's art).
  The bakes lift that list into the bundle, and the boot keeps those sheets and rigs loaded. A
  clip's sheets are kept by the clip's own frames.

## 3. Phases

1. **Built (this change):** sheet frames and Flipbook clips, `stamp`, variants, scale; the
   `/config` Zone art card with thumbnails; the export and reachability; the runtime draw for a
   plain arcade game and in Salmons' river. Proof: `pnpm --filter launcher-api check:zone-art`,
   and `scripts/playtest/zone-art-play.mjs`, which plays a plain game in a browser. **Scenery
   (built 2026-11-26, in review):** `@trees`, the card's **Scenery → Trees** row (Salmons'
   generators). Proof: `check:zone-art` §10, `check:salmons-art` (which mounts the river in
   Node), and `salmons-play.mjs --trees`.
2. **Rig source: built (2026-11-26, in review).** `{ kind: 'rig', rig, animation, loop? }` for a
   zone family, as a source and as a variant; the card's **Rig** with the character sheet's rig
   picker (`RigSelect`) and the rig's animations (`/api/editor/rig/meta`); the export and boot
   names; the lazy rig drawing for a plain game and in Salmons' river. Proof: `check:zone-art`
   (§1–§8, §11, §12 over a real rig), `check:salmons-art` (the river mounted in Node with a rig
   drawing), `check:game-config-family` (the card server-rendered), `zone-art-play.mjs` (a plain
   game's rig stamps on screen, animating, not in lockstep) and `salmons-play.mjs --zone-rig` (a
   Salmons room's rocks and whirlpools drawn by a rig, animating).
   - **Trees are never a rig (decision, 2026-11-26).** Salmons draws about 430 trees (the band
     river 386–431, the original's map 254 made, more in view where its forest walls are). Measured
     in a Linux sandbox (a 2.1 GHz Xeon core, software GL) with a modest tree rig (8 bones, 6
     parts, swaying): 430 rigs on one screen cost +1.35 ms of JS a frame in the browser
     (`zone-art-play.mjs --cost`: 2.06 against 0.71 ms bare, 432 rig updates a frame), and in Node
     0.65–0.77 ms to move them on plus 1.5–2.0 ms to rebuild their meshes a frame, and ~75 ms to
     make them. A phone is 3–5 times slower: 7–12 ms of a 16.7 ms frame, and a freeze of a few
     hundred ms when the river mounts (every scattered tree is made then), before an artist's rig
     is heavier than the stub. The river moves only the rigs in view, but a forest view holds many
     of them. So `zoneArtTakesRig` refuses a rig for every scenery key: the normalizer drops it, the
     save warns, the card greys **Rig** out on the Trees row with why. A frame or a clip costs a
     tree next to nothing. Rocks (~47) and whirlpools (~13) take one; a family drawn with a rig on
     more than 100 zones (Salmons' 318 sandbanks) is warned of on the card.
   - **Next:** a flipbook `randomStart` (a frame per zone by the seed; `<Flipbook>` has no start
     frame yet) and a `z` (draw order among stamps and against the river's pieces).
3. **Next: `fill` and `edge` placements.** `fill` tiles a picture over the zone (Salmons'
   sandbanks and the sea, today autotiled ground). `edge` lays it along one side (a waterfall's lip,
   a bank). In Salmons these would replace the built-in ground and lip tiles of the family, as a
   stamp replaces a rock.

The normalizer drops any placement but `stamp` until its phase is built, and the card offers none.

## 4. Open

- `/config`'s zone map does not draw the chosen art yet: the card shows a thumbnail per picture,
  and none for a rig (the character sheet's rig preview is a Pixi application of its own and reads
  the rig through Invisible Characters' grant, so it is not cheap to reuse on the card).
- On a projected (isometric) world screen that is not Salmons, the stamps' container is a top-level
  ground node, so they are drawn lying on the ground, not upright.
- A future generator with no art of its own would draw no stamps. Its room replaces the seam's
  layout change with its field (`online.ts` `withRoomField`), and only Salmons' art reads stamps.
  The `arcade3d` runtime draws them as 2D nodes.
