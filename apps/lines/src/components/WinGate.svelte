<script lang="ts">
	import { FadeContainer, WinCountUpProvider } from 'components-pixi';
	import { waitForResolve, waitForTimeout } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { CanvasSizeRectangle } from 'components-layout';
	import { OnMount } from 'components-shared';
	import type { WinLevelData } from 'engine-game';

	import { getContext } from '../game/context';
	import { flowV2DrivesScreens } from '../game/flowV2Runtime.svelte';
	import { CountUpInteraction } from 'engine-game';
	import { PressToContinue } from 'engine-game';
	import WinStatePublisher from './WinStatePublisher.svelte';
	import { winState } from '../game/winState.svelte';

	// The full-screen GATE of the WIN overlay (big-win presentation): the `winShow/winHide/winUpdate`
	// book-event subscription, the count-up driver (`WinCountUpProvider` + `OnMount startCountUp`),
	// the big-win `CanvasSizeRectangle` dim scrim, the press-to-continue — and it OWNS the
	// round-blocking await. Publishes the win level + final amount + the live count-up amount + the
	// coin-fountain emit signal (`coinsEmit`) to `winState` so the positionable VISUAL (`WinVisual`)
	// renders the spine + count number + the now-authorable `WinCoins` fountain. Stays full-screen
	// (`canvas`), never editor-positioned.
	//
	// `headless` (design doc §14, the win-overlay twin of the FS-7 outro) — when an authored `bigWin`
	// container rebuilds the overlay from primitives (`resolveWinMount` ⇒ `'driver'`) the engine mounts
	// this gate WITHOUT its big-win dim scrim, so it keeps only the LOAD-BEARING core (count-up +
	// `winState` publish + round-block self-resolve) and the authored container owns dim / tap / art.
	// The coded press already self-suppresses under v2 (`codedPressOwned`), so a headless mount adds no
	// visible surface. Default `false` ⇒ the full gate (driven seed / today) — byte-identical.
	const { headless = false }: { headless?: boolean } = $props();

	/**
	 * RUNAWAY GUARD on the final tier's outro — the same discipline `game/symbolBeat.ts` applies to the
	 * win beat, for the same reason: this wait BLOCKS THE ROUND, so it must never be unbounded.
	 *
	 * `concludePresentation` waits for the outro's `complete`, and a spine only reports that when the
	 * bound animation actually plays once — not when its name is absent from the skeleton, and not when
	 * the clip loops. Either way the overlay sits on screen and the round never ends. `WinAnimation`
	 * already short-circuits the two authorings it can NAME up front (no outro, or the idle reused as
	 * one); this bounds everything it cannot.
	 *
	 * Sized off the ART, like `WIN_BEAT_CAP_MS`. Measured across the reference `bigwin` rig: every
	 * `*_win_exit` is 467ms and the longest clip of any kind that is not a resting loop is a 1667ms
	 * intro. 4000ms is ~8.5× a real exit — room for a project that authors a far longer flourish and
	 * for a frame-starved device — while still being a third of an idle cycle (12000ms), so a
	 * mis-authored outro costs a bounded pause rather than the whole loop.
	 *
	 * Raise this before shortening it: if a game's tier outro is genuinely being cut off, this number
	 * is the bug, not the animation.
	 */
	const ESCALATION_OUTRO_CAP_MS = 4_000;

	const context = getContext();

	// Under a v2 flow that DRIVES the screens, the authored container's `tapToContinue` overlay is
	// the SOLE tap surface (a `showContainer{awaitComplete}` node owns any round-block hold), so
	// this coded full-screen press steps aside exactly as the free-spin gates do in `Game.svelte`
	// — otherwise a v2 game carries a second, un-authored `OnPressFullScreen` + `MM_pressanywhere`
	// prompt the author never asked for and cannot see in either editor. The count-up still
	// self-resolves via `OnMount` below (the tap only ever SKIPPED it), so dropping the press
	// cannot hang the round. No v2 doc / a book-events-only flow ⇒ `false` ⇒ parity.
	const codedPressOwned = !flowV2DrivesScreens();

	// COUNT-UP INTERACTION (the big-win twin of the free-spin OUTRO driver's) — the shared authorable
	// `<CountUpInteraction>` surface drives `interactionSpeedScale` (hold-to-fast-forward) and fires
	// `finishCountUp` (tap-to-skip). PER-INSTANCE: the two toggles are authored on the `winUpdate`
	// action node and arrive in that event's payload (below), NOT a global setting. Enabled ONLY on the
	// authored/flow path (`!codedPressOwned`): the coded fallback keeps its byte-identical single-tween
	// count-up + tap-to-slam `PressToContinue`, exactly as the coded `FreeSpinOutroGate` fallback does.
	let holdToSpeedUp = $state(false);
	let tapToSkip = $state(false);
	let interactionSpeedScale = $state(1);
	// `undefined` — the provider's original single fixed-duration tween — on the coded path OR when
	// hold-to-speed-up is off (a pure tap-to-skip surface never accelerates); the dynamic scale only
	// when hold is authored on. A slam (`roundSkip`) still snaps to the total independently either way.
	const speedScale = $derived(
		codedPressOwned || !holdToSpeedUp ? undefined : interactionSpeedScale,
	);

	// Whether a TAP steps the escalation tiers (vs. the coded slam). Drives the provider's `seekable`
	// (so its count can be sought forward) AND gates `stepOrSkip`'s jump. Keyed off `tapToSkip`, which the
	// `winUpdate` handler sets SYNCHRONOUSLY before this provider mounts — unlike `winState.escalationActive`
	// (published by the visual in an effect a flush later), which could still be false when the count-up
	// starts and freeze the provider on its single-tween path. Flow path only; a non-escalation win simply
	// finds no boundary to step to and slams (byte-identical). `codedPressOwned` ⇒ the coded slam, untouched.
	const canTapStep = $derived(!codedPressOwned && tapToSkip);

	// Publish the live HOLD multiplier to the escalation chain, so `WinAnimation` speeds up the tier
	// intro/idle spines in lockstep with the accelerating count-up (a smooth ramp, not a snap). 1 when
	// hold-to-speed-up is off / the coded path / not held ⇒ the escalation runs at normal speed
	// (byte-identical). A `tapToSkip` slam never raises `interactionSpeedScale`, so it stays an instant
	// collapse (no ramp). Reset below on `winShow` so a value frozen after a previous win's count-up
	// (the interaction unmounts, freezing its last bound value) can't leak a fast start into the next.
	$effect(() => {
		winState.escalationSpeedScale = speedScale ?? 1;
	});

	let show = $state(false);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData | undefined>();
	let oncomplete = $state(() => {});
	// Guards `concludePresentation` against a double conclusion (OnMount + a post-count-up tap both
	// route through it). Reset per win alongside the count-up latch.
	let concluded = false;

	/**
	 * TAP on the escalation path — advance ONE tier instead of slamming. The tier WALK (idle-complete,
	 * `WinAnimation`) is the clock and publishes the active tier as `winState.escalationStepIndex`; a tap
	 * bumps `escalationForceStep` to jump the walk forward one tier, AND seeks the count to that tier's
	 * amount (`escalationBoundaries`) so the number snaps to it and resumes. On the FINAL tier (no next
	 * tier) it SLAMS instead (`finishCountUp` → land on the total, then the outro). Un-escalating ⇒ no
	 * tiers ⇒ the slam every time (byte-identical tap-to-skip). Robust to a fast/instant count-up because
	 * the stepping keys off the walk index, not the count value.
	 */
	function stepOrSkip(jumpTo: (target: number) => void, finish: () => void) {
		const boundaries = winState.escalationBoundaries;
		const idx = winState.escalationStepIndex;
		const next = idx + 1;
		if (winState.escalationActive && next < boundaries.length) {
			winState.escalationForceStep = next;
			jumpTo(boundaries[next]);
			return;
		}
		// FINAL tier (or un-escalating) — the player tapped to DISMISS, not to step. Slam the count-up AND
		// arm the outro-skip so the overlay hides the moment the slam lands: the outro exists to play out an
		// AUTO / fast-forwarded conclusion cleanly (that path is untouched), NOT to hold a deliberate dismiss
		// tap for its full duration. Set the skip flag WITHOUT concluding here — `OnMount`'s
		// `concludePresentation` (once the slam completes the count-up + broadcasts `winCountUpComplete`)
		// then finds the outro wait already satisfied and resolves at once, preserving event ordering.
		// Inert when un-escalating (the conclusion never waited on the outro) ⇒ byte-identical.
		finish();
		winState.escalationOutroComplete = true;
	}

	/**
	 * A POST-count-up dismiss press (coded path) — end the presentation now instead of holding it for the
	 * final tier's outro. `OnMount`'s `concludePresentation` is already in-flight AWAITING the outro, so
	 * marking it complete resolves that {@link waitForEscalationOutro} at once; the extra call concludes a
	 * presentation still inside its post-count-up settle window too (idempotent via `concluded`). This ONLY
	 * runs on an explicit press; a presentation left to AUTO-conclude never touches it, so the outro still
	 * plays in full (escalation unchanged). Un-escalating ⇒ the flag is inert — byte-identical.
	 */
	function dismissNow() {
		winState.escalationOutroComplete = true;
		void concludePresentation();
	}

	/**
	 * Conclude the WIN presentation — resolve the round-blocking `winUpdate` await. On the SEQUENTIAL-
	 * ESCALATION path (`winState.escalationActive`) it FIRST waits for the final tier's OUTRO to finish
	 * ({@link winState.escalationOutroComplete}), so a fast-forward / tap-to-skip of the count-up
	 * collapses the chain to the final tier and plays its outro cleanly instead of the overlay
	 * concluding mid-chain. Un-escalating ⇒ resolves immediately (byte-identical). Idempotent.
	 */
	async function concludePresentation() {
		if (concluded) return;
		concluded = true;
		if (winState.escalationActive) await waitForEscalationOutro();
		oncomplete();
	}

	/** A promise that resolves when the escalation outro completes (`WinAnimation` sets the latch).
	 *  Reactive→promise bridge via a disposable root effect; resolves immediately if already complete.
	 *  RACED against {@link ESCALATION_OUTRO_CAP_MS} — this wait blocks the round, so it is never
	 *  allowed to be unbounded. */
	function waitForEscalationOutro(): Promise<void> {
		if (winState.escalationOutroComplete) return Promise.resolve();
		return new Promise<void>((resolve) => {
			// ONE settle point for both racers, so the loser cannot resolve twice, cannot warn about an
			// outro that did land, and — the reason this isn't a bare `Promise.race` — cannot leave the
			// watcher root running for the rest of the session on every capped win.
			let stop = () => {};
			let settled = false;
			const settle = (capped: boolean) => {
				if (settled) return;
				settled = true;
				stop();
				if (capped) {
					console.warn(
						`[WinGate] the win tier's outro did not report complete within ${ESCALATION_OUTRO_CAP_MS}ms — ` +
							'concluding anyway. Check that the final tier\'s "outro" names an animation that exists ' +
							'in its spine and plays once (a looping clip never fires `complete`).',
					);
				}
				resolve();
			};
			stop = $effect.root(() => {
				$effect(() => {
					if (winState.escalationOutroComplete) settle(false);
				});
			});
			void waitForTimeout(ESCALATION_OUTRO_CAP_MS).then(() => {
				if (!winState.escalationOutroComplete) settle(true);
			});
		});
	}

	context.eventEmitter.subscribeOnMount({
		winShow: () => {
			show = true;
			// Belt-and-suspenders reset (the real reset is on `winHide` below): under the CODED path
			// `winShow` precedes the presentation, so clearing here keeps the first win clean too.
			winState.countUpComplete = false;
			winState.escalationOutroComplete = false;
			// The count-up interaction unmounts at completion, FREEZING its last bound `speedScale` — so
			// clear the local scale here (the publish `$effect` then sets `escalationSpeedScale` back to 1)
			// so a repeat win never starts its escalation walk at the previous win's held speed.
			interactionSpeedScale = 1;
			concluded = false;
			// Reset the tap-to-step walk trackers so a repeat win starts at the first tier.
			winState.escalationForceStep = 0;
			winState.escalationStepIndex = 0;
		},
		winHide: () => {
			show = false;
			winState.escalationOutroComplete = false;
			concluded = false;
			winState.escalationForceStep = 0;
			winState.escalationStepIndex = 0;
			// Reset the count-up-complete latch when the win DISMISSES — the load-bearing reset for a
			// REPEAT win. Under an authored flow the win container (and its `tapArmAfterSignal:
			// 'winCountUpComplete'` tap) is mounted by `showContainer` BEFORE that win's `winShow`
			// fires, so a `winShow`-only reset is too late: the second win's tap would seed off the
			// FIRST win's stale `true` and arm instantly, before its own count-up. Clearing on the
			// prior win's hide guarantees the next `showContainer` mounts a `false` latch. Sequential
			// setWin events (each awaits its chain) mean this always runs before the next win shows.
			winState.countUpComplete = false;
		},
		winUpdate: async (emitterEvent) => {
			amount = emitterEvent.amount;
			winLevelData = emitterEvent.winLevelData;
			// PER-INSTANCE count-up interaction — authored on the `winUpdate` action node, carried here.
			// Unset ⇒ off (a plain count-up); the author ticks either/both in the node's inspector.
			holdToSpeedUp = emitterEvent.holdToSpeedUp ?? false;
			tapToSkip = emitterEvent.tapToSkip ?? false;
			winState.amount = emitterEvent.amount;
			winState.winLevelData = emitterEvent.winLevelData;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

<FadeContainer {show}>
	{#if winLevelData}
		{@const isBigWin = winLevelData.type === 'big'}
		{@const duration = winLevelData.presentDuration}
		<WinCountUpProvider {amount} {duration} {speedScale} seekable={canTapStep}>
			{#snippet children({ countUpAmount, startCountUp, finishCountUp, jumpTo, countUpCompleted })}
				{#if isBigWin && !headless}
					<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />
				{/if}

				<OnMount
					onmount={async () => {
						await startCountUp();
						// The count-up has finished (natural or slammed). Fire `winCountUpComplete` ONCE per
						// win, so an authored `bigWin` container's `tapToContinue` / prompt with
						// `tapArmAfterSignal: 'winCountUpComplete'` arms only now (never before the count).
						// Un-authored ⇒ nothing subscribes ⇒ inert (parity). Latch it FIRST (before the
						// broadcast) so a container that subscribes late — a zero/instant count-up finishes
						// in the same tick it mounts — seeds from the latch and still arms (the emitter has
						// no replay, so a fire-before-subscribe would otherwise be lost). Mirrors the outro
						// driver (`FreeSpinOutroDriver`).
						winState.countUpComplete = true;
						context.eventEmitter.broadcast({ type: 'winCountUpComplete' });
						await roundSkip.wait(300);
						// On the escalation path this waits for the collapsed chain's final outro before
						// resolving; un-escalating ⇒ resolves now, exactly as before (byte-identical).
						await concludePresentation();
					}}
				/>

				<!-- Publish the live count-up amount + the coin-fountain emit signal (emit while the
					count-up runs) to the positionable VISUAL, which draws the count text + `WinCoins`. -->
				<WinStatePublisher {countUpAmount} coinsEmit={!countUpCompleted} />

				{#if codedPressOwned}
					<!-- Post-count-up tap concludes via `concludePresentation` so an escalation's outro is
						awaited (not cut). Pre-completion tap still slams the count-up (`finishCountUp`), then
						OnMount concludes. Un-escalating ⇒ concludes immediately (byte-identical tap-to-slam). -->
					<PressToContinue onpress={() => (countUpCompleted ? dismissNow() : finishCountUp())} />
				{:else if !countUpCompleted}
					<!-- Authorable count-up interaction (hold-to-fast-forward and/or tap-to-skip), mounted ONLY
						 while the count-up runs (flow path) so it never intercepts the authored `bigWin`
						 container's tap-to-continue that arms on `winCountUpComplete`. Skip fires the provider's
						 `finishCountUp` slam. Renders nothing when both toggles are off. Shared with the outro
						 driver via `<CountUpInteraction>`. -->
					<CountUpInteraction
						{holdToSpeedUp}
						{tapToSkip}
						bind:speedScale={interactionSpeedScale}
						onSkip={() => stepOrSkip(jumpTo, finishCountUp)}
					/>
				{:else if !headless}
					<!-- POST-COUNT-UP DISMISS (flow path). The branch above unmounts the moment the count-up
						completes, and the coded press is suppressed under v2 — which left the overlay with NO
						tap surface at all for the whole window between the count landing and the outro
						finishing. On the remake that window is the entire wait, so a player who tapped to
						dismiss after the number settled was tapping nothing.

						`PressToContinue` rather than another `CountUpInteraction`: it registers with
						`registerContinuePress`, so the canvas-top `<ContinuePressMask>` mounts and absorbs the
						tap WHEREVER the pointer rests — including over live HUD chrome, which hit-tests above
						this overlay's own rect and would otherwise swallow it. `hidePrompt` keeps the coded
						`MM_pressanywhere` sprite off a v2 screen the author composed themselves, which is the
						only reason the press was suppressed here in the first place.

						`!headless` is the ownership line `resolveWinMount` already draws: headless ⇒ the flow
						OWNS `setWin` and the authored container owns dim / art / tap, so the engine must not
						add a second tap surface. Non-headless ⇒ the engine owns the overlay (it is drawing the
						dim scrim right above), so it owns the dismiss press too — exactly as the coded path
						always has. -->
					<PressToContinue hidePrompt onpress={dismissNow} />
				{/if}
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
