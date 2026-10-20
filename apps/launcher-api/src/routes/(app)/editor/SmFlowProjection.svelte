<script lang="ts">
	/**
	 * Rendered INSIDE the state machine's `<SvelteFlow>` so it can reach `useSvelteFlow()` (the panel,
	 * the flow's parent, cannot): it hands the panel the page-pixel → graph mapping a drop needs (a
	 * timeline dragged from the Animations list lands as a state where it is dropped).
	 */
	import { useSvelteFlow } from '@xyflow/svelte';

	interface Props {
		onReady: (toFlow: (point: { x: number; y: number }) => { x: number; y: number }) => void;
	}
	let { onReady }: Props = $props();

	const { screenToFlowPosition } = useSvelteFlow();
	$effect(() => onReady((point) => screenToFlowPosition(point)));
</script>
