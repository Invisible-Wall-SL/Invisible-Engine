<script lang="ts">
	import SymbolFlipbook from './SymbolFlipbook.svelte';
	import SymbolSpineMain from './SymbolSpineMain.svelte';
	import SymbolSprite from './SymbolSprite.svelte';
	import SymbolWinFrame from './SymbolWinFrame.svelte';
	import { symbolStateLoopsByDefault } from 'engine-layout';

	import { getSymbolInfo } from '../game/utils';
	import type { SymbolState, RawSymbol } from '../game/types';
	import { playWildExplodeSound } from '../game/soundBindings';
	import { BitmapText } from 'pixi-svelte';

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
</script>

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
