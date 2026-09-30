<script lang="ts" module>
	import type { Scene } from 'engine-layout';

	export type Props = {
		/** The takeover z-band (games pass the shared `LAYER_BAND_TAKEOVER`). */
		zIndex: number;
		/** The authored `roundConfirm` scene; omit ⇒ the engine default (`defaultConfirmScene`). */
		scene?: Scene;
	};
</script>

<script lang="ts">
	import { answerRoundStart, stateBetDerived, stateRoundConfirm } from 'state-shared';
	import { getContextEventEmitter } from 'utils-event-emitter';
	import { numberToCurrencyString } from 'utils-shared/amount';
	import { ConfirmDialog } from 'engine-layout/svelte';

	import { i18nDerived } from '../i18n/i18nDerived';
	import type { EmitterEventModal } from '../types';

	// The operator's round-start confirmation (`confirmGameRoundStart`) — the question
	// `requestRoundStart` holds a paid round on. Open only while one is pending, so a launch whose
	// operator never asked mounts nothing. CANCEL and a backdrop tap are both a NO: the round is not
	// placed.
	const { zIndex, scene }: Props = $props();

	const { eventEmitter } = getContextEventEmitter<EmitterEventModal>();

	const open = $derived(stateRoundConfirm.open);
	// The stake rides on the message line: it is the amount the player is agreeing to place, and it
	// needs no string of its own.
	const stake = $derived(numberToCurrencyString(stateBetDerived.betCost()));
	const values = $derived({
		title: i18nDerived.roundConfirmTitle(),
		message: `${i18nDerived.roundConfirmMessage()}\n${stake}`,
		confirmLabel: i18nDerived.confirm(),
		cancelLabel: i18nDerived.cancel(),
		imageKey: '',
	});

	const onConfirm = () => {
		eventEmitter.broadcast({ type: 'soundPressGeneral' });
		answerRoundStart(true);
	};

	const onCancel = () => answerRoundStart(false);

	// The game binds Space (spin, hold-to-autoplay) and Enter on the window; while the question is
	// open they must not reach it. Only the key-DOWN is held back: a Space hold that started the
	// round still gets its key-up, so the hold ends when the key is released rather than outliving it.
	$effect(() => {
		if (!open) return;
		const block = (event: KeyboardEvent) => {
			if (event.key !== ' ' && event.key !== 'Enter') return;
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		window.addEventListener('keydown', block, true);
		return () => window.removeEventListener('keydown', block, true);
	});
</script>

<ConfirmDialog {open} {values} {onConfirm} {onCancel} {zIndex} {scene} />
