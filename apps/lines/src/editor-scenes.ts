import type { LayoutDoc } from 'engine-layout';

/**
 * Checked-in stand-in for the editor document the Invisible Editor would write
 * to R2 at `editor/lines/<project>/scenes.json` (see
 * `apps/launcher-api/src/lib/server/projectPaths.ts#editorDocKey` and
 * `editorStorage.ts#saveDoc`). It is shaped to round-trip cleanly through
 * `normalizeDoc` — every node has a valid `kind` + non-empty `id`, and
 * `mainSizesMap` mirrors `src/game/stateLayout.ts` so authored coords land in
 * the same main-layout space the rest of the game draws in.
 *
 * Runtime R2/launcher fetch is deferred (design doc §6.10 decision): this is a
 * faithful fixture, not an ad-hoc literal, so swapping in a real fetch later is
 * a transport change only.
 *
 * The `basegame` scene ports the two static board-frame sprites
 * (`frame_bg.png`, `frame_edge.png`) out of `BoardFrame.svelte`. Their coords
 * are the resolved `stateGameDerived.boardLayout()` values baked per
 * `layoutType`, which are statically computable:
 *   boardLayout().x = mainSizesMap[layoutType].width  * 0.5
 *   boardLayout().y = mainSizesMap[layoutType].height * 0.5
 *   boardLayout().width = BOARD_SIZES.width = SYMBOL_SIZE(120) * 5 reels = 600
 * The frame sprites apply POSITION_ADJUSTMENT (1.01) to x/y and
 * SPRITE_SCALE { width: 1.25, height: 0.72 } to boardLayout().width for BOTH
 * width and height, giving a constant 750 x 432 across every layoutType.
 *
 *   layoutType  mainSizes    frame x (w*0.5*1.01)  frame y (h*0.5*1.01)
 *   desktop     1422 x 800   711.00 * 1.01 = 718.11  400 * 1.01 = 404.00
 *   tablet      1000 x 1000  500.00 * 1.01 = 505.00  500 * 1.01 = 505.00
 *   landscape   1600 x 900   800.00 * 1.01 = 808.00  450 * 1.01 = 454.50
 *   portrait    800 x 1422   400.00 * 1.01 = 404.00  711 * 1.01 = 718.11
 *
 * Desktop is the base; the other three layoutTypes are sparse `overrides`.
 * The animated reelhouse glow spine stays coded in `BoardFrame.svelte` (animated
 * loops are out of editor v1 scope, design doc §3).
 *
 * Two scenes:
 *   - `basegame`         — static frame sprites + label, authored in main-layout
 *                          coords, rendered INSIDE `<MainContainer>`.
 *   - `basegameOverlays` — the `bind` escape-hatch nodes for the coded `Win` /
 *                          `Transition` overlays. Those components self-position
 *                          in canvas coords (their own `MainContainer` /
 *                          `CanvasSizeRectangle`), so this scene is rendered
 *                          OUTSIDE `<MainContainer>` to avoid double-scaling.
 */

const FRAME_WIDTH = 750;
const FRAME_HEIGHT = 432;
const ANCHOR_CENTER = { x: 0.5, y: 0.5 };

export const fallbackEditorScenes: LayoutDoc = {
	version: 1,
	projectKey: 'lines',
	mainSizesMap: {
		desktop: { width: 1422, height: 800 },
		tablet: { width: 1000, height: 1000 },
		landscape: { width: 1600, height: 900 },
		portrait: { width: 800, height: 1422 },
	},
	scenes: [
		{
			id: 'basegame',
			name: 'Base game',
			nodes: [
				{
					id: 'frame-bg',
					label: 'Board frame background',
					kind: 'sprite',
					assetKey: 'frame_bg.png',
					anchor: ANCHOR_CENTER,
					x: 718.11,
					y: 404,
					width: FRAME_WIDTH,
					height: FRAME_HEIGHT,
					overrides: {
						tablet: { x: 505, y: 505 },
						landscape: { x: 808, y: 454.5 },
						portrait: { x: 404, y: 718.11 },
					},
				},
				{
					id: 'frame-edge',
					label: 'Board frame edge',
					kind: 'sprite',
					assetKey: 'frame_edge.png',
					anchor: ANCHOR_CENTER,
					x: 718.11,
					y: 404,
					width: FRAME_WIDTH,
					height: FRAME_HEIGHT,
					overrides: {
						tablet: { x: 505, y: 505 },
						landscape: { x: 808, y: 454.5 },
						portrait: { x: 404, y: 718.11 },
					},
				},
				{
					id: 'editor-watermark',
					label: 'Editor smoke label',
					kind: 'text',
					text: 'LAYOUT-DRIVEN FRAME',
					anchor: ANCHOR_CENTER,
					x: 718.11,
					y: 200,
					alpha: 0.5,
					style: {
						fontFamily: 'proxima-nova',
						fontSize: 22,
						fontWeight: '600',
						fill: 0xffffff,
					},
					overrides: {
						tablet: { x: 505, y: 300 },
						landscape: { x: 808, y: 250 },
						portrait: { x: 404, y: 500 },
					},
				},
			],
		},
		{
			id: 'basegameOverlays',
			name: 'Base game overlays',
			nodes: [
				{
					id: 'bound-win',
					label: 'Win overlay (coded)',
					kind: 'container',
					x: 0,
					y: 0,
					bind: { component: 'Win' },
					children: [],
				},
				{
					id: 'bound-transition',
					label: 'Transition overlay (coded)',
					kind: 'container',
					x: 0,
					y: 0,
					bind: { component: 'Transition' },
					children: [],
				},
			],
		},
	],
	updatedAt: '2026-05-30T00:00:00.000Z',
};

/**
 * Default launcher origin that serves the public layout-doc endpoint
 * (`GET /api/editor/doc?project=`). Overridable per-load with the
 * `?editorDocBase=` query param (e.g. a local launcher on :3010).
 */
const DEFAULT_DOC_BASE = 'https://app.invisiblewall.org';

/**
 * Fetch the project's editor `LayoutDoc` from the launcher at game boot. The
 * launcher appends `?project=<active>` to the game URL; the endpoint resolves
 * the client itself. Falls back to {@link fallbackEditorScenes} on any failure
 * or when the fetched doc has no `basegame` scene, so the game still runs
 * offline / before any doc has been authored in the editor.
 */
export async function loadEditorScenes(): Promise<LayoutDoc> {
	if (typeof window === 'undefined') return fallbackEditorScenes;
	try {
		const params = new URLSearchParams(window.location.search);
		const base = params.get('editorDocBase') || DEFAULT_DOC_BASE;
		const project = params.get('project') || 'lines';
		// Shared read token the launcher appends to the game URL (`?k=`); the
		// doc endpoint is token-gated. Without it the fetch 401s -> fallback.
		const token = params.get('k');
		if (!token) return fallbackEditorScenes;
		const docUrl =
			`${base}/api/editor/doc?project=${encodeURIComponent(project)}` +
			`&k=${encodeURIComponent(token)}`;
		const res = await fetch(docUrl);
		if (!res.ok) return fallbackEditorScenes;
		const data = (await res.json()) as { doc?: LayoutDoc };
		const doc = data.doc;
		if (doc && Array.isArray(doc.scenes) && doc.scenes.some((scene) => scene.id === 'basegame')) {
			return doc;
		}
		return fallbackEditorScenes;
	} catch {
		return fallbackEditorScenes;
	}
}
