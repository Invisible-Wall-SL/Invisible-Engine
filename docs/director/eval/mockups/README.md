# Reference mockups

A small, fixed set of mockups **we own**, for the Director mockup analysis fixtures (ADR-0005) and
for the agent evaluation of a `mockup-analyst` definition change (ADR-0007, PLAN 5.4:
`.github/workflows/agent-eval.yml` runs main's definition and the edited one over this set and
scores each against `expected-breakdown.json`, per element's status and regions). Every image is
drawn by `apps/launcher-api/scripts/generate-director-eval-mockups.mjs` from flat shapes, so there is
no third-party art here and the "these designs belong to us or to the client" rule holds for the
tests too.

| File                            | Tag                  | What it holds                                                                                                                                                            |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base-game.png` (1280×800)      | Base game            | background, gold logo, four jackpot plaques, a reel frame with 15 symbol tiles, the bet panel with a spin button, and a **BUY** button the template's math does not have |
| `big-win.png` (960×600)         | Big win              | the win banner over a coin shower                                                                                                                                        |
| `style-reference.jpg` (800×500) | style reference only | violet and jade mood, no game elements                                                                                                                                   |

`reference.json` carries:

- `template` and `regions` — what `gamemaker.get_template` and `atlas.list_regions` answer for the
  fixture's template: five locked items (its `betModes` is `base` only) and 23 regions in two atlases.
- `fonts` — what `fonts.list` answers: two catalogue fonts, neither named by the canned font gap
  ("carved serif capitals"), so the snapshot keeps it.
- `images` — the listing `mockups.list` answers, plus each image's `dominantColors`, which the
  generator computes with the launcher's real k-means (`mockupPixels.ts`). The launcher fixture
  recomputes them and fails if they drift.
- `answers` — the canned analyst output the fake transport returns per image. They are written to
  exercise the code rules: a buy button the model calls _matched_, an unknown region, a `left_out`
  claim no rule confirms, a box outside the image, a lower-cased region name, and a magenta swatch no
  image supports.

`expected-breakdown.json` is the snapshot the worker fixture compares against:

```
pnpm --filter director-worker check:mockups            # compare
pnpm --filter director-worker check:mockups --update   # accept a deliberate change
node apps/launcher-api/scripts/generate-director-eval-mockups.mjs   # redraw + refresh colours
```

Keep the set small and the drawings boring: a palette check needs known colours and a crop check
needs known boxes.
