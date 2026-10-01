<script lang="ts">
	import { stateBet } from 'state-shared';
	import { getGameContext } from '../game/context';

	type Props = {
		/** The player is in (past any loading / tap-to-start screen). A resumed book plays only from
		 *  then on, so it never runs behind a splash; absent ⇒ resume at mount. */
		ready?: boolean;
	};

	const { ready = true }: Props = $props();
	const context = getGameContext();
	let resumed = false;

	$effect(() => {
		if (!ready || resumed) return;
		resumed = true;
		if (stateBet.betToResume?.active && stateBet.betToResume.mode) {
			stateBet.activeBetModeKey = stateBet.betToResume.mode;
		}
		context.eventEmitter.broadcast({ type: 'resumeBet' });
	});
</script>
