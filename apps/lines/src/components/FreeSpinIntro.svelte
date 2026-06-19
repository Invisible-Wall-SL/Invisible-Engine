<script lang="ts" module>
	export type EmitterEventFreeSpinIntro =
		| { type: 'freeSpinIntroShow' }
		| { type: 'freeSpinIntroHide' }
		| { type: 'freeSpinIntroUpdate'; totalFreeSpins: number };
</script>

<script lang="ts">
	// OFF-path composer (§17 Phase 3 parity): mounts the full-screen GATE (dim + press +
	// round-await) and the board-relative VISUAL together, the visual self-centring on the
	// board (`boundToInstance={false}`) — render-equivalent to the pre-split standalone
	// intro. The ON path mounts the gate (`FreeSpinIntroGate`) and an editor-positioned
	// `freeSpinIntroVisual` componentInstance as SEPARATE scene nodes instead (gated by
	// `FREE_SPIN_OVERLAY_INSTANCES`, see editor-scenes). Both gate + visual subscribe to
	// the `freeSpinIntro*` events independently, so behaviour is identical either way.
	import FreeSpinIntroGate from './FreeSpinIntroGate.svelte';
	import FreeSpinIntroVisual from './FreeSpinIntroVisual.svelte';

	const props: {
		introSpine?: string;
		introAnimation?: string;
		idleAnimation?: string;
		slotName?: string;
	} = $props();
</script>

<FreeSpinIntroGate />
<FreeSpinIntroVisual boundToInstance={false} {...props} />
