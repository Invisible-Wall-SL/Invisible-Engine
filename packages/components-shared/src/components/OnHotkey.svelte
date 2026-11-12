<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { getContextEventEmitter } from 'utils-event-emitter';
	import { createInterruptible } from 'utils-shared/interruptible';
	import { waitForTimeout } from 'utils-shared/wait';

	import { hotkeyPressesFor, listensTo } from '../hotkeyPress';
	import type { EmitterEventHotKey } from '../types';

	type Props = {
		hotkey: string;
		disabled?: boolean;
		/** How long a press must last to become a hold (default 400 ms). */
		holdMs?: number;
		/** Acting on a press takes it: a press belongs to the newest hotkey listening for it when the
		 *  key goes down, and the others let it pass (`hotkeyPress.ts`). Without `onpress` (a hold
		 *  alone) the hotkey takes no press and sees every one. */
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
	const presses = hotkeyPressesFor(context.eventEmitter);
	const owner = Symbol('hotkey');
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

	const listener = () => ({
		hotkey: props.hotkey,
		disabled: props.disabled,
		ignorePressInProgress: props.ignorePressInProgress,
		pressSeen,
	});

	onMount(() => {
		const leave = props.onpress
			? presses.join(owner, (event) => listensTo(event, listener()) === 'keyDown')
			: undefined;
		const unsubscribe = context.eventEmitter.subscribe({
			hotKey: (emitterEvent) => {
				const action = listensTo(emitterEvent, listener());
				if (!action) return;
				if (props.onpress && !presses.owns(emitterEvent, owner)) return;
				if (action === 'keyUp') return keyUp();
				return keyDown();
			},
		});
		return () => {
			unsubscribe();
			leave?.();
		};
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
