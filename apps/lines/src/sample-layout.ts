import type { LayoutDoc } from 'engine-layout';

/**
 * Contract-validation fixture for `<LayoutScene>`. Renders alongside the
 * existing hardcoded basegame scene to prove the engine-layout runtime works
 * inside `apps/lines` without altering gameplay. `mainSizesMap` mirrors the
 * map in `src/game/stateLayout.ts` so the editor-authored coords map onto the
 * same main-layout coordinate space the rest of the game uses.
 */
export const sampleLayout: LayoutDoc = {
	version: 1,
	projectKey: 'sample',
	mainSizesMap: {
		desktop: { width: 1422, height: 800 },
		tablet: { width: 1000, height: 1000 },
		landscape: { width: 1600, height: 900 },
		portrait: { width: 800, height: 1422 },
	},
	scenes: [
		{
			id: 'basegame',
			name: 'basegame',
			nodes: [
				{
					id: 'sample-root',
					kind: 'container',
					x: 80,
					y: 80,
					alpha: 0.85,
					zIndex: 50,
					children: [
						{
							id: 'sample-payframe',
							kind: 'sprite',
							assetKey: 'payFrame',
							x: 0,
							y: 0,
							anchor: { x: 0, y: 0 },
							scale: { x: 0.25, y: 0.25 },
						},
						{
							id: 'sample-label',
							kind: 'text',
							text: 'Layout-driven',
							x: 0,
							y: -40,
							style: {
								fontFamily: 'proxima-nova',
								fontSize: 28,
								fontWeight: '600',
								fill: 0xffffff,
							},
						},
						{
							id: 'sample-bound-transition',
							kind: 'container',
							x: 0,
							y: 0,
							bind: { component: 'Transition' },
							children: [],
						},
					],
				},
			],
		},
	],
	updatedAt: '2026-05-30T00:00:00.000Z',
};
