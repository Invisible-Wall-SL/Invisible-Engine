<script lang="ts">
	import { onDestroy } from 'svelte';

	import { getContextEventEmitter } from 'utils-event-emitter';
	import { createInterruptible } from 'utils-shared/interruptible';
	import { waitForTimeout } from 'utils-shared/wait';

	import type { EmitterEventHotKey } from '../types';

	type Props = {
		hotkey: string;
		disabled?: boolean;
		/** How long a press must last to become a hold (default 400 ms). */
		holdMs?: number;
		onpress?: () => void;
		onpressend?: () => void;
		onhold?: () => void;
		onholdend?: () => void;
		/** Act only on a press that STARTS while this hotkey is listening, and once per press: a key
		 *  already held when it mounted (or was re-enabled) auto-repeats `keyDown`, and neither that nor
		 *  the repeat of a press it did see is a new press. For a surface that arms mid-press — a
		 *  tap-to-continue must not take the held Space that armed it. */
		ignorePressInProgress?: boolean;
	};

	const props: Props = $props();
	const context = getContextEventEmitter<EmitterEventHotKey>();
	const interruptible = createInterruptible();
	const WAIT_TO_HOLD_TIMEOUT = 400;
	let isHolding = $state(false);
	let isWaitingToHold = $state(false);
	// From a press's first `keyDown` this hotkey received until its `keyUp`.
	let pressSeen = false;

	const holdTimeoutStart = async () => {
		isWaitingToHold = true;
		const { interrupted } = await interruptible.add(() =>
			waitForTimeout(props.holdMs ?? WAIT_TO_HOLD_TIMEOUT),
		);
		if (!interrupted) {
			isHolding = true;
			props.onhold?.();
		}
	};

	const holdTimeoutStop = () => {
		isWaitingToHold = false;
		interruptible.interrupt();
		interruptible.clear();
	};

	const keyDown = () => {
		pressSeen = true;
		if (!isWaitingToHold) holdTimeoutStart();
		if (!isHolding) props.onpress?.();
	};

	const keyUp = () => {
		pressSeen = false;
		if (isWaitingToHold) holdTimeoutStop();

		if (isHolding) {
			props.onholdend?.();
		} else {
			props.onpressend?.();
		}

		isHolding = false;
	};

	// A window that loses focus never gets the key's `keyUp` (it goes to whatever took focus), so a hold
	// would outlive the key — for `EnableSpaceHold`, paid rounds with nobody at the game. End a hold
	// there and drop a press that is not one yet, rather than completing it as a release.
	const cancelPress = () => {
		pressSeen = false;
		if (isWaitingToHold) holdTimeoutStop();
		if (isHolding) props.onholdend?.();
		isHolding = false;
	};

	const onVisibilityChange = () => {
		if (document.visibilityState === 'hidden') cancelPress();
	};

	context.eventEmitter.subscribeOnMount({
		hotKey: (emitterEvent) => {
			if (props.disabled) return;
			if (emitterEvent.key !== props.hotkey) return;
			if (props.ignorePressInProgress) {
				if (emitterEvent.repeat) return;
				if (emitterEvent.action === 'keyUp' && !pressSeen) return;
			}
			if (emitterEvent.action === 'keyUp') return keyUp();
			if (emitterEvent.action === 'keyDown') return keyDown();
		},
	});

	$effect(() => {
		if (props.disabled) keyUp();
	});

	onDestroy(() => keyUp());

	$effect(() => {
		if (isHolding) props.onhold?.();
	});
</script>

<svelte:window onblur={cancelPress} />
<svelte:document onvisibilitychange={onVisibilityChange} />
