// Offline gate: a screen timeline moves the screen the player SEES, never a copy of it, and plays
// the keys of the screen ratio on screen.
//
//   pnpm check:screen-timeline-mounts
//
// THE BUG (reported on a live Pots overlay project, 2026-10-16): a driven flow that never shows the
// add-on's Pots screen still gets it, because the game mounts it itself (`enginePotsScreen`). But
// only a FLOW-shown screen counted as up for a screen timeline, so `<FlowV2Cinematics>` treated Pots
// as off stage and `<Cinematic>` drew its OWN copy of the screen inside `<MainContainer>`: a second
// set of pots, framed by the game box twice (misplaced and resized), animated, gone when the
// timeline ended, while the pots the player saw never moved. The game's own mount now counts as up
// while it is mounted (`<EngineScreenMount>` → `engineScreenUp`) and takes the timeline's driver.
//
// THE BASE GAME (reported on the same project, 2026-10-21): a timeline keyed on the base-game screen
// (the reel grid zooming in, the reel frame hidden) did nothing in game. `<FlowV2Mount>` skips the
// `basegame` container — the game draws it itself, split around the engine-drawn reels — and Game
// kept `basegame` off stage, so `<Cinematic>` drew a copy of the screen (whose `reelGrid` placeholder
// draws nothing) while the screen the player saw, and the reels, never moved. Game now takes the
// base game's drive: the reel split's layers remount with the driver, and the board follows the
// `reelGrid` node's keys through `<BoardDrive>`. Once the timeline ends, where it left the grid is
// the board's layout (`heldReelGridNode`), so the win line and what else is placed from the board
// follow the reels; until then only the drawing moves.
//
// PER-RATIO KEYS: a screen lays its nodes out per ratio, so one move rarely fits every ratio. A
// property track with a `layout` keys that ratio alone; a ratio with such keys plays them, every
// other ratio the default keys (`keysLayout`), switching live as the device turns.
//
// HOW: the REAL `FlowV2Cinematics.svelte`, `Cinematic.svelte`, `EngineScreenMount.svelte` and
// `BoardDrive.svelte` are
// compiled by Svelte's compiler and mounted through its client runtime on a DOM shim, as
// `check-cinematic-ticker.mjs` does, and the flow handle's screen bookkeeping is the REAL
// `createScreenDrives` the flow runtime builds. What draws is a stand-in: each `LayoutScene` records
// itself while mounted, tagged by who mounted it — the game's own mount, or a `<Cinematic>` copy.

import { readFileSync, realpathSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Element } from './lib/svelte-dom-shim.mjs';

const repoFile = (path) => new URL(`../${path}`, import.meta.url).href;
const ROOT = repoFile('');
const FLOW_CINEMATICS = repoFile('apps/lines/src/components/FlowV2Cinematics.svelte');
const ENGINE_MOUNT = repoFile('apps/lines/src/components/EngineScreenMount.svelte');
const CINEMATIC = repoFile('packages/engine-layout/src/lib/Cinematic.svelte');
const CINEMATIC_NODES = repoFile('packages/engine-layout/src/lib/cinematicNodes.ts');
const SCREEN_DRIVES = repoFile('apps/lines/src/game/screenDrives.svelte.ts');
const BOARD_DRIVE = repoFile('apps/lines/src/components/BoardDrive.svelte');
const BOARD_DRIVE_TRANSFORM = repoFile('apps/lines/src/game/boardDrive.ts');
const VALUE_BINDINGS = repoFile('packages/engine-layout/src/lib/valueBindings.ts');
const RESOLVE_TRANSFORM = repoFile('packages/engine-layout/src/lib/resolveTransform.ts');
const REEL_GRID = repoFile('packages/engine-layout/src/lib/reelGrid.ts');

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const harness = 'globalThis.__screenTimelineHarness';

// A `LayoutScene` stand-in, compiled here: while mounted it sits in the harness's set, with who
// mounted it and the node driver it was handed (read once at init, as the real one does). Like a
// real `<LayoutNodeView>`, it asks the driver for the red pot once and samples it in a `$derived`
// (`nodeFold`), so `drawnY` is where that pot draws as the mounted node follows the timeline.
const { compile } = createRequire(import.meta.url)('svelte/compiler');
const recordingScene = (who) =>
	moduleUrl(
		compile(
			`<script>
				import { onMount } from 'svelte';
				const props = $props();
				const entry = { who: '${who}', scene: props.scene?.id, driver: props.nodeDriver };
				const drive = props.nodeDriver?.('pot-red');
				const drawnY = $derived(drive?.sample().y);
				$effect(() => {
					entry.drawnY = drawnY;
				});
				onMount(() => {
					${harness}.scenes.add(entry);
					return () => ${harness}.scenes.delete(entry);
				});
			</script>`,
			{ filename: `${who}-scene.svelte`, generate: 'client' },
		).js.code,
	);

// The board's wrapping `Container` stand-in: it records the transform `<BoardDrive>` hands it.
const recordingBoard = moduleUrl(
	compile(
		`<script>
			const props = $props();
			$effect(() => {
				${harness}.board = {
					x: props.x,
					y: props.y,
					pivot: props.pivot,
					scale: props.scale,
					rotation: props.rotation,
					alpha: props.alpha,
					visible: props.visible,
				};
			});
		</script>
		{@render props.children?.()}`,
		{ filename: 'board-container.svelte', generate: 'client' },
	).js.code,
);

// The base game's below-reel layers, mounted as `Game.svelte` mounts them (pinned in section 6).
const basegameLayers = moduleUrl(
	compile(
		`<script>
			import LayoutScene from ${JSON.stringify(recordingScene('engine'))};
			const props = $props();
		</script>
		{#key props.drive?.key}
			<LayoutScene scene={props.scene} nodeDriver={props.drive?.driver} />
		{/key}`,
		{ filename: 'basegame-layers.svelte', generate: 'client' },
	).js.code,
);

/** Each component's imports that draw, or that the game wires at boot, are stand-ins. */
const STUBS = {
	[FLOW_CINEMATICS]: {
		'components-layout': moduleUrl(
			'export const MainContainer = (anchor, props) => props.children?.(anchor);',
		),
		'engine-layout': moduleUrl(`export { cinematicSetSceneId } from '${CINEMATIC_NODES}';`),
		'engine-layout/svelte': moduleUrl(`export { default as Cinematic } from '${CINEMATIC}';`),
		'utils-event-emitter': moduleUrl('export const getContextEventEmitter = () => undefined;'),
		'../editor-scenes': moduleUrl(`export const bakedCinematic = (id) => ${harness}.docs[id];`),
		'../game/sound': moduleUrl('export const sound = { hasSound: () => false, players: {} };'),
		'../game/stateLayout': moduleUrl(
			`export const stateLayoutDerived = { layoutType: () => ${harness}.layout.get('type') };`,
		),
	},
	[CINEMATIC]: {
		'pixi-svelte': moduleUrl(`
			export const getContextApp = () => ${harness}.app;
			export const RigProvider = (anchor, props) => props.children?.(anchor);
		`),
		'./CinematicActor.svelte': moduleUrl('export default () => {};'),
		'./LayoutScene.svelte': recordingScene('copy'),
	},
	[ENGINE_MOUNT]: {
		'pixi-svelte': moduleUrl(
			'export const Container = (anchor, props) => props.children?.(anchor);',
		),
		'engine-layout/svelte': moduleUrl(
			`export { default as LayoutScene } from ${JSON.stringify(recordingScene('engine'))};`,
		),
	},
	[BOARD_DRIVE]: {
		'pixi-svelte': moduleUrl(
			`export { default as Container } from ${JSON.stringify(recordingBoard)};`,
		),
		'engine-layout': moduleUrl(`export { resolveTransform } from '${RESOLVE_TRANSFORM}';`),
	},
	[BOARD_DRIVE_TRANSFORM]: {
		'engine-layout': moduleUrl(`
			export { foldBoundTransform } from '${VALUE_BINDINGS}';
			export { nodeActorBindings, nodeActorOutputs } from '${CINEMATIC_NODES}';
			export { resolveTransform } from '${RESOLVE_TRANSFORM}';
		`),
	},
};

register(
	moduleUrl(`
		import { readFile } from 'node:fs/promises';
		import { createRequire } from 'node:module';
		import { fileURLToPath } from 'node:url';

		const STUBS = ${JSON.stringify(STUBS)};
		const ROOT = ${JSON.stringify(ROOT)};

		// The browser build of every \`svelte\` entry: the server build has no scheduler and runs no
		// effects. A stand-in is a data: module, which cannot resolve a bare specifier itself, so its
		// imports (the compiled scene's \`svelte/internal/client\`) resolve from the repo root.
		export async function resolve(specifier, context, next) {
			const stub = STUBS[context.parentURL]?.[specifier];
			if (stub) return { url: stub, shortCircuit: true };
			const parentURL = context.parentURL?.startsWith('data:') ? ROOT : context.parentURL;
			return next(specifier, {
				...context,
				parentURL,
				conditions: [...context.conditions, 'browser'],
			});
		}

		export async function load(url, context, next) {
			if (!(url.startsWith('file:') && url.endsWith('.svelte'))) return next(url, context);
			const path = fileURLToPath(url);
			const { compile } = createRequire(path)('svelte/compiler');
			const source = await readFile(path, 'utf8');
			const { js } = compile(source, { filename: path, generate: 'client' });
			return { format: 'module', source: js.code, shortCircuit: true };
		}
	`),
	pathToFileURL('./'),
);

// The components, the screen bookkeeping and this harness must share ONE Svelte runtime: with two,
// a write this file makes is invisible to the components' effects and nothing below tests anything.
const svelteCopies = new Set(
	['package.json', 'apps/lines/package.json', 'packages/engine-layout/package.json'].map((pkg) =>
		realpathSync(createRequire(fileURLToPath(repoFile(pkg))).resolve('svelte/package.json')),
	),
);
if (svelteCopies.size !== 1) {
	console.log(`FAIL  one Svelte runtime — found ${[...svelteCopies].join(', ')}`);
	process.exit(1);
}

const { flushSync, mount, unmount, untrack } = await import('svelte');
const { SvelteMap } = await import('svelte/reactivity');
const { createScreenDrives } = await import(SCREEN_DRIVES);
const { default: FlowV2Cinematics } = await import(FLOW_CINEMATICS);
const { default: EngineScreenMount } = await import(ENGINE_MOUNT);
const { default: BoardDrive } = await import(BOARD_DRIVE);
const { default: BasegameLayers } = await import(basegameLayers);
const { BOARD_UNDRIVEN, boardDriveTransform, heldReelGridNode } = await import(
	BOARD_DRIVE_TRANSFORM
);
const { resolveReelGridFromNode } = await import(REEL_GRID);
const { resolveTransform } = await import(RESOLVE_TRANSFORM);

/** What `<Cinematic>` reads of Pixi's ticker: `add`, `remove` and the last frame's `deltaMS`. */
const ticker = {
	deltaMS: 0,
	listeners: new Set(),
	add(fn) {
		this.listeners.add(fn);
		return this;
	},
	remove(fn) {
		this.listeners.delete(fn);
		return this;
	},
};
const layout = new SvelteMap([['type', 'desktop']]);
const state = {
	app: { stateApp: { pixiApplication: { ticker } } },
	scenes: new Set(),
	docs: {},
	layout,
};
globalThis.__screenTimelineHarness = state;

let failures = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const FRAME_MS = 1000 / 60;
const frames = (n) => {
	for (let i = 0; i < n; i++) {
		ticker.deltaMS = FRAME_MS;
		for (const fn of [...ticker.listeners]) fn(ticker);
		flushSync();
	}
};

/** The Pots screen as the add-on seeds it: three named Pot Meters (what draws them is stubbed). */
const POTS = {
	id: 'pots',
	name: 'Pots',
	nodes: ['red', 'blue', 'green'].map((meter, i) => ({
		id: `pot-${meter}`,
		label: `Pot (${meter})`,
		kind: 'componentInstance',
		componentId: 'potMeter',
		x: 700 + i * 250,
		y: 215,
		params: { meter },
		overrides: { portrait: { x: 100 + i * 180, y: 165, scale: { x: 0.25, y: 0.25 } } },
	})),
};
const key = (time, value) => ({ time, value, ease: 'linear' });
/**
 * The reported timeline ("HideUnderReel"): every pot drops 400 design px in 1 s. With `portrait`,
 * Portrait has keys of its own that drop the smaller portrait pots 250 instead.
 */
const potsDrop = ({ id = 'pots_drop', portrait = false } = {}) => ({
	schemaVersion: 1,
	id,
	name: 'HideUnderReel',
	duration: 1,
	fps: 30,
	host: { kind: 'screen', sceneId: 'pots' },
	stage: {
		sceneId: null,
		cast: POTS.nodes.map((node, z) => ({
			actorId: `a_${node.id}`,
			kind: 'node',
			target: node.label,
			place: {},
			z,
		})),
	},
	tracks: POTS.nodes.flatMap((node) => [
		{
			id: `t_${node.id}`,
			actorId: `a_${node.id}`,
			kind: 'property',
			channels: { y: [key(0, 0), key(1, 400)] },
		},
		...(portrait
			? [
					{
						id: `t_${node.id}_portrait`,
						actorId: `a_${node.id}`,
						kind: 'property',
						layout: 'portrait',
						channels: { y: [key(0, 0), key(1, 250)] },
					},
				]
			: []),
	]),
	markers: [],
});

/**
 * One game, as `Game.svelte` wires it: the flow's playing cinematics and screen bookkeeping (the real
 * `createScreenDrives`), `<FlowV2Cinematics>` with the `onStage` Game passes it, and the game's own
 * Pots mount — `<EngineScreenMount>` with the flow handle, or, as `main` mounted it before the fix,
 * a plain `<LayoutScene>` the flow never hears about (`reportsMount: false`: no engine screens).
 */
function game({ reportsMount = true } = {}) {
	const playing = new SvelteMap();
	const drives = createScreenDrives((id) => playing.has(id), reportsMount ? [POTS.id] : []);
	const flow = {
		playingCinematics: playing,
		resolveScene: (id) => (id === POTS.id ? POTS : undefined),
		cinematicComplete: (id) => {
			playing.delete(id);
			drives.dropIdle();
		},
		onStage: drives.onStage,
		screenDrive: drives.drive,
		driveScreen: drives.driveScreen,
		engineScreenUp: drives.setEngineScreen,
	};
	const onStage = (sceneId) => flow.onStage(sceneId);
	const mountPots = () =>
		mount(EngineScreenMount, {
			target: new Element(),
			props: { scene: POTS, z: 120, ...(reportsMount ? { flow } : {}) },
		});
	let pots = mountPots();
	const cinematics = mount(FlowV2Cinematics, { target: new Element(), props: { flow, onStage } });
	flushSync();
	return {
		drives,
		play(doc) {
			state.docs[doc.id] = doc;
			playing.set(doc.id, { loop: false, speed: 1 });
			flushSync();
		},
		playing: (id) => playing.has(id),
		boardDown() {
			unmount(pots);
			flushSync();
		},
		boardUp() {
			pots = mountPots();
			flushSync();
		},
		end() {
			unmount(cinematics);
			unmount(pots);
			flushSync();
			state.scenes.clear();
		},
	};
}

/** The Pots screens mounted right now, by who mounted them. */
const potsScenes = (who) => [...state.scenes].filter((s) => s.scene === 'pots' && s.who === who);
/** Where a pot draws relative to its authored pose: its `y` channel, through the mounted driver. */
const potY = (node = 'pot-red') => potsScenes('engine')[0]?.driver?.(node)?.sample().y;
/** The first pot `y` any mounted driver gives, or undefined when none drives a pot. */
const potsY = () => POTS.nodes.map((node) => potY(node.id)).find((y) => y !== undefined);
/** Where the mounted red pot draws: its node's own reactive sample, as the game's fold reads it. */
const drawnY = () => potsScenes('engine')[0]?.drawnY;

// --- 1. before: the game's Pots mount is not up for timelines, so the timeline draws a copy -------
{
	const run = game({ reportsMount: false });
	run.play(potsDrop());
	check('before: the pots the player sees are mounted', potsScenes('engine').length === 1);
	check('before: the timeline draws a SECOND set of pots (the duplicate)', potsScenes('copy').length === 1, `${potsScenes('copy').length} copies`); // prettier-ignore
	check('before: the pots the player sees get no driver — they never move', potsY() === undefined);
	frames(70);
	check('before: the duplicate is gone once the timeline ends', potsScenes('copy').length === 0 && !run.playing('pots_drop')); // prettier-ignore
	run.end();
}

// --- 2. the fix: the game's own mount is up, so the timeline moves it --------------------------
{
	const run = game();
	check('fix: the Pots mount the game made counts as up', run.drives.isUp('pots'));
	run.play(potsDrop());
	check('fix: no copy of the screen is drawn', potsScenes('copy').length === 0, `${potsScenes('copy').length} copies`); // prettier-ignore
	check('fix: exactly one set of pots on screen', potsScenes('engine').length === 1, `${potsScenes('engine').length} mounts`); // prettier-ignore
	check('fix: the pots the player sees take the timeline driver', typeof potsScenes('engine')[0]?.driver === 'function'); // prettier-ignore
	check('fix: it drives every named pot', POTS.nodes.every((node) => potY(node.id) === 0), POTS.nodes.map((n) => potY(n.id)).join()); // prettier-ignore
	frames(30);
	const mid = potY();
	check('fix: the pots move with the playhead', mid > 150 && mid < 250, `y=${mid}`);
	frames(40);
	check('fix: the timeline ends', !run.playing('pots_drop'));
	check('fix: the pots hold the last frame while the screen stays up', potY() === 400 && potsScenes('engine').length === 1, `y=${potY()}`); // prettier-ignore
	check('fix: still no copy after the end', potsScenes('copy').length === 0);
	run.boardDown();
	check('fix: the board going down takes the screen down', !run.drives.isUp('pots'));
	check('fix: …and drops the held drive', run.drives.drive('pots') === undefined);
	run.boardUp();
	check('fix: mounted again, the pots are undriven (back where they were placed)', potsScenes('engine').length === 1 && potsScenes('engine')[0].driver === undefined); // prettier-ignore
	run.end();
}

// --- 2b. the board goes down while a Pots timeline plays: the timeline draws nothing either ----
{
	const run = game();
	run.play(potsDrop({ id: 'pots_down' }));
	frames(20);
	run.boardDown();
	check('board down mid-play: the game’s Pots screen is down', !run.drives.isUp('pots'));
	check('board down mid-play: no copy — the timeline draws nothing, as the screen does', potsScenes('copy').length === 0 && potsScenes('engine').length === 0); // prettier-ignore
	check('board down mid-play: the drive is kept while it plays', run.drives.drive('pots') !== undefined); // prettier-ignore
	run.boardUp();
	const back = drawnY();
	check('board up mid-play: the pots pick the timeline up where it is', back > 100 && back < 400, `y=${back}`); // prettier-ignore
	frames(60);
	check('board up mid-play: …and hold its last frame', drawnY() === 400, `y=${drawnY()}`);
	run.end();
}

// --- 3. a screen the flow shows still behaves as before ------------------------------------------
{
	const run = game({ reportsMount: false });
	run.drives.setFlowScreens(['pots']);
	run.play(potsDrop());
	check('flow-shown: no copy', potsScenes('copy').length === 0);
	check('flow-shown: the drive is handed to the shown screen', run.drives.drive('pots') !== undefined); // prettier-ignore
	frames(70);
	check('flow-shown: the drive holds after the end while shown', run.drives.drive('pots') !== undefined); // prettier-ignore
	run.drives.setFlowScreens([]);
	check('flow-shown: hidden, the drive is dropped', run.drives.drive('pots') === undefined);
	run.end();
}

// --- 4. per-ratio keys --------------------------------------------------------------------------
{
	const run = game();
	layout.set('type', 'desktop');
	run.play(potsDrop({ id: 'pots_ratio', portrait: true }));
	frames(70);
	check('ratio: desktop plays the default keys', potY() === 400, `y=${potY()}`);
	layout.set('type', 'portrait');
	flushSync();
	check('ratio: portrait plays its own keys (turning the device switches live)', potY() === 250, `y=${potY()}`); // prettier-ignore
	check('ratio: …and the mounted pot, holding its last frame, redraws there', drawnY() === 250, `y=${drawnY()}`); // prettier-ignore
	layout.set('type', 'tablet');
	flushSync();
	check('ratio: a ratio without keys of its own plays the default keys', potY() === 400 && drawnY() === 400, `y=${potY()}`); // prettier-ignore
	run.end();
}
{
	const run = game();
	layout.set('type', 'portrait');
	run.play(potsDrop({ id: 'pots_default' }));
	frames(30);
	const mid = potY();
	check('ratio: a timeline with no ratio keys plays its keys in every ratio', mid > 150 && mid < 250, `y=${mid}`); // prettier-ignore
	run.end();
	layout.set('type', 'desktop');
}
{
	const run = game();
	layout.set('type', 'portrait');
	run.play(potsDrop({ id: 'pots_portrait_mid', portrait: true }));
	frames(30);
	const mid = potY();
	check('ratio: mid-play in portrait follows the portrait keys', mid > 100 && mid < 150, `y=${mid}`); // prettier-ignore
	layout.set('type', 'desktop');
	flushSync();
	const turned = drawnY();
	check('ratio: turning the device mid-play switches the mounted pot to that ratio\'s keys', turned > 150 && turned < 250, `y=${turned}`); // prettier-ignore
	run.end();
	layout.set('type', 'desktop');
}

// --- 4b. the base game ----------------------------------------------------------------------------
/** The reported base game: the reel frame art, then the reel grid the engine draws the reels at. */
const BASEGAME = {
	id: 'basegame',
	name: 'Base game',
	role: 'basegame',
	nodes: [
		{ id: 'n_frame', label: 'Reel.png', kind: 'sprite', x: 960, y: 801.5 },
		{
			id: 'n_grid',
			label: 'Reel grid',
			kind: 'reelGrid',
			x: 960,
			y: 801.5,
			anchor: { x: 0.5, y: 0.5 },
			reels: 5,
			rows: 3,
			cellSize: 120,
			scale: { x: 1.18, y: 1.18 },
			overrides: { portrait: { x: 288, y: 648 } },
		},
	],
};
/**
 * The reported timeline ("Intro", 2 s): the reel frame hidden, the reel grid zooming in from 0.1
 * while it rises from +298.5 to −151.5 at 1.27 s and settles on 0. `extra` adds channels to the grid.
 */
const basegameIntro = ({ id = 'basegame_intro', extra = {}, gridVisible } = {}) => ({
	schemaVersion: 1,
	id,
	name: 'Intro',
	duration: 2,
	fps: 30,
	host: { kind: 'screen', sceneId: 'basegame' },
	stage: {
		sceneId: null,
		cast: [
			{ actorId: 'a_frame', kind: 'node', target: 'Reel.png', place: {}, z: 0 },
			{ actorId: 'a_grid', kind: 'node', target: 'Reel grid', place: {}, z: 1 },
		],
	},
	tracks: [
		{
			id: 't_frame',
			actorId: 'a_frame',
			kind: 'visibility',
			keys: [{ time: 1 / 15, visible: false }],
		},
		{
			id: 't_grid',
			actorId: 'a_grid',
			kind: 'property',
			channels: {
				y: [key(0, 298.5), key(1.2667, -151.5), key(2, 0)],
				scale: [key(0, 0.1), key(2, 1)],
				...extra,
			},
		},
		...(gridVisible === undefined
			? []
			: [{ id: 't_grid_vis', actorId: 'a_grid', kind: 'visibility', keys: [{ time: 0, visible: gridVisible }] }]), // prettier-ignore
	],
	markers: [],
});

/**
 * The base game, as `Game.svelte` wires it: the flow SHOWS `basegame`, which `<FlowV2Mount>` skips,
 * so the game draws it split around the reels — the layers (`basegameLayers`) and the board
 * (`<BoardDrive>`), each handed the base game's drive. `before` is `main` before the fix: Game kept
 * `basegame` off stage and handed neither the drive. `drivesScreens: false` is a flow that shows
 * `basegame` without driving the screens, where a v1 interpreter may draw it: it keeps `before`'s
 * behaviour. `heldGrid()` is Game's `basegameHeldReelGrid`, the node the board is laid out from once
 * the timeline ends (undefined: the authored grid).
 */
function basegameGame({ before = false, drivesScreens = true, scene = BASEGAME } = {}) {
	const grid = scene.nodes[1];
	const playing = new SvelteMap();
	const drives = createScreenDrives((id) => playing.has(id));
	const flow = {
		playingCinematics: playing,
		resolveScene: (id) => (id === scene.id ? scene : undefined),
		cinematicComplete: (id) => {
			playing.delete(id);
			drives.dropIdle();
		},
		onStage: drives.onStage,
		screenDrive: drives.drive,
		driveScreen: drives.driveScreen,
		engineScreenUp: drives.setEngineScreen,
	};
	drives.setFlowScreens([BASEGAME.id]);
	const basegameOnStage = () => !before && drivesScreens && flow.onStage(BASEGAME.id);
	const onStage = (sceneId) =>
		sceneId === BASEGAME.id ? basegameOnStage() : flow.onStage(sceneId);
	const basegameDrive = () => (basegameOnStage() ? flow.screenDrive(BASEGAME.id) : undefined);
	const heldGrid = () => {
		const drive = basegameDrive();
		if (!drive || !drives.holding(BASEGAME.id)) return undefined;
		const gridDrive = untrack(() => drive.driver(grid.id));
		return gridDrive
			? heldReelGridNode(grid, gridDrive.channels, gridDrive.sample(), layout.get('type'))
			: undefined;
	};
	const layers = mount(BasegameLayers, {
		target: new Element(),
		props: {
			scene,
			get drive() {
				return basegameDrive();
			},
		},
	});
	const board = mount(BoardDrive, {
		target: new Element(),
		props: {
			get drive() {
				return basegameDrive();
			},
			node: grid,
			get layoutType() {
				return layout.get('type');
			},
			get layoutHeld() {
				return !!heldGrid();
			},
			children: () => {},
		},
	});
	const cinematics = mount(FlowV2Cinematics, { target: new Element(), props: { flow, onStage } });
	flushSync();
	return {
		drives,
		heldGrid,
		/** Where the board's wrapper would draw the grid's keys without a held layout. */
		drawn() {
			const gridDrive = basegameDrive()?.driver(grid.id);
			return boardDriveTransform(
				gridDrive.channels,
				gridDrive.sample(),
				resolveTransform(grid, layout.get('type')),
			);
		},
		play(doc) {
			state.docs[doc.id] = doc;
			playing.set(doc.id, { loop: false, speed: 1 });
			flushSync();
		},
		playing: (id) => playing.has(id),
		hide() {
			drives.setFlowScreens([]);
			flushSync();
		},
		end() {
			unmount(cinematics);
			unmount(board);
			unmount(layers);
			flushSync();
			state.scenes.clear();
			state.board = undefined;
		},
	};
}

/** The base-game screens mounted right now, by who mounted them. */
const basegameScenes = (who) =>
	[...state.scenes].filter((s) => s.scene === 'basegame' && s.who === who);
/** The reel frame's visibility through the base game's mounted driver (undefined: not driven). */
const frameVisible = () => basegameScenes('engine')[0]?.driver?.('n_frame')?.sample().visible;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const boardAt = (x, y, sx) => {
	const b = state.board;
	return !!b && near(b.x, x) && near(b.y, y) && near(b.scale.x, sx) && near(b.scale.y, sx);
};
const boardText = () => JSON.stringify(state.board);

{
	const run = basegameGame({ before: true });
	run.play(basegameIntro());
	check('basegame before: the timeline draws a copy of the base game', basegameScenes('copy').length === 1, `${basegameScenes('copy').length} copies`); // prettier-ignore
	check('basegame before: the base game the player sees gets no driver', basegameScenes('engine').length === 1 && frameVisible() === undefined); // prettier-ignore
	check('basegame before: the board does not move', state.board === BOARD_UNDRIVEN || boardAt(0, 0, 1), boardText()); // prettier-ignore
	run.end();
}
{
	const run = basegameGame();
	check('basegame: undriven, the board wrapper is identity (parity)', state.board?.x === 0 && state.board?.y === 0 && state.board?.pivot.x === 0 && state.board?.scale.x === 1 && state.board?.rotation === 0 && state.board?.alpha === 1 && state.board?.visible === true, boardText()); // prettier-ignore
	run.play(basegameIntro());
	check('basegame: no copy of the screen is drawn', basegameScenes('copy').length === 0, `${basegameScenes('copy').length} copies`); // prettier-ignore
	check('basegame: exactly one base game on screen', basegameScenes('engine').length === 1, `${basegameScenes('engine').length} mounts`); // prettier-ignore
	check('basegame: its layers take the driver (the reel frame is hidden)', frameVisible() === false); // prettier-ignore
	check('basegame: the board starts zoomed out and lowered, about the grid’s position', boardAt(960, 801.5 + 298.5, 0.1) && near(state.board.pivot.x, 960) && near(state.board.pivot.y, 801.5), boardText()); // prettier-ignore
	frames(60);
	const mid = state.board;
	check('basegame: the board follows the playhead', mid.scale.x > 0.5 && mid.scale.x < 0.6 && mid.y < 801.5 && mid.y > 801.5 - 151.5, boardText()); // prettier-ignore
	check('basegame: while it plays, the board’s layout stays authored', !run.drives.holding('basegame') && run.heldGrid() === undefined); // prettier-ignore
	frames(70);
	check('basegame: the timeline ends', !run.playing('basegame_intro'));
	check('basegame: the board holds the last frame (back on its authored pose)', boardAt(960, 801.5, 1) && state.board.visible, boardText()); // prettier-ignore
	check('basegame: the layers hold the last frame too', frameVisible() === false && basegameScenes('engine').length === 1); // prettier-ignore
	check('basegame: ending on the authored pose, the board’s layout is left alone (parity)', run.drives.holding('basegame') && run.heldGrid() === undefined); // prettier-ignore
	layout.set('type', 'portrait');
	flushSync();
	check('basegame: turned to portrait, the board pivots on the grid’s portrait position', boardAt(288, 648, 1) && near(state.board.pivot.x, 288), boardText()); // prettier-ignore
	layout.set('type', 'desktop');
	flushSync();
	run.hide();
	check('basegame: hidden, the drive is dropped', run.drives.drive('basegame') === undefined);
	check('basegame: …the board is undriven again', boardAt(0, 0, 1) && state.board.pivot.x === 0, boardText()); // prettier-ignore
	check('basegame: …and the layers remount undriven', basegameScenes('engine').length === 1 && frameVisible() === undefined); // prettier-ignore
	run.end();
}
{
	const run = basegameGame({ drivesScreens: false });
	run.play(basegameIntro({ id: 'basegame_v1' }));
	check('basegame, flow not driving the screens: the copy is drawn as before', basegameScenes('copy').length === 1, `${basegameScenes('copy').length} copies`); // prettier-ignore
	check('basegame, flow not driving the screens: the base game and board are left alone', frameVisible() === undefined && boardAt(0, 0, 1), boardText()); // prettier-ignore
	run.end();
}
{
	const run = basegameGame();
	run.play(
		basegameIntro({
			id: 'basegame_turn',
			extra: { rotation: [key(0, 90), key(2, 90)], alpha: [key(0, 0.5), key(2, 0.5)] },
			gridVisible: false,
		}),
	);
	check('basegame: a turn keyed on the grid turns the board (degrees → radians)', near(state.board.rotation, Math.PI / 2), boardText()); // prettier-ignore
	check('basegame: a fade keyed on the grid fades the board', near(state.board.alpha, 0.5), boardText()); // prettier-ignore
	check('basegame: a visibility key on the grid hides the board', state.board.visible === false, boardText()); // prettier-ignore
	run.end();
}
{
	// An intro that ends with the reels moved: 30 right, 40 up, at 0.8, on a grid nudged off its node.
	const grid = { ...BASEGAME.nodes[1], boardNudgeX: 12, boardNudgeY: -8 };
	const run = basegameGame({ scene: { ...BASEGAME, nodes: [BASEGAME.nodes[0], grid] } });
	const moved = (id) =>
		basegameIntro({
			id,
			extra: {
				x: [key(0, 0), key(2, 30)],
				y: [key(0, 298.5), key(2, -40)],
				scale: [key(0, 0.1), key(2, 0.8)],
			},
		});
	/** The board's laid-out centre and cell (`boardLayout()`), against where the drawing put them. */
	const laidOutAsDrawn = () => {
		const type = layout.get('type');
		const authored = resolveReelGridFromNode(grid, type);
		const held = resolveReelGridFromNode(run.heldGrid(), type);
		const drawn = run.drawn();
		const at = (v, axis) => drawn[axis] + drawn.scale[axis] * (v - drawn.pivot[axis]);
		return (
			!!held &&
			near(held.x + held.boardNudgeX, at(authored.x + authored.boardNudgeX, 'x')) &&
			near(held.y + held.boardNudgeY, at(authored.y + authored.boardNudgeY, 'y')) &&
			near(held.cellSize, authored.cellSize * drawn.scale.x)
		);
	};
	const heldText = () =>
		JSON.stringify(resolveReelGridFromNode(run.heldGrid(), layout.get('type')));
	run.play(moved('basegame_moved'));
	frames(60);
	check('basegame moved: while it plays, only the drawing moves', run.heldGrid() === undefined && boardAt(960 + 15, 801.5 + 129.25, 0.45), boardText()); // prettier-ignore
	frames(70);
	check('basegame moved: the timeline ends', !run.playing('basegame_moved'));
	check('basegame moved: the board is laid out where the timeline left the grid', laidOutAsDrawn(), heldText()); // prettier-ignore
	check('basegame moved: …so the reels sit 30 right, 40 up, at 0.8', near(resolveReelGridFromNode(run.heldGrid(), 'desktop').x + 12, 960 + 30 + 12 * 0.8) && near(resolveReelGridFromNode(run.heldGrid(), 'desktop').cellSize, 120 * 1.18 * 0.8), heldText()); // prettier-ignore
	check('basegame moved: the wrapper stops moving the board (no double move)', boardAt(990, 761.5, 1) && near(state.board.pivot.x, 990) && near(state.board.pivot.y, 761.5), boardText()); // prettier-ignore
	layout.set('type', 'portrait');
	flushSync();
	check('basegame moved: turned to portrait, the layout is the portrait grid moved', laidOutAsDrawn() && near(resolveReelGridFromNode(run.heldGrid(), 'portrait').x, 288 + 30 + 12 * (0.8 - 1)), heldText()); // prettier-ignore
	check('basegame moved: …and the wrapper still only turns about it', boardAt(318, 608, 1) && near(state.board.pivot.x, 318), boardText()); // prettier-ignore
	layout.set('type', 'desktop');
	flushSync();
	run.play(moved('basegame_moved_again'));
	check('basegame moved: replayed, the layout is authored again and the drawing moves', run.heldGrid() === undefined && boardAt(960, 801.5 + 298.5, 0.1), boardText()); // prettier-ignore
	frames(130);
	check('basegame moved: …and held again once it ends', laidOutAsDrawn(), heldText());
	run.hide();
	check('basegame moved: hidden, the layout is authored again', run.heldGrid() === undefined && !run.drives.holding('basegame') && boardAt(0, 0, 1), boardText()); // prettier-ignore
	run.end();
}
{
	const run = basegameGame();
	run.play(
		basegameIntro({
			id: 'basegame_squash',
			extra: { scale: [], scaleX: [key(0, 1), key(2, 1.2)], scaleY: [key(0, 1), key(2, 0.9)] },
		}),
	);
	frames(130);
	check('basegame squashed: an uneven end scale stays on the drawing (the board scales evenly)', run.heldGrid() === undefined && near(state.board.scale.x, 1.2) && near(state.board.scale.y, 0.9), boardText()); // prettier-ignore
	run.end();
}

// --- 5. the game wires it as this gate does -------------------------------------------------------
// The gate builds its own flow handle. These pin the real wiring to it, so a `Game.svelte` that
// mounts the Pots screen without the handle or reverts `onStage`, or a runtime that stops counting
// its own Pots screen, fails here rather than only in a live game.
{
	const source = (path) => readFileSync(fileURLToPath(repoFile(path)), 'utf8');
	const gameSource = source('apps/lines/src/components/Game.svelte');
	const runtime = source('apps/lines/src/game/flowV2Runtime.svelte.ts');
	check('wiring: Game mounts its own Pots screen through <EngineScreenMount> with the flow handle', /\{#if flowV2EnginePots\}\s*<EngineScreenMount\s+scene=\{flowV2EnginePots\.scene\}\s+z=\{flowV2EnginePots\.z\}\s+flow=\{flowV2Handle\}\s*\/>/.test(gameSource)); // prettier-ignore
	check('wiring: Game hands <FlowV2Cinematics> the flow handle’s onStage, the base game through basegameOnStage', /<FlowV2Cinematics\s+flow=\{flowV2Handle\}\s+onStage=\{\(sceneId\) =>\s+sceneId === basegameScreenId\s+\? basegameOnStage\s+: !!flowV2ResolveScene && !!flowV2Handle\?\.onStage\(sceneId\)\}/.test(gameSource)); // prettier-ignore
	check('wiring: the base game is on stage only under a flow that drives the screens', /const basegameOnStage = \$derived\(\s*flowV2DrivesScreens && !!flowV2Handle\?\.onStage\(basegameScreenId\),?\s*\);/.test(gameSource)); // prettier-ignore
	check('wiring: Game takes the base game’s drive while it is on stage', /const basegameDrive = \$derived\(\s*basegameOnStage \? flowV2Handle\?\.screenDrive\(basegameScreenId\) : undefined,?\s*\);/.test(gameSource)); // prettier-ignore
	check('wiring: the board follows the base game’s reelGrid only when the board is laid out from it', /node\.id === findReelGridNode\(editorDoc\)\?\.id/.test(gameSource) && /setBoardOverride\(findReelGridNode\(doc\) \?\? null\)/.test(gameSource)); // prettier-ignore
	// Inside their own <Container>: a remount appends to its parent, and these layers share the board's
	// parent, so a bare remount drew them OVER the reels (the base game's frame above its symbols).
	check('wiring: the below-reel layers remount with it, in their own container (kept under the board)', /<Container>\s*\{#key basegameDrive\?\.key\}\s*<LayoutScene scene=\{basegameBelowReel\} nodeDriver=\{basegameDrive\?\.driver\} \/>\s*\{\/key\}\s*<\/Container>/.test(gameSource)); // prettier-ignore
	check('wiring: the above-reel layers remount with it, in their own container', /<Container>\s*\{#key basegameDrive\?\.key\}\s*<LayoutScene scene=\{basegameAboveReel\} nodeDriver=\{basegameDrive\?\.driver\} \/>\s*\{\/key\}\s*<\/Container>/.test(gameSource)); // prettier-ignore
	check('wiring: the board is drawn inside <BoardDrive> with it, the base game’s reelGrid and whether its layout holds the end pose', /<BoardDrive\s+drive=\{basegameDrive\}\s+node=\{basegameReelGrid\}\s+layoutType=\{context\.stateLayoutDerived\.layoutType\(\)\}\s+layoutHeld=\{!!basegameHeldReelGrid\}\s*>(?:(?!<\/BoardDrive>)[\s\S])*\{@render reelStack\(\)\}/.test(gameSource)); // prettier-ignore
	check('wiring: Game holds the grid’s end pose only once the base game’s timeline has ended', /const basegameHeldReelGrid = \$derived\.by\(\(\) => \{\s*const drive = basegameDrive;\s*const node = basegameReelGrid;\s*if \(!drive \|\| !node \|\| !flowV2Handle\?\.screenHolding\(basegameScreenId\)\) return undefined;\s*const gridDrive = untrack\(\(\) => drive\.driver\(node\.id\)\);\s*return gridDrive\s*\? heldReelGridNode\(\s*node,\s*gridDrive\.channels,\s*gridDrive\.sample\(\),\s*context\.stateLayoutDerived\.layoutType\(\),?\s*\)\s*: undefined;\s*\}\);/.test(gameSource)); // prettier-ignore
	check('wiring: Game lays the board out from the held grid, and back from the authored one', /\$effect\(\(\) => \{\s*const held = basegameHeldReelGrid;\s*untrack\(\(\) => \{\s*if \(held\) setBoardOverride\(held\);\s*else if \(boardLayoutHeld\) setBoardOverride\(findReelGridNode\(editorDoc\) \?\? null\);\s*boardLayoutHeld = !!held;\s*\}\);\s*\}\);/.test(gameSource)); // prettier-ignore
	check('wiring: the runtime counts its own Pots screen', /createScreenDrives\([^;]*enginePots \? \[enginePots\.scene\.id\] : \[\]/.test(runtime)); // prettier-ignore
	check('wiring: the runtime reports the screens the flow shows', runtime.includes('screenDrives.setFlowScreens(containers.map((container) => container.sceneId))')); // prettier-ignore
	check('wiring: the handle hands out the bookkeeping', ['onStage: screenDrives.onStage', 'screenDrive: screenDrives.drive', 'screenHolding: screenDrives.holding', 'driveScreen: screenDrives.driveScreen', 'engineScreenUp: screenDrives.setEngineScreen'].every((line) => runtime.includes(line))); // prettier-ignore
	check('wiring: <FlowV2Cinematics> hands <Cinematic> the ratio reader', source('apps/lines/src/components/FlowV2Cinematics.svelte').includes('layoutType={stateLayoutDerived.layoutType}')); // prettier-ignore
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
