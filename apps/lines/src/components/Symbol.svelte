<script lang="ts">
	import SymbolFlipbook from './SymbolFlipbook.svelte';
	import SymbolLayer from './SymbolLayer.svelte';
	import SymbolSpineMain from './SymbolSpineMain.svelte';
	import SymbolSprite from './SymbolSprite.svelte';
	import SymbolWinFrame from './SymbolWinFrame.svelte';
	import { symbolStateLoopsByDefault } from 'engine-layout';

	import { getSymbolInfo } from '../game/utils';
	import type { SymbolState, RawSymbol, SymbolLayerSpec } from '../game/types';
	import { playWildExplodeSound } from '../game/soundBindings';
	import { BitmapText, Container } from 'pixi-svelte';

	type Props = {
		x?: number;
		y?: number;
		state: SymbolState;
		rawSymbol: RawSymbol;
		oncomplete?: () => void;
		/** The paying line's authored colour for the current win (`#rrggbb`), forwarded to the win
		 *  frame so a `winLine`-tinted highlight glows in that line's colour. */
		winLineColor?: string;
		/** Explicit override of the state's authored `loop`. Used by the callers that own the decision
		 * themselves (the Book expand/reveal riders, which loop only their `bookIdle`). Omit and the
		 * cell authored in the Symbols State Machine decides. */
		loop?: boolean;
		/** Hold this state on its FIRST frame instead of animating it — the symbol drawn as a still
		 * picture, whatever it is bound to. A flipbook stops on frame 0 of its playback walk; a spine
		 * holds the pose its animation opens on; a sprite is already one frame and is unaffected. Used
		 * by the inline message symbol, where a moving icon inside a line of text pulls the eye off
		 * the sentence it illustrates. */
		frozen?: boolean;
		/**
		 * The win-celebration DIM for this cell (`winCycle.dimNonWinning`) — a Pixi tint, applied to
		 * each drawn PIECE below rather than once on a container above them all.
		 *
		 * That split is what a per-layer opt-out costs. Pixi v8 computes
		 * `groupColor = localColor × parent.groupColor`, so a child under a dimmed container can only
		 * darken further and can NEVER brighten back (measured against the real
		 * `updateRenderGroupTransforms`): a layer that must stay lit has to be outside every tinted
		 * node, not merely carry a brighter tint of its own. The dim therefore moved down here from
		 * `SymbolWrap`, which used to tint the whole cell in one go.
		 *
		 * Parity is exact, and by construction rather than by inspection: the cascade multiplies, so
		 * moving the SAME factor from an ancestor onto every one of its descendants leaves each leaf's
		 * `groupColor` identical. Every piece that the wrapper used to reach — the base art, the
		 * layers, the win frame and the multiplier stamp — is still under exactly one tinted node.
		 *
		 * Only the reel board passes it, and it always passes a NUMBER (`0xffffff` when undimmed),
		 * never `undefined`: `propsSyncEffect` SKIPS an undefined prop, so a tint that went
		 * number → undefined would leave the last value stuck on the container. Every other mount site
		 * (cascade, stacked, debug grid, Book riders, message symbol) passes nothing at all, which
		 * touches no container property and is byte-identical to before this prop existed.
		 */
		tint?: number;
	};

	const props: Props = $props();
	const symbolInfo = $derived(getSymbolInfo({ rawSymbol: props.rawSymbol, state: props.state }));
	const isSprite = $derived(symbolInfo.type === 'sprite');
	const isFlipbook = $derived(symbolInfo.type === 'flipbook');
	// No art bound for this symbol: draw no art at all. The `{:else}` arm below is the SPINE
	// renderer, so falling through would hand it an undefined bundle — the blank-binding crash
	// one layer down from the one `getSymbolInfo` now absorbs. Any value the symbol CARRIES (a
	// multiplier) still draws, because that is the part the player needs to read.
	const hasArt = $derived(!symbolInfo.missingArt);
	/**
	 * Does this state's animation repeat? The authored cell decides; absent, THE STATE decides
	 * (`symbolStateLoopsByDefault`) — loop for a state that says how a symbol IS, one-shot for a
	 * TERMINAL one that says it is leaving (`explosion`, `clearReel`). An explicit `loop` prop still
	 * wins, for the callers that own the decision themselves.
	 *
	 * It used to be a flat `?? true` for every state, matching what a flipbook cell has always done
	 * (`clip.loop ?? true`). That is safe for a flipbook — `SymbolFlipbook` times its `oncomplete` off
	 * the clip's LENGTH, so a looping clip still completes after one cycle — but not for a spine,
	 * which reports completion only through the runtime's own `complete` event. A looping explosion
	 * therefore had no end for the pop's beat to settle on and spent the whole win-beat budget.
	 *
	 * The default is asked of `props.state` — the state the caller REQUESTED, not `symbolInfo`'s
	 * resolved fallback — because "is this beat terminal?" is a question about the moment, not about
	 * which cell's art ended up drawing it.
	 */
	const loop = $derived(
		props.loop ??
			(symbolInfo.missingArt ? undefined : symbolInfo.loop) ??
			symbolStateLoopsByDefault(props.state),
	);
	/**
	 * The authored win-highlight frame is a property of the winning SYMBOL, not of one renderer, so
	 * the decision lives here — beside the branch that picks the renderer — and the frame is drawn
	 * over whichever arm won. It used to live inside the spine arm, which is why a symbol whose Win
	 * cell was bound to a flipbook (or a sprite) paid with no frame while its spine-bound neighbour
	 * on the same payline got one.
	 *
	 * A symbol with NO art draws nothing at all, frame included: a lone frame around empty space
	 * reads as a rendering fault rather than as the missing binding it is.
	 */
	const showWinFrame = $derived(hasArt && props.state === 'win' && props.rawSymbol.name !== 'M');

	/**
	 * EXTRA ART for this state — a symbol composed of more than one picture (Invisible Symbols State
	 * Machine → the cell editor's "Layers"). Mounted HERE, and that is the point of the choke point:
	 * every symbol mount site in the game flows through this component — the reel board, the
	 * cascade, the stacked mode, the debug grid, the Book expand/reveal riders, the inline message
	 * symbol — so one seam reaches all of them.
	 *
	 * DRAW ORDER IS MARKUP ORDER, not `zIndex`: a `behind` layer is rendered before the cell's art
	 * and the rest after it, and within each group the authored array order is kept. Pixi draws
	 * children in order, so this needs no `sortableChildren` on whatever container happens to be the
	 * parent — which varies by mount site (`SymbolWrap`, the cascade's animating layer, a text line).
	 * The win frame and the multiplier stamp stay last of all: both are readouts of the round, not
	 * art the author is composing, and a layer drawn over the frame would hide the win.
	 *
	 * A layer is passed NO `oncomplete` and no `once`, so it loops and never reports: the base cell
	 * alone owns the beat (`ReelSymbol` → `symbolBeat.ts`). If N layers reported, whichever finished
	 * first would settle the state — and picking wrong costs the round a multi-second freeze behind
	 * `WIN_BEAT_CAP_MS`. Same rule the explosion transition follows.
	 *
	 * `hasArt` gates them exactly as it gates the win frame: a cell with nothing bound draws nothing
	 * at all. Layers DECORATE a bound cell; they never stand in for one.
	 */
	const layers: SymbolLayerSpec[] = $derived(
		symbolInfo.missingArt ? [] : (symbolInfo.layers ?? []),
	);
	const behindLayers = $derived(layers.filter((layer) => layer.behind === true));
	const overLayers = $derived(layers.filter((layer) => layer.behind !== true));

	/**
	 * The dim as it reaches ONE layer. `dimWithSymbol: false` is the opt-out — the layer is drawn at
	 * full brightness while the rest of the cell darkens, which is the whole point of doing this per
	 * piece. Absent/`true` ⇒ it takes the cell's tint, exactly as every layer did before the field
	 * existed. No tint in ⇒ no tint out, so a non-board mount site still sets nothing.
	 */
	const layerTint = (layer: SymbolLayerSpec): number | undefined => {
		if (props.tint === undefined) return undefined;
		return layer.dimWithSymbol === false ? 0xffffff : props.tint;
	};

	/** `{#each}` key — the position PLUS the binding, so re-binding a layer REMOUNTS it (a fresh
	 *  spine/flipbook/effect rather than one re-pointed mid-flight) while a pure blend or offset
	 *  change updates in place. Position alone would reuse a spine renderer for a sprite layer. */
	const layerKey = (layer: SymbolLayerSpec, i: number): string =>
		`${i}:${layer.kind}:${layer.assetKey ?? layer.clipId ?? layer.effectId ?? ''}`;
</script>

<!--
	THE DIM IS APPLIED PER PIECE, and the two `<Container>`s below exist only to carry it (see the
	`tint` prop). They are UNCONDITIONAL on purpose: wrapping only while dimmed would remount the art
	every time the celebration started or ended — a spine would restart its animation mid-win — where
	an always-mounted container with no tint set is a transform-free no-op.

	Draw order is unchanged and is still MARKUP order: behind-layers, the cell's art, over-layers,
	then the win frame and the multiplier stamp. The frame and the stamp share the second container
	because they are contiguous; nothing may be re-ordered to share one, since array order IS draw
	order for the layers between them.
-->
{#each behindLayers as layer, i (layerKey(layer, i))}
	<SymbolLayer {layer} x={props.x ?? 0} y={props.y ?? 0} tint={layerTint(layer)} />
{/each}

<Container tint={props.tint}>
	{#if !hasArt}
		<!-- nothing to draw -->
	{:else if isFlipbook}
		<SymbolFlipbook
			{symbolInfo}
			{loop}
			frozen={props.frozen}
			x={props.x}
			y={props.y}
			oncomplete={props.oncomplete}
		/>
	{:else if isSprite}
		<SymbolSprite {symbolInfo} x={props.x} y={props.y} oncomplete={props.oncomplete} />
	{:else}
		<SymbolSpineMain
			{loop}
			{symbolInfo}
			frozen={props.frozen}
			x={props.x}
			y={props.y}
			listener={{
				complete: props.oncomplete,
				event: (_, event) => {
					if (event.data?.name === 'wildExplode') playWildExplodeSound();
				},
			}}
		/>
	{/if}
</Container>

{#each overLayers as layer, i (layerKey(layer, i))}
	<SymbolLayer {layer} x={props.x ?? 0} y={props.y ?? 0} tint={layerTint(layer)} />
{/each}

<Container tint={props.tint}>
	{#if showWinFrame}
		<SymbolWinFrame x={props.x} y={props.y} winLineColor={props.winLineColor} />
	{/if}

	{#if props.rawSymbol.multiplier}
		<BitmapText
			anchor={0.5}
			x={props.x}
			y={props.y}
			text={`${props.rawSymbol.multiplier}X`}
			style={{
				fontFamily: 'gold',
				fontSize: 50,
			}}
		/>
	{/if}
</Container>
