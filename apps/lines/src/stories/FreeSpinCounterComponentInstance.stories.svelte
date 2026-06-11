<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/FreeSpinCounter <ComponentInstance> mount (FS decompose slice 1)',
	});
</script>

<script lang="ts">
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerComponents,
		registerComponentValues,
		clearComponentValues,
		FREE_SPIN_COUNTER_DEF,
		type Scene,
		type ValueSource,
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

	clearComponentValues();
	registerComponentValues({ freeSpins });
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
</script>

<Story name="frame + FREE SPIN + 3 OF 10 render">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<LayoutScene {scene} />
		</StoryLocale>
	</StoryGameTemplate>
</Story>
