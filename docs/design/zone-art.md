# Zone art — what an arcade game's zones are drawn with

> Status: **phase 1 built 2026-11-25 (in review)**; phases 2 and 3 planned. State:
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
```

- **Stamp.** Each zone of the family draws one picture, centred on the zone and fitted inside it
  with its own ratio kept, times `scale` (0.05–20; 1 is not stored).
- **Variants.** Each zone draws one of `[source, ...variants]` (at most 8 variants). The pick is
  a 32-bit FNV-1a of the room's seed and the zone id, so every device draws the same picture
  (`zoneArtSourceFor`). Offline the seed is 0.
- **No entry, no change.** A family with no entry draws exactly as it did before. An empty map is
  no map.
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
  draws. A clip keeps its ratio when it has a Bounds box; a clip without one fills the zone.
- **A game drawn by its generator's art** (Salmons): the river (`salmonsArt/river.ts`) takes the
  room's stamps, worked out from the zones the room made. For a **rock** or a **whirlpool** whose
  zone has a stamp, the stamp's picture takes the built-in one's place, at the built-in size times
  the scale. Any other family's stamp stands upright on its zone's centre, fitted inside the zone,
  in the upright layer at the rock depth. Every seeded choice is made as before (a rock still
  draws both of its numbers), so nothing else on the river moves. A picture that is not loaded
  falls back to the built-in piece.
- **Rule 8.** `editorArtExport` ships the sheet of every frame zone art names
  (`zoneArtStillRoots`; the frame is counted as used, so a lost frame is reported). Clip
  reachability counts every clip zone art names as played (`zoneArtClipRoots`), so the clip and
  its sheets ship. A frame or clip that no scene places still ships. The runtime's normalizer drops
  the field, so the index lists each frame in `characterArt` (`zoneArtArtNames`, beside a character
  sheet's art). The bakes lift that list into the bundle, and the boot keeps those sheets loaded. A
  clip's sheets are kept by the clip's own frames.

## 3. Phases

1. **Built (this change):** sheet frames and Flipbook clips, `stamp`, variants, scale; the
   `/config` Zone art card with thumbnails; the export and reachability; the runtime draw for a
   plain arcade game and in Salmons' river. Proof: `pnpm --filter launcher-api check:zone-art`.
2. **Next: a rig source** (`{ kind: 'rig', rig, animation }`), drawn as the character sheet's rig
   look is (`engine-layout/sheet-rig`), with its bundle in `characterArt`-style boot names. Also a
   flipbook `randomStart` (a frame per zone by the seed; `<Flipbook>` has no start frame yet) and a
   `z` (draw order among stamps and against the river's pieces).
3. **Next: `fill` and `edge` placements.** `fill` tiles a picture over the zone (Salmons'
   sandbanks and the sea, today autotiled ground). `edge` lays it along one side (a waterfall's lip,
   a bank). In Salmons these would replace the built-in ground and lip tiles of the family, as a
   stamp replaces a rock.

The normalizer drops a rig source and any placement but `stamp` until its phase is built, and the
card offers neither.

## 4. Open

- `/config`'s zone map does not draw the chosen art yet: the card shows a thumbnail per picture.
- On a projected (isometric) world screen that is not Salmons, the stamps' container is a top-level
  ground node, so they are drawn lying on the ground, not upright.
- A future generator with no art of its own would draw no stamps. Its room replaces the seam's
  layout change with its field (`online.ts` `withRoomField`), and only Salmons' art reads stamps.
  The `arcade3d` runtime draws them as 2D nodes.
