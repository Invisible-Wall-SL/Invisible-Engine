<script lang="ts">
	import { Container, Graphics, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import { LINE_OVERLAY_MOUNT } from 'engine-layout';
	import { isComponentMounted } from 'engine-layout/svelte';

	import {
		CODED_LINE_OVERLAY_LOOK,
		coinBoardLineColor,
		coinBoardLinePoints,
		coinBoardPaylineIds,
		lineOverlayLook,
	} from '../game/coinBoard.svelte';
	import { stateGameDerived } from '../game/stateGame.svelte';

	/**
	 * THE LINE OVERLAY (`docs/design/hold-and-win-coin-board.md` §1.4) — which lines pay, all the time:
	 * each active payline as a thin path between its cells in its payline colour, and a numbered tab at
	 * each end of the board. The path stops short of each cell's centre, so it never crosses a coin's
	 * value. Redrawn when the active lines change.
	 *
	 * Drawn on the board in the coded look for a project that placed no Line Overlay component. While
	 * one is mounted the coded look steps aside and the board draws the look that component hands over
	 * (`LineOverlayPart`); a stand-in hands over none, so nothing draws.
	 */
	const TAB_RADIUS = SYMBOL_SIZE * 0.11;
	/** How far from a cell's centre the path stops — just outside a coin's disc. */
	const CELL_CLEAR = SYMBOL_SIZE * 0.36;

	const look = $derived(
		isComponentMounted(LINE_OVERLAY_MOUNT) ? lineOverlayLook() : CODED_LINE_OVERLAY_LOOK,
	);
	const tabRadius = $derived(TAB_RADIUS * (look?.tabScale ?? 1));
	const columnPitch = $derived(SYMBOL_SIZE + stateGameDerived.boardGeometry().columnExtraLocal);
	const lines = $derived(
		coinBoardPaylineIds().map((id) => ({
			id,
			color: look?.lineColor ?? coinBoardLineColor(id),
			points: coinBoardLinePoints(id),
		})),
	);

	type Tab = { id: string; color: number | string; x: number; y: number };

	/** A tab at each end of every line, beside its first and last cell. Lines that leave a row
	 *  together stack their tabs, so none hides another. */
	const tabs = $derived.by(() => {
		const out: Tab[] = [];
		if (!look?.showTabs || !(tabRadius > 0)) return out;
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
						x: point.x + side * (columnPitch / 2 + tabRadius * 1.3),
						y: y + (i - (group.length - 1) / 2) * tabRadius * 2.2,
					});
				});
			}
		}
		return out;
	});
</script>

{#if look}
	<Graphics
		draw={(graphics) => {
			for (const line of lines) {
				if (!(look.lineWidth > 0)) break;
				line.points.slice(1).forEach((to, i) => {
					const from = line.points[i];
					const length = Math.hypot(to.x - from.x, to.y - from.y);
					if (length <= CELL_CLEAR * 2) return;
					const dx = ((to.x - from.x) / length) * CELL_CLEAR;
					const dy = ((to.y - from.y) / length) * CELL_CLEAR;
					graphics.moveTo(from.x + dx, from.y + dy).lineTo(to.x - dx, to.y - dy);
				});
				graphics.stroke({ width: look.lineWidth, color: line.color, alpha: look.lineAlpha });
			}
			for (const tab of tabs) {
				graphics.circle(tab.x, tab.y, tabRadius).fill({ color: tab.color });
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
					fontSize: Math.round(tabRadius * 1.2),
					fill: look.tabTextFill,
				}}
			/>
		</Container>
	{/each}
{/if}
