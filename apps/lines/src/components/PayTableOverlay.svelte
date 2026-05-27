<script lang="ts">
	import { Sprite, Text } from 'pixi-svelte';
	import { FadeContainer } from 'components-pixi';
	import { CanvasSizeRectangle, MainContainer, OnPressFullScreen } from 'components-layout';
	import { stateModal } from 'state-shared';
	import { buildPayTableRows } from 'utils-shared/paytable';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_SIZE } from '../game/constants';
	import { PAYTABLE, NUM_LINES } from '../game/paytable';
	import type { SymbolName } from '../game/types';

	const context = getContext();

	const show = $derived(stateModal.modal?.name === 'payTable');
	const rows = $derived(buildPayTableRows(PAYTABLE, NUM_LINES));

	const COLS = 3;
</script>

<FadeContainer {show}>
	<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.92} />

	<MainContainer>
		{@const W = context.stateLayoutDerived.mainLayout().width}
		{@const H = context.stateLayoutDerived.mainLayout().height}
		{@const top = H * 0.16}
		{@const bottom = H * 0.94}
		{@const nRows = Math.ceil(rows.length / COLS)}
		{@const cellW = W / COLS}
		{@const cellH = (bottom - top) / nRows}
		{@const icon = Math.min(cellW * 0.32, cellH * 0.66)}
		{@const lineH = cellH * 0.2}

		<Text
			x={W * 0.5}
			y={H * 0.07}
			anchor={0.5}
			text="PAYTABLE"
			style={{
				fontFamily: 'proxima-nova',
				fontSize: SYMBOL_SIZE * 0.6,
				fontWeight: '700',
				fill: 0xffd24a,
			}}
		/>

		{#each rows as row, i}
			{@const col = i % COLS}
			{@const r = Math.floor(i / COLS)}
			{@const cx = cellW * col + cellW * 0.5}
			{@const cy = top + cellH * r + cellH * 0.5}
			{@const info = getSymbolInfo({ rawSymbol: { name: row.symbol as SymbolName }, state: 'static' })}

			<Sprite
				key={info.assetKey}
				anchor={0.5}
				x={cx - cellW * 0.26}
				y={cy}
				width={icon * info.sizeRatios.width}
				height={icon * info.sizeRatios.height}
			/>

			{#each row.payouts as p, j}
				<Text
					x={cx - cellW * 0.02}
					y={cy - lineH + j * lineH}
					anchor={{ x: 0, y: 0.5 }}
					text={`x${p.occurs}   ${p.amountText}`}
					style={{
						fontFamily: 'proxima-nova',
						fontSize: cellH * 0.15,
						fontWeight: '600',
						fill: 0xffffff,
					}}
				/>
			{/each}
		{/each}
	</MainContainer>

	{#if show}
		<OnPressFullScreen onpress={() => (stateModal.modal = null)} />
	{/if}
</FadeContainer>
