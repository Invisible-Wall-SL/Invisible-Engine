<script lang="ts">
	import { Container, Sprite, Text, Rectangle, SpineProvider, SpineTrack } from 'pixi-svelte';
	import { FadeContainer } from 'components-pixi';
	import { MainContainer } from 'components-layout';
	import { getContextLayout } from 'utils-layout';
	import { stateModal, stateI18nDerived } from 'state-shared';
	import { buildPayTableRows } from 'utils-shared/paytable';

	import type { InfoManifest } from '../types';
	import InfoPaylineGrid from './InfoPaylineGrid.svelte';

	type Props = { manifest: InfoManifest };
	const props: Props = $props();

	// Translate any string through the active locale catalog (falls back to the
	// English key when no translation is loaded). Page titles live in the shared
	// components-ui-pixi catalog; per-game rule strings live in the game catalog.
	const tr = (value: string) => stateI18nDerived.translate(value);

	// Screenshot mode (?screenshotLines=1): draw the red payline overlay and
	// expose a deterministic hook for the automated screenshot pipeline. Never
	// active in normal play.
	const screenshotMode =
		typeof location !== 'undefined' && new URLSearchParams(location.search).get('screenshotLines') === '1';
	$effect(() => {
		if (!screenshotMode || typeof window === 'undefined') return;
		(window as unknown as { __info?: unknown }).__info = {
			open: (name: string | null) => (stateModal.modal = name ? { name } : null),
			page: (n: number) => (page = n),
		};
	});

	const { stateLayoutDerived } = getContextLayout();

	// Two entry points share this overlay:
	//  - the PAYTABLE button (modal 'payTable') -> the symbol pay table only
	//  - the INFO button     (modal 'gameRules') -> paylines + game rules
	const modalName = $derived(stateModal.modal?.name);
	const show = $derived(modalName === 'payTable' || modalName === 'gameRules');
	const isInfo = $derived(modalName === 'gameRules');
	const pages = $derived(isInfo ? ['GAME RULES', 'PAYLINES'] : ['PAYTABLE']);

	let page = $state(0);
	// reset to the first page whenever the modal opens, closes, or switches button
	$effect(() => {
		modalName;
		page = 0;
	});

	const rows = $derived(buildPayTableRows(props.manifest.paytable, props.manifest.numLines));

	const t = $derived(props.manifest.theme ?? {});
	const font = $derived(t.fontFamily ?? 'proxima-nova');
	const accent = $derived(t.accentColor ?? 0xffd24a);
	const titleColor = $derived(t.titleColor ?? accent);
	const textColor = $derived(t.textColor ?? 0xffffff);
	const dimColor = $derived(t.dimColor ?? 0x000000);
	const dimAlpha = $derived(t.dimAlpha ?? 0.92);

	const BAR_BASE: Record<string, number> = {
		desktop: 135,
		landscape: 165,
		tablet: 180,
		portrait: 198,
		almostSquare: 198,
	};

	const stacked = $derived(['portrait', 'almostSquare'].includes(stateLayoutDerived.layoutType()));
	const symCols = $derived(stacked ? 2 : 3);
	const plCols = $derived(stacked ? 2 : 5);
</script>

<FadeContainer {show}>
	{@const ch = stateLayoutDerived.canvasSizes().height}
	{@const cw = stateLayoutDerived.canvasSizes().width}
	{@const std = stateLayoutDerived.mainLayoutStandard()}
	{@const base = BAR_BASE[stateLayoutDerived.layoutType()] ?? 150}
	{@const barTopStd = std.height - base - 24}
	{@const barTopCanvas = ch / 2 + (barTopStd - std.height / 2) * std.scale}

	<!-- Dim only down to the control bar; non-interactive so the bet controls
	     underneath stay visible and usable while the info page is open. -->
	<Rectangle
		eventMode="none"
		x={0}
		y={0}
		width={cw}
		height={Math.max(barTopCanvas, 0)}
		backgroundColor={dimColor}
		backgroundAlpha={dimAlpha}
	/>

	<MainContainer standard>
		{@const W = std.width}
		{@const contentTop = std.height * 0.15}
		{@const contentBottom = barTopStd - std.height * 0.01}
		{@const current = pages[page] ?? pages[0]}

		<Container eventMode="none">
			<Text
				x={W * 0.5}
				y={std.height * 0.05}
				anchor={0.5}
				text={tr(current)}
				style={{ fontFamily: font, fontSize: Math.min(W * 0.06, props.manifest.symbolSize * 0.6), fontWeight: '700', fill: titleColor }}
			/>
			{#if pages.length > 1}
				<Text
					x={W * 0.5}
					y={std.height * 0.095}
					anchor={0.5}
					text={`${page + 1} / ${pages.length}`}
					style={{ fontFamily: font, fontSize: W * 0.02, fontWeight: '600', fill: 0xaaaaaa }}
				/>
			{/if}
		</Container>

		{#if current === 'PAYTABLE'}
			<!-- ===== PAYTABLE ===== -->
			{@const nRows = Math.ceil(rows.length / symCols)}
			{@const cellW = W / symCols}
			{@const cellH = (contentBottom - contentTop) / nRows}
			{@const iconBox = Math.min(cellW * 0.24, cellH * 0.7)}
			{@const fontSize = Math.min(cellW * 0.072, cellH * 0.16)}
			{@const lineH = fontSize * 1.3}

			<Container eventMode="none">
				{#each rows as row, i}
					{@const col = i % symCols}
					{@const r = Math.floor(i / symCols)}
					{@const cellX = cellW * col}
					{@const cy = contentTop + cellH * r + cellH * 0.5}
					{@const iconX = cellX + cellW * 0.16}
					{@const textX = cellX + cellW * 0.34}
					{@const blockTop = cy - ((row.payouts.length - 1) / 2) * lineH}
					{@const icon = props.manifest.symbols[row.symbol]}

					{#if icon}
						{#if icon.type === 'sprite'}
							<Sprite key={icon.assetKey} anchor={0.5} x={iconX} y={cy} width={iconBox * icon.sizeRatios.width} height={iconBox * icon.sizeRatios.height} />
						{:else}
							<SpineProvider key={icon.assetKey} anchor={0.5} x={iconX} y={cy} height={props.manifest.symbolSize * icon.sizeRatios.height}>
								<SpineTrack trackIndex={0} animationName={icon.animationName ?? ''} loop={true} />
							</SpineProvider>
						{/if}
					{/if}

					{#each row.payouts as p, j}
						<Text x={textX} y={blockTop + j * lineH} anchor={{ x: 0, y: 0.5 }} text={`x${p.occurs}   ${p.amountText}`} style={{ fontFamily: font, fontSize, fontWeight: '600', fill: textColor }} />
					{/each}
				{/each}
			</Container>
		{:else if current === 'PAYLINES'}
			<!-- ===== PAYLINES ===== -->
			{@const nGridRows = Math.ceil(props.manifest.paylines.length / plCols)}
			{@const colW = W / plCols}
			{@const rowH = (contentBottom - contentTop) / nGridRows}
			{@const cell = Math.min(colW * 0.15, rowH * 0.26)}

			<Container eventMode="none">
				{#each props.manifest.paylines as line, i}
					{@const col = i % plCols}
					{@const r = Math.floor(i / plCols)}
					{@const gridX = col * colW + colW * 0.22}
					{@const gridY = contentTop + r * rowH + (rowH - cell * props.manifest.numRows) / 2}
					<InfoPaylineGrid {line} rows={props.manifest.numRows} x={gridX} y={gridY} {cell} label={`${i + 1}`} accentColor={accent} fontFamily={font} showLine={screenshotMode} />
				{/each}
			</Container>
		{:else}
			<!-- ===== GAME RULES ===== -->
			{@const blockH = (contentBottom - contentTop) / Math.max(props.manifest.rules.length, 1)}
			{@const headSize = Math.min(W * 0.028, blockH * 0.24)}
			{@const bodySize = Math.min(W * 0.022, blockH * 0.2)}

			<Container eventMode="none">
				{#each props.manifest.rules as rule, i}
					{@const by = contentTop + blockH * i}
					<Text x={W * 0.1} y={by} anchor={{ x: 0, y: 0 }} text={tr(rule.heading)} style={{ fontFamily: font, fontSize: headSize, fontWeight: '700', fill: titleColor }} />
					<Text
						x={W * 0.1}
						y={by + headSize * 1.4}
						anchor={{ x: 0, y: 0 }}
						text={tr(rule.body)}
						style={{ fontFamily: font, fontSize: bodySize, fontWeight: '500', fill: textColor, wordWrap: true, wordWrapWidth: W * 0.8, lineHeight: bodySize * 1.3 }}
					/>
				{/each}
			</Container>
		{/if}

		{#if show}
			{@const cb = Math.min(W * 0.05, 90)}
			{@const navY = (contentTop + contentBottom) / 2}
			{@const navR = Math.min(W * 0.04, 70)}

			<!-- close -->
			<Rectangle eventMode="static" cursor="pointer" onpointerup={() => (stateModal.modal = null)} x={W - cb * 1.5} y={std.height * 0.03} width={cb} height={cb} borderRadius={cb * 0.2} backgroundColor={dimColor} backgroundAlpha={0.6} borderColor={accent} borderWidth={2} />
			<Text eventMode="none" x={W - cb * 1.5 + cb / 2} y={std.height * 0.03 + cb / 2} anchor={0.5} text="✕" style={{ fontFamily: font, fontSize: cb * 0.5, fontWeight: '700', fill: textColor }} />

			<!-- prev -->
			{#if page > 0}
				<Rectangle eventMode="static" cursor="pointer" onpointerup={() => (page = Math.max(0, page - 1))} x={W * 0.01} y={navY - navR} width={navR} height={navR * 2} borderRadius={navR * 0.3} backgroundColor={dimColor} backgroundAlpha={0.5} borderColor={accent} borderWidth={2} />
				<Text eventMode="none" x={W * 0.01 + navR / 2} y={navY} anchor={0.5} text="‹" style={{ fontFamily: font, fontSize: navR, fontWeight: '700', fill: textColor }} />
			{/if}

			<!-- next -->
			{#if page < pages.length - 1}
				<Rectangle eventMode="static" cursor="pointer" onpointerup={() => (page = Math.min(pages.length - 1, page + 1))} x={W * 0.99 - navR} y={navY - navR} width={navR} height={navR * 2} borderRadius={navR * 0.3} backgroundColor={dimColor} backgroundAlpha={0.5} borderColor={accent} borderWidth={2} />
				<Text eventMode="none" x={W * 0.99 - navR / 2} y={navY} anchor={0.5} text="›" style={{ fontFamily: font, fontSize: navR, fontWeight: '700', fill: textColor }} />
			{/if}
		{/if}
	</MainContainer>
</FadeContainer>
