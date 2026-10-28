# Playtest — card sample (`card-sample`)

The first card game ([card-games](../design/card-games.md) C3): a **rules-decided** (free-play) duel
against the device on the shared runtime. Each side has a 15-card deck from the invented 24-card
sample library, a hand, a board of units and a hero at 30 health; the player plays cards by dragging
them onto the board or a target, attacks the same way, and ends each phase with **End Turn**. The
device answers with `cardAi.js` (`normal`). Status: [status/game-families](../status/game-families.md)
(Card C3).

It is exactly what Game Maker scaffolds for a new `card` project: the card scene set
(`engine-layout` `referenceLayouts/card.ts`: the table `basegame` with the spawn layers `hand`,
`board`, `enemyBoard`, `enemyHand`, the hero portraits `playerHero` / `enemyHero`, the readouts and
End Turn; `cardDeckPick`; `cardWon` / `cardLost`), the seed config
(`apps/launcher-api/src/lib/data/gameConfig/card.rules.json`), the starter flow (`engine-flow-v2`
`cardsSeed.ts`) and the placeholder frame `cardFrame` (`CARD_FRAME_PLACEHOLDER_DEF`). It has no RGS:
the runtime runs `cards.js` itself and sends no request.

It is not a published project: the playtest builds its own snapshot. The current-games harness has no
card screen script yet (`SCRIPT_FOR_KIND` gains `card` with the first published card game).

## Launch

```
pnpm --filter 'lines^...' build
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/card-play.mjs --runtime apps/lines/build --out .cache/card-play
```

`card-play.mjs` bakes the snapshot from the seeds and the frame, serves it from the real Invisible
Test Server, boots it at 1920 × 1080 with `?cdseed=sample` (the match seed), takes the loading and
deck-pick screens with Space, and plays with real mouse events. It reads the table through the
determinism probe (`state().cards`: the turn, the phase, both healths and every seated card with its
zone, instance id and place) and writes `result.json` and a screenshot per moment; it exits 1 when a
verdict fails. `--card-seed <s>` deals another match.

**In a browser by hand:** the same snapshot boots in any runtime build at
`/<key>/?runtime=1&project=<key>&k=x&editorDocBase=<snapshot server>`; drag a card from the hand onto
the board or onto a lit target, or tap a card and then its target.

## What it checks

| Verdict                                               | How                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The bake ships the card frame                         | it is spawned only, so the bake seeds it as publish does (`cardGameComponentIds`)    |
| The match starts on the table with both hands dealt   | after the deck pick, `basegame` is up and the hand holds at least three cards        |
| The player gets the turn                              | waits out the device's turn when it goes first                                       |
| A drop off any target snaps the card back             | a drag to the top-right corner leaves the hand and the board as they were            |
| Dragging a playable card onto the board plays it      | a drag from the hand to the board centre plays the card                              |
| End Turn passes the turn and the device plays it back | two presses (main → combat → end); the turn number grows and the player has it again |
| Free play sends the RGS nothing                       | no `/api/` request but the snapshot's                                                |
| No page error                                         | none raised                                                                          |

## What to look at

- The frames: cost top-left, a unit's attack and health bottom-left and bottom-right, the rules text
  under the art, the enemy hand as card backs.
- The readouts: both healths, the resource and its cap, both deck counts, the turn.
- A dragged card's body follows the pointer (Align Target); a refused drop springs back to its slot.
