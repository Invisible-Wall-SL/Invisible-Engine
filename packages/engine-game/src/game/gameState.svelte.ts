import _ from 'lodash';
import type { Tween } from 'svelte/motion';

import { stateBet } from 'state-shared';
import { createEnhanceBoard, createReelForSpinning } from 'utils-slots';
import { createGetWinLevelDataByWinLevelAlias } from 'utils-shared/winLevel';
import { resolveReelGridFromNode, resolveReelSpinProfile, type ReelGridNode } from 'engine-layout';

import type { RawSymbol, SymbolState, SymbolName } from './types';
import { winLevelMap } from './winLevelMap';
import {
	SYMBOL_SIZE,
	REEL_PADDING,
	SPIN_OPTIONS_DEFAULT,
	SPIN_OPTIONS_FAST,
	INITIAL_SYMBOL_STATE,
} from './constants';

/**
 * Everything the board/reel state needs that belongs to a PARTICULAR game rather than to the
 * engine. Phase A4 of `docs/design/game-type-templates.md`.
 *
 * The state machinery itself — the board lattice, reel spin profiles, anticipation flags, the
 * stacked-picture runs, the win-dim set — is the same for any reel game, and is what a `ways` or
 * `cluster` build would otherwise fork. What is NOT the same is where the grid comes from (the
 * app's authored config), what a landing symbol sounds like (this game's scatter and wild), and
 * which layout it measures against. Those arrive here as `deps`.
 */
export interface GameStateDeps<TGameType extends string> {
	/** The game type the board starts in (`'basegame'`). Kept generic so the app's own union
	 *  survives — widening it to `string` would erase real checking at every comparison site. */
	initialGameType: TGameType;
	/** Board grid from the active Invisible Game Config (`gameConfig.ts` in the app). */
	initialBoard: () => RawSymbol[][];
	boardDimensions: () => { x: number; y: number };
	boardSizes: () => { width: number; height: number };
	/** `stateLayoutDerived` — the app owns it because it carries that game's ratios/main sizes. */
	layout: {
		layoutType: () => string;
		mainLayout: () => { width: number; height: number };
	};
	eventEmitter: { broadcast: (event: never) => void };
	/** Authored stacked-picture config (`bakedStackedConfig()`), or a falsy value to use the
	 *  fallback below. */
	stackedConfig: () => {
		symbols?: { name: string; height?: number; art?: StackedArt }[];
		fullHeightOnly?: boolean;
		edgeCutoffs?: boolean;
	} | null;
	/** The coded fallback when nothing is authored (`STACKED_PICTURE` in the app). */
	stackedFallback: { symbols: string[]; heights: Record<string, number> };
	/** GAME CONTENT: what this game plays when a symbol lands (its scatter counter + wild cue).
	 *  Supplied by the app, re-exposed on `stateGameDerived` so existing callers are unchanged. */
	onSymbolLand: (args: { rawSymbol: RawSymbol }) => void;
}

/** The tall picture art for a stacked symbol (from the authored config). Mirrors a `SymbolCellInfo`
 *  binding; absent (coded fallback) ⇒ `StackedPicture` falls back to the symbol's `stacked` state. */
export type StackedArt = {
	type: 'sprite' | 'spine' | 'flipbook';
	assetKey: string;
	animationName?: string;
	clipId?: string;
};

export function createGameState<TGameType extends string>(deps: GameStateDeps<TGameType>) {
	/**
	 * Editor doc's `reelGrid` node (LAYOUT ONLY) bridged in by `Game.svelte` once the
	 * doc loads. `null` → the board keeps its coded constants (byte-identical parity).
	 * Stored raw so `boardLayout()`/`boardGeometry()` re-resolve per-layoutType reactively.
	 * Defined above `board` because the reel pitch reads `boardGeometry()` lazily.
	 */
	const boardOverride = $state<{ node: ReelGridNode | null }>({ node: null });

	const setBoardOverride = (node: ReelGridNode | null) => {
		boardOverride.node = node;
	};

	/**
	 * Board LATTICE derived from the override, in board-LOCAL space (before the
	 * container `scale`). `columnExtraLocal` = extra x added per reel index for
	 * non-square cell width + horizontal gap; `rowPitchLocal` = the reel's symbol
	 * pitch (drives `createReelForSpinning`'s reactive `symbolHeight`).
	 * `cellWidthLocal`/`cellHeightLocal` = the contain-fit box a symbol's ART draws
	 * into (the mask window's per-cell size in board-local space) — the ONE source of
	 * truth shared by the reel mask and the symbol sprites/spines, so art can never
	 * overflow the mask when a non-square/small cell is authored; plus the reel/row
	 * LEAD, per-cell SEAT ALIGNMENT and board NUDGE consumed by
	 * `getSymbolX`/`getSymbolLead`/`boardLayout`. No node ⇒
	 * `{0, SYMBOL_SIZE, SYMBOL_SIZE, SYMBOL_SIZE}`, coded lead (0.53 X / 0.5 Y),
	 * centred seats, no nudge = today's flush square lattice (byte-identical parity).
	 * The container `scale` is `cellSize / SYMBOL_SIZE` (see `boardLayout`), so dividing
	 * each authored cell edge by that scale yields the local box that renders AT the
	 * authored on-screen cell size; a UNIFORM cell (`cellWidth == cellHeight == cellSize`,
	 * no gap) collapses both edges to exactly `SYMBOL_SIZE`, so uniform-scaled boards
	 * draw art at 120px unchanged.
	 */
	const boardGeometry = () => {
		const override = resolveReelGridFromNode(
			boardOverride.node ?? undefined,
			deps.layout.layoutType(),
		);
		if (!override)
			return {
				columnExtraLocal: 0,
				rowPitchLocal: SYMBOL_SIZE,
				cellWidthLocal: SYMBOL_SIZE,
				cellHeightLocal: SYMBOL_SIZE,
				// No doc ⇒ the coded lead (0.53 X / 0.5 Y), centred seats, no nudge ⇒
				// getSymbolX / symbolY / boardLayout are byte-identical to before.
				reelLead: REEL_PADDING,
				rowLead: 0.5,
				symbolAlignX: 0.5,
				symbolAlignY: 0.5,
				boardNudgeX: 0,
				boardNudgeY: 0,
			};
		const scale = override.cellSize / SYMBOL_SIZE;
		const columnExtraLocal = (override.cellWidth - override.cellSize + override.gapX) / scale;
		const rowPitchLocal = (override.cellHeight + override.gapY) / scale;
		const cellWidthLocal = override.cellWidth / scale;
		const cellHeightLocal = override.cellHeight / scale;
		return {
			columnExtraLocal,
			rowPitchLocal,
			cellWidthLocal,
			cellHeightLocal,
			reelLead: override.reelPadding,
			rowLead: override.rowPadding,
			symbolAlignX: override.symbolAlignX,
			symbolAlignY: override.symbolAlignY,
			boardNudgeX: override.boardNudgeX,
			boardNudgeY: override.boardNudgeY,
		};
	};

	/**
	 * Reactive symbol-centre X in board-local space. Three independent contributions:
	 * the reel LEAD (`reelLead` — seats the whole cluster), the non-square width + gap
	 * pitch (`columnExtraLocal`), and the per-cell art SEAT ALIGNMENT (`symbolAlignX` —
	 * offsets the art inside its own cell). Defaults (0.53 lead / 0.5 align) reproduce
	 * the coded `SYMBOL_SIZE * (reelIndex + REEL_PADDING)`.
	 */
	const getSymbolX = (reelIndex: number) => {
		const geometry = boardGeometry();
		return (
			SYMBOL_SIZE * (reelIndex + geometry.reelLead) +
			reelIndex * geometry.columnExtraLocal +
			(geometry.symbolAlignX - 0.5) * geometry.cellWidthLocal
		);
	};

	/**
	 * Reactive symbol resting SEAT Y in board-local space — the Y analogue of {@link getSymbolX}, and
	 * the seat a symbol occupies when the reel is at rest.
	 *
	 * It is `rowPitchLocal * (rowIndex + getSymbolLead())`, which is exactly the resting position
	 * `createReelForSpinning` computes for a spinning reel (it is handed the same two getters), so a
	 * symbol placed through here lands on the identical seat as one that arrived by spinning. That
	 * matters for any overlay that positions symbols itself — a tumble/cascade board, which slides
	 * symbols DOWN into the seats a settled reel would have used. Reading the geometry rather than
	 * assuming `SYMBOL_SIZE` is what makes it correct on a stepped or resized grid.
	 *
	 * `rowIndex` may be negative or past the visible rows: the padding row above the board is -1, and
	 * symbols queued to fall in sit further above still.
	 */
	const getSymbolY = (rowIndex: number) =>
		boardGeometry().rowPitchLocal * (rowIndex + getSymbolLead());

	/**
	 * Reactive symbol resting SEAT (pitch fractions) fed to `createReelForSpinning`.
	 * Folds the row LEAD (`rowLead` — seats the cluster) with the per-cell art SEAT
	 * ALIGNMENT (`symbolAlignY`, expressed as a fraction of the pitch). Defaults
	 * (0.5 lead / 0.5 align) collapse to `0.5` = today's centred seat (byte-parity).
	 */
	const getSymbolLead = () => {
		const geometry = boardGeometry();
		// Both contributions are converted to the util's pitch-fraction seat so they read
		// in the SAME units the X axis + editor use: the row LEAD in cell-SIZE units
		// (`SYMBOL_SIZE` is one cell in board-local space), the SEAT ALIGNMENT in
		// cell-HEIGHT units. Defaults (0.5 / 0.5) collapse to 0.5 = today's centred seat.
		return (
			0.5 +
			((geometry.rowLead - 0.5) * SYMBOL_SIZE) / geometry.rowPitchLocal +
			((geometry.symbolAlignY - 0.5) * geometry.cellHeightLocal) / geometry.rowPitchLocal
		);
	};

	/**
	 * Build one spinning reel per column, sized + seeded from the ACTIVE game config (Invisible Game
	 * Config). A FACTORY, not a module-scope const, so it can be re-run after the live runtime bundle
	 * lands — see {@link rebuildBoard}: the online config resolves asynchronously AFTER this module
	 * evaluates, so a board built once at import would freeze to the compiled template's grid.
	 */
	const buildBoard = () => {
		const init = deps.initialBoard();
		return _.range(deps.boardDimensions().x).map((reelIndex) => {
			const reel = createReelForSpinning({
				reelIndex,
				symbolHeight: () => boardGeometry().rowPitchLocal,
				symbolLead: () => getSymbolLead(),
				initialSymbols: init[reelIndex],
				initialSymbolState: INITIAL_SYMBOL_STATE,
				onReelStopping: () => {
					deps.eventEmitter.broadcast({
						type: 'soundOnce',
						name: 'sfx_reel_stop_1',
						forcePlay: !stateBet.isTurbo,
					});
				},
				onSymbolLand: deps.onSymbolLand,
			});

			reel.reelState.spinOptions = () => {
				const isFast = reel.reelState.spinType === 'fast';
				const base = isFast ? SPIN_OPTIONS_FAST : SPIN_OPTIONS_DEFAULT;
				// Editor spin-FEEL override (reactive): merge the authored profile over the
				// coded options. No node / no spin ⇒ undefined ⇒ coded constants (parity).
				const override = resolveReelSpinProfile(
					boardOverride.node ?? undefined,
					isFast ? 'fast' : 'normal',
				);
				const merged = override ? { ...base, ...override } : base;
				// Flow-authored PER-REEL sequential-stop knobs (from the `enableSequentialReelStop` effect
				// payload) win for this reel's two sequential fields. The getter closes over `reelIndex`, so
				// each reel reads its own array entry; a missing/undefined entry ⇒ fall back to the coded
				// constant, so an un-authored spin is byte-identical to the constants.
				const gapForReel = stateGame.sequentialGapOverrides?.[reelIndex];
				const speedForReel = stateGame.sequentialSpeedOverrides?.[reelIndex];
				if (gapForReel == null && speedForReel == null) return merged;
				return {
					...merged,
					...(gapForReel != null && { reelPaddingMultiplierSequential: gapForReel }),
					...(speedForReel != null && { reelSpinSpeedSequential: speedForReel }),
				};
			};

			return reel;
		});
	};

	type MultiplierSymbol = {
		initX: number;
		initY: number;
		symbolX: Tween<number>;
		symbolY: Tween<number>;
		rawSymbol: RawSymbol;
		symbolState: SymbolState;
		oncomplete: () => void;
	};

	const stateGame = $state({
		board: buildBoard(),
		gameType: deps.initialGameType,
		multiplierBoard: [] as (MultiplierSymbol | undefined)[][],
		scatterCounter: 0,
		specialSymbol: null as SymbolName | null,
		// The symbol that actually EXPANDED on the CURRENT spin (`expandBookColumns`), or null. Distinct
		// from `specialSymbol`, which is the round's chosen symbol and stays set for the whole feature:
		// most free spins never reach 3+ and pay ordinary line wins, so only the spins where the columns
		// really morphed may say "on N reels" (Invisible Win Text's `toast.expanded`). Set by the
		// expansion, cleared by the next `reveal` and at feature end — both the coded handlers and the
		// flow-v2 effects, since either may be driving.
		expandedSymbol: null as SymbolName | null,
		sequentialReelStop: false,
		// Optional Flow-authored PER-REEL overrides for the sequential-stop knobs, indexed by reelIndex
		// (null, or a missing/short entry ⇒ that reel uses the coded SPIN_OPTIONS constant). Set from
		// `enableSequentialReelStop`'s `gaps`/`speeds` payload, cleared on disable.
		sequentialGapOverrides: null as number[] | null,
		sequentialSpeedOverrides: null as number[] | null,
		// Client-computed reel ANTICIPATION mode (docs/design/reel-anticipation.md). OFF by default ⇒ the
		// spin is byte-identical (no reel HOLDS, nothing armed) until a Flow effect turns it on (Phase 4).
		// `anticipationConfidence` picks the reachable-win bound: `possible` (max — suspenseful, teases
		// near-misses) vs `guaranteed` (min — honest, only once the big win is locked in). `minAnticipateReel`
		// suppresses the trivial early arming (a run/count below 3 can't reach a big win or feature trigger).
		anticipationMode: false,
		anticipationConfidence: 'possible' as 'possible' | 'guaranteed',
		minAnticipateReel: 2,
		// Presentation toggles for the anticipation mode (both default ON ⇒ Phase 3 behaviour unchanged),
		// set from the `enableAnticipationMode` Flow effect payload. `anticipationGreyOut` gates the dim of
		// the non-anticipating reels (`Anticipations.svelte`); `anticipationZoom` gates the board zoom-in
		// camera (`Game.svelte` wraps the reel stack in `AnticipationCamera` only when it is on).
		anticipationGreyOut: true,
		anticipationZoom: true,
		// The REUSABLE win colour: the authored colour (`#rrggbb`, Invisible Game Config) of the payline
		// whose win is CURRENTLY on screen, published by `WinLine.svelte` on `winLineShow` and cleared on
		// `winLineHide`. `null` when no coloured win is showing (an un-coloured line, or no win). Any asset
		// component can read it reactively to tint itself to the winning line — the "colour-correct assets
		// to the payline win" hook. A plain reactive field, not an event, so a late-mounting component
		// still sees the colour of a win already in progress.
		winLineColor: null as string | null,
		// Win-celebration DIM (Invisible Symbols State Machine → `winCycle.dimNonWinning`). When the switch
		// is on, every symbol that is NOT part of a paying line is drawn darkened from the win celebration
		// until the next spin, so the winning line stands out. `active` gates it; `cells` marks the paying
		// cells by `reel:row` key. Both are driven from `winSymbolCycle.recordWinCycleWins` (a `winInfo`
		// refreshes the lit set, a `reveal` — the next spin — clears it) and read by `ReelSymbol` to tint
		// the losing symbols. Reassigned wholesale (see {@link setWinDim}) so the $state proxy re-renders.
		// Off ⇒ `active` never becomes true ⇒ every symbol stays full-bright (byte-parity).
		winDim: { active: false, cells: {} as Record<string, boolean> },
		// Stacked-picture reel mode (docs/design/stacked-picture-mode.md). OFF by default ⇒ the board is
		// byte-identical (empty coverage, no overlay) until the `enableStackedPictures` Flow effect turns it
		// on. The MODE is the only runtime toggle now — WHICH symbols stack, how tall each picture is, and
		// the picture art all come from the authored config (`deps.stackedConfig()`), with `deps.stackedFallback`
		// as the coded fallback. A stacked symbol ALWAYS shows its picture (even a lone one → top 1/height).
		stackedPictureMode: false,
	});

	/** Key a board cell for the win-dim membership set (`reel:row`). Shared by the writer
	 *  (`winSymbolCycle`) and the reader (`ReelSymbol`) so the two can never drift on the format. */
	const winDimCellKey = (reel: number, row: number): string => `${reel}:${row}`;

	/** Publish the win-celebration dim state (see `stateGame.winDim`). Reassigns the whole object so
	 *  every reading symbol re-renders — a mutated-in-place `cells` map would not. */
	const setWinDim = (active: boolean, cells: Record<string, boolean>): void => {
		stateGame.winDim = { active, cells };
	};

	/**
	 * One tall picture to draw for the stacked-picture mode (docs/design/stacked-picture-mode.md): a
	 * contiguous run of the same eligible symbol on a settled reel. `visibleCells` (N) is the run length;
	 * `naturalCells` (M) the symbol's authored picture height (the crop denominator, ≥ N). The picture is
	 * top-anchored at `topEdgeY` in board-LOCAL space and cropped to the top N/M. All geometry is derived
	 * from the reel cell metrics, so it scales to any grid.
	 */
	/** The tall picture art for a stacked symbol (from the authored config). Mirrors a `SymbolCellInfo`
	 *  binding; absent (coded fallback) ⇒ `StackedPicture` falls back to the symbol's `stacked` state. */
	type StackedArt = {
		type: 'sprite' | 'spine' | 'flipbook';
		assetKey: string;
		animationName?: string;
		clipId?: string;
	};

	type StackedPictureRun = {
		reel: number;
		name: string;
		topRow: number;
		visibleCells: number;
		naturalCells: number;
		x: number;
		topEdgeY: number;
		/** Picture cells hidden ABOVE the visible run — the vertical crop offset. `0` ⇒ top-aligned (reveal
		 *  the top N/M), used by every full stack, a bottom-edge partial, and an interior partial. A partial
		 *  run pinned to the board's TOP edge sets this to `naturalCells - visibleCells` so the picture's
		 *  BOTTOM N/M fills the run and its top continues off-screen above — the tall symbol reads as clipped
		 *  by the reel window, not as a shorter picture. See docs/design/stacked-picture-mode.md. */
		hiddenAbove: number;
		/** The authored tall art (undefined ⇒ fall back to the `stacked` state binding). */
		art?: StackedArt;
	};

	/**
	 * The RESOLVED stacked config: which symbols stack + per-symbol height + tall art. Prefers the authored
	 * `deps.stackedConfig()` (Invisible Symbols State Machine); falls back to the coded `deps.stackedFallback`
	 * (dev / un-authored) — the coded fallback has no baked art, so `artOf` returns undefined there and the
	 * picture renders via the symbol's `stacked` state binding.
	 */
	type ResolvedStacked = {
		symbols: Set<string>;
		heightOf: (name: string) => number | undefined;
		artOf: (name: string) => StackedArt | undefined;
		/** When true, a landed run shorter than the symbol's height shows the normal icons, not a cropped
		 *  tall picture (authored global toggle). Default false ⇒ partial runs crop the picture. */
		fullHeightOnly: boolean;
		/** When true, a partial run pinned to the board's TOP or BOTTOM edge renders as a CUT-OFF tall
		 *  picture (the visible slice of a symbol scrolled partly off-screen) REGARDLESS of `fullHeightOnly`
		 *  — any run length, even 1. Independent authored toggle. Default false ⇒ edge partials follow
		 *  `fullHeightOnly` like any other partial (byte-parity). See {@link docs/design/stacked-picture-mode.md}. */
		edgeCutoffs: boolean;
	};
	const resolvedStacked = (): ResolvedStacked => {
		const baked = deps.stackedConfig();
		if (baked?.symbols?.length) {
			// Plain Map/Set on purpose: rebuilt from scratch on every call and never mutated
			// afterwards, so there is nothing for SvelteMap/SvelteSet to track — they would add a
			// reactive proxy for no reader. The rule fires because this file carries runes.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const byName = new Map(baked.symbols.map((s) => [s.name, s]));
			return {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				symbols: new Set(byName.keys()),
				heightOf: (name) => byName.get(name)?.height,
				artOf: (name) => byName.get(name)?.art,
				fullHeightOnly: baked.fullHeightOnly === true,
				edgeCutoffs: baked.edgeCutoffs === true,
			};
		}
		return {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			symbols: new Set(deps.stackedFallback.symbols),
			heightOf: (name) => deps.stackedFallback.heights[name],
			artOf: () => undefined,
			fullHeightOnly: false,
			edgeCutoffs: false,
		};
	};

	/**
	 * When the stacked-picture mode is on, seed a reel's SCROLL strip with natural-height BLOCKS of the
	 * stacked symbols, so tall pictures ROLL through the reel during the whole spin (not only on landing).
	 * Each stacked-symbol occurrence becomes `height` copies; everything else is untouched. OFF ⇒ the strip
	 * is returned unchanged (byte-parity). Purely cosmetic — this is only the scroll filler (`paddingBoard`);
	 * the RESULT board (`revealEvent.board`) is separate, so a partial result still crops on landing.
	 */
	const stackedScrollStrip = (strips: RawSymbol[][]): RawSymbol[][] => {
		if (!stateGame.stackedPictureMode) return strips;
		const { symbols, heightOf } = resolvedStacked();
		return strips.map((strip) =>
			strip.flatMap((symbol) => {
				const name = symbol.name;
				const height = heightOf(name);
				if (!symbols.has(name) || !height || height < 2) return [symbol];
				return Array.from({ length: height }, () => ({ ...symbol }));
			}),
		);
	};

	/** Scan every SETTLED reel for contiguous runs of an eligible symbol (length ≥ minRun) and turn each
	 *  into a `StackedPictureRun`. Empty when the mode is off (byte-parity). Reads live $state, so callers
	 *  read it reactively. */
	const computeStackedRuns = (): StackedPictureRun[] => {
		if (!stateGame.stackedPictureMode) return [];
		const rows = deps.boardDimensions().y;
		const { symbols: stackedSet, heightOf, artOf, fullHeightOnly, edgeCutoffs } = resolvedStacked();
		const { rowPitchLocal } = boardGeometry();
		const runs: StackedPictureRun[] = [];
		stateGame.board.forEach((reel, reelIndex) => {
			const symbols = reel.reelState.symbols;
			// Two scan windows, both positioned off the LIVE `symbolY()` so the pictures move with the reel:
			//  • ROLLING (a long scrolling array: target+padding+prev) — scan the WHOLE strip so every
			//    contiguous block of a high symbol renders as a tall picture that SCROLLS through the reel
			//    (the board-window mask clips it). The scroll strip is seeded with natural-height blocks
			//    (`stackedScrollStrip`), so the tall symbols are there to roll.
			//  • SETTLED (the compact result set, length rows+2) — scan only the visible window (symbolIndex
			//    1..rows) so a partial stack CROPS to the top N/M (a padding row must not extend the run).
			const scrolling = symbols.length > rows + 2;
			const first = scrolling ? 0 : 1;
			const last = scrolling ? symbols.length - 1 : rows;
			const cap = scrolling ? symbols.length - 1 : rows;
			// The scrolling array is `[target(rows+2), filler…, prev(rows+2)]` — the RESULT chunks (target +
			// previous result) carry their own top/bottom PADDING rows. Those pads must never join a run, so a
			// result groups the SAME while rolling as when settled (window 1..rows). Otherwise a padding row
			// that happens to match the landed stack's symbol gets grouped in while rolling but not once
			// settled, and the picture SNAPS a tile at the roll↔settle boundary. The filler blocks have no
			// pads; the settled scan already excludes them via `first`/`last`, so this only guards scrolling.
			const reelLen = rows + 2;
			const isPad = (i: number): boolean =>
				scrolling &&
				(i === 0 || i === rows + 1 || i === symbols.length - reelLen || i === symbols.length - 1);
			// A run STARTING inside a RESULT chunk — the leading target block `[0, reelLen)` or the trailing
			// previous-result block `[len-reelLen, len)` — is the actual landed board, not scroll filler. Group
			// it with the SETTLED rules (honour `fullHeightOnly` + edge detection) even while the array is scrolling,
			// so the verdict for the visible result cells is identical on both sides of the settle↔roll
			// boundary. Otherwise, the instant `preSpinPadding` doubles the array (settled result parked
			// in-window, `scrolling` now true), the rolling rules re-judge that still-stationary result — a
			// partial stack flips icons↔picture (`fullHeightOnly`), a run longer than `height` splits — and the
			// grid SNAPS with no reel motion. The pad guards keep a run from crossing a chunk edge, so the
			// start index alone classifies the whole run. When not scrolling the whole compact array IS result.
			const inResultChunk = (i: number): boolean =>
				!scrolling || i < reelLen || i >= symbols.length - reelLen;
			let idx = first;
			while (idx <= last) {
				if (isPad(idx)) {
					idx += 1;
					continue;
				}
				const name = symbols[idx]?.rawSymbol.name;
				if (name == null || !stackedSet.has(name)) {
					idx += 1;
					continue;
				}
				// Cap EVERY run at the symbol's authored height, so a picture is never taller than the height the
				// Symbols tool set. A FILLER block renders as one M-tall picture (adjacent/duplicate blocks don't
				// merge into a giant one); a RESULT run LONGER than M splits into consecutive M-tall pictures —
				// any remainder shorter than M becomes a partial (cropped to top k/M, or suppressed by
				// `fullHeightOnly`) via the same path below. Capping never affects a genuine partial (run already
				// < M). Before this cap a landed run of 3+ stretched into ONE oversized picture, so the same
				// symbol rendered at different sizes depending on how many landed — the authored height was
				// ignored for over-height runs.
				const height = heightOf(name);
				const settledRun = inResultChunk(idx);
				const maxRun = height ?? Infinity;
				let end = idx;
				while (
					end + 1 <= cap &&
					!isPad(end + 1) &&
					symbols[end + 1]?.rawSymbol.name === name &&
					end - idx + 1 < maxRun
				)
					end += 1;
				const visibleCells = end - idx + 1;
				const isPartial = height !== undefined && visibleCells < height;
				// Chunk-relative EDGE detection: each RESULT chunk's visible window is `[chunkStart+1,
				// chunkStart+rows]`, so the verdict is identical while the result is parked mid-scroll and once
				// settled (no roll↔settle snap). Filler blocks (not a result chunk) never count as edge-clipped.
				const chunkStart = !scrolling ? 0 : idx < reelLen ? 0 : symbols.length - reelLen;
				const touchesTop = settledRun && idx === chunkStart + 1;
				const touchesBottom = settledRun && end === chunkStart + rows;
				// `edgeCutoffs` (authored, independent of `fullHeightOnly`): a partial run pinned to a board
				// edge reads as a tall symbol the reel window clipped — the visible slice of a picture that
				// continues off-screen — so it renders a CUT-OFF picture (any run length, even N=1) and
				// BYPASSES `fullHeightOnly`. Only meaningful for a settled result partial at an edge.
				const edgeCutoff = edgeCutoffs && isPartial && (touchesTop || touchesBottom);
				// `fullHeightOnly` (authored): a RESULT run shorter than the picture's height renders no tall
				// picture — skip it so those cells fall out of `stackedCoverage` and show their normal single
				// icons. An `edgeCutoff` is the authored exception (it shows the cut-off picture instead).
				// Applies to result chunks only — filler blocks are always full-height (seeded), so they keep
				// rolling. Default (both flags off) ⇒ every run draws cropped to top N/M, byte-identical.
				if (fullHeightOnly && settledRun && isPartial && !edgeCutoff) {
					idx = end + 1;
					continue;
				}
				// A stacked symbol ALWAYS shows its picture — even a lone one (N=1) shows the top 1/height, and
				// never its single icon. So every run of a stacked symbol draws (min run = 1).
				const naturalCells = Math.max(visibleCells, height ?? visibleCells);
				// Bottom-align a TOP-edge cut-off so the picture's BOTTOM N/M fills the run (the top M−N cells
				// run off-screen above, "as if the reel spun a few more cells"); a BOTTOM-edge cut-off keeps the
				// top N/M (its bottom runs off-screen below). Only when `edgeCutoffs` is on — otherwise every
				// run top-aligns (`hiddenAbove = 0`), byte-identical to before the toggle existed.
				let hiddenAbove = 0;
				if (edgeCutoff && touchesTop && !touchesBottom) hiddenAbove = naturalCells - visibleCells;
				runs.push({
					reel: reelIndex,
					name,
					topRow: idx,
					visibleCells,
					naturalCells,
					hiddenAbove,
					x: getSymbolX(reelIndex),
					topEdgeY: symbols[idx].symbolY() - rowPitchLocal / 2,
					art: artOf(name),
				});
				idx = end + 1;
			}
		});
		return runs;
	};

	const stackedRuns = $derived.by(computeStackedRuns);

	/** The stacked pictures to draw this frame (see {@link StackedPictureRun}). */
	const stackedPictureRuns = (): StackedPictureRun[] => stackedRuns;

	const stackedCoverageSet = $derived.by(() => {
		// Local accumulator returned AS the derived value — not mutated after the fact.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const covered = new Set<string>();
		for (const run of stackedRuns)
			for (let row = run.topRow; row < run.topRow + run.visibleCells; row += 1)
				covered.add(winDimCellKey(run.reel, row));
		return covered;
	});

	/** `reel:row` keys hidden because a stacked picture covers them — read by `ReelSymbol` to skip the
	 *  single-cell art under a run (no doubling). Empty when the mode is off (byte-parity). */
	const stackedCoverage = (): Set<string> => stackedCoverageSet;

	/**
	 * Rebuild the board from the CURRENT active config, replacing `stateGame.board`. Called once from
	 * `Game.svelte` right after the live runtime bundle is applied (beside `resetGameConfigCache()`),
	 * so an online project whose config resolved asynchronously gets its authored grid — without this
	 * the board stays the compiled template's size, the same freeze `resetGameConfigCache` fixes for
	 * the symbol map. A no-op in effect for baked/dev (the board was already built with the right
	 * config at import), preserving parity. Safe to call at boot: no spin has run, so no reel holds
	 * in-flight animation state.
	 */
	function rebuildBoard(): void {
		// Rebuild the reels IN PLACE, preserving the array's identity — do NOT reassign `stateGame.board`
		// to a fresh array. `enhancedBoard` (createEnhanceBoard, below) closes over THIS exact array at
		// module init and drives every preSpin/spin/settle/stop by iterating it — it never re-reads
		// `stateGame.board`. A reassignment would leave the rendered board (which reads `stateGame.board`
		// live) resized to the new array while the reels that actually roll stay the old, orphaned ones —
		// so an online project's board would settle its result yet never spin. Splicing the contents keeps
		// both the render and `enhancedBoard` on the same reels.
		stateGame.board.splice(0, stateGame.board.length, ...buildBoard());
	}

	const boardLayout = () => {
		const centreX = deps.layout.mainLayout().width * 0.5;
		const centreY = deps.layout.mainLayout().height * 0.5;
		const sizes = deps.boardSizes();
		const dims = deps.boardDimensions();
		const override = resolveReelGridFromNode(
			boardOverride.node ?? undefined,
			deps.layout.layoutType(),
		);

		if (!override) {
			return {
				x: centreX,
				y: centreY,
				scale: 1,
				anchor: { x: 0.5, y: 0.5 },
				pivot: { x: sizes.width / 2, y: sizes.height / 2 },
				...sizes,
			};
		}

		const scale = override.cellSize / SYMBOL_SIZE;
		// Board POSITION = the node position + the explicit board NUDGE (fine px offset,
		// in layout units). The reel/row LEAD no longer moves the board here — it seats
		// the symbol cluster inside a fixed pivot (via getSymbolX / getSymbolLead), so
		// padding and board position are fully decoupled. Nudge default 0 ⇒ no shift.

		// The flush pivot (BOARD_SIZES/2) is the gap-LESS board centre. `getSymbolX`
		// grows the gap cumulatively rightward and the reel pitch grows it downward,
		// so without this the symbol cluster drifts off the container origin (lopsided,
		// disagreeing with the editor's symmetric footprint). Recentre the pivot on the
		// gap-extended cluster: the X cluster-centre shift is the mean reel-index extra
		// `(reels-1)/2 · columnExtraLocal`; the Y shift is the mean visible-row pitch
		// excess `(rows/2) · (rowPitchLocal − SYMBOL_SIZE)` — note the Y factor is rows/2,
		// not (rows−1)/2, because the visible rows are symbolIndex 1..rows with a −0.5
		// pitch lead, so their mean centre lands at (rows/2)·pitch (see boardGeometry()
		// + createReelForSpinning's `symbolY`). No override ⇒ both extras are 0 ⇒ pivot
		// is byte-identical to the flush case.
		const { columnExtraLocal, rowPitchLocal } = boardGeometry();
		const pivotX = sizes.width / 2 + ((dims.x - 1) / 2) * columnExtraLocal;
		const pivotY = sizes.height / 2 + (dims.y / 2) * (rowPitchLocal - SYMBOL_SIZE);

		return {
			x: override.x + override.boardNudgeX,
			y: override.y + override.boardNudgeY,
			scale,
			anchor: { x: 0.5, y: 0.5 },
			pivot: { x: pivotX, y: pivotY },
			...sizes,
		};
	};

	const boardRaw = () =>
		stateGame.board.map((reel) => reel.reelState.symbols.map((reelSymbol) => reelSymbol.rawSymbol));

	const scatterLandIndex = () => {
		if (stateGame.scatterCounter > 5) return 5;
		if (stateGame.scatterCounter < 1) return 1;
		return stateGame.scatterCounter as 1 | 2 | 3 | 4 | 5;
	};

	const { enhanceBoard } = createEnhanceBoard();
	const enhancedBoard = enhanceBoard({ board: stateGame.board });

	const { getWinLevelDataByWinLevelAlias } = createGetWinLevelDataByWinLevelAlias({
		winLevelMap,
	});

	const stateGameDerived = {
		onSymbolLand: deps.onSymbolLand,
		boardLayout,
		boardGeometry,
		boardRaw,
		scatterLandIndex,
		enhancedBoard,
		getWinLevelDataByWinLevelAlias,
	};

	return {
		getSymbolX,
		getSymbolY,
		getWinLevelDataByWinLevelAlias,
		rebuildBoard,
		setBoardOverride,
		setWinDim,
		stackedCoverage,
		stackedPictureRuns,
		stackedScrollStrip,
		stateGame,
		stateGameDerived,
		winDimCellKey,
	};
}

/** The whole board/reel API one game instance exposes. */
export type GameStateApi = ReturnType<typeof createGameState>;

/** A single reel. Derived from the factory's own board rather than re-declared, so the type can
 *  never drift from what `buildBoard` actually produces. */
export type Reel = GameStateApi['stateGame']['board'][number];
export type ReelSymbol = Reel['reelState']['symbols'][number];
export type MultiplierSymbol = NonNullable<
	GameStateApi['stateGame']['multiplierBoard'][number][number]
>;
export type StackedPictureRun = ReturnType<GameStateApi['stackedPictureRuns']>[number];
