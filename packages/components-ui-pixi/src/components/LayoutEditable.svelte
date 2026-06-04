<script lang="ts">
	import { stateUi } from 'state-shared';
	import { BLACK } from 'constants-shared/colors';
	import { MainContainer } from 'components-layout';
	import { Container, Rectangle } from 'pixi-svelte';
	import type { LayoutType, Scene } from 'engine-layout';

	import { DESKTOP_BASE_SIZE } from '../constants';
	import { getContext } from '../context';
	import { hudPos } from '../hudPositions';
	import type { LayoutUiProps } from '../types';

	/**
	 * Data-driven HUD: positions the game's HUD snippets from editor scenes
	 * (`hud.bar` = standard-space bottom bar, `hud.corners` = canvas-space logo /
	 * game name) so an author can reposition them in the Invisible Editor. Used by
	 * `<UIDefault>` ONLY when a game passes the `hud` prop; otherwise the original
	 * hardcoded `Layout*` components render unchanged (full parity).
	 *
	 * Snippet CONTENT + the menu drawer stay coded — only placement is data-driven.
	 * Coordinates mirror `LayoutDesktop.svelte` (the fallbacks here are the same
	 * flattened absolute standard-box positions as `referenceLayouts/hud.ts`), so
	 * with the engine-truth HUD scene this renders byte-for-byte as before.
	 *
	 * NOTE: desktop layout for now — the HUD scenes only carry desktop positions;
	 * per-layoutType overrides (tablet/landscape/portrait) are a follow-up.
	 */
	type Props = LayoutUiProps & { hud: { bar?: Scene; corners?: Scene } };
	const props: Props = $props();
	const context = getContext();

	const BAR_BG_WIDTHS = [
		DESKTOP_BASE_SIZE * (188 / 116),
		800,
		350,
		DESKTOP_BASE_SIZE * (340 / 116),
	];
	const BAR_ORIGIN_X = 1920 * 0.5 - 0.5 * BAR_BG_WIDTHS.reduce((s, w) => s + w, 0);
	const BAR_ORIGIN_Y = 1080 - DESKTOP_BASE_SIZE - 10;
	const LABEL_Y = BAR_ORIGIN_Y + DESKTOP_BASE_SIZE * 0.5 - 160;
	const BTN_Y = BAR_ORIGIN_Y + DESKTOP_BASE_SIZE * 0.5;
	const BTN_SCALE = 0.8;

	const layoutType = $derived(context.stateLayoutDerived.layoutType() as LayoutType);
	const canvas = $derived(context.stateLayoutDerived.canvasSizes());

	const b = (id: string, fx: number, fy: number) =>
		hudPos(props.hud.bar, id, layoutType, canvas, {
			x: BAR_ORIGIN_X + fx,
			y: fy,
			scaleX: BTN_SCALE,
			scaleY: BTN_SCALE,
		});
	const c = (id: string, sax: number, say: number, ox: number, oy: number) =>
		hudPos(props.hud.corners, id, layoutType, canvas, {
			x: sax * canvas.width + ox,
			y: say * canvas.height + oy,
		});

	const pos = $derived({
		gameName: c('hud-gamename', 0, 0, 20, 0),
		logo: c('hud-logo', 1, 0, -20, 0),
		balance: b('hud-balance', 900 - 500, LABEL_Y),
		win: b('hud-win', 900, LABEL_Y),
		bet: b('hud-bet', 900 + 500, LABEL_Y),
		menu: b('hud-btn-menu', 220, BTN_Y),
		buyBonus: b('hud-btn-buybonus', 220 + 150, BTN_Y),
		autoSpin: b('hud-btn-autospin', 160 + 150 * 4, BTN_Y),
		betBtn: b('hud-btn-bet', 160 + 150 * 5, BTN_Y),
		turbo: b('hud-btn-turbo', 160 + 150 * 6, BTN_Y),
		decrease: b('hud-btn-decrease', 1440, BTN_Y),
		increase: b('hud-btn-increase', 1440 + 150, BTN_Y),
	});
</script>

<!-- Corners (canvas space) -->
{#if pos.gameName.visible}
	<Container x={pos.gameName.x} y={pos.gameName.y}>
		{@render props.gameName()}
	</Container>
{/if}
{#if pos.logo.visible}
	<Container x={pos.logo.x} y={pos.logo.y}>
		{@render props.logo()}
	</Container>
{/if}

<!-- Bottom bar (standard space) -->
<MainContainer standard alignVertical="bottom">
	{#if pos.balance.visible}
		<Container x={pos.balance.x} y={pos.balance.y} scale={{ x: pos.balance.scaleX, y: pos.balance.scaleY }}>
			{@render props.amountBalance({ stacked: true })}
		</Container>
	{/if}
	{#if pos.win.visible}
		<Container x={pos.win.x} y={pos.win.y} scale={{ x: pos.win.scaleX, y: pos.win.scaleY }}>
			{@render props.amountWin({ stacked: true })}
		</Container>
	{/if}
	{#if pos.bet.visible}
		<Container x={pos.bet.x} y={pos.bet.y} scale={{ x: pos.bet.scaleX, y: pos.bet.scaleY }}>
			{@render props.amountBet({ stacked: true })}
		</Container>
	{/if}
	{#if pos.menu.visible}
		<Container x={pos.menu.x} y={pos.menu.y} scale={{ x: pos.menu.scaleX, y: pos.menu.scaleY }}>
			{@render props.buttonMenu({ anchor: 0.5 })}
		</Container>
	{/if}
	{#if pos.buyBonus.visible}
		<Container x={pos.buyBonus.x} y={pos.buyBonus.y} scale={{ x: pos.buyBonus.scaleX, y: pos.buyBonus.scaleY }}>
			{@render props.buttonBuyBonus({ anchor: 0.5 })}
		</Container>
	{/if}
	{#if pos.autoSpin.visible}
		<Container x={pos.autoSpin.x} y={pos.autoSpin.y} scale={{ x: pos.autoSpin.scaleX, y: pos.autoSpin.scaleY }}>
			{@render props.buttonAutoSpin({ anchor: 0.5 })}
		</Container>
	{/if}
	{#if pos.betBtn.visible}
		<Container x={pos.betBtn.x} y={pos.betBtn.y} scale={{ x: pos.betBtn.scaleX, y: pos.betBtn.scaleY }}>
			{@render props.buttonBet({ anchor: 0.5 })}
		</Container>
	{/if}
	{#if pos.turbo.visible}
		<Container x={pos.turbo.x} y={pos.turbo.y} scale={{ x: pos.turbo.scaleX, y: pos.turbo.scaleY }}>
			{@render props.buttonTurbo({ anchor: 0.5 })}
		</Container>
	{/if}
	{#if pos.decrease.visible}
		<Container x={pos.decrease.x} y={pos.decrease.y} scale={{ x: pos.decrease.scaleX, y: pos.decrease.scaleY }}>
			{@render props.buttonDecrease({ anchor: 0.5 })}
		</Container>
	{/if}
	{#if pos.increase.visible}
		<Container x={pos.increase.x} y={pos.increase.y} scale={{ x: pos.increase.scaleX, y: pos.increase.scaleY }}>
			{@render props.buttonIncrease({ anchor: 0.5 })}
		</Container>
	{/if}
</MainContainer>

<!-- Menu drawer (coded — not editor-driven in v1; mirrors LayoutDesktop) -->
{#if stateUi.menuOpen}
	<Rectangle
		eventMode="static"
		cursor="pointer"
		alpha={0.5}
		anchor={0.5}
		backgroundColor={BLACK}
		width={context.stateLayoutDerived.canvasSizes().width}
		height={context.stateLayoutDerived.canvasSizes().height}
		x={context.stateLayoutDerived.canvasSizes().width * 0.5}
		y={context.stateLayoutDerived.canvasSizes().height * 0.5}
		onpointerup={() => (stateUi.menuOpen = false)}
	/>

	<MainContainer standard alignVertical="bottom">
		<Container
			x={298}
			y={context.stateLayoutDerived.mainLayoutStandard().height - DESKTOP_BASE_SIZE - 10}
		>
			<Container scale={0.8} y={DESKTOP_BASE_SIZE * 0.5 - 150 - 170 * 3}>
				{@render props.buttonPayTable({ anchor: 0.5 })}
			</Container>

			<Container scale={0.8} y={DESKTOP_BASE_SIZE * 0.5 - 150 - 170 * 2}>
				{@render props.buttonGameRules({ anchor: 0.5 })}
			</Container>

			<Container scale={0.8} y={DESKTOP_BASE_SIZE * 0.5 - 150 - 170 * 1}>
				{@render props.buttonSettings({ anchor: 0.5 })}
			</Container>

			<Container scale={0.8} y={DESKTOP_BASE_SIZE * 0.5 - 150}>
				{@render props.buttonSoundSwitch({ anchor: 0.5 })}
			</Container>

			<Container scale={0.8} y={DESKTOP_BASE_SIZE * 0.5}>
				{@render props.buttonMenuClose({ anchor: 0.5 })}
			</Container>
		</Container>
	</MainContainer>
{/if}
