<script lang="ts">
	import { Container, Sprite, Flipbook, SpineProvider, SpineTrack, Rectangle } from 'pixi-svelte';
	import { EDITOR_SPINE_LOAD_SCALE, resolveFlipbook } from 'engine-layout';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';
	import type { StackedPictureRun } from '../game/stateGame.svelte';

	/**
	 * One tall stacked picture for the stacked-picture reel mode (docs/design/stacked-picture-mode.md).
	 * Draws the AUTHORED tall art (`run.art` — the Symbols-State-Machine stacked config, sprite / spine /
	 * flipbook — swapping to `run.winArt` while the stack is part of a paying line) into a box
	 * `naturalCells` tall, then masks it to `visibleCells` cells at `run.hiddenAbove`
	 * so a partial stack shows N/M of the picture. Most runs top-align (`hiddenAbove === 0` ⇒ top N/M); a
	 * partial pinned to the board's TOP edge sets `hiddenAbove` so the BOTTOM N/M shows and the rest runs
	 * off-screen above (see the run scan). When no config art is authored (dev / coded fallback) it falls
	 * back to the symbol's `stacked` state binding, so the mechanic still renders.
	 *
	 * Coordinate space: the parent mounts this inside the resting board container, so `run.x` /
	 * `run.topEdgeY` are the SAME board-local coordinates `BoardBase` uses. The container is centred on
	 * the full picture (anchor 0.5 everywhere avoids depending on object anchors); the mask rectangle
	 * then reveals only the top `visibleCells` from the box top.
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
	const maskH = $derived(run.visibleCells * geometry.rowPitchLocal);
	// Vertical crop OFFSET: how far the picture's top sits ABOVE the visible run. 0 ⇒ top-aligned (reveal
	// the top N/M). `hiddenAbove` cells (a top-edge partial) ⇒ the box slides UP so its BOTTOM N/M fills
	// the run and the top M−N cells continue off-screen above, clipped by the board window mask — the tall
	// symbol reads as cut off by the reel, not shrunk. See the run scan in stateGame.
	const hiddenOffset = $derived(run.hiddenAbove * geometry.rowPitchLocal);
	// Generous horizontal span — the crop is VERTICAL only, so the mask must never clip the sides.
	const maskW = $derived(boxW * 2);

	const isSprite = $derived(info.type === 'sprite');
	const isFlipbook = $derived(info.type === 'flipbook');
	const clip = $derived(isFlipbook && info.clipId ? resolveFlipbook(info.clipId) : undefined);
</script>

<Container x={run.x} y={run.topEdgeY - hiddenOffset + boxH / 2}>
	{#if isSprite}
		<Sprite key={info.assetKey} anchor={0.5} width={boxW} height={boxH} />
	{:else if isFlipbook && clip}
		<Flipbook {clip} anchor={0.5} width={boxW} height={boxH} />
	{:else if isFlipbook}
		<!-- Dangling clip ⇒ the cell's primary frame, mirroring SymbolFlipbook's fallback. -->
		<Sprite key={info.assetKey} anchor={0.5} width={boxW} height={boxH} />
	{:else if info.animationName}
		<!--
			`loadScaleBase` cancels the spine LOAD SCALE the reader baked into the geometry but not into
			`skeleton.data.width/height` — without it a sized spine renders at `box × its_load_scale`
			(a symbol-loaded rig ⇒ 2× the box). The sprite/flipbook branches above size exactly, so the
			spine must too: pinned to `EDITOR_SPINE_LOAD_SCALE`, the rig fills exactly `boxW × boxH`
			regardless of the scale its bundle was read at. Mirrors the WinAnimation / FreeSpin surfaces.

			`anchor={0}` (NOT 0.5, unlike the sprite branch): a spine's pivot lives in its LOCAL skeleton
			frame, not the requested box frame — anchor 0.5 would pivot by `box/2` and mis-centre the art
			by ≈box/2 (clipping a tall rig at the top, gapping the bottom). `centreBox` then drops the
			centre of the rig's authored box on the box centre — exactly how `SymbolSpineMain` centres
			every normal symbol, whether or not the skeleton origin happens to sit in that centre.
		-->
		<SpineProvider
			key={info.assetKey}
			anchor={0}
			width={boxW}
			height={boxH}
			loadScaleBase={EDITOR_SPINE_LOAD_SCALE}
			centreBox
		>
			<SpineTrack trackIndex={0} animationName={info.animationName} loop />
		</SpineProvider>
	{/if}

	<Rectangle isMask x={-maskW / 2} y={-boxH / 2 + hiddenOffset} width={maskW} height={maskH} />
</Container>
