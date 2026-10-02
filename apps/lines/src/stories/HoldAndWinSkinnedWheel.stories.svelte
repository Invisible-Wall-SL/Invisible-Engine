<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/skinned wheel (12c)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { App, resolveAnchor } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { isComponentMounted, LayoutScene } from 'engine-layout/svelte';
	import {
		WHEEL_DEF,
		WHEEL_MOUNT,
		registerBoundComponents,
		registerComponents,
		type ComponentDef,
		type LayoutNode,
		type Scene,
	} from 'engine-layout';
	import type { HoldAndWinWheelPrize } from 'engine-game';

	import HoldAndWinWheelPart from '../components/HoldAndWinWheelPart.svelte';
	import { setContext } from '../game/context';
	import { showWheel, spinWheelTo, wheelRotation } from '../game/holdAndWinWheel.svelte';

	setContext();

	/**
	 * Phase 12c — the Wheel's skin, on the Hotfire preset's seven prizes (one story each):
	 * - the built-in as it ships: the coded wheel;
	 * - a copy (`myWheel`) with art params: a face that turns, a rim and a pointer that stay put, the
	 *   labels off;
	 * - a copy with a "★" node inside the part, which must turn with the face.
	 * `window.__spin(segment)` spins onto a segment; `window.__probe()` reads the rotation, whether the
	 * coded wheel would step aside, the labels drawn, the drawn art (count and bounds) and where the
	 * "★" is.
	 */
	const PRIZES: HoldAndWinWheelPrize[] = [
		{ type: 'coinBoost', multiplier: 2 },
		{ type: 'extraCollect', count: 1 },
		{ type: 'extraCollect', count: 2 },
		{ type: 'jackpot', jackpot: 'MINI' },
		{ type: 'jackpot', jackpot: 'MINOR' },
		{ type: 'jackpot', jackpot: 'MAJOR' },
		{ type: 'jackpot', jackpot: 'GRAND' },
	];

	const wheelPart = WHEEL_DEF.root.children[0] as LayoutNode & { kind: 'container' };
	const starWheel: ComponentDef = {
		...WHEEL_DEF,
		id: 'starWheel',
		root: {
			...WHEEL_DEF.root,
			children: [
				{
					...wheelPart,
					children: [
						{
							id: 'starWheel-star',
							kind: 'text',
							x: 0,
							y: -150,
							anchor: { x: 0.5, y: 0.5 },
							text: '★',
							style: { fontSize: 48, fill: 0xffe14a },
						},
					],
				},
			],
		},
	};
	registerComponents({
		wheel: WHEEL_DEF,
		myWheel: { ...WHEEL_DEF, id: 'myWheel' },
		starWheel,
	});
	registerBoundComponents({ HoldAndWinWheelPart });

	type Params = Record<string, unknown>;
	const sceneOf = (componentId: string, params: Params = {}): Scene => ({
		id: componentId,
		name: componentId,
		nodes: [{ id: 'wheel', kind: 'componentInstance', componentId, x: 600, y: 360, params }],
	});
	const ART = {
		faceImage: 'progressBarBackground.png',
		rimImage: 'progressBarFrame.png',
		pointerImage: 'progressBar.png',
		showLabels: false,
	};

	type Node = NonNullable<ReturnType<typeof resolveAnchor>>;
	const walk = (node: Node): Node[] =>
		node.children.flatMap((child: Node) => [child, ...walk(child)]);
	const isText = (node: Node): node is Node & { text: string } =>
		'text' in node && typeof node.text === 'string';

	onMount(() => {
		showWheel(PRIZES);
		Object.assign(window, {
			__spin: (segment: number) => spinWheelTo(segment),
			__probe: () => {
				const root = resolveAnchor('wheel');
				const all = root ? walk(root) : [];
				const star = all.find((node) => isText(node) && node.text === '★');
				const at = star?.getGlobalPosition();
				return {
					rotation: Math.round(wheelRotation.current * 1000) / 1000,
					counted: isComponentMounted(WHEEL_MOUNT),
					labels: all.filter((node) => isText(node) && node.text !== '★').length,
					sprites: all.filter((node) => !isText(node) && 'texture' in node).length,
					boxes: all
						.filter((node) => !isText(node) && 'texture' in node)
						.map((node) => {
							const box = node.getBounds();
							return [box.x, box.y, box.width, box.height].map(Math.round);
						}),
					star: at ? { x: Math.round(at.x), y: Math.round(at.y) } : null,
				};
			},
		});
	});
</script>

{#snippet stage(componentId: string, params?: Params)}
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene scene={sceneOf(componentId, params)} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<Story name="as it ships (coded wheel)">
	{@render stage('wheel')}
</Story>

<Story name="a copy with art params">
	{@render stage('myWheel', ART)}
</Story>

<Story name="a node inside the part">
	{@render stage('starWheel')}
</Story>
