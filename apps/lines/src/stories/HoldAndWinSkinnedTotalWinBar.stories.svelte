<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/skinned total win bar (12c)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { Anchor, App, Container, resolveAnchor } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		TOTAL_WIN_BAR_ANCHOR,
		TOTAL_WIN_BAR_DEF,
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		registerComponentVisibility,
		type ComponentDef,
		type LayoutNode,
		type Scene,
	} from 'engine-layout';

	import TotalWinBarPart from '../components/TotalWinBarPart.svelte';
	import { setContext } from '../game/context';
	import { eventEmitter } from '../game/eventEmitter';
	import { FLIGHT_TARGET_TOTAL, totalTargetPoint } from '../game/flights.svelte';
	import { FLIGHT_TO_TOTAL } from '../game/holdAndWinFlights';

	setContext();

	/**
	 * Phase 12c — the Total Win Bar's coded part, three ways (one story each), beside a stand-in for
	 * the HUD's win meter at (150, 600):
	 * - the built-in placed as it ships: the coins still land on the win meter;
	 * - the built-in with `catchesCoins` and `landPulseScale: 1.3`: they land on the bar, which pulses;
	 * - a bar saved BEFORE the part existed, with `catchesCoins`: the part stands in and catches them.
	 * `window.__land()` lands one head in the total; `window.__probe()` reads where the next one would
	 * land, whether the bar's anchor is registered and the bar placement's on-screen width (the pulse).
	 */
	const fixed = <T,>(value: T) => ({
		subscribe: (run: (value: T) => void) => {
			run(value);
			return () => {};
		},
	});
	registerComponentValues({ featureTotal: fixed('$12.50') });
	registerComponentVisibility({ respinCounterShow: fixed(true) });

	const barPart = TOTAL_WIN_BAR_DEF.root.children[0] as LayoutNode & { kind: 'container' };
	const savedBefore: ComponentDef = {
		...TOTAL_WIN_BAR_DEF,
		id: 'barSavedBefore',
		root: { ...TOTAL_WIN_BAR_DEF.root, children: barPart.children },
	};
	registerComponents({ totalWinBar: TOTAL_WIN_BAR_DEF, barSavedBefore: savedBefore });
	registerBoundComponents({ TotalWinBarPart });

	type Params = Record<string, unknown>;
	const sceneOf = (componentId: string, params: Params = {}): Scene => ({
		id: componentId,
		name: componentId,
		nodes: [{ id: 'bar', kind: 'componentInstance', componentId, x: 700, y: 300, params }],
	});

	onMount(() => {
		Object.assign(window, {
			__land: () =>
				eventEmitter.broadcast({
					type: 'flightArrive',
					flight: FLIGHT_TO_TOTAL,
					target: FLIGHT_TARGET_TOTAL,
					index: 0,
				}),
			__probe: () => ({
				lands: totalTargetPoint() ?? null,
				caught: !!resolveAnchor(TOTAL_WIN_BAR_ANCHOR),
				width: resolveAnchor('bar')?.getBounds().width ?? null,
			}),
		});
	});
</script>

{#snippet stage(componentId: string, params?: Params)}
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<Container x={150} y={600}><Anchor name="hud-win" /></Container>
				<LayoutScene scene={sceneOf(componentId, params)} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<Story name="as it ships (win meter catches)">
	{@render stage('totalWinBar')}
</Story>

<Story name="catches the coins, pulses">
	{@render stage('totalWinBar', { catchesCoins: true, landPulseScale: 1.3 })}
</Story>

<Story name="saved before the part (stand-in catches)">
	{@render stage('barSavedBefore', { catchesCoins: true })}
</Story>
