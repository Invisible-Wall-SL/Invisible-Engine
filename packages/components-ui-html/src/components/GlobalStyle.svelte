<script lang="ts">
	import type { Snippet } from 'svelte';

	import './global.scss';
	import ConnectionOverlay from './ConnectionOverlay.svelte';

	type Props = {
		children: Snippet;
	};

	const props: Props = $props();
</script>

{@render props.children()}

<!-- Here rather than beside the modals: this wraps <Authenticate> in every app, so a lost
connection is shown during boot too, before the game (and Pixi) exists. -->
<ConnectionOverlay />
