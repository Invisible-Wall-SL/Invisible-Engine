<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/skinned respin counter (12c)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { App, resolveAnchor, resolveAnchorPoint } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { isComponentMounted, LayoutScene } from 'engine-layout/svelte';
	import {
		RESPIN_COUNTER_ANCHOR,
		RESPIN_COUNTER_DEF,
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		registerComponentVisibility,
		type ComponentDef,
		type LayoutNode,
		type Scene,
	} from 'engine-layout';

	import RespinCounterPart from '../components/RespinCounterPart.svelte';
	import { setContext } from '../game/context';
	import { stateRespinBoard } from '../game/stateRespinBoard.svelte';

	setContext();

	/**
	 * Phase 12c — the Respin Counter's coded part, three ways (one story each, so one counter
	 * registers the `respinCounter` anchor at a time):
	 * - the built-in: its frame, caption and value inside the `Counter` part, pulsing at 1.35;
	 * - a counter saved BEFORE the part existed (its nodes at the root): the part stands in;
	 * - a part with nothing inside: the coded counter.
	 * `window.__counterPulse()` fires a reset (counter 3 → 3, pulses); `window.__counterProbe()` reads
	 * where the "+N" lands, the anchored container's scale (the pulse) and whether the coded default
	 * would step aside.
	 */
	stateRespinBoard.counter.show = true;
	stateRespinBoard.counter.left = 3;
	stateRespinBoard.counter.start = 3;

	const counterPart = RESPIN_COUNTER_DEF.root.children[0] as LayoutNode & { kind: 'container' };
	const savedBefore: ComponentDef = {
		...RESPIN_COUNTER_DEF,
		id: 'counterSavedBefore',
		root: { ...RESPIN_COUNTER_DEF.root, children: counterPart.children },
	};
	const emptyPart: ComponentDef = {
		...RESPIN_COUNTER_DEF,
		id: 'counterEmptyPart',
		root: { ...RESPIN_COUNTER_DEF.root, children: [{ ...counterPart, children: [] }] },
	};
	registerComponents({
		respinCounter: RESPIN_COUNTER_DEF,
		counterSavedBefore: savedBefore,
		counterEmptyPart: emptyPart,
	});
	registerBoundComponents({ RespinCounterPart });
	registerComponentValues({
		respinsLeft: {
			subscribe: (run) => {
				run(stateRespinBoard.counter.left);
				return () => {};
			},
		},
	});
	registerComponentVisibility({
		respinCounterShow: {
			subscribe: (run) => {
				run(true);
				return () => {};
			},
		},
	});

	const sceneOf = (componentId: string): Scene => ({
		id: componentId,
		name: componentId,
		nodes: [
			{
				id: 'counter',
				kind: 'componentInstance',
				componentId,
				x: 600,
				y: 300,
				params: { pulseScale: 1.35 },
			},
		],
	});

	onMount(() => {
		Object.assign(window, {
			__counterPulse: () => (stateRespinBoard.counter.resets += 1),
			__counterProbe: () => ({
				anchor: resolveAnchorPoint(RESPIN_COUNTER_ANCHOR) ?? null,
				scale: resolveAnchor(RESPIN_COUNTER_ANCHOR)?.scale.x ?? null,
				counted: isComponentMounted(RESPIN_COUNTER_ANCHOR),
			}),
		});
	});
</script>

{#snippet stage(componentId: string)}
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene scene={sceneOf(componentId)} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<Story name="built-in, nodes inside the part">
	{@render stage('respinCounter')}
</Story>

<Story name="saved before the part (stand-in)">
	{@render stage('counterSavedBefore')}
</Story>

<Story name="nothing inside the part (coded counter)">
	{@render stage('counterEmptyPart')}
</Story>
