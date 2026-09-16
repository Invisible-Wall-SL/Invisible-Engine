<script lang="ts" module>
	import type { WinLevelData } from 'engine-game';

	export type EmitterEventWin =
		| { type: 'winShow' }
		| { type: 'winHide' }
		// `holdToSpeedUp`/`tapToSkip` — the PER-INSTANCE count-up interaction toggles, authored on the
		// `winUpdate` action node (its inspector) and carried here in the broadcast payload. Unset ⇒ off
		// (`WinGate` defaults them false). See `CountUpInteraction`.
		| {
				type: 'winUpdate';
				amount: number;
				winLevelData: WinLevelData | undefined;
				holdToSpeedUp?: boolean;
				tapToSkip?: boolean;
				/** PARK the overlay after the count-up: it stays on screen until the player presses,
				 *  instead of concluding on its own. Unset ⇒ off (the overlay self-concludes, exactly
				 *  as before). Authored on the same `winUpdate` node as the two toggles above. */
				waitForPress?: boolean;
		  }
		// Broadcast by `WinGate` the moment its count-up finishes (natural or slammed). Drives the
		// `winCountUpComplete` component signal so an authored `bigWin` container's tap/prompt arms
		// only after the count (via `tapArmAfterSignal`/`hiddenUntilSignal`). Payload-less. Mirrors
		// `freeSpinOutroCountUpComplete`.
		| { type: 'winCountUpComplete' };
</script>

<script lang="ts">
	// OFF-path composer (parity): mounts the full-screen GATE (dim + count-up driver + WinCoins +
	// press + round-await) and the board-relative VISUAL (the tier spine + count number) together,
	// the visual self-centring on the board (`boundToInstance={false}`) — render-equivalent to the
	// pre-split standalone Win overlay. The ON path mounts the gate (`WinGate`) and an
	// editor-positioned `win` componentInstance as SEPARATE scene nodes instead (gated by
	// `WIN_INSTANCE`). Both subscribe to the `win*` events; the win level / amount / count-up
	// bridge via `winState`. Mirrors `FreeSpinOutro`.
	import WinGate from './WinGate.svelte';
	import WinVisual from './WinVisual.svelte';

	const props: {
		winSpine?: string;
		slotName?: string;
	} = $props();
</script>

<WinGate />
<WinVisual boundToInstance={false} {...props} />
