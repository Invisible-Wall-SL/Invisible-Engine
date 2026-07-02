import { linesTemplate } from '../templates/lines';
import type { LayoutDoc, LayoutNode, LayoutType, NodeOverride, Scene } from '../types';
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

const sceneName = (id: string) => linesTemplate.scenes.find((scene) => scene.id === id)?.name ?? id;

/** Engine-flip options forwarded to {@link hudScenes}; default OFF = parity. */
export interface DefaultLayoutOptions {
	/**
	 * Emit the HUD button cluster as parametric `componentInstance(button)` nodes
	 * (§16.4 B6.4) instead of coded `UiButton*` `bind` nodes. Forwarded to
	 * `hudScenes({ buttons })`. Default-OFF so the editor's "Load game scene" picker
	 * + the full-scene-set merge (`referenceLayouts/index.ts`) stay byte-identical;
	 * `apps/lines` passes its `HUD_BUTTON_INSTANCES` module flag (also default-OFF
	 * for now — see `apps/lines/src/game/editorFlags.ts`) to drive its fallback doc.
	 */
	buttons?: boolean;
	/**
	 * Emit the `Transition` overlay as an editor-owned `componentInstance(transition)`
	 * (§17.4 step 4) instead of the direct coded `bind:Transition`. The instance mounts
	 * the SAME coded part but positions it via the node transform (the coded part renders
	 * at local origin under this flag), so the author can move the wipe. Default-OFF =
	 * the direct bind (parity); `apps/lines` forwards its `TRANSITION_INSTANCE` flag.
	 */
	transition?: boolean;
	/**
	 * §17 Phase 3 — split the free-spin INTRO/OUTRO into a full-screen GATE (`canvas`
	 * `bind:FreeSpin{Intro,Outro}Gate`) + an editor-positioned VISUAL (a `game`-space
	 * `componentInstance(freeSpin{Intro,Outro}Visual)`, defaulted to board-centre). Default-OFF
	 * = the single composer `bind:FreeSpin{Intro,Outro}` (parity); `apps/lines` forwards its
	 * `FREE_SPIN_OVERLAY_INSTANCES` flag.
	 */
	freeSpinOverlays?: boolean;
}

export function defaultLayout(gameType: string, options: DefaultLayoutOptions = {}): LayoutDoc {
	if (gameType !== 'lines') {
		throw new Error(`defaultLayout: unsupported gameType "${gameType}"`);
	}

	const centre = frameCentre(MAIN_SIZES_MAP.desktop);

	// §17.4 step 4 — the Transition overlay node: the direct coded `bind` by default
	// (parity), or an editor-owned `componentInstance(transition)` when `options.transition`
	// is set. The instance is `canvas`-centred via `screenAnchor {0.5,0.5}` to reproduce the
	// coded centre; `Transition.svelte` renders at local origin under the flag so this node's
	// transform places the wipe. Reversible (drop the flag).
	const transitionNode: LayoutNode = options.transition
		? {
				id: 'instance-transition',
				slotId: 'Transition',
				label: 'Transition',
				kind: 'componentInstance',
				componentId: 'transition',
				screenAnchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 0,
				params: {},
			}
		: {
				id: 'bound-transition',
				slotId: 'Transition',
				label: 'Transition overlay (coded)',
				kind: 'container',
				x: 0,
				y: 0,
				bind: { component: 'Transition' },
				children: [],
			};

	// §17 Phase 3 — the free-spin INTRO scene's node. The full-screen GATE (dim + press +
	// the round-blocking await) is now ALWAYS mounted by the engine (`Game.svelte` renders one
	// `<FreeSpinIntroGate>`), so the doc owns only the VISUAL — never a gate. This keeps the
	// round held for ANY intro (this doc-driven visual OR an authored gated screen) while never
	// double-mounting the gate (two `waitForResolve` subscribers would hang the round). OFF:
	// the board-centred VISUAL bind (parity with the old composer's drawn output, minus its
	// gate). ON: no node here — the positionable `freeSpinIntroVisual` instance scene below
	// draws the visual instead.
	const fsIntroNode: LayoutNode | undefined = options.freeSpinOverlays
		? undefined
		: {
				id: 'fs-intro',
				slotId: 'freeSpinIntro',
				label: 'Free-spin intro',
				kind: 'container',
				x: 0,
				y: 0,
				bind: {
					component: 'FreeSpinIntroVisual',
					props: {
						boundToInstance: false,
						introSpine: 'fsIntroNumber',
						introAnimation: 'intro',
						idleAnimation: 'idle',
						slotName: 'slot_number',
					},
				},
				children: [],
			};

	// §17 Phase 3 — the free-spin OUTRO scene's node, mirroring the intro: the full-screen GATE
	// is engine-owned (one `<FreeSpinOutroGate>` in `Game.svelte`), so the doc owns only the
	// VISUAL. OFF: the board-centred VISUAL bind (parity, gate-free); ON: no node (the
	// `freeSpinOutroVisual` instance scene below draws it).
	const fsOutroNode: LayoutNode | undefined = options.freeSpinOverlays
		? undefined
		: {
				id: 'fs-outro',
				slotId: 'freeSpinOutro',
				label: 'Free-spin outro',
				kind: 'container',
				x: 0,
				y: 0,
				bind: {
					component: 'FreeSpinOutroVisual',
					props: {
						boundToInstance: false,
						outroSpine: 'fsOutroNumber',
						outroAnimation: 'intro',
						idleAnimation: 'idle',
						slotName: 'slot_number',
					},
				},
				children: [],
			};

	// The positionable VISUAL scene(s), emitted only when the overlays are split (ON).
	// `game`-space so the scene's `<MainContainer>` scales them; the instance is defaulted to
	// board-centre (its `FreeSpinAnimation` renders at the node origin under `boundToInstance`),
	// so the ON default reproduces the OFF board-centred placement. The owner drags to move it.
	const freeSpinVisualScenes: Scene[] = options.freeSpinOverlays
		? [
				{
					id: 'freeSpinIntroVisual',
					name: sceneName('freeSpinIntroVisual'),
					space: 'game',
					nodes: [
						{
							id: 'fs-intro-visual',
							slotId: 'freeSpinIntroVisual',
							label: 'Free-spin intro',
							kind: 'componentInstance',
							componentId: 'freeSpinIntroVisual',
							x: centre.x,
							y: centre.y,
							params: {
								introSpine: 'fsIntroNumber',
								introAnimation: 'intro',
								idleAnimation: 'idle',
								slotName: 'slot_number',
							},
						},
					],
				},
				{
					id: 'freeSpinOutroVisual',
					name: sceneName('freeSpinOutroVisual'),
					space: 'game',
					nodes: [
						{
							id: 'fs-outro-visual',
							slotId: 'freeSpinOutroVisual',
							label: 'Free-spin outro',
							kind: 'componentInstance',
							componentId: 'freeSpinOutroVisual',
							x: centre.x,
							y: centre.y,
							params: {
								outroSpine: 'fsOutroNumber',
								outroAnimation: 'intro',
								idleAnimation: 'idle',
								slotName: 'slot_number',
							},
						},
					],
				},
			]
		: [];

	return {
		version: 1,
		projectKey: 'lines',
		gameType: 'lines',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{
				// Startup splash: a generic `loadingBar` componentInstance (the masked
				// progress fill + percentage). It carries `completeOnLoaded: true` (seeded by
				// `LOADING_BAR_DEF.defaultInstanceParams`), so the flow's `complete` edge fires
				// when boot loading finishes and advances loading → basegame. The coded
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
			// overlays). `docLayerZIndex` (layerOrder.ts) turns this position into the HUD's
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
			// `bind` buttons, parity); `apps/lines` passes its default-OFF `HUD_BUTTON_INSTANCES`
			// flag, so flipping that one constant converts the cluster to `componentInstance(button)`
			// nodes (+ the replacement hotkey).
			...hudScenes({ readouts: true, buttons: options.buttons }),
			{
				id: 'basegameOverlays',
				name: sceneName('basegameOverlays'),
				// Mounted at the <App> root: its bind nodes are containers at (0,0)
				// whose bound Win/Transition render their OWN MainContainer internally.
				// `canvas` space = no wrapper, so we don't double-transform them.
				space: 'canvas',
				nodes: [
					{
						id: 'bound-win',
						slotId: 'Win',
						label: 'Win overlay (coded)',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'Win' },
						children: [],
					},
					transitionNode,
				],
			},
			{
				id: 'freeSpinIntro',
				name: sceneName('freeSpinIntro'),
				space: 'canvas',
				nodes: fsIntroNode ? [fsIntroNode] : [],
			},
			...freeSpinVisualScenes,
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
			{
				id: 'freeSpinOutro',
				name: sceneName('freeSpinOutro'),
				space: 'canvas',
				nodes: fsOutroNode ? [fsOutroNode] : [],
			},
			{
				// Special-Book bonus overlay: the expanding-symbol reveal (shuffle → land →
				// idle). A board-centred `canvas`-space bind anchor; the coded `SpecialBook`
				// self-shows/animates off the `specialBookReveal`/`specialBookHide` book
				// events and renders the chosen symbol via the symbol state machine. The
				// editor only positions it.
				id: 'specialBook',
				name: sceneName('specialBook'),
				space: 'canvas',
				nodes: [
					{
						id: 'special-book',
						slotId: 'specialBook',
						label: 'Special Book',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'SpecialBook' },
						children: [],
					},
				],
			},
		],
		updatedAt: '2026-05-30T00:00:00.000Z',
	};
}
