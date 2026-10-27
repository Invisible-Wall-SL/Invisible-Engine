// Plays the PLATFORMER arcade sample (game-families §4.4, P10.13) on the shared runtime, in the
// headless shell: the ledges level (`arcadeLedgesReferenceLayout()`: a world twice the screen wide
// with a camera following the hero, a `tilemap` of solid ground, a wall and one-way ledges, a spawn
// layer), its config (`engine-mechanics/fixtures/arcade-ledges.rules.json`: a played `sideScroll`
// hero with gravity and a `gravity` jump, coins, the pit and goal zones), its flow
// (`ARCADE_LEDGES_SEED_DOC`) and the placeholder components, baked into one snapshot.
//
// It reads the arcade probe (`state().arcade`: bodies with each character's contact, the camera) and
// the flow's variables, and checks: the round starts with the hero standing on the painted ground;
// ArrowRight runs it and letting go stops it; Space jumps it to the jump's height (a tap lower);
// a jump from under a one-way ledge lands on it; the camera follows it along the level; a coin is
// collected; a gap's pit costs a life and puts it back at the start; a press above it on the screen
// jumps it; the same seeds and keys replay; free play sends the RGS nothing; no page error.
// Screenshots of the start, the jump, the ledge and the far side show the tiles. It builds its own
// snapshot, so the current-games harness is untouched.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arcade-platformer-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	ARCADE_LEDGES_COMPONENTS,
	ARCADE_LEDGES_SHEET,
	ARCADE_LEDGES_WORLD,
	arcadeLedgesReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/arcadeLedges.ts';
import {
	ARCADE_LEDGES_SEED_DOC,
	LEDGES_PLACES,
} from '../../packages/engine-flow-v2/src/reference/arcadeLedgesSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/arcade-platformer-play') },
		seed: { type: 'string', default: '7' },
		'arcade-seed': { type: 'string', default: 'sample' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'arcade-ledges';
const VIEW = { width: 1422, height: 800 };
/** The ground's top, the hero's half height and the jump, as the fixture sets them. */
const GROUND_TOP = 704;
const HERO_HALF = 28;
const JUMP_HEIGHT = 170;
const TAP_HEIGHT = 48;
const STANDING = GROUND_TOP - HERO_HALF;

const config = normalizeGameConfigDoc(
	JSON.parse(
		readFileSync(join(ROOT, 'packages/engine-mechanics/fixtures/arcade-ledges.rules.json'), 'utf8'),
	),
);
const doc = arcadeLedgesReferenceLayout();
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...ARCADE_LEDGES_COMPONENTS].map((d) => [d.id, d]),
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
	ARCADE_LEDGES_COMPONENTS.every((d) => d.id in componentDefs),
	Object.keys(componentDefs).filter((id) => id.startsWith('ledges')),
);

/** An RGBA PNG of `w × h` whose pixel colour `paint(x, y)` returns (`[r, g, b]`). */
function png(w, h, paint) {
	const table = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buf) => {
		let c = 0xffffffff;
		for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(crc(body), body.length + 4);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(w, 0);
	header.writeUInt32BE(h, 4);
	header.set([8, 6, 0, 0, 0], 8);
	const rows = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const [r, g, b] = paint(x, y);
			rows.set([r, g, b, 255], y * (w * 4 + 1) + 1 + x * 4);
		}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(rows)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

/** The `[r, g, b]` at (x, y) of a PNG (8-bit RGB or RGBA, any row filter): a screenshot's pixel. */
function pixelAt(file, x, y) {
	const buf = Buffer.from(file);
	let at = 8;
	let w = 0;
	let channels = 4;
	const idat = [];
	while (at < buf.length) {
		const len = buf.readUInt32BE(at);
		const type = buf.toString('ascii', at + 4, at + 8);
		const data = buf.subarray(at + 8, at + 8 + len);
		if (type === 'IHDR') {
			w = data.readUInt32BE(0);
			channels = data[9] === 6 ? 4 : 3;
		} else if (type === 'IDAT') idat.push(data);
		at += len + 12;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const stride = w * channels;
	let prev = Buffer.alloc(stride);
	let row = prev;
	for (let r = 0; r <= y; r++) {
		const filter = raw[r * (stride + 1)];
		const line = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
		row = Buffer.alloc(stride);
		for (let i = 0; i < stride; i++) {
			const left = i >= channels ? row[i - channels] : 0;
			const up = prev[i];
			const corner = i >= channels ? prev[i - channels] : 0;
			const p = left + up - corner;
			const pa = Math.abs(p - left);
			const pb = Math.abs(p - up);
			const pc = Math.abs(p - corner);
			const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
			const add = [0, left, up, (left + up) >> 1, paeth][filter];
			row[i] = (line[i] + add) & 0xff;
		}
		prev = row;
	}
	return [...row.subarray(x * channels, x * channels + 3)];
}

// The tileset sheet, exported as a publish would: a TexturePacker sheet and its page under
// `deploy/editor-art/`, listed in the bundle's `editorArt` under its manifest key.
const GROUND_RGB = [0x8d, 0x5a, 0x3c];
const LEDGE_RGB = [0x4c, 0xc9, 0xf0];
const work = mkdtempSync(join(tmpdir(), 'arcade-platformer-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy', 'editor-art'), { recursive: true });
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'S_Ledges.png'),
	png(128, 64, (x, y) => {
		const edge = y < 6 || x % 64 < 2;
		if (x < 64) return edge ? [0x5c, 0xb8, 0x5c] : GROUND_RGB;
		return y < 12 ? LEDGE_RGB : [0x1d, 0x35, 0x57];
	}),
);
const frame = (x) => ({
	frame: { x, y: 0, w: 64, h: 64 },
	rotated: false,
	trimmed: false,
	spriteSourceSize: { x: 0, y: 0, w: 64, h: 64 },
	sourceSize: { w: 64, h: 64 },
});
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'S_Ledges.json'),
	JSON.stringify({
		frames: {
			[ARCADE_LEDGES_SHEET.frames.ground]: frame(0),
			[ARCADE_LEDGES_SHEET.frames.ledge]: frame(64),
		},
		meta: { image: 'S_Ledges.png', format: 'RGBA8888', size: { w: 128, h: 64 }, scale: '1' },
	}),
);
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: ARCADE_LEDGES_SEED_DOC,
		editorArt: {
			sheets: [{ key: ARCADE_LEDGES_SHEET.manifest, json: 'editor-art/S_Ledges.json' }],
			images: [],
		},
	}),
);

// Every request the page makes and every page error, recorded before the app's own code runs.
const HOOK = `(() => {
	const wire = (window.__AP_WIRE__ = []);
	const errors = (window.__AP_ERRORS__ = []);
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
	name: 'Arcade ledges',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({ dir: snapshot, name: 'Arcade ledges', snapshotId: 'ledges' });
const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'arcade-platformer-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `arcade-ledges-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
	arseed: opt['arcade-seed'],
	flowlog: '1',
});

const KEYS = {
	ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
	ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
	Space: { key: ' ', code: 'Space', vk: 32 },
};

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
			key: KEYS[name].key,
			code: KEYS[name].code,
			windowsVirtualKeyCode: KEYS[name].vk,
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

const heroOf = (s) => s.arcade?.bodies.find((b) => b.tags.includes('player'));
const coinsOf = (s) => s.arcade?.bodies.filter((b) => b.tags.includes('coin')) ?? [];
const onScreen = (b, cam) =>
	!!b && b.x > cam.x && b.x < cam.x + cam.view.w && b.y > cam.y && b.y < cam.y + cam.view.h;

/** Step `n` frames one at a time, returning the hero's highest point (smallest y). */
async function peak(game, n) {
	let top = Infinity;
	for (let i = 0; i < n; i++) {
		await game.frames(1);
		top = Math.min(top, heroOf(await game.state())?.y ?? Infinity);
	}
	return top;
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

	await game.frames(30);
	const start = await game.state();
	const h0 = heroOf(start);
	verdict(
		'the round starts with the hero standing on the painted ground, the coins out, three lives',
		!!h0 &&
			h0.x === LEDGES_PLACES.hero.x &&
			Math.abs(h0.y - STANDING) < 1e-6 &&
			h0.grounded === true &&
			coinsOf(start).length === LEDGES_PLACES.coins.length &&
			(await game.variable('lives')) === 3,
		start.arcade?.bodies,
	);
	await shot('start');
	// The painted ground beside the hero: a tile row at y 704–768, drawn from the shipped sheet.
	const pixel = pixelAt(await game.page.screenshot(), 300, 740);
	verdict(
		'the tilemap draws its tiles from the shipped tileset sheet (a ground pixel is the ground’s colour)',
		pixel.every((v, i) => Math.abs(v - GROUND_RGB[i]) < 12),
		pixel,
	);

	await game.key('ArrowRight', 'down');
	await game.frames(20);
	await game.key('ArrowRight', 'up');
	await game.frames(20);
	const h1 = heroOf(await game.state());
	verdict(
		'ArrowRight runs the hero right, and letting go brings it to a stop',
		h1.x > h0.x + 60 && h1.vx === 0 && h1.grounded === true,
		h1,
	);

	await game.key('Space', 'down');
	const top = await peak(game, 40);
	await game.key('Space', 'up');
	await game.frames(30);
	verdict(
		`Space jumps the hero to the jump's height (${JUMP_HEIGHT} px) and it lands again`,
		Math.abs(STANDING - top - JUMP_HEIGHT) < 0.5 &&
			Math.abs(heroOf(await game.state()).y - STANDING) < 1e-6,
		{ rise: STANDING - top },
	);
	await game.key('Space', 'down');
	await game.frames(1);
	await game.key('Space', 'up');
	const tapTop = await peak(game, 30);
	await game.frames(30);
	const tapRise = STANDING - tapTop;
	verdict(
		`a tap jumps lower: about the tap height (${TAP_HEIGHT} px)`,
		tapRise > TAP_HEIGHT - 1 && tapRise < TAP_HEIGHT + 20,
		{ rise: tapRise },
	);

	// Under the first ledge (row 9, cols 5–8: top 576): jump up through it and land on it.
	const under = heroOf(await game.state());
	await game.key('ArrowRight', 'down');
	for (let i = 0; i < 120; i++) {
		await game.frames(1);
		if (heroOf(await game.state()).x >= 6 * 64) break;
	}
	await game.key('ArrowRight', 'up');
	await game.frames(20);
	await game.key('Space', 'down');
	await game.frames(8);
	await shot('jump');
	await game.frames(40);
	await game.key('Space', 'up');
	await game.frames(10);
	const onLedge = heroOf(await game.state());
	verdict(
		'a jump from under a one-way ledge passes up through it and lands on it',
		Math.abs(onLedge.y - (576 - HERO_HALF)) < 1e-6 && onLedge.grounded === true,
		{ from: under, to: onLedge },
	);
	await shot('ledge');

	// Off the ledge, along the level: hop the first gap and run to the wall, then over it.
	await game.key('ArrowRight', 'down');
	let lostLife = false;
	let crossed = false;
	for (let i = 0; i < 900 && !lostLife; i++) {
		const s = await game.state();
		const h = heroOf(s);
		const x = h?.x ?? 0;
		const jumpHere =
			h?.grounded && ((x > 11.4 * 64 && x < 12 * 64) || (x > 19 * 64 && x < 19.6 * 64));
		if (jumpHere) {
			await game.key('Space', 'down');
			await game.frames(24);
			await game.key('Space', 'up');
		} else await game.frames(1);
		if (x > ARCADE_LEDGES_WORLD.w / 2 && !crossed) {
			crossed = true;
			const cam = s.arcade?.camera;
			verdict(
				'the camera follows the hero along the level (twice the screen wide)',
				!!cam && cam.x > 400 && onScreen(h, cam),
				{ camera: cam, hero: h },
			);
			await shot('far-side');
		}
		lostLife = (await game.variable('lives')) === 2;
	}
	await game.key('ArrowRight', 'up');
	await game.frames(4);
	const back = await game.state();
	verdict('it jumped the first gap and the wall and got past the half way', crossed);
	verdict(
		'the second gap’s pit costs a life and puts the hero back at the start, the camera with it',
		lostLife && heroOf(back).x === LEDGES_PLACES.hero.x && back.arcade?.camera?.x === 0,
		{ hero: heroOf(back), camera: back.arcade?.camera },
	);
	verdict(
		'coins are collected on the way',
		(await game.variable('coins')) >= 1 && coinsOf(back).length < LEDGES_PLACES.coins.length,
		{ coins: await game.variable('coins') },
	);

	await game.frames(40);
	const before = heroOf(await game.state());
	const above = { x: before.x - (back.arcade?.camera?.x ?? 0), y: 300 };
	await game.page.mouse('mouseMoved', above.x, above.y);
	await game.page.mouse('mousePressed', above.x, above.y);
	await game.frames(6);
	await game.page.mouse('mouseReleased', above.x, above.y);
	const touched = heroOf(await game.state());
	verdict('a press on the screen above the hero jumps it', touched.vy < 0 && touched.y < before.y, {
		before,
		touched,
	});
	await game.frames(60);

	const wire = await game.page.evaluate('window.__AP_WIRE__');
	const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
	verdict('free play sends the RGS nothing', rgs.length === 0, rgs);
	const errors = await game.page.evaluate('window.__AP_ERRORS__');
	const end = await game.state();
	verdict('no page error', errors.length === 0 && end.errors === 0, errors);
	await game.page.close();

	const runScript = async (profile) => {
		const g = await boot(profile);
		await g.frames(30);
		await g.key('ArrowRight', 'down');
		await g.frames(40);
		await g.key('Space', 'down');
		await g.frames(20);
		await g.key('Space', 'up');
		await g.frames(60);
		await g.key('ArrowRight', 'up');
		await g.frames(60);
		const s = (await g.state()).arcade;
		await g.page.close();
		return s;
	};
	const a = await runScript('replay-a');
	const b = await runScript('replay-b');
	verdict(
		'the same seeds and keys replay the same level',
		JSON.stringify(a) === JSON.stringify(b),
		{ a: a?.bodies?.slice(0, 2), b: b?.bodies?.slice(0, 2) },
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
	failed ? `\narcade platformer play: ${failed} FAILED` : `\narcade platformer play: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
