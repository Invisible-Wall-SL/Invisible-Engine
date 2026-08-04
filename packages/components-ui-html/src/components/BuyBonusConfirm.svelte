<script lang="ts" module>
	import type { Scene } from 'engine-layout';

	export type Props = {
		/** The takeover z-band (games pass the shared `LAYER_BAND_TAKEOVER`). */
		zIndex: number;
		/** The authored/fallback `buyConfirm` scene; omit ⇒ the engine default (`defaultConfirmScene`). */
		scene?: Scene;
	};
</script>

<script lang="ts">
	import { stateBet, stateModal, stateUi, stateI18nDerived, INFINITY_MARK } from 'state-shared';
	import { getContextEventEmitter } from 'utils-event-emitter';
	import { ConfirmDialog } from 'engine-layout/svelte';

	import { stateBonus, stateBonusDerived } from '../stateBonus.svelte';
	import { i18nDerived } from '../i18n/i18nDerived';
	import type { EmitterEventModal } from '../types';

	// The state-coupled CONFIRM wiring — the in-canvas twin of the retired HTML `ModalBuyBonusConfirm`.
	// `engine-layout` stays state-agnostic, so all `stateBonus`/`stateModal`/`stateBet` reads live here
	// (mirrors `registerBuyFeature`). Shown when a card press advanced the modal to `buyBonusConfirm`;
	// CONFIRM commits the picked bet mode, CANCEL/backdrop-tap returns to the pixi SELECT screen.
	const { zIndex, scene }: Props = $props();

	const { eventEmitter } = getContextEventEmitter<EmitterEventModal>();

	// Source strings authored in Invisible Game Config; translate at render so they localize (parity
	// with the deleted modal, which wrapped every field in `stateI18nDerived.translate`).
	const translate = (value: string) => stateI18nDerived.translate(value);

	const open = $derived(stateModal.modal?.name === 'buyBonusConfirm');
	const mode = $derived(stateBonusDerived.selectedBetModeData());
	const values = $derived({
		title: translate(mode?.text.title ?? ''),
		message: translate(mode?.text.dialog ?? ''),
		confirmLabel: i18nDerived.confirm(),
		cancelLabel: i18nDerived.cancel(),
		imageKey: mode?.assets.dialogImage ?? '',
	});

	// CONFIRM — the EXACT contract of the deleted `ModalBuyBonusConfirm`: commit the picked bet mode;
	// a `buy` mode broadcasts `bet`; an `activate` mode raises the auto-spin limits to infinity; then
	// the general press sound + close the modal.
	const onConfirm = () => {
		stateBet.activeBetModeKey = stateBonus.selectedBetModeKey;

		const data = stateBonusDerived.selectedBetModeData();
		if (data.type === 'buy') {
			eventEmitter.broadcast({ type: 'bet' });
		}
		if (data.type === 'activate') {
			stateUi.autoSpinsLossLimitText = INFINITY_MARK;
			stateUi.autoSpinsSingleWinLimitText = INFINITY_MARK;
		}

		eventEmitter.broadcast({ type: 'soundPressGeneral' });
		stateModal.modal = null;
	};

	// CANCEL / backdrop tap — back to the pixi SELECT screen (`buyBonus`), exactly as the modal's close.
	const onCancel = () => {
		stateModal.modal = { name: 'buyBonus' };
	};
</script>

<ConfirmDialog {open} {values} {onConfirm} {onCancel} {zIndex} {scene} />
