<script lang="ts">
	import type { Snippet } from 'svelte';

	import './global.scss';
	import ConnectionOverlay from './ConnectionOverlay.svelte';
	import OperatorChrome from './OperatorChrome.svelte';

	type Props = {
		children: Snippet;
	};

	const props: Props = $props();
</script>

<!-- BEFORE the children, not beside the overlay: it registers the operator feeds, and an authored
HUD in the game resolves a feed name once, when it mounts — so the feeds must exist first. -->
<OperatorChrome />

{@render props.children()}

<!-- Here rather than beside the modals: this wraps <Authenticate> in every app, so a lost
connection is shown during boot too, before the game (and Pixi) exists. -->
<ConnectionOverlay />
