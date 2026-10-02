<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/Value bindings (Hold and Win 12b)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { App } from 'pixi-svelte';
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

	/**
	 * Phase 12b — ONE pot def placed twice (meters `red` and `blue`), every number read through a
	 * `{meter}` placeholder so each pot follows its own meter: the liquid FILLS from the bottom
	 * (normalised level), a marker RISES with it, a badge SHOWS only when full, and the H1 rig GROWS
	 * by a bone and scrubs its animation with the level. The levels step on their own; a test can
	 * also set them through `window.__setPotLevel(id, level)`.
	 */
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

	const MAX = 12;
	const meters = { red: makeStore(3), blue: makeStore(9) };
	const fulls = { red: makeStore(0), blue: makeStore(0) };
	clearComponentValues();
	registerComponentValues(
		Object.fromEntries(
			(['red', 'blue'] as const).flatMap((id) => [
				[`meter.${id}.level`, meters[id].source],
				[`meter.${id}.max`, makeStore(MAX).source],
				[`meter.${id}.full`, fulls[id].source],
			]),
		),
	);
	const setLevel = (id: 'red' | 'blue', level: number) => {
		meters[id].set(level);
		fulls[id].set(level >= MAX ? 1 : 0);
	};

	const level = { source: 'meter.{meter}.level', of: 'meter.{meter}.max' };
	const pot: ComponentDef = {
		id: 'valueBoundPot',
		name: 'Value-bound pot',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: {
			id: 'pot-root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{ id: 'pot-glass', kind: 'rect', x: 0, y: 0, width: 160, height: 260, color: 0x222233 },
				{
					id: 'pot-liquid',
					kind: 'rect',
					x: 0,
					y: 0,
					width: 140,
					height: 240,
					color: 0x30b0e0,
					valueBindings: [{ target: 'fill', ...level, direction: 'up' }],
				},
				{
					id: 'pot-marker',
					kind: 'rect',
					x: 110,
					y: 120,
					width: 30,
					height: 8,
					color: 0xff4060,
					valueBindings: [{ target: 'y', ...level, outMin: 0, outMax: -240, smooth: 0.3 }],
				},
				{
					id: 'pot-full',
					kind: 'rect',
					x: 0,
					y: -170,
					width: 120,
					height: 40,
					color: 0xffd54a,
					valueBindings: [{ target: 'visible', source: 'meter.{meter}.full' }],
				},
				{
					id: 'pot-frog',
					kind: 'spine',
					assetKey: 'H1',
					defaultAnimation: 'h1_static',
					x: 0,
					y: 330,
					scale: { x: 0.1, y: 0.1 },
					valueBindings: [
						{
							target: 'bone',
							...level,
							bone: 'global',
							boneProperty: 'scale',
							outMin: 1,
							outMax: 1.5,
						},
						{ target: 'animTime', ...level, animation: 'h1', track: 1 },
					],
				},
			],
		},
		params: [{ key: 'meter', kind: 'string', default: 'red' }],
	};
	registerComponents({ valueBoundPot: pot });

	const scene: Scene = {
		id: 'value-bindings',
		name: 'Value bindings',
		nodes: [
			{
				id: 'pot-red',
				kind: 'componentInstance',
				componentId: 'valueBoundPot',
				x: 300,
				y: 300,
				params: { meter: 'red' },
			},
			{
				id: 'pot-blue',
				kind: 'componentInstance',
				componentId: 'valueBoundPot',
				x: 700,
				y: 300,
				params: { meter: 'blue' },
			},
		],
	};

	onMount(() => {
		(window as { __setPotLevel?: typeof setLevel }).__setPotLevel = setLevel;
		const params = new URLSearchParams(window.location.search);
		if (params.has('still')) return;
		const tick = setInterval(() => {
			setLevel('red', (meters.red.get() + 1) % (MAX + 1));
			setLevel('blue', (meters.blue.get() + 1) % (MAX + 1));
		}, 900);
		return () => clearInterval(tick);
	});
</script>

<Story name="two pots, one def">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene {scene} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
</Story>
