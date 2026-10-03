<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/skinned cell tiles (12c)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { Anchor, App, Container, resolveAnchor } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		CELL_TILE_DEF,
		RESPIN_CELLS_DEF,
		registerBoundComponents,
		registerComponents,
		type ComponentDef,
		type LayoutNode,
		type Scene,
	} from 'engine-layout';

	import CellTilePart from '../components/CellTilePart.svelte';
	import RespinCellTile from '../components/RespinCellTile.svelte';
	import RespinCellTiles from '../components/RespinCellTiles.svelte';
	import { setContext } from '../game/context';
	import { eventEmitter } from '../game/eventEmitter';
	import { respinCellLook } from '../game/stateRespinBoard.svelte';

	setContext();

	/**
	 * Phase 12c — the respin cells drawn on a Cell Tile copy. A placed Respin Cell Tiles hands its
	 * `tile` to the board's look, and a 3×3 grid of cells stamps it as the respin board does. One
	 * story each:
	 * - the copy;
	 * - a copy nesting a Respin Cell Tiles, whose look must stay put;
	 * - a component that is not registered, and the Respin Cell Tiles naming itself: both refused, so
	 *   no tile is drawn.
	 * The copy adds two marker texts inside its `Cell` part: "T" on every tile, and "H" shown only
	 * while the cell's `held` is 1; it pulses at 1.3 as a coin lands on its cell.
	 * `window.__hold(reel, row)` toggles a held cell, `window.__land(reel, row)` lands a coin there,
	 * and `window.__probe()` reads the look, the shown markers and each tile's scale.
	 */
	const cellPart = CELL_TILE_DEF.root.children[0] as LayoutNode & { kind: 'container' };
	const marker = (id: string, text: string, held: boolean): LayoutNode => ({
		id,
		kind: 'text',
		x: 0,
		y: held ? 30 : -30,
		anchor: { x: 0.5, y: 0.5 },
		text,
		style: { fontSize: 28, fill: held ? 0x33ff66 : 0xff9900 },
		...(held ? { valueBindings: [{ target: 'visible', param: 'held' }] } : {}),
	});
	const probeTile: ComponentDef = {
		...CELL_TILE_DEF,
		id: 'probeCellTile',
		root: {
			...CELL_TILE_DEF.root,
			children: [
				{
					...cellPart,
					children: [
						...cellPart.children,
						marker('probe-tile', 'T', false),
						marker('probe-held', 'H', true),
					],
				},
			],
		},
		params: CELL_TILE_DEF.params?.map((p) =>
			p.key === 'landPulseScale' ? { ...p, default: 1.3 } : p,
		),
	};
	// A copy with the Respin Cell Tiles nested inside: it must publish no look from inside a cell, or
	// the cells it would hand a new look to unmount it, and around again.
	const nestingTile: ComponentDef = {
		...probeTile,
		id: 'nestingCellTile',
		root: {
			...probeTile.root,
			children: [
				...probeTile.root.children,
				{
					id: 'nesting-cells',
					kind: 'componentInstance',
					componentId: 'respinCells',
					x: 0,
					y: 0,
				},
			],
		},
	};
	registerComponents({
		respinCells: RESPIN_CELLS_DEF,
		probeCellTile: probeTile,
		nestingCellTile: nestingTile,
	});
	registerBoundComponents({ RespinCellTiles, CellTilePart });

	const sceneOf = (tile: string): Scene => ({
		id: 'cells',
		name: 'cells',
		nodes: [
			{
				id: 'cells',
				kind: 'componentInstance',
				componentId: 'respinCells',
				x: 0,
				y: 0,
				params: { tile, gap: 0.06 },
			},
		],
	});

	const CELLS = [0, 1, 2].flatMap((reel) => [0, 1, 2].map((row) => ({ reel, row })));
	const keyOf = (reel: number, row: number) => `${reel}:${row}`;
	let held = $state<string[]>([]);
	const tile = $derived(respinCellLook()?.tile);

	type Node = NonNullable<ReturnType<typeof resolveAnchor>>;
	const shown = (node: Node | null): boolean => {
		for (let at = node; at; at = at.parent) if (!at.visible || at.alpha <= 0) return false;
		return true;
	};
	const textsUnder = (node: Node): Node[] =>
		node.children.flatMap((child: Node) => [
			...('text' in child ? [child] : []),
			...textsUnder(child),
		]);
	const markers = (text: string) => {
		const grid = resolveAnchor('grid');
		return grid
			? textsUnder(grid).filter((node) => 'text' in node && node.text === text && shown(node))
			: [];
	};

	onMount(() => {
		Object.assign(window, {
			__hold: (reel: number, row: number) => {
				const key = keyOf(reel, row);
				held = held.includes(key) ? held.filter((k) => k !== key) : [...held, key];
			},
			__land: (reel: number, row: number) =>
				eventEmitter.broadcast({
					type: 'respinCoinsLand',
					cells: [{ reel, row, symbol: { name: 'CO', multiplier: 1 } }],
				}),
			__probe: () => ({
				look: respinCellLook(),
				tiles: markers('T').length,
				held: markers('H').length,
				scales: markers('T').map((node) => Math.round(node.worldTransform.a * 100) / 100),
			}),
		});
	});
</script>

{#snippet stage(tileId: string)}
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene scene={sceneOf(tileId)} />
				<Container x={200} y={100}>
					<Anchor name="grid" />
					{#each CELLS as cell (keyOf(cell.reel, cell.row))}
						<RespinCellTile
							reel={cell.reel}
							row={cell.row}
							{tile}
							held={held.includes(keyOf(cell.reel, cell.row))}
							gap={0.06}
						/>
					{/each}
				</Container>
			</App>
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<Story name="cells on a Cell Tile copy">
	{@render stage('probeCellTile')}
</Story>

<Story name="a tile nesting the cell tiles">
	{@render stage('nestingCellTile')}
</Story>

<Story name="a missing tile (no tile)">
	{@render stage('noSuchTile')}
</Story>

<Story name="a tile naming the cell tiles (no tile)">
	{@render stage('respinCells')}
</Story>
