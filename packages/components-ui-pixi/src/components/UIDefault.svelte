<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HudTextOverride } from 'engine-layout';

	import type { ButtonProps } from 'components-pixi';
	import { getContextLayout } from 'utils-layout';
	import { EnableSpaceHold } from 'components-shared';

	import UiFadeContainer from './UiFadeContainer.svelte';
	import LayoutDesktop from './LayoutDesktop.svelte';
	import LayoutPortrait from './LayoutPortrait.svelte';
	import LayoutLandscape from './LayoutLandscape.svelte';
	import LayoutTablet from './LayoutTablet.svelte';
	import LayoutEditable from './LayoutEditable.svelte';
	import LabelBalance from './LabelBalance.svelte';
	import LabelWin from './LabelWin.svelte';
	import LabelBet from './LabelBet.svelte';
	import ButtonPayTable from './ButtonPayTable.svelte';
	import ButtonGameRules from './ButtonGameRules.svelte';
	import ButtonSettings from './ButtonSettings.svelte';
	import ButtonBuyBonus from './ButtonBuyBonus.svelte';
	import ButtonBet from './ButtonBet.svelte';
	import ButtonTurbo from './ButtonTurbo.svelte';
	import ButtonAutoSpin from './ButtonAutoSpin.svelte';
	import ButtonIncrease from './ButtonIncrease.svelte';
	import ButtonDecrease from './ButtonDecrease.svelte';
	import ButtonMenu from './ButtonMenu.svelte';
	import ButtonMenuClose from './ButtonMenuClose.svelte';
	import ButtonSoundSwitch from './ButtonSoundSwitch.svelte';

	type Props = {
		gameName: Snippet<[HudTextOverride?]>;
		logo: Snippet<[HudTextOverride?]>;
		/** When provided, the HUD is positioned from these editor scenes (and is
		 * editable in the Invisible Editor); otherwise the coded `Layout*` renders. */
		hud?: import('../types').UiHud;
	};

	const props: Props = $props();

	const { stateLayoutDerived } = getContextLayout();

	const LAYOUT_COMPONENT_MAP = {
		desktop: LayoutDesktop,
		portrait: LayoutPortrait,
		landscape: LayoutLandscape,
		tablet: LayoutTablet,
	};

	const LayoutComponent = $derived(LAYOUT_COMPONENT_MAP[stateLayoutDerived.layoutType()]);
	// Opt-in: a game that passes `hud` scenes drives the HUD from editor data.
	// Portrait keeps the coded layout — its bar is an animated fold-out drawer
	// (behaviour, not static placement), so it's out of the data-driven path.
	const useEditable = $derived(
		Boolean(props.hud?.bar || props.hud?.corners) && stateLayoutDerived.layoutType() !== 'portrait',
	);
</script>

<EnableSpaceHold />

{#snippet gameName(override?: HudTextOverride)}
	{@render props.gameName(override)}
{/snippet}

{#snippet logo(override?: HudTextOverride)}
	{@render props.logo(override)}
{/snippet}

{#snippet amountBalance(labelProps: { stacked?: boolean })}
	<LabelBalance {...labelProps} />
{/snippet}

{#snippet amountWin(labelProps: { stacked?: boolean })}
	<LabelWin {...labelProps} />
{/snippet}

{#snippet amountBet(labelProps: { stacked?: boolean })}
	<LabelBet {...labelProps} />
{/snippet}

{#snippet buttonBuyBonus(buttonProps: Partial<ButtonProps>)}
	<ButtonBuyBonus {...buttonProps} />
{/snippet}

{#snippet buttonBet(buttonProps: Partial<ButtonProps>)}
	<ButtonBet {...buttonProps} />
{/snippet}

{#snippet buttonTurbo(buttonProps: Partial<ButtonProps>)}
	<ButtonTurbo {...buttonProps} />
{/snippet}

{#snippet buttonAutoSpin(buttonProps: Partial<ButtonProps>)}
	<ButtonAutoSpin {...buttonProps} />
{/snippet}

{#snippet buttonIncrease(buttonProps: Partial<ButtonProps>)}
	<ButtonIncrease {...buttonProps} />
{/snippet}

{#snippet buttonDecrease(buttonProps: Partial<ButtonProps>)}
	<ButtonDecrease {...buttonProps} />
{/snippet}

{#snippet buttonMenu(buttonProps: Partial<ButtonProps>)}
	<ButtonMenu {...buttonProps} />
{/snippet}

{#snippet buttonMenuClose(buttonProps: Partial<ButtonProps>)}
	<ButtonMenuClose {...buttonProps} />
{/snippet}

{#snippet buttonPayTable(buttonProps: Partial<ButtonProps>)}
	<ButtonPayTable {...buttonProps} />
{/snippet}

{#snippet buttonGameRules(buttonProps: Partial<ButtonProps>)}
	<ButtonGameRules {...buttonProps} />
{/snippet}

{#snippet buttonSettings(buttonProps: Partial<ButtonProps>)}
	<ButtonSettings {...buttonProps} />
{/snippet}

{#snippet buttonSoundSwitch(buttonProps: Partial<ButtonProps>)}
	<ButtonSoundSwitch {...buttonProps} />
{/snippet}

<UiFadeContainer>
	{#if useEditable}
		<LayoutEditable
			hud={props.hud ?? {}}
			{gameName}
			{logo}
			{amountBalance}
			{amountWin}
			{amountBet}
			{buttonBuyBonus}
			{buttonBet}
			{buttonTurbo}
			{buttonAutoSpin}
			{buttonIncrease}
			{buttonDecrease}
			{buttonMenu}
			{buttonMenuClose}
			{buttonPayTable}
			{buttonGameRules}
			{buttonSettings}
			{buttonSoundSwitch}
		/>
	{:else}
		<LayoutComponent
			{gameName}
			{logo}
			{amountBalance}
			{amountWin}
			{amountBet}
			{buttonBuyBonus}
			{buttonBet}
			{buttonTurbo}
			{buttonAutoSpin}
			{buttonIncrease}
			{buttonDecrease}
			{buttonMenu}
			{buttonMenuClose}
			{buttonPayTable}
			{buttonGameRules}
			{buttonSettings}
			{buttonSoundSwitch}
		/>
	{/if}
</UiFadeContainer>
