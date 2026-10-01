<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/flights',
	});
</script>

<script lang="ts">
	import {
		StoryGameTemplate,
		StoryLocale,
		type TemplateArgs,
		templateArgs,
	} from 'components-storybook';
	import { resolveAnchor } from 'pixi-svelte';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { FLIGHT_BOARD_ANCHOR, flyTo, stateFlights, type FlightEnd } from '../game/flights.svelte';
	import { getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';

	setContext();

	type Cell = { reel: number; row: number };
	type Volley = { from: Cell[]; to: FlightEnd; avoid: Cell[] };

	/**
	 * The debug overlay: the avoided cells (red) and every planned route (cyan). Drawn straight onto
	 * the stage — the story has no place inside `Game`'s `<App>` — with the `Graphics` class read off
	 * one the game already mounted, because `apps/lines` does not depend on `pixi.js` directly.
	 */
	type DebugGraphics = {
		clear: () => DebugGraphics;
		rect: (x: number, y: number, w: number, h: number) => DebugGraphics;
		moveTo: (x: number, y: number) => DebugGraphics;
		bezierCurveTo: (...args: number[]) => DebugGraphics;
		stroke: (style: { width: number; color: number; alpha?: number }) => DebugGraphics;
		zIndex: number;
	};
	type Node = { children?: Node[]; rect?: unknown; bezierCurveTo?: unknown };
	type StageLike = Node & { addChild: (child: unknown) => void; sortChildren: () => void };

	let overlay: DebugGraphics | undefined;
	const debugOverlay = (): DebugGraphics | undefined => {
		if (overlay) return overlay;
		const app = (globalThis as { __PIXI_APP__?: { stage: StageLike } }).__PIXI_APP__;
		if (!app) return undefined;
		const find = (node: Node): Node | undefined => {
			if (typeof node.rect === 'function' && typeof node.bezierCurveTo === 'function') return node;
			for (const child of node.children ?? []) {
				const hit = find(child);
				if (hit) return hit;
			}
			return undefined;
		};
		const sample = find(app.stage);
		if (!sample) return undefined;
		overlay = new (sample.constructor as new () => DebugGraphics)();
		overlay.zIndex = 8_600;
		app.stage.addChild(overlay);
		app.stage.sortChildren();
		return overlay;
	};

	const cellRect = (cell: Cell) => {
		const board = resolveAnchor(FLIGHT_BOARD_ANCHOR);
		if (!board) return undefined;
		const seat = getSymbolSeat(cell.reel, cell.row);
		const { cellWidthLocal, cellHeightLocal } = stateGameDerived.boardGeometry();
		const a = board.toGlobal({ x: seat.x - cellWidthLocal / 2, y: seat.y - cellHeightLocal / 2 });
		const b = board.toGlobal({ x: seat.x + cellWidthLocal / 2, y: seat.y + cellHeightLocal / 2 });
		return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
	};

	const fly = async (volley: Volley) => {
		const flights = volley.from.map((from, index) =>
			flyTo(from, volley.to, 'toTotal', { index, avoid: volley.avoid }),
		);
		const g = debugOverlay();
		if (g) {
			g.clear();
			for (const cell of volley.avoid) {
				const r = cellRect(cell);
				if (r) g.rect(r.x, r.y, r.width, r.height).stroke({ width: 3, color: 0xff3344 });
			}
			for (const { curve } of stateFlights.list) {
				g.moveTo(curve.p0.x, curve.p0.y)
					.bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.p3.x, curve.p3.y)
					.stroke({ width: 2, color: 0x33e0ff, alpha: 0.8 });
			}
		}
		await Promise.all(flights);
	};

	const loop = async (volley: Volley) => {
		// Wait for the board to mount and lay out before the first volley.
		await new Promise((resolve) => setTimeout(resolve, 1500));
		for (;;) {
			await fly(volley);
			await new Promise((resolve) => setTimeout(resolve, 1200));
		}
	};

	const board = (reels: number, rows: number): Cell[] =>
		Array.from({ length: reels * rows }, (_, i) => ({ reel: Math.floor(i / rows), row: i % rows }));
</script>

{#snippet template(args: TemplateArgs<any>)}
	<StoryGameTemplate
		skipLoadingScreen={args.skipLoadingScreen}
		action={async () => {
			await args.action?.(args.data);
		}}
	>
		<StoryLocale lang="en">
			<Game />
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<!-- The feature end's volley: every coin of a full 5×3 board into the Total Win bar, staggered. -->
<Story
	name="volley to total"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => loop({ from: board(5, 3), to: 'total', avoid: [] }),
	})}
	{template}
/>

<!-- Routes bend around the cells showing a win (red): left column into the right column. -->
<Story
	name="avoidance"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () =>
			loop({
				from: [
					{ reel: 0, row: 0 },
					{ reel: 0, row: 1 },
					{ reel: 0, row: 2 },
				],
				to: { reel: 4, row: 1 },
				avoid: [
					{ reel: 2, row: 1 },
					{ reel: 1, row: 1 },
					{ reel: 3, row: 1 },
				],
			}),
	})}
	{template}
/>

<!-- Nothing straight or bent gets past a whole column: the over-route leaves through the top. -->
<Story
	name="over-route"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () =>
			loop({
				from: [{ reel: 1, row: 1 }],
				to: { reel: 3, row: 1 },
				avoid: board(5, 3).filter((cell) => cell.reel === 2),
			}),
	})}
	{template}
/>
