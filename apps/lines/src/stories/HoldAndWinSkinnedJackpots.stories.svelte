<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/skinned jackpot tiles (12c)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { App, resolveAnchor } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		JACKPOT_BAR_DEF,
		JACKPOT_TILE_DEF,
		PLATFORM_JACKPOT_BAR_DEF,
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		registerComponentVisibility,
		type ComponentDef,
		type LayoutNode,
		type Scene,
		type ValueSource,
	} from 'engine-layout';

	import JackpotTilePart from '../components/JackpotTilePart.svelte';
	import { setContext } from '../game/context';
	import { eventEmitter } from '../game/eventEmitter';

	setContext();

	/**
	 * Phase 12c — the Jackpot Tile's coded part, in both bars, each tile set to `winPulseScale: 1.3`.
	 * `window.__jackpotWin(tier)` fires a Hold and Win jackpot win, `window.__platformWin(tier)` the
	 * platform's; `window.__tileWidth(id)` reads a tile placement's on-screen width (`jackpotBar-major`,
	 * `platformJackpotBar-grand`), so a test can see that only the won tier's tile pulses.
	 */
	const fixed = (value: number): ValueSource => ({
		subscribe: (run) => {
			run(value);
			return () => {};
		},
	});
	registerComponentValues(
		Object.fromEntries(
			['mini', 'minor', 'major', 'grand'].flatMap((tier, index) => [
				[`jackpot.${tier}`, fixed(10 ** (index + 1))],
				[`platformJackpot.${tier}`, fixed(10 ** (index + 2))],
			]),
		),
	);
	registerComponentVisibility({
		platformJackpotShow: {
			subscribe: (run) => {
				run(true);
				return () => {};
			},
		},
	});

	const pulsing = (bar: ComponentDef): ComponentDef => ({
		...bar,
		root: {
			...bar.root,
			children: bar.root.children.map((tile): LayoutNode =>
				tile.kind === 'componentInstance'
					? { ...tile, params: { ...tile.params, winPulseScale: 1.3 } }
					: tile,
			),
		},
	});
	registerComponents({
		jackpotTile: JACKPOT_TILE_DEF,
		jackpotBar: pulsing(JACKPOT_BAR_DEF),
		platformJackpotBar: pulsing(PLATFORM_JACKPOT_BAR_DEF),
	});
	registerBoundComponents({ JackpotTilePart });

	const sceneOf = (componentId: string): Scene => ({
		id: componentId,
		name: componentId,
		nodes: [
			{
				id: componentId,
				kind: 'componentInstance',
				componentId,
				x: 600,
				y: 300,
				scale: { x: 0.8, y: 0.8 },
			},
		],
	});

	onMount(() => {
		Object.assign(window, {
			__jackpotWin: (tier: string) =>
				eventEmitter.broadcast({
					type: 'respinJackpotWin',
					tier,
					amount: 100,
					source: 'coin',
					banked: false,
					scope: `tier:${tier}`,
				}),
			__platformWin: (tier: string) =>
				eventEmitter.broadcast({
					type: 'platformJackpotCelebration',
					tier,
					amount: 100,
					scope: `tier:${tier.toLowerCase()}`,
				}),
			__tileWidth: (id: string) => resolveAnchor(id)?.getBounds().width ?? null,
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

<Story name="jackpot bar">
	{@render stage('jackpotBar')}
</Story>

<Story name="platform jackpot bar">
	{@render stage('platformJackpotBar')}
</Story>
