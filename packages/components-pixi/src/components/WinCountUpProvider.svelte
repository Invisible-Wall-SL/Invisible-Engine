<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { type Snippet } from 'svelte';

	import { createInterruptible } from 'utils-shared/interruptible';
	import { roundSkip } from 'utils-shared/skipToken';

	type Props = {
		amount: number;
		duration: number;
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

	const countUp = () =>
		countUpAmount.set(props.amount, { duration: roundSkip.isSkipped() ? 0 : props.duration });
	const resetCountUp = () => countUpAmount.set(props.amount, { duration: 0 });
	const finishCountUp = () => interruptible.interrupt();
	const startCountUp = async () => {
		await interruptible.add(countUp);
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
