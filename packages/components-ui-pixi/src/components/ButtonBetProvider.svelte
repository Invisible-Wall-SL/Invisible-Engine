<script lang="ts" module>
	export type ButtonBetKey = 'spin_default' | 'spin_disabled' | 'stop_default' | 'stop_disabled';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	import { stateBet, stateBetDerived } from 'state-shared';

	import { getContext } from '../context';

	type Props = {
		children: Snippet<
			[
				{
					key: ButtonBetKey;
					onpress: () => void;
					disabled: boolean;
					spinning: boolean;
				},
			]
		>;
	};

	const props: Props = $props();
	const context = getContext();

	let stopDisabled = $state(false);

	const bet = () => {
		if (stateBetDerived.activeBetMode()?.type === 'buy') stateBet.activeBetModeKey = 'BASE';
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	const stop = () => {
		if (!stopDisabled) {
			if (stateBetDerived.hasAutoBetCounter()) stateBet.autoSpinsCounter = 0;
			context.eventEmitter.broadcast({ type: 'stopButtonClick' });
		}
	};

	const onpress = () => {
		context.eventEmitter.broadcast({ type: 'soundPressBet' });

		if (context.stateXstateDerived.isIdle()) {
			bet();
		} else {
			stop();
		}
	};

	// Autoplay-only STOP model: a single bet's roll finishes in ~1s and has nothing
	// to stop, so the button is INERT while one spin rolls (and, with authored art,
	// shows the rotating `imageSpinning` frame). The STOP only exists to cancel an
	// AUTOPLAY sequence (`hasAutoBetCounter`).
	const getKey = (): ButtonBetKey => {
		if (context.stateXstateDerived.isIdle()) {
			if (!stateBetDerived.isBetCostAvailable()) return 'spin_disabled';
			return 'spin_default';
		}

		// A round is in progress.
		if (stateBetDerived.hasAutoBetCounter()) {
			// Autoplay running → the button stops the sequence.
			return stopDisabled ? 'stop_disabled' : 'stop_default';
		}

		// A single bet is rolling → nothing to stop, the button is inert.
		return 'spin_disabled';
	};

	const key = $derived.by(getKey);
	const disabled = $derived(['spin_disabled', 'stop_disabled'].includes(key));
	// Reels rolling on a plain bet (NOT an autoplay sequence) → the spin frame spins.
	const spinning = $derived(
		context.stateXstateDerived.isPlaying() && !stateBetDerived.hasAutoBetCounter(),
	);

	context.eventEmitter.subscribeOnMount({
		stopButtonClick: () => (stopDisabled = true),
		stopButtonEnable: () => (stopDisabled = false),
	});
</script>

{@render props.children({ key, onpress, disabled, spinning })}
