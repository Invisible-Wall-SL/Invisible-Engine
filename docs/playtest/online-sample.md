# Playtest — online arcade room (`online-sample`)

The first online arcade game ([realtime-multiplayer](../design/realtime-multiplayer.md) §10,
[game-families](../design/game-families.md) P10.14, P10.15): the arcade sample's scene set and placeholder
components with an `arcade.online` config — two characters (`salmon` = `arcadeSalmon`, `bear` =
`arcadeBear`, at most one bear), a 1422 × 800 field, four players, a 2 s rejoin grace — played by
two browsers in one room on a local **game server** (`services/game-server`). Status:
[status/game-families](../status/game-families.md) (P10.14).

The server owns every place; a page sends one input a fixed step (arrows / WASD, Space, J / K for
abilities 1 / 2), draws its own player predicted and everyone else interpolated about 100 ms behind
the room (P10.15). The playtest's config has no `rules` (nobody scores or ends a round; the rules are
`check:online-rules`'), and the snapshot carries no flow, so the layout shows every scene at once.

It is not a published project and no current-games fixture plays it: the playtest builds its own
snapshot and config, and starts its own game server in-process.

## Launch

```
pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/online-play.mjs --runtime apps/lines/build --out .cache/online-play
```

Add `--netcode colyseus` to play the config with the Colyseus SDK's own prediction
(`arcade.online.netcode`, default `engine`); each page must report the mode it ran. Run both.

Each page boots `?runtime=1&ie_determinism=7&rooms_url=ws://127.0.0.1:<port>&project=online-sample`
(page B adds `rooms_character=bear`). The page's frames are stepped by the determinism probe while
real time passes, so the room's patches arrive between steps.

## Checks (`result.json` verdicts)

1. Both pages join one room and draw both players; the server reports one room.
2. ArrowRight held on page A moves exactly one player right — page A draws it moving within its
   first frames (prediction) — page B sees it at the same place, and letting go stops it; it is
   page A's own player.
3. At rest, each page draws every player exactly where the room has it (`state().arcade.online.drawn`
   against `bodies`: the prediction and the interpolation converged), and the two pages agree on
   every place.
4. Neither page sends the RGS anything; no page error.
5. Closing page B lets its player go once the rejoin grace runs out.
6. A launch with no `?rooms_url=` stops on the boot-failure screen
   (`__IE_RUNTIME_STALE__.reason` names `rooms_url`).

Screens: `01-page-a.png`, `02-page-b.png` (both players), `03-no-server.png`.
