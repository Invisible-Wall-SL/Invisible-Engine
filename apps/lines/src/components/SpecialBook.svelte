<script lang="ts" module>
	import type { SymbolName } from '../game/types';

	export type EmitterEventSpecialBook =
		| { type: 'specialBookReveal'; symbol: SymbolName }
		| { type: 'specialBookHide' };
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

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const hide = () => {
		clearTimer();
		phase = 'hidden';
		displayName = null;
	};

	const shuffle = (target: SymbolName) => {
		clearTimer();
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
	};

	context.eventEmitter.subscribeOnMount({
		specialBookReveal: ({ symbol }) => shuffle(symbol),
		specialBookHide: () => hide(),
	});

	onDestroy(clearTimer);
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
						if (phase === 'intro') phase = 'idle';
					}}
				/>
			</Container>
		</MainContainer>
	</FadeContainer>
{/if}
