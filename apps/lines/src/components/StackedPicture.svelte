<script lang="ts">
	import { Container, Sprite, Flipbook, RigProvider, RigTrack, Rectangle } from 'pixi-svelte';
	import { EDITOR_RIG_LOAD_SCALE, resolveFlipbook } from 'engine-layout';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';
	import { stackedGrowthFor } from '../game/wildRewrite.svelte';
	import type { StackedPictureRun } from '../game/stateGame.svelte';

	/**
	 * One tall stacked picture for the stacked-picture reel mode (docs/design/stacked-picture-mode.md).
	 * Draws the AUTHORED tall art (`run.art` — the Symbols-State-Machine stacked config, sprite / rig /
	 * flipbook — swapping to `run.winArt` while the stack is part of a paying line) into a box
	 * `naturalCells` tall, then masks it to `visibleCells` cells at `run.hiddenAbove`
	 * so a partial stack shows N/M of the picture. Most runs top-align (`hiddenAbove === 0` ⇒ top N/M); a
	 * partial pinned to the board's TOP edge sets `hiddenAbove` so the BOTTOM N/M shows and the rest runs
	 * off-screen above (see the run scan). When no config art is authored (dev / coded fallback) it falls
	 * back to the symbol's `stacked` state binding, so the mechanic still renders.
	 *
	 * Coordinate space: the parent mounts this inside the resting board container, so `run.x` /
	 * `run.topEdgeY` are the SAME board-local coordinates `BoardBase` uses. The container is centred on
	 * the full picture; every branch anchors at 0.5 — the texture centre for a sprite/flipbook, the
	 * centre of its authored box for a rig; the mask rectangle then reveals only the top
	 * `visibleCells` from the box top.
	 */
	const { run }: { run: StackedPictureRun } = $props();
	const context = getContext();

	const geometry = $derived(context.stateGameDerived.boardGeometry());

	/**
	 * Is this stack currently PAYING? The cells a tall picture covers mount no `<Symbol>`, but the win
	 * presentation still walks them — `Board.svelte` sets `symbolState = 'win'` on every paying cell and
	 * reverts it to `postWinStatic` once the beat is over — so the covered cells' own state is the
	 * truthful, already-reactive signal for "this picture is the one paying right now". A line usually
	 * crosses ONE cell of the run, so ANY lit covered cell lights the whole picture: the tall picture IS
	 * the symbol, and half a picture cannot pay.
	 *
	 * Short-circuits when nothing is authored to swap to, so a project with a single stacked picture
	 * never even reads the board — its render path is byte-identical to before this existed.
	 */
	const winning = $derived.by(() => {
		if (!run.winArt) return false;
		const symbols = context.stateGame.board[run.reel]?.reelState.symbols;
		if (!symbols) return false;
		for (let row = run.topRow; row < run.topRow + run.visibleCells; row += 1)
			if (symbols[row]?.symbolState === 'win') return true;
		return false;
	});

	// The authored WINNING picture while this stack pays, else the authored resting picture; with neither
	// authored, the symbol's `stacked` state binding (the coded-fallback path).
	const info = $derived(
		(winning ? run.winArt : undefined) ??
			run.art ??
			getSymbolInfo({ rawSymbol: { name: run.name }, state: 'stacked' }),
	);

	// Box = cell width × the FULL picture height (naturalCells). Art is stretched to fill it, so a
	// tall picture authored at the box aspect renders undistorted while a placeholder icon still fills
	// and crops (making the mechanic visible before real art is bound).
	const boxW = $derived(geometry.cellWidthLocal);
	const boxH = $derived(run.naturalCells * geometry.rowPitchLocal);
	/**
	 * Where the picture box and its visible window sit, in board rows. Settled: the box top is
	 * `hiddenAbove` rows over the run (0 ⇒ top-aligned, the top N/M shows; a top-edge partial slides the
	 * box UP so its BOTTOM N/M fills the run and the rest is clipped off-screen above by the board
	 * window mask) and the window is the run. While an expanding wild GROWS over this reel
	 * (`wildRewrite`), the window opens from the landed slice to the whole reel, and the run holding
	 * the landed cell slides its box from where the slice showed it to where the full stack does.
	 */
	const frame = $derived.by(() => {
		const boxTop = run.topRow - run.hiddenAbove;
		const top = run.topRow;
		const bottom = run.topRow + run.visibleCells;
		const grow = stackedGrowthFor(run.reel);
		if (!grow) return { boxTop, top, bottom };
		const p = grow.progress.current;
		const lerp = (from: number, to: number) => from + (to - from) * p;
		const holdsOrigin = top <= grow.originRow && grow.originRow < bottom;
		const windowTop = Math.max(top, lerp(grow.from.top, grow.to.top));
		const windowBottom = Math.min(bottom, lerp(grow.from.bottom, grow.to.bottom));
		return {
			boxTop: holdsOrigin ? lerp(grow.fromBoxTop, boxTop) : boxTop,
			top: windowTop,
			bottom: Math.max(windowTop, windowBottom),
		};
	});
	const boxOffset = $derived((frame.boxTop - run.topRow) * geometry.rowPitchLocal);
	const maskOffset = $derived((frame.top - frame.boxTop) * geometry.rowPitchLocal);
	const maskH = $derived((frame.bottom - frame.top) * geometry.rowPitchLocal);
	// Generous horizontal span — the crop is VERTICAL only, so the mask must never clip the sides.
	const maskW = $derived(boxW * 2);

	const isSprite = $derived(info.type === 'sprite');
	const isFlipbook = $derived(info.type === 'flipbook');
	const clip = $derived(isFlipbook && info.clipId ? resolveFlipbook(info.clipId) : undefined);

	/**
	 * ABOVE THE SYMBOL BAND, and now said out loud rather than inherited from mount order.
	 *
	 * This overlay replaces the per-cell icons under a run, so it has always drawn over them — it
	 * simply mounted after `BoardBase` and every board child sat at the default `0`. Now that a
	 * symbol carries a seat-derived index in `(0, 0.5]` (`ReelSymbol`'s `zIndex`), the parent sorts,
	 * and an unstated `0` would drop this BEHIND the very icons it exists to hide. Still under
	 * `BookVfx`'s foreground (`+1`), which is where it already was.
	 */
	const Z_INDEX = 0.75;
</script>

<Container x={run.x} y={run.topEdgeY + boxOffset + boxH / 2} zIndex={Z_INDEX}>
	{#if isSprite}
		<Sprite key={info.assetKey} anchor={0.5} width={boxW} height={boxH} />
	{:else if isFlipbook && clip}
		<Flipbook {clip} anchor={0.5} width={boxW} height={boxH} />
	{:else if isFlipbook}
		<!-- Dangling clip ⇒ the cell's primary frame, mirroring SymbolFlipbook's fallback. -->
		<Sprite key={info.assetKey} anchor={0.5} width={boxW} height={boxH} />
	{:else if info.animationName}
		<!--
			`loadScaleBase` cancels the rig LOAD SCALE the reader baked into the geometry but not into
			`skeleton.data.width/height` — without it a sized rig renders at `box × its_load_scale`
			(a symbol-loaded rig ⇒ 2× the box). The sprite/flipbook branches above size exactly, so the
			rig must too: pinned to `EDITOR_RIG_LOAD_SCALE`, the rig fills exactly `boxW × boxH`
			regardless of the scale its bundle was read at. Mirrors the WinAnimation / FreeSpin surfaces.

			`anchor={0.5}` drops the centre of the rig's authored box on the box centre — exactly how
			`SymbolRigMain` centres every normal symbol, whether or not the skeleton origin happens to
			sit in that centre.
		-->
		<RigProvider
			key={info.assetKey}
			anchor={0.5}
			width={boxW}
			height={boxH}
			loadScaleBase={EDITOR_RIG_LOAD_SCALE}
		>
			<RigTrack trackIndex={0} animationName={info.animationName} loop />
		</RigProvider>
	{/if}

	<Rectangle isMask x={-maskW / 2} y={-boxH / 2 + maskOffset} width={maskW} height={maskH} />
</Container>
