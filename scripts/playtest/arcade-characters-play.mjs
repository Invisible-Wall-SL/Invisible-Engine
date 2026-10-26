// Plays the CHARACTERS arcade sample (game-families §4.3, P10.11) on the shared runtime, in the
// headless shell: the guarded yard (`arcadeGuardReferenceLayout()`: a spawn layer, a `guardRoute`
// path node), its config (`engine-mechanics/fixtures/arcade-guard.rules.json`: a played runner, a
// guard on a patrol / chase brain, solid walls), its flow (`ARCADE_GUARD_SEED_DOC`), the placeholder
// components and the guard's look timelines (a 1D blend on `speed`), baked into one snapshot.
//
// It reads the arcade probe (`state().arcade`: steps, bodies and each character's brain state) and
// the flow's variables (`__IE_FLOW_V2__.state`), and checks: the round starts with the yard built;
// the guard walks its route; the arrow keys steer the runner and a wall stops it; walking up to the
// guard gets it spotted (patrol → chase, SPOTTED counts) and caught (a life, the runner back at the
// start, the guard back on patrol); a held touch steers the runner; the same seeds and keys replay
// the same yard; free play sends the RGS nothing; no page error. Screenshots of the start, the
// patrol and the chase show the look. It builds its own snapshot, so the current-games harness is
// untouched.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arcade-characters-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	ARCADE_GUARD_COMPONENTS,
	ARCADE_GUARD_TIMELINES,
	arcadeGuardReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/arcadeGuard.ts';
import {
	ARCADE_GUARD_SEED_DOC,
	GUARD_PLACES,
} from '../../packages/engine-flow-v2/src/reference/arcadeGuardSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/arcade-characters-play') },
		seed: { type: 'string', default: '7' },
		'arcade-seed': { type: 'string', default: 'sample' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'arcade-guard';
const VIEW = { width: 1422, height: 800 };

const config = normalizeGameConfigDoc(
	JSON.parse(
		readFileSync(join(ROOT, 'packages/engine-mechanics/fixtures/arcade-guard.rules.json'), 'utf8'),
	),
);
const doc = arcadeGuardReferenceLayout();
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...ARCADE_GUARD_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
verdict(
	'the bake ships every sample component (spawned, placed nowhere)',
	ARCADE_GUARD_COMPONENTS.every((d) => d.id in componentDefs),
	Object.keys(componentDefs).filter((id) => id.startsWith('arcade')),
);

const work = mkdtempSync(join(tmpdir(), 'arcade-characters-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: ARCADE_GUARD_SEED_DOC,
		cinematics: ARCADE_GUARD_TIMELINES,
	}),
);

// Every request the page makes and every page error, recorded before the app's own code runs.
const HOOK = `(() => {
	const wire = (window.__AC_WIRE__ = []);
	const errors = (window.__AC_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
	const fetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		wire.push(typeof input === 'string' ? input : input.url ?? String(input));
		return fetch(input, init);
	};
	const open = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (method, url, ...rest) {
		wire.push(String(url));
		return open.call(this, method, url, ...rest);
	};
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'lines',
	name: 'Arcade guard',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Arcade guard',
	snapshotId: 'guard',
	assetBase: `${server.origin}/${KEY}/`,
});
const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'arcade-characters-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `arcade-guard-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
	arseed: opt['arcade-seed'],
	flowlog: '1',
});

const KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

/** Open the game on a fresh page and play into a round. */
async function boot(profile) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Emulation.setDeviceMetricsOverride', {
		...VIEW,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const state = () => api('state()');
	const variable = (id) =>
		page.evaluate(`window.__IE_FLOW_V2__?.state?.read(${JSON.stringify(id)})`);
	const key = (name, type) =>
		page.page('Input.dispatchKeyEvent', {
			type: type === 'down' ? 'rawKeyDown' : 'keyUp',
			key: name,
			code: name,
			windowsVirtualKeyCode: KEYS[name],
		});
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	const frames = (n) => play([{ op: 'step', frames: n }]);
	await play([
		{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 },
		{ op: 'tapToStart' },
		{ op: 'waitFor', until: { playerIn: true } },
	]);
	return { page, api, state, variable, key, frames };
}

const runnerOf = (s) => s.arcade?.bodies.find((b) => b.tags.includes('player'));
const guardOf = (s) => s.arcade?.bodies.find((b) => b.tags.includes('guard'));
const walls = (s) => s.arcade?.bodies.filter((b) => b.tags.includes('wall')) ?? [];

/** Hold the arrows that point the runner at the guard for `frames` frames, re-aimed every 6. */
async function walkTowardsGuard(game, frames, stop) {
	const held = new Set();
	const aim = async (want) => {
		for (const k of held) if (!want.has(k)) await game.key(k, 'up');
		for (const k of want) if (!held.has(k)) await game.key(k, 'down');
		held.clear();
		for (const k of want) held.add(k);
	};
	for (let f = 0; f < frames; f += 6) {
		const s = await game.state();
		if (stop(s)) break;
		const r = runnerOf(s);
		const g = guardOf(s);
		const want = new Set();
		if (g.x > r.x + 8) want.add('ArrowRight');
		if (g.x < r.x - 8) want.add('ArrowLeft');
		if (g.y > r.y + 8) want.add('ArrowDown');
		if (g.y < r.y - 8) want.add('ArrowUp');
		await aim(want);
		await game.frames(6);
	}
	await aim(new Set());
}

try {
	const game = await boot('profile');
	let shots = 0;
	const shot = async (label) => {
		await game.api(`step(1, { draw: 'last' })`);
		const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
		writeFileSync(join(out, file), await game.page.screenshot());
		result.shots.push(file);
	};

	await game.frames(10);
	const start = await game.state();
	const r0 = runnerOf(start);
	const g0 = guardOf(start);
	verdict(
		'the round starts with the yard built: three walls, the runner at its start, the guard patrolling',
		walls(start).length === 3 &&
			!!r0 &&
			r0.x === GUARD_PLACES.runner.x &&
			r0.y === GUARD_PLACES.runner.y &&
			g0?.state === 'patrol',
		start.arcade?.bodies,
	);
	verdict(
		'…three lives, nothing spotted',
		(await game.variable('lives')) === 3 && (await game.variable('spotted')) === 0,
	);
	await shot('start');

	await game.frames(120);
	const patrol = await game.state();
	const g1 = guardOf(patrol);
	verdict(
		'the guard walks its route',
		!!g1 && g1.state === 'patrol' && Math.hypot(g1.x - g0.x, g1.y - g0.y) > 100,
		{ from: g0, to: g1 },
	);
	await shot('patrol');

	await game.key('ArrowRight', 'down');
	await game.frames(30);
	await game.key('ArrowRight', 'up');
	await game.frames(2);
	const r1 = runnerOf(await game.state());
	verdict(
		'ArrowRight runs the runner right at 280 px/s, and letting go stops it',
		Math.abs(r1.x - (r0.x + 140)) < 1e-6 && r1.vx === 0,
		r1,
	);
	await game.key('ArrowUp', 'down');
	await game.frames(75);
	await game.key('ArrowUp', 'up');
	await game.frames(2);
	const r2 = runnerOf(await game.state());
	verdict('the wall above stops it', r2.y === 440 && r2.x === r1.x, r2);

	await game.key('ArrowDown', 'down');
	await game.frames(10);
	await game.key('ArrowDown', 'up');
	await walkTowardsGuard(game, 600, (s) => guardOf(s)?.state === 'chase');
	const chase = await game.state();
	verdict(
		'walking up to the guard gets the runner spotted: patrol → chase, SPOTTED 1',
		guardOf(chase)?.state === 'chase' && (await game.variable('spotted')) >= 1,
		{ guard: guardOf(chase), runner: runnerOf(chase) },
	);
	// The alert flag blends in over 120 ms of the look's own clock.
	await game.frames(12);
	await shot('chase');

	let caught = false;
	for (let i = 0; i < 40 && !caught; i++) {
		await game.frames(6);
		caught = (await game.variable('lives')) === 2;
	}
	await game.frames(2);
	const after = await game.state();
	verdict(
		'the guard catches the runner: a life, the runner back at the start, the guard on patrol',
		caught &&
			runnerOf(after).x === GUARD_PLACES.runner.x &&
			runnerOf(after).y === GUARD_PLACES.runner.y &&
			guardOf(after).state === 'patrol',
		{ runner: runnerOf(after), guard: guardOf(after) },
	);

	// A held touch: press to the right of the runner on the page; it heads there.
	const t0 = runnerOf(await game.state());
	await game.page.mouse('mouseMoved', 700, 700);
	await game.page.mouse('mousePressed', 700, 700);
	await game.frames(20);
	await game.page.mouse('mouseReleased', 700, 700);
	await game.frames(2);
	const t1 = runnerOf(await game.state());
	verdict('a held touch steers the runner towards it', t1.x > t0.x + 40 && t1.vx === 0, {
		from: t0,
		to: t1,
	});

	const wire = await game.page.evaluate('window.__AC_WIRE__');
	const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
	verdict('free play sends the RGS nothing', rgs.length === 0, rgs);
	const errors = await game.page.evaluate('window.__AC_ERRORS__');
	const end = await game.state();
	verdict('no page error', errors.length === 0 && end.errors === 0, errors);
	await game.page.close();

	const runScript = async (profile) => {
		const g = await boot(profile);
		await g.frames(30);
		await g.key('ArrowRight', 'down');
		await g.key('ArrowUp', 'down');
		await g.frames(60);
		await g.key('ArrowUp', 'up');
		await g.frames(40);
		await g.key('ArrowRight', 'up');
		await g.frames(120);
		const s = (await g.state()).arcade;
		await g.page.close();
		return s;
	};
	const a = await runScript('replay-a');
	const b = await runScript('replay-b');
	verdict('the same seeds and keys replay the same yard', JSON.stringify(a) === JSON.stringify(b), {
		a: a?.bodies?.slice(3),
		b: b?.bodies?.slice(3),
	});
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(
	failed ? `\narcade characters play: ${failed} FAILED` : `\narcade characters play: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
