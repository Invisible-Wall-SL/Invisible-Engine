<script lang="ts">
	import CanvasSizeRectangle from './CanvasSizeRectangle.svelte';
	import { createPressStarts } from '../pressStarts';

	type Props = {
		onpress: () => void;
	};

	const props: Props = $props();

	// Only a press that STARTED on this rect counts — the release of one already in progress when it
	// mounted is not a tap on it (see `pressStarts.ts`).
	const presses = createPressStarts<true>();
</script>

<CanvasSizeRectangle
	onpointerdown={(e) => presses.down(e.pointerId, true)}
	onpointerup={(e) => {
		if (presses.up(e.pointerId)) props.onpress();
	}}
	onpointerupoutside={(e) => presses.cancel(e.pointerId)}
	cursor="pointer"
	eventMode="static"
	backgroundColor={0xffffff}
	backgroundAlpha={0.001}
/>
