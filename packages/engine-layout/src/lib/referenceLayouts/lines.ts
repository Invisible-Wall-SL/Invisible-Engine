import { defaultBuyFeatureScene } from '../buyFeatureScene';
import { defaultConfirmScene } from '../confirmScene';
import { defaultFreeSpinIntroScene, defaultFreeSpinOutroScene } from '../freeSpinScenes';
import { linesTemplate } from '../templates/lines';
import type { LayoutDoc, LayoutNode, LayoutType, NodeOverride } from '../types';
import { hudScenes } from './hud';

/**
 * Template-shaped generator for the `lines` LayoutDoc — the engine-truth
 * "import" of the current hand-coded basegame (see
 * `docs/design/invisible-editor.md` §7.2). It derives the board-frame placement
 * from `mainSizesMap` + the `BoardFrame.svelte` constants rather than baking
 * magic literals, then tags each node with the `template` slot it fills. The
 * result is the layout the game renders, produced from the template instead of a
 * hand-written fixture — so it both proves the model and serves as the offline
 * fallback (`apps/lines/src/editor-scenes.ts`).
 *
 * Lives in `engine-layout` (not the game) so BOTH the game's `editor-scenes.ts`
 * fallback AND the launcher editor's "Load game scene" picker can produce it
 * without a cross-app import.
 */
const MAIN_SIZES_MAP: LayoutDoc['mainSizesMap'] = {
	desktop: { width: 1422, height: 800 },
	tablet: { width: 1000, height: 1000 },
	landscape: { width: 1600, height: 900 },
	portrait: { width: 800, height: 1422 },
};

const POSITION_ADJUSTMENT = 1.01; // BoardFrame.svelte: applied to boardLayout() x/y
const FRAME_WIDTH = 750; // boardLayout().width(600) * SPRITE_SCALE.width(1.25)
const FRAME_HEIGHT = 432; // boardLayout().width(600) * SPRITE_SCALE.height(0.72)
const ANCHOR_CENTER = { x: 0.5, y: 0.5 };

const frameCentre = (size: { width: number; height: number }) => ({
	x: size.width * 0.5 * POSITION_ADJUSTMENT,
	y: size.height * 0.5 * POSITION_ADJUSTMENT,
});

const frameOverrides: Partial<Record<LayoutType, NodeOverride>> = {
	tablet: frameCentre(MAIN_SIZES_MAP.tablet),
	landscape: frameCentre(MAIN_SIZES_MAP.landscape),
	portrait: frameCentre(MAIN_SIZES_MAP.portrait),
};

// --- free-spin counter panel placement (componentInstance of `freeSpinCounter`) ---
// Replicates the coded `FreeSpinCounter.svelte` formula EXACTLY, so the parametric
// instance lands where the coded overlay used to. The def's root is LOCAL space (the
// `Frame_FSCounter.png` drawn anchor {0,0}), so the node's `x/y` is the panel
// TOP-LEFT in MAIN coords — the same value the coded overlay set as its `position`:
//   panelWidth = SYMBOL_SIZE * 2
//   x = boardLayout().x − boardLayout().width*0.5 − panelWidth − SYMBOL_SIZE*0.7
//   y = boardLayout().y − boardLayout().height*0.5
// Board geometry mirrors `apps/lines/game/constants.ts` (the game's own board): the
// board is centred in each layoutType's main box (`mainLayout().w/h * 0.5`), so
// `boardLayout().x/y` = main-box centre and `width/height` = SYMBOL_SIZE * reels/rows.
const SYMBOL_SIZE = 120;
const BOARD_REELS = 5;
const BOARD_ROWS = 3;
const FS_PANEL_WIDTH = SYMBOL_SIZE * 2;
const FS_BOARD_WIDTH = SYMBOL_SIZE * BOARD_REELS;
const FS_BOARD_HEIGHT = SYMBOL_SIZE * BOARD_ROWS;

const fsCounterPos = (size: { width: number; height: number }) => ({
	x: size.width * 0.5 - FS_BOARD_WIDTH * 0.5 - FS_PANEL_WIDTH - SYMBOL_SIZE * 0.7,
	y: size.height * 0.5 - FS_BOARD_HEIGHT * 0.5,
});

const fsCounterOverrides: Partial<Record<LayoutType, NodeOverride>> = {
	tablet: fsCounterPos(MAIN_SIZES_MAP.tablet),
	landscape: fsCounterPos(MAIN_SIZES_MAP.landscape),
	portrait: fsCounterPos(MAIN_SIZES_MAP.portrait),
};

/**
 * Scene display names. The standard template's scene set is identical for every type it serves
 * (#362 — `ways` equals `lines` apart from `gameType`), so ONE lookup names both.
 */
const STANDARD_SCENES = linesTemplate.scenes;
const sceneName = (id: string) => STANDARD_SCENES.find((scene) => scene.id === id)?.name ?? id;

/** Options forwarded to {@link hudScenes}; default OFF = parity. */
export interface DefaultLayoutOptions {
	/**
	 * Emit the HUD button cluster as parametric `componentInstance(button)` nodes
	 * (§16.4 B6.4) instead of coded `UiButton*` `bind` nodes. Forwarded to
	 * `hudScenes({ buttons })`. Default-OFF so the editor's "Load game scene" picker
	 * + the full-scene-set merge (`referenceLayouts/index.ts`) stay byte-identical;
	 * `apps/lines` passes `true` for its fallback doc (`fallbackLayout.ts`).
	 */
	buttons?: boolean;
}

/**
 * The game types this generator can produce a FILLED (art-bearing) reference layout for, and the
 * one thing that differs between them.
 *
 * `lines` and `ways` share everything this doc places: the same `_runtime/lines` bundle and coded
 * components, the same 5x3 board (`engine-game` `SYMBOL_SIZE = 120`, `REEL_PADDING = 0.53`), and —
 * checked frame-for-frame — the same `reelsFrame` atlas, down to identical source rectangles for
 * `frame_bg.png` / `frame_edge.png` / `Frame_FSCounter.png`. So a ways reference layout needs no new
 * art and no second generator; it needs this one to stop hardcoding `'lines'`.
 *
 * `specialBook` is the exception. `apps/lines` IS the Book-of reference game, so its layout carries
 * the expanding-symbol reveal scene even though `standardTemplate` does not declare it (slots
 * constrain, they don't forbid). A ways game has no expanding symbol — the same cut the flow
 * starter seed makes when it drops the `specialBook` container — so the scene is omitted rather
 * than shipped as scenery nothing will ever reveal.
 */
const REFERENCE_TYPES: Record<string, { specialBook: boolean }> = {
	lines: { specialBook: true },
	ways: { specialBook: false },
};

export function defaultLayout(gameType: string, options: DefaultLayoutOptions = {}): LayoutDoc {
	const spec = REFERENCE_TYPES[gameType];
	if (!spec) {
		throw new Error(`defaultLayout: unsupported gameType "${gameType}"`);
	}

	const centre = frameCentre(MAIN_SIZES_MAP.desktop);

	// The Transition overlay node: the direct coded `bind`, which self-centres in canvas coords. An
	// author who places the `transition` component instead gets the editor-positioned twin.
	const transitionNode: LayoutNode = {
		id: 'bound-transition',
		slotId: 'Transition',
		label: 'Transition overlay (coded)',
		kind: 'container',
		x: 0,
		y: 0,
		bind: { component: 'Transition' },
		children: [],
	};

	// The WIN overlay node in `basegameOverlays`: the direct coded composer `bind:Win` (gate +
	// visual), a `canvas`-space container bind at (0,0) — the coded part self-positions in canvas
	// coords. A doc that places its own `win` component degrades it to its gate half
	// (`basegameOverlaysSceneOf` in `apps/lines`).
	const winNode: LayoutNode = {
		id: 'bound-win',
		slotId: 'Win',
		label: 'Win overlay (coded)',
		kind: 'container',
		x: 0,
		y: 0,
		bind: { component: 'Win' },
		children: [],
	};

	return {
		version: 1,
		projectKey: gameType,
		gameType,
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{
				// Startup splash: a generic `loadingBar` componentInstance (the masked
				// progress fill + percentage). It carries `tapToContinue: true` (seeded by
				// `LOADING_BAR_DEF.defaultInstanceParams`), so the player's tap completes the
				// loading screen and the flow advances loading → basegame. The coded
				// LoadingScreen path is gone — the loading screen mounts generically via the
				// flow/scene interpreter.
				id: 'loading',
				name: sceneName('loading'),
				role: 'loading',
				space: 'canvas',
				nodes: [
					{
						id: 'loading-bar',
						slotId: 'loadingScreen',
						label: 'Loading bar',
						kind: 'componentInstance',
						componentId: 'loadingBar',
						x: 0,
						y: 0,
					},
				],
			},
			// NOTE: no `background` scene here on purpose. `apps/lines`' Game.svelte
			// reads a `background`-scene `bg` node to drive the coded <Background>
			// cover; the absence keeps it on its exact-cover default (§10.6). The
			// `background` slot is still declared in the template + filled by the
			// bookOf seed/reference, where the background is genuinely doc-driven.
			{
				id: 'basegame',
				name: sceneName('basegame'),
				role: 'basegame',
				nodes: [
					{
						id: 'frame-bg',
						slotId: 'boardFrame',
						label: 'Board frame background',
						kind: 'sprite',
						assetKey: 'frame_bg.png',
						anchor: ANCHOR_CENTER,
						x: centre.x,
						y: centre.y,
						width: FRAME_WIDTH,
						height: FRAME_HEIGHT,
						overrides: frameOverrides,
					},
					{
						id: 'frame-edge',
						slotId: 'boardFrameEdge',
						label: 'Board frame edge',
						kind: 'sprite',
						assetKey: 'frame_edge.png',
						anchor: ANCHOR_CENTER,
						x: centre.x,
						y: centre.y,
						width: FRAME_WIDTH,
						height: FRAME_HEIGHT,
						overrides: frameOverrides,
					},
					{
						// Free scenery (no slot): the original layout-driven smoke label.
						id: 'editor-watermark',
						label: 'Editor smoke label',
						kind: 'text',
						text: 'LAYOUT-DRIVEN FRAME',
						anchor: ANCHOR_CENTER,
						x: centre.x,
						y: 200,
						alpha: 0.5,
						style: {
							fontFamily: 'proxima-nova',
							fontSize: 22,
							fontWeight: '600',
							fill: 0xffffff,
						},
						overrides: {
							tablet: { x: frameCentre(MAIN_SIZES_MAP.tablet).x, y: 300 },
							landscape: { x: frameCentre(MAIN_SIZES_MAP.landscape).x, y: 250 },
							portrait: { x: frameCentre(MAIN_SIZES_MAP.portrait).x, y: 500 },
						},
					},
				],
			},
			// The HUD layer (logo/name corners + bottom bar) as editor scenes, placed HERE —
			// right after `basegame`, BEFORE `basegameOverlays`/`specialBook` — so the doc's
			// screen-list order matches the coded markup paint order (HUD below the win/bonus
			// overlays). `sceneLayerZIndex` (layerOrder.ts) turns this position into the HUD's
			// zIndex, so an author can move the HUD up/down the list to re-stack it; leaving it
			// here reproduces today's z (parity). The game still renders `<UI>` from these scenes.
			//
			// `{ readouts: true }` (B4.4, `apps/lines` only): balance/win/bet become parametric
			// `componentInstance(hudReadout)` nodes — the def mounts the coded `HudReadout`, fed
			// live by `registerComponentValues`. `apps/lines`'s `Game.svelte` registers all three
			// (def + bound component + value sources). Book of Borut keeps the default coded `bind`
			// labels (it calls `hudScenes()` with no options), so it stays parity-safe until migrated.
			//
			// `buttons` (B6.4): forwarded from `options.buttons` — the editor picker +
			// full-scene-set merge call `defaultLayout('lines')` with no options ⇒ OFF (coded
			// `bind` buttons, parity); `apps/lines`'s fallback doc passes `true`, so its cluster is
			// `componentInstance(button)` nodes (+ the replacement hotkey).
			...hudScenes({ readouts: true, buttons: options.buttons }),
			{
				id: 'basegameOverlays',
				name: sceneName('basegameOverlays'),
				// Mounted at the <App> root: its bind nodes are containers at (0,0)
				// whose bound Win/Transition render their OWN MainContainer internally.
				// `canvas` space = no wrapper, so we don't double-transform them.
				space: 'canvas',
				nodes: [winNode, transitionNode],
			},
			defaultFreeSpinIntroScene(sceneName('freeSpinIntro')),
			{
				id: 'freeSpinCounter',
				name: sceneName('freeSpinCounter'),
				space: 'canvas',
				nodes: [
					// B-FS-2b-i: the free-spin counter as a `componentInstance` of the
					// `freeSpinCounter` ComponentDef (frame + "FREE SPIN" caption + "X OF Y"
					// value) — the live-render switch off the coded `FreeSpinCounter` bind
					// anchor. The def feeds the value from the game's `freeSpins` source and
					// gates visibility on `freeSpinCounterShow`; `x/y` is the panel top-left
					// in MAIN coords per layoutType (see `fsCounterPos`). The coded
					// `FreeSpinCounter` stays registered as a fallback, just unreferenced.
					{
						id: 'fs-counter',
						slotId: 'freeSpinCounter',
						label: 'Free-spin counter',
						kind: 'componentInstance',
						componentId: 'freeSpinCounter',
						x: fsCounterPos(MAIN_SIZES_MAP.desktop).x,
						y: fsCounterPos(MAIN_SIZES_MAP.desktop).y,
						overrides: fsCounterOverrides,
						params: {
							source: 'freeSpins',
							visibleSource: 'freeSpinCounterShow',
							label: 'FREE SPIN',
						},
					},
				],
			},
			defaultFreeSpinOutroScene(sceneName('freeSpinOutro')),
			{
				// Free-spin board glow: the reel-house backdrop BEHIND the reels. A `game`-space
				// bind anchor — the coded `BoardFrame` self-shows/animates off the
				// `boardFrameGlowShow`/`boardFrameGlowHide` signals and sizes itself off the board
				// layout; the editor only positions it. Drop real art in this scene (a rig
				// component whose cues ride `boardGlowShow`/`boardGlowHide`) and the coded glow
				// steps aside (`hasAuthoredBoardGlow`).
				id: 'boardGlow',
				name: sceneName('boardGlow'),
				nodes: [
					{
						id: 'board-glow',
						slotId: 'boardGlow',
						label: 'Board Glow',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'BoardFrame' },
						children: [],
					},
				],
			},
			// Special-Book bonus overlay: the expanding-symbol reveal (shuffle → land →
			// idle). A board-centred `canvas`-space bind anchor; the coded `SpecialBook`
			// self-shows/animates off the `specialBookReveal`/`specialBookHide` book
			// events and renders the chosen symbol via the symbol state machine. The
			// editor only positions it. Book-of mechanic ⇒ omitted for a type without one.
			...(spec.specialBook
				? [
						{
							id: 'specialBook',
							name: sceneName('specialBook'),
							space: 'canvas' as const,
							nodes: [
								{
									id: 'special-book',
									slotId: 'specialBook',
									label: 'Special Book',
									kind: 'container' as const,
									x: 0,
									y: 0,
									bind: { component: 'SpecialBook' },
									children: [],
								},
							],
						},
					]
				: []),
			// Select-Feature (buy-bonus) menu — the engine-default in-canvas SELECT scene (dimmed
			// backdrop + `featureCard` repeater), shared with every reference layout + the
			// `<BuyFeatureScreen>` takeover fallback (`buyFeatureScene.ts`). An author repositions/
			// styles the cards + backdrop here.
			defaultBuyFeatureScene(),
			// Confirm dialog — the engine-default in-canvas CONFIRM scene (dimmed backdrop + a
			// `confirmDialog` instance), the twin of the retired HTML `ModalBuyBonusConfirm` and the
			// `<ConfirmDialog>` takeover fallback (`confirmScene.ts`). Authorable per project.
			defaultConfirmScene(),
		],
		updatedAt: '2026-05-30T00:00:00.000Z',
	};
}
