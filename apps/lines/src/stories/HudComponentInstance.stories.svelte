<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/HUD <ComponentInstance> mount (B4.3)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { Text, REM } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { UI, UiGameName } from 'components-ui-pixi';
	import {
		registerComponents,
		registerComponentValues,
		clearComponentValues,
		HUD_READOUT_DEF,
		hudBarScene,
		hudCornersScene,
		type Scene,
		type ValueSource,
	} from 'engine-layout';

	import { setContext } from '../game/context';

	setContext();

	// B4.3 proof: the HUD `<UI>`→`<LayoutEditable>` path now mounts a
	// `<ComponentInstance>` for any `componentInstance` node in the bar scene. We
	// take the REAL `hudBarScene()` (coded Balance/Win/Bet labels + buttons render
	// exactly as in-game) and add ONE SCRATCH `componentInstance(hudReadout)` so we
	// see the engine path mount alongside the coded snippets — without touching the
	// live scene. Registers `hudReadout` + a ticking `balance` source so the
	// readout shows a LIVE value through the engine value feed.
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

	clearComponentValues();
	registerComponentValues({ balance: balance.source });
	registerComponents({ [HUD_READOUT_DEF.id]: HUD_READOUT_DEF });

	// Real HUD bar + ONE scratch readout placed in the bar (standard space). It
	// resolves its position from its own x/y transform via `hudPos()`, lands above
	// the coded labels, and reads the `balance` source through the value feed.
	const barWithScratch: Scene = (() => {
		const base = hudBarScene();
		return {
			...base,
			nodes: [
				...base.nodes,
				{
					id: 'hud-scratch-readout',
					label: 'Scratch readout (B4.3 proof)',
					kind: 'componentInstance',
					componentId: 'hudReadout',
					x: 960,
					y: 560,
					scale: { x: 0.8, y: 0.8 },
					params: { source: 'balance', label: 'BALANCE', fill: 0x7fd8ff },
				},
			],
		};
	})();

	const corners = hudCornersScene();

	onMount(() => {
		const tick = setInterval(() => balance.set(balance.get() + 137), 400);
		return () => clearInterval(tick);
	});
</script>

<Story name="scratch readout mounts in the HUD bar">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<UI hud={{ bar: barWithScratch, corners }}>
				{#snippet gameName(override)}
					<UiGameName name="LINES GAME" {override} />
				{/snippet}
				{#snippet logo(override)}
					<Text
						anchor={{ x: 1, y: 0 }}
						text={override?.text ?? 'ADD YOUR LOGO'}
						style={{
							fontFamily: 'proxima-nova',
							fontSize: REM * 1.5,
							fontWeight: '600',
							lineHeight: REM * 2,
							fill: 0xffffff,
							...override?.style,
						}}
					/>
				{/snippet}
			</UI>
		</StoryLocale>
	</StoryGameTemplate>
</Story>
