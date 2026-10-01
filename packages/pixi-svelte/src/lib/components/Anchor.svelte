<script lang="ts" module>
	export type Props = {
		/** The name code resolves this anchor by (`resolveAnchor` / `resolveAnchorPoint`). */
		name: string;
	};
</script>

<script lang="ts">
	import { getContextParent } from '../context.svelte';
	import { registerAnchor } from '../anchors';

	/**
	 * Registers the container this is mounted in under `name` (see `anchors.ts`). Renders nothing
	 * and adds no child.
	 */
	const props: Props = $props();
	const parentContext = getContextParent();

	$effect(() => registerAnchor(props.name, parentContext.parent));
</script>
