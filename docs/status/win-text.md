# Invisible Win Text — status

> Design: [docs/design/invisible-win-text.md](../design/invisible-win-text.md) · Guide: [docs/tools/win-text.md](../tools/win-text.md) · Agent: _none yet — closest are `launcher-studio` (tool page) + `engine-pixi-svelte` (render)_

**One-line state:** Built on `main` — W1–W8 (doc/storage, endpoints, engine resolver, the four
families, the `/win-text` page, registry + docs, the Localization `winText` origin, bake +
runtime-bundle wiring) are in, plus **W9: win text now NAMES the paying symbol** (`{symbolName}`,
authored in `/symbols`) and "N of a kind" is gone from every default; ⏳ owner visual-verify the
page and a real authored win in-game.

## Current state

The `/win-text` launcher tool authors the TEMPLATES the game says about a win, and feeds them to
Invisible Localization for translation.

- **The contract lives in `packages/engine-layout/src/lib/winText.ts`** — the doc type,
  `WIN_TEXT_DEFAULTS`, the fallback chain (`resolveWinLineMessage`), `formatWinText`, and the
  harvest collector. Both the game and the launcher import it (launcher already depends on
  `engine-layout`), so the tool's grid and the game's render can't disagree.
- **Localize the TEMPLATE, then interpolate** (`formatWinText`). This is the whole point: the
  old code composed `"Win $1.00 — 2 of a kind"` post-format, which is unique per amount and so
  could never be a catalog key — localization was structurally unreachable. A template is a
  stable, finite, harvestable key. Never interpolate then localize.
- **Fallback chain**, most-specific first: `byCell["H1:5"]` → `bySymbol["H1"]` → `byCount["5"]`
  → `default`. Symbol beats count deliberately (`S`→"SCATTER" must beat `2`→"PAIR!"). The page's
  grid renders the whole chain as one table: an "Any symbol" row (= `byCount`), an "Any count"
  column (= `bySymbol`), and the default in the corner.
- **Storage** — `<client>/<project>/win-text/win-text.json`, sparse, blanks pruned on save.
  Pure config, no assets ⇒ no `deploy/` export step (the `symbols.winLine` precedent).
- **Endpoints** — session+role gated REST `GET`/`PUT /api/win-text` (authoring); deploy-token
  gated `GET /api/win-text/doc` (the bake has no session, mirrors `/api/localization/strings`).
- **Conditional writes from day one** — `{ doc, baseEtag?, force? }` → `precondition()` →
  `ConflictError` → 409 via `json()` (never `error()`, which would 502 and hide the cause), with
  an "Overwrite with mine" path that never discards local edits. The first draft mirrored
  `symbolsStorage.ts` and inherited its unguarded `putObjectText` — that's the *legacy tier*
  (manual-save tools are sequenced last in the concurrency plan). The live convention is `r2.ts`
  + `editorStorage.ts` + `api/flow-v2/save`. `loadWinTextDocWithEtag` reports `existed` apart
  from the doc so a corrupt doc doesn't become permanently unsaveable (412 forever).
- **Both bundle paths wired** — `bake-editor-doc.mjs` AND `runtimeBundle.ts`. A new baked-data
  class must reach both or the Game Maker path silently ships without it (the `effects`/`rigFx`
  precedent). Both omit the key when un-authored, so bundles stay byte-identical.
- **Localization** — `LocalizationEntry.origin` gained `'winText'` beside `'editor'`/`'manual'`;
  `harvestWinText` emits one read-only "Win text" section. `HarvestSection.origin` now tags the
  entries a section reconciles, so `reconcileWithEditor` stayed generic. Prune + bucket checks
  now test `=== 'manual'` (not `!== 'editor'`) so a non-editor auto origin can't be mistaken for
  a hand-authored row.
- **Parity is the acceptance test** and is proven: 21 offline checks over the real module cover
  the three legacy `showMessage` branches, the bare amount stamp, the empty message layer, the
  chain, localize-then-interpolate (incl. a translation reordering tokens), and unknown-token
  robustness.

### W9 — the text names the symbol (2026-07-24)

The tool shipped with the engine's old literals as its DEFAULTS, so every unauthored game still
said "Win $1.00 — 2 of a kind". That is jargon, and it was the only thing the text *could* say:
a symbol id (`H1`) is unspeakable, so there was no word to put in a sentence.

- **`SymbolsDoc.names`** — `H1 → { singular: 'Banana', plural: 'Bananas' }`, authored on each row
  of the `/symbols` grid (two boxes under the id). Both forms authored, never derived — `+s`
  guessing gives "Cherrys" and means nothing translated; unset `plural` reuses `singular`.
- **`engine-layout/symbolNames.ts`** is the shared resolver (game + both tools). An unnamed
  symbol resolves to its own **id**, so there is no "unnamed" branch anywhere — only a
  provisional-looking word. The name is localized **inside** the resolver, because
  `formatWinText` interpolates after localizing and a raw substitution would never translate.
- **New defaults**: `You win {amount} with {count} {symbolName}` / `You win {amount}` /
  `{count} {symbolName}`. This is a deliberate BREAK of the byte-identical-defaults contract —
  the whole point was to stop shipping the jargon; an authored doc is untouched.
- **`resolveToastTemplate` now requires a symbol** before it picks a count-bearing branch, so a
  generic `showMessage` with only an amount falls to `amountOnly` instead of printing a bare
  `{symbolName}`.
- **Plumbing**: `showMessage` gained a `symbol` param in `BOOK_OF_VOCAB` + both reference
  choreographies; `showWinInfoMessage`/`winLineTextFor` resolve the name. Graphs authored BEFORE
  the pin existed (the published ones) still name correctly via `rememberWinSymbol` — the symbol
  the immediately-preceding `showWinLine` announced, read only when the counts match. Wiring the
  pin makes that fallback unused.
- **Travel**: `symbolExport` passes `names` through verbatim (assetless, sparse, omitted when
  empty) → `bakedSymbolNames()`. While wiring the bake whitelist, **`winCycle` turned out to be
  missing from it entirely** — the runtime-bundle path carried it but the bake path didn't, so a
  project that turned the win-symbol replay off shipped it ON. Fixed in the same pass.
- **26 offline checks** over the real modules:
  `node packages/engine-layout/scripts/test-win-text-symbol-names.mjs`.

### Two findings that shaped the build
1. **`winLevelMap[].text` is DEAD DATA** — nothing reads it. The tier words players see are
   painted into the big-win SPINE ART; `Win.svelte` draws only the count-up amount. So
   `winLevels` defaults to `{}` and the caption is OPT-IN — seeding the coded literals would
   have drawn a second caption over art that already says it. Authoring one is only right for a
   game whose art carries no words (which is also the only way to translate a tier without
   re-cutting art).
2. **The toast needs THREE templates, not one.** `showMessage` is generic and assembles from
   whichever of `amount`/`kind` it got, so a single template would render `"Win $1.00 — {count}
   of a kind"` on the amount-only branch. `toast.full`/`amountOnly`/`countOnly` map 1:1 onto the
   legacy branches.

## Open items / next
1. **⏳ Owner visual-verify** — the `/win-text` page renders behind the auth gate (Claude can't
   sign in), and a real authored win in-game. Author a `default` template, bake, confirm the
   message draws on the line and reads through a translation. The conflict path needs the real
   check the concurrency plan asks for: **two profiles, two users, one project, racing saves** —
   a green build proves nothing about it.
2. **Bitmap-font glyph risk** — the win line stamps BITMAP text (`winLine.text.font`, default
   `gold`). A font baked with digits but no letters black-screens the game on a letter (see
   `gotcha_bitmap_font_missing_glyph_blackscreen`). Authored win text is the first thing to put
   arbitrary LETTERS on that font. Worth a guard/warning in the tool.
3. **Match counts are `[2,3,4,5]` in the page** — every current template is a 5-reel board. The
   doc accepts any count key, so only that list widens for a wider board.
4. **Win-level aliases are listed in the page** (`big`/`superwin`/`mega`/`epic`/`max`) — unlike
   the symbol list they aren't published to R2, so there's no live source to read them from.
5. **No dedicated agent file** (`.claude/agents/win-text.md` doesn't exist).

## Blocked (owner / external)
- Nothing.

## Recent changes
- 2026-07-29 — added a **Free spins** family: the `freeSpins.retrigger` template (default
  `You won +{count} Extra Free Spins`), authored in `/win-text` and auto-harvested into
  `/localization` like the toasts. Backs a free-spin RETRIGGER celebration screen: a new
  `freeSpinsAddedText` composed-string value source renders the localized sentence with the extra
  count interpolated (`{count}` = the `freeSpinRetrigger` book event's `extraFs`, captured at
  dispatch in `apps/lines/src/game/utils.ts`), plus a `freeSpinsAdded` number source for a bare
  "+N" badge. Touches `winText.ts` (doc/defaults/resolve/harvest), `winTextStorage.ts` (schema +
  prune), the `/win-text` page, `componentCatalog.ts` (source keys), `Game.svelte`/`stateUi`.
  Verified `node scripts/test-win-text-symbol-names.mjs` (retrigger default/override/interpolate/
  localize + harvest) + `engine-layout` build. Pairs with Invisible Flow FS-4 (retrigger authorable).
- 2026-07-24 — W9: win text names the paying symbol (`{symbolName}` from `SymbolsDoc.names`);
  every "N of a kind" default replaced; `showMessage` gained a `symbol` pin; `winCycle` bake gap
  fixed on the way past.
- 2026-07-16 — tool built: doc/storage/endpoints, engine resolver + the four families, `/win-text`
  page, registry + docs, Localization `winText` origin, bake + runtime-bundle wiring.
