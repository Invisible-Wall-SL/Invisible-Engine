<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/<ComponentInstance>',
	});
</script>

<script lang="ts">
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import { registerComponents } from 'engine-layout';
	import type { ComponentDef, ContainerNode, Scene } from 'engine-layout';

	import { setContext } from '../game/context';

	setContext();

	// A reusable sub-tree: a centred board-frame sprite + a caption. Factory so the
	// inline `container` and the component's `root` are STRUCTURALLY identical but
	// carry distinct, stable ids (ids must be unique within one rendered scene).
	const makeRoot = (idPrefix: string): ContainerNode => ({
		id: `${idPrefix}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: `${idPrefix}-frame`,
				kind: 'sprite',
				assetKey: 'frame_bg.png',
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 0,
				width: 360,
				height: 360,
			},
			{
				id: `${idPrefix}-caption`,
				kind: 'text',
				text: idPrefix === 'inline' ? 'INLINE CONTAINER' : 'COMPONENT INSTANCE',
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 230,
				style: { fontFamily: 'proxima-nova', fontSize: 20, fontWeight: '600', fill: 0xffffff },
			},
		],
	});

	// Register a ComponentDef whose `root` IS that same sub-tree. The instance must
	// render byte-identical to inlining the container — `<ComponentInstance>` reuses
	// `<LayoutNodeView>` on `def.root`, i.e. the exact `container` render branch.
	const def: ComponentDef = {
		id: 'parityCard',
		name: 'Parity Card',
		version: 1,
		scope: 'project',
		category: 'scenery',
		root: makeRoot('instanced'),
	};
	registerComponents({ parityCard: def });

	// One scene, the same sub-tree two ways, side by side. Left = inline container;
	// right = componentInstance of `parityCard`. They must look identical.
	const parityScene: Scene = {
		id: 'parity',
		name: 'Inline vs Instanced',
		nodes: [
			{ ...makeRoot('inline'), x: 480, y: 540 },
			{
				id: 'instance',
				kind: 'componentInstance',
				componentId: 'parityCard',
				x: 960,
				y: 540,
			},
		],
	};

	// A component instancing ITSELF — proves the cycle guard renders nothing (and
	// warns once) instead of recursing forever.
	const selfRef: ComponentDef = {
		id: 'selfRef',
		name: 'Self Reference',
		version: 1,
		scope: 'project',
		category: 'scenery',
		root: {
			id: 'selfRef-root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{ id: 'selfRef-inner', kind: 'componentInstance', componentId: 'selfRef', x: 0, y: 0 },
			],
		},
	};
	registerComponents({ selfRef });

	const cycleScene: Scene = {
		id: 'cycle',
		name: 'Cycle guard',
		nodes: [
			{ id: 'cycle-instance', kind: 'componentInstance', componentId: 'selfRef', x: 720, y: 540 },
		],
	};
</script>

<Story name="inline == instanced (parity)">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<LayoutScene scene={parityScene} />
		</StoryLocale>
	</StoryGameTemplate>
</Story>

<Story name="cycle guard (renders nothing)">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<LayoutScene scene={cycleScene} />
		</StoryLocale>
	</StoryGameTemplate>
</Story>
