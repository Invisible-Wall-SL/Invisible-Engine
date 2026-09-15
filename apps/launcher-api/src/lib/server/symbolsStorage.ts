import { z } from 'zod';
import {
	isManifestAssetKey,
	SYMBOL_STATES,
	TUMBLE_PATTERNS,
	TUMBLE_STEP_MS_DEFAULT,
	TUMBLE_STEP_MS_MAX,
} from 'engine-layout';
import { createAtlasRefResolver } from './manifestBasename';
import { symbolsDocKey } from './projectPaths';
import { getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * Invisible Symbols State Machine doc — the per-project symbol→state→asset
 * binding map authored online and shipped to the game through the deploy chain
 * (export → deploy → bake → pull → register). The doc is the data-driven twin of
 * each game's coded `SYMBOL_INFO_MAP` and is merged OVER it cell-by-cell, so it
 * is SPARSE: only edited symbols/states appear; everything unset falls through
 * to the coded default. The schema below therefore validates shape, not
 * completeness. Mirrors `apps/lines/src/game/types.ts#SymbolInfoMap` (the engine
 * S1 contract) — keep the two in step.
 *
 * Schema lives here so S4's exporter (`symbolExport.ts`) and the S3 tool
 * endpoints can both import one source of truth.
 * See `docs/design/invisible-symbols-state-machine.md`.
 */

/** The fixed v1 state set — re-exported from its ONE home in `engine-layout`.
 *  `bookIntro`/`bookIdle` are book-only (the tool gates their grid columns by game
 *  type — see the `/symbols` page), but the schema accepts them for EVERY game so a
 *  book game's authored/published bindings always round-trip. */
export { SYMBOL_STATES };

const sizeRatiosSchema = z.object({
	width: z.number(),
	height: z.number(),
});

/** A single symbol×state binding — a static sprite frame, a spine animation, or an Invisible
 *  Flipbook clip. `sizeRatios` is OPTIONAL on an override cell: absent means the cell inherits
 *  the doc-level `defaultSizeRatios` global (and, failing that, the coded map size).
 *
 *  `flipbook` exists because Spine was previously the ONLY way to animate a state: a `sprite`
 *  cell is one frozen frame, so any moving Spin/Land/Win had to be a skeleton. A frame animation
 *  off an atlas is far cheaper — and it is the cheaper fallback for the Tier-C spine-particle
 *  perf ceiling tracked in docs/status/fx.md.
 *
 *  A flipbook cell carries `clipId` instead of leaning on `assetKey`; the clip already names its
 *  own sheets (and may span several). `assetKey` stays required so a cell is never assetless —
 *  for a flipbook it holds the clip's primary sheet, which keeps every existing consumer that
 *  reads `assetKey` working. */
const symbolCellSchema = z
	.object({
		type: z.enum(['sprite', 'spine', 'flipbook']),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		/** Required in practice for `type: 'flipbook'` — the authored clip this cell plays. */
		clipId: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema.optional(),
		/** Repeat this state’s animation instead of holding on its last frame. ABSENT MEANS LOOP, so
		 * only a deliberate one-shot is stored — keeping the doc sparse, and matching what a flipbook
		 * cell has always done (`clip.loop ?? true`). Spine cells had no way to say this at all, which
		 * is why every spine state froze on its last frame. */
		loop: z.boolean().optional(),
		/**
		 * `flipbook` cells only — PER-STATE playback overrides of the bound clip's own values.
		 * Absent ⇒ the clip decides, so an existing cell round-trips byte-identical.
		 *
		 * The same block a placed `FlipbookNode` carries, for the same reason and now with a
		 * second consumer to prove it: ONE clip serves several states, and how it is walked is a
		 * per-USE decision. Expressing a reversed `explosion` as a second clip forks the frame
		 * list, which forks its referential integrity too — a renamed region then has to be
		 * repaired in both, and the two silently drift the moment the art is re-packed. `loop`
		 * above already worked this way; `direction` and mirroring simply never followed it.
		 */
		fps: z.number().positive().max(240).optional(),
		direction: z.enum(['forward', 'reverse', 'pingpong']).optional(),
		flipX: z.boolean().optional(),
		flipY: z.boolean().optional(),
	})
	.strict()
	.refine((c) => c.type !== 'flipbook' || !!c.clipId, {
		message: 'a flipbook cell needs a clipId',
		path: ['clipId'],
	});

/** State → binding, sparse over the fixed v1 state set. */
const symbolStatesSchema = z.record(z.enum(SYMBOL_STATES), symbolCellSchema);

/** Symbol name → state → binding. Symbol keys are arbitrary, sparse. */
const symbolMapSchema = z.record(z.string().min(1), symbolStatesSchema);

/**
 * A symbol's DISPLAY NAME — the human word the game says for the id (`H1` → "Banana"). Lives in
 * THIS doc because this tool already owns what a symbol is; Invisible Win Text reads it as
 * `{symbolName}` rather than keeping a second, drift-prone symbol list of its own.
 *
 * Both forms are authored and neither is auto-derived: `"{count} {symbolName}"` is read with a
 * number in front of it, and guessing an English `+s` produces "Cherrys" (and means nothing in a
 * translated build). `plural` unset falls back to `singular`, which is right for the many names
 * that don't inflect. See `engine-layout/symbolNames.ts` for the resolution both tools share.
 */
const symbolNameSchema = z
	.object({
		singular: z.string().min(1).optional(),
		plural: z.string().min(1).optional(),
	})
	.strict();

/** Symbol id → display name. Sparse: an unnamed symbol is simply absent and falls back to its id. */
const symbolNamesSchema = z.record(z.string().min(1), symbolNameSchema);

/**
 * PER-SYMBOL SOUND OVERRIDES — the cue one specific symbol plays when it enters one specific state.
 *
 * A SEPARATE section rather than a `sound` field on {@link symbolCellSchema}, and that is load-
 * bearing: the doc is merged over the coded map cell-by-cell (`mergeSymbolMap` in
 * `apps/lines/src/game/symbolMap.ts` spreads per STATE), so an override cell carrying only a sound
 * would replace the whole binding and take the state's ART with it. Sound and art are also
 * independently interesting — "the bell dings when it lands" is a thing to say about a symbol whose
 * art nobody has touched.
 *
 * Sparse at both levels and free-form (a game's audiosprite key), so no enum coupling to a specific
 * game's sound set — an unknown name is declined silently in-game, exactly like the anticipation
 * sounds above. Absent ⇒ the symbol falls through to the config's game-wide slot for that moment
 * (`game-config/sounds`), which is where the shipped defaults live.
 */
const symbolSoundsSchema = z.record(
	z.string().min(1),
	z.record(z.enum(SYMBOL_STATES), z.string().min(1)),
);

/** Global win-frame ("highlight") override — a single spine that loops over winning
 *  symbols. Optional + spine-only: absent means the game uses its built-in default.
 *
 *  `tintMode`/`tintColor` are a MULTIPLY tint the frame applies to the symbols it loops over:
 *  `'fixed'` uses `tintColor` (a `#rrggbb` hex); `'winLine'` uses the paying line's authored colour
 *  (`paylineColors`, resolved at win time). Both absent ⇒ no tint (byte-identical to before). Added
 *  ONLY here on the dedicated highlight schema — the generic per-cell schema is untouched. */
const highlightCellSchema = z
	.object({
		type: z.literal('spine'),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema,
		tintMode: z.enum(['fixed', 'winLine']).optional(),
		tintColor: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.optional(),
	})
	.strict();

/**
 * Global free-spin BOARD-GLOW override — the reel-house backdrop spine behind the reels. Optional +
 * spine-only, mirroring {@link highlightCellSchema}: absent means the game keeps its coded
 * `reelhouse` glow, so an untouched project ships no `boardGlow` and renders byte-identical.
 *
 * `animations` names the coded start→idle→exit chain's three tracks (the engine still OWNS the
 * chaining; this only renames the animations it plays), each sparse — an unset one falls through to
 * its coded `reelhouse_glow_*` name, so a rig that only renames the loop needs one field.
 *
 * `sizeRatios` is the asset's OWN fit ratio against the board box (the coded spine's 0.62×0.66),
 * optional here — NOT a doc-level layout global. The doc-level `defaultSizeRatios` was deliberately
 * removed from this schema (design §S1) because reel LAYOUT belongs in the Scene Editor; this is the
 * per-asset ratio a swapped rig needs to fit the same box, the same thing `highlight.sizeRatios` is.
 */
const boardGlowSchema = z
	.object({
		type: z.literal('spine'),
		assetKey: z.string().min(1),
		animations: z
			.object({
				start: z.string().min(1).optional(),
				idle: z.string().min(1).optional(),
				exit: z.string().min(1).optional(),
			})
			.strict()
			.optional(),
		sizeRatios: sizeRatiosSchema.optional(),
	})
	.strict();

/** Win-line overlay config (Invisible Symbols State Machine). All fields optional and
 *  sparse — anything unset falls through to the game's coded defaults, so an untouched
 *  project ships no `winLine` and renders byte-identical. `enabled` is the LINE's switch:
 *  absent means ON, `{ enabled: false }` draws no line. The stamped amount has its OWN
 *  switch (`text.enabled`) which falls back to this one, so the two are authored
 *  independently and an old one-toggle doc still means the same thing. Colours are CSS hex strings (Pixi 8
 *  `ColorSource` consumes them directly); `width`/`size` are multiples of the symbol
 *  size; `speed` is a draw-speed multiplier. No assets here — the chosen `text.font`
 *  travels via the existing font pipeline. */
const winLineLineSchema = z
	.object({
		color: z.string().optional(),
		width: z.number().optional(),
		glow: z.boolean().optional(),
		glowColor: z.string().optional(),
		animated: z.boolean().optional(),
		speed: z.number().optional(),
		/** Trace the WHOLE payline (all reels), not just the winning segment. Off (absent) ⇒
		 *  the line stops at the win's end where the amount is stamped, byte-identical to before.
		 *  When on, the full path is drawn UNDERNEATH the winning segment in `fullPaylineColor`. */
		fullPayline: z.boolean().optional(),
		/** Colour of the full-payline underlay (only style option for it). Unset ⇒ the coded
		 *  default resolved in `bakedWinLineConfig()`. */
		fullPaylineColor: z.string().optional(),
		/** Draw the line in the winning payline's colour from the Invisible Game Config (when it has
		 *  one), falling back to the `color` swatch. Absent ⇒ ON (historic behaviour). Only the OFF
		 *  override (`false`) persists — it makes the `color` swatch authoritative and ignores config. */
		useConfigColor: z.boolean().optional(),
		/** Show EVERY paying line of the round AT THE SAME TIME instead of one after another: each
		 *  line appears a beat after the previous one (see `allAtOnceDelay`) in its own payline colour
		 *  and they all STAY on screen together until the next spin. Absent ⇒ OFF ⇒ the default
		 *  one-line-at-a-time narration, byte-identical to before. */
		allAtOnce: z.boolean().optional(),
		/** The beat between two lines appearing in `allAtOnce` mode, in SECONDS. Unset ⇒ the coded
		 *  default resolved in `bakedWinLineConfig()`. Only meaningful with `allAtOnce` on. */
		allAtOnceDelay: z.number().optional(),
	})
	.strict();

const winLineTextSchema = z
	.object({
		/** Whether the win AMOUNT is stamped at all — the text's own switch, independent of the
		 *  line's (`winLine.enabled`), so a project can stamp the amount with no line drawn under it.
		 *  Absent ⇒ it follows the line's switch, which is what every doc authored before the split
		 *  meant by one toggle over both. */
		enabled: z.boolean().optional(),
		font: z.string().optional(),
		size: z.number().optional(),
		color: z.string().optional(),
		/** WHERE the amount is stamped. `'line'` (absent ⇒ default, byte-identical to before) puts it
		 *  at the winning line's end; `'boardCenter'` puts it in the middle of the reel window
		 *  instead, where only the most recently announced win stamps so the amounts never pile up. */
		placement: z.enum(['line', 'boardCenter']).optional(),
		/** COUNT the stamped amount up from zero instead of stamping it whole. Absent ⇒ OFF — the
		 *  amount appears at its final value, byte-identical to before this switch. */
		countUp: z.boolean().optional(),
		/** How long that count takes, in SECONDS. Unset ⇒ the engine's coded `0.6`. */
		countUpDuration: z.number().optional(),
		/** On a round that reaches a BIG-WIN tier, the amount text becomes the big win's RUN-UP: it
		 *  counts the ROUND TOTAL from zero to the big-win threshold, then hides as the big-win
		 *  overlay takes over and carries the number the rest of the way. Absent ⇒ OFF. Only
		 *  meaningful with `countUp` on, which is why it drops with it. */
		cueBigWin: z.boolean().optional(),
		/** Fade the stamp in (alpha 0→1) WHILE the count is already running. Absent ⇒ OFF.
		 *  Independent of `countUp` — a static stamp can fade in too. */
		fadeIn: z.boolean().optional(),
		/** How long that fade takes, in SECONDS. Unset ⇒ the engine's coded `0.3`. */
		fadeInDuration: z.number().optional(),
	})
	.strict();

const winLineSchema = z
	.object({
		enabled: z.boolean().optional(),
		line: winLineLineSchema.optional(),
		text: winLineTextSchema.optional(),
	})
	.strict();

/** One stacked symbol's authored config (Invisible Symbols State Machine → stacked-picture reel mode,
 *  `docs/design/stacked-picture-mode.md`). `height` is how many CELLS tall the picture is (the crop
 *  denominator); `art` is the tall picture itself, authored via the SAME per-cell binding schema the
 *  grid uses (sprite frame / spine bundle+animation / flipbook clip). `art` is the RESTING picture (the
 *  default a stacked symbol shows) and `winArt` its optional winning variant. A tall picture is the ONLY
 *  thing a stacked symbol renders — all of its stacked config lives in this one block, no longer a
 *  per-cell `stacked` grid column. */
const stackedSymbolSchema = z
	.object({
		name: z.string().min(1),
		height: z.number().int().min(1),
		art: symbolCellSchema,
		/** The tall picture's WINNING variant — what the stack shows while it is part of a paying line
		 *  (a spine/flipbook that animates the payout), authored with the same picker as `art`. Optional
		 *  and INHERITING: absent ⇒ the stack keeps showing `art` through the win, byte-identical to
		 *  before this existed. `art` stays the default/resting picture. */
		winArt: symbolCellSchema.optional(),
	})
	.strict();

/** Stacked-picture config (Invisible Symbols State Machine). `enabled` is the per-project master
 *  toggle (default OFF, the INVERSE of `winLine`): it both shows the tool's "Stacked pictures" config
 *  block and gates whether the stacked config bakes at all. `symbols` is the authored per-symbol tall
 *  art + height — the editable twin of the old coded `STACKED_PICTURE.heights`, now shipped through the
 *  normal symbol export/bake chain (each `art` asset rides `index.sheets`/`index.spines` exactly like a
 *  per-cell binding, baked as `bundle.symbols.stacked = { symbols: [{ name, height, art }] }`). Sparse
 *  everywhere: an untouched or disabled project persists no `stackedPictures` key and bakes no `stacked`
 *  field, so it stays byte-identical (see `normalizeSymbolsDoc` + `symbolExport.ts`). */
const stackedPicturesSchema = z
	.object({
		enabled: z.boolean().optional(),
		/** When true, a tall picture shows ONLY on a full-height stack; a landed run shorter than the
		 *  symbol's authored height falls back to the normal single icons. Absent/false ⇒ a partial run
		 *  shows the top N/M crop of the picture (default, byte-identical to before). */
		fullHeightOnly: z.boolean().optional(),
		/** When true, a partial stacked run pinned to the board's TOP or BOTTOM edge renders as a CUT-OFF
		 *  tall picture (the visible slice of a symbol scrolled partly off-screen) regardless of
		 *  `fullHeightOnly` — top edge shows the bottom N/M, bottom edge the top N/M. Any run length
		 *  qualifies (even 1). Independent toggle: absent/false ⇒ edge partials follow `fullHeightOnly`. */
		edgeCutoffs: z.boolean().optional(),
		/** How long (ms) a stacked cell HOLDS its win beat. A covered cell mounts no `<Symbol>`, so the
		 *  game can't await a per-icon win animation there and waits a fixed beat instead — this is the
		 *  knob that lets that beat match an authored `winArt` animation. Absent ⇒ the coded default
		 *  (`STACKED_WIN_HOLD_MS`), byte-identical to before. */
		winHoldMs: z.number().int().min(0).optional(),
		symbols: z.array(stackedSymbolSchema).optional(),
	})
	.strict();

/** Resting-board replay of the winning SYMBOLS (the game's `winSymbolCycle`): keep them
 *  animating until the next spin. `enabled` absent means ON; `delay` is the pause in SECONDS
 *  between two passes; `showLine` (absent ⇒ ON) also redraws each win's line + stamped amount on
 *  its pass. Deliberately a SIBLING of `winLine`, not a field inside it — the replay is a separate
 *  switch from the line's existence and style, and `showLine` only asks it to reuse the line. */
const winCycleSchema = z
	.object({
		enabled: z.boolean().optional(),
		delay: z.number().optional(),
		showLine: z.boolean().optional(),
		/** Also re-stamp the win AMOUNT TEXT on each replay pass. Independent of `showLine` (the
		 *  line): absent ⇒ ON, so the text repeats exactly as it did before this switch existed.
		 *  `{ showText: false }` keeps the line replaying while dropping the stamped amount. */
		showText: z.boolean().optional(),
		/** Also re-show that win's INFO TOAST on each replay pass. Absent ⇒ OFF (the toast never
		 *  replayed before this switch), so `{ showMessage: true }` opts a project into the looping
		 *  message. */
		showMessage: z.boolean().optional(),
		/** Darken every non-winning symbol from the win celebration until the next spin, so the
		 *  paying line stands out. Absent ⇒ OFF (byte-parity). Independent of `enabled` — the dim is
		 *  about the whole board, not the replay. */
		dimNonWinning: z.boolean().optional(),
		/** After a BIG win inside a free-spin feature, hold the round on its winning board until the
		 *  player presses SPIN, instead of rolling the next free spin on its own. Absent ⇒ OFF
		 *  (byte-parity). Independent of `enabled`, which only decides whether the held board also
		 *  replays its paying lines. */
		holdAfterBigWin: z.boolean().optional(),
	})
	.strict();

/**
 * Book-symbol VFX — two authored presentation LAYERS the game draws BEHIND (`background`) and IN
 * FRONT OF (`foreground`) the book symbol during free spins. Sparse + optional, mirroring every other
 * doc-global here: an absent `bookVfx`, or an absent layer, persists nothing and ships byte-identical
 * to a game with no book VFX. Passed through VERBATIM to `bundle.symbols.bookVfx` (same as
 * `boardGlow`/`winLine`); the engine render half consumes it.
 *
 * A layer is one of four kinds, each carrying only the field it needs — a `.refine()` enforces that
 * required field is present so a half-authored layer can never round-trip:
 *   sprite   → `assetKey` (a sheet frame key)
 *   spine    → `assetKey` (bundle prefix) + `animationName`
 *   flipbook → `clipId` (the Invisible Flipbook clip; `assetKey` optionally holds its primary sheet)
 *   fx       → `effectId` (an Invisible FX effect)
 * `sizeRatios`/`offset` are OPTIONAL fit hints (× cell), like `boardGlow.sizeRatios`.
 */
const offsetSchema = z.object({
	x: z.number(),
	y: z.number(),
});

/** Does a kind-tagged layer carry the ONE field its kind needs? Shared by every `.refine()` below so
 *  the book-VFX layers and the explosion transition can never disagree about what "half-authored"
 *  means. */
function layerHasKindField(l: {
	kind: 'sprite' | 'spine' | 'flipbook' | 'fx';
	assetKey?: string;
	animationName?: string;
	clipId?: string;
	effectId?: string;
}): boolean {
	switch (l.kind) {
		case 'spine':
			return !!l.assetKey && !!l.animationName;
		case 'flipbook':
			return !!l.clipId;
		case 'sprite':
			return !!l.assetKey;
		case 'fx':
			return !!l.effectId;
		default:
			return false;
	}
}

const bookVfxLayerSchema = z
	.object({
		kind: z.enum(['sprite', 'spine', 'flipbook', 'fx']),
		assetKey: z.string().min(1).optional(),
		animationName: z.string().min(1).optional(),
		clipId: z.string().min(1).optional(),
		effectId: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema.optional(),
		offset: offsetSchema.optional(),
	})
	.strict()
	.refine(layerHasKindField, {
		message: 'a book-vfx layer is missing the field its kind requires',
	});

const bookVfxSchema = z
	.object({
		background: bookVfxLayerSchema.optional(),
		foreground: bookVfxLayerSchema.optional(),
	})
	.strict();

/**
 * The explosion → intro TRANSITION — one project-global animation the game mounts at every seat
 * whose outgoing symbol starts `clearReel` under the `emerge` swap style, so the pop's end and
 * the intro's start overlap instead of cutting (docs/design/perspective-board-mode.md §"The mode
 * switch"). Optional + sparse like `bookVfx`: absent ⇒ nothing renders, nothing ships, byte-identical.
 * Passed through VERBATIM to `bundle.symbols.transition`; the engine (`TumbleBoard.svelte`) owns
 * when it fires and that it never gates the round.
 *
 * Three kinds, NOT four: a transition has a duration, and a `sprite` is one frozen frame. Same
 * one-field-per-kind rule as a book-VFX layer, enforced by the shared `.refine()`.
 *
 * `delayMs` — ms after the explosion fires before the transition mounts (integer ≥ 0). `0` is the
 * default and is PRUNED on save (`pruneTransition`), so a transition authored with no delay writes
 * only its binding.
 */
const transitionSchema = z
	.object({
		kind: z.enum(['spine', 'flipbook', 'fx']),
		assetKey: z.string().min(1).optional(),
		animationName: z.string().min(1).optional(),
		clipId: z.string().min(1).optional(),
		effectId: z.string().min(1).optional(),
		delayMs: z.number().int().min(0).optional(),
	})
	.strict()
	.refine(layerHasKindField, {
		message: 'the explosion transition is missing the field its kind requires',
	});

/**
 * THE CASCADE EXPLOSION PATTERN — the order the winning seats pop in (`pattern`) and the gap
 * between two waves of them (`stepMs`, milliseconds).
 *
 * A SIBLING of `transition`, not a field inside it: the transition is what covers the seam at ONE
 * seat, this is the order the seats are reached in, and a project routinely wants one without the
 * other (the transition is `emerge`-only; a pattern applies to every cascading board).
 *
 * Both fields are optional and both defaults are pruned on save (see `pruneTumblePattern`), so a
 * project that never picks a pattern persists no key and its board keeps exploding in one frame.
 * The pattern list + the step ceiling come from `engine-layout/tumblePattern`, the one home the
 * game's `TumbleBoard` reads them from too.
 */
const tumblePatternSchema = z
	.object({
		pattern: z.enum(TUMBLE_PATTERNS).optional(),
		stepMs: z.number().int().min(0).max(TUMBLE_STEP_MS_MAX).optional(),
	})
	.strict();

/**
 * Reel-anticipation presentation FX (Invisible Symbols State Machine → `docs/design/reel-anticipation.md`
 * Phase 5). The editable twin of the coded `codedTierFx` ramp in
 * `apps/lines/src/game/anticipationPresentation.ts` — the per-tier escalation the client-computed tease
 * mode plays (one entry per configured big-win tier, keyed by alias): camera `zoom`, the overlay
 * spine's `overlayScale`/`overlayAlpha`/
 * `overlayTint`, and the `soundVolume` of the anticipation loop. OPTIONAL + sparse everywhere: an absent
 * `anticipation`, an absent tier, or an absent field all fall through to the coded default, so an
 * un-authored project ships nothing and the mode is byte-identical to Phase 4.
 *
 * `spineKey` optionally swaps WHICH spine drives the per-reel overlay (default the coded `anticipation`
 * spine). Like `boardGlow`/`highlight` it is a full R2 spine-bundle prefix — its bundle rides
 * `index.spines` (no new stranded asset class); the engine still owns the intro→loop→out chaining, so a
 * swapped rig must expose those animation names.
 *
 * `overlayTint` is a `#rrggbb` hex here (the tool's colour picker); the engine reader converts it to the
 * `0xRRGGBB` number the engine's `codedTierFx` ramp uses.
 */
const anticipationTierFxSchema = z
	.object({
		zoom: z.number().optional(),
		overlayScale: z.number().optional(),
		overlayAlpha: z.number().optional(),
		overlayTint: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.optional(),
		// `soundVolume` is the LOOP's escalation target; `stingVolume` is the one-shot activation cue's
		// per-play volume — both 0..1, both sparse (unset ⇒ the coded ramp step).
		soundVolume: z.number().optional(),
		stingVolume: z.number().optional(),
	})
	.strict();

const anticipationSchema = z
	.object({
		spineKey: z.string().min(1).optional(),
		// The overlay animation SET — the base name the engine appends `_intro`/`_loop`/`_out` to (e.g.
		// `anticipation3`). Unset ⇒ the coded unnumbered `anticipation_*` set. Free-form (a spine's
		// animation base), so no enum coupling to a specific rig's variant count.
		animationSet: z.string().min(1).optional(),
		// The per-reel overlay box size in CELLS (positive). Unset ⇒ the coded `0.56 × 1.6` beam. The
		// engine scales the chosen animation to fit, so a taller box shows a full-column anticipation.
		overlayWidthCells: z.number().positive().optional(),
		overlayHeightCells: z.number().positive().optional(),
		// GLOBAL authored sound names (one sting + one loop for the whole mode), not per-tier. Unset ⇒
		// the coded `sfx_anticipation_start` / `sfx_anticipation`. Free-form strings (a game's audiosprite
		// key) — an unknown name is declined silently in-game, so no enum coupling to a game's sound set.
		activationSound: z.string().min(1).optional(),
		loopSound: z.string().min(1).optional(),
		// Alias-keyed + sparse: one entry per configured big-win tier (`/config`), keyed by the tier's
		// ALIAS — no longer a fixed big/mega/massive triple. An unset tier is simply absent.
		tiers: z.record(z.string().min(1), anticipationTierFxSchema).optional(),
	})
	.strict();

/**
 * "A winning symbol POPS at the end of its win" — the switch that gives `explosion` a second
 * meaning on a board that does not cascade.
 *
 * It has to be EXPLICIT and default OFF rather than being inferred from "is `explosion` authored",
 * because every game already binds `explosion` for the Book-of column morph — an implicit trigger
 * would fire on every existing project and break byte-parity on the one beat every paying spin
 * runs. Sparse: only the ON state is persisted, so an untouched project ships no key at all.
 */
const winExplodeSchema = z
	.object({
		enabled: z.boolean().optional(),
	})
	.strict();

/**
 * "No single win beat holds the round longer than this" — the authored CEILING, in milliseconds, on
 * one winning symbol's `win` animation and on the `explosion` that may follow it.
 *
 * It is a SHAPER, and deliberately NOT the runaway guard that already bounds those beats
 * (`WIN_BEAT_CAP_MS` in `apps/lines/src/game/symbolBeat.ts`). That guard is sized ABOVE anything a
 * project plausibly authors, because — as that file says — a cap a real animation can hit stops
 * being a guard and starts being the timing. This field IS an author asking for the timing: a
 * cascading project whose every symbol wins on a 2 s spine pays that twice per tumble, and the
 * round reads as a long wait before the next spin is released. Absent ⇒ the art sets the pace,
 * byte-for-byte as before this existed; set ⇒ a longer animation is cut short.
 *
 * Bounded at BOTH ends here rather than clamped in the engine: under 50 ms nothing reads as an
 * animation at all, and over 10 s the runaway guard has ended the beat long before the ceiling
 * would — so a value outside the range is a typo, and a typo should fail the save loudly instead of
 * being silently ignored on a board nobody is watching at build time.
 */
const winBeatSchema = z
	.object({
		maxMs: z.number().int().min(50).max(10000).optional(),
	})
	.strict();

export const symbolsDocSchema = z
	.object({
		version: z.literal(1).default(1),
		symbols: symbolMapSchema.default({}),
		names: symbolNamesSchema.optional(),
		symbolSounds: symbolSoundsSchema.optional(),
		highlight: highlightCellSchema.optional(),
		boardGlow: boardGlowSchema.optional(),
		winLine: winLineSchema.optional(),
		stackedPictures: stackedPicturesSchema.optional(),
		winCycle: winCycleSchema.optional(),
		winExplode: winExplodeSchema.optional(),
		winBeat: winBeatSchema.optional(),
		bookVfx: bookVfxSchema.optional(),
		transition: transitionSchema.optional(),
		tumblePattern: tumblePatternSchema.optional(),
		anticipation: anticipationSchema.optional(),
		updatedAt: z.string().optional(),
	})
	.strip();

export type SymbolCell = z.infer<typeof symbolCellSchema>;
export type SymbolsDoc = z.infer<typeof symbolsDocSchema>;

/** The empty, valid doc a never-authored project degrades to (parity with a missing editor doc). */
export function emptySymbolsDoc(): SymbolsDoc {
	return { version: 1, symbols: {} };
}

/** Drop empty `line`/`text` style objects and a now-empty `winLine`, so a reset
 *  round-trips to "no winLine" (sparse) rather than persisting `{}`. `text.enabled`
 *  defaults to the LINE's switch and `text.placement` defaults to `'line'`, so a value
 *  equal to its default drops too — otherwise a project that only ever looked at the
 *  panel would start shipping a `winLine`. Mirrors the client's `pruneWinLine`. */
function pruneWinLine(winLine: SymbolsDoc['winLine']): SymbolsDoc['winLine'] {
	if (!winLine) return undefined;
	const next: NonNullable<SymbolsDoc['winLine']> = {};
	if (winLine.enabled === false) next.enabled = false;
	if (winLine.line && Object.keys(winLine.line).length) next.line = winLine.line;
	if (winLine.text) {
		const text = { ...winLine.text };
		if (text.enabled === (winLine.enabled ?? true)) delete text.enabled;
		if (text.placement === 'line') delete text.placement;
		// `countUp` defaults OFF, so only the ON override persists — and both the count's length and
		// the big-win cue are meaningless without it, so they drop with it.
		if (text.countUp !== true) {
			delete text.countUp;
			delete text.countUpDuration;
			delete text.cueBigWin;
		}
		if (text.cueBigWin !== true) delete text.cueBigWin;
		// Same inversion for the fade: only the ON override persists, and its length rides with it.
		if (text.fadeIn !== true) {
			delete text.fadeIn;
			delete text.fadeInDuration;
		}
		if (Object.keys(text).length) next.text = text;
	}
	return Object.keys(next).length ? next : undefined;
}

/** Drop a stacked symbol with no valid art (empty `assetKey`) and a now-empty `stackedPictures`, so a
 *  disabled/un-authored project round-trips to "no stacked config" (sparse) rather than persisting
 *  `{}`/`{ symbols: [] }`. The empty-art filter is also the guard that keeps a half-picked symbol from
 *  ever reaching the wire — the schema's `art.assetKey` is `min(1)`, so a blank one would 400 the save
 *  (the "publish silent double-fail" trap); dropping it here means it simply doesn't persist. */
function pruneStackedPictures(
	config: SymbolsDoc['stackedPictures'],
): SymbolsDoc['stackedPictures'] {
	if (!config) return undefined;
	const next: NonNullable<SymbolsDoc['stackedPictures']> = {};
	if (config.enabled === true) next.enabled = true;
	if (config.fullHeightOnly === true) next.fullHeightOnly = true;
	if (config.edgeCutoffs === true) next.edgeCutoffs = true;
	if (config.winHoldMs !== undefined) next.winHoldMs = config.winHoldMs;
	// A half-picked `winArt` is dropped rather than persisted (same rule as a blank `art`, except an
	// absent win picture is legal here — the stack simply keeps showing `art` while it pays).
	const symbols = (config.symbols ?? [])
		.filter((s) => s.name && s.art?.assetKey)
		.map((s) => (s.winArt?.assetKey ? s : { name: s.name, height: s.height, art: s.art }));
	if (symbols.length) next.symbols = symbols;
	return Object.keys(next).length ? next : undefined;
}

/**
 * The ONE legacy state key, folded before validation.
 *
 * `tumbleExplosion` was renamed to `clearReel` on 2026-09-10 (the behaviour is unchanged — it is
 * still what the cascade removal and the board CLEAR both play). Saved docs in R2 hold the old key
 * in two places: `symbols[name].tumbleExplosion` (the binding) and
 * `symbolSounds[name].tumbleExplosion` (the cue).
 *
 * It has to run BEFORE `symbolsDocSchema.parse`, not as a schema union, because the state records
 * are keyed by `z.enum(SYMBOL_STATES)` — Zod REJECTS an unlisted key rather than stripping it, and
 * `loadSymbolsDocWithEtag` catches a parse failure by falling back to `emptySymbolsDoc()`. A doc
 * carrying the old key would therefore have read as a project that had never authored anything,
 * silently losing every binding it held. Folding here also means nothing downstream — export, bake,
 * the game — ever sees the old name.
 *
 * The new key WINS if a doc somehow carries both: a `clearReel` entry can only have been written by
 * the current tool, so it is the author's later answer.
 */
const LEGACY_STATE_KEYS: ReadonlyArray<readonly [legacy: string, current: string]> = [
	['tumbleExplosion', 'clearReel'],
];

const foldLegacyStates = (states: unknown): unknown => {
	if (!states || typeof states !== 'object' || Array.isArray(states)) return states;
	const entries = { ...(states as Record<string, unknown>) };
	let changed = false;
	for (const [legacy, current] of LEGACY_STATE_KEYS) {
		if (!(legacy in entries)) continue;
		const value = entries[legacy];
		delete entries[legacy];
		changed = true;
		if (entries[current] === undefined && value !== undefined) entries[current] = value;
	}
	return changed ? entries : states;
};

/** Fold {@link LEGACY_STATE_KEYS} through both state-keyed maps of a raw symbols doc. Returns the
 *  input untouched when it holds no legacy key, so a current doc costs one shallow scan. */
export function migrateLegacySymbolStates(input: unknown): unknown {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
	const doc = input as Record<string, unknown>;
	const next = { ...doc };
	let changed = false;
	for (const field of ['symbols', 'symbolSounds'] as const) {
		const map = doc[field];
		if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
		const folded: Record<string, unknown> = {};
		let fieldChanged = false;
		for (const [name, states] of Object.entries(map as Record<string, unknown>)) {
			const foldedStates = foldLegacyStates(states);
			if (foldedStates !== states) fieldChanged = true;
			folded[name] = foldedStates;
		}
		if (!fieldChanged) continue;
		next[field] = folded;
		changed = true;
	}
	return changed ? next : input;
}

/**
 * Validate + normalize arbitrary parsed/posted data into a {@link SymbolsDoc}.
 * Drops empty `symbols` entries (a symbol with no remaining states) so a delete
 * round-trip leaves no dangling keys. Throws `ZodError` on invalid input — the
 * PUT endpoint maps that to a 400.
 */
export function normalizeSymbolsDoc(input: unknown): SymbolsDoc {
	const doc = symbolsDocSchema.parse(migrateLegacySymbolStates(input) ?? {});
	const symbols: SymbolsDoc['symbols'] = {};
	for (const [name, states] of Object.entries(doc.symbols)) {
		if (states && Object.keys(states).length > 0) symbols[name] = states;
	}
	// Names: drop a blank/whitespace form and then a now-empty entry, so clearing the boxes leaves
	// no key and the symbol falls back to its id (the same sparse-round-trip rule as `symbols`).
	const names: SymbolsDoc['names'] = {};
	for (const [symbol, entry] of Object.entries(doc.names ?? {})) {
		const singular = entry?.singular?.trim();
		const plural = entry?.plural?.trim();
		const kept: NonNullable<SymbolsDoc['names']>[string] = {};
		if (singular) kept.singular = singular;
		if (plural) kept.plural = plural;
		if (Object.keys(kept).length) names[symbol] = kept;
	}
	const next: SymbolsDoc = { version: 1, symbols };
	// Sparse like every other optional field: a project that never named a symbol persists no
	// `names` key at all, so its doc stays byte-identical to before this existed.
	if (Object.keys(names).length) next.names = names;
	// Per-symbol sound overrides, pruned at BOTH levels: a blank name drops the state, and a symbol
	// with no states left drops entirely. Clearing every dropdown must round-trip to no key at all,
	// or the symbol keeps shipping an empty override object that reads as "authored" forever.
	const symbolSounds: NonNullable<SymbolsDoc['symbolSounds']> = {};
	for (const [symbol, states] of Object.entries(doc.symbolSounds ?? {})) {
		const kept: Record<string, string> = {};
		for (const [state, name] of Object.entries(states ?? {})) {
			const trimmed = name?.trim();
			if (trimmed) kept[state] = trimmed;
		}
		if (Object.keys(kept).length) symbolSounds[symbol] = kept;
	}
	if (Object.keys(symbolSounds).length) next.symbolSounds = symbolSounds;
	if (doc.highlight) next.highlight = doc.highlight;
	// Copied explicitly — this rebuild is a whitelist, so a field that passes Zod but isn't listed
	// here is still dropped on save (the silent round-trip trap).
	if (doc.boardGlow) next.boardGlow = doc.boardGlow;
	const winLine = pruneWinLine(doc.winLine);
	if (winLine) next.winLine = winLine;
	// Sparse whitelist: persist the master toggle (only the non-default ON flag) plus the authored
	// stacked symbols (only those with valid art), so a disabled/un-authored project round-trips to no
	// `stackedPictures` key (byte-parity). See `pruneStackedPictures`.
	const stackedPictures = pruneStackedPictures(doc.stackedPictures);
	if (stackedPictures) next.stackedPictures = stackedPictures;
	// Sparse like `winLine.enabled`: only the non-default (off) flag persists, but an authored
	// delay always does — its default is a number the author may legitimately re-pick.
	const winCycle: NonNullable<SymbolsDoc['winCycle']> = {};
	if (doc.winCycle?.enabled === false) winCycle.enabled = false;
	if (doc.winCycle?.delay !== undefined) winCycle.delay = doc.winCycle.delay;
	if (doc.winCycle?.showLine === false) winCycle.showLine = false;
	if (doc.winCycle?.showText === false) winCycle.showText = false;
	// INVERSE of its siblings: `showMessage` defaults OFF, so only the ON flag persists.
	if (doc.winCycle?.showMessage === true) winCycle.showMessage = true;
	// Same inverse-of-default persistence as `showMessage`: `dimNonWinning` defaults OFF, so only the
	// ON flag is written and OFF round-trips to no key.
	if (doc.winCycle?.dimNonWinning === true) winCycle.dimNonWinning = true;
	// Same inverse-of-default persistence again: `holdAfterBigWin` defaults OFF.
	if (doc.winCycle?.holdAfterBigWin === true) winCycle.holdAfterBigWin = true;
	if (Object.keys(winCycle).length) next.winCycle = winCycle;
	// Default-OFF, so ONLY the ON state persists and an untouched project round-trips to no key —
	// the same inversion `showMessage`/`dimNonWinning`/`holdAfterBigWin` use above.
	if (doc.winExplode?.enabled === true) next.winExplode = { enabled: true };
	// Sparse on a VALUE rather than on a flag: the key exists only while a ceiling is authored, so
	// clearing the box round-trips to no key at all and the beats go back to running as long as their
	// art does. Rebuilt (not forwarded) like every field above — this block is the whitelist.
	if (doc.winBeat?.maxMs !== undefined) next.winBeat = { maxMs: doc.winBeat.maxMs };
	// Sparse whitelist like `boardGlow`: each layer already passed the schema `.refine()` (so a
	// half-authored layer never reaches here), so copy the present ones and drop a now-empty
	// `bookVfx` — leaving a slot unset writes nothing and round-trips to no key (byte-parity).
	if (doc.bookVfx) {
		const bookVfx: NonNullable<SymbolsDoc['bookVfx']> = {};
		if (doc.bookVfx.background) bookVfx.background = doc.bookVfx.background;
		if (doc.bookVfx.foreground) bookVfx.foreground = doc.bookVfx.foreground;
		if (Object.keys(bookVfx).length) next.bookVfx = bookVfx;
	}
	// Whitelisted like `bookVfx` (a field that passes Zod but isn't listed here is dropped on save),
	// with its one default pruned — see `pruneTransition`.
	const transition = pruneTransition(doc.transition);
	if (transition) next.transition = transition;
	// Whitelisted + defaults pruned, so a project left on "All at once" round-trips to no key at all
	// and its cascade keeps exploding in one frame — see `pruneTumblePattern`.
	const tumblePattern = pruneTumblePattern(doc.tumblePattern);
	if (tumblePattern) next.tumblePattern = tumblePattern;
	// Sparse whitelist like `boardGlow`/`bookVfx`: drop an empty per-tier object and a now-empty
	// `anticipation`, so a reset round-trips to no key and an un-authored project stays byte-identical.
	const anticipation = pruneAnticipation(doc.anticipation);
	if (anticipation) next.anticipation = anticipation;
	return next;
}

/** Drop a `delayMs` of `0` — the default the engine applies when the field is absent — so a
 *  transition authored with no delay persists only its binding and a reset-to-zero round-trips to
 *  the same bytes as never having typed one. The binding itself already passed the `.refine()`. */
function pruneTransition(transition: SymbolsDoc['transition']): SymbolsDoc['transition'] {
	if (!transition) return undefined;
	if (transition.delayMs === undefined || transition.delayMs > 0) return transition;
	const { delayMs: _zero, ...binding } = transition;
	return binding;
}

/**
 * Drop the two defaults, so only a DELIBERATE pattern persists.
 *
 * `all` is what the cascade has always done, and a `stepMs` on top of it means nothing (the engine
 * short-circuits the pattern before it reads the step), so an author who picks a pattern and then
 * picks `all` again must round-trip to the same bytes as never having opened the panel. The step is
 * dropped only when it EQUALS the default — an author who deliberately re-picks 80 ms is storing the
 * same number the engine would have applied anyway.
 */
function pruneTumblePattern(
	tumblePattern: SymbolsDoc['tumblePattern'],
): SymbolsDoc['tumblePattern'] {
	if (!tumblePattern) return undefined;
	const pattern = tumblePattern.pattern;
	if (!pattern || pattern === 'all') return undefined;
	const next: NonNullable<SymbolsDoc['tumblePattern']> = { pattern };
	if (tumblePattern.stepMs !== undefined && tumblePattern.stepMs !== TUMBLE_STEP_MS_DEFAULT) {
		next.stepMs = tumblePattern.stepMs;
	}
	return next;
}

/** Drop each empty per-tier FX object and a now-empty `anticipation`, so a reset round-trips to
 *  "no anticipation" (sparse) rather than persisting `{}` / `{ tiers: {} }`. */
function pruneAnticipation(anticipation: SymbolsDoc['anticipation']): SymbolsDoc['anticipation'] {
	if (!anticipation) return undefined;
	const next: NonNullable<SymbolsDoc['anticipation']> = {};
	if (anticipation.spineKey) next.spineKey = anticipation.spineKey;
	if (anticipation.animationSet) next.animationSet = anticipation.animationSet;
	if (typeof anticipation.overlayWidthCells === 'number' && anticipation.overlayWidthCells > 0)
		next.overlayWidthCells = anticipation.overlayWidthCells;
	if (typeof anticipation.overlayHeightCells === 'number' && anticipation.overlayHeightCells > 0)
		next.overlayHeightCells = anticipation.overlayHeightCells;
	if (anticipation.activationSound) next.activationSound = anticipation.activationSound;
	if (anticipation.loopSound) next.loopSound = anticipation.loopSound;
	const tiers: NonNullable<NonNullable<SymbolsDoc['anticipation']>['tiers']> = {};
	for (const [alias, fx] of Object.entries(anticipation.tiers ?? {})) {
		if (fx && Object.keys(fx).length) tiers[alias] = fx;
	}
	if (Object.keys(tiers).length) next.tiers = tiers;
	return Object.keys(next).length ? next : undefined;
}

/**
 * Load a project's symbols doc, falling back to an empty valid doc when the R2
 * object is missing or unparseable (parity with `loadDoc`).
 */
export async function loadSymbolsDoc(clientKey: string, projectKey: string): Promise<SymbolsDoc> {
	return (await loadSymbolsDocWithEtag(clientKey, projectKey)).doc;
}

/**
 * {@link loadSymbolsDoc} plus the ETag its next save must match.
 *
 * `etag` comes off the READ, independent of whether the body parsed — a corrupt doc
 * also falls back to `emptySymbolsDoc()`, so inferring "create" from "empty doc" would
 * make it 412 forever. `etag === null` means, and only means, no object.
 * See `docs/design/multi-user-concurrency.md` Phase 1.
 */
export async function loadSymbolsDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: SymbolsDoc; etag: string | null }> {
	const obj = await getObjectTextWithEtag(symbolsDocKey(clientKey, projectKey));
	if (!obj) return { doc: emptySymbolsDoc(), etag: null };
	try {
		return { doc: normalizeSymbolsDoc(JSON.parse(obj.text)), etag: obj.etag };
	} catch {
		return { doc: emptySymbolsDoc(), etag: obj.etag };
	}
}

/** A sprite cell's assetKey that pins its atlas by a bare-basename scoped ref — `<basename>::region`
 *  where the basename has no `/`. `parseScopedFrameRef` refuses it (its `isManifestAssetKey` needs a
 *  `/`), so the runtime treats the whole thing as a bare region and the atlas-scoped lookup never
 *  engages — the same miss the flipbook clips had. Split it here so the manifest can be repaired. */
function splitNonManifestScopedRef(assetKey: string): { prefix: string; region: string } | null {
	const i = assetKey.indexOf('::');
	if (i <= 0) return null;
	const prefix = assetKey.slice(0, i);
	// A FULL `.json` manifest ref is already correct (the working `.json` scoped path). Only a bare
	// manifest basename (no `/`) or a Sheet-Maker OUTPUT PREFIX (`.../sheets/S_Lotus/`, no `.json`)
	// needs resolving to the real manifest key the sheet ships + registers under.
	if (isManifestAssetKey(prefix)) return null;
	return { prefix, region: assetKey.slice(i + 2) };
}

/**
 * Repair every SPRITE cell whose scoped `<prefix>::<region>` assetKey names its atlas by anything
 * OTHER than a full `.json` manifest key — a bare manifest basename OR a Sheet-Maker output prefix
 * (`.../sheets/S_Lotus/`) — by resolving the prefix to the real `.json` manifest the sheet ships +
 * registers under. Without this the flat `<prefix>::region` key the tool stored never lands in the
 * game's `loadedAssets` (the sprite renders blank), and same-named frames on DISTINCT atlases
 * collide. The export layer is the only place with the R2 listing to resolve a prefix → real key.
 *
 * Both forms go through the shared `createAtlasRefResolver` (the same resolution the Flipbook ship
 * path uses, and the same the region picker used to preview the sheet). A BARE (unscoped) ref
 * carries no atlas and is left as-is. Gated: a doc with only full-`.json` (or bare) refs pays
 * nothing. Non-sprite cells untouched.
 */
export async function canonicalizeSymbolsDocForExport(
	doc: SymbolsDoc,
	clientKey: string,
	projectKey: string,
): Promise<SymbolsDoc> {
	const prefixes = new Set<string>();
	for (const states of Object.values(doc.symbols)) {
		for (const cell of Object.values(states)) {
			if (cell?.type !== 'sprite') continue;
			const split = splitNonManifestScopedRef(cell.assetKey);
			if (split) prefixes.add(split.prefix);
		}
	}
	if (prefixes.size === 0) return doc;

	// Resolve each distinct prefix → its full `.json` manifest key. The shared resolver owns both
	// forms (bare basename via the project's manifest listing + the Sheet-Maker sheet folders;
	// output prefix by listing its own folder) and caches, so a prefix reused across
	// states/symbols costs one lookup — see `manifestBasename.ts`.
	const resolve = createAtlasRefResolver(clientKey, projectKey);
	const resolved = new Map<string, string>();
	for (const prefix of prefixes) {
		const manifest = await resolve(prefix);
		if (manifest !== prefix) resolved.set(prefix, manifest);
	}
	if (resolved.size === 0) return doc;

	const symbols: SymbolsDoc['symbols'] = {};
	for (const [name, states] of Object.entries(doc.symbols)) {
		const nextStates = { ...states } as Record<string, SymbolCell>;
		for (const [state, cell] of Object.entries(nextStates)) {
			if (cell.type !== 'sprite') continue;
			const split = splitNonManifestScopedRef(cell.assetKey);
			const manifest = split && resolved.get(split.prefix);
			if (split && manifest)
				nextStates[state] = { ...cell, assetKey: `${manifest}::${split.region}` };
		}
		symbols[name] = nextStates as SymbolsDoc['symbols'][string];
	}
	return { ...doc, symbols };
}

/**
 * Persist a project's symbols doc to R2 (validates + stamps `updatedAt`), guarded by
 * `baseEtag` — see `r2.precondition` for the convention. Throws `ConflictError` when
 * another author saved first; returns the new ETag.
 */
export async function saveSymbolsDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
	baseEtag?: string | null,
): Promise<{ doc: SymbolsDoc; etag: string | null }> {
	const next = normalizeSymbolsDoc(doc);
	const stamped = { ...next, updatedAt: new Date().toISOString() };
	const etag = await putObjectText(
		symbolsDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: stamped, etag };
}
