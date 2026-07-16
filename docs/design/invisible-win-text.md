# Invisible Win Text — design

> Status: [docs/status/win-text.md](../status/win-text.md) · Guide: [docs/tools/win-text.md](../tools/win-text.md)

The online tool (route `/win-text`) that authors **every string the game says about a win** —
the win-line message, the win-amount format, the win-level tiers (`BIG WIN` …), and the
info-bar toast — as **templates**, and feeds those templates to Invisible Localization for
translation.

## 1. Why this exists

Today win copy is hardcoded English in two places, neither authorable nor translatable:

| Where | What | Problem |
|---|---|---|
| `apps/lines/src/game/flowEffects.ts` (`showMessage`) | `` `Win ${amount}` `` + `` `${kind} of a kind` `` | Composed in code, in English. |
| `apps/lines/src/game/winLevelMap.ts` | `'BIG WIN'`, `'SUPER WIN'`, `'MEGA WIN'`, `'EPIC WIN!'`, `'MAX WIN'` | Frozen per-game constants — **and dead**: see §1.2. |

The win line itself (`components/WinLine.svelte`) stamps **only** a currency amount — there is
no message layer at all.

### 1.1 The load-bearing constraint: template before format, not format before template

Invisible Localization keys every translation by its **source text**
(`localizationHarvest.ts` — `items.push({ key: source, source })`), and the engine resolver
(`engine-layout/registerTextResolver.ts`) looks a string up by that exact literal.

`showMessage` composes `"Win $1.00 — 2 of a kind"` **after** formatting. That string is unique
per amount, so it can never be harvested and never matches a catalog key. Localization is
structurally unreachable for it — not by oversight, but by construction. The existing code
comment concedes the cause: *"The bounded accessor model can't template a string (§11.4)"* — so
it templates in code instead.

**This tool inverts that order.** The author writes a template — `"{count} OF A KIND"` — which
is a stable, finite, harvestable string. That template is the localization key. The runtime
**resolves the template through the catalog first, then interpolates** `{count}` / `{amount}`.
The interpolated values need no translation: `{amount}` is already currency-localized by
`bookEventAmountToCurrencyString` → `stateI18n.i18n.number({ style: 'currency', currency:
stateBet.currency })`, which follows the URL's lang/currency. `{count}` is a numeral.

> **Rule:** localize the template, then interpolate. Never interpolate, then localize.

This is why win text needs an authoring tool rather than a Localization "manual" row: a manual
row is a bare `key`/`source` pair with no binding to *which win it describes*. The rule layer —
symbol × count → template — is the thing that doesn't exist yet. Localization owns
**translation**; this tool owns **which template a given win uses**.

### 1.2 Win-level tier text is DEAD DATA (found during the build)

`winLevelMap[].text` (`'BIG WIN'` …) is **read by nothing**. The tier words a player sees are
painted into the big-win **spine art** (`big_win_intro` …); `Win.svelte` draws only the count-up
amount over it. So there is no prior literal to reproduce, and seeding `winLevels` with the coded
words would draw a **second** caption over art that already says it.

Therefore the tier family is **opt-in**: `WIN_TEXT_DEFAULTS.winLevels` is `{}`, nothing is drawn
unless authored, and authoring one is only correct for a game whose big-win art carries no words
— which is also the only way to translate a tier without re-cutting the art per language.

## 2. Scope

Four families, all authored as templates:

1. **Win-line message** — sparse `symbol × count` grid. The new message drawn with the win line.
2. **Win-amount format** — the existing stamped amount, e.g. `{amount}` vs `WIN {amount}`.
3. **Win-level tiers** — the `winLevelMap` text, per level alias.
4. **Toast / info-bar message** — the `showMessage` string.

Out of scope: win-line **style** (font/size/colour) stays in `/symbols` `winLine.text` — that is
presentation, already has a home, and one fact keeps one home.

### 2.1 Placeholders

| Token | Value | Notes |
|---|---|---|
| `{count}` | the win's `kind` | the N of "N of a kind" |
| `{amount}` | `bookEventAmountToCurrencyString(win)` | already currency+locale formatted |
| `{symbol}` | the win's `symbol` id | e.g. `H1` |
| `{line}` | `meta.lineIndex` | the payline index |
| `{message}` | the resolved win-line message | **toast template only** |

An unknown token renders verbatim (no throw) — a typo must never black-screen a game.

## 3. The doc

`<client>/<project>/win-text/win-text.json` — pure config, **no assets**, so it travels
verbatim exactly like `symbols.winLine` (design §S6) and needs no export step.

```ts
type WinTextDoc = {
  version: 1;
  lineMessage?: {
    default?: string;                    // "{count} OF A KIND"
    byCount?: Record<string, string>;    // "2"     -> "PAIR!"
    bySymbol?: Record<string, string>;   // "S"     -> "SCATTER"
    byCell?: Record<string, string>;     // "H1:5"  -> "JACKPOT LINE!"
  };
  amountFormat?: string;                 // "{amount}"
  winLevels?: Record<string, string>;    // "big"   -> "BIG WIN"   (key = winLevelMap alias; opt-in, §1.2)
  toast?: {                              // THREE branches, not one — see below
    full?: string;                       // "Win {amount} — {count} of a kind"
    amountOnly?: string;                 // "Win {amount}"
    countOnly?: string;                  // "{count} of a kind"
  };
  updatedAt?: string;
};
```

**The toast is three templates, not one.** `showMessage` is deliberately generic ("any FlowDoc
can invoke it") and assembles from whichever of `amount`/`kind` it was handed — a call with only
an amount says "Win $1.00". A single template can't express that without conditional syntax, and
one field per branch is simpler *and* honest: each is independently translatable, and the three
map 1:1 onto the legacy `parts` branches.

**Defaults reproduce the prior literals** (`WIN_TEXT_DEFAULTS`), except where there was no prior
literal: `lineMessage.default` is `''` (the win line had no message layer) and `winLevels` is
`{}` (§1.2). Empty template ⇒ nothing rendered ⇒ parity.

**Sparse, every field optional.** A field the doc omits falls through to the coded default,
which mirrors today's literal — so an un-baked or unauthored project renders byte-identically
(the `bakedWinLineConfig()` contract, applied to text).

### 3.1 Resolution precedence

For a win of `(symbol, count)`, the line message resolves **most-specific first**:

```
byCell["H1:5"]  →  bySymbol["H1"]  →  byCount["5"]  →  default
```

Symbol beats count deliberately: a statement about a specific symbol (`W → "WILD LINE!"`) is more
specific than one about a count (`5 → "FIVE!"`). Every level is optional; `default` is the only
guaranteed hit.

> An earlier draft justified this with `S → "SCATTER"` beating `2 → "PAIR!"`. That example is
> **impossible**: `winLineEnabledForWin` skips the whole overlay for a scatter, so its win-line
> message can never render (§3.2). The precedence stands; the example was wrong.

### 3.2 Symbols that can't carry a win-line message

A scatter pays "anywhere" rather than along a payline, so there's no line to trace and no end to
stamp text against — the engine skips the overlay entirely. A win-line message authored for it
could never appear, so the grid must not offer the row at all.

The rule therefore lives in `engine-layout` (`WIN_LINE_EXCLUDED_SYMBOLS` / `symbolDrawsWinLine`),
NOT as a literal `'S'`: it was hardcoded inside the engine's gate alone, which is precisely why the
tool couldn't know and shipped a dead row. `winLineEnabledForWin` now reads the same predicate the
page filters on. Scatter copy belongs in the **toast** instead — which has no per-symbol axis, so
there is currently no way to author scatter-specific text (open item).

The tool's grid shows the **effective** template in every cell plus which level produced it,
with a per-cell reset (↺) and an edited badge — the same override-or-default model the
`/symbols` grid already uses.

## 4. Chain

Pure config with no asset export, so it follows the **localization** path (steps 1,2,3,5 — no
step 4), not the symbols path:

1. **Path** — `projectPaths.ts`: `SUB.winText(c,p)` + `winTextDocKey(c,p)` →
   `<client>/<project>/win-text/win-text.json`.
2. **Storage** — `lib/server/winTextStorage.ts`: Zod schema + `normalizeWinTextDoc` +
   `loadWinTextDoc` (missing → empty) + `saveWinTextDoc` (validates, stamps `updatedAt`,
   prunes empties so an untouched project persists nothing).
3. **Authoring endpoint** — session+role gated `GET`/`PUT /api/win-text?project=…`, REST (the
   client is a rich `$state` doc, so it follows `/symbols`' shape, not localization's form
   actions). **Conditional writes** — see §4.1.
4. **Bake read** — deploy-token gated `GET /api/win-text/doc?project=…&k=…` (the bake has no
   session), fetched by `bake-editor-doc.mjs` → `bundle.winText`. Non-fatal on failure.
5. **Runtime** — `bakedWinText()` in `editor-scenes.ts` (runtime → baked → undefined), coded
   defaults applied.

⚠️ **Both bundle paths, or it silently doesn't ship.** `bake-editor-doc.mjs` (the offline freeze)
and `lib/server/runtimeBundle.ts` (the live Game Maker path) are SEPARATE assemblies. A new
baked-data class must be added to both — omitting the runtime one is exactly how `effects`/`rigFx`
once shipped empty. Both gate on "did the author write anything", so an un-authored project's
bundle stays byte-identical.

`pull-project-assets.mjs` needs no entry — there are no assets. This is the one asset-rule
(CLAUDE.md rule 8) exemption that genuinely applies: nothing lands in `deploy/`.

### 4.1 Conditional writes (`docs/design/multi-user-concurrency.md`)

The page loads the WHOLE doc and PUTs the WHOLE doc, so an unconditional write means the second
author to hit Save erases the first's entire doc — not just the conflicting cell. `updatedAt` is
stamped and never compared, so it catches nothing.

The save is therefore conditional on the ETag the page loaded:
`loadWinTextDocWithEtag` → `saveWinTextDoc(..., baseEtag)` → `precondition()` → `ConflictError` →
**409 via `json()`, never `error()`** (which would surface as an opaque 502 and hide the cause).
Body is `{ doc, baseEtag?, force? }`, mirroring `/api/flow-v2/save`; `force: true` is the explicit
"overwrite with mine". A conflict NEVER reloads or discards the local doc — unsaved work is the
only unrecoverable thing on the page.

> **Do not mirror `symbolsStorage.ts` / `localization.ts` here.** They are the *un-migrated legacy
> tier* (manual-save tools are sequenced last in the concurrency plan), so copying them forward is
> how a new tool ships another unguarded `putObjectText`. The live convention is `r2.ts`
> (`getObjectTextWithEtag` / `precondition` / `ConflictError` / `jsonBaseEtag`) with
> `editorStorage.ts` + `api/flow-v2/save` as the exemplars.

`loadWinTextDocWithEtag` reports `existed` separately from the doc, and that is load-bearing: a
MISSING object and a PRESENT-but-corrupt one both degrade to an empty doc but need OPPOSITE
preconditions. Collapsing them would give a corrupt `win-text.json` `ifNoneMatch: '*'` forever ⇒
412 forever ⇒ permanently unsaveable with no way out from the UI.

## 5. Localization integration

A third origin alongside `editor` and `manual`:

- `LocalizationDoc.entries[].origin` gains `'winText'`. `'editor'` and `'winText'` are both
  **auto** origins (source read-only, re-derived each load, untranslated ⇒ not persisted);
  `'manual'` is the only tool-owned, always-persisted one.
- `localizationHarvest.ts` gains `harvestWinText(winTextDoc)` — emits one `Win text` section of
  `{ key: source, source, label }` with the **exact untrimmed** string as key (matching
  `harvestSceneText`'s contract), via `collectWinTextTemplates` in `engine-layout`.
- `HarvestSection` gains an `origin`, which `reconcileWithEditor` stamps onto the entries it
  reconciles — so that function stays generic over collectors instead of hardcoding `'editor'`.
- `/localization`'s `load` fetches the win-text doc alongside the editor doc and renders the
  **Win text** section with a **read-only source** — this tool owns it, exactly as the Scene
  Editor owns its own strings.
- Reviewed-only export is already enforced by `/api/localization/strings`; nothing to add.

⚠️ **Test `=== 'manual'`, never `!== 'editor'`.** The page bucketed rows with `origin !== 'editor'`
as hand-authored and the save pruned on `origin !== 'editor'`; with a third origin those both
silently mis-classify win-text rows (editable source, bare sources persisted). Both now test for
`'manual'`, so a future collector can't fall into the manual bucket by default.

No runtime resolver change is needed: templates are plain strings, so the existing
`resolveLocalizedText` reaches them once they're catalog keys.

## 6. Engine

`packages/engine-layout/src/lib/winText.ts` is the **shared contract** — the doc type, the
defaults, the fallback chain, `formatWinText`, and the harvest collector. It lives in
`engine-layout` (not the game) because the launcher already depends on that package, so the
tool's grid and the game's render resolve through the *same* code and cannot drift.

- `formatWinText(template, vars)` — `resolveLocalizedText(template)` **then** interpolate. One
  helper, one order, one home. An unknown/absent token renders verbatim rather than throwing or
  printing `undefined`: a typo in an authored template must degrade to visible text, never
  black-screen a live game.
- `editor-scenes.ts` — `bakedWinText()` (runtime → baked → undefined), defaults applied.
- `flowEffects.ts` — `showMessage` assembles from the resolved templates; `winLineTextFor` is a
  new SHARED leaf (beside `winLinePointsFor`) returning `{ amount, message }`, so the coded
  `bookEventHandlerMap.winInfo` handler and the `showWinLine` effect stamp identically — the
  file's existing parity-by-construction rule.
- `WinLine.svelte` — draws message above amount as ONE measured text block, so the existing
  in-window flip/clamp placement governs the whole stamp.
- `Win.svelte` — opt-in tier caption above the count-up amount (§1.2).

Parity is the acceptance test: **with no win-text doc, every string is byte-identical to
today.** Proven by an offline fixture over the real module (21 checks: the three legacy
`showMessage` branches, the bare amount stamp, the empty message layer, the chain,
localize-then-interpolate incl. token reordering, unknown-token robustness).

## 7. Build plan

| # | Step | Done when |
|---|---|---|
| **W1** | Doc + storage + paths (`winTextDocKey`, Zod schema, load/save/prune) | A doc round-trips through R2 |
| **W2** | Endpoints — session `GET`/`PUT`, token-gated bake read | `curl` round-trips both gates |
| **W3** | Engine — `formatWinText`, `bakedWinText()`, coded defaults | Unit-level parity: unauthored ⇒ today's strings |
| **W4** | Wire the four families (`showMessage`, `WinLine`, `winLevelMap`, amount format) | Authored templates render in `apps/lines` |
| **W5** | `/win-text` tool page — grid + the three singles, `ToolTopBar`, effective-value cells | Author + save online |
| **W6** | Registry + docs (rule 9): `TOOLS`/`ROLE_TOOLS`/`TOOL_BAR_ORDER`/`TOOL_DOC_SLUG`, `docs/tools/win-text.md`, `docs/tools/README.md` row | `/docs/win-text` renders |
| **W7** | Localization `winText` origin + harvest + section | A template appears in `/localization` and translates |
| **W8** | Bake wiring + prove end-to-end on Book of Borut remake | A translated win message shows in the live game |

## 8. Open questions

- **Book of Borut standalone** runs its own bundle (not `runtime:lines`), so W4's engine edits
  reach the remake automatically but the standalone needs a submodule bump.
- **Runtime-mode merge** — the known localization gap (i18n initialises at module-eval, before
  the live bundle fetch) applies to win text too: on the Game Maker path the *templates* bake
  fine, but their *translations* hit the same unwired merge. Shared fix, tracked in
  `docs/status/localization.md`.
