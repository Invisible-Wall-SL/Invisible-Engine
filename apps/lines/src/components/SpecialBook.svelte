<script lang="ts" module>
	import type { SymbolName } from '../game/types';

	export type EmitterEventSpecialBook =
		| { type: 'specialBookReveal'; symbol: SymbolName }
		| { type: 'specialBookHide' }
		// The optional press-to-continue book-reveal GATE arm — Phase 3, AWAITABLE, so a
		// broadcastAwait of it in the choreography blocks the round until the player taps.
		// Mirrors freeSpinIntroShow/freeSpinIntroUpdate and is owned by BookRevealGate.
		| { type: 'bookRevealGateShow' };
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	import { Container } from 'pixi-svelte';
	import { MainContainer } from 'components-layout';
	import { FadeContainer } from 'components-pixi';
	import { getComponentParams } from 'engine-layout/svelte';

	import Symbol from './Symbol.svelte';
	import { getContext } from '../game/context';
	import { getActiveSymbolInfoMap } from '../game/symbolMap';

	// The chosen expanding symbol is revealed with a slot-machine "shuffle through all
	// symbols → land on the chosen one" animation, then idles for the rest of the bonus.
	// Its art + animations come from the symbol state machine (`bookIntro`/`bookIdle`
	// states), NOT from props — props only tune placement/scale. Self-centred over the
	// board via `<MainContainer>` + `boardLayout()` (mirrors `FreeSpinAnimation`).
	const {
		scale: scaleProp = 1.6,
	}: {
		scale?: number;
	} = $props();

	const context = getContext();

	const numberParam = (key: string): number | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	};

	const scale = $derived(numberParam('scale') ?? scaleProp);

	const symbolNames = () => Object.keys(getActiveSymbolInfoMap()) as SymbolName[];

	// Shuffle deceleration: start fast and ease to a stop over a fixed number of frames,
	// landing on the chosen symbol. The per-frame delay grows geometrically from
	// `SHUFFLE_MIN_DELAY` to `SHUFFLE_MAX_DELAY` so the cycle visibly slows before it stops.
	const SHUFFLE_FRAMES = 24;
	const SHUFFLE_MIN_DELAY = 50;
	const SHUFFLE_MAX_DELAY = 320;

	type Phase = 'hidden' | 'shuffle' | 'intro' | 'idle';

	let phase = $state<Phase>('hidden');
	let displayName = $state<SymbolName | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;
	// Resolves once the current reveal (shuffle → land → intro spine) has fully settled.
	// `shuffle` hands this back as a promise so the `specialBookReveal` broadcaster can
	// await it — the free spins must not start until the book symbol is chosen AND revealed.
	let revealResolve: (() => void) | null = null;

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const settleReveal = () => {
		const resolve = revealResolve;
		revealResolve = null;
		resolve?.();
	};

	const hide = () => {
		clearTimer();
		settleReveal();
		phase = 'hidden';
		displayName = null;
	};

	const shuffle = (target: SymbolName) =>
		new Promise<void>((resolve) => {
			clearTimer();
			settleReveal();
			revealResolve = resolve;
			const names = symbolNames();
			phase = 'shuffle';
			let frame = 0;
			const step = () => {
				if (frame >= SHUFFLE_FRAMES) {
					displayName = target;
					phase = 'intro';
					return;
				}
				displayName = names[frame % names.length];
				const t = frame / SHUFFLE_FRAMES;
				const delay = SHUFFLE_MIN_DELAY + (SHUFFLE_MAX_DELAY - SHUFFLE_MIN_DELAY) * t * t;
				frame += 1;
				timer = setTimeout(step, delay);
			};
			step();
		});

	context.eventEmitter.subscribeOnMount({
		specialBookReveal: ({ symbol }) => shuffle(symbol),
		specialBookHide: () => hide(),
	});

	onDestroy(() => {
		clearTimer();
		settleReveal();
	});
</script>

{#if displayName}
	<FadeContainer show={phase !== 'hidden'}>
		<MainContainer>
			<Container
				x={context.stateGameDerived.boardLayout().x}
				y={context.stateGameDerived.boardLayout().y}
				{scale}
			>
				<Symbol
					rawSymbol={{ name: displayName }}
					state={phase === 'idle' ? 'bookIdle' : phase === 'intro' ? 'bookIntro' : 'static'}
					loop={phase === 'idle'}
					oncomplete={() => {
						if (phase === 'intro') {
							phase = 'idle';
							settleReveal();
						}
					}}
				/>
			</Container>
		</MainContainer>
	</FadeContainer>
{/if}
