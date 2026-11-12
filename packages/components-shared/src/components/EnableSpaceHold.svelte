<script lang="ts" module>
	import { hasContinuePress } from 'state-shared';
</script>

<script lang="ts">
	import { getContextEventEmitter } from 'utils-event-emitter';
	import {
		getSpinButtonKey,
		getSpinPressSound,
		runSpinOrSlamStop,
		type SpinPressSound,
	} from 'utils-shared/spinStop';
	import { HOLD_TO_SPIN_MS, endSpinHold, startSpinHold } from 'utils-shared/spinHold';

	import { hotkeyPressesFor } from '../hotkeyPress';
	import OnHotkey from './OnHotkey.svelte';

	type Props = {
		/** The game's idle read. Without it (replay), a hold only ever chains rounds already running. */
		isIdle?: () => boolean;
	};

	const props: Props = $props();
	const { eventEmitter } = getContextEventEmitter<
		{ type: 'bet' } | { type: 'stopButtonClick' } | SpinPressSound
	>();
	const presses = hotkeyPressesFor(eventEmitter);

	// The Space key's place in the hold it shares with the spin buttons (`utils-shared/spinHold`).
	const holder = Symbol('space');

	// A round that starts while Space is down is that press's round, whatever started it.
	eventEmitter.subscribeOnMount({
		bet: () => {
			const press = presses.live('Space');
			if (press) press.startedRound = true;
		},
	});

	// A hold registers 400 ms into the press, and `checkSpaceHold` only chains a round that is still
	// running then. A fast (turbo) losing spin started by this same press can already be over, which
	// left the player holding Space at idle with nothing happening — so start the next round here.
	// Only for a round THIS press started: a Space held through the loading tap or a press-to-continue
	// ran no round of its own, and still places no bet. Read off the press, not off the game leaving
	// idle: the game's resume check as the start screen goes is not a round.
	const continueFromIdle = () => {
		if (!props.isIdle?.() || !presses.live('Space')?.startedRound) return;
		if (getSpinButtonKey({ isIdle: true }) !== 'spin_default' || hasContinuePress()) return;
		eventEmitter.broadcast(getSpinPressSound({ isIdle: true }));
		runSpinOrSlamStop({ isIdle: true, broadcast: eventEmitter.broadcast });
	};

	const spaceHoldOn = () => {
		// `OnHotkey` calls `onhold` again once its hold state settles; only the first call starts it.
		if (startSpinHold(holder)) continueFromIdle();
	};

	const spaceHoldOff = () => {
		endSpinHold(holder);
	};
</script>

<OnHotkey hotkey="Space" holdMs={HOLD_TO_SPIN_MS} onhold={spaceHoldOn} onholdend={spaceHoldOff} />
