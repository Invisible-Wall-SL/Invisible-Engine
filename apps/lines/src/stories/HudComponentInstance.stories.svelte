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
	import { UI, UiGameName, HudReadout } from 'components-ui-pixi';
	import {
		registerBoundComponents,
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

	// B4.4 proof (MOUNT path): the `hudReadout` def now MOUNTS the coded `HudReadout`
	// component (via a `bind` node in its `def.root`), reusing `UiLabel` + the coded
	// caption/currency-format/count-up. The HUD `<UI>`→`<LayoutEditable>` path mounts
	// a `<ComponentInstance>` for any `componentInstance` node in the bar scene. We
	// take the REAL `hudBarScene()` — now carrying the THREE converted readout nodes
	// (balance/win/bet as `componentInstance(hudReadout)`) — and add ONE extra SCRATCH
	// readout so we see an explicitly-styled instance too. Registers `hudReadout` +
	// the coded `HudReadout` bound component + a ticking `balance` source.
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
	const bet = makeStore(100);

	clearComponentValues();
	registerComponentValues({ balance: balance.source, win: win.source, bet: bet.source });
	registerComponents({ [HUD_READOUT_DEF.id]: HUD_READOUT_DEF });
	// The def MOUNTS this coded component (§14.3 MOUNT path) — register it so the
	// `bind` node in `def.root` resolves.
	registerBoundComponents({ HudReadout });

	// Real HUD bar (now carrying the three converted balance/win/bet readouts) +
	// ONE extra scratch readout placed in the bar (standard space). The scratch node
	// resolves its position from its own x/y transform via `hudPos()`, lands above
	// the bar, and reads the `balance` source with an explicit style override.
	const barWithScratch: Scene = (() => {
		const base = hudBarScene();
		return {
			...base,
			nodes: [
				...base.nodes,
				{
					id: 'hud-scratch-readout',
					label: 'Scratch readout (B4.4 proof)',
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
		const tick = setInterval(() => {
			balance.set(balance.get() + 137);
			win.set(win.get() + 50);
		}, 400);
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
