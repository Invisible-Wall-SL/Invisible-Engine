<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/Button <ComponentInstance> mount (B6.3)',
	});
</script>

<script lang="ts">
	import { Text } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
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

	setContext();

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

	clearComponentActions();
	registerComponents({ [BUTTON_DEF.id]: BUTTON_DEF });
	// The def MOUNTS these two coded parts — register them so the `bind` nodes in
	// `def.root` resolve (the button analogue of the readout's `HudReadout`).
	registerBoundComponents({ ButtonFrame, ButtonLabel });
	// One named action: `menu`. A trivial `onpress` bumps a counter; `disabled` is the
	// toggleable store above. No `active` flag (like the coded menu button).
	registerComponentActions({
		menu: {
			onpress: () => (presses += 1),
			disabled: disabled.source,
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
