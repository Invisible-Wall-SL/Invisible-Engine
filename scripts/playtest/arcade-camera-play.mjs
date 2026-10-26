// Plays the SCROLLING arcade sample (game-families §4.4, P10.12) on the shared runtime, in the
// headless shell: the river scene set (`arcadeRiverReferenceLayout()`: a world four screens tall, a
// camera following the salmon, a parallax backdrop, a spawn layer that despawns outside the view),
// its config (`engine-mechanics/fixtures/arcade-river.rules.json`), its flow
// (`ARCADE_RIVER_SEED_DOC`) and the P10.8 placeholder components, baked into one snapshot.
//
// It reads the arcade probe (`state().arcade`: steps, bodies and the camera) and checks: the round
// starts with the camera on the salmon at the river's mouth; ArrowUp swims it up and the camera
// follows with the salmon on screen; what the camera leaves behind is despawned; on a portrait
// screen the camera also follows across; the same seeds and keys replay the same framing; free play
// sends the RGS nothing; no page error. Screenshots of the start and of mid-river show the world
// drawn through the camera. It builds its own snapshot, so the current-games harness is untouched.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arcade-camera-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import { ARCADE_SAMPLE_COMPONENTS } from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import {
	ARCADE_RIVER_DESPAWN_MARGIN,
	ARCADE_RIVER_WORLD,
	arcadeRiverReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/arcadeRiver.ts';
import { ARCADE_RIVER_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/arcadeRiverSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/arcade-camera-play') },
		seed: { type: 'string', default: '7' },
		'arcade-seed': { type: 'string', default: 'sample' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'arcade-river';
const VIEW = { w: 1422, h: 800 };

const config = normalizeGameConfigDoc(
	JSON.parse(
		readFileSync(join(ROOT, 'packages/engine-mechanics/fixtures/arcade-river.rules.json'), 'utf8'),
	),
);
const doc = arcadeRiverReferenceLayout();
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
		flowV2: ARCADE_RIVER_SEED_DOC,
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
	name: 'Arcade river',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Arcade river',
	snapshotId: 'river',
	assetBase: `${server.origin}/${KEY}/`,
});
const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'arcade-camera-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `arcade-river-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
	arseed: opt['arcade-seed'],
	flowlog: '1',
});

const KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

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
const onScreen = (s) => {
	const p = salmonOf(s);
	const c = s.arcade?.camera;
	return !!p && !!c && p.x > c.x && p.x < c.x + c.view.w && p.y > c.y && p.y < c.y + c.view.h;
};

try {
	const game = await boot('profile');
	let shots = 0;
	const shot = async (label) => {
		await game.api(`step(1, { draw: 'last' })`);
		const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
		writeFileSync(join(out, file), await game.page.screenshot());
		result.shots.push(file);
	};

	await game.play([{ op: 'step', frames: 10 }]);
	const start = await game.state();
	const s0 = salmonOf(start);
	const c0 = start.arcade?.camera;
	verdict(
		"the round starts with the salmon at the river's mouth",
		!!s0 && s0.x === ARCADE_RIVER_WORLD.w / 2 && s0.y > ARCADE_RIVER_WORLD.h - 200,
		{ salmon: s0 },
	);
	verdict(
		'…and the camera on it, held at the bottom of the world',
		!!c0 && c0.x === 0 && c0.y === ARCADE_RIVER_WORLD.h - VIEW.h && onScreen(start),
		c0,
	);
	await shot('mouth');

	await game.key('ArrowUp', 'down');
	const path = [];
	for (let i = 0; i < 8; i++) {
		await game.play([{ op: 'step', frames: 30 }]);
		const s = await game.state();
		path.push({ salmon: salmonOf(s)?.y, camera: s.arcade?.camera?.y, on: onScreen(s) });
	}
	await shot('mid-river');
	await game.key('ArrowUp', 'up');
	const mid = await game.state();
	verdict(
		'ArrowUp swims up the river and the camera scrolls with it',
		(mid.arcade?.camera?.y ?? Infinity) < ARCADE_RIVER_WORLD.h - VIEW.h - 600,
		path,
	);
	verdict(
		'…with the salmon on screen the whole way',
		path.every((p) => p.on),
		path,
	);
	await game.play([{ op: 'step', frames: 240 }]);
	const later = await game.state();
	const cam = later.arcade.camera;
	const stray = later.arcade.bodies.filter(
		(b) =>
			!b.tags.includes('player') && b.y > cam.y + cam.view.h + ARCADE_RIVER_DESPAWN_MARGIN + 80,
	);
	verdict(
		'what the camera left behind was despawned',
		stray.length === 0 && later.arcade.bodies.length < 48,
		{ stray, bodies: later.arcade.bodies.length },
	);
	verdict(
		'spawns are on the river near the view',
		later.arcade.bodies.some((b) => !b.tags.includes('player')),
		later.arcade.bodies.length,
	);
	await shot('later');

	const wire = await game.page.evaluate('window.__AR_WIRE__');
	const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
	verdict('free play sends the RGS nothing', rgs.length === 0, rgs);
	const errors = await game.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0 && later.errors === 0, errors);
	await game.page.close();

	const tall = await boot('portrait', { width: 720, height: 1280 });
	await tall.play([{ op: 'step', frames: 10 }]);
	const t0 = await tall.state();
	verdict(
		'on a portrait screen the view is the portrait design size and follows across the river',
		t0.arcade?.camera?.view.w === 800 &&
			t0.arcade.camera.x === ARCADE_RIVER_WORLD.w / 2 - 400 &&
			onScreen(t0),
		t0.arcade?.camera,
	);
	await tall.key('ArrowLeft', 'down');
	await tall.play([{ op: 'step', frames: 60 }]);
	await tall.key('ArrowLeft', 'up');
	const t1 = await tall.state();
	verdict(
		'…steering left pans it left',
		(t1.arcade?.camera?.x ?? Infinity) < t0.arcade.camera.x && onScreen(t1),
		t1.arcade?.camera,
	);
	await tall.page.close();

	const runScript = async (profile) => {
		const g = await boot(profile);
		await g.play([{ op: 'step', frames: 30 }]);
		await g.key('ArrowUp', 'down');
		await g.play([{ op: 'step', frames: 90 }]);
		await g.key('ArrowUp', 'up');
		await g.play([{ op: 'step', frames: 60 }]);
		const s = (await g.state()).arcade;
		await g.page.close();
		return s;
	};
	const a = await runScript('replay-a');
	const b = await runScript('replay-b');
	verdict(
		'the same seeds and keys replay the same framing and bodies',
		JSON.stringify(a) === JSON.stringify(b),
		{
			a: a.camera,
			b: b.camera,
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
console.log(
	failed ? `\narcade camera play: ${failed} FAILED` : `\narcade camera play: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
