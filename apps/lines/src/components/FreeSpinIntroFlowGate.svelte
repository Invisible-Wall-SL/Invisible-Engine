<script lang="ts">
	import { waitForResolve } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { FREE_SPIN_STEPS } from '../game/freeSpinOwnership';
	import { getFlowInterpreter } from '../game/flowInterpreterHolder';

	// FS-7 (design doc §14, intro step) — the round-block OWNER when the authored `freeSpinIntro`
	// screen owns the intro (`ownsIntro`). It moves TWO responsibilities off the engine-owned
	// `<FreeSpinIntroGate>` into the authored flow screen, WITHOUT changing the intro choreography
	// (FS-6 keeps `freeSpinIntroShow`/`freeSpinIntroUpdate`/`freeSpinIntroHide` verbatim):
	//
	//   1. EARLY MOUNT — the intro choreography broadcasts `freeSpinIntroShow` (flowDoc line 119)
	//      BEFORE it blocks on `broadcastAwait('freeSpinIntroUpdate')` (line 123). We activate the
	//      authored `freeSpinIntro` overlay on THAT `*Show`, so the screen (and its spine) is visible
	//      while the round holds — not only after the tap. We fire ONLY the macro `bookEvent`
	//      transition (`activateForBookEvent`), never the presentation, so the choreography that is
	//      already running is not re-dispatched; the dispatcher's own later `onBookEvent` for the same
	//      `freeSpinTrigger` then no-ops (a layer edge onto an already-active target, `changesActiveSet`).
	//
	//   2. ROUND-BLOCK TRANSFER — we hold the round-blocking `waitForResolve` on `freeSpinIntroUpdate`
	//      (so `broadcastAwait` blocks the choreography here) and release it when the authored screen
	//      fires its Complete pin — observed as the `freeSpinIntro` screen LEAVING the interpreter's
	//      active set (its tap-to-continue → `completeActiveScreen()` runs the exit + deactivates it).
	//      So a SINGLE tap on the authored screen both resumes the choreography past line 123 AND
	//      dismisses the overlay via its `complete` edge — the tap is no longer consumed by an engine
	//      gate that never dismisses the flow screen.
	//
	// EXACTLY-ONE-SUBSCRIBER INVARIANT (two `waitForResolve` on `freeSpinIntroUpdate` would hang the
	// round — see the Game.svelte comment by the gate mounts): this component is the ONLY holder when
	// `ownsIntro`, and `<FreeSpinIntroGate>`'s press + dim + hold are suppressed by the SAME `ownsIntro`
	// at the mount site. When NOT owned this component early-returns inert (no subscribe, no mount, no
	// hold) and `<FreeSpinIntroGate>` owns everything exactly as today — byte-parity (§7).
	type Props = {
		/** True iff the intro step is flow-owned (screen placed + edge wired + scene authored). ONLY
		 *  then does this component take over the mount + round-block; false ⇒ fully inert. */
		ownsIntro: boolean;
		/** Whether the authored `freeSpinIntro` screen is currently in the interpreter's active set.
		 *  Its transition to `false` (the Complete pin fired) is what releases the held round-block. */
		introScreenActive: boolean;
	};
	const props: Props = $props();

	const context = getContext();

	// The pending round-block resolver, set while `broadcastAwait('freeSpinIntroUpdate')` holds and
	// cleared on release. Not reactive — an `$effect` reads the LATEST value on each `introScreenActive`
	// change (see below); a plain `let` is enough because only that effect + the subscriber touch it.
	let releaseRoundBlock: (() => void) | undefined;

	context.eventEmitter.subscribeOnMount({
		// EARLY MOUNT — activate the authored intro overlay the instant its `*Show` broadcasts, before
		// the round-block below. A no-op when un-owned or when the interpreter/edge is absent (the
		// holder helper returns false). Fire-and-forget: the macro transition is async but the
		// choreography does not await it (only the later `freeSpinIntroUpdate` await gates the round).
		freeSpinIntroShow: () => {
			if (!props.ownsIntro) return;
			void getFlowInterpreter()?.activateForBookEvent({ type: FREE_SPIN_STEPS.intro.event });
		},
		// ROUND-BLOCK TRANSFER — hold the round on `freeSpinIntroUpdate` until the authored screen
		// completes. Un-owned ⇒ resolve immediately (never hold), so `<FreeSpinIntroGate>` is the sole
		// holder and this adds no second subscriber to the awaited broadcast (parity §7).
		freeSpinIntroUpdate: async () => {
			if (!props.ownsIntro) return;
			await waitForResolve((resolve) => (releaseRoundBlock = resolve));
		},
	});

	// Release the held round-block when the authored `freeSpinIntro` screen leaves the active set —
	// i.e. its Complete pin fired (the player's tap-to-continue). Reading `props.introScreenActive`
	// makes this effect re-run on every active-set change; we release only on the true→false edge
	// while a block is actually pending, so a spurious re-run can never resolve early.
	$effect(() => {
		if (!props.introScreenActive && releaseRoundBlock) {
			const resolve = releaseRoundBlock;
			releaseRoundBlock = undefined;
			resolve();
		}
	});
</script>
