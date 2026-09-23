<script lang="ts">
	import { Button } from 'components-shared';
	import { stateModal, stateBetDerived, armAutoSpins } from 'state-shared';
	import { getContextEventEmitter } from 'utils-event-emitter';

	import BaseIcon from './BaseIcon.svelte';
	import BaseButtonContent from './BaseButtonContent.svelte';
	import { i18nDerived } from '../i18n/i18nDerived';
	import type { EmitterEventModal } from '../types';

	const { eventEmitter } = getContextEventEmitter<EmitterEventModal>();

	const startAutoBet = () => {
		// The four state writes live in `armAutoSpins` (state-shared), shared with the authored Pixi
		// auto-spin screen and the flow's `startAutoSpins` action, so the three cannot drift.
		armAutoSpins();
		eventEmitter.broadcast({ type: 'soundPressGeneral' });
		eventEmitter.broadcast({ type: 'autoBet' });
		stateModal.modal = null;
	};
</script>

<Button disabled={!stateBetDerived.isBetCostAvailable()} onclick={startAutoBet}>
	<BaseIcon width="100%" height="3rem" />
	<BaseButtonContent>
		<span style="font-size: 1rem;">{i18nDerived.startAutoplay()}</span>
	</BaseButtonContent>
</Button>
