<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/FreeSpinCounter <ComponentInstance> mount (FS decompose slice 1)',
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
		FREE_SPIN_COUNTER_DEF,
		type Scene,
		type ValueSource,
		type BoolSource,
	} from 'engine-layout';

	import { setContext } from '../game/context';

	setContext();

	// Slice-1 proof: the `freeSpinCounter` def expands into its frame sprite +
	// caption + value text nodes, with the Value node bound (`text` → `value`) to a
	// STRING source so it shows "X OF Y" verbatim. A minimal string `ValueSource`
	// emitting "3 OF 10" stands in for the game's `freeSpins` feed (which reads
	// `stateUi.freeSpinCounterCurrent/Total`).
	const freeSpins: ValueSource = {
		subscribe(run) {
			run('3 OF 10');
			return () => {};
		},
	};

	// Slice-2a proof: a runes-backed `BoolSource` standing in for the game's
	// `freeSpinCounterShow` feed. `subscribe` emits synchronously then pushes every
	// flip; toggling `shown` (the `$state` the getter reads) hides/shows the WHOLE
	// instance via the `visibleSource` param.
	let shown = $state(true);
	const freeSpinCounterShow: BoolSource = {
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
	registerComponentValues({ freeSpins });
	registerComponentVisibility({ freeSpinCounterShow });
	registerComponents({ [FREE_SPIN_COUNTER_DEF.id]: FREE_SPIN_COUNTER_DEF });

	const scene: Scene = {
		id: 'fs-counter-proof',
		name: 'Free-spin counter',
		nodes: [
			{
				id: 'fs-counter-instance',
				kind: 'componentInstance',
				componentId: 'freeSpinCounter',
				x: 480,
				y: 320,
				params: { source: 'freeSpins', label: 'FREE SPIN' },
			},
		],
	};

	// Same def + sources, but the instance opts into the visibility feed via
	// `visibleSource: 'freeSpinCounterShow'` — so flipping `shown` hides/shows it.
	const visibilityScene: Scene = {
		id: 'fs-counter-visibility-proof',
		name: 'Free-spin counter (visibility feed)',
		nodes: [
			{
				id: 'fs-counter-visible-instance',
				kind: 'componentInstance',
				componentId: 'freeSpinCounter',
				x: 480,
				y: 320,
				params: {
					source: 'freeSpins',
					label: 'FREE SPIN',
					visibleSource: 'freeSpinCounterShow',
				},
			},
		],
	};

	const toggleShown = () => {
		shown = !shown;
	};
</script>

<Story name="frame + FREE SPIN + 3 OF 10 render">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene {scene} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
</Story>

<Story name="visibleSource hides + shows the instance">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene scene={visibilityScene} />
				<!-- Tap to flip the registered bool source: true → counter shows, false → it hides. -->
				<Text
					anchor={0.5}
					x={480}
					y={520}
					eventMode="static"
					cursor="pointer"
					text={`freeSpinCounterShow: ${shown} (tap to toggle)`}
					style={{ fontFamily: 'proxima-nova', fontSize: 24, fontWeight: '600', fill: 0x7fd8ff }}
					onpointerup={toggleShown}
				/>
			</App>
		</StoryLocale>
	</StoryGameTemplate>
</Story>
