// Plays the arcade sample (game-families §9 #6, P10.8) on the shared runtime, in the headless shell:
// Game Maker's arcade scene set, its seed config (`arcade.rules.json`), its starter flow and the
// placeholder components a new arcade project is given, baked into one snapshot. A salmon swims
// along the bottom of the field; bears and hooks fall towards it and fish drift down.
//
// It reads the arcade probe (`state().arcade`: the loop's steps and bodies) and the flow's trace
// (`?flowlog=1`) and checks what the game did: the round started with one salmon; the spawners drop
// bodies that fall; ArrowLeft / ArrowRight steer the salmon and the field's edge holds it; what
// touches the salmon is despawned and what falls off the bottom is too; three hazards end the round
// on the round-over screen, where nothing spawns; its tap clears the field and starts again; the
// same seeds and keys replay to the same bodies on a second page; a portrait screen starts the
// salmon at the portrait field's bottom centre; free play sends the RGS nothing;
// no page error. It builds its own snapshot, so the current-games harness is not touched.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arcade-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	ARCADE_SAMPLE_COMPONENTS,
	arcadeReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { ARCADE_DRIVEN_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/arcadeSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/arcade-play') },
		seed: { type: 'string', default: '7' },
		'arcade-seed': { type: 'string', default: 'sample' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'arcade-sample';
const FIELD = { w: 1422, h: 800 };
const SALMON_HALF_WIDTH = 45;

const config = normalizeGameConfigDoc(
	JSON.parse(
		readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
	),
);
const doc = arcadeReferenceLayout();
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...ARCADE_SAMPLE_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
verdict(
	'the bake ships every sample component (placed nowhere; listed by the field)',
	ARCADE_SAMPLE_COMPONENTS.every((d) => d.id in componentDefs),
	Object.keys(componentDefs).filter((id) => id.startsWith('arcade')),
);

const work = mkdtempSync(join(tmpdir(), 'arcade-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: ARCADE_DRIVEN_SEED_DOC,
	}),
);

// Every request the page makes and every page error, recorded before the app's own code runs.
const HOOK = `(() => {
	const wire = (window.__AR_WIRE__ = []);
	const errors = (window.__AR_ERRORS__ = []);
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
	name: 'Arcade sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Arcade sample',
	snapshotId: 'sample',
	assetBase: `${server.origin}/${KEY}/`,
});
const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'arcade-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `arcade-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
	arseed: opt['arcade-seed'],
	flowlog: '1',
});

const KEYS = { ArrowLeft: 37, ArrowRight: 39 };

/** Open the game on a fresh page and play into a round. */
async function boot(profile, metrics) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	if (metrics)
		await page.page('Emulation.setDeviceMetricsOverride', {
			...metrics,
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
	const key = (name, type) =>
		page.page('Input.dispatchKeyEvent', {
			type: type === 'down' ? 'rawKeyDown' : 'keyUp',
			key: name,
			code: name,
			windowsVirtualKeyCode: KEYS[name],
		});
	const play = (steps, capture) =>
		playScenario({ steps }, { page, draw: 'last', ...(capture ? { capture } : {}) });
	await play([
		{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 },
		{ op: 'tapToStart' },
		{ op: 'waitFor', until: { playerIn: true } },
	]);
	return { page, api, state, key, play };
}

const salmonOf = (s) => s.arcade?.bodies.find((b) => b.tags.includes('player'));

try {
	const game = await boot('profile');
	let shots = 0;
	const shot = async (label) => {
		await game.api(`step(1, { draw: 'last' })`);
		const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
		writeFileSync(join(out, file), await game.page.screenshot());
		result.shots.push(file);
	};

	// The round starts on its timer, a few frames after the tap.
	await game.play([{ op: 'step', frames: 10 }]);
	const start = await game.state();
	const salmon0 = salmonOf(start);
	verdict(
		'the round starts with the field, the HUD and one salmon at its start',
		!!start.arcade &&
			start.screens.includes('arcadeHud') &&
			start.arcade.bodies.filter((b) => b.tags.includes('player')).length === 1 &&
			salmon0?.x === FIELD.w / 2,
		{ screens: start.screens, arcade: start.arcade },
	);
	await shot('start');

	await game.play([{ op: 'step', frames: 150 }]);
	const falling = (await game.state()).arcade.bodies.filter((b) => !b.tags.includes('player'));
	verdict(
		'the spawners drop bears, hooks and fish that fall',
		falling.length > 0 && falling.every((b) => b.vy > 0),
		falling,
	);
	await shot('falling');

	const x0 = salmonOf(await game.state()).x;
	await game.key('ArrowLeft', 'down');
	await game.play([{ op: 'step', frames: 30 }]);
	const x1 = salmonOf(await game.state()).x;
	await game.key('ArrowLeft', 'up');
	await game.play([{ op: 'step', frames: 5 }]);
	verdict('ArrowLeft steers the salmon left while held', x1 < x0 - 150, { x0, x1 });
	verdict('…and letting go stops it', salmonOf(await game.state()).vx === 0);
	await game.key('ArrowRight', 'down');
	await game.play([{ op: 'step', frames: 240 }]);
	const right = salmonOf(await game.state());
	verdict(
		'ArrowRight runs it to the field’s edge, and the edge holds it',
		right.x === FIELD.w - SALMON_HALF_WIDTH,
		right,
	);
	await shot('at-edge');
	await game.key('ArrowRight', 'up');

	// Stand still and let the river come: three hazards end the round.
	await game.play([
		{ op: 'until', until: { screen: 'roundOver', inSet: true }, maxFrames: 60 * 90 },
		{ op: 'step', frames: 10 },
	]);
	const over = await game.state();
	verdict(
		'three hazards end the round on the round-over screen',
		over.screens.includes('roundOver'),
	);
	await shot('round-over');
	const trace = (await game.page.evaluate('window.__IE_FLOW_V2_TRACE__ ?? []')) ?? [];
	const despawns = trace.filter((l) => /^despawn field#\d+$/.test(l)).length;
	verdict('what touched the salmon or fell off was despawned', despawns >= 3, despawns);
	const held = over.arcade.bodies.length;
	await game.play([{ op: 'step', frames: 120 }]);
	verdict(
		'nothing spawns while the round-over screen holds',
		(await game.state()).arcade.bodies.filter((b) => !b.tags.includes('player')).length <= held - 1,
	);
	await game.play([{ op: 'space' }, { op: 'step', frames: 5 }]);
	const again = await game.state();
	verdict(
		'its tap clears the field and starts a new round with one salmon',
		!again.screens.includes('roundOver') &&
			again.arcade.bodies.filter((b) => b.tags.includes('player')).length === 1 &&
			salmonOf(again).x === FIELD.w / 2,
		again.arcade,
	);
	await shot('again');

	const wire = await game.page.evaluate('window.__AR_WIRE__');
	const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
	verdict('free play sends the RGS nothing', rgs.length === 0, rgs);
	const errors = await game.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0 && again.errors === 0, errors);
	await game.page.close();

	// The same seeds and keys on a second page reach the same bodies.
	const runScript = async (profile) => {
		const g = await boot(profile);
		await g.play([{ op: 'step', frames: 60 }]);
		await g.key('ArrowLeft', 'down');
		await g.play([{ op: 'step', frames: 45 }]);
		await g.key('ArrowLeft', 'up');
		await g.play([{ op: 'step', frames: 120 }]);
		const s = (await g.state()).arcade;
		await g.page.close();
		return s;
	};
	// A portrait screen: the field is the portrait layout's design size, so the salmon starts at its
	// bottom centre.
	const tall = await boot('portrait', { width: 720, height: 1280 });
	await tall.play([{ op: 'step', frames: 10 }]);
	const tallStart = salmonOf(await tall.state());
	verdict(
		'on a portrait screen the field is the portrait layout’s: the salmon starts at its bottom centre',
		tallStart?.x === 400 && tallStart?.y === 1422 - 80,
		tallStart,
	);
	await tall.page.close();

	const a = await runScript('replay-a');
	const b = await runScript('replay-b');
	verdict(
		'the same seeds and keys replay to the same bodies',
		JSON.stringify(a) === JSON.stringify(b),
		{
			a: a.steps,
			b: b.steps,
		},
	);
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\narcade play: ${failed} FAILED` : `\narcade play: OK → ${out}`);
process.exit(failed ? 1 : 0);
