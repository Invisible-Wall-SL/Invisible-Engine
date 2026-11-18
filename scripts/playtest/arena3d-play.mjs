// Shows the generated Crash arena (`docs/design/3d-games.md` Phase 3 step 6) in the `arcade3d` play
// field, in the headless shell (muted): the arcade sample with `arcade.world3d: { generator:
// 'crashArena' }` and no level of its own, booted once per seed with `?level_seed=`. Each seed's
// arena is drawn from a high camera (`<n>-seed-<seed>.png`) and, for the first seed, from the
// default camera behind the player (`near-seed-<seed>.png`).
//
// It checks, per seed: the player starts on the arena's first team spawn (`crashArena(seed)` in
// Node, the bytes the room makes); it stands grounded there; the view draws the arena's colliders
// (as many meshes' worth as the level has); no page error.
//
//   PUBLIC_IE_FAMILIES=arcade PUBLIC_IE_3D=1 PUBLIC_RGS_TRANSPORT=play4fun \
//     PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arena3d-play.mjs --runtime apps/lines/build --out <dir> [--seeds 5,7,11]
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
import { crashArena } from '../../packages/engine-mechanics/src/crashArena.js';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/arena3d-play') },
		seeds: { type: 'string', default: '5,7,11,23' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'arena-sample';
const seeds = opt.seeds.split(',').map(Number);

const sample = JSON.parse(
	readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
);
// RAW, as the server and the device read it: `game-config` would drop `arcade.world3d`.
const config = { ...sample, arcade: { ...sample.arcade, world3d: { generator: 'crashArena' } } };
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...ARCADE_SAMPLE_COMPONENTS].map((d) => [d.id, d]),
);

/** The arcade reference layout with its camera's 3D rig replaced. */
function layoutWith(rig3d) {
	const doc = arcadeReferenceLayout();
	const scene = doc.scenes.find((s) => s.camera);
	scene.camera = { ...scene.camera, rig3d };
	return doc;
}
const FAR = { pitch: 58, distance: 115, fov: 50, aimHeight: 0 };
const NEAR = { pitch: 24, distance: 9 };

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

const work = mkdtempSync(join(tmpdir(), 'arena3d-play-'));
const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'lines',
	name: 'Arena sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: '7' });
const snapshots = [];
async function snapshotFor(name, rig3d) {
	const dir = join(work, name);
	mkdirSync(join(dir, 'deploy'), { recursive: true });
	const doc = layoutWith(rig3d);
	const componentDefs = await resolveComponentClosure(
		doc.scenes.flatMap((scene) => scene.nodes),
		(id) => library[id],
	);
	writeFileSync(
		join(dir, 'runtime.json'),
		JSON.stringify({
			doc,
			componentDefs,
			componentDefaults: {},
			config,
			flowV2: ARCADE_DRIVEN_SEED_DOC,
		}),
	);
	const snap = await serveSnapshot({
		dir,
		name: 'Arena sample',
		snapshotId: name,
		assetBase: `${server.origin}/${KEY}/`,
	});
	snapshots.push(snap);
	return snap;
}
const far = await snapshotFor('far', FAR);
const near = await snapshotFor('near', NEAR);

const urlFor = (snap, seed) =>
	`${server.origin}/${KEY}/?${new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'arena3d-play',
		editorDocBase: snap.origin,
		rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
		sessionID: `arena3d-${seed}`,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		level_seed: String(seed),
	})}`;

let page;
try {
	page = await openPage(headlessShell(opt.chrome), join(work, 'profile'));
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 720,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	const view = async (snap, seed, label) => {
		await page.navigate(urlFor(snap, seed));
		for (let i = 0; i < 300; i++) {
			if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }]);
		await play([
			{ op: 'tapToStart' },
			{ op: 'waitFor', until: { playerIn: true } },
			{ op: 'step', frames: 60 },
		]);
		await page.evaluate(`window.__IE_DETERMINISM__.step(1, { draw: 'last' })`);
		writeFileSync(join(out, label), await page.screenshot());
		result.shots.push(label);
		return page.evaluate('window.__IE_DETERMINISM__.state()');
	};

	for (const [n, seed] of seeds.entries()) {
		const arena = crashArena(seed);
		const state = await view(far, seed, `${String(n + 1).padStart(2, '0')}-seed-${seed}.png`);
		const p = state.arcade?.bodies.find((b) => b.tags.includes('player'));
		const home = arena.spawns[0];
		verdict(
			`seed ${seed}: the player starts on the arena's first team spawn, grounded`,
			!!p &&
				Math.abs(p.x - home.x) < 0.01 &&
				Math.abs(p.z - home.z) < 0.01 &&
				Math.abs(p.y - home.y) < 0.01 &&
				p.grounded,
			{ player: p && { x: p.x, y: p.y, z: p.z, grounded: p.grounded }, home },
		);
		const meshes = await page.evaluate(`(() => {
			const w = window.__IE_WORLD3D__;
			if (!w || !w.scene) return null;
			let n = 0;
			w.scene.traverse((o) => { if (o.isMesh) n += 1; });
			return n;
		})()`);
		if (meshes !== null)
			verdict(`seed ${seed}: the view draws the level`, meshes >= arena.level.colliders.length, {
				meshes,
				colliders: arena.level.colliders.length,
			});
	}
	await view(near, seeds[0], `near-seed-${seeds[0]}.png`);
	const errors = await page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
} catch (error) {
	const errors = await page?.evaluate('window.__AR_ERRORS__').catch(() => undefined);
	verdict('the playtest ran', false, { error: String(error?.stack ?? error), errors });
	if (page)
		writeFileSync(join(out, 'failed.png'), await page.screenshot().catch(() => Buffer.alloc(0)));
} finally {
	await page?.close?.();
	await server.close?.();
	for (const s of snapshots) await s.close?.();
	rmSync(work, { recursive: true, force: true });
}

writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
const failed = result.verdicts.filter((v) => !v.ok);
for (const v of result.verdicts) console.log(`${v.ok ? 'PASS' : 'FAIL'} ${v.name}`);
if (failed.length) {
	for (const v of failed) console.log(JSON.stringify(v.detail));
	process.exit(1);
}
