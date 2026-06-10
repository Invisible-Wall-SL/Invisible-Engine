<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/Button <ComponentInstance> mount (B6.3)',
	});
</script>

<script lang="ts">
	import { i18n } from '@lingui/core';
	import { Text } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate, StoryPixiApp } from 'components-storybook';
	import { ButtonFrame, ButtonLabel } from 'components-ui-pixi';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerBoundComponents,
		registerComponents,
		registerComponentActions,
		clearComponentActions,
		BUTTON_DEF,
		type BoolSource,
		type Scene,
	} from 'engine-layout';

	import { setContext } from '../game/context';
	import assets from '../game/assets';

	setContext();

	// Activate the locale BEFORE first render: `ButtonLabel` translates inside its
	// template, which runs before any `onMount` — `StoryLocale`'s mount-time
	// `i18n.activate` is too late and the label part throws on a cold story load.
	i18n.load('en', {});
	i18n.activate('en');

	// B6.3 proof (full chain, ONE scratch node): a hand-written `componentInstance`
	// of `BUTTON_DEF` expands → `ButtonFrame` (the tile + hit area) + `ButtonLabel`
	// (the localized "menu" glyph). Pressing the frame fires the registered `menu`
	// `onpress`; toggling the `disabled` `BoolSource` greys the frame. Nothing here
	// touches the live HUD scenes — it is a STORY only (mirrors the readout's B4.3/
	// B4.4 proof pattern).

	// A hand-rolled boolean store satisfying the `BoolSource` `subscribe` contract
	// (sync emit on subscribe + an unsubscribe fn) — the boolean sibling of the
	// readout story's `makeStore`. Drives the action feed's `disabled` flag so the
	// story can toggle it and watch `ButtonFrame` grey out.
	const makeBoolStore = (initial: boolean) => {
		let value = initial;
		const subscribers = new Set<(v: boolean) => void>();
		const source: BoolSource = {
			subscribe(run) {
				run(value);
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
		};
		const set = (next: boolean) => {
			value = next;
			for (const run of subscribers) run(value);
		};
		return { source, set, get: () => value };
	};

	const disabled = makeBoolStore(false);
	// Mirror the store into a rune so the on-canvas toggle label re-renders; the
	// engine path reads the store directly via its `subscribe` contract (the rune is
	// only for the story's own readout Text).
	let disabledLabel = $state(false);
	let presses = $state(0);
	const toggleDisabled = () => {
		disabled.set(!disabled.get());
		disabledLabel = disabled.get();
	};

	// State-image proof stores: a second action whose `disabled` (downstate) and
	// `active` (selected) flags the story toggles to watch the bg image swap.
	const statesDisabled = makeBoolStore(false);
	const statesActive = makeBoolStore(false);
	let statesDisabledLabel = $state(false);
	let statesActiveLabel = $state(false);
	let statePresses = $state(0);
	const toggleStatesDisabled = () => {
		statesDisabled.set(!statesDisabled.get());
		statesDisabledLabel = statesDisabled.get();
	};
	const toggleStatesActive = () => {
		statesActive.set(!statesActive.get());
		statesActiveLabel = statesActive.get();
	};

	clearComponentActions();
	registerComponents({ [BUTTON_DEF.id]: BUTTON_DEF });
	// The def MOUNTS these two coded parts — register them so the `bind` nodes in
	// `def.root` resolve (the button analogue of the readout's `HudReadout`).
	registerBoundComponents({ ButtonFrame, ButtonLabel });
	// `menu`: a trivial `onpress` bumps a counter; `disabled` is the toggleable store
	// above. No `active` flag (like the coded menu button). `turbo`: the state-image
	// story's action — same press counter pattern plus an `active` flag, so the
	// `imageSelected`/`imageDisabled` swaps are observable.
	registerComponentActions({
		menu: {
			onpress: () => (presses += 1),
			disabled: disabled.source,
		},
		turbo: {
			onpress: () => (statePresses += 1),
			disabled: statesDisabled.source,
			active: statesActive.source,
		},
	});

	// ONE scratch button node, centred — a `componentInstance` of `button` whose
	// `action: 'menu'` binds the registered action and `icon: 'menu'` localizes the
	// label glyph. Placed via `<LayoutScene>` so the whole def-expansion chain runs
	// exactly as in-game (no `<UI>`/HUD coupling).
	const scene: Scene = {
		id: 'button-scratch',
		name: 'Scratch button (B6.3 proof)',
		nodes: [
			{
				id: 'btn-scratch',
				label: 'Scratch button',
				kind: 'componentInstance',
				componentId: 'button',
				x: 960,
				y: 540,
				params: { action: 'menu', icon: 'menu' },
			},
		],
	};

	// State-image proof: the SAME def, but the instance authors the per-state bg
	// images (the `image*` params — distinct symbol frames from `symbolsStatic`, so
	// each state is unmistakable): h1 resting, h2 hover, h3 pressed, s selected
	// (active), l1 downstate (disabled). Hover/press the button + tap the toggles to
	// watch `ButtonFrame` swap the bg sprite. Mounted via `StoryPixiApp` (its OWN
	// `<App>` + just the one atlas) in a `canvas`-space scene — the game-template
	// harness above provides no `<App>`, so it can't show a live render.
	const stateStoryAssets = { symbolsStatic: { ...assets.symbolsStatic, preload: true } };
	const statesScene: Scene = {
		id: 'button-states',
		name: 'Button state images',
		space: 'canvas',
		nodes: [
			{
				id: 'btn-states',
				label: 'States button',
				kind: 'componentInstance',
				componentId: 'button',
				x: 600,
				y: 260,
				params: {
					action: 'turbo',
					icon: 'turbo',
					image: 'h1.webp',
					imageHover: 'h2.webp',
					imagePressed: 'h3.webp',
					imageSelected: 's.png',
					imageDisabled: 'l1.webp',
				},
			},
		],
	};
</script>

<Story name="scratch button mounts + presses + greys">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<LayoutScene {scene} />
			<!-- Press counter + disabled toggle, so the proof is observable on canvas. -->
			<Text
				anchor={0.5}
				x={960}
				y={700}
				text={`presses: ${presses}`}
				style={{ fontFamily: 'proxima-nova', fontSize: 28, fontWeight: '600', fill: 0xffffff }}
			/>
			<Text
				anchor={0.5}
				x={960}
				y={750}
				eventMode="static"
				cursor="pointer"
				text={`disabled: ${disabledLabel} (tap to toggle)`}
				style={{ fontFamily: 'proxima-nova', fontSize: 24, fontWeight: '600', fill: 0x7fd8ff }}
				onpointerup={toggleDisabled}
			/>
		</StoryLocale>
	</StoryGameTemplate>
</Story>

<Story name="state images swap the bg (hover / pressed / selected / downstate)">
	<StoryPixiApp assets={stateStoryAssets}>
		<StoryLocale lang="en">
			<LayoutScene scene={statesScene} />
			<Text
				anchor={0.5}
				x={600}
				y={420}
				text={`presses: ${statePresses} — hover = h2, press = h3`}
				style={{ fontFamily: 'proxima-nova', fontSize: 28, fontWeight: '600', fill: 0xffffff }}
			/>
			<Text
				anchor={0.5}
				x={600}
				y={470}
				eventMode="static"
				cursor="pointer"
				text={`selected (active): ${statesActiveLabel} → s.png (tap to toggle)`}
				style={{ fontFamily: 'proxima-nova', fontSize: 24, fontWeight: '600', fill: 0x7fd8ff }}
				onpointerup={toggleStatesActive}
			/>
			<Text
				anchor={0.5}
				x={600}
				y={520}
				eventMode="static"
				cursor="pointer"
				text={`downstate (disabled): ${statesDisabledLabel} → l1.webp (tap to toggle)`}
				style={{ fontFamily: 'proxima-nova', fontSize: 24, fontWeight: '600', fill: 0x7fd8ff }}
				onpointerup={toggleStatesDisabled}
			/>
		</StoryLocale>
	</StoryPixiApp>
</Story>
