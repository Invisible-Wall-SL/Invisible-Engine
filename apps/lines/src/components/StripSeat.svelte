<script lang="ts">
	import { getContextParent } from 'pixi-svelte';

	import type { ReelStripView } from '../game/reelStripView.svelte';

	type Props = {
		strip: ReelStripView;
		/** The strip cell the enclosing container draws. */
		cell: { symbolIndex: number };
	};

	const props: Props = $props();

	/**
	 * Hands the enclosing `SymbolWrap` container to its reel's strip view, which writes its `y` from
	 * the reel's drawn position (`reelStripView.svelte.ts`): placed at once, then on every drawn
	 * value, and again whenever the cell is renumbered or the view is handed another cell.
	 */
	const container = getContextParent().parent;
	$effect.pre(() => {
		void props.cell.symbolIndex;
		return props.strip.attach(container, props.cell);
	});
</script>
