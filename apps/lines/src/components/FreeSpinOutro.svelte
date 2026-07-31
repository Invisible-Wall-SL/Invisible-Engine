<script lang="ts" module>
	import type { WinLevelData } from '../game/winLevelMap';

	export type EmitterEventFreeSpinOutro =
		| { type: 'freeSpinOutroShow' }
		| { type: 'freeSpinOutroHide' }
		// `holdToSpeedUp`/`tapToSkip` — the PER-INSTANCE count-up interaction toggles, authored on the
		// `freeSpinOutroCountUp` action node (its inspector) and carried here in the broadcast payload.
		// Unset ⇒ off (the driver defaults them false). See `CountUpInteraction`.
		| {
				type: 'freeSpinOutroCountUp';
				amount: number;
				winLevelData: WinLevelData;
				holdToSpeedUp?: boolean;
				tapToSkip?: boolean;
		  }
		// FS-7 follow-up — broadcast by the headless outro DRIVER the moment its count-up finishes
		// (natural, slammed, or hold-fast-forwarded). Drives the `freeSpinOutroCountUpComplete`
		// component signal so an authored tap/prompt arms only after the count. Payload-less.
		| { type: 'freeSpinOutroCountUpComplete' };
</script>

<script lang="ts">
	// OFF-path composer (§17 Phase 3 parity): mounts the full-screen GATE (dim + count-up
	// driver + WinCoins + press + round-await) and the board-relative VISUAL together, the
	// visual self-centring on the board (`boundToInstance={false}`) — render-equivalent to
	// the pre-split standalone outro. The ON path mounts the gate (`FreeSpinOutroGate`) and
	// an editor-positioned `freeSpinOutroVisual` componentInstance as SEPARATE scene nodes
	// instead (gated by `FREE_SPIN_OVERLAY_INSTANCES`). Both subscribe to the
	// `freeSpinOutro*` events; the count-up amount/win level bridge via `freeSpinOutroState`.
	import FreeSpinOutroGate from './FreeSpinOutroGate.svelte';
	import FreeSpinOutroVisual from './FreeSpinOutroVisual.svelte';

	const props: {
		outroSpine?: string;
		outroAnimation?: string;
		idleAnimation?: string;
		slotName?: string;
	} = $props();
</script>

<FreeSpinOutroGate />
<FreeSpinOutroVisual boundToInstance={false} {...props} />
