# Playtest — online arcade room (`online-sample`)

The first online arcade game ([realtime-multiplayer](../design/realtime-multiplayer.md) §10,
[game-families](../design/game-families.md) P10.14): the arcade sample's scene set and placeholder
components with an `arcade.online` config — two characters (`salmon` = `arcadeSalmon`, `bear` =
`arcadeBear`, at most one bear), a 1422 × 800 field, four players, a 2 s rejoin grace — played by
two browsers in one room on a local **game server** (`services/game-server`). Status:
[status/game-families](../status/game-families.md) (P10.14).

The server owns every place; a page sends one input a fixed step (arrows / WASD, Space) and draws
each room player where the server last put it. P10.14 has no prediction or smoothing (P10.15) and
no rules (nobody collides or scores), and the snapshot carries no flow, so the layout shows every
scene at once.

It is not a published project and no current-games fixture plays it: the playtest builds its own
snapshot and config, and starts its own game server in-process.

## Launch

```
pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/online-play.mjs --runtime apps/lines/build --out .cache/online-play
```

Each page boots `?runtime=1&ie_determinism=7&rooms_url=ws://127.0.0.1:<port>&project=online-sample`
(page B adds `rooms_character=bear`). The page's frames are stepped by the determinism probe while
real time passes, so the room's patches arrive between steps.

## Checks (`result.json` verdicts)

1. Both pages join one room and draw both players; the server reports one room.
2. ArrowRight held on page A moves exactly one player right, page B sees it at the same place, and
   letting go stops it.
3. The two pages agree on every place.
4. Neither page sends the RGS anything; no page error.
5. Closing page B lets its player go once the rejoin grace runs out.
6. A launch with no `?rooms_url=` stops on the boot-failure screen
   (`__IE_RUNTIME_STALE__.reason` names `rooms_url`).

Screens: `01-page-a.png`, `02-page-b.png` (both players), `03-no-server.png`.
