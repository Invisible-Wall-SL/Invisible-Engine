<script lang="ts" module>
	import { hasContinuePress, stateBet, stateBetDerived } from 'state-shared';
</script>

<script lang="ts">
	import { getContextEventEmitter } from 'utils-event-emitter';
	import {
		getSpinButtonKey,
		getSpinPressSound,
		runSpinOrSlamStop,
		type SpinPressSound,
	} from 'utils-shared/spinStop';

	import OnHotkey from './OnHotkey.svelte';

	type Props = {
		/** The game's idle read. Without it (replay), a hold only ever chains rounds already running. */
		isIdle?: () => boolean;
	};

	const props: Props = $props();
	const { eventEmitter } = getContextEventEmitter<
		{ type: 'bet' } | { type: 'stopButtonClick' } | SpinPressSound
	>();

	// The player's own turbo, restored when the hold ends rather than switched off.
	let turboBeforeHold = false;
	// When this press's first keyDown landed (0 = no press), and when a round last started.
	let pressStartedAt = 0;
	let roundStartedAt = 0;

	$effect(() => {
		if (props.isIdle && !props.isIdle()) roundStartedAt = performance.now();
	});

	// A hold registers 400 ms into the press, and `checkSpaceHold` only chains a round that is still
	// running then. A fast (turbo) losing spin started by this same press can already be over, which
	// left the player holding Space at idle with nothing happening — so start the next round here.
	// Only for a round THIS press started: a Space held through the loading tap or a press-to-continue
	// ran no round of its own, and still places no bet.
	const continueFromIdle = () => {
		if (!props.isIdle?.() || !pressStartedAt || roundStartedAt < pressStartedAt) return;
		if (getSpinButtonKey({ isIdle: true }) !== 'spin_default' || hasContinuePress()) return;
		eventEmitter.broadcast(getSpinPressSound({ isIdle: true }));
		runSpinOrSlamStop({ isIdle: true, broadcast: eventEmitter.broadcast });
	};

	const pressStart = () => {
		if (!pressStartedAt) pressStartedAt = performance.now();
	};

	const pressEnd = () => {
		pressStartedAt = 0;
	};

	const spaceHoldOn = () => {
		// `OnHotkey` calls `onhold` again once its hold state settles; only the first call is the
		// player's turbo and the hold's start, the second would read the hold's own.
		const starting = !stateBet.isSpaceHold;
		if (starting) turboBeforeHold = stateBetDerived.isTurboPersistent();
		stateBet.autoSpinsCounter = 0;
		stateBet.isSpaceHold = true;
		stateBetDerived.updateIsTurbo(true, { persistent: true });
		if (starting) continueFromIdle();
	};

	const spaceHoldOff = () => {
		pressEnd();
		stateBet.isSpaceHold = false;
		stateBetDerived.updateIsTurbo(turboBeforeHold, { persistent: true });
	};
</script>

<!-- A press cancelled by focus loss gets no `onpressend`, so forget it here too. -->
<svelte:window onblur={pressEnd} />

<OnHotkey
	hotkey="Space"
	onpress={pressStart}
	onpressend={pressEnd}
	onhold={spaceHoldOn}
	onholdend={spaceHoldOff}
/>
