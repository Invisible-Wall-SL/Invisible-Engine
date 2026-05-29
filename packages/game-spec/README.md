# game-spec

The **Game Spec** is the single authoring document for a game's frontend: type,
grid, symbols, paylines, bet modes, UI features, theme, info-page rules, locales
and art references — all in one Zod-validated file. The engine itself stays
unchanged; the Spec is the source of truth and the CLI generates the
spec-owned engine files from it.

`packages/game-spec` exports the Zod schema (`GameSpecSchema`, `parseGameSpec`,
the `GameSpec` type) plus the generators, and ships a CLI named `game-spec`.

## CLI

The CLI runs through `tsx` (no precompile step). From the package directory:

```bash
# validate a spec (JSON or a .ts module with a default / named export)
pnpm --filter game-spec cli validate examples/lines.spec.json

# validate + emit the normalized artifacts into <out>
pnpm --filter game-spec cli generate examples/lines.spec.json --out dist/example
```

There are also convenience scripts that target the bundled examples:

```bash
pnpm --filter game-spec validate    # validates examples/book-of-thermopylae.spec.ts
pnpm --filter game-spec generate    # generates from examples/lines.spec.json into dist/example
```

### `validate <spec>`

Loads the spec, parses it against `GameSpecSchema`, prints a one-line summary on
success, or every Zod issue with its path on failure and exits non-zero:

```
✗ invalid spec (2 issues):
  • bet.modes: Array must contain at least 1 element(s)
  • symbols.0.kind: Invalid enum value. Expected 'high' | 'low' | ...
```

### `generate <spec> --out <dir>`

Validates first, then writes into `<dir>`:

| File                   | Purpose                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `<id>.normalized.json` | the validated spec with every schema default filled in                               |
| `game/paytable.ts`     | display paytable (`ServerPayEntry[]` from `utils-shared/paytable`) + `NUM_LINES`     |
| `game/infoManifest.ts` | the `InfoManifest` (from `components-ui-pixi`) that feeds the shared `<InfoOverlay>` |

`config.ts` is intentionally **not** generated here: it also carries math data
(reel strips / `paddingReels`) that is not part of the frontend spec. A fuller
generator (full app scaffold from a template + launcher registration) already
exists as the `scaffold` subcommand — see `src/scaffold.ts`.

## Spec shape

See `examples/lines.spec.json` (a JSON spec mirroring `apps/lines`) and
`examples/book-of-thermopylae.spec.ts` (a typed `bookOf` spec). The top-level
fields:

- `specVersion` — literal `1`
- `meta` — `{ id, name, provider, client?, version }`
- `type` — `lines | ways | cluster | scatter | bookOf`
- `grid` — `{ reels, rows: number[] }` (per-reel rows)
- `bet` — `{ modes: BetMode[], numLines?, denominations? }`
- `symbols` — `{ id, kind, name?, pay?, asset?, trigger? }[]`
- `paylines` — `number[][]` (row index per reel) for line games
- `ui`, `theme`, `info.rules`, `i18n`, `assets` — UI features, theme tokens,
  info-page copy, locales and art references (all with sensible defaults)

The authoritative definition is `src/schema.ts`.
