<script lang="ts" module>
	import { stateBet, stateBetDerived } from 'state-shared';
</script>

<script lang="ts">
	import OnHotkey from './OnHotkey.svelte';

	// The player's own turbo, restored when the hold ends rather than switched off.
	let turboBeforeHold = false;

	const spaceHoldOn = () => {
		// `OnHotkey` calls `onhold` again once its hold state settles; only the first call is the
		// player's turbo, the second would read the hold's own.
		if (!stateBet.isSpaceHold) turboBeforeHold = stateBetDerived.isTurboPersistent();
		stateBet.autoSpinsCounter = 0;
		stateBet.isSpaceHold = true;
		stateBetDerived.updateIsTurbo(true, { persistent: true });
	};

	const spaceHoldOff = () => {
		stateBet.isSpaceHold = false;
		stateBetDerived.updateIsTurbo(turboBeforeHold, { persistent: true });
	};
</script>

<OnHotkey hotkey="Space" onhold={spaceHoldOn} onholdend={spaceHoldOff} />
