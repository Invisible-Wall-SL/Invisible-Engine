<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { untrack, type Snippet } from 'svelte';

	import { createInterruptible } from 'utils-shared/interruptible';
	import { roundSkip } from 'utils-shared/skipToken';

	type Props = {
		amount: number;
		duration: number;
		/**
		 * Opt-in continuous speed multiplier for the count-up (e.g. hold-to-fast-forward). `> 1`
		 * shortens the REMAINING time proportionally IN REAL TIME and may change mid-count-up (hold /
		 * release); `1` is normal speed. OMITTING it keeps the single fixed-duration tween unchanged —
		 * so the WIN overlay and the fallback outro gate (neither passes it) are byte-identical. This is
		 * true acceleration, not a snap: `finishCountUp` / `roundSkip` still own the instant slam.
		 */
		speedScale?: number;
		/** Optional: the count-up's completion is observable through the snippet's
		 *  `countUpCompleted`, so a consumer that only renders from that needs no callback. */
		oncomplete?: () => void;
		children: Snippet<
			[
				{
					countUpAmount: number;
					startCountUp: () => Promise<void>;
					finishCountUp: () => void;
					countUpCompleted: boolean;
				},
			]
		>;
	};

	const props: Props = $props();
	const countUpAmount = new Tween(0);
	const interruptible = createInterruptible();

	let countUpCompleted = $state(false);

	// Whether this consumer opted into a dynamic speed. Read once (a consumer either always passes
	// `speedScale` or never does): when absent the ORIGINAL single-tween path below runs verbatim.
	const acceleratable = props.speedScale !== undefined;
	const scale = $derived(Math.max(props.speedScale ?? 1, 0.0001));

	const countUp = () =>
		countUpAmount.set(props.amount, { duration: roundSkip.isSkipped() ? 0 : props.duration });
	const resetCountUp = () => countUpAmount.set(props.amount, { duration: 0 });
	const finishCountUp = () => interruptible.interrupt();

	// --- Accelerated path (only when `speedScale` is provided) ---------------------------------------
	// svelte's `Tween.set` aborts the previous task WITHOUT resolving its promise, so re-issuing the
	// tween on a speed change would strand the awaited promise. Instead the owner tracks completion by
	// watching `current` reach the target, and re-targets the tween whenever the speed changes.
	let running = $state(false);
	let onSettle: (() => void) | undefined;

	// Re-issue the tween from wherever it is now, at the CURRENT speed. Linear easing ⇒ remaining time
	// is proportional to remaining value; `roundSkip` collapses it to instant.
	const retarget = () => {
		if (roundSkip.isSkipped() || props.amount <= 0) {
			void countUpAmount.set(props.amount, { duration: 0 });
			return;
		}
		const remaining = props.amount - countUpAmount.current;
		const baseRemaining = props.duration * (remaining / props.amount);
		void countUpAmount.set(props.amount, { duration: Math.max(baseRemaining, 0) / scale });
	};
	// Re-target on every speed change (hold / release) while a count-up is running; `current` is read
	// untracked so this fires on the speed edge, not every frame.
	$effect(() => {
		void scale;
		if (!running) return;
		untrack(retarget);
	});
	// Own completion: settle the moment the value reaches the target (the tween lands exactly on it).
	$effect(() => {
		if (!running) return;
		if (countUpAmount.current >= props.amount) onSettle?.();
	});

	const startCountUp = async () => {
		if (!acceleratable) {
			await interruptible.add(countUp);
		} else {
			running = true;
			// Await the value-reached settle ONLY when there is actually something to count. For a
			// DEGENERATE count-up — a zero / negative / non-finite amount, a target already reached, or
			// a slammed round — the target is met on the first frame, so the `current >= amount` settle
			// effect can fire before `onSettle` is wired (or never re-run), stranding this await forever.
			// That is the free-spin OUTRO hanging on a 0-win: `startCountUp()` never resolved, so the
			// driver never broadcast `freeSpinOutroCountUpComplete` nor released the round. Resolve
			// synchronously in that case; the count is already at/above the target and `resetCountUp`
			// below stamps the final amount.
			if (
				Number.isFinite(props.amount) &&
				props.amount > countUpAmount.current &&
				!roundSkip.isSkipped()
			) {
				await interruptible.add(() => new Promise<void>((resolve) => (onSettle = resolve)));
			}
			running = false;
			onSettle = undefined;
		}
		resetCountUp();
		countUpCompleted = true;
		props.oncomplete?.();
		interruptible.clear();
	};

	// Slam stop = exactly what the press-to-continue does, without the press: cut the tween and
	// land on the FINAL total (`resetCountUp` in `startCountUp` stamps `props.amount`), never drop
	// it. A slam that lands BEFORE this provider mounts is covered by `countUp`'s duration above,
	// so a count-up that starts on an already-slammed round is instant rather than un-skippable.
	$effect(() => roundSkip.onSkip(finishCountUp));
</script>

{@render props.children({
	countUpAmount: countUpAmount.current,
	startCountUp,
	finishCountUp,
	countUpCompleted,
})}
