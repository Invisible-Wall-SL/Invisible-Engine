<script lang="ts">
	import { Button, Popup } from 'components-shared';
	import { zIndex } from 'constants-shared/zIndex';
	import { stateBet, stateModal, stateUi, stateI18nDerived, INFINITY_MARK } from 'state-shared';
	import { getContextEventEmitter } from 'utils-event-emitter';

	import BaseIcon from './BaseIcon.svelte';
	import BaseTitle from './BaseTitle.svelte';
	import BaseContent from './BaseContent.svelte';
	import BaseScrollable from './BaseScrollable.svelte';
	import BaseButtonWrap from './BaseButtonWrap.svelte';
	import BaseButtonContent from './BaseButtonContent.svelte';
	import { stateBonus, stateBonusDerived } from '../stateBonus.svelte';
	import { i18nDerived } from '../i18n/i18nDerived';
	import type { EmitterEventModal } from '../types';

	const { eventEmitter } = getContextEventEmitter<EmitterEventModal>();

	// Source strings authored in Invisible Game Config; translate at render so they localize.
	const translate = (value: string) => stateI18nDerived.translate(value);

	const confirm = () => {
		stateBet.activeBetModeKey = stateBonus.selectedBetModeKey;

		if (stateBonusDerived.selectedBetModeData().type === 'buy') {
			eventEmitter.broadcast({ type: 'bet' });
		}

		if (stateBonusDerived.selectedBetModeData().type === 'activate') {
			stateUi.autoSpinsLossLimitText = INFINITY_MARK;
			stateUi.autoSpinsSingleWinLimitText = INFINITY_MARK;
		}
	};
</script>

{#if stateModal.modal?.name === 'buyBonusConfirm'}
	<Popup zIndex={zIndex.dialog} onclose={() => (stateModal.modal = { name: 'buyBonus' })}>
		<BaseContent maxWidth="500px">
			<BaseTitle>
				{translate(stateBonusDerived.selectedBetModeData().text.title)}
			</BaseTitle>
			<BaseScrollable type="column">
				{translate(stateBonusDerived.selectedBetModeData().text.dialog)}
			</BaseScrollable>
			<BaseButtonWrap type="max-width">
				<Button
					data-test="confirm-button"
					onclick={() => {
						confirm();
						eventEmitter.broadcast({ type: 'soundPressGeneral' });
						stateModal.modal = null;
					}}
				>
					<BaseIcon width="100%" height="3rem" />
					<BaseButtonContent>
						<span style="font-size: 1rem;">{i18nDerived.confirm()}</span>
					</BaseButtonContent>
				</Button>
			</BaseButtonWrap>
		</BaseContent>
	</Popup>
{/if}
