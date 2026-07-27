<script lang="ts">
	import { onMount } from 'svelte';

	import { Text } from 'pixi-svelte';
	import { stateBetDerived, stateModal } from 'state-shared';

	import { gameActor } from '../game/actor';
	import { clearWinPresentation } from '../game/winSymbolCycle';
	import { stateGame } from '../game/stateGame.svelte';
	import { getContext } from '../game/context';

	type Props = {
		debug?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	/**
	 * A spin press landed while a win was being PRESENTED (reels already stopped), asking to skip
	 * straight to the next spin. The press slams the round; this flag makes the game auto-fire the
	 * next bet the instant that slammed round settles to idle — see `stopButtonClick` + the actor
	 * subscription below. Not `$state`: it drives control flow, nothing renders it.
	 */
	let respinAfterRound = false;

	/**
	 * Whether every reel has come to rest — i.e. the round is PRESENTING its result, not still
	 * rolling. This separates a press that means "skip this win and respin" (reels stopped) from one
	 * that means "stop the spinning reels" (still rolling), so the roll-stop keeps its original
	 * behaviour and only the presentation phase respins.
	 */
	const reelsAllStopped = () =>
		stateGame.board.length > 0 &&
		stateGame.board.every((reel) => reel.reelState.motion === 'stopped');

	/** Whether a fresh bet may fire right now: enough balance, no blocking error modal, and not an
	 *  autoplay/space-hold sequence (those drive their own continuation). */
	const canStartBet = () =>
		!stateBetDerived.isContinuousBet() && stateBetDerived.isBetCostAvailable() && !stateModal.modal;

	onMount(() => {
		const { unsubscribe } = gameActor.subscribe((snapshot) => {
			context.stateXstate.value = snapshot.value;
			// A spin press during the win presentation queued a respin (see `stopButtonClick`). The
			// slam has now fast-forwarded that round to idle — fire the next bet automatically so one
			// press both clears the win and starts spinning again. Cleared first so a queue can only
			// fire once.
			//
			// Fire it EXACTLY like a normal spin: a `bet` broadcast (the same event the spin button
			// sends), deferred out of this subscription callback with `queueMicrotask`. Sending
			// `gameActor.send('BET')` DIRECTLY from inside the callback re-enters the actor mid-
			// notification, and that mis-sequenced the respin round's own presentation — its first
			// winline + text was suppressed while only the resting cycle drew. Deferring + going
			// through the normal `bet` path makes the respin byte-identical to a press from idle, so it
			// presents like any other spin. Re-checked at fire time because balance/modal/idle state
			// can change while the microtask waits.
			if (respinAfterRound && context.stateXstateDerived.isIdle()) {
				respinAfterRound = false;
				if (canStartBet())
					queueMicrotask(() => {
						if (context.stateXstateDerived.isIdle() && canStartBet())
							context.eventEmitter.broadcast({ type: 'bet' });
					});
			}
		});

		gameActor.start();
		gameActor.send({ type: 'RENDERED' });

		return () => {
			// Equivalent to onDestroy(); Leave this comment for searching.
			unsubscribe();
			gameActor.stop();
		};
	});

	context.eventEmitter.subscribeOnMount({
		// Connect every actor with app.eventEmitter to avoid call actor directly
		bet: () => gameActor.send({ type: 'BET' }),
		autoBet: () => gameActor.send({ type: 'AUTO_BET' }),
		resumeBet: () => gameActor.send({ type: 'RESUME_BET' }),
		// A SLAM press (`stopButtonClick`, fired while a round is rolling/presenting) wipes the
		// previous win's line + stamped amount + info-bar message NOW, so any spin press clears the
		// board — not just a new bet at rest (which clears via `onNewGameStart`). The win LINE is
		// already slam-gated (`winLineEnabledForWin`) so no later payline redraws behind this; here we
		// clear the currently-drawn one instantly instead of one-win-later. A no-op when there is
		// nothing on screen (a slam during the reel roll, before any win).
		stopButtonClick: () => {
			clearWinPresentation();
			// If the reels have already stopped, this press landed on the WIN PRESENTATION — the
			// player wants to skip the whole result (every win) and go straight to the next spin. Queue
			// a respin: the slam settles the round to idle, and the actor subscription fires the next
			// bet, whose own `onNewGameStart` clears the board and rolls the reels (which wipes the lit
			// win symbols too). A press during the reel ROLL leaves the reels un-stopped, so it only
			// lands them — the original stop behaviour is untouched.
			if (reelsAllStopped() && canStartBet()) respinAfterRound = true;
		},
	});
</script>

{#if props.debug}
	<Text
		x={context.stateLayoutDerived.canvasSizes().width}
		anchor={{ x: 1, y: 0 }}
		style={{ fill: 0xffffff }}
		text={JSON.stringify(context.stateXstate.value, undefined, 2)}
	/>
{/if}
