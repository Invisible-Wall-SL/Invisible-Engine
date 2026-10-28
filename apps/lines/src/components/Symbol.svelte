<script lang="ts">
	import SymbolFlipbook from './SymbolFlipbook.svelte';
	import SymbolLayer from './SymbolLayer.svelte';
	import SymbolRigMain from './SymbolRigMain.svelte';
	import SymbolSprite from './SymbolSprite.svelte';
	import SymbolWinFrame from './SymbolWinFrame.svelte';
	import { symbolStateLoopsByDefault, WIN_HIGHLIGHT_SYMBOL_STATES } from 'engine-layout';
	import { ElementFxPlayer } from 'engine-layout/svelte';
	import { elementFxEnterEnds } from 'constants-shared/elementFx';

	import { getSymbolInfo, hasAuthoredSymbolState } from '../game/utils';
	import type { SymbolState, RawSymbol, SymbolLayerSpec } from '../game/types';
	import { playWildExplodeSound } from '../game/soundBindings';
	import { BitmapText, Container } from 'pixi-svelte';
	import CoinLabel from './CoinLabel.svelte';
	import SymbolPlaceholder from './SymbolPlaceholder.svelte';
	import { coinLabelFor, coinLabelLookFor, type CoinLabelPopCue } from '../game/coinLabel';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { symbolPlaceholder } from '../game/symbolPlaceholder';
	import { bakedSymbolFx } from '../editor-scenes';
	import { stateFxGate } from '../game/stateFxGate';
	import { symbolStateFx } from '../game/symbolStateFx';

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
		 * picture, whatever it is bound to. A flipbook stops on frame 0 of its playback walk; a rig
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
		/**
		 * What the coin label READS instead of `rawSymbol`'s own value / factor — a Hold and Win count-up
		 * in flight (`stateRespinBoard.heldDisplay`) — or its jackpot tier, held at the old one until an
		 * upgrade's beam lands. Only the label follows it, so a label ticking every frame never
		 * re-resolves the art. Omitted everywhere else.
		 */
		labelOverride?: Pick<RawSymbol, 'value' | 'factor' | 'jackpot'>;
		/** A pop for the coin label (`RespinHeldSymbol`, from the authored `coinLabel.animation`). */
		labelPop?: CoinLabelPopCue;
		/** This symbol is a flight's head (`FlightLayer`): it draws no coin label — the flight draws
		 *  the value upright while the symbol turns — and no win frame, which marks a win on the
		 *  board, not a symbol in the air. */
		inFlight?: boolean;
		/**
		 * Which cell a POOLED view is drawing (`ReelPaddingPool` → `ReelSymbol`). The view outlives the
		 * cells it is handed, so everything inside the bands is keyed on it and starts again for each
		 * cell — a rig on frame 0, a state's Element FX and its beat gate fresh — exactly as a newly
		 * mounted symbol would; only the band containers themselves are kept. Omitted everywhere else,
		 * where the key never changes.
		 */
		instanceKey?: number;
	};

	const props: Props = $props();
	const symbolInfo = $derived(getSymbolInfo({ rawSymbol: props.rawSymbol, state: props.state }));
	const isSprite = $derived(symbolInfo.type === 'sprite');
	const isFlipbook = $derived(symbolInfo.type === 'flipbook');
	// No art bound for this symbol: draw no art at all — except a pot token or a Hold and Win coin,
	// which draws a coded disc until art is bound (`symbolPlaceholder`). The `{:else}` arm below is
	// the RIG renderer, so falling through would hand it an undefined bundle — the blank-binding
	// crash one layer down from the one `getSymbolInfo` now absorbs. Any value the symbol CARRIES (a
	// multiplier) still draws, because that is the part the player needs to read.
	const hasArt = $derived(!symbolInfo.missingArt);
	const placeholder = $derived(
		hasArt ? undefined : symbolPlaceholder(getActiveGameConfig(), props.rawSymbol.name),
	);
	/**
	 * A Hold and Win coin's value, jackpot tier or factor. Like the multiplier stamp it draws even
	 * with no art bound — the value is what the player reads — and it sits in its own band after the
	 * win frame's, so a frame mounting later on `win` cannot land on top of it.
	 */
	const labelSymbol = $derived(
		props.labelOverride ? { ...props.rawSymbol, ...props.labelOverride } : props.rawSymbol,
	);
	const coinLabel = $derived(coinLabelFor(labelSymbol));
	// The tier alone decides the look, so a value counting every frame never re-resolves it.
	const labelJackpot = $derived(props.labelOverride?.jackpot ?? props.rawSymbol.jackpot);
	const labelLook = $derived(coinLabelLookFor({ ...props.rawSymbol, jackpot: labelJackpot }));
	/**
	 * Does this state's animation repeat? The authored cell decides; absent, THE STATE decides
	 * (`symbolStateLoopsByDefault`) — loop for a state that says how a symbol IS, one-shot for a
	 * TERMINAL one that says it is leaving (`explosion`, `clearReel`). An explicit `loop` prop still
	 * wins, for the callers that own the decision themselves.
	 *
	 * It used to be a flat `?? true` for every state, matching what a flipbook cell has always done
	 * (`clip.loop ?? true`). That is safe for a flipbook — `SymbolFlipbook` times its `oncomplete` off
	 * the clip's LENGTH, so a looping clip still completes after one cycle — but not for a rig,
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
	 * over whichever arm won. It used to live inside the rig arm, which is why a symbol whose Win
	 * cell was bound to a flipbook (or a sprite) paid with no frame while its rig-bound neighbour
	 * on the same payline got one.
	 *
	 * A symbol with NO art gets no frame (it draws nothing, or an add-on's placeholder disc): a lone
	 * frame around empty space reads as a rendering fault rather than as the missing binding it is.
	 *
	 * Drawn on every WIN HIGHLIGHT state, not only `win`: the Hold and Win beats that played `win`
	 * before they had names of their own (`WIN_HIGHLIGHT_SYMBOL_STATES`) keep the frame they had —
	 * except on a flight's head (`inFlight`): `flyToMeter` frames the cell a special leaves from, not
	 * the token flying out of it.
	 */
	const showWinFrame = $derived(
		hasArt &&
			!props.inFlight &&
			(WIN_HIGHLIGHT_SYMBOL_STATES as readonly string[]).includes(props.state) &&
			props.rawSymbol.name !== 'M',
	);

	/**
	 * EXTRA ART for this state — a symbol composed of more than one picture (Invisible Symbols State
	 * Machine → the cell editor's "Layers"). Mounted HERE, and that is the point of the choke point:
	 * every symbol mount site in the game flows through this component — the reel board, the
	 * cascade, the stacked mode, the debug grid, the Book expand/reveal riders, the inline message
	 * symbol — so one seam reaches all of them.
	 *
	 * DRAW ORDER: a `behind` layer is rendered before the cell's art and the rest after it, and
	 * within each group the authored array order is kept. The win frame and the multiplier stamp stay
	 * last of all: both are readouts of the round, not art the author is composing, and a layer drawn
	 * over the frame would hide the win.
	 *
	 * IT IS BOUGHT TWICE, because markup order alone does not survive a state change.
	 *
	 * Each group sits in an UNCONDITIONAL `<Container>` of its own — the same device, for the same
	 * reason, as the two tint wrappers below. `layers` is resolved per STATE (`getSymbolInfo`), so a
	 * spin whose state binds different layers (or none) unmounts them and lands them again on the
	 * next state. A `pixi-svelte` child is `addChild`-ed once in `onMount` and nothing re-derives the
	 * order, so a layer that remounts is appended to the END of whatever holds it: the behind-group's
	 * shadow reappeared IN FRONT of the character after the first spin, and stayed there until the
	 * cell was rebuilt. The wrapper is mounted once and never unmounts, so the three bands hold
	 * whatever the layers inside them do.
	 *
	 * WITHIN a band the layers carry a `zIndex` (their array index), because the wrapper only fixes
	 * which band they are in — two behind-layers that remount in a different order would still swap,
	 * and a ripple swapping with the shadow above it is the same bug one level in. Sorting is safe to
	 * turn on HERE and was not before: the wrapper is a container this component owns outright,
	 * whereas the cell's own parent varies by mount site (`SymbolWrap`, the cascade's animating
	 * layer, a text line) and may hold children that are none of our business.
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

	/**
	 * PER-STATE ELEMENT FX (Invisible Symbols State Machine → a state's "Element FX"): a Land that
	 * shakes, a Win that glows, an Explosion that melts. A symbol with any authored draws all its
	 * bands inside ONE container of its own, which the effects play on — whole, frame and stamp
	 * included; every other symbol draws exactly as before, with no container added. The choice is
	 * per SYMBOL, not per state, so moving between states never remounts the art. A state plays its
	 * own list only (no inheritance): its `enter` entries as the symbol enters it, its `always`
	 * entries looping while it stays — `{#key}` on the state ends them as it leaves. The inline
	 * message icon (`frozen`) plays none.
	 *
	 * The state's beat waits for its `enter` entries that end (`stateFxGate`): the art's completion
	 * is held until they have played out, so a Land shake is not ended by a still picture completing
	 * on its first frame, and a state with no art of its own is paced by them alone. One gate per
	 * visit of a state; a gate the symbol has moved on from reports nothing.
	 */
	const symbolFx = $derived(props.frozen ? undefined : bakedSymbolFx()[props.rawSymbol.name]);
	const stateFx = $derived(symbolFx ? symbolStateFx(props.rawSymbol.name, props.state) : []);
	const waitsForFx = $derived(stateFx.some(elementFxEnterEnds));
	const ownArt = $derived(hasAuthoredSymbolState(props.rawSymbol.name, props.state));
	const gate = $derived.by(() => {
		void props.state;
		void props.instanceKey;
		const visit = stateFxGate(waitsForFx, ownArt, () => {
			if (visit === gate) props.oncomplete?.();
		});
		return visit;
	});
	const artComplete = $derived(symbolFx ? () => gate.art() : props.oncomplete);

	/** `{#each}` key — the position PLUS the binding, so re-binding a layer REMOUNTS it (a fresh
	 *  rig/flipbook/effect rather than one re-pointed mid-flight) while a pure blend or offset
	 *  change updates in place. Position alone would reuse a rig renderer for a sprite layer. */
	const layerKey = (layer: SymbolLayerSpec, i: number): string =>
		`${i}:${layer.kind}:${layer.assetKey ?? layer.clipId ?? layer.effectId ?? ''}`;
</script>

<!--
	THE DIM IS APPLIED PER PIECE, and the two `<Container>`s below exist only to carry it (see the
	`tint` prop). They are UNCONDITIONAL on purpose: wrapping only while dimmed would remount the art
	every time the celebration started or ended — a rig would restart its animation mid-win — where
	an always-mounted container with no tint set is a transform-free no-op.

	Draw order is unchanged: behind-layers, the cell's art, over-layers, then the win frame and the
	multiplier stamp. Each of the four is now its own unconditional container, so the bands survive a
	layer remounting (see `layers` above). The frame and the stamp share the last one because they
	are contiguous; nothing may be re-ordered to share a container, since the containers ARE the
	bands.
-->
{#if symbolFx}
	<Container>
		{@render bands()}
		{#key props.instanceKey}
			{#key props.state}
				{#if stateFx.length}
					<ElementFxPlayer entries={stateFx} ondone={gate.fx} />
				{/if}
			{/key}
		{/key}
	</Container>
{:else}
	{@render bands()}
{/if}

{#snippet bands()}
	<Container>
		{#key props.instanceKey}
			{#each behindLayers as layer, i (layerKey(layer, i))}
				<SymbolLayer
					{layer}
					x={props.x ?? 0}
					y={props.y ?? 0}
					tint={layerTint(layer)}
					zIndex={i + 1}
				/>
			{/each}
		{/key}
	</Container>

	<Container tint={props.tint}>
		{#key props.instanceKey}
			{#if !hasArt}
				{#if placeholder}
					<SymbolPlaceholder
						look={placeholder}
						state={props.state}
						showText={!coinLabel}
						x={props.x}
						y={props.y}
						oncomplete={artComplete}
					/>
				{/if}
			{:else if isFlipbook}
				<SymbolFlipbook
					{symbolInfo}
					{loop}
					frozen={props.frozen}
					x={props.x}
					y={props.y}
					oncomplete={artComplete}
				/>
			{:else if isSprite}
				<SymbolSprite {symbolInfo} x={props.x} y={props.y} oncomplete={artComplete} />
			{:else}
				<SymbolRigMain
					{loop}
					{symbolInfo}
					frozen={props.frozen}
					x={props.x}
					y={props.y}
					listener={{
						complete: artComplete,
						event: (_, event) => {
							if (event.data?.name === 'wildExplode') playWildExplodeSound();
						},
					}}
				/>
			{/if}
		{/key}
	</Container>

	<Container>
		{#key props.instanceKey}
			{#each overLayers as layer, i (layerKey(layer, i))}
				<SymbolLayer
					{layer}
					x={props.x ?? 0}
					y={props.y ?? 0}
					tint={layerTint(layer)}
					zIndex={i + 1}
				/>
			{/each}
		{/key}
	</Container>

	<Container tint={props.tint}>
		{#key props.instanceKey}
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
		{/key}
	</Container>

	<Container tint={props.tint}>
		{#key props.instanceKey}
			{#if coinLabel && !props.inFlight}
				<CoinLabel x={props.x} y={props.y} text={coinLabel} look={labelLook} pop={props.labelPop} />
			{/if}
		{/key}
	</Container>
{/snippet}
