<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HudTextOverride } from 'engine-layout';

	import { getContextLayout } from 'utils-layout';
	import { EnableSpaceHold } from 'components-shared';

	import { hudHasPortrait } from '../hudPositions';

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

	type UiLabelArgs = import('../types').UiLabelArgs;
	type UiButtonArgs = import('../types').UiButtonArgs;

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
	// Portrait's coded layout is an animated fold-out drawer (behaviour, not static
	// placement), so it joins the data-driven path ONLY when the doc actually carries
	// portrait authoring (`hudHasPortrait`) — `LayoutEditable` then reproduces the
	// drawer fold while positioning each element at its authored portrait coords. A
	// doc with no portrait overrides keeps rendering the coded `LayoutPortrait`
	// (parity for `apps/lines` + un-refreshed docs). The other three layoutTypes use
	// the editable path whenever any HUD scene is passed, unchanged.
	const useEditable = $derived(
		Boolean(props.hud?.bar || props.hud?.corners) &&
			(stateLayoutDerived.layoutType() !== 'portrait' || hudHasPortrait(props.hud)),
	);
</script>

<EnableSpaceHold />

{#snippet gameName(override?: HudTextOverride)}
	{@render props.gameName(override)}
{/snippet}

{#snippet logo(override?: HudTextOverride)}
	{@render props.logo(override)}
{/snippet}

{#snippet amountBalance(labelProps: UiLabelArgs)}
	<LabelBalance {...labelProps} />
{/snippet}

{#snippet amountWin(labelProps: UiLabelArgs)}
	<LabelWin {...labelProps} />
{/snippet}

{#snippet amountBet(labelProps: UiLabelArgs)}
	<LabelBet {...labelProps} />
{/snippet}

{#snippet buttonBuyBonus(buttonProps: UiButtonArgs)}
	<ButtonBuyBonus {...buttonProps} />
{/snippet}

{#snippet buttonBet(buttonProps: UiButtonArgs)}
	<ButtonBet {...buttonProps} />
{/snippet}

{#snippet buttonTurbo(buttonProps: UiButtonArgs)}
	<ButtonTurbo {...buttonProps} />
{/snippet}

{#snippet buttonAutoSpin(buttonProps: UiButtonArgs)}
	<ButtonAutoSpin {...buttonProps} />
{/snippet}

{#snippet buttonIncrease(buttonProps: UiButtonArgs)}
	<ButtonIncrease {...buttonProps} />
{/snippet}

{#snippet buttonDecrease(buttonProps: UiButtonArgs)}
	<ButtonDecrease {...buttonProps} />
{/snippet}

{#snippet buttonMenu(buttonProps: UiButtonArgs)}
	<ButtonMenu {...buttonProps} />
{/snippet}

{#snippet buttonMenuClose(buttonProps: UiButtonArgs)}
	<ButtonMenuClose {...buttonProps} />
{/snippet}

{#snippet buttonPayTable(buttonProps: UiButtonArgs)}
	<ButtonPayTable {...buttonProps} />
{/snippet}

{#snippet buttonGameRules(buttonProps: UiButtonArgs)}
	<ButtonGameRules {...buttonProps} />
{/snippet}

{#snippet buttonSettings(buttonProps: UiButtonArgs)}
	<ButtonSettings {...buttonProps} />
{/snippet}

{#snippet buttonSoundSwitch(buttonProps: UiButtonArgs)}
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
