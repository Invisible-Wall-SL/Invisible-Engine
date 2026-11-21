// Plays SALMONS on a PHONE with FINGERS (docs/design/arcade-touch-controls.md), on the shared
// runtime in headless shells against a real game server on localhost: a 390 × 844 window with a
// phone's user agent and touch, booting the config with the touch schemes Salmons ships
// (`engine-mechanics` `salmons.js`; NOT normalized: the normalizer drops them, a publish ships
// them). Touches go in through the browser's own input pipeline (`Input.dispatchTouchEvent`), so
// the browser's gestures (its pan, its `pointercancel`) take part as on a phone.
//
// Three rooms of the authored band river, as `salmons-play.mjs` makes them:
// - the salmon below a waterfall: a finger held and dragged keeps it swimming for as long as it
//   is down, past where the finger was put, with no touch cancelled; lifted, it stops; a tap sets
//   a heading it keeps with no finger down, and leaps; a tap on itself stops it; taps upstream
//   take it to the waterfall's foot and climb it;
// - the fisherman on a bank by a salmon on a sandbank: a tap on the salmon casts there and hooks
//   it, and does not walk him off; a held finger walks him and lifting stops him; the salmon's
//   page presses Respawn on its death screen with a finger, which neither moves it nor leaps;
// - the bear on a bank: a held finger walks it into the water's edge and lifting stops it; taps
//   swipe, and catch the salmon the current carries past.
//
// `--repro` boots the same rooms WITHOUT the schemes and reports what a held and a dragged finger
// do there (the numbers only, no verdict): run it on a runtime built before 2026-11-21 to see the
// hold that stops.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-touch-play.mjs --runtime apps/lines/build --out <dir> \
//     [--chrome <exe>] [--netcode engine|colyseus] [--repro]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { salmonsConfig, salmonsRiver } from '../../packages/engine-mechanics/src/salmons.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
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
		out: { type: 'string', default: join(ROOT, '.cache/salmons-touch-play') },
		chrome: { type: 'string' },
		netcode: { type: 'string', default: 'engine' },
		repro: { type: 'boolean', default: false },
		only: { type: 'string' },
	},
});
if (opt.netcode !== 'engine' && opt.netcode !== 'colyseus') {
	console.error(`--netcode is engine or colyseus, not "${opt.netcode}"`);
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';

const river = salmonsRiver();
// Bears that stand still, by count: nothing hunts a page's player. NOT normalized: the pages boot
// the schemes as authored.
const authored = salmonsConfig(river);
authored.arcade.online.bots.characters = [{ character: 'bear', brain: 'bearBot' }];
for (const character of authored.arcade.characters)
	character.brain = {
		initial: 'rest',
		states: [{ id: 'rest', behaviour: 'idle' }],
		transitions: [],
	};
authored.arcade.online.netcode = opt.netcode;
if (opt.repro) delete authored.arcade.online.touch;
const config = authored;

const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { netcode: opt.netcode, verdicts: [], measures: {}, shots: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'salmons-touch-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
);
const configs = join(work, 'configs');
mkdirSync(configs);
// The rooms play the authored river (no generator, no bots), each class starting where its page
// needs it, as `salmons-play.mjs`'s rule rooms do.
const base = structuredClone(authored);
delete base.arcade.online.bots;
delete base.arcade.online.generator;
const room = (name, spawns) => {
	const game = structuredClone(base);
	for (const character of game.arcade.online.characters)
		if (spawns[character.id]) character.spawns = [spawns[character.id]];
	if (spawns.salmon) game.arcade.online.spawn = spawns.salmon;
	writeFileSync(join(configs, `${name}.json`), JSON.stringify(normalizeGameConfigDoc(game)));
	return game;
};
const FALL = river.waterfalls[0];
const BELOW = river.bands.find((band) => band.y === FALL.y + FALL.h / 2);
const FOOT = FALL.y + FALL.h + 22;
const FALLS_GAME = 'touch-falls';
// In the open water right of the band's sandbank, as far below the foot as the band is clear.
const SWIM_AT = { x: 1000, y: BELOW.y + BELOW.h - 20 };
const fallsGame = room(FALLS_GAME, { salmon: SWIM_AT });
// A salmon on a sandbank (grounded) and a fisherman on the bank by it.
const LINE_SAND = river.sandbanks.find((sand) => {
	const band = river.bands.find((b) => sand.y >= b.y && sand.y < b.y + b.h);
	const cx = sand.x + sand.w / 2;
	return Math.min(cx - band.left, band.right - cx) < 240;
});
const LINE_BAND = river.bands.find((b) => LINE_SAND.y >= b.y && LINE_SAND.y < b.y + b.h);
const LINE_AT = { x: LINE_SAND.x + LINE_SAND.w / 2, y: LINE_SAND.y + LINE_SAND.h / 2 };
const FISHER_AT = {
	x:
		LINE_AT.x - LINE_BAND.left < LINE_BAND.right - LINE_AT.x
			? LINE_BAND.right + 40
			: LINE_BAND.left - 40,
	y: LINE_AT.y,
};
const LINE_GAME = 'touch-line';
room(LINE_GAME, { salmon: LINE_AT, fisherman: FISHER_AT });
// A salmon in open water by a bank, and a bear on that bank a little downstream.
const BLOOD_BAND = river.bands.find((band) => {
	const x = band.left + 60;
	const y = band.y + band.h / 2;
	const near = (b) => x + 100 > b.x && x - 100 < b.x + b.w && y + 100 > b.y && y - 100 < b.y + b.h;
	const pools = river.whirlpools.map((w) => ({
		x: w.x - w.r,
		y: w.y - w.r,
		w: 2 * w.r,
		h: 2 * w.r,
	}));
	return band.current <= 100 && ![...river.rocks, ...river.sandbanks, ...pools].some(near);
});
const BLOOD_AT = { x: BLOOD_BAND.left + 30, y: BLOOD_BAND.y + BLOOD_BAND.h / 2 };
const BEAR_AT = { x: BLOOD_BAND.left - 40, y: BLOOD_AT.y + 60 };
const BLOOD_GAME = 'touch-blood';
room(BLOOD_GAME, { salmon: BLOOD_AT, bear: BEAR_AT });

// Every pointer event the page hears, by type, and the canvas's `touch-action`.
const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
	const heard = (window.__TOUCH_HEARD__ = {});
	for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
		addEventListener(type, (e) => {
			if (e.pointerType !== 'mouse') heard[type] = (heard[type] || 0) + 1;
		}, true);
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
// The salmon's page boots its room's own game (the authored river, no generator), so the place it
// predicts and aims from is the room's, as in a published game. It has no original art (that comes
// with the generator): placeholder looks. The other pages keep the art, for the death screen.
const fallsBundle = join(work, 'runtime-falls.json');
writeFileSync(
	fallsBundle,
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config: fallsGame,
		flowV2: SALMONS_SEED_DOC,
	}),
);
const snapFalls = await serveSnapshot({
	dir: snapshot,
	bundleFile: fallsBundle,
	name: 'Salmons',
	snapshotId: 'salmons-falls',
});
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 6,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { w: 390, h: 844 };
const PHONE_UA =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/** A phone's page on the game as `character`, once it has joined its room and drawn its art. */
async function boot(profile, character, game, base = snap) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: PHONE.w,
		height: PHONE.h,
		deviceScaleFactor: 1,
		mobile: true,
	});
	await page.page('Emulation.setUserAgentOverride', { userAgent: PHONE_UA });
	await page.page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'touch-play',
		editorDocBase: base.origin,
		lang: 'en',
		currency: 'USD',
		device: 'mobile',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		rooms_name: profile,
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
	// Stepped no faster than the room's clock: a page stepped ahead of real time queues its inputs
	// at the room, which takes one a step, and a tap would then act late.
	const settle = async (ms) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const from = Date.now();
			await play([{ op: 'step', frames: 6 }]);
			await wait(Math.max(10, 100 - (Date.now() - from)));
		}
	};
	// The original art, where the page's game has it (a generator).
	for (let i = 0; i < (base === snap ? 120 : 2); i++) {
		await settle(500);
		if ((await state()).arcade?.online?.art) break;
	}
	const online = async () => (await state()).arcade?.online;
	/** The own player as the room has it. */
	const own = async () => {
		const arcade = (await state()).arcade;
		const id = arcade?.online?.me;
		return arcade?.bodies.find((b) => b.id === id);
	};
	const tapMs = (result.measures.tapMs ??= []);
	const heard = () => page.evaluate('JSON.stringify(window.__TOUCH_HEARD__)').then(JSON.parse);
	const touch = (type, points) =>
		page.page('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((point, id) => ({ id, ...point })),
		});
	/** How many CSS px a projected world px is drawn, and the canvas's box. */
	const drawnBy = async () => {
		const cam = (await state()).arcade?.camera;
		const rect = JSON.parse(
			await page.evaluate(
				'JSON.stringify(document.querySelector("canvas").getBoundingClientRect())',
			),
		);
		return { cam, rect, k: cam.scale * cam.zoom };
	};
	// Salmons' screen is mirrored: world (x, y) is drawn at (y − x, (x + y) / 2).
	/** Where world point `at` (raised by `lift`) is on the page, CSS px. */
	const screenOf = async (at, lift) => {
		const { cam, rect, k } = await drawnBy();
		// A place with no lift named is on the own player's terrace.
		lift ??= cam.lift;
		const dx = at.x - (cam.x + cam.view.w / 2);
		const dy = at.y - (cam.y + cam.view.h / 2);
		return {
			x: Math.round(rect.left + rect.width / 2 + (cam.shakeX + dy - dx) * k),
			// The camera is drawn down by its own player's ground lift, a place up by its own.
			y: Math.round(
				rect.top + rect.height / 2 + (cam.shakeY + cam.lift + (dx + dy) / 2 - lift) * k,
			),
		};
	};
	/** A finger's tap at a page point: down for one stepped frame, as a quick finger is for a few.
	 *  Returns how long it was down, ms (the shell steps slowly; a tap is one by its real length). */
	const tap = async (at) => {
		const down = Date.now();
		await touch('touchStart', [at]);
		await play([{ op: 'step', frames: 1 }]);
		await touch('touchEnd', []);
		const ms = Date.now() - down;
		tapMs.push(ms);
		await play([{ op: 'step', frames: 3 }]);
		return ms;
	};
	/** Where the page draws its own player (its predicted place, which these rooms' pages, drawing
	 *  another river than the room plays, may hold apart from the room's). */
	const ownScreen = async () => {
		const drawn = await online();
		return screenOf(drawn.drawn.find((d) => d.id === drawn.me));
	};
	/** The page point `px` CSS px from the own player along screen direction `dir`. */
	const fromOwn = async (dir, px) => {
		const at = await ownScreen();
		return { x: Math.round(at.x + dir.x * px), y: Math.round(at.y + dir.y * px) };
	};
	const events = async (type) => ((await online())?.events ?? []).filter((e) => e.type === type);
	const errors = () => page.evaluate('JSON.stringify(window.__AR_ERRORS__)').then(JSON.parse);
	const shot = async (name) => {
		writeFileSync(join(out, name), await page.screenshot());
		result.shots.push(name);
	};
	return {
		page,
		state,
		settle,
		online,
		own,
		heard,
		touch,
		tap,
		events,
		screenOf,
		ownScreen,
		fromOwn,
		errors,
		shot,
		play,
	};
}

/** The own player's place every `ms`, `n` times. */
async function track(game, n, ms = 300) {
	const places = [];
	for (let i = 0; i < n; i++) {
		await game.settle(ms);
		const at = await game.own();
		places.push({ x: Math.round(at.x), y: Math.round(at.y) });
	}
	return places;
}

const round = (at) => at && { x: Math.round(at.x), y: Math.round(at.y) };
const ROOMS = { salmon: FALLS_GAME, bear: BLOOD_GAME, fisherman: LINE_GAME };
/** World directions on the mirrored screen, as unit screen vectors: up the river is world −y. */
const SCREEN = {
	upstream: { x: -2 / Math.sqrt(5), y: -1 / Math.sqrt(5) },
	across: { x: -2 / Math.sqrt(5), y: 1 / Math.sqrt(5) },
};

async function repro() {
	for (const character of ['salmon', 'bear', 'fisherman']) {
		const game = await boot(
			character,
			character,
			ROOMS[character],
			character === 'salmon' ? snapFalls : snap,
		);
		await game.settle(600);
		const touchAction = await game.page.evaluate(
			'getComputedStyle(document.querySelector("canvas")).touchAction',
		);
		const measure = { touchAction };
		const finger = await game.fromOwn(character === 'bear' ? SCREEN.across : SCREEN.upstream, 120);
		const start = await game.own();
		await game.touch('touchStart', [finger]);
		measure.heldStill = { start: round(start), places: await track(game, 4) };
		measure.heardStill = await game.heard();
		// The same finger then drags 60 px in 6 moves, and stays down.
		for (let i = 1; i <= 6; i++) {
			await game.touch('touchMove', [{ x: finger.x, y: finger.y - i * 10 }]);
			await game.settle(60);
		}
		measure.heardDragged = await game.heard();
		measure.afterDrag = await track(game, 5);
		await game.touch('touchEnd', []);
		measure.errors = await game.errors();
		await game.shot(`repro-${character}.png`);
		result.measures[character] = measure;
		await game.page.close();
	}
}

async function salmon() {
	const game = await boot('salmon', 'salmon', FALLS_GAME, snapFalls);
	await game.settle(600);
	const me = (await game.online()).me;
	verdict(
		'the canvas of a game steered by touch keeps its touches (touch-action: none)',
		(await game.page.evaluate('getComputedStyle(document.querySelector("canvas")).touchAction')) ===
			'none',
	);
	// A hold, dragged about while it is down.
	const finger = await game.fromOwn(SCREEN.upstream, 110);
	const { k } = {
		k: (await game.state()).arcade.camera.scale * (await game.state()).arcade.camera.zoom,
	};
	const start = await game.own();
	await game.touch('touchStart', [finger]);
	await game.settle(200);
	// The other thumb taps while the first holds: a leap (well short of the waterfall, which a
	// leap clears), and the hold goes on. `touchEnd` lifts the points it names.
	const thumb = await game.fromOwn(SCREEN.upstream, 160);
	await game.touch('touchStart', [finger, thumb]);
	await game.play([{ op: 'step', frames: 1 }]);
	await game.touch('touchEnd', [{ ...thumb, id: 1 }]);
	await game.settle(200);
	for (let i = 1; i <= 8; i++) {
		await game.touch('touchMove', [
			{ x: finger.x + (i % 2 ? 14 : -14), y: finger.y - (i % 3) * 6 },
		]);
		await game.settle(120);
	}
	await game.touch('touchMove', [finger]);
	const held = await track(game, 4, 250);
	const heard = await game.heard();
	const after = held.at(-1);
	// The finger's own world distance from the player when it was put down.
	const reach = 110 / k;
	verdict(
		'the salmon: a finger held and dragged about is never cancelled by the browser',
		heard.pointerdown === 2 && !heard.pointercancel && heard.pointermove >= 8,
		heard,
	);
	let atFoot = after;
	for (let i = 0; i < 20 && Math.abs(atFoot.y - FOOT) >= 4; i++) {
		await game.settle(250);
		atFoot = round(await game.own());
	}
	verdict(
		'…it keeps swimming upstream for as long as the finger is down, through the other thumb’s tap, past where the finger was put, until the waterfall stops it',
		start.y - atFoot.y > reach &&
			Math.abs(atFoot.y - FOOT) < 4 &&
			held.every((at, i) => i === 0 || at.y <= held[i - 1].y),
		{ start: round(start), held, atFoot, reach: Math.round(reach), FOOT },
	);
	await game.shot('salmon-hold.png');
	await game.touch('touchEnd', []);
	await game.settle(300);
	const lifted = await track(game, 3, 250);
	verdict(
		'…lifted, it stops swimming: the current carries it back down',
		lifted.at(-1).y > atFoot.y + 5 && lifted.at(-1).y > lifted[0].y,
		{ atFoot, lifted },
	);
	const leapsOf = async () => (await game.events('jumped')).filter((e) => e.id === me).length;
	const thumbLeaps = await leapsOf();
	verdict('…the other thumb’s tap was a leap; the lift of the hold is none', thumbLeaps === 1, {
		thumbLeaps,
	});
	// Tap to head: across the river, with no finger down after it. Away from the waterfall's foot,
	// where a tap is a climb tap and the room holds the salmon for it.
	for (let i = 0; i < 30 && (await game.own()).y < FOOT + 150; i++) await game.settle(300);
	const before = await game.own();
	const acrossSign = before.x < (BELOW.left + BELOW.right) / 2 ? 1 : -1;
	const side = { x: SCREEN.across.x * acrossSign, y: SCREEN.across.y * acrossSign };
	await game.touch('touchStart', [await game.fromOwn(side, 120)]);
	await game.play([{ op: 'step', frames: 1 }]);
	await game.touch('touchEnd', []);
	const headed = await track(game, 3, 250);
	verdict(
		'a tap sets a heading the salmon keeps with no finger down',
		(headed.at(-1).x - before.x) * acrossSign > 80 &&
			(headed.at(-1).x - headed[0].x) * acrossSign > 30,
		{ before: round(before), headed },
	);
	const leaps = await leapsOf();
	verdict('…and the same tap is its leap', leaps === thumbLeaps + 1, { leaps });
	await game.tap(await game.ownScreen());
	// That tap is a leap too (in place: the way it last swam), which carries it for a second.
	await game.settle(1600);
	const stoppedAt = await game.own();
	const stopped = await track(game, 3, 250);
	verdict(
		'a tap on itself stops it',
		stopped.every((at) => Math.abs(at.x - stoppedAt.x) < 20),
		{ stoppedAt: round(stoppedAt), stopped },
	);
	// Upstream by taps alone: each sets the heading and is a leap, and at the waterfall's foot a
	// climb tap, so they take it to the waterfall, up it, and on over the top.
	let climbed;
	let over;
	let footSeen = false;
	for (let i = 0; i < 60 && !(over && over.y < FALL.y); i++) {
		await game.tap(await game.fromOwn(SCREEN.upstream, 130));
		await game.settle(300);
		over = await game.own();
		footSeen ||= Math.abs(over.y - FOOT) < 6;
		if (footSeen && !climbed) await game.shot('salmon-at-the-waterfall.png');
		climbed ??= (await game.events('climbed')).find((e) => e.id === me);
	}
	verdict(
		'taps upstream take it to the waterfall, climb it, and the heading takes the salmon on over the top',
		!!climbed && !!over && over.y < FALL.y,
		{ climbed, footSeen, over: round(over), fall: FALL.y },
	);
	await game.shot('salmon-over-the-waterfall.png');
	verdict('the salmon’s page: no error', (await game.errors()).length === 0, await game.errors());
	await game.page.close();
}

async function fisherman() {
	const fisher = await boot('fisher', 'fisherman', LINE_GAME);
	const fish = await boot('fish', 'salmon', LINE_GAME);
	await fisher.settle(600);
	await fish.settle(600);
	const meF = (await fisher.online()).me;
	const meS = (await fish.online()).me;
	const stood = await fisher.own();
	// A tap on the salmon: the cast lands there and hooks it; the tap does not walk him off.
	let hooked = false;
	for (let attempt = 0; attempt < 3 && !hooked; attempt++) {
		const target = (await fisher.online()).drawn.find((d) => d.id === meS);
		if (!target) break;
		await fisher.tap(await fisher.screenOf(target, target.ground ?? 0));
		for (let i = 0; i < 60 && !hooked; i++) {
			await fisher.play([{ op: 'step', frames: 2 }]);
			hooked = !!(await fisher.online()).lines?.some((l) => l.by === meF && l.target === meS);
			await fish.play([{ op: 'step', frames: 2 }]);
		}
	}
	const afterCast = await fisher.own();
	verdict('the fisherman: a tap on the salmon casts there and hooks it', hooked, {
		lines: (await fisher.online()).lines,
		lineLog: (await fisher.online()).lineLog,
	});
	verdict(
		'…and the tap does not walk him off his spot',
		Math.hypot(afterCast.x - stood.x, afterCast.y - stood.y) < 30,
		{ stood: round(stood), afterCast: round(afterCast) },
	);
	await fisher.shot('fisherman-cast.png');
	let landed;
	for (let i = 0; i < 40 && !landed; i++) {
		await fisher.settle(150);
		await fish.settle(50);
		landed = (await fisher.events('caught')).find((e) => e.target === meS);
	}
	verdict('…reeled in and landed', !!landed, { landed });
	// A hold walks him along the bank; lifting stops him.
	const finger = await fisher.fromOwn(SCREEN.upstream, 120);
	const walkFrom = await fisher.own();
	await fisher.touch('touchStart', [finger]);
	await fisher.settle(300);
	for (let i = 1; i <= 6; i++) {
		await fisher.touch('touchMove', [{ x: finger.x + (i % 2 ? 12 : -12), y: finger.y }]);
		await fisher.settle(120);
	}
	const walked = await track(fisher, 3, 250);
	const heard = await fisher.heard();
	verdict(
		'the fisherman: a held, dragged finger walks him for as long as it is down, never cancelled',
		!heard.pointercancel && walkFrom.y - walked.at(-1).y > 80 && walked.at(-1).y < walked[0].y,
		{ walkFrom: round(walkFrom), walked, heard },
	);
	await fisher.touch('touchEnd', []);
	await fisher.settle(300);
	const rest = await track(fisher, 2, 250);
	verdict(
		'…lifted, he stops',
		Math.abs(rest[1].y - rest[0].y) < 2 && Math.abs(rest[1].x - rest[0].x) < 2,
		rest,
	);

	// The salmon's page: its death screen's Respawn, pressed by a finger.
	let screen;
	for (let i = 0; i < 40 && !screen?.buttons; i++) {
		await fish.settle(150);
		screen = (await fish.online()).screens?.caught;
	}
	const leapsBefore = (await fish.events('jumped')).filter((e) => e.id === meS).length;
	if (screen?.buttons) {
		const rect = JSON.parse(
			await fish.page.evaluate(
				'JSON.stringify(document.querySelector("canvas").getBoundingClientRect())',
			),
		);
		const at = (b) => ({ x: Math.round(rect.left + b.x), y: Math.round(rect.top + b.y) });
		await fish.tap(at(screen.buttons.salmon));
		await fish.tap(at(screen.buttons.respawn));
	}
	let back = false;
	for (let i = 0; i < 40 && !back; i++) {
		await fish.settle(150);
		const online = await fish.online();
		back = online.drawn.some((d) => d.id === meS) && !online.hidden?.includes(meS);
	}
	verdict(
		'the salmon’s death screen: a finger on Respawn brings it back',
		!!screen?.buttons && back,
		{
			buttons: screen?.buttons,
			back,
		},
	);
	await fish.shot('salmon-respawned.png');
	const backAt = await fish.own();
	const stays = await track(fish, 3, 250);
	verdict(
		'…and that touch neither leaps nor leaves a heading',
		(await fish.events('jumped')).filter((e) => e.id === meS).length === leapsBefore &&
			stays.every((at) => Math.hypot(at.x - backAt.x, at.y - backAt.y) < 40),
		{ backAt: round(backAt), stays },
	);
	for (const [name, page] of [
		['fisherman', fisher],
		['hooked salmon', fish],
	])
		verdict(
			`the ${name}’s page: no error`,
			(await page.errors()).length === 0,
			await page.errors(),
		);
	await fisher.page.close();
	await fish.page.close();
}

async function bear() {
	const game = await boot('bear', 'bear', BLOOD_GAME);
	const prey = await boot('prey', 'salmon', BLOOD_GAME);
	await game.settle(600);
	const meP = (await prey.online()).me;
	// A swipe lands a tile ahead of the bear's last move: a short hold towards the water (world +x,
	// which stops it at the bank's edge) turns it there. Then taps swipe, each one press, until the
	// salmon the current carries past is caught.
	const stood = await game.own();
	await game.touch('touchStart', [await game.fromOwn(SCREEN.across, 120)]);
	await game.settle(200);
	await game.touch('touchEnd', []);
	await game.settle(200);
	const swipesBefore = (await game.online()).signals.filter((sig) => sig.name === 'ability').length;
	let caught;
	let taps = 0;
	for (; taps < 40 && !caught; taps++) {
		await game.tap(await game.ownScreen());
		await game.settle(150);
		await prey.settle(50);
		caught = (await game.events('caught')).find((e) => e.target === meP);
	}
	const swipes = (await game.online()).signals.filter((sig) => sig.name === 'ability').length;
	verdict('the bear: each tap swipes', swipes > swipesBefore, { swipesBefore, swipes, taps });
	verdict('…and a swipe catches the salmon carried past', !!caught, { caught, taps });
	const swiped = await game.own();
	verdict('…the taps did not walk it', Math.hypot(swiped.x - stood.x, swiped.y - stood.y) < 30, {
		stood: round(stood),
		swiped: round(swiped),
	});
	// Along its bank, upstream: a hold walks it, lifting stops it.
	const start = await game.own();
	const finger = await game.fromOwn(SCREEN.upstream, 120);
	await game.touch('touchStart', [finger]);
	await game.settle(200);
	for (let i = 1; i <= 4; i++) {
		await game.touch('touchMove', [{ x: finger.x + (i % 2 ? 12 : -12), y: finger.y }]);
		await game.settle(120);
	}
	const walked = await game.own();
	const heard = await game.heard();
	verdict(
		'the bear: a held, dragged finger walks it, never cancelled',
		!heard.pointercancel && start.y - walked.y > 40,
		{ start: round(start), walked: round(walked), heard },
	);
	await game.touch('touchEnd', []);
	await game.settle(300);
	const rest = await track(game, 2, 250);
	verdict('…lifted, it stops', Math.hypot(rest[1].x - rest[0].x, rest[1].y - rest[0].y) < 2, rest);
	await game.shot('bear-swipe.png');
	verdict('the bear’s page: no error', (await game.errors()).length === 0, await game.errors());
	await game.page.close();
	await prey.page.close();
}

try {
	if (opt.repro) await repro();
	else
		for (const [name, play] of Object.entries({ salmon, fisherman, bear }))
			if (!opt.only || opt.only === name) await play();
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	server.stop();
	await rooms.close();
	await snap.close();
	await snapFalls.close();
	rmSync(work, { recursive: true, force: true });
}
const failed = result.verdicts.filter((v) => !v.ok);
for (const v of result.verdicts) console.log(`${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
if (opt.repro || opt.only) console.log(JSON.stringify(result.measures));
console.log(
	`salmons-touch-play (${opt.netcode}) — ${result.verdicts.length - failed.length} / ${result.verdicts.length}`,
);
process.exit(failed.length ? 1 : 0);
