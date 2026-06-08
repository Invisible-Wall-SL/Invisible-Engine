<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/<ComponentInstance> value feed (B2)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerComponents,
		registerComponentValues,
		clearComponentValues,
		type ComponentDef,
		type Scene,
		type ValueSource,
	} from 'engine-layout';

	import { setContext } from '../game/context';

	setContext();

	// Minimal Svelte-store-contract sources (the game's real ones are
	// derived(...) selectors that already drive UiLabel*). `balance` ticks up by 137
	// every 400ms (proves the readout TRACKS); `win` jumps to a big target after a
	// beat (proves the count-up TWEEN with `countUp: true`).
	const makeStore = (initial: number) => {
		let value = initial;
		const subscribers = new Set<(v: number) => void>();
		const source: ValueSource = {
			subscribe(run) {
				run(value);
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
		};
		const set = (next: number) => {
			value = next;
			for (const run of subscribers) run(value);
		};
		return { source, set, get: () => value };
	};

	const balance = makeStore(100_000);
	const win = makeStore(0);

	clearComponentValues();
	registerComponentValues({ balance: balance.source, win: win.source });

	// ONE def, two instances. `root` is a text node bound `text` → the `value`
	// param (the engineProvided number) + `style.fill` → the `fill` param. Defaults
	// make it render non-empty even before the feed emits.
	const hudReadout: ComponentDef = {
		id: 'hudReadout',
		name: 'HUD Readout',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: {
			id: 'hudReadout-root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{
					id: 'hudReadout-value',
					kind: 'text',
					text: '0',
					anchor: { x: 0.5, y: 0.5 },
					x: 0,
					y: 0,
					style: { fontFamily: 'proxima-nova', fontSize: 48, fontWeight: '700', fill: 0xffffff },
					paramBindings: { text: 'value', 'style.fill': 'fill' },
				},
			],
		},
		params: [
			{ key: 'source', kind: 'string' },
			{ key: 'fill', kind: 'color', default: 0xffffff },
			{ key: 'countUp', kind: 'boolean', default: false },
			{ key: 'value', kind: 'number', engineProvided: true },
		],
	};
	registerComponents({ hudReadout });

	const scene: Scene = {
		id: 'value-feed',
		name: 'Value feed',
		nodes: [
			{
				id: 'balance-readout',
				kind: 'componentInstance',
				componentId: 'hudReadout',
				x: 480,
				y: 420,
				params: { source: 'balance', fill: 0x7fd8ff },
			},
			{
				id: 'win-readout',
				kind: 'componentInstance',
				componentId: 'hudReadout',
				x: 480,
				y: 660,
				params: { source: 'win', fill: 0xffd54a, countUp: true },
			},
		],
	};

	onMount(() => {
		// balance: live ticking (tracks); win: one big jump (counts up).
		const tick = setInterval(() => balance.set(balance.get() + 137), 400);
		const jump = setTimeout(() => win.set(1_234_567), 800);
		return () => {
			clearInterval(tick);
			clearTimeout(jump);
		};
	});
</script>

<Story name="balance tracks + win counts up">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<LayoutScene {scene} />
		</StoryLocale>
	</StoryGameTemplate>
</Story>
