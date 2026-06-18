<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/InfoBar <ComponentInstance> mount (toast → editor-native)',
	});
</script>

<script lang="ts">
	import { App, Text } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerComponents,
		registerComponentValues,
		clearComponentValues,
		registerComponentVisibility,
		clearComponentVisibility,
		INFO_BAR_DEF,
		type Scene,
		type ValueSource,
		type BoolSource,
	} from 'engine-layout';

	import { setContext } from '../game/context';

	setContext();

	// The `infoBar` def expands into its background sprite + Message text node, with
	// the text bound (`text` → `value`) to a STRING source so it renders the toast
	// text verbatim. A minimal string `ValueSource` stands in for the game's `message`
	// feed (which reads `stateMessage.current?.text`). No `background` param is set, so
	// the sprite resolves no texture — the bar renders text-only (the no-asset path).
	const message: ValueSource = {
		subscribe(run) {
			run('Win $1.00 — 2 of a kind');
			return () => {};
		},
	};

	// A runes-backed `BoolSource` standing in for the game's `messageShow` feed (true
	// while a message is active). Toggling `shown` hides/shows the WHOLE bar via the
	// `visibleSource` param — the engine-layout equivalent of the toast's auto-clear.
	let shown = $state(true);
	const messageShow: BoolSource = {
		subscribe(run) {
			run(shown);
			return $effect.root(() => {
				$effect(() => {
					run(shown);
				});
			});
		},
	};

	clearComponentValues();
	clearComponentVisibility();
	registerComponentValues({ message });
	registerComponentVisibility({ messageShow });
	registerComponents({ [INFO_BAR_DEF.id]: INFO_BAR_DEF });

	const scene: Scene = {
		id: 'info-bar-proof',
		name: 'Info bar',
		nodes: [
			{
				id: 'info-bar-instance',
				kind: 'componentInstance',
				componentId: 'infoBar',
				x: 480,
				y: 200,
				params: { source: 'message' },
			},
		],
	};

	// Same def + sources, but the instance opts into the visibility feed via
	// `visibleSource: 'messageShow'` — so flipping `shown` hides/shows it.
	const visibilityScene: Scene = {
		id: 'info-bar-visibility-proof',
		name: 'Info bar (visibility feed)',
		nodes: [
			{
				id: 'info-bar-visible-instance',
				kind: 'componentInstance',
				componentId: 'infoBar',
				x: 480,
				y: 200,
				params: { source: 'message', visibleSource: 'messageShow' },
			},
		],
	};

	const toggleShown = () => {
		shown = !shown;
	};
</script>

<Story name="message text renders">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene {scene} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
</Story>

<Story name="visibleSource hides + shows the bar">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene scene={visibilityScene} />
				<!-- Tap to flip the registered bool source: true → bar shows, false → it hides. -->
				<Text
					anchor={0.5}
					x={480}
					y={400}
					eventMode="static"
					cursor="pointer"
					text={`messageShow: ${shown} (tap to toggle)`}
					style={{ fontFamily: 'proxima-nova', fontSize: 24, fontWeight: '600', fill: 0x7fd8ff }}
					onpointerup={toggleShown}
				/>
			</App>
		</StoryLocale>
	</StoryGameTemplate>
</Story>
