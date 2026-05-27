<script lang="ts">
	import type { Snippet } from 'svelte';

	import ModalError from './ModalError.svelte';
	import ModalBetMenu from './ModalBetMenu.svelte';
	import ModalBuyBonus from './ModalBuyBonus.svelte';
	import ModalBuyBonusConfirm from './ModalBuyBonusConfirm.svelte';
	import ModalAutoSpin from './ModalAutoSpin.svelte';
	import ModalAutoSpinMessage from './ModalAutoSpinMessage.svelte';
	import ModalPayTable from './ModalPayTable.svelte';
	import ModalGameRules from './ModalGameRules.svelte';
	import ModalSettings from './ModalSettings.svelte';

	type Props = {
		version: Snippet;
		// Names of modals a game renders itself (e.g. an in-canvas Pixi paytable),
		// so the shared HTML modal is suppressed for them. Defaults to none.
		disabledModals?: string[];
	};

	const props: Props = $props();
	const isDisabled = (name: string) => props.disabledModals?.includes(name) ?? false;
</script>

<ModalError />
<ModalBetMenu />
<ModalBuyBonus />
<ModalBuyBonusConfirm />
<ModalAutoSpin />
<ModalAutoSpinMessage />
{#if !isDisabled('payTable')}
	<ModalPayTable>
		{@render props.version()}
	</ModalPayTable>
{/if}
{#if !isDisabled('gameRules')}
	<ModalGameRules>
		{@render props.version()}
	</ModalGameRules>
{/if}
<ModalSettings />

<style lang="scss">
	:global(html) {
		font-size: 16px; /* you can chose any size here 16 is default */
		@media screen and (max-width: 500px) {
			font-size: 50%;
		}
	}
</style>
