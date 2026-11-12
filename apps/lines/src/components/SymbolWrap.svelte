<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container } from 'pixi-svelte';
	import { getContextBoard } from 'components-shared';

	import StripSeat from './StripSeat.svelte';
	import { getContext } from '../game/context';
	import { activeGrid } from '../game/gameConfig';
	import { createEntries } from '../game/reelViewPool';
	import { StripCull, type ReelStripView } from '../game/reelStripView.svelte';

	type Props = {
		debug?: boolean;
		x: number;
		/** Where the cell is drawn, when nothing else places it (see `strip`). */
		y?: number;
		/**
		 * A flat board's strip cell: its reel's strip view places the container and answers the cull
		 * and the hold for `stripCell` from the reel's drawn position, so a rolling cell reads nothing
		 * that changes every frame (`reelStripView.svelte.ts`). `y` is then unused.
		 */
		strip?: ReelStripView;
		stripCell?: { symbolIndex: number };
		animating: boolean;
		/** The SEAT's row scale (`getSymbolSeat`). Perspective gives each row its own size; a flat
		 *  board gives every row `1`. Applied to the container the symbol art already sizes itself
		 *  inside, so the art's own contain-fit is untouched and the scale multiplies once. */
		scale?: number;
		/** Which column this cell belongs to. Only read on a STEPPED board, where the cull window is
		 *  per column rather than board-wide — see `bottom` below. */
		reelIndex?: number;
		/** This cell's paint order within its board container, derived from its SEAT rather than from
		 *  when it mounted (`ReelSymbol`'s `zIndex` owns the rule and the band it has to stay inside).
		 *  Absent ⇒ the container keeps Pixi's default `0` and the parent is never flagged
		 *  sort-dirty, which is the pre-existing mount-order behaviour exactly. */
		zIndex?: number;
		/** Is this cell's reel strip rolling? Only `ReelSymbol` knows, and only it passes it; it is
		 *  what lets a rolling symbol be drawn before its centre crosses the window edge. */
		rolling?: boolean;
		/** A reel view (`BoardBase`, `ReelPaddingPool`), handed one cell after another instead of
		 *  being destroyed: once it has drawn, its container and content stay mounted, hidden while
		 *  it draws nothing (`game/reelViewPool.ts`). Absent ⇒ mounted only while drawn, as before. */
		keepMounted?: boolean;
		/** A view with no cell. */
		vacant?: boolean;
		/** The cell a view draws: handed another while drawing is a new entry. */
		cell?: object;
		/** A filler view: its art runs from its cell's entry until it is handed the next one or goes
		 *  vacant, outside the window too, as a filler component's did. */
		drawsOutside?: boolean;
		/** Told whether the symbol is drawn ahead of its time (see `held` below) and, in a view, the
		 *  entry it is drawing (`undefined` while it draws nothing). */
		children: Snippet<[held: boolean, entry: number | undefined]>;
	};

	const props: Props = $props();
	const context = getContext();
	const boardContext = getContextBoard();
	const show = $derived(
		(boardContext.animate && props.animating) || (!boardContext.animate && !props.animating),
	);
	// Frame bound is the SAME quantity BoardMask clips at, so it comes from the same
	// place: `boardWindowHeight()`, the engine's one definition. Flat, that is still
	// rows × the reel's ACTUAL row pitch (the editor reel-grid override's
	// cellHeight+gapY) — a fixed SYMBOL_SIZE bound lets the bottom padding row's
	// symbol leak onto the unmasked animate layer when the override pitch is shorter
	// than SYMBOL_SIZE, the phantom rig "4th row" below the window. Computing it
	// here as well as in the mask is how the two drift apart the first time one of
	// them learns about perspective and the other does not.
	//
	// On a STEPPED board the window is per COLUMN, and that is not a refinement — it is load-bearing.
	// A short column is pushed DOWN into the bounding box, so its padding row (the buffer cell above
	// the visible window) lands at a y that is still inside the board-wide window. Culled against the
	// board it would therefore be drawn: a phantom symbol sitting above a short column on the unmasked
	// animate layer. `boardWindowForReel` is the same accessor `ReelColumn` masks with, so the cull
	// and the clip stay one answer. A uniform board answers `{ top: 0, height: boardWindowHeight() }`
	// by CALLING `boardWindowHeight()`, so this reads exactly as it did before the branch existed.
	const steppedWindow = $derived(
		props.reelIndex !== undefined && activeGrid().stepped
			? context.stateGameDerived.boardWindowForReel(props.reelIndex)
			: undefined,
	);
	const top = $derived(steppedWindow ? steppedWindow.top : 0);
	const bottom = $derived(
		steppedWindow
			? steppedWindow.top + steppedWindow.height
			: context.stateGameDerived.boardWindowHeight(),
	);
	// How far past the window edge a ROLLING symbol's seat may sit and still be drawn: half a row,
	// on the masked layer. It mounts the moment its cell first touches the window and the mask clips
	// the part still outside, so the strip slides under the edge instead of popping in once a
	// symbol's centre crosses it (the gap the reels used to show at the top and bottom mid-spin).
	// While any reel rolls the mask is the tight window (`boardOverflow()` is `{ 0, 0 }`), so nothing
	// outside it can show.
	//
	// Zero — the centre test — everywhere else: on the UNMASKED animating layer, where nothing would
	// clip the outside part, and at rest, so a resting board draws exactly the cells it always did
	// (the current-games harness showed a half-row margin at rest changing settled boards).
	const margin = $derived(
		props.rolling && !boardContext.animate
			? (context.stateGameDerived.boardGeometry().rowPitchLocal * (props.scale ?? 1)) / 2
			: 0,
	);
	const y = $derived(props.y ?? 0);
	/**
	 * A strip cell's cull, answered by its reel's strip view for this cell alone and written only
	 * when it changes, so a cell crossing an edge re-checks nothing in the cells that did not.
	 */
	const stripCull = new StripCull();
	$effect.pre(() => {
		const strip = props.strip;
		const cell = props.vacant ? undefined : props.stripCell;
		if (!strip || !cell) return;
		void cell.symbolIndex;
		return strip.watch(cell, stripCull);
	});
	const inFrame = $derived(
		!props.vacant &&
			(props.strip && props.stripCell
				? stripCull.inFrame
				: margin === 0
					? y >= top && y <= bottom
					: y + margin > top && y - margin < bottom),
	);
	/**
	 * Drawn early: in the half-row band above the window, its centre not yet inside. The art is held
	 * there — the rig or flipbook on its first frame, its state's Element FX not yet made — and starts
	 * on the frame the centre crosses, which is when the cell used to mount. Both clocks start at
	 * mount, and an FX filter draws its seed from `Math.random` when it is made, so without the hold a
	 * symbol drawn early comes to rest further into its loops and every cosmetic draw after it shifts.
	 * Only on the way in: on the way out the cell used to unmount, so nothing there runs early.
	 */
	const held = $derived(
		!props.vacant && (props.strip && props.stripCell ? stripCull.held : margin > 0 && y < top),
	);
	// A flat seat passes `undefined`, NOT 1, because `1` is not a no-op in Pixi v8: assigning
	// `container.scale` swaps the shared `defaultScale` singleton for an owned `ObservablePoint` and
	// dirties the transform. `pixi-svelte`'s `propsSyncEffect` skips undefined props, so an unscaled
	// symbol's container is left exactly as it was before this prop existed (byte-parity).
	const scale = $derived(props.scale === 1 ? undefined : props.scale);
	/** The cell's art runs: the layer draws it and it is in the window (a filler view: anywhere). */
	const drawn = $derived(
		!props.vacant && (!!props.debug || (show && (inFrame || !!props.drawsOutside))),
	);
	let drewOnce = false;
	const mounted = $derived(props.keepMounted ? (drewOnce ||= drawn) : drawn);
	const entries = createEntries();
	const entry = $derived(props.keepMounted ? entries(drawn, props.cell) : undefined);
	/**
	 * A view's container is shown only while it draws in the window, and only then placed: Pixi
	 * updates a hidden container's transform and every renderable under it when its `y` moves, and
	 * attaching places it at once on the frame it is shown.
	 */
	const visible = $derived(props.keepMounted ? drawn && (!!props.debug || inFrame) : undefined);
</script>

{#if mounted}
	<!-- NO tint here. The win-celebration dim used to be one `tint` on this container, cascading to
	     everything inside; it now rides each drawn piece inside `Symbol.svelte` instead, because
	     Pixi's cascade only ever multiplies and a layer that opts out of the dim therefore has to be
	     outside every tinted node. Same factor, applied one level lower — the leaf colours are
	     identical either way. -->
	<Container
		x={props.x}
		y={props.strip ? undefined : props.y}
		{scale}
		zIndex={props.zIndex}
		{visible}
	>
		{#if props.strip && (props.stripCell || props.keepMounted)}
			<StripSeat strip={props.strip} cell={visible === false ? undefined : props.stripCell} />
		{/if}
		{@render props.children(held, entry)}
	</Container>
{/if}
