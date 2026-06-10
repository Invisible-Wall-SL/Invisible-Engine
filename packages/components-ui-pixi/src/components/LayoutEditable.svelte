<script lang="ts">
	import { stateUi } from 'state-shared';
	import { BLACK } from 'constants-shared/colors';
	import { MainContainer } from 'components-layout';
	import { Container, Rectangle } from 'pixi-svelte';
	import { ComponentInstance, LayoutNodeView } from 'engine-layout/svelte';
	import type {
		ComponentInstanceNode,
		LayoutNode,
		LayoutType,
		Scene,
		TextStyle,
	} from 'engine-layout';

	import { DESKTOP_BASE_SIZE, LANDSCAPE_BASE_SIZE } from '../constants';
	import { getContext } from '../context';
	import { hudPos, hudTextOverride, hudStyle, hudText, hudTint } from '../hudPositions';
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

	// Editor-authored font/text overrides for the corner text snippets (logo /
	// game-name) — handed to the coded snippet, which merges them into its `<Text>`.
	const gameNameOverride = $derived(hudTextOverride(props.hud.corners, 'hud-gamename'));
	const logoOverride = $derived(hudTextOverride(props.hud.corners, 'hud-logo'));

	// Editor-authored bar overrides: a text style/caption per LABEL (merged over the
	// coded label styling) and a recolour tint per BUTTON. All optional → absent =
	// the coded default (parity), since the snippet spreads `undefined`.
	type LabelOverride = { style?: Partial<TextStyle>; text?: string };
	const labelOverride = (id: string): LabelOverride => ({
		style: hudStyle(props.hud.bar, id),
		text: hudText(props.hud.bar, id),
	});
	// Engine-path readouts (§14.2 B4.3): any `componentInstance` node the author
	// places in the bar scene mounts via the engine `<ComponentInstance>` at the
	// SAME `hudPos()` Container the coded snippets get — so a converted readout
	// (B4.4) lands exactly where its coded `Label*` sat. The live `hudBarScene()`
	// has NO `componentInstance` nodes, so this list is empty in-game → byte-
	// identical parity. `hudPos()` resolves the node's own transform (its x/y/scale
	// from `resolveTransform`); the fallback is only used if the node is absent,
	// which it never is here (we found it in the same scene).
	const instances = $derived(
		(props.hud.bar?.nodes ?? [])
			.filter((n): n is ComponentInstanceNode => n.kind === 'componentInstance')
			.map((node) => ({
				node,
				pos: hudPos(props.hud.bar, node.id, layoutType, canvas, { x: node.x, y: node.y }),
			})),
	);

	// Stop the double-render (§14 B4.4 / §16.3 B6.3): when a HUD id is now a
	// `componentInstance` node — the readouts (B4.4 converts balance/win/bet to
	// `hudReadout` instances) OR the buttons (B6.4 converts the cluster to `button`
	// instances) — the `instances` loop above renders it via the engine
	// `<ComponentInstance>` path, so the coded snippet for that id (`Label*` /
	// `buttonMenu`/`buttonBet`/…) must NOT also render. `mounted(id)` is true exactly
	// when a `componentInstance` node owns the id. Reverting the hud-scene nodes back to
	// `bind` makes this false again, re-enabling the coded snippet → the old HUD, no
	// other change. The live `hudBarScene()` carries NO `button` instances, so every
	// `mounted('hud-btn-…')` below is false in-game → the coded buttons render exactly
	// as today (B6.3 is parity-safe; the guard only matters once B6.4 converts them).
	// The coded `Label{Balance,Win,Bet}.svelte` + the button snippet props stay in place.
	const mounted = (id: string) => instances.some((instance) => instance.node.id === id);

	// Free author art (§18.5): the coded HUD ids above + the `componentInstance`
	// loop are the only nodes this bespoke renderer drew — so a plain sprite/text/
	// container the author DROPS on a HUD scene in the editor was silently dropped
	// in-game. Render every OTHER node generically through the engine
	// `<LayoutNodeView>` (which applies the node's own transform), in the scene's
	// own space: `hud.bar` is standard (inside the bottom-bar MainContainer),
	// `hud.corners` is canvas. The live seed carries none of these, so this list is
	// empty in-game → byte-identical parity until an author adds art. Rendered
	// BEFORE the coded snippets so a bar-background sits behind them (author zIndex
	// still wins).
	const RESERVED_HUD_IDS = new Set([
		'hud-gamename',
		'hud-logo',
		'hud-balance',
		'hud-win',
		'hud-bet',
		'hud-btn-menu',
		'hud-btn-buybonus',
		'hud-btn-autospin',
		'hud-btn-bet',
		'hud-btn-turbo',
		'hud-btn-decrease',
		'hud-btn-increase',
	]);
	const isFreeNode = (n: LayoutNode): boolean =>
		n.kind !== 'componentInstance' && !RESERVED_HUD_IDS.has(n.id);
	const barFreeNodes = $derived((props.hud.bar?.nodes ?? []).filter(isFreeNode));
	const cornerFreeNodes = $derived((props.hud.corners?.nodes ?? []).filter(isFreeNode));

	const ovr = $derived({
		balance: labelOverride('hud-balance'),
		win: labelOverride('hud-win'),
		bet: labelOverride('hud-bet'),
		menu: hudTint(props.hud.bar, 'hud-btn-menu'),
		buyBonus: hudTint(props.hud.bar, 'hud-btn-buybonus'),
		autoSpin: hudTint(props.hud.bar, 'hud-btn-autospin'),
		betBtn: hudTint(props.hud.bar, 'hud-btn-bet'),
		turbo: hudTint(props.hud.bar, 'hud-btn-turbo'),
		decrease: hudTint(props.hud.bar, 'hud-btn-decrease'),
		increase: hudTint(props.hud.bar, 'hud-btn-increase'),
	});
</script>

<!-- Free author art on the corners scene (canvas space) — see §18.5. -->
{#each cornerFreeNodes as node (node.id)}
	<LayoutNodeView {node} space="canvas" />
{/each}

<!-- Corners (canvas space) -->
{#if pos.gameName.visible}
	<Container x={pos.gameName.x} y={pos.gameName.y}>
		{@render props.gameName(gameNameOverride)}
	</Container>
{/if}
{#if pos.logo.visible}
	<Container x={pos.logo.x} y={pos.logo.y}>
		{@render props.logo(logoOverride)}
	</Container>
{/if}

<!-- Bottom bar (standard space) -->
<MainContainer standard alignVertical="bottom">
	<!-- Free author art on the bar scene (standard space) — see §18.5. Rendered
	     first so a bar-background sits behind the coded HUD; author zIndex wins. -->
	{#each barFreeNodes as node (node.id)}
		<LayoutNodeView {node} space="standard" />
	{/each}
	{#if pos.balance.visible && !mounted('hud-balance')}
		<Container
			x={pos.balance.x}
			y={pos.balance.y}
			scale={{ x: pos.balance.scaleX, y: pos.balance.scaleY }}
		>
			{@render props.amountBalance({ stacked: true, ...ovr.balance })}
		</Container>
	{/if}
	{#if pos.win.visible && !mounted('hud-win')}
		<Container x={pos.win.x} y={pos.win.y} scale={{ x: pos.win.scaleX, y: pos.win.scaleY }}>
			{@render props.amountWin({ stacked: true, ...ovr.win })}
		</Container>
	{/if}
	{#if pos.bet.visible && !mounted('hud-bet')}
		<Container x={pos.bet.x} y={pos.bet.y} scale={{ x: pos.bet.scaleX, y: pos.bet.scaleY }}>
			{@render props.amountBet({ stacked: true, ...ovr.bet })}
		</Container>
	{/if}
	{#if pos.menu.visible && !mounted('hud-btn-menu')}
		<Container x={pos.menu.x} y={pos.menu.y} scale={{ x: pos.menu.scaleX, y: pos.menu.scaleY }}>
			{@render props.buttonMenu({ anchor: 0.5, tint: ovr.menu })}
		</Container>
	{/if}
	{#if pos.buyBonus.visible && !mounted('hud-btn-buybonus')}
		<Container
			x={pos.buyBonus.x}
			y={pos.buyBonus.y}
			scale={{ x: pos.buyBonus.scaleX, y: pos.buyBonus.scaleY }}
		>
			{@render props.buttonBuyBonus({ anchor: 0.5, tint: ovr.buyBonus })}
		</Container>
	{/if}
	{#if pos.autoSpin.visible && !mounted('hud-btn-autospin')}
		<Container
			x={pos.autoSpin.x}
			y={pos.autoSpin.y}
			scale={{ x: pos.autoSpin.scaleX, y: pos.autoSpin.scaleY }}
		>
			{@render props.buttonAutoSpin({ anchor: 0.5, tint: ovr.autoSpin })}
		</Container>
	{/if}
	{#if pos.betBtn.visible && !mounted('hud-btn-bet')}
		<Container
			x={pos.betBtn.x}
			y={pos.betBtn.y}
			scale={{ x: pos.betBtn.scaleX, y: pos.betBtn.scaleY }}
		>
			{@render props.buttonBet({ anchor: 0.5, tint: ovr.betBtn })}
		</Container>
	{/if}
	{#if pos.turbo.visible && !mounted('hud-btn-turbo')}
		<Container x={pos.turbo.x} y={pos.turbo.y} scale={{ x: pos.turbo.scaleX, y: pos.turbo.scaleY }}>
			{@render props.buttonTurbo({ anchor: 0.5, tint: ovr.turbo })}
		</Container>
	{/if}
	{#if pos.decrease.visible && !mounted('hud-btn-decrease')}
		<Container
			x={pos.decrease.x}
			y={pos.decrease.y}
			scale={{ x: pos.decrease.scaleX, y: pos.decrease.scaleY }}
		>
			{@render props.buttonDecrease({ anchor: 0.5, tint: ovr.decrease })}
		</Container>
	{/if}
	{#if pos.increase.visible && !mounted('hud-btn-increase')}
		<Container
			x={pos.increase.x}
			y={pos.increase.y}
			scale={{ x: pos.increase.scaleX, y: pos.increase.scaleY }}
		>
			{@render props.buttonIncrease({ anchor: 0.5, tint: ovr.increase })}
		</Container>
	{/if}

	<!--
		Engine-path readouts (§14.2 B4.3): a `componentInstance` HUD node mounts via
		`<ComponentInstance>` at the same `hudPos()` Container the coded snippets get.
		`space="standard"` matches this `<MainContainer standard>` wrapper so the
		readout's text nodes resolve their transform identically. Empty in the live
		HUD (no `componentInstance` nodes in `hudBarScene()`) → parity.
	-->
	{#each instances as instance (instance.node.id)}
		{#if instance.pos.visible}
			<Container
				x={instance.pos.x}
				y={instance.pos.y}
				scale={{ x: instance.pos.scaleX, y: instance.pos.scaleY }}
			>
				<ComponentInstance node={instance.node} space="standard" />
			</Container>
		{/if}
	{/each}
</MainContainer>

<!-- Menu drawer (coded — not editor-driven in v1; mirrors the per-layout Layout*) -->
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

	{#if layoutType === 'landscape'}
		<MainContainer standard alignVertical="bottom">
			<Container
				x={165}
				y={context.stateLayoutDerived.mainLayoutStandard().height - LANDSCAPE_BASE_SIZE - 130}
			>
				<Container scale={0.8} y={LANDSCAPE_BASE_SIZE * 0.5 - 150 - 170 * 3}>
					{@render props.buttonPayTable({ anchor: 0.5 })}
				</Container>
				<Container scale={0.8} y={LANDSCAPE_BASE_SIZE * 0.5 - 150 - 170 * 2}>
					{@render props.buttonGameRules({ anchor: 0.5 })}
				</Container>
				<Container scale={0.8} y={LANDSCAPE_BASE_SIZE * 0.5 - 150 - 170 * 1}>
					{@render props.buttonSettings({ anchor: 0.5 })}
				</Container>
				<Container scale={0.8} y={LANDSCAPE_BASE_SIZE * 0.5 - 150}>
					{@render props.buttonSoundSwitch({ anchor: 0.5 })}
				</Container>
				<Container scale={0.8} y={LANDSCAPE_BASE_SIZE * 0.5}>
					{@render props.buttonMenuClose({ anchor: 0.5 })}
				</Container>
			</Container>
		</MainContainer>
	{:else if layoutType === 'tablet'}
		<MainContainer standard alignVertical="bottom">
			<Container
				x={100}
				y={context.stateLayoutDerived.mainLayoutStandard().height - DESKTOP_BASE_SIZE - 30}
			>
				<Container y={DESKTOP_BASE_SIZE * 0.5 - 185 - 210 * 3}>
					{@render props.buttonPayTable({ anchor: 0.5 })}
				</Container>
				<Container y={DESKTOP_BASE_SIZE * 0.5 - 185 - 210 * 2}>
					{@render props.buttonGameRules({ anchor: 0.5 })}
				</Container>
				<Container y={DESKTOP_BASE_SIZE * 0.5 - 185 - 210 * 1}>
					{@render props.buttonSettings({ anchor: 0.5 })}
				</Container>
				<Container y={DESKTOP_BASE_SIZE * 0.5 - 185}>
					{@render props.buttonSoundSwitch({ anchor: 0.5 })}
				</Container>
				<Container y={DESKTOP_BASE_SIZE * 0.5}>
					{@render props.buttonMenuClose({ anchor: 0.5 })}
				</Container>
			</Container>
		</MainContainer>
	{:else}
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
{/if}
