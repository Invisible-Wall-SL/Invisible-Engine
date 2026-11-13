<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type Props = {
		/** Whether the content has been shown: false while it is mounted ahead, true from its first
		 *  show on. The getter is taken once, at mount. */
		shown: () => boolean;
		children: Snippet;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';

	import { setContextDormantScope, setContextRestart } from '../context.svelte';

	/**
	 * Content mounted AHEAD of its first show, outside a `<LayoutScene dormant>`: until `shown`, it is
	 * dormant (`setContextDormant`) — its rigs put away, its machines not started, what starts a clock
	 * of its own not mounted — and its first show changes the restart key it hands down
	 * (`setContextRestart`), so it starts there as a mount at that moment would. Adds no container:
	 * the content hides itself (a `<LayoutScene>` from the context; anything else by its caller).
	 */
	const props: Props = $props();
	const shown = untrack(() => props.shown);
	setContextDormantScope(() => !shown());
	setContextRestart(() => shown());
</script>

{@render props.children()}
