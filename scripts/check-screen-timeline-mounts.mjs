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
// PER-RATIO KEYS: a screen lays its nodes out per ratio, so one move rarely fits every ratio. A
// property track with a `layout` keys that ratio alone; a ratio with such keys plays them, every
// other ratio the default keys (`keysLayout`), switching live as the device turns.
//
// HOW: the REAL `FlowV2Cinematics.svelte`, `Cinematic.svelte` and `EngineScreenMount.svelte` are
// compiled by Svelte's compiler and mounted through its client runtime on a DOM shim, as
// `check-cinematic-ticker.mjs` does, and the flow handle's screen bookkeeping is the REAL
// `createScreenDrives` the flow runtime builds. What draws is a stand-in: each `LayoutScene` records
// itself while mounted, tagged by who mounted it — the game's own mount, or a `<Cinematic>` copy.

import { realpathSync } from 'node:fs';
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

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const harness = 'globalThis.__screenTimelineHarness';

// A `LayoutScene` stand-in, compiled here: while mounted it sits in the harness's set, with who
// mounted it and the node driver it was handed (read once at init, as the real one does).
const { compile } = createRequire(import.meta.url)('svelte/compiler');
const recordingScene = (who) =>
	moduleUrl(
		compile(
			`<script>
				import { onMount } from 'svelte';
				const props = $props();
				const entry = { who: '${who}', scene: props.scene?.id, driver: props.nodeDriver };
				onMount(() => {
					${harness}.scenes.add(entry);
					return () => ${harness}.scenes.delete(entry);
				});
			</script>`,
			{ filename: `${who}-scene.svelte`, generate: 'client' },
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

const { flushSync, mount, unmount } = await import('svelte');
const { SvelteMap } = await import('svelte/reactivity');
const { createScreenDrives } = await import(SCREEN_DRIVES);
const { default: FlowV2Cinematics } = await import(FLOW_CINEMATICS);
const { default: EngineScreenMount } = await import(ENGINE_MOUNT);

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
 * without one (a plain `<LayoutScene>` the flow never hears about).
 */
function game({ reportsMount = true } = {}) {
	const playing = new SvelteMap();
	const drives = createScreenDrives((id) => playing.has(id));
	const flow = {
		playingCinematics: playing,
		resolveScene: (id) => (id === POTS.id ? POTS : undefined),
		cinematicComplete: (id) => {
			playing.delete(id);
			drives.dropIdle();
		},
		sceneShown: drives.isUp,
		screenDrive: drives.drive,
		driveScreen: drives.driveScreen,
		engineScreenUp: drives.setEngineScreen,
	};
	const onStage = (sceneId) => sceneId !== 'basegame' && flow.sceneShown(sceneId);
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
	layout.set('type', 'tablet');
	flushSync();
	check('ratio: a ratio without keys of its own plays the default keys', potY() === 400, `y=${potY()}`); // prettier-ignore
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
	const turned = potY();
	check('ratio: turning the device mid-play switches to that ratio\'s keys', turned > 150 && turned < 250, `y=${turned}`); // prettier-ignore
	run.end();
	layout.set('type', 'desktop');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
