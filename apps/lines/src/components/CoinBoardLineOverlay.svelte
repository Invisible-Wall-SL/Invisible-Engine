<script lang="ts">
	import { Container, Graphics, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import { LINE_OVERLAY_MOUNT } from 'engine-layout';
	import { isComponentMounted } from 'engine-layout/svelte';

	import {
		coinBoardLineColor,
		coinBoardLinePoints,
		coinBoardPaylineIds,
	} from '../game/coinBoard.svelte';
	import { stateGameDerived } from '../game/stateGame.svelte';

	/**
	 * THE CODED LINE OVERLAY (`docs/design/hold-and-win-coin-board.md` §1.4) — which lines pay, all the
	 * time: each active payline as a thin path between its cells in its payline colour, and a numbered
	 * tab at each end of the board. The path stops short of each cell's centre, so it never crosses a
	 * coin's value. Redrawn when the active lines change. The default for a project that placed no
	 * Line Overlay: it steps aside while one is mounted.
	 */
	const LINE_WIDTH = SYMBOL_SIZE * 0.035;
	const LINE_ALPHA = 0.8;
	const TAB_RADIUS = SYMBOL_SIZE * 0.11;
	/** How far from a cell's centre the path stops — just outside a coin's disc. */
	const CELL_CLEAR = SYMBOL_SIZE * 0.36;

	const columnPitch = $derived(SYMBOL_SIZE + stateGameDerived.boardGeometry().columnExtraLocal);
	const lines = $derived(
		coinBoardPaylineIds().map((id) => ({
			id,
			color: coinBoardLineColor(id),
			points: coinBoardLinePoints(id),
		})),
	);

	type Tab = { id: string; color: string; x: number; y: number };

	/** A tab at each end of every line, beside its first and last cell. Lines that leave a row
	 *  together stack their tabs, so none hides another. */
	const tabs = $derived.by(() => {
		const out: Tab[] = [];
		for (const end of ['first', 'last'] as const) {
			const atRow: Record<number, typeof lines> = {};
			for (const line of lines) {
				const point = end === 'first' ? line.points[0] : line.points.at(-1);
				if (point) atRow[point.y] = [...(atRow[point.y] ?? []), line];
			}
			for (const [row, group] of Object.entries(atRow)) {
				const y = Number(row);
				group.forEach((line, i) => {
					const point = end === 'first' ? line.points[0] : line.points.at(-1)!;
					const side = end === 'first' ? -1 : 1;
					out.push({
						id: line.id,
						color: line.color,
						x: point.x + side * (columnPitch / 2 + TAB_RADIUS * 1.3),
						y: y + (i - (group.length - 1) / 2) * TAB_RADIUS * 2.2,
					});
				});
			}
		}
		return out;
	});
</script>

{#if !isComponentMounted(LINE_OVERLAY_MOUNT)}
	<Graphics
		draw={(graphics) => {
			for (const line of lines) {
				line.points.slice(1).forEach((to, i) => {
					const from = line.points[i];
					const length = Math.hypot(to.x - from.x, to.y - from.y);
					if (length <= CELL_CLEAR * 2) return;
					const dx = ((to.x - from.x) / length) * CELL_CLEAR;
					const dy = ((to.y - from.y) / length) * CELL_CLEAR;
					graphics.moveTo(from.x + dx, from.y + dy).lineTo(to.x - dx, to.y - dy);
				});
				graphics.stroke({ width: LINE_WIDTH, color: line.color, alpha: LINE_ALPHA });
			}
			for (const tab of tabs) {
				graphics.circle(tab.x, tab.y, TAB_RADIUS).fill({ color: tab.color });
			}
		}}
	/>
	{#each tabs as tab (tab)}
		<Container x={tab.x} y={tab.y}>
			<Text
				anchor={0.5}
				text={tab.id}
				style={{
					fontFamily: 'Arial',
					fontWeight: 'bold',
					fontSize: Math.round(TAB_RADIUS * 1.2),
					fill: 0x111111,
				}}
			/>
		</Container>
	{/each}
{/if}
