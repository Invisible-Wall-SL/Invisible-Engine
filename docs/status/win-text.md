# Invisible Win Text — status

> Design: [docs/design/invisible-win-text.md](../design/invisible-win-text.md) · Guide: [docs/tools/win-text.md](../tools/win-text.md) · Agent: _none yet — closest are `launcher-studio` (tool page) + `engine-pixi-svelte` (render)_

**One-line state:** Built on `main` — W1–W8 (doc/storage, endpoints, engine resolver, the four
families, the `/win-text` page, registry + docs, the Localization `winText` origin, bake +
runtime-bundle wiring) are in; ⏳ owner visual-verify the page and a real authored win in-game.

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
- 2026-07-16 — tool built: doc/storage/endpoints, engine resolver + the four families, `/win-text`
  page, registry + docs, Localization `winText` origin, bake + runtime-bundle wiring.
