<script lang="ts">
	import { onDestroy } from 'svelte';

	import { FadeContainer } from 'components-pixi';
	import { getComponentParams } from 'engine-layout/svelte';
	import { Container, SpineBoneAttach, SpineProvider, SpineTrack } from 'pixi-svelte';

	import Symbol from './Symbol.svelte';
	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import type { SymbolName, SymbolState } from '../game/types';

	// The chosen book expanding symbol MERGED into an authored intro Spine RIG (the reusable
	// "flip through symbols → land on YOUR symbol" reveal, book-reveal authoring). The
	// `freeSpinIntroSymbolReveal` builtin def binds this. Unlike the coded `SpecialBook` it does
	// NOT shuffle standalone symbols — it plays the author-picked rig animation and RIDES the
	// chosen `stateGame.specialSymbol` on a named BONE of that rig via `<SpineBoneAttach>` (the
	// symbol banks/scales with the animation). Driven by the SAME awaited `specialBookReveal`
	// cue as the coded shuffle (fired at `setExpandingSymbol` time, when the symbol is known);
	// it hands the broadcaster a promise that settles when the rig's intro animation completes,
	// so the round blocks until the reveal is done. Placing this in the `specialBook` scene flips
	// book-reveal ownership ⇒ the coded shuffle is suppressed and this replaces it. Position/scale
	// of the rig come from the instance node.
	const {
		introSpine: introSpineProp = 'fsIntro',
		introAnimation: introAnimationProp = 'intro',
		idleAnimation: idleAnimationProp = 'idle',
		symbolBone: symbolBoneProp = '',
		offsetX: offsetXProp = 0,
		offsetY: offsetYProp = 0,
		followRotation: followRotationProp = true,
		followScale: followScaleProp = true,
		symbolScale: symbolScaleProp = 1,
		symbolState: symbolStateProp = 'bookIdle',
	}: {
		introSpine?: string;
		introAnimation?: string;
		idleAnimation?: string;
		symbolBone?: string;
		offsetX?: number;
		offsetY?: number;
		followRotation?: boolean;
		followScale?: boolean;
		symbolScale?: number;
		symbolState?: SymbolState;
	} = $props();

	const context = getContext();

	const stringParam = (key: string): string | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	};
	const numberParam = (key: string): number | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	};
	const booleanParam = (key: string): boolean | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'boolean' ? value : undefined;
	};

	const introSpine = $derived(stringParam('introSpine') ?? introSpineProp);
	const introAnimation = $derived(stringParam('introAnimation') ?? introAnimationProp);
	const idleAnimation = $derived(stringParam('idleAnimation') ?? idleAnimationProp);
	const symbolBone = $derived(stringParam('symbolBone') ?? symbolBoneProp);
	const offset = $derived({
		x: numberParam('offsetX') ?? offsetXProp,
		y: numberParam('offsetY') ?? offsetYProp,
	});
	const followRotation = $derived(booleanParam('followRotation') ?? followRotationProp);
	const followScale = $derived(booleanParam('followScale') ?? followScaleProp);
	const symbolScale = $derived(numberParam('symbolScale') ?? symbolScaleProp);
	const symbolState = $derived(
		(stringParam('symbolState') as SymbolState | undefined) ?? symbolStateProp,
	);

	type Phase = 'hidden' | 'intro' | 'idle';

	let phase = $state<Phase>('hidden');
	let displayName = $state<SymbolName | null>(null);
	let animationName = $state<string>(introAnimationProp);
	// Resolves once the reveal (rig intro animation) has fully played. `play` hands this back
	// as a promise so the awaited `specialBookReveal` broadcaster blocks the round on it — the
	// free spins must not start until the book symbol is chosen AND revealed.
	let revealResolve: (() => void) | null = null;

	const settleReveal = () => {
		const resolve = revealResolve;
		revealResolve = null;
		resolve?.();
	};

	const hide = () => {
		settleReveal();
		phase = 'hidden';
		displayName = null;
	};

	const play = (target: SymbolName) =>
		new Promise<void>((resolve) => {
			settleReveal();
			revealResolve = resolve;
			displayName = target;
			animationName = introAnimation;
			phase = 'intro';
		});

	/**
	 * The symbol to ride on the bone. The `specialBookReveal` cue payload wins when it carries one
	 * (a game that flips through symbols before landing drives it that way), but it FALLS BACK to
	 * `stateGame.specialSymbol` — the chosen expanding symbol, the SAME field the counter's
	 * `ExpandingSymbol` reads and the `setSpecialSymbol` effect writes.
	 *
	 * The fallback exists because the two are separate delivery paths: the cue only TRIGGERS the
	 * reveal (it can fire with no symbol, which still plays the rig animation), whereas the symbol
	 * IDENTITY has a single source of truth in state. Sourcing it here means a valid chosen symbol
	 * always renders on the bone even when the cue arrives empty — the symbol can't show in the
	 * counter but go missing on the cage.
	 */
	const shownName = $derived(displayName ?? (stateGame.specialSymbol as SymbolName | null));

	context.eventEmitter.subscribeOnMount({
		specialBookReveal: ({ symbol }) => play(symbol),
		specialBookHide: () => hide(),
	});

	onDestroy(() => settleReveal());
</script>

{#if introSpine}
	<FadeContainer show={phase !== 'hidden'}>
		<SpineProvider key={introSpine}>
			<SpineTrack
				trackIndex={0}
				{animationName}
				loop={animationName === idleAnimation}
				listener={{
					complete: () => {
						if (phase === 'intro') {
							phase = 'idle';
							animationName = idleAnimation;
							settleReveal();
						}
					},
				}}
			/>
			{#if shownName && symbolBone}
				<SpineBoneAttach boneName={symbolBone} {offset} {followRotation} {followScale}>
					<Container scale={symbolScale}>
						<Symbol
							rawSymbol={{ name: shownName }}
							state={symbolState}
							loop={symbolState === 'bookIdle'}
						/>
					</Container>
				</SpineBoneAttach>
			{/if}
		</SpineProvider>
	</FadeContainer>
{/if}
