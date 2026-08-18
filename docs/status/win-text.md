# Invisible Win Text — status

> Design: [docs/design/invisible-win-text.md](../design/invisible-win-text.md) · Guide: [docs/tools/win-text.md](../tools/win-text.md) · Agent: _none yet — closest are `launcher-studio` (tool page) + `engine-pixi-svelte` (render)_

**One-line state:** Built on `main` — latest: **expanded Book-of wins now say "on N reels"**
(`toast.expanded`), ⏳ owner visual-verify in the remake. Earlier — W1–W8 (doc/storage, endpoints, engine resolver, the four
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
  `symbolsStorage.ts` and inherited its unguarded `putObjectText` — that's the _legacy tier_
  (manual-save tools are sequenced last in the concurrency plan). The live convention is `r2.ts`
  - `editorStorage.ts` + `api/flow-v2/save`. `loadWinTextDocWithEtag` reports `existed` apart
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

### Free-spin trigger no longer shows "You win $0.00 with N Scatters" (2026-07-30)

Under a screen-driving v2 flow (the online Borut/Cages remake), the scatter/book match — the
feature TRIGGER, which pays **no coins** — surfaced through the `winInfo` toast path as
"You win $0.00 with 4 Cages" (`toast.full` with a zero amount), and the free-spin AWARD line the
coded `freeSpinTrigger` handler used to show never fired (v2 owning `freeSpinTrigger` suppresses
that handler — `game/utils.ts` ownership gate). Two engine fixes, both parity-safe:

- **Zero-payout toasts suppressed** — `showWinInfoMessage` (`flowEffects.ts`) short-circuits when
  `amount === 0`: a zero-pay entry is the feature TRIGGER, never a coin win, so it must not render
  "You win $0.00 with N …".
- **Award line placed per PATH (the subtle bit; corrected 2026-07-31).** A first pass fired the
  award in `dispatchBookEvent` on `freeSpinTrigger` — but the shipped Borut-remake FLOW mounts the
  intro CONTAINER on `freeSpinTrigger` (a screen takeover), so a toast there is never seen: the info
  bar is only visible on the base board during the scatter's `winInfo`. So:
  - **Flow path** (v2 owns `freeSpinTrigger`): the zero-pay scatter's `winInfo` toast is REPURPOSED
    into "N Scatters award M Free Spins" inside `showWinInfoMessage`. `M` = `freeSpinTrigger.totalFs`,
    looked up ahead of the trigger `winInfo` by `dispatchBookEvent` (`setPendingScatterAwardFs`,
    because `winInfo` arrives before `freeSpinTrigger`). Gated on `gameType==='basegame'` (trigger
    spin only, not a free-spin retrigger) and `flowOwnsTrigger` (so the coded path can't double it).
  - **Coded / non-flow path**: unchanged — the award still comes from the `freeSpinTrigger` handler
    (which the flow suppresses), shown during that handler's own scatter animation.

Verified against the live buy book: each win is its own `winInfo` (`SCAT,kind4,win0` → award; line
wins still toast normally). Reaches the online games via a **Runtime release**. Not yet an authorable
win-text template — still an engine literal (candidate follow-up: a `freeSpins.trigger` field).

### W9 — the text names the symbol (2026-07-24)

The tool shipped with the engine's old literals as its DEFAULTS, so every unauthored game still
said "Win $1.00 — 2 of a kind". That is jargon, and it was the only thing the text _could_ say:
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

### A symbol in the bar made the whole message smaller (2026-08-18)

Owner report, from the live French build: the same info bar reads at full size for “Bonne chance !!!”
but drops to roughly half that as soon as the sentence carries a symbol picture — “the text becomes
smaller for no real reason, I would like it to be the height of the picture”.

It was a feedback loop the author could not see. `<InlineImageText>` sizes the inline symbol FROM the
font (it is supposed to sit at text height), and then fed that height straight back into the row's
auto-fit as if it were content the box had to accommodate. So the message shrank its own font to make
room for its own picture. The gap is small for a canvas font, and brutal for the bitmap HUD fonts
these plaques actually use: their reported line box runs well under 1em, while the symbol was drawn
at `fontSize * 1.1` — nearly double the text it stood next to, and the auto-fit obeyed the taller of
the two. A bar with a symbol therefore fitted at a far smaller font than the same sentence without one.

- **The row's height is the TEXT's height.** `textHeight` (the tallest text run, measured) replaces
  the old `rowHeight` max-over-everything, and it is what `fitRow` and `textBoxPlacement` use. The
  symbol is a follower, never a constraint.
- **The symbol is drawn at that measured line height**, not at `fontSize * 1.1` — so it matches the
  words instead of towering over them — and is clamped to the box's content height so it still cannot
  spill out of the plaque.
- **`MessageSymbol` divides by the LIVE cell, not `SYMBOL_SIZE`.** `<Symbol>` contain-fits the board's
  cell (`boardGeometry().cellHeightLocal`), which equals 120 only on a uniform board — so a non-square
  authored cell rendered the inline symbol at `size × cell / 120`, i.e. not the height it was asked
  for, which is the text's height. Uniform boards are byte-identical.
- **Offline checks now model a bitmap line box** (`LINE_H = 0.65` in `test-inline-image-box.mjs`) — a
  mirror that assumed `height === fontSize` could not express this bug at all. 24 checks, including a
  shallow plaque proving a symbol costs the message no font size and that the picture ends up exactly
  as tall as the words. Against the old model those same checks return font **10** with a symbol vs
  **18** without.
- **Read out of the live pixi stage** via the story's two new shallow-plaque bars: the sentence with a
  symbol and the sentence without both render at `fontSize` **22** in a 520×40 box. Before, the
  symbol-bearing one lost size to its own picture.

### A BOXED info bar silently cancelled "symbol as image" (2026-08-18)

Reported from the live Italian build: the toast read "Vinci 0,50 € con 2 Cowboy" — the symbol NAME —
with `toast.symbolAsImage` ticked. Not a lost option and not the localization pass: the Info Bar
instance carried a **box width**, and a boxed text node went down the `<TextBox>` branch, which
`stripInlineImage`s the message back to its plain-text fallback. So the toggle did nothing on
exactly the bars that need a box — and the box is not optional there: the bar's line is engine-fed
and LOCALIZED, so `INFO_BAR_DEF` exposes `boxWidth`/`autoFit` precisely so a longer translation stays
inside the plaque art. The two features cancelled each other, with nothing in the UI to say so.

- **`<InlineImageText>` now honours a box** — optional `boxWidth`/`boxHeight`/`padding`/`autoFit`
  props, laid out with the SAME `textBoxLayout.ts` helpers `<TextBox>` uses (`textBoxPlacement` for
  the aligned origin, `textBoxContentWidth/Height` for the fit target), so a boxed message with an
  image sits where one without it would. Omit them ⇒ the original centred row, unchanged.
- **Auto-fit shrinks the whole ROW** — text runs and the symbol together (the image slot is derived
  from the font size), converging through the same measure-feedback loop `<TextBox>` uses. Each run's
  measurement is TAGGED with the font size it was taken at and the row only shrinks once every run
  has reported at the current size — acting on stale (larger) widths would over-shrink.
- **The row stays ONE line by construction**: pixi can't word-wrap a mixed text+sprite run (it
  measures per `<Text>`; an image is not a glyph), so a too-wide boxed row shrinks instead of
  wrapping, and the run style forces `wordWrap: false` so an authored wrap can't make each run wrap
  at pixi's 100px default.
- **Branch order in `LayoutNodeView`** — the inline-image test now runs BEFORE the box test and
  passes the box knobs down. `<TextBox>`'s `stripInlineImage` stays as an unreachable safety net.
- **18 offline checks** over the real `inlineImage` + `textBoxLayout` modules:
  `node packages/engine-layout/scripts/test-inline-image-box.mjs` — the sentinel round-trip, the
  boxed row landing exactly where the box-less centred row does (so ticking a box can't shift the
  message off the plaque), segments edge-to-edge in reading order, left/top alignment + padding,
  and auto-fit converging with the symbol shrinking alongside the text.
- **Storybook proof**: `apps/lines` → _ENGINE-LAYOUT/InfoBar inline symbol image_ — the same message
  un-boxed, boxed, boxed too narrow (auto-fit), and (added 2026-08-18) a shallow plaque with and
  without a symbol. The live render has since been READ out of the pixi stage (font sizes + measured
  line heights per bar; see the section below). Spacing and vertical centring are still checked by
  geometry rather than by eye — the story boots but the pane can't composite a WebGL frame here.

### Symbol as image in the info-bar toast (2026-08-10)

An opt-in toggle on the info-bar toast: **render the paying symbol as its SPRITE instead of its
written name** — "You win $4.00 with 4 [🐄]" — sized to the text. Off by default (parity); the game
still keeps the NAME as the clean fallback.

- **Toggle** — `toast.symbolAsImage` on the win-text doc (`winText.ts` type + `WIN_TEXT_DEFAULTS`
  - `resolveWinText`; schema + prune in `winTextStorage.ts`, persisted only when ON). A checkbox in
    the `/win-text` "Info-bar message" section.
- **How an image rides a string** — the message pipeline is one STRING end-to-end, so a sprite can't
  travel as a character. When the toggle is on, `showWinInfoMessage` (`flowEffects.ts`) builds a
  RICH twin of the toast where `{symbolName}` is a private-use SENTINEL (`engine-layout`
  `wrapInlineImage(symbol, name)`), carried on `stateMessage.current.richText` — **separate from the
  clean `text`** (the written name), which the coded HTML `MessageToast` and any string reader keep.
- **Render** — the info-bar `message` value source returns `richText ?? text`; `LayoutNodeView`'s
  text branch detects the sentinel (`hasInlineImage`) and renders `InlineImageText.svelte`, which
  lays out text runs (`<CatalogText>`, measure-feedback widths like `TextBox`) + the symbol per image
  on one centred line. A game-registered resolver (`registerInlineImageResolver` in `Game.svelte`)
  maps a symbol id → itself when the symbol exists (any type), else undefined ⇒ the sentinel's
  `fallback` (the name) renders as text. No sentinel (every existing message) ⇒ the unchanged plain
  path (parity).
- **The image is drawn by the GAME, not a `<Sprite>` (fixed 2026-08-10).** The first cut resolved a
  symbol → its static sprite `assetKey` and drew a `<Sprite>` — which only works for sprite symbols.
  The **high-paying symbols are SPINE animations**, so they fell back to the name (the reported bug:
  "You win $0.50 with 2Cowboys", name as text, space swallowed). Now `InlineImageText` mounts a
  game bound component (`INLINE_IMAGE_BOUND_COMPONENT` = `messageSymbol`, `MessageSymbol.svelte`) that
  renders the symbol through the SAME `<Symbol>` state machine the board uses — sprite, spine AND
  flipbook — scaled by `size / SYMBOL_SIZE` (preserving the board's sprite↔spine visual match). The
  engine layer can't reach `<Symbol>`, hence the delegation; same pattern as `ExpandingSymbol`. Each
  image sits in a fixed square slot + side margin, because the template's space around the token is
  trimmed off the adjacent text runs (pixi drops boundary whitespace) and the symbol would otherwise
  butt the words ("2🐄") — that margin is the space-swallow fix.
- **Travel** — pure boolean on the win-text doc, so it rides the existing bake + runtime-bundle
  wiring verbatim (both paths embed the doc).
- **Verified offline** — Node fixtures over the built modules: sentinel round-trip
  (`wrapInlineImage`/`parse`/`strip`/`hasInlineImage`), `resolveWinText.toast.symbolAsImage`
  default-off/resolve-on, and `formatWinText` emitting the sentinel. `engine-layout` + `lines` +
  `launcher-api` all build. `apps/lines` static states are SPRITES, so the spine path can't be
  exercised there — it's proven by the identical `ExpandingSymbol` usage. **⏳ Owner: visual-verify
  the live render** (symbol size + vertical alignment + spacing) with the toggle on in a real project
  (needs a baked doc, which can't be flipped offline).

### Expanded (Book-of) wins say "on N reels" (2026-08-18)

Owner report from the live Borut remake: the info bar read **"Vinci 2500,00 € con 4 Stivali"** over
a board showing roughly a dozen boots. The number was right and the sentence was wrong — `winInfo.kind`
is the PAYLINE match count, and for an expanded special that equals the number of **reels** covered,
while `expandBookColumns` has just painted the symbol full-height down each of them. `toast.full`
was written for an ordinary line win, where the count and the visible icons are the same thing.

- **New branch `toast.expanded`** (`winText.ts` type + `WIN_TEXT_DEFAULTS` + `resolveWinText` +
  harvest; schema + prune in `winTextStorage.ts`; a fourth box in the `/win-text` "Info-bar message"
  section with its own live preview beside the ordinary one). Default:
  `You win {amount} with {symbolName} on {count} reels` — the reel framing expanding-symbol slots
  conventionally use, so the count matches the columns the player sees lit. Most such games state no
  count at all; an author who prefers that just writes an amount-only sentence in the box.
- **The SECOND deliberate break of byte-parity defaults** (after W9's de-jargoning), and scoped: only
  a win that actually expanded takes the branch, so every other message is untouched.
- **`resolveToastTemplate` gained an `expanded` flag**, not another payload shape. It is a fact about
  the WIN, not about what the caller knows — hence a flag beside the vars rather than a fifth branch
  keyed on arity. A cleared template falls back to `full`, never to silence.
- **The gate is the SPIN, not the symbol** — new `stateGame.expandedSymbol`, set by
  `expandBookColumns` and cleared by the next `reveal` and at feature end, in BOTH the coded handlers
  and the flow-v2 effects (either may be driving). `specialSymbol` alone would have been wrong: it
  stays set for the whole feature, and most free spins never reach 3+ — those spins pay ordinary line
  wins on the same symbol and must keep the ordinary sentence.
- **7 new offline checks** in `node packages/engine-layout/scripts/test-win-text-symbol-names.mjs`
  (33 total): default, branch selection with/without the flag, interpolation, authored override,
  blank-falls-back-to-`full`, no-symbol-branch immunity, harvest. `engine-layout` builds;
  `apps/lines` svelte-check is clean; the launcher's win-text files add no type errors.
- **⏳ Owner: visual-verify in the remake** — needs a real free-spin expansion, and (see below) a
  check of what `{amount}` is on that toast.

**Open question raised by the same screenshot:** whether the €2500,00 is that single payline's win or
an accumulated total. If several lines each pay an expanded win and their amounts accumulate into one
toast while `count` stays per-line, no template fixes it — the VARS would be wrong. Not reproduced
yet; needs a live look at the round's `winInfo` sequence.

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

- 2026-08-18 — **an inline symbol no longer shrinks the message it sits in.** The symbol is sized from
  the font, but its height was also fed back into the row auto-fit, so a boxed bar shrank itself to fit
  its own picture — dramatic with the bitmap HUD fonts, whose line box is well under 1em against a
  symbol drawn at 1.1em. The row now fits against the TEXT's measured height and the symbol is drawn at
  that height (clamped to the box). `MessageSymbol` also now scales by the board's live cell instead of
  `SYMBOL_SIZE`, so the requested height is honoured on a non-square board. Files:
  `InlineImageText.svelte`, `MessageSymbol.svelte`, `test-inline-image-box.mjs`,
  `InlineImageMessage.stories.svelte`. See the section above.
- 2026-08-18 — **expanded Book-of wins get their own info-bar sentence** (`toast.expanded`, default
  `You win {amount} with {symbolName} on {count} reels`), because `kind` is a REEL count once the
  special has filled the columns and the old sentence miscounted what was on screen. Gated on a new
  per-spin `stateGame.expandedSymbol` (set by `expandBookColumns`, cleared by `reveal` / feature end,
  coded + flow paths). Files: `winText.ts`, `winTextStorage.ts`, `/win-text` page, `stateGame.svelte.ts`,
  `bookEventHandlerMap.ts`, `flowEffects.ts`, `docs/tools/win-text.md`. See the section above.
- 2026-08-10 — **symbol-as-image: spine symbols now render** (bug fix on the same-day feature). The
  first cut drew a `<Sprite>` from the static sprite `assetKey`, so spine high symbols fell back to
  the name ("2Cowboys"). Now `InlineImageText` mounts a game bound component (`messageSymbol` /
  `MessageSymbol.svelte`) that renders any symbol type via `<Symbol>`, scaled to text size; added a
  side margin per image to restore the space the text runs trim. Files: `MessageSymbol.svelte` (new),
  `InlineImageText.svelte`, `registerInlineImage.ts` (`INLINE_IMAGE_BOUND_COMPONENT`), `Game.svelte`
  (resolver + registration). `engine-layout` + `lines` build.
- 2026-08-10 — **symbol-as-image toast toggle** (`toast.symbolAsImage`): the info-bar win toast can
  render the paying symbol's sprite instead of its name, sized to the text. New engine-layout
  `inlineImage.ts` (sentinel) + `registerInlineImage.ts` + `InlineImageText.svelte`; `LayoutNodeView`
  text branch, `stateMessage.richText`, `flowEffects.showWinInfoMessage`, `Game.svelte` resolver,
  `winText.ts`/`winTextStorage.ts`/`/win-text` toggle. Off by default (parity). See the section above.
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
