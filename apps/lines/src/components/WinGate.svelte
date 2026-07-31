<script lang="ts">
	import { FadeContainer, WinCountUpProvider } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { CanvasSizeRectangle } from 'components-layout';
	import { OnMount, OnHotkey } from 'components-shared';
	import type { WinLevelData } from '../game/winLevelMap';

	import { getContext } from '../game/context';
	import { flowV2DrivesScreens } from '../game/flowV2Runtime.svelte';
	import PressToContinue from './PressToContinue.svelte';
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

	const context = getContext();

	// Under a v2 flow that DRIVES the screens, the authored container's `tapToContinue` overlay is
	// the SOLE tap surface (a `showContainer{awaitComplete}` node owns any round-block hold), so
	// this coded full-screen press steps aside exactly as the free-spin gates do in `Game.svelte`
	// — otherwise a v2 game carries a second, un-authored `OnPressFullScreen` + `MM_pressanywhere`
	// prompt the author never asked for and cannot see in either editor. The count-up still
	// self-resolves via `OnMount` below (the tap only ever SKIPPED it), so dropping the press
	// cannot hang the round. No v2 doc / a book-events-only flow ⇒ `false` ⇒ parity.
	const codedPressOwned = !flowV2DrivesScreens();

	// HOLD-TO-FAST-FORWARD — the big-win twin of the free-spin OUTRO driver's hold speed-up
	// (`FreeSpinOutroDriver`). While the player HOLDS a pointer (the canvas-space surface below) OR
	// the Space key (via the engine's global keyboard broadcast), the count-up runs
	// `HOLD_SPEED_SCALE`× faster; on release it eases back to normal. Continuous acceleration, NOT an
	// instant skip — a slam (`roundSkip`) still snaps to the total independently. Enabled ONLY on the
	// authored/flow path (`!codedPressOwned`): the coded fallback keeps its byte-identical single-tween
	// count-up + tap-to-slam `PressToContinue`, exactly as the coded `FreeSpinOutroGate` fallback does.
	const HOLD_SPEED_SCALE = 6;
	let pointerHeld = $state(false);
	let keyHeld = $state(false);
	// `undefined` on the coded path keeps `WinCountUpProvider`'s original single fixed-duration tween.
	const speedScale = $derived(
		codedPressOwned ? undefined : pointerHeld || keyHeld ? HOLD_SPEED_SCALE : 1,
	);

	let show = $state(false);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData>();
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		winShow: () => {
			show = true;
			// Belt-and-suspenders reset (the real reset is on `winHide` below): under the CODED path
			// `winShow` precedes the presentation, so clearing here keeps the first win clean too.
			winState.countUpComplete = false;
		},
		winHide: () => {
			show = false;
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
		<WinCountUpProvider {amount} {duration} {speedScale}>
			{#snippet children({ countUpAmount, startCountUp, finishCountUp, countUpCompleted })}
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
						oncomplete();
					}}
				/>

				<!-- Publish the live count-up amount + the coin-fountain emit signal (emit while the
					count-up runs) to the positionable VISUAL, which draws the count text + `WinCoins`. -->
				<WinStatePublisher {countUpAmount} coinsEmit={!countUpCompleted} />

				{#if codedPressOwned}
					<PressToContinue onpress={() => (countUpCompleted ? oncomplete() : finishCountUp())} />
				{:else if !countUpCompleted}
					<!-- Hold-to-fast-forward input surfaces, mounted ONLY while the count-up runs (flow path)
						 so they never intercept the authored `bigWin` container's tap-to-continue that arms on
						 `winCountUpComplete`. Mirrors `FreeSpinOutroDriver`: a canvas-space rectangle detects a
						 pointer hold; `<OnHotkey>` detects a Space hold off the engine's global keyboard broadcast. -->
					<CanvasSizeRectangle
						eventMode="static"
						cursor="pointer"
						backgroundColor={0xffffff}
						backgroundAlpha={0.001}
						onpointerdown={() => (pointerHeld = true)}
						onpointerup={() => (pointerHeld = false)}
						onpointerupoutside={() => (pointerHeld = false)}
					/>
					<OnHotkey
						hotkey="Space"
						onpress={() => (keyHeld = true)}
						onpressend={() => (keyHeld = false)}
						onholdend={() => (keyHeld = false)}
					/>
				{/if}
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
