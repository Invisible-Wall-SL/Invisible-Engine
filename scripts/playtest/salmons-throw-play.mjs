// Plays the FISHERMAN'S HOLD AND THROW of Salmons (a `hook` ability's `carry`; owner, 2026-11-24)
// on the shared runtime, in headless shells against a real game server on localhost. Every page
// boots the game the room plays (the `salmonsRiver` generator, original art, no bots), so the river
// a page draws is the river its room plays.
//
// Rooms, each with a fisherman's page (Hal) and a salmon's page (Gil), 1280 × 720 at 2×:
// - `throw-water`: Hal clicks on Gil's salmon: the line hooks it and reels it into his hands. Both
//   pages draw it there (held, on his place, out of the water), no stain anywhere. Hal walks: it
//   goes with him. Hal clicks on the water: it flies (seen mid-air on both pages), lands, Gil's
//   page shows its death screen "by Hal", and the one pool of blood is where it landed. Gil
//   respawns and swims through the pool: red, and a trail on the water;
// - `throw-land`: the same catch, thrown onto the bank: the pool is on the grass;
// - `throw-drop`: Hal never throws: after the hold time the salmon is dropped at his feet and dies
//   there;
// - `throw-leave`: Hal's page closes while he holds: the salmon is dropped and dies;
// - `throw-phone`: Hal on a phone (390 × 844, touch): a tap on the salmon casts, a tap on the bank
//   (not a cast's target) throws there, and a held finger still walks him.
//
// Screenshots (2×) and what each page's probe said go to `--out`; `report.json` holds the verdicts.
//
//   PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-throw-play.mjs --runtime apps/lines/build --out <dir> [--only <room>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { STATUS } from '../../packages/engine-mechanics/src/abilities.js';
import { salmonsConfig, salmonsRiver } from '../../packages/engine-mechanics/src/salmons.js';
import { CELL } from '../../packages/engine-mechanics/src/salmonsMap.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, withOnlineCarry } from '../../packages/game-config/index.ts';
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
		out: { type: 'string', default: join(ROOT, '.cache/salmons-throw-play') },
		chrome: { type: 'string' },
		only: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';
/** The level every room plays: pinned, so a run's pictures are a run's again. */
const SEED = 5;

const river = salmonsRiver();
const config = salmonsConfig(river);
delete config.arcade.online.bots;
config.arcade.online.levels = { seeds: [SEED] };
const carry = { holdMs: 4000 };

const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { verdicts: [], measures: {}, shots: [] };
const verdict = (name, ok, detail) => {
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
	console.log(
		`${ok ? '  ok ' : 'FAIL '} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`,
	);
};

const work = mkdtempSync(join(tmpdir(), 'salmons-throw-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
);
const configs = join(work, 'configs');
mkdirSync(configs);
const ROOMS = ['throw-water', 'throw-land', 'throw-drop', 'throw-leave', 'throw-phone'];
// A headless page takes seconds to photograph: every room but the drop's holds for 20 s, so the
// pictures are taken while he holds, and `throw-water` flies for 3 s, so one is taken in the air.
// `throw-drop` plays the shipped 4 s; `throw-land` and the phone the shipped 0.6 s flight.
for (const name of ROOMS) {
	const game = structuredClone(config);
	const hook = game.arcade.online.rules.abilities.find((a) => a.effect === 'hook');
	hook.carry =
		name === 'throw-drop'
			? {}
			: { holdMs: 20_000, ...(name === 'throw-water' ? { flightMs: 3000 } : {}) };
	// As a publish stores it: the normalizer drops `carry`, the launcher's save puts it back.
	writeFileSync(
		join(configs, `${name}.json`),
		JSON.stringify(withOnlineCarry(normalizeGameConfigDoc(game), game)),
	);
}

const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'freePlay',
	name: 'Salmons',
	projectKey: KEY,
});
const server = await startTestServer(tree, {});
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Salmons',
	snapshotId: 'salmons',
	assetBase: `${server.origin}/${KEY}/`,
});
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 8,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DESKTOP = { w: 1280, h: 720 };
const PHONE = { w: 390, h: 844 };
const PHONE_UA =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/** A page on `game` as `character`, once it has joined its room and drawn its art. */
async function boot(profile, name, character, game, phone = false) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	const size = phone ? PHONE : DESKTOP;
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: size.w,
		height: size.h,
		deviceScaleFactor: 2,
		mobile: phone,
	});
	if (phone) {
		await page.page('Emulation.setUserAgentOverride', { userAgent: PHONE_UA });
		await page.page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	}
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'throw-play',
		editorDocBase: snap.origin,
		lang: 'en',
		currency: 'USD',
		device: phone ? 'mobile' : 'desktop',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		rooms_name: name,
		rooms_character: character,
		rooms_game: game,
	});
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
	const state = () => api('state()');
	// Stepped no faster than the room's clock, so an input acts when it is sent.
	const settle = async (ms) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const from = Date.now();
			await play([{ op: 'step', frames: 6 }]);
			await wait(Math.max(10, 100 - (Date.now() - from)));
		}
	};
	for (let i = 0; i < 120; i++) {
		await settle(500);
		if ((await state()).arcade?.online?.art) break;
	}
	const online = async () => (await state()).arcade?.online;
	const rectOf = async () =>
		JSON.parse(
			await page.evaluate(
				'JSON.stringify(document.querySelector("canvas").getBoundingClientRect())',
			),
		);
	/** Where world point `at` (raised by `lift`; none: on the own player's terrace) is on the page,
	 *  CSS px. Salmons' screen is mirrored: world (x, y) is drawn at (y − x, (x + y) / 2). */
	const screenOf = async (at, lift) => {
		const cam = (await state()).arcade?.camera;
		const rect = await rectOf();
		const k = cam.scale * cam.zoom;
		lift ??= cam.lift;
		const dx = at.x - (cam.x + cam.view.w / 2);
		const dy = at.y - (cam.y + cam.view.h / 2);
		return {
			x: Math.round(rect.left + rect.width / 2 + (cam.shakeX + dy - dx) * k),
			y: Math.round(
				rect.top + rect.height / 2 + (cam.shakeY + cam.lift + (dx + dy) / 2 - lift) * k,
			),
		};
	};
	const click = async (at) => {
		await page.page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
		for (const type of ['mousePressed', 'mouseReleased'])
			await page.page('Input.dispatchMouseEvent', {
				type,
				...at,
				button: 'left',
				buttons: type === 'mousePressed' ? 1 : 0,
				clickCount: 1,
			});
		await play([{ op: 'step', frames: 3 }]);
	};
	const touch = (type, points) =>
		page.page('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((point, id) => ({ id, ...point })),
		});
	const tap = async (at) => {
		await touch('touchStart', [at]);
		await play([{ op: 'step', frames: 1 }]);
		await touch('touchEnd', []);
		await play([{ op: 'step', frames: 3 }]);
	};
	const key = async (code, type) =>
		page.page('Input.dispatchKeyEvent', {
			type: type === 'down' ? 'rawKeyDown' : 'keyUp',
			key: code,
			code,
			windowsVirtualKeyCode: { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[code],
		});
	const shot = async (file) => {
		await play([{ op: 'step', frames: 1 }]);
		writeFileSync(join(out, file), await page.screenshot());
		result.shots.push(file);
	};
	const errors = () => page.evaluate('JSON.stringify(window.__AR_ERRORS__)').then(JSON.parse);
	return { page, state, play, settle, online, screenOf, click, tap, touch, key, shot, errors };
}

/** A page's probe until `test(online)` answers, stepping it as time passes. */
async function until(game, what, test, ms = 20_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const online = await game.online();
		const got = online && test(online);
		if (got) return got;
		await game.settle(100);
	}
	verdict(`waited for ${what}`, false);
	return undefined;
}
const drawnOf = (online, id) => online.drawn.find((d) => d.id === id);
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const types = (online, ...of) =>
	online.events.filter((e) => of.includes(e.type)).map((e) => e.type);

/** A room's two pages, the salmon hooked by the fisherman's click and reeled into his hands. */
async function caught(room, phone = false) {
	const hal = await boot(`${room}-hal`, 'Hal', 'fisherman', room, phone);
	const gil = await boot(`${room}-gil`, 'Gil', 'salmon', room);
	const h = (await hal.online()).me;
	const g = (await gil.online()).me;
	// Past the second a new player cannot be hooked for, both pages sent each other.
	await Promise.all([hal.settle(2500), gil.settle(2500)]);
	const both = (ms) => Promise.all([hal.settle(ms), gil.settle(ms)]);
	// The salmon starts in the sea, where no line lands: it swims up into the river's water (up
	// the river is Up + Left on the mirrored screen) and rests there.
	const waters = (await gil.online()).zones.filter((z) => /^band\d+Water$/.test(z[0]));
	const mouth = Math.max(...waters.map((z) => z[2] + z[4]));
	for (const code of ['ArrowUp', 'ArrowLeft']) await gil.key(code, 'down');
	await until(gil, 'the salmon in the river', (o) => drawnOf(o, g)?.y < mouth - 2.5 * CELL);
	for (const code of ['ArrowUp', 'ArrowLeft']) await gil.key(code, 'up');
	await both(400);
	let hookAt;
	// He clicks on the salmon where his page draws it; a cast that misses is cast again.
	for (let i = 0; i < 6; i++) {
		const fish = await until(hal, 'the salmon on the fisherman’s page', (o) => drawnOf(o, g));
		hookAt = { x: fish.x, y: fish.y };
		const at = await hal.screenOf(fish);
		if (phone) await hal.tap(at);
		else await hal.click(at);
		await both(1200);
		if ((await hal.online()).events.some((e) => e.type === 'hooked')) break;
		await both(1500);
	}
	await until(hal, 'the hook', (o) => o.events.some((e) => e.type === 'hooked'));
	await hal.shot(`${room}-1-hooked-fisherman.png`);
	const held = await until(
		hal,
		'the salmon in his hands',
		(o) => drawnOf(o, g)?.status === STATUS.held && o,
		15_000,
	);
	await gil.settle(300);
	return { hal, gil, h, g, hookAt, held, both };
}

/** What both pages must show of a held salmon: in his hands, on his place, no stain, no death. */
async function seenHeld(room, { hal, gil, h, g }) {
	for (const [who, game] of [
		['the fisherman’s page', hal],
		['the salmon’s page', gil],
	]) {
		const o = await game.online();
		const fish = drawnOf(o, g);
		const man = drawnOf(o, h);
		const look = o.art?.looks?.[g];
		verdict(
			`${room}: ${who} draws the salmon held, in his hands, out of the water`,
			fish?.status === STATUS.held &&
				fish.heldBy === h &&
				!!man &&
				far(fish, man) < 3 &&
				look?.carried === true &&
				look.underwater === false,
			{ fish, man: man && { x: Math.round(man.x), y: Math.round(man.y) }, look },
		);
		verdict(
			`${room}: ${who} has no blood and no death at the catch`,
			o.stains.length === 0 &&
				o.art.blood.stains === 0 &&
				!o.hidden.includes(g) &&
				types(o, 'caught').length === 0,
			{ stains: o.stains, events: types(o, 'hooked', 'held', 'caught') },
		);
	}
	const mine = await gil.online();
	verdict(
		`${room}: the death screen is not up while it is held`,
		!mine.screens?.caught?.shown,
		mine.screens,
	);
}

/** After the death: out on both pages, the death screen "by Hal", one pool at `place`. */
async function seenDead(room, { hal, gil, g, hookAt }, place, why) {
	await until(gil, 'the death', (o) => o.hidden.includes(g));
	await Promise.all([hal.settle(600), gil.settle(600)]);
	for (const [who, game] of [
		['the fisherman’s page', hal],
		['the salmon’s page', gil],
	]) {
		const o = await game.online();
		const [stain] = o.stains;
		verdict(
			`${room}: ${who} has one pool of blood, ${why}`,
			o.stains.length === 1 &&
				o.art.blood.stains === 1 &&
				far({ x: stain[0], y: stain[1] }, place) < CELL / 2 &&
				far({ x: stain[0], y: stain[1] }, hookAt) > CELL,
			{ stain, place, hookAt },
		);
	}
	const mine = await gil.online();
	verdict(
		`${room}: the salmon’s page shows its death screen, by Hal`,
		JSON.stringify(mine.screens ?? '').includes('Hal'),
		mine.screens,
	);
	const his = await hal.online();
	verdict(
		`${room}: the fisherman scores 1, at the death`,
		Object.values(his.scores).includes(1),
		his.scores,
	);
}

async function water() {
	const room = 'throw-water';
	const pages = await caught(room);
	const { hal, gil, h, g, both } = pages;
	await hal.shot(`${room}-2-held-fisherman.png`);
	await gil.shot(`${room}-2-held-salmon.png`);
	await seenHeld(room, pages);
	// He walks along the bank: the salmon goes with him, on both pages.
	const from = drawnOf(await hal.online(), h);
	await hal.key('ArrowUp', 'down');
	await both(700);
	await hal.key('ArrowUp', 'up');
	await both(300);
	const walked = await hal.online();
	const man = drawnOf(walked, h);
	const fish = drawnOf(walked, g);
	verdict(
		`${room}: he walks while he holds, and it goes with him`,
		far(man, from) > CELL / 2 && far(fish, man) < 3,
		{
			walked: Math.round(far(man, from)),
			apart: far(fish, man),
		},
	);
	await hal.shot(`${room}-3-walked-fisherman.png`);
	// Thrown onto the water, 5 cells towards the river from him.
	const zones = walked.zones.filter((z) => /^band\d+Water$/.test(z[0]));
	const band = zones.find((z) => man.y >= z[2] && man.y < z[2] + z[4]);
	const side = man.x > band[1] + band[3] ? -1 : 1;
	const edge = side < 0 ? band[1] + band[3] : band[1];
	const aim = { x: edge + side * 3 * CELL, y: man.y - 2 * CELL };
	result.measures.throwCells = far(aim, man) / CELL;
	await hal.click(await hal.screenOf(aim));
	// Mid-air, on both pages.
	await both(900);
	const [air, airHis] = [await gil.online(), await hal.online()];
	await gil.shot(`${room}-4-thrown-salmon.png`);
	await hal.shot(`${room}-4-thrown-fisherman.png`);
	const flying = (o) => drawnOf(o, g)?.status === STATUS.thrown && o.art.looks[g]?.thrown === true;
	verdict(`${room}: thrown, it is in the air on both pages`, flying(air) && flying(airHis), {
		salmon: air.art.looks[g],
		fisherman: airHis.art.looks[g],
		events: types(airHis, 'held', 'thrown', 'landed'),
	});
	const cam = (await gil.state()).arcade.camera;
	const mine = drawnOf(air, g);
	verdict(
		`${room}: the thrown player’s camera follows it`,
		Math.abs(mine.x - (cam.x + cam.view.w / 2)) < 4 * CELL &&
			Math.abs(mine.y - (cam.y + cam.view.h / 2)) < 4 * CELL,
		{ mine, cam: { x: cam.x + cam.view.w / 2, y: cam.y + cam.view.h / 2 } },
	);
	await seenDead(room, pages, aim, 'where it landed on the water');
	await hal.shot(`${room}-5-landed-fisherman.png`);
	await gil.shot(`${room}-5-dead-salmon.png`);
	// Close on the pool: the fisherman walks off it first? He is on the bank; the pool is on the water.
	const order = types(await hal.online(), 'hooked', 'held', 'thrown', 'landed', 'caught');
	verdict(
		`${room}: hooked, held, thrown, landed, caught, in that order`,
		order.join() === 'hooked,held,thrown,landed,caught',
		order,
	);
	result.measures.signals = (await hal.online()).signals
		.filter((s) => ['held', 'thrown', 'landed', 'caught'].includes(s.name))
		.map((s) => s.name);
	// Gil respawns as a salmon and swims through the pool: red, and a trail on the water.
	const respawn = (await gil.online()).screens.caught.buttons.respawn;
	const rect = JSON.parse(
		await gil.page.evaluate(
			'JSON.stringify(document.querySelector("canvas").getBoundingClientRect())',
		),
	);
	await gil.click({ x: Math.round(rect.left + respawn.x), y: Math.round(rect.top + respawn.y) });
	await until(gil, 'the respawn', (o) => drawnOf(o, g));
	// The keys are the screen's: world (x, y) is drawn at (y − x, (x + y) / 2).
	const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
	let down = new Set();
	const steer = async (want) => {
		for (const code of KEYS)
			if (want.has(code) !== down.has(code)) await gil.key(code, want.has(code) ? 'down' : 'up');
		down = want;
	};
	let swum;
	for (let i = 0; i < 150; i++) {
		const o = await gil.online();
		const me = drawnOf(o, g);
		if (!me) break;
		swum = { red: o.art.looks[g]?.red === true, trail: o.art.blood.trail, apart: far(me, aim) };
		if (swum.red && swum.trail > 8) break;
		const sx = aim.y - me.y - (aim.x - me.x);
		const sy = (aim.x - me.x + aim.y - me.y) / 2;
		const want = new Set();
		if (sx < -12) want.add('ArrowLeft');
		if (sx > 12) want.add('ArrowRight');
		if (sy < -12) want.add('ArrowUp');
		if (sy > 12) want.add('ArrowDown');
		await steer(want);
		await both(120);
	}
	await steer(new Set());
	verdict(
		`${room}: a salmon that swims through the pool turns red and leaves a trail`,
		swum?.red === true && swum.trail > 0,
		swum,
	);
	await gil.shot(`${room}-6-trail-salmon.png`);
	await hal.shot(`${room}-6-trail-fisherman.png`);
	return pages;
}

async function land() {
	const room = 'throw-land';
	const pages = await caught(room);
	const { hal, gil, h } = pages;
	await seenHeld(room, pages);
	const man = drawnOf(await hal.online(), h);
	const zones = (await hal.online()).zones.filter((z) => /^band\d+Water$/.test(z[0]));
	const band = zones.find((z) => man.y >= z[2] && man.y < z[2] + z[4]);
	// Away from the river, onto the grass, 4 cells.
	const away = man.x > band[1] + band[3] ? 1 : -1;
	const aim = { x: man.x + away * 3 * CELL, y: man.y - 3 * CELL };
	await hal.click(await hal.screenOf(aim));
	await seenDead(room, pages, aim, 'where it landed on the bank');
	await hal.shot(`${room}-5-landed-fisherman.png`);
	await gil.shot(`${room}-5-dead-salmon.png`);
}

async function drop() {
	const room = 'throw-drop';
	const pages = await caught(room);
	const { hal, gil, h, g, both } = pages;
	// The shipped 4 s: too short for this harness to photograph him holding, so it is not asked
	// what it saw of the hold (the other rooms are), only that the hold came and ended by itself.
	const man = drawnOf(await hal.online(), h);
	await until(hal, 'the drop', (o) => o.events.some((e) => e.type === 'landed'), 12_000);
	const o = await hal.online();
	const landed = o.events.find((e) => e.type === 'landed');
	verdict(
		`${room}: never thrown, it is dropped (not thrown) when the hold runs out`,
		landed?.dropped === true && types(o, 'held', 'thrown', 'landed').join() === 'held,landed',
		{ landed, holdMs: carry.holdMs },
	);
	await seenDead(room, pages, man, 'at his feet');
	await both(200);
	await hal.shot(`${room}-5-dropped-fisherman.png`);
	void g;
	void gil;
}

async function leave() {
	const room = 'throw-leave';
	const pages = await caught(room);
	const { hal, gil, h, g } = pages;
	await seenHeld(room, pages);
	const man = drawnOf(await gil.online(), h);
	await hal.page.close();
	await until(gil, 'the death after he left', (o) => o.hidden.includes(g), 15_000);
	await gil.settle(600);
	const o = await gil.online();
	const [stain] = o.stains;
	verdict(
		`${room}: he leaves while he holds: it is dropped and dies, a pool where he stood`,
		o.hidden.includes(g) &&
			o.stains.length === 1 &&
			far({ x: stain[0], y: stain[1] }, man) < CELL &&
			o.events.some((e) => e.type === 'landed' && e.dropped),
		{ stain, man, events: types(o, 'held', 'landed', 'caught', 'left') },
	);
	await gil.shot(`${room}-5-dead-salmon.png`);
}

async function phone() {
	const room = 'throw-phone';
	const pages = await caught(room, true);
	const { hal, gil, h, g, both } = pages;
	await hal.shot(`${room}-2-held-fisherman.png`);
	await seenHeld(room, pages);
	// A held finger still walks him: 90 px up-left of him, half a second.
	const own = drawnOf(await hal.online(), h);
	const at = await hal.screenOf(own);
	await hal.touch('touchStart', [{ x: at.x - 70, y: at.y - 70 }]);
	await both(600);
	await hal.touch('touchEnd', []);
	await both(200);
	const after = await hal.online();
	const man = drawnOf(after, h);
	verdict(
		`${room}: a held finger walks him while he holds, and throws nothing`,
		far(man, own) > CELL / 2 &&
			drawnOf(after, g)?.status === STATUS.held &&
			types(after, 'thrown').length === 0,
		{ walked: Math.round(far(man, own)), events: types(after, 'held', 'thrown') },
	);
	// A tap on the bank (never a cast's target) throws it there.
	const zones = after.zones.filter((z) => /^band\d+Water$/.test(z[0]));
	const band = zones.find((z) => man.y >= z[2] && man.y < z[2] + z[4]);
	const away = man.x > band[1] + band[3] ? 1 : -1;
	const aim = { x: man.x + away * 2 * CELL, y: man.y - 2 * CELL };
	await hal.tap(await hal.screenOf(aim));
	await both(250);
	await hal.shot(`${room}-4-thrown-fisherman.png`);
	await seenDead(room, pages, aim, 'where the tap threw it, on the bank');
	await hal.shot(`${room}-5-landed-fisherman.png`);
	void gil;
}

const PLAYS = {
	'throw-water': water,
	'throw-land': land,
	'throw-drop': drop,
	'throw-leave': leave,
	'throw-phone': phone,
};
try {
	for (const [name, run] of Object.entries(PLAYS)) {
		if (opt.only && opt.only !== name) continue;
		console.log(`— ${name}`);
		await run();
	}
} catch (error) {
	verdict('the play ran to its end', false, String(error?.stack ?? error));
} finally {
	writeFileSync(join(out, 'report.json'), JSON.stringify(result, null, '\t'));
	await rooms.close?.().catch(() => {});
	await server.close?.().catch?.(() => {});
	rmSync(work, { recursive: true, force: true });
}
const failed = result.verdicts.filter((v) => !v.ok);
console.log(
	`salmons-throw-play: ${result.verdicts.length - failed.length} ok, ${failed.length} failed → ${out}`,
);
process.exit(failed.length ? 1 : 0);
