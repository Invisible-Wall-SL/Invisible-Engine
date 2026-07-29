<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { stateBetDerived, stateModal, stateI18nDerived } from 'state-shared';
	import { numberToCurrencyString } from 'utils-shared/amount';

	import UiLabel from './UiLabel.svelte';
	import { getContext } from '../context';
	import { i18nDerived } from '../i18n/i18nDerived';
	import type { UiLabelArgs } from '../types';

	const props: UiLabelArgs = $props();
	const context = getContext();
	// The active mode's label is an authored SOURCE string (Invisible Game Config); translate it so an
	// ante badge localizes, falling back to the generic "BET" when the mode sets none.
	const betAmountLabel = $derived(stateBetDerived.activeBetMode()?.text.betAmountLabel);
	const label = $derived(
		betAmountLabel ? stateI18nDerived.translate(betAmountLabel) : i18nDerived.bet(),
	);
	const value = $derived(numberToCurrencyString(stateBetDerived.betCost()));
	const disabled = $derived(!context.stateXstateDerived.isIdle());

	const onpress = () => {
		if (disabled) return;
		context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
		stateModal.modal = { name: 'betAmountMenu' };
	};
</script>

<Container eventMode="static" cursor={disabled ? 'not-allowed' : 'pointer'} onpointerup={onpress}>
	<UiLabel tiled {label} {value} stacked={props.stacked} style={props.style} text={props.text} />
</Container>
