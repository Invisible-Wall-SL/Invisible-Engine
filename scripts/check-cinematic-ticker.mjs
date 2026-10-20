// Offline gate: an in-game `<Cinematic>` PLAYS. Mounted on a ticking clock, its playhead runs to
// the end and stops there, loops when the doc loops, re-arms when the caller restarts it, and fires
// each cue once.
//
//   pnpm check:cinematic-ticker
//
// THE BUG (Phase 9b, fixed by the hotfix in #1267): the re-arm `$effect` gained `lap = time`. In
// Svelte 5 that is a READ of `time`, so every ticker write re-ran the effect and put the playhead
// back at the start. Every Flow `playCinematic` in a live game stalled on frame 0 and an awaited
// Flow chain never continued, while CI stayed green: `check:cinematic-ease` tests the pure
// evaluator, the parity runs never play a Flow cinematic, and nothing mounted the player on a
// clock.
//
// HOW: the REAL `Cinematic.svelte` is compiled by Svelte's own compiler and mounted through
// Svelte's CLIENT runtime and scheduler on a DOM shim, as `verify-pot-meter-mount.mjs` does. The
// evaluator, the node-actor resolution and the driver context are real. What draws is a stand-in:
// the app context is a fake whose ticker this file steps by hand, and the rig actor keeps the props
// it was handed, so its `time` is exactly the pose a rig would be sampled at. Svelte flushes
// between frames, as a browser's microtask checkpoint does after each animation frame.

import { realpathSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Element } from './lib/svelte-dom-shim.mjs';

const repoFile = (path) => new URL(`../${path}`, import.meta.url).href;
const CINEMATIC = repoFile('packages/engine-layout/src/lib/Cinematic.svelte');

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const harness = 'globalThis.__cinematicHarness';

/** Cinematic's imports that draw are stand-ins; the evaluator and the node driver are real. */
const STUBS = {
	'pixi-svelte': moduleUrl(`
		export const getContextApp = () => ${harness}.app;
		export const RigProvider = (anchor, props) => props.children?.(anchor);
	`),
	'./CinematicActor.svelte': moduleUrl(
		`export default (_, props) => { ${harness}.actors.push(props); };`,
	),
	'./LayoutScene.svelte': moduleUrl('export default () => {};'),
};

register(
	moduleUrl(`
		import { readFile } from 'node:fs/promises';
		import { createRequire } from 'node:module';
		import { fileURLToPath } from 'node:url';

		const STUBS = ${JSON.stringify(STUBS)};
		const CINEMATIC = ${JSON.stringify(CINEMATIC)};

		// The browser build of every \`svelte\` entry: the default (server) build has no scheduler
		// and runs no effects, so the re-arm effect this gate is about would never run at all.
		export async function resolve(specifier, context, next) {
			if (context.parentURL === CINEMATIC && STUBS[specifier])
				return { url: STUBS[specifier], shortCircuit: true };
			return next(specifier, { ...context, conditions: [...context.conditions, 'browser'] });
		}

		export async function load(url, context, next) {
			if (url !== CINEMATIC) return next(url, context);
			const path = fileURLToPath(url);
			const { compile } = createRequire(path)('svelte/compiler');
			const source = await readFile(path, 'utf8');
			const { js } = compile(source, { filename: path, generate: 'client' });
			return { format: 'module', source: js.code, shortCircuit: true };
		}
	`),
	pathToFileURL('./'),
);

// The component and this harness must share ONE Svelte runtime: with two, the props this file sets
// are invisible to the component's effects and the re-arm cases below would test nothing.
const svelteCopies = new Set(
	['package.json', 'packages/engine-layout/package.json'].map((pkg) =>
		realpathSync(createRequire(fileURLToPath(repoFile(pkg))).resolve('svelte/package.json')),
	),
);
if (svelteCopies.size !== 1) {
	console.log(`FAIL  one Svelte runtime — found ${[...svelteCopies].join(', ')}`);
	process.exit(1);
}

const { flushSync, mount, unmount } = await import('svelte');
const { SvelteMap } = await import('svelte/reactivity');
const { default: Cinematic } = await import(CINEMATIC);

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
const state = { app: { stateApp: { pixiApplication: { ticker } } }, actors: [] };
globalThis.__cinematicHarness = state;

let failures = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const FRAME_MS = 1000 / 60;
const DT = FRAME_MS / 1000;
const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) < EPS;

/** Cue keys away from any frame boundary, plus one ON the end, which only the last step crosses. */
const CUE_KEYS = [
	{ time: 0.1, cue: 'sfx:open' },
	{ time: 0.45, cue: 'fx:sparkle' },
	{ time: 0.8, cue: 'signal:half' },
	{ time: 1, cue: 'sfx:end' },
];

/**
 * A 1 s screen timeline: a rig, and a node actor whose `x` is keyed 0 → 1000 over the doc, so
 * `x / 1000` is the playhead seen through the node driver (the path a flow-shown screen reads).
 */
const timeline = ({ id = 'intro', loop } = {}) => ({
	schemaVersion: 1,
	id,
	name: id,
	duration: 1,
	fps: 30,
	...(loop ? { loop } : {}),
	host: { kind: 'screen', sceneId: 'screen' },
	stage: {
		sceneId: 'screen',
		cast: [
			{ actorId: 'hero', kind: 'rig', rigFolder: 'hero', place: {}, z: 0 },
			{ actorId: 'bar', kind: 'node', target: 'bar', place: {} },
		],
	},
	tracks: [
		{
			id: 't_bar',
			actorId: 'bar',
			kind: 'property',
			channels: {
				x: [
					{ time: 0, value: 0, ease: 'linear' },
					{ time: 1, value: 1000, ease: 'linear' },
				],
			},
		},
		{ id: 't_cue', actorId: null, kind: 'cue', keys: CUE_KEYS },
	],
});
const SCREEN = {
	id: 'screen',
	name: 'screen',
	nodes: [{ id: 'n_bar', kind: 'rect', label: 'bar', x: 0, y: 0, width: 10, height: 10 }],
};

const REACTIVE_PROPS = { doc: undefined, playing: true, startTime: undefined, loop: undefined, speed: undefined }; // prettier-ignore

/**
 * Mount a `<Cinematic>` whose props live in a `SvelteMap`, so setting one is a reactive change of
 * that prop alone. Every prop is seeded, absent ones as `undefined`: a `SvelteMap` read of a
 * MISSING key tracks the whole map, so setting any new key would look like a change to every
 * absent prop.
 */
function play(initial) {
	const values = new SvelteMap(Object.entries({ ...REACTIVE_PROPS, ...initial }));
	const run = { completes: 0, cues: [], driver: undefined };
	const props = {
		scene: SCREEN,
		setMounted: true,
		ondriver: (driver) => (run.driver = driver),
		oncomplete: () => (run.completes += 1),
		oncue: (cue) => run.cues.push(cue),
	};
	for (const key of Object.keys(REACTIVE_PROPS))
		Object.defineProperty(props, key, { enumerable: true, get: () => values.get(key) });
	state.actors.length = 0;
	const app = mount(Cinematic, { target: new Element(), props });
	flushSync();
	return Object.assign(run, {
		/** The playhead the rig is posed at. */
		time: () => state.actors.at(-1)?.time,
		/** The playhead as the node driver samples it. */
		nodeTime: () => (run.driver?.('n_bar')?.sample().x ?? NaN) / 1000,
		set(key, value) {
			values.set(key, value);
			flushSync();
		},
		/** Step `n` frames; the playhead after each one. */
		frames(n, ms = FRAME_MS) {
			const out = [];
			for (let i = 0; i < n; i++) {
				ticker.deltaMS = ms;
				for (const fn of [...ticker.listeners]) fn(ticker);
				flushSync();
				out.push(run.time());
			}
			return out;
		},
		/** Step until it completes once more (or `max` frames): the playhead after each frame. */
		untilComplete(max = 600) {
			const times = [];
			const completes = run.completes;
			while (run.completes === completes && times.length < max) times.push(...run.frames(1));
			return times;
		},
		unmount() {
			unmount(app);
			flushSync();
		},
	});
}

/** Every playhead is above the one before it (`from` before the first), by at most one frame. */
const rises = (times, from) =>
	times.every((t, i) => {
		const prev = i === 0 ? from : times[i - 1];
		return t > prev && t - prev <= DT + EPS;
	});
/** How often a cue at `key` should fire in `elapsed` seconds when it fires once per `period`. */
const firesIn = (key, elapsed, period) => (key > elapsed ? 0 : Math.floor((elapsed - key) / period) + 1); // prettier-ignore
const counts = (cues) => Object.fromEntries(CUE_KEYS.map((k) => [k.cue, cues.filter((c) => c === k.cue).length])); // prettier-ignore

// --- 1. a one-shot doc plays to its end, once ---------------------------------------------------
{
	const run = play({ doc: timeline() });
	check('one-shot: mounts at the start', run.time() === 0 && run.completes === 0, `t=${run.time()}`); // prettier-ignore
	check('one-shot: the ticker drives it', ticker.listeners.size === 1, `${ticker.listeners.size} listeners`); // prettier-ignore
	const times = run.untilComplete();
	check('one-shot: reaches oncomplete', run.completes === 1, `after ${times.length} frames, t=${run.time()}`); // prettier-ignore
	check('one-shot: takes 1 s of frames', times.length >= 60 && times.length <= 61, `${times.length} frames`); // prettier-ignore
	check('one-shot: the playhead rises every frame', rises(times, 0), times.slice(0, 4).map((t) => t?.toFixed(4)).join(', ')); // prettier-ignore
	check('one-shot: lands exactly on its last frame', run.time() === 1, `t=${run.time()}`);
	check('one-shot: a node actor samples the same playhead', near(run.nodeTime(), run.time()), `node ${run.nodeTime()}`); // prettier-ignore
	check('cues: each fires once, in order', run.cues.join() === CUE_KEYS.map((k) => k.cue).join(), run.cues.join()); // prettier-ignore
	const after = run.frames(30);
	check(
		'one-shot: holds its last frame',
		after.every((t) => t === 1),
		`t=${run.time()}`,
	);
	check('one-shot: completes only once', run.completes === 1, `${run.completes}×`);
	check('cues: none fire again after the end', run.cues.length === CUE_KEYS.length, run.cues.join()); // prettier-ignore
	run.unmount();
	check('unmount: leaves the ticker', ticker.listeners.size === 0, `${ticker.listeners.size} listeners`); // prettier-ignore
}

// --- 2. looping docs never complete and keep advancing ------------------------------------------
// 17 ms frames do not divide the 1 s doc, so every wrap and turnaround carries an overshoot past
// the end: a loop that restarted at 0 instead of carrying it would step short here.
const LOOP_MS = 17;
const LOOP_DT = LOOP_MS / 1000;
const FRAMES = Math.round(3.5 / LOOP_DT);
const elapsed = FRAMES * LOOP_DT;
const stepsOf = (times) => times.map((t, i) => t - (i === 0 ? 0 : times[i - 1]));

for (const [label, initial] of [
	["loop: 'loop'", { doc: timeline({ loop: 'loop' }) }],
	['the loop prop (a Flow node that loops)', { doc: timeline(), loop: true }],
]) {
	const run = play(initial);
	const times = run.frames(FRAMES, LOOP_MS);
	const steps = stepsOf(times);
	const wraps = steps.filter((s) => s < 0).length;
	check(`${label}: never completes`, run.completes === 0, `${run.completes}×`);
	check(
		`${label}: keeps advancing, wrapping at the end`,
		steps.every((s) => near(s, LOOP_DT) || near(s, LOOP_DT - 1)) && wraps === Math.floor(elapsed),
		`${wraps} wraps, t=${run.time()?.toFixed(4)}`,
	);
	const expected = Object.fromEntries(CUE_KEYS.map((k) => [k.cue, firesIn(k.time, elapsed, 1)]));
	check(`${label}: each cue fires once a lap`, JSON.stringify(counts(run.cues)) === JSON.stringify(expected), JSON.stringify(counts(run.cues))); // prettier-ignore
	run.unmount();
}

{
	const label = "loop: 'pingPong'";
	const run = play({ doc: timeline({ loop: 'pingPong' }) });
	const times = run.frames(FRAMES, LOOP_MS);
	const steps = stepsOf(times);
	const turns = steps.filter((s, i) => i > 0 && Math.sign(s) !== Math.sign(steps[i - 1])).length;
	// Each frame moves it one frame along its there-and-back path, a turnaround at either end folded.
	const travels = times.every((t, i) => {
		const prev = i === 0 ? 0 : times[i - 1];
		return [Math.abs(t - prev), 2 - prev - t, prev + t].some((d) => near(d, LOOP_DT));
	});
	check(`${label}: never completes`, run.completes === 0, `${run.completes}×`);
	check(
		`${label}: keeps advancing, there and back`,
		times.every((t) => t >= 0 && t <= 1) && travels && turns === Math.floor(elapsed),
		`${turns} turnarounds, t=${run.time()?.toFixed(4)}`,
	);
	check(
		`${label}: a node actor samples the same playhead`,
		near(run.nodeTime(), run.time()),
		`node ${run.nodeTime()}`,
	);
	// Out legs only: the back legs would cross every cue a second time.
	const expected = Object.fromEntries(CUE_KEYS.map((k) => [k.cue, firesIn(k.time, elapsed, 2)]));
	check(`${label}: cues fire once per out leg, never on the way back`, JSON.stringify(counts(run.cues)) === JSON.stringify(expected), JSON.stringify(counts(run.cues))); // prettier-ignore
	run.unmount();
}

// --- 3. a new doc.id or startTime re-arms it; a new speed or playing does not --------------------
// Each case changes one prop alone. The game's `FlowV2Cinematics` hands every prop off one entry
// object it rebuilds whenever the flow's playing set changes, which re-arms a playing cinematic
// today; a replay of a still-playing id relies on that to restart it.
{
	const run = play({ doc: timeline() });
	run.untilComplete();
	run.set('doc', timeline({ id: 'outro' }));
	check('a new doc.id: back to the start', run.time() === 0, `t=${run.time()}`);
	const times = run.untilComplete();
	check('a new doc.id: plays it through again', run.completes === 2 && rises(times, 0) && run.time() === 1, `${run.completes}× after ${times.length} frames`); // prettier-ignore
	check('a new doc.id: its cues fire again', run.cues.length === 2 * CUE_KEYS.length, run.cues.join()); // prettier-ignore
	run.unmount();
}
{
	const run = play({ doc: timeline(), startTime: 0.25 });
	check('startTime: it starts there', run.time() === 0.25, `t=${run.time()}`);
	const times = run.untilComplete();
	check('startTime: plays on from there', run.completes === 1 && rises(times, 0.25) && times.length <= 46, `${times.length} frames`); // prettier-ignore
	check('startTime: a cue before it never fires', !run.cues.includes('sfx:open'), run.cues.join());
	run.unmount();
}
{
	const run = play({ doc: timeline() });
	run.frames(15);
	run.set('startTime', 0.5);
	check('a new startTime mid-play: jumps there', run.time() === 0.5, `t=${run.time()}`);
	const times = run.untilComplete();
	check('a new startTime mid-play: plays on from there', run.completes === 1 && rises(times, 0.5) && times.length <= 31, `${times.length} frames`); // prettier-ignore
	run.unmount();
}
{
	// Mid back-leg: a re-arm that left the lap clock where it was would carry on coming back.
	const run = play({ doc: timeline({ loop: 'pingPong' }) });
	run.frames(90);
	run.set('doc', timeline({ id: 'outro', loop: 'pingPong' }));
	check('a new doc.id on a ping-pong: back to the start', run.time() === 0, `t=${run.time()}`);
	const [next] = run.frames(1);
	check('a new doc.id on a ping-pong: plays out again', near(next, DT), `t=${next}`);
	run.unmount();
}
{
	const run = play({ doc: timeline() });
	const before = run.frames(15).at(-1);
	run.set('speed', 2);
	check('a new speed: does not re-arm', run.time() === before, `t=${run.time()}`);
	const [next] = run.frames(1);
	check('a new speed: plays faster from where it was', near(next - before, 2 * DT), `step ${next - before}`); // prettier-ignore
	run.unmount();
}
{
	const run = play({ doc: timeline(), playing: false, startTime: 0.25 });
	run.frames(30);
	check('not playing: holds at startTime', run.time() === 0.25 && run.cues.length === 0, `t=${run.time()}`); // prettier-ignore
	run.set('playing', true);
	check('playing flips on: does not re-arm', run.time() === 0.25, `t=${run.time()}`);
	const times = run.untilComplete();
	check('playing flips on: plays from startTime', run.completes === 1 && rises(times, 0.25), `${times.length} frames`); // prettier-ignore
	run.unmount();
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
