<script lang="ts">
	import { Container, Graphics } from 'pixi-svelte';
	import { Button } from 'components-pixi';
	import { MainContainer } from 'components-layout';
	import { WHITE } from 'constants-shared/colors';
	import { resolveTransform, STANDARD_MAIN_SIZES_MAP, UI_TEXT, type Scene } from 'engine-layout';
	import { CatalogText } from 'engine-layout/svelte';
	import { stateI18nDerived, stateUi } from 'state-shared';

	import { getContext } from '../game/context';
	import { coinBoardConfig, setCoinBoardLineCount, stateCoinBoard } from '../game/coinBoard.svelte';
	import { coinBoardStepLines } from '../game/coinBoardStake';

	/**
	 * THE LINES SELECTOR (`docs/design/hold-and-win-coin-board.md` §1.3) — a coin board whose player
	 * picks the line count gets − / count / + beside the bet readout, stepping through `choices`. It
	 * reads like the bet readout (the same black panel and caption) and greys out while a round is in
	 * play, the rule the bet − / + follow. Placed to the right of the HUD's `hud-bet` node, or above it
	 * where the standard box has no room; a HUD with no bet node puts it in the bottom-right corner.
	 */
	type Props = { bar: Scene | undefined };
	const { bar }: Props = $props();

	const context = getContext();

	const FONT_SIZE = 45;
	const WIDTH = 200;
	const HEIGHT = FONT_SIZE * 3;
	const PANEL_TOP = -20;
	const STEP_SIZE = 50;
	const GAP = 16;
	/** The bet readout's panel width (`UiLabel`'s tiled ticker). */
	const READOUT_WIDTH = FONT_SIZE * 3 * (326 / 73);

	const layoutType = $derived(context.stateLayoutDerived.layoutType());
	const box = $derived(
		STANDARD_MAIN_SIZES_MAP[layoutType as keyof typeof STANDARD_MAIN_SIZES_MAP] ??
			STANDARD_MAIN_SIZES_MAP.desktop,
	);

	const place = $derived.by(() => {
		const node = bar?.nodes.find((n) => n.id === 'hud-bet');
		const t = node && resolveTransform(node, layoutType);
		if (!t?.visible) {
			const scale = 0.8;
			return {
				x: box.width - GAP - (WIDTH / 2) * scale,
				y: box.height - GAP - (HEIGHT + PANEL_TOP) * scale,
				scale,
			};
		}
		const scale = t.scale?.x ?? 1;
		const right = t.x + (READOUT_WIDTH / 2 + GAP + WIDTH / 2) * scale;
		return right + (WIDTH / 2) * scale <= box.width
			? { x: right, y: t.y, scale }
			: { x: t.x, y: t.y - (HEIGHT + GAP) * scale, scale };
	});

	const board = $derived(coinBoardConfig());
	const choices = $derived(board?.lines.selection === 'player' ? board.lines.choices : []);
	const count = $derived(stateCoinBoard.lineCount ?? 0);
	const idle = $derived(context.stateXstateDerived.isIdle());
	const fewer = $derived(coinBoardStepLines(choices, count, -1));
	const more = $derived(coinBoardStepLines(choices, count, 1));
	// The portrait HUD is a drawer: the selector folds away with it.
	const shown = $derived(!(layoutType === 'portrait' && stateUi.drawerFold));

	const text = { fontFamily: 'proxima-nova', fontSize: FONT_SIZE, fill: WHITE };

	const step = (to: number | undefined) => {
		if (to === undefined) return;
		context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
		setCoinBoardLineCount(to);
	};
</script>

{#snippet stepButton(label: string, to: number | undefined, x: number)}
	{@const disabled = !idle || to === undefined}
	<Button
		{x}
		y={FONT_SIZE * 1.5}
		anchor={0.5}
		sizes={{ width: STEP_SIZE, height: STEP_SIZE }}
		{disabled}
		onpress={() => step(to)}
	>
		{#snippet children({ center })}
			<Graphics
				draw={(graphics) => {
					graphics
						.roundRect(0, 0, STEP_SIZE, STEP_SIZE, STEP_SIZE * 0.3)
						.fill({ color: disabled ? 0x555555 : 0x333333 })
						.stroke({ width: 3, color: WHITE, alpha: disabled ? 0.3 : 0.8 });
				}}
			/>
			<CatalogText
				{...center}
				anchor={0.5}
				text={label}
				style={{ ...text, fontWeight: '600' }}
				alpha={disabled ? 0.4 : 1}
			/>
		{/snippet}
	</Button>
{/snippet}

{#if shown}
	<MainContainer standard alignVertical="bottom">
		<Container x={place.x} y={place.y} scale={place.scale}>
			<Graphics
				draw={(graphics) => {
					graphics.roundRect(-WIDTH / 2, PANEL_TOP, WIDTH, HEIGHT, 35).fill({ color: 0x000000 });
				}}
			/>
			<CatalogText
				anchor={{ x: 0.5, y: 0 }}
				text={stateI18nDerived.translate(UI_TEXT.lines)}
				style={text}
			/>
			{@render stepButton('−', fewer, -WIDTH / 2 + STEP_SIZE / 2 + 12)}
			<CatalogText anchor={0.5} y={FONT_SIZE * 1.5} text={String(count)} style={text} />
			{@render stepButton('+', more, WIDTH / 2 - STEP_SIZE / 2 - 12)}
		</Container>
	</MainContainer>
{/if}
