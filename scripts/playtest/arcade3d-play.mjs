// Plays the 3D play field (`docs/design/3d-games.md` Phase 1) on an `arcade3d` runtime build, in the
// headless shell: the arcade sample's snapshot (as `arcade-play.mjs` bakes it), whose play field the
// 3D seam draws as `motion3d`'s placeholder arena with one player capsule.
//
// It checks: the Pixi context was created WITH alpha on the solid black page (the world canvas
// reserved before init made auto-opaque answer "transparent"); the coded background is not drawn
// over the world; three.js is fetched only once the play field mounts; W walks the player away from
// the camera and Space jumps it; a hidden tab steps nothing and the world resumes where it stopped;
// the 3D canvas renders below the HUD's pixel ratio; no page error. A click on empty HUD aims in the
// world: `04-aimed.png` shows the marker (read it). Screenshots go to --out.
//
//   PUBLIC_IE_FAMILIES=arcade PUBLIC_IE_3D=1 PUBLIC_RGS_TRANSPORT=play4fun \
//     PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arcade3d-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//   … --serve prints the game's URL and keeps serving it, to play by hand.
//   … --online --serve: the same game as an online 3D game (an `arcade.online` block and the
//     placeholder arena as its `arcade.world3d`), joined to a game server run in this process; open
//     the URL in two windows to see each other.
//   … --models <dir>: the game ships the models in <dir>/models/ (a `deploy/models/` tree with its
//     index.json, as `apps/launcher-api/scripts/export-models-local.ts` writes it), and every body
//     looks like its first `hero` model with the `anim` models as clip libraries, its first
//     `weapon` on SK_hand_r and the test character's animation doc. Adds the character verdicts
//     (loaded, clips, socket, LOD, transcoder) and plays it: idle, walk, run (Shift), strafe (aim
//     ahead, D), jump, an attack while running (F: the upper body only) and a flinch (additive);
//     `05-…` to `10-…` are the shots.
//
// Exit 1 when a verdict fails.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { sampleArena3d } from '../../packages/engine-3d/pure.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/arcade3d-play') },
		seed: { type: 'string', default: '7' },
		chrome: { type: 'string' },
		serve: { type: 'boolean', default: false },
		online: { type: 'boolean', default: false },
		models: { type: 'string' },
	},
});
const modelIndex = opt.models
	? JSON.parse(readFileSync(join(resolve(opt.models), 'models', 'index.json'), 'utf8'))
	: undefined;
/** The test character's animation doc (`packages/engine-3d/fixtures/`), as `arcade.world3d.anim`. */
const ANIM_DOC = JSON.parse(
	readFileSync(join(ROOT, 'packages/engine-3d/fixtures/ie-humanoid.anim.json'), 'utf8'),
);
/** `arcade.world3d.looks` for the shipped models: the hero, its clip libraries and its weapon. */
const looks = () => {
	const of = (cls) => modelIndex.models.filter((m) => m.class === cls).map((m) => m.id);
	const [hero] = of('hero');
	const [weapon] = of('weapon');
	return {
		default: {
			modelId: hero,
			modelIds: of('anim'),
			attach: weapon ? [{ socket: 'hand_r', modelId: weapon }] : [],
			anim: ANIM_DOC.id,
		},
	};
};
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'arcade-sample';

const sampleConfig = JSON.parse(
	readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
);
/** The placeholder arena as an `arcade.world3d` block: the level and two spawns. */
const arenaWorld3d = () => {
	const arena = sampleArena3d();
	return {
		level: {
			colliders: arena.colliders,
			zones: arena.zones,
			cellSize: arena.cellSize,
			killY: arena.killY,
		},
		spawns: [arena.spawn, { ...arena.spawn, x: arena.spawn.x + 2 }],
	};
};
/** `--online`: the sample as a 3D online game: one character, the placeholder arena as its level. */
const onlineConfig = () => {
	return {
		...sampleConfig,
		arcade: {
			...sampleConfig.arcade,
			// The room's field in metres: the arena's 32 m floor.
			field: { w: 32, h: 32 },
			online: { characters: [{ id: 'hero', body: 'arcadeSalmon', speed: 5 }] },
			world3d: arenaWorld3d(),
		},
	};
};
const withLooks = (cfg) =>
	modelIndex
		? {
				...cfg,
				arcade: {
					...cfg.arcade,
					world3d: {
						...(cfg.arcade?.world3d ?? arenaWorld3d()),
						looks: looks(),
						anim: { [ANIM_DOC.id]: ANIM_DOC },
					},
				},
			}
		: cfg;
const rawConfig = withLooks(opt.online ? onlineConfig() : sampleConfig);
// Offline the bundle carries the normalised config plus the raw `world3d` block the 3D seam reads.
const config = opt.online ? rawConfig : withLooks(normalizeGameConfigDoc(sampleConfig));
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

const work = mkdtempSync(join(tmpdir(), 'arcade3d-play-'));
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
		...(modelIndex ? { models: modelIndex } : {}),
	}),
);

// Page errors and every script the page fetches, recorded before the app's own code runs.
const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

// The models are served beside the runtime, where the runtime bundle's asset base resolves them.
let runtimeDir = resolve(opt.runtime);
if (opt.models) {
	runtimeDir = join(work, 'runtime');
	cpSync(resolve(opt.runtime), runtimeDir, { recursive: true });
	cpSync(join(resolve(opt.models), 'models'), join(runtimeDir, 'models'), { recursive: true });
}
const tree = testServerTree(join(work, 'tree'), runtimeDir, KEY, {
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
	k: 'arcade3d-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `arcade3d-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
});

const KEYS = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyF: 70, ShiftLeft: 16, Space: 32 };
const player = (s) => s.arcade?.bodies.find((b) => b.tags.includes('player'));
/** The JS files the page has loaded, by name. */
const SCRIPTS = `performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.js'))`;
/** Whether the chunk holding three.js's toon material has been fetched. */
const THREE_LOADED = `(async () => {
	for (const url of ${SCRIPTS}) {
		const text = await fetch(url).then((r) => r.text()).catch(() => '');
		if (text.includes('isMeshToonMaterial')) return url;
	}
	return null;
})()`;

let rooms;
if (opt.online) {
	// The game server reads the RAW config (`game-config` drops `arcade.world3d`).
	const dir = join(work, 'rooms');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${KEY}.json`), JSON.stringify(rawConfig));
	rooms = createGameServer({
		loadGame: createConfigSource({ dir }),
		maxRooms: 4,
		commit: 'arcade3dplay',
		gracefullyShutdown: false,
	});
	const port = 25670 + Math.floor(Math.random() * 1000);
	await rooms.listen(port);
	params.set('rooms_url', `ws://127.0.0.1:${port}`);
	params.set('rooms_game', KEY);
}

if (opt.serve) {
	// Play it by hand (or in another browser): the same snapshot and runtime, without the clock pin.
	params.delete('ie_determinism');
	console.log(`${server.origin}/${KEY}/?${params}`);
	await new Promise(() => {});
}

let page;
try {
	page = await openPage(headlessShell(opt.chrome), join(work, 'profile'));
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 720,
		deviceScaleFactor: 2,
		mobile: false,
	});
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const state = () => page.evaluate('window.__IE_DETERMINISM__.state()');
	const key = (code, type) =>
		page.page('Input.dispatchKeyEvent', {
			type: type === 'down' ? 'rawKeyDown' : 'keyUp',
			key: code === 'Space' ? ' ' : code === 'ShiftLeft' ? 'Shift' : code.slice(3).toLowerCase(),
			code,
			windowsVirtualKeyCode: KEYS[code],
		});
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	let shots = 0;
	const shot = async (label) => {
		await page.evaluate(`window.__IE_DETERMINISM__.step(1, { draw: 'last' })`);
		const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
		writeFileSync(join(out, file), await page.screenshot());
		result.shots.push(file);
	};

	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }]);
	const before = await page.evaluate(THREE_LOADED);
	verdict('three.js is not fetched before the play field mounts', before === null, before);
	const contexts = await page.evaluate(`(() => {
		const canvases = [...document.querySelectorAll('canvas')];
		const world = canvases.find((c) => 'ieWorld3d' in c.dataset);
		const pixi = canvases.find((c) => !('ieWorld3d' in c.dataset));
		const gl = pixi && (pixi.getContext('webgl2') || pixi.getContext('webgl'));
		return {
			world: !!world,
			worldUnder: !!world && getComputedStyle(world).zIndex === '-1',
			pixiAlpha: gl ? gl.getContextAttributes().alpha : null,
		};
	})()`);
	verdict(
		'the world canvas is on the page before the Pixi context',
		contexts.world && contexts.worldUnder,
		contexts,
	);
	verdict(
		'auto-opaque keeps the Pixi context transparent over the world',
		contexts.pixiAlpha === true,
		contexts,
	);

	await play([
		{ op: 'tapToStart' },
		{ op: 'waitFor', until: { playerIn: true } },
		{ op: 'step', frames: 90 },
	]);
	const loaded = await page.evaluate(THREE_LOADED);
	verdict('three.js is fetched once the play field mounts', typeof loaded === 'string', loaded);
	const start = await state();
	const p0 = player(start);
	verdict(
		'the 3D field runs with one grounded player',
		!!p0 && p0.grounded === true && start.arcade.steps > 0,
		start.arcade,
	);
	const bg = await page.evaluate(`(() => {
		const app = window.__PIXI_APP__;
		const find = (node, depth) => {
			if (!node || depth > 5) return null;
			for (const child of node.children ?? []) {
				if (child.zIndex === -900) return child;
				const hit = find(child, depth + 1);
				if (hit) return hit;
			}
			return null;
		};
		const band = app && find(app.stage, 0);
		return band ? { renderable: band.renderable } : { absent: true };
	})()`);
	verdict(
		'the coded background is not drawn over the world',
		bg.absent === true || bg.renderable === false,
		bg,
	);
	if (modelIndex) {
		let cast = [];
		for (let i = 0; i < 100 && !cast.length; i++) {
			await play([{ op: 'step', frames: 6 }]);
			cast = await page.evaluate('window.__IE_WORLD3D__?.characters() ?? []');
			if (!cast.length) await new Promise((r) => setTimeout(r, 100));
		}
		const wanted = modelIndex.models.filter((m) => m.class === 'anim').flatMap((m) => m.clips);
		const [hero] = cast;
		verdict(
			'the player is drawn as the hero model, with every clip of its libraries and its sockets',
			!!hero && wanted.every((c) => hero.clips.includes(c)) && hero.sockets.includes('hand_r'),
			{ cast, wanted },
		);
		const fetched = await page.evaluate(
			`performance.getEntriesByType('resource').map((e) => e.name.split('?')[0].split('/').pop())`,
		);
		verdict(
			'the GLBs, their KTX2 texture and the Basis transcoder (js + wasm) were fetched',
			fetched.some((n) => n.endsWith('.glb')) &&
				fetched.some((n) => n.endsWith('.ktx2')) &&
				fetched.some((n) => /basis_transcoder.*\.wasm$/.test(n)) &&
				fetched.some((n) => /basis_transcoder.*\.js$/.test(n)),
			fetched.filter((n) => /glb|ktx2|basis/.test(n)),
		);
		verdict('the near hero draws its richest shipped LOD', hero?.lods?.[0] === 0, hero?.lods);
	}
	await shot('start');

	await key('KeyW', 'down');
	await play([{ op: 'step', frames: 45 }]);
	await key('KeyW', 'up');
	await play([{ op: 'step', frames: 20 }]);
	const p1 = player(await state());
	verdict('W walks the player away from the camera (−z)', p1.z < p0.z - 2, { from: p0, to: p1 });
	await shot('walked');

	await key('Space', 'down');
	await play([{ op: 'step', frames: 4 }]);
	await key('Space', 'up');
	let peak = 0;
	for (let i = 0; i < 12; i++) {
		await play([{ op: 'step', frames: 3 }]);
		peak = Math.max(peak, player(await state()).y);
		if (i === 4) await shot('jump');
	}
	await play([{ op: 'step', frames: 60 }]);
	const landed = player(await state());
	verdict(
		'Space jumps (peak about 1.5 m) and lands',
		peak > 1.2 && landed.grounded && landed.y < 0.01,
		{ peak, landed },
	);

	if (modelIndex) {
		const hero = async () =>
			(await page.evaluate('window.__IE_WORLD3D__.characters()')).find((c) => c.id === 'player');
		/** A clip's weight on the body, summed over its regions' shares as the probe reports them. */
		const clipWeight = (c, clip) =>
			Object.entries(c?.weights ?? {})
				.filter(([k]) => k.startsWith(`${clip}@`))
				.reduce((s, [, w]) => s + w, 0);
		const lead = (c) => {
			const by = {};
			for (const [k, w] of Object.entries(c?.weights ?? {})) {
				const clip = k.split('@')[0];
				by[clip] = Math.max(by[clip] ?? 0, w);
			}
			return Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0];
		};
		await play([{ op: 'step', frames: 30 }]);
		let c = await hero();
		verdict(
			'standing, the hero idles',
			c?.states?.base === 'move' && lead(c) === 'locomotion.idle',
			c,
		);
		await shot('idle');

		// Back to a clear row (z ≈ 12, south of the ramp), then along +x (D), open for 19 m: walk,
		// run, attack while running.
		await key('KeyS', 'down');
		await play([{ op: 'step', frames: 45 }]);
		await key('KeyS', 'up');
		await play([{ op: 'step', frames: 30 }]);
		await key('KeyD', 'down');
		await play([{ op: 'step', frames: 30 }]);
		c = await hero();
		verdict(
			'D walks (facing the way it moves): the walk leads the 2D blend',
			lead(c) === 'locomotion.walk_fwd' && clipWeight(c, 'locomotion.walk_fwd') > 0.3,
			{ weights: c?.weights, player: player(await state()) },
		);
		await shot('walk');
		await key('ShiftLeft', 'down');
		await play([{ op: 'step', frames: 30 }]);
		c = await hero();
		verdict('Shift runs: the run leads', lead(c) === 'locomotion.run_fwd', c?.weights);
		await key('KeyF', 'down');
		await play([{ op: 'step', frames: 10 }]);
		await key('KeyF', 'up');
		c = await hero();
		const upperRun = Object.entries(c?.weights ?? {}).some(
			([k, w]) => k.startsWith('locomotion.run_fwd@') && w > 0.5,
		);
		verdict(
			'F while running: the upper body attacks, the legs keep running',
			c?.states?.upper === 'attack' && clipWeight(c, 'combat.attack') > 0.5 && upperRun,
			c,
		);
		await shot('attack-running');
		await play([{ op: 'step', frames: 20 }]);
		await key('ShiftLeft', 'up');
		await key('KeyD', 'up');
		await play([{ op: 'step', frames: 40 }]);

		// Aim ahead of the hero (the top middle of the screen), then step left: a strafe.
		for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
			await page.page('Input.dispatchMouseEvent', {
				type,
				x: 640,
				y: 120,
				button: 'left',
				clickCount: 1,
			});
		await key('KeyA', 'down');
		await play([{ op: 'step', frames: 30 }]);
		c = await hero();
		verdict('aiming ahead, A strafes left', lead(c) === 'locomotion.strafe_l', c?.weights);
		await shot('strafe');
		await key('KeyA', 'up');
		await play([{ op: 'step', frames: 40 }]);

		await page.evaluate(`window.__IE_WORLD3D__.trigger('player', 'hit')`);
		await play([{ op: 'step', frames: 4 }]);
		c = await hero();
		verdict(
			'a hit flinches additively over the idle',
			c?.states?.flinch === 'hit' &&
				Object.keys(c.weights).some((k) => k.startsWith('reactions.hit@')),
			c,
		);
		await shot('flinch');
		await play([{ op: 'step', frames: 40 }]);

		await key('Space', 'down');
		await play([{ op: 'step', frames: 3 }]);
		await key('Space', 'up');
		const air = [];
		for (let i = 0; i < 20; i++) {
			await play([{ op: 'step', frames: 3 }]);
			air.push((await hero())?.states?.base);
			if (i === 3) await shot('jump-pose');
		}
		await play([{ op: 'step', frames: 40 }]);
		air.push((await hero())?.states?.base);
		verdict(
			'Space: jump, then the air pose, then back to moving on landing',
			air.includes('jump') && air.at(-1) === 'move',
			air.join(','),
		);
	}

	const steps0 = (await state()).arcade.steps;
	await page.evaluate(`(() => {
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
	})()`);
	await play([{ op: 'step', frames: 30 }]);
	const steps1 = (await state()).arcade.steps;
	await page.evaluate(`(() => {
		delete document.visibilityState;
		document.dispatchEvent(new Event('visibilitychange'));
	})()`);
	await play([{ op: 'step', frames: 30 }]);
	const steps2 = (await state()).arcade.steps;
	verdict(
		'a hidden tab steps nothing; shown again it resumes',
		steps1 === steps0 && steps2 > steps1 && steps2 - steps1 <= 32,
		{
			steps0,
			steps1,
			steps2,
		},
	);

	const aimAt = { x: 900, y: 520 };
	for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
		await page.page('Input.dispatchMouseEvent', { type, ...aimAt, button: 'left', clickCount: 1 });
	await play([{ op: 'step', frames: 4 }]);
	await shot('aimed');
	const ratio = await page.evaluate(`(() => {
		const world = document.querySelector('canvas[data-ie-world3d]');
		const pixi = [...document.querySelectorAll('canvas')].find((c) => !('ieWorld3d' in c.dataset));
		return { world: world.width / innerWidth, hud: pixi.width / innerWidth };
	})()`);
	verdict(
		"the 3D canvas renders below the HUD's pixel ratio",
		ratio.world < ratio.hud && ratio.world >= 1,
		ratio,
	);

	const errors = await page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
} catch (error) {
	const errors = await page?.evaluate('window.__AR_ERRORS__').catch(() => undefined);
	verdict('the playtest ran', false, { error: String(error?.stack ?? error), errors });
	if (page)
		writeFileSync(join(out, 'failed.png'), await page.screenshot().catch(() => Buffer.alloc(0)));
} finally {
	await page?.close?.();
	server.stop();
	await snap.close?.();
	await rooms?.gracefullyShutdown?.(false).catch(() => undefined);
	// The browser may still hold its profile for a moment (Windows); a leftover temp folder is harmless.
	try {
		rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	} catch (error) {
		console.warn(`left ${work} behind: ${error.code ?? error}`);
	}
}

writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
const failed = result.verdicts.filter((v) => !v.ok);
for (const v of result.verdicts) console.log(`${v.ok ? 'PASS' : 'FAIL'} ${v.name}`);
if (failed.length) {
	for (const v of failed) console.log(JSON.stringify(v.detail));
	process.exit(1);
}
