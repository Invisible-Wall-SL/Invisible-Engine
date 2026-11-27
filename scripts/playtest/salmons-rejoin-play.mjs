// SALMONS: ANOTHER ROOM ON THE SAME PAGE (owner, 2026-11-25: "when I finish a game and click join
// new room, the game restarts from the loading screen, I would expect to be in a room already"),
// in a headless shell against a real game server on localhost. The game is the exported one
// (`salmonsMap`, random seeds) with a lobby one person starts (a countdown of 5 s) and no bots.
//
// Page `jo` (a salmon) plays three games, one after the other, on ONE document. In each the room
// stands its salmon in the source (the server runs in this process), so it wins; the win screen's
// "Join New Game" is clicked; and the page must then, without loading again (a mark on its window
// is still there, its document count is still 1): have left its room and be in another, with
// another seed; show that room's lobby and countdown and neither the win screen nor the loading
// screen; say who it plays on the lobby's note; have made and drawn the NEW room's level (its
// zones, the room's fingerprint, its rocks in the art) with the old river destroyed; hold nothing
// of the old game (no `gameWon` among its events, one instance spawned, a flow whose `phase` is
// the room's); be golden (the winner's pass followed it); start round 1 when the countdown ends;
// and swim on ArrowUp, predicted, the camera on it. After each switch the page's JS heap (after a
// collection), its display objects (on the stage, and alive in the heap), its textures and its
// sockets alive are read: reported, not judged. Sockets that grow by one a switch are old
// sessions still held.
//
// THE NEXT GAME BY ITSELF (owner, 2026-11-26: "it should starts automatically"): `jo` played each
// round (keys), so its win screen counts "Next game in N" from 10 over the button, clear of the
// title and the button; switches 1 and 2 are a click while it counts (the count goes, the button
// reads "Joining…" at once), and switch 3 is no click at all: the page joins the next game when
// the count reaches 0. In a room of two (`salmons-pair`, a lobby that waits for both), `ida`
// joins first and never touches the game, and `al` (a 390 × 844 portrait window) wins: ida's
// screen counts nothing and is still in its room long after 10 s; al's counts, and its page is
// hidden while it does: the count stops, the page stays past 10 s hidden and after it is shown
// again, and only its button then joins it, at once; ida's button joins it at once too.
//
// Page `fay` plays four switches that fail, one after the other: a join the server refuses (the
// page's matchmaking request is refused), a join that never answers (the win screen's button must
// read "Joining…" meanwhile), something thrown in the swap itself, and art that does not load for
// the new room. Each must end with the page loaded again and the person in a new room's lobby as
// they were (Fay, a salmon; golden while the pass was not spent), with no start menu, the kept
// join spent and the reason said on the console: never on a win screen with nothing to press. Its
// launch names no character, so only a kept join spares it the start menu.
//
// Page `tim` runs on the real clock (no `ie_determinism`), so its times are a player's: from the
// click on "Join New Game" to the first frame that shows the new room's lobby and to the first
// whose stage holds the river's art, with the join's steps between. `--timing` plays only this
// page and takes any runtime, so the same numbers can be read off a build that still reloads.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-rejoin-play.mjs --runtime apps/lines/build --out <dir> \
//     [--chrome <exe>] [--netcode engine|colyseus] [--timing]
//
// The runtime must play arcade: build it with
// `PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build`. Exit 1 when a verdict fails.
// Every page boots with `runtime=1` (the snapshot is its game). `--baked` boots without it, as a
// standalone build does, on a runtime with this game baked in (no timing page): make one with
// `--write-bundle apps/lines/src/baked-editor-bundle.json`, build, copy the build out and put the
// file back; such a bundle is written for one `--netcode` and is never committed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

import { salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import {
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, withSlide } from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { matchMaker } = await import(
	pathToFileURL(
		createRequire(join(ROOT, 'services/game-server/package.json')).resolve('@colyseus/core'),
	).href
);
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/salmons-rejoin-play') },
		chrome: { type: 'string' },
		netcode: { type: 'string', default: 'engine' },
		timing: { type: 'boolean', default: false },
		baked: { type: 'boolean', default: false },
		'write-bundle': { type: 'string' },
	},
});
if (opt.netcode !== 'engine' && opt.netcode !== 'colyseus') {
	console.error(`--netcode is engine or colyseus, not "${opt.netcode}"`);
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });

const result = { verdicts: [], measures: {} };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), 'salmons-rejoin-play-'));

const KEY = 'salmons';
/** A game whose lobby waits for two people (the idle page and the winner share a room). */
const PAIR_GAME = 'salmons-pair';
const COUNTDOWN_SECONDS = 5;
/** How long the win screen counts before it joins by itself (`salmonsArt/winAnimation.ts`). */
const NEXT_GAME_SECONDS = 10;
const river = salmonsMapRiver(SALMONS_MAP_SEED);
const authored = salmonsConfig(river);
authored.arcade.online.netcode = opt.netcode;
authored.arcade.online.rules.lobby = {
	minPlayers: 1,
	maxWaitSeconds: 600,
	countdownSeconds: COUNTDOWN_SECONDS,
};
delete authored.arcade.online.bots;
// The slide is carried past the normalizer, which drops it, as a publish carries it.
const config = withSlide(normalizeGameConfigDoc(authored), authored);
const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const bundle = { doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC };
if (opt['write-bundle']) {
	writeFileSync(resolve(opt['write-bundle']), `${JSON.stringify(bundle, null, '\t')}\n`);
	rmSync(work, { recursive: true, force: true });
	process.exit(0);
}
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(join(snapshot, 'runtime.json'), JSON.stringify(bundle));
const configs = join(work, 'configs');
mkdirSync(configs);
writeFileSync(join(configs, `${KEY}.json`), JSON.stringify(config));
const pair = structuredClone(config);
pair.arcade.online.rules.lobby = {
	minPlayers: 2,
	maxWaitSeconds: 600,
	countdownSeconds: COUNTDOWN_SECONDS,
};
writeFileSync(join(configs, `${PAIR_GAME}.json`), JSON.stringify(pair));

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
const roomsUrl = `ws://127.0.0.1:${roomsPort}`;
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 16,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

/** Each document counts itself, so a page that loaded again says so. Until the document goes,
 *  `__ptRefuseJoins` refuses the page's matchmaking requests, `__ptStallJoins` never answers them,
 *  `__ptSlowJoins` sends them that many ms late (so what the win screen shows meanwhile is read),
 *  and `__ptFailArt` fails the art's load (its first step waits on a list of the project's sheets,
 *  none here: an empty `Promise.all`). */
const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
	sessionStorage.setItem('pt:docs', String(Number(sessionStorage.getItem('pt:docs') || 0) + 1));
	const net = (window.__ptNet = []);
	const fetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		const url = typeof input === 'string' ? input : (input.url ?? String(input));
		if (!url.includes('/matchmake/')) return fetch(input, init);
		if (window.__ptRefuseJoins) return Promise.reject(new TypeError('Failed to fetch'));
		if (window.__ptStallJoins) return new Promise(() => {});
		if (window.__ptSlowJoins)
			return new Promise((r) => setTimeout(r, window.__ptSlowJoins)).then(() => fetch(input, init));
		net.push(['matchmake', Date.now()]);
		return fetch(input, init).finally(() => net.push(['seat', Date.now()]));
	};
	if (!location.search.includes('ie_determinism')) {
		// A page on the real clock notes each frame, what the flow shows when that changes and,
		// while it is watched (pt:watch), the first frame whose stage holds the river's art (the
		// forest's trees are sprites).
		let shown = '';
		let art = false;
		const trees = (node) =>
			(String(node.texture?.label ?? '').startsWith('tree_') ? 1 : 0) +
			(node.children ?? []).reduce((count, child) => count + trees(child), 0);
		const frame = () => {
			net.push(['frame', Date.now()]);
			const now = (window.__IE_FLOW_V2__?.ordered() ?? []).map((c) => c.id).join(' ');
			if (now !== shown) net.push(['shown', Date.now(), now]);
			shown = now;
			const app = globalThis.__PIXI_APP__;
			const watched = !!sessionStorage.getItem('pt:watch');
			const river = /basegame/.test(now) && !/loading|salmonsWon/.test(now);
			if (!watched) art = false;
			else if (!art && app && river && trees(app.stage) > 50) {
				art = true;
				net.push(['art', Date.now()]);
			}
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	}
	const all = Promise.all.bind(Promise);
	Promise.all = (list) =>
		window.__ptFailArt && Array.isArray(list) && list.length === 0
			? Promise.reject(new Error('pt: no art'))
			: all(list);
	const Socket = window.WebSocket;
	window.WebSocket = class extends Socket {
		constructor(...args) {
			super(...args);
			this.addEventListener('open', () => net.push(['socket', Date.now()]));
			this.addEventListener('message', () => net.push(['state', Date.now()]), { once: true });
			this.addEventListener('close', () => net.push(['closed', Date.now()]));
		}
	};
})();`;
const NEXT_JOIN_KEY = 'ie:rooms:next-join';

/**
 * Open a page on the game. A `null` in `extra` takes a launch parameter away; `carried` is a join
 * the page finds kept for it (`online.ts` `takeNextJoin`), seeded once.
 */
async function open(profile, extra = {}, carried = undefined) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.page('Performance.enable');
	if (carried) {
		const kept = JSON.stringify({ server: roomsUrl, game: KEY, ...carried });
		await page.page('Page.addScriptToEvaluateOnNewDocument', {
			source: `if (!sessionStorage.getItem('pt:seeded')) { sessionStorage.setItem('pt:seeded', '1'); sessionStorage.setItem(${JSON.stringify(NEXT_JOIN_KEY)}, ${JSON.stringify(kept)}); }`,
		});
	}
	const params = new URLSearchParams({
		...(opt.baked ? {} : { runtime: '1', k: 'rejoin-play', editorDocBase: snap.origin }),
		project: KEY,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: roomsUrl,
		rooms_character: 'salmon',
	});
	for (const [k, v] of Object.entries(extra))
		if (v === null) params.delete(k);
		else params.set(k, v);
	const url = `${server.origin}/${KEY}/?${params}`;
	await page.navigate(url);
	return { page, url };
}

/** The game on an opened page under the probe's clock, once it is loaded and started. */
async function ready({ page, url }) {
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
	const state = () => page.evaluate('window.__IE_DETERMINISM__.state()');
	const settle = async (ms) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			await play([{ op: 'step', frames: 6 }]);
			await wait(50);
		}
	};
	const online = async () => (await state()).arcade?.online ?? {};
	/** The page's online probe once `test` holds of it, or as it is after `tries` looks. */
	const when = async (test, tries = 60) => {
		let now = await online();
		for (let i = 0; i < tries && !test(now); i++) {
			await settle(150);
			now = await online();
		}
		return now;
	};
	const key = async (name, type) => {
		for (const code of name === 'ArrowUp' ? ['ArrowUp', 'ArrowLeft'] : [name])
			await page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: code === 'Space' ? ' ' : code,
				code,
				windowsVirtualKeyCode: { ArrowLeft: 37, ArrowUp: 38, Space: 32 }[code],
			});
	};
	return { page, url, play, state, settle, online, when, key };
}

/** The flow's containers on screen, bottom first; empty while the page has no flow. */
const shownOn = (page) =>
	page.evaluate(
		'(() => { const f = window.__IE_FLOW_V2__; return f ? f.ordered().map((c) => c.id) : []; })()',
	);
/** A flow variable as the page's flow has it. */
const variableOn = (page, id) =>
	page.evaluate(`window.__IE_FLOW_V2__?.state?.read(${JSON.stringify(id)})`);
/** What a document keeps and a new one does not: a mark on its window, and how many documents the
 *  tab has loaded. */
const documentOf = async (page) =>
	JSON.parse(
		await page.evaluate(
			`JSON.stringify({ mark: window.__ptMark ?? null, docs: Number(sessionStorage.getItem('pt:docs')) })`,
		),
	);
/** Click a page's canvas at a point of its stage, as a mouse does. */
const clickCanvas = async (page, at) => {
	const rect = JSON.parse(
		await page.evaluate('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'),
	);
	const point = { x: Math.round(rect.left + at.x), y: Math.round(rect.top + at.y) };
	await page.page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
	for (const type of ['mousePressed', 'mouseReleased'])
		await page.page('Input.dispatchMouseEvent', {
			type,
			...point,
			button: 'left',
			buttons: type === 'mousePressed' ? 1 : 0,
			clickCount: 1,
		});
};

/** The room holding the session `id`, as the server has it. */
const roomWith = async (id) => {
	for (const listed of await matchMaker.query({})) {
		const room = matchMaker.getLocalRoomById(listed.roomId);
		if (room?.sim?.players.has(id)) return room;
	}
	return undefined;
};
/** The room and session of the person named `name`. */
const roomOfName = async (name) => {
	for (const listed of await matchMaker.query({})) {
		const room = matchMaker.getLocalRoomById(listed.roomId);
		for (const player of room?.sim?.players.values() ?? [])
			if (!player.bot && player.name === name && !room.sim.rules.winner)
				return { room, id: player.id };
	}
	return undefined;
};
/** Have a room stand its player `id` in the middle of the source: the goal. */
const standInSource = (room, id) => {
	const source = room.sim.game.zones.find((zone) => zone.id === 'source');
	Object.assign(room.sim.players.get(id).body, {
		x: source.x + source.w / 2,
		y: source.y + source.h / 2,
	});
};

/** What the page holds alive: its display objects on the stage, its textures on the GPU (and
 *  their size as RGBA, MB), and its JS heap after a collection, MB. */
const heldBy = async (page) => {
	const drawn = JSON.parse(
		await page.evaluate(`(() => {
			const app = globalThis.__PIXI_APP__;
			let objects = 0;
			const walk = (node) => {
				objects += 1;
				for (const child of node.children ?? []) walk(child);
			};
			walk(app.stage);
			// A destroyed source leaves an empty place in the renderer's list.
			const sources = (app.renderer.texture.managedTextures ?? []).filter(Boolean);
			return JSON.stringify({
				objects,
				textures: sources.length,
				textureMB:
					Math.round(sources.reduce((px, t) => px + t.pixelWidth * t.pixelHeight, 0) / 26214.4) / 10,
			});
		})()`),
	);
	// Every object of a kind the heap still holds, on the stage or not: a display object (or a
	// socket) left behind by a room that is gone counts here and not above. The inspector's own
	// hold on what it lists would keep every one of them alive, so it is let go.
	const aliveOf = async (expression) => {
		const prototype = await page.page('Runtime.evaluate', { expression });
		const listed = await page.page('Runtime.queryObjects', {
			prototypeObjectId: prototype.result?.result?.objectId,
		});
		const counted = await page.page('Runtime.callFunctionOn', {
			objectId: listed.result?.objects?.objectId,
			functionDeclaration: 'function () { return this.length; }',
			returnByValue: true,
		});
		for (const objectId of [listed.result?.objects?.objectId, prototype.result?.result?.objectId])
			if (objectId) await page.page('Runtime.releaseObject', { objectId });
		return counted.result?.result?.value ?? null;
	};
	const objectsAlive = await aliveOf('Object.getPrototypeOf(globalThis.__PIXI_APP__.stage)');
	const socketsAlive = await aliveOf('WebSocket.prototype');
	await page.page('HeapProfiler.collectGarbage');
	const { result: metrics } = await page.page('Performance.getMetrics');
	const heap = (metrics?.metrics ?? []).find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
	return {
		heapMB: Math.round(heap / 1e5) / 10,
		...drawn,
		objectsAlive,
		socketsAlive,
	};
};

const zonesOf = (game) => game.zones.map((z) => [z.id, z.x, z.y, z.w, z.h]);

/** Win the game on `game`'s page (its room stands its salmon in the source) and return the win
 *  screen once its button is drawn. */
async function win(game) {
	const before = await game.when((o) => o.phase === 'running', 120);
	const room = await roomWith(before.me);
	// Only a free salmon wins: one the delta's sand grounded is jumped off it (Space) first.
	let won = before;
	for (let i = 0; i < 40 && !(won.events ?? []).some((e) => e.type === 'gameWon'); i++) {
		if (room) standInSource(room, before.me);
		await game.key('Space', 'down');
		await game.settle(150);
		await game.key('Space', 'up');
		await game.settle(150);
		won = await game.online();
	}
	const screen = (await game.when((o) => o.screens?.won?.button && o.screens.won.eggs > 0)).screens
		?.won;
	return {
		before,
		room,
		won: (won.events ?? []).find((e) => e.type === 'gameWon'),
		pass: (won.events ?? []).some((e) => e.type === 'winnerPass'),
		screen,
	};
}

/** The texts drawn on a page's stage now (each visible, with every parent). */
const textsOn = (page) =>
	page.evaluate(`(() => {
		const texts = [];
		const walk = (node) => {
			if (!node.visible) return;
			if (typeof node.text === 'string' && node.text) texts.push(node.text);
			for (const child of node.children ?? []) walk(child);
		};
		if (globalThis.__PIXI_APP__) walk(globalThis.__PIXI_APP__.stage);
		return texts;
	})()`);
/** Whether a page's stage shows the win screen joining: "Joining…" and no "Next game in". */
const joiningOn = (texts) =>
	!!texts?.includes('Joining…') && !texts.some((text) => text.startsWith('Next game in'));

/** How late a join is sent while the win screen is watched, ms. */
const SLOW_JOIN_MS = 1500;

/**
 * Click the win screen's button (none: let its count run out) and step the page until it is
 * another session's, or gives up. `pressed` is the texts the page draws a frame after the click;
 * `counted` the seconds "Next game in" showed, in order, until the page joined.
 */
async function joinNew(game, was, button) {
	await game.page.evaluate(`window.__ptSlowJoins = ${SLOW_JOIN_MS}`);
	let pressed;
	if (button) {
		await clickCanvas(game.page, button);
		await game.play([{ op: 'step', frames: 1 }]);
		pressed = await textsOn(game.page);
	}
	const counted = [];
	let joining = false;
	let now = {};
	for (let i = 0; i < 400 && !(now.me && now.me !== was.me); i++) {
		await game.play([{ op: 'step', frames: 6 }]).catch(() => {});
		await wait(50);
		now = await game.online().catch(() => ({}));
		const screen = now.me === was.me ? now.screens?.won : undefined;
		if (typeof screen?.next === 'number' && counted.at(-1) !== screen.next)
			counted.push(screen.next);
		// From the press the page is in no room (the probe has no session) until the new one.
		if (!now.me && (await textsOn(game.page).catch(() => [])).includes('Joining…')) joining = true;
	}
	await game.page.evaluate('window.__ptSlowJoins = 0').catch(() => {});
	return { now, pressed, counted, joining };
}

/** Whether two boxes on the canvas overlap. */
const overlap = (a, b) =>
	!!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Whether the win screen's "Next game in" is drawn inside a `w` × `h` canvas, clear of its title,
 *  subtitle and button. */
const countClear = (screen, w, h) => {
	const { next, title, subtitle, button } = screen?.boxes ?? {};
	return (
		!!next &&
		next.x >= 0 &&
		next.y >= 0 &&
		next.x + next.w <= w &&
		next.y + next.h <= h &&
		![title, subtitle, button].some((box) => overlap(next, box))
	);
};

/** One game won on page `jo` and the room after it: the verdicts of switch `n`, left by a click
 *  on the button, or by the win screen's count (`auto`). */
async function switchVerdicts(game, n, auto) {
	const tag = `switch ${n}`;
	const { before, room: oldRoom, won, pass, screen } = await win(game);
	verdict(
		`${tag}: the salmon wins its room: “You Won!”, a pass, and the button`,
		won?.winner === before.me && pass && screen?.title === 'You Won!' && !!screen?.button,
		{ won, pass, screen },
	);
	if (!screen?.button) return;
	verdict(
		`${tag}: it played the round, so “Next game in N” counts from ${NEXT_GAME_SECONDS} over the button, inside the window and clear of the title and the button`,
		screen.count === 'running' &&
			screen.next <= NEXT_GAME_SECONDS &&
			screen.next >= NEXT_GAME_SECONDS - 3 &&
			countClear(screen, 1280, 720),
		{ count: screen.count, next: screen.next, boxes: screen.boxes },
	);
	if (n === 1) writeFileSync(join(out, 'win-count-landscape.png'), await game.page.screenshot());
	await game.page.evaluate(`window.__ptMark = ${n}`);
	const docsBefore = (await documentOf(game.page)).docs;
	const {
		now: joined,
		pressed,
		counted,
		joining,
	} = await joinNew(game, before, auto ? undefined : screen.button);
	if (auto)
		verdict(
			`${tag}: no click: the count runs down to 1, the button reads “Joining…” and the page joins the next game by itself`,
			counted.length >= NEXT_GAME_SECONDS - 3 &&
				counted.every((s, i) => i === 0 || s === counted[i - 1] - 1) &&
				counted.at(-1) === 1 &&
				joining &&
				!!joined.me &&
				joined.me !== before.me,
			{ counted, joining, me: [before.me, joined.me] },
		);
	else
		verdict(
			`${tag}: the click joins at once while it counts: the button reads “Joining…” the next frame and the count is gone`,
			joiningOn(pressed) && counted.length === 0 && !!joined.me && joined.me !== before.me,
			{ pressed, counted },
		);
	const shownAtOnce = await shownOn(game.page);
	// The swap is made between two frames: the next one is the first the new room is drawn in.
	await game.play([{ op: 'step', frames: 1 }]);
	const firstFrame = await game.state();
	const artAtOnce = !!firstFrame.arcade?.online?.art;
	writeFileSync(join(out, `switch-${n}-at-once.png`), await game.page.screenshot());
	const kept = await documentOf(game.page);
	verdict(
		`${tag}: the page did not load again (its mark is there, still one document)`,
		kept.mark === n && kept.docs === docsBefore && kept.docs === 1,
		{ kept, docsBefore },
	);
	const room = joined.me ? await roomWith(joined.me) : undefined;
	verdict(
		`${tag}: it has left its room and is in another, of another seed`,
		!!room &&
			!!oldRoom &&
			room.roomId !== oldRoom.roomId &&
			!oldRoom.sim.players.has(before.me) &&
			joined.seed === room.sim.seed &&
			joined.seed !== before.seed,
		{ rooms: [oldRoom?.roomId, room?.roomId], seeds: [before.seed, joined.seed] },
	);
	verdict(
		`${tag}: at once it shows the river and that room's lobby, and neither the win screen nor the loading screen`,
		shownAtOnce.includes('basegame') &&
			shownAtOnce.includes('salmonsLobby') &&
			!shownAtOnce.includes('salmonsWon') &&
			!shownAtOnce.includes('loading') &&
			joined.phase === 'waiting',
		{ shown: shownAtOnce, phase: joined.phase, art: artAtOnce },
	);
	// The old room's camera stood on the source; the new room puts the salmon at the river's foot.
	const firstCamera = firstFrame.arcade?.camera;
	const firstOwn = firstFrame.arcade?.online?.drawn?.find(
		(d) => d.id === firstFrame.arcade.online.me,
	);
	verdict(
		`${tag}: its first frame is drawn from the new room's place: the camera is on the own salmon there`,
		!!firstCamera &&
			!!firstOwn &&
			Math.hypot(
				firstCamera.x + firstCamera.view.w / 2 - firstOwn.x,
				firstCamera.y + firstCamera.view.h / 2 - firstOwn.y,
			) < Math.max(firstCamera.view.w, firstCamera.view.h),
		{ camera: firstCamera, own: firstOwn },
	);
	const drawn = await game.when((o) => !!o.art && o.screens?.lobby?.shown === true, 120);
	writeFileSync(join(out, `switch-${n}-lobby.png`), await game.page.screenshot());
	const note = drawn.screens?.lobby;
	verdict(
		`${tag}: the lobby's note says who the page plays, in a river of one`,
		note?.shown === true &&
			note.you === 'You are Jo, a Salmon' &&
			/^1 player in .+ River$/.test(note.river ?? '') &&
			drawn.screens.won?.shown === false,
		{ note, won: drawn.screens?.won },
	);
	const sim = room?.sim;
	const regions = drawn.art?.regions ?? {};
	const sum = (prefix) =>
		Object.entries(regions)
			.filter(([region]) => region.startsWith(prefix))
			.reduce((count, [, c]) => count + c, 0);
	verdict(
		`${tag}: the level made and drawn is the new room's (its zones, its fingerprint, its rocks in the art)`,
		!!sim &&
			isDeepStrictEqual(drawn.zones, zonesOf(sim.game)) &&
			!isDeepStrictEqual(drawn.zones, before.zones) &&
			/^[0-9a-f]{16}$/.test(room.state.levelHash ?? '') &&
			drawn.level?.levelHash === room.state.levelHash &&
			drawn.level.roomLevelHash === room.state.levelHash &&
			sum('rock_') === sim.made.rocks.length &&
			sum('whirlpool_') === sim.made.whirlpools.length * 4,
		{
			level: drawn.level,
			roomLevelHash: room?.state.levelHash,
			zones: [drawn.zones?.length, sim?.game.zones.length],
			rocks: [sum('rock_'), sim?.made.rocks.length],
		},
	);
	const fieldArt = (await game.state()).arcade?.fieldArt;
	verdict(
		`${tag}: one river is drawn, the new one (the old one's pieces are destroyed with it)`,
		fieldArt?.live === 1 && fieldArt.destroyed === false,
		fieldArt,
	);
	verdict(
		`${tag}: nothing of the old game is held: no win among its events or signals, one instance spawned, the flow's phase the room's`,
		!(drawn.events ?? []).some((e) => e.type === 'gameWon' || e.type === 'winnerPass') &&
			!(drawn.signals ?? []).some((s) => s.name === 'gameWon') &&
			drawn.spawned?.length === 1 &&
			drawn.drawn?.length === 1 &&
			drawn.winner === '' &&
			(await variableOn(game.page, 'phase')) === 'waiting',
		{
			events: (drawn.events ?? []).map((e) => e.type),
			spawned: drawn.spawned,
			winner: drawn.winner,
			phase: await variableOn(game.page, 'phase'),
		},
	);
	const running = await game.when((o) => o.phase === 'running', 120);
	const shownRunning = await shownOn(game.page);
	verdict(
		`${tag}: the countdown ends, round 1 starts and the lobby goes`,
		running.phase === 'running' &&
			running.round === 1 &&
			shownRunning.includes('basegame') &&
			!shownRunning.includes('salmonsLobby') &&
			!shownRunning.includes('salmonsCountdown'),
		{ phase: running.phase, round: running.round, shown: shownRunning },
	);
	const golden = await game.when(
		(o) => (o.marked ?? []).includes(o.me) && o.art?.looks?.[o.me]?.region === 'salmon_golden',
		20,
	);
	verdict(
		`${tag}: the winner's pass followed it: its salmon is golden`,
		(golden.marked ?? []).includes(golden.me) &&
			golden.art?.looks?.[golden.me]?.region === 'salmon_golden',
		{ marked: golden.marked, look: golden.art?.looks?.[golden.me]?.region },
	);
	const own = (o) => o.drawn?.find((d) => d.id === o.me);
	const from = own(running);
	// Space tapped as it swims: the delta's sand grounds a salmon until it jumps.
	await game.key('ArrowUp', 'down');
	for (let i = 0; i < 4; i++) {
		await game.key('Space', 'down');
		await game.settle(250);
		await game.key('Space', 'up');
		await game.settle(250);
	}
	await game.key('ArrowUp', 'up');
	const moved = await game.online();
	const to = own(moved);
	const body = room?.sim.players.get(moved.me)?.body;
	const camera = (await game.state()).arcade?.camera;
	verdict(
		`${tag}: ArrowUp swims its salmon upstream, as the page predicts it (${opt.netcode}), the camera on it`,
		!!from &&
			!!to &&
			to.y < from.y - 40 &&
			!!body &&
			Math.abs(body.y - to.y) < 200 &&
			moved.netcode === opt.netcode &&
			(opt.netcode === 'colyseus' || typeof moved.corrections === 'number') &&
			!!camera &&
			Math.abs(camera.y + camera.view.h / 2 - to.y) < camera.view.h,
		{ from, to, body: body && { x: body.x, y: body.y }, corrections: moved.corrections, camera },
	);
	writeFileSync(join(out, `switch-${n}-round.png`), await game.page.screenshot());
	return { artAtOnce, held: await heldBy(game.page) };
}

const SHOWN = `(window.__IE_FLOW_V2__?.ordered() ?? []).map((c) => c.id)`;
/** Whether the win screen's button says it is joining. */
const SAYS_JOINING = `(() => {
	const walk = (node) => node.text === 'Joining…' || (node.children ?? []).some(walk);
	return !!globalThis.__PIXI_APP__ && walk(globalThis.__PIXI_APP__.stage);
})()`;
/** The win screen's button on the stage, canvas px, once it is drawn. */
const WIN_BUTTON = `(() => {
	const app = globalThis.__PIXI_APP__;
	let at = null;
	const walk = (node) => {
		if (node.text === 'Join New Game' && node.parent) {
			const p = node.parent.toGlobal({ x: 0, y: 0 });
			at = { x: Math.round(p.x), y: Math.round(p.y) };
		}
		for (const child of node.children ?? []) walk(child);
	};
	if (app) walk(app.stage);
	return JSON.stringify(at);
})()`;

/** Hide a page from the game's view (`document.visibilityState`, and its event), or show it. */
const hidePage = (page, hidden) =>
	page.evaluate(`(() => {
		if (${hidden}) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
		else delete document.visibilityState;
		document.dispatchEvent(new Event('visibilitychange'));
		return document.visibilityState;
	})()`);

/**
 * Pages `ida` (never touches the game) and `al` (portrait, plays and wins) in one room: an idle
 * device's win screen counts nothing, and a hidden page's count stops for good; both buttons
 * still join at once.
 */
async function idleAndHidden() {
	const ida = await ready(await open('ida', { rooms_name: 'Ida', rooms_game: PAIR_GAME }));
	const idaIn = await ida.when((o) => !!o.me && o.phase === 'waiting', 120);
	const al = await ready(await open('al', { rooms_name: 'Al', rooms_game: PAIR_GAME }));
	await al.page.page('Emulation.setDeviceMetricsOverride', {
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		mobile: false,
	});
	const alWon = await win(al);
	const idaRoom = idaIn.me ? await roomWith(idaIn.me) : undefined;
	verdict(
		'ida and al play one room; al wins it',
		!!idaRoom && idaRoom === alWon.room && alWon.won?.winner === alWon.before.me,
		{ rooms: [idaRoom?.roomId, alWon.room?.roomId], won: alWon.won },
	);
	const alScreen = alWon.screen;
	writeFileSync(join(out, 'win-count-portrait.png'), await al.page.screenshot());
	verdict(
		'al played (portrait): its count runs over the button, inside the window and clear of the title and the button',
		alScreen?.count === 'running' &&
			alScreen.next <= NEXT_GAME_SECONDS &&
			countClear(alScreen, 390, 844),
		{ count: alScreen?.count, next: alScreen?.next, boxes: alScreen?.boxes },
	);
	await ida.when((o) => !!o.screens?.won?.button, 120);
	writeFileSync(join(out, 'win-idle.png'), await ida.page.screenshot());
	const hidden = await hidePage(al.page, true);
	await al.settle(400);
	const alHidden = (await al.online()).screens?.won;
	// Well past the count's 10 s on both pages' frames (a frame is 1/60 s under the probe), no
	// faster than the clock: a page's inputs follow its frames, and a room disconnects a device
	// that sends more than twice its tick rate in a second.
	const frames = (NEXT_GAME_SECONDS + 4) * 60;
	for (let f = 0; f < frames; f += 6) {
		await ida.play([{ op: 'step', frames: 6 }]);
		await al.play([{ op: 'step', frames: 6 }]);
		await wait(100);
	}
	const idaLater = await ida.online();
	const alLater = await al.online();
	const idaScreen = idaLater.screens?.won;
	verdict(
		`ida never touched the game: its screen (“${idaScreen?.title}”) counts nothing, and ${NEXT_GAME_SECONDS + 4} s on it waits in its room with “Start New Session”`,
		idaIn.played === false &&
			idaLater.played === false &&
			idaScreen?.count === 'off' &&
			idaScreen.next === null &&
			!idaScreen.boxes?.next &&
			idaScreen.label === 'Start New Session' &&
			idaLater.me === idaIn.me,
		{ played: [idaIn.played, idaLater.played], screen: idaScreen, me: [idaIn.me, idaLater.me] },
	);
	verdict(
		`al's page hidden while it counts: the count stops, and ${NEXT_GAME_SECONDS + 4} s on it is still in its room, its button “Join New Game”`,
		hidden === 'hidden' &&
			alHidden?.count === 'stopped' &&
			alHidden.next === null &&
			alLater.screens?.won?.count === 'stopped' &&
			alLater.screens.won.label === 'Join New Game' &&
			alLater.me === alWon.before.me,
		{ hidden, at: alHidden, later: alLater.screens?.won, me: [alWon.before.me, alLater.me] },
	);
	await hidePage(al.page, false);
	await al.settle(4000);
	const alShown = await al.online();
	verdict(
		'…shown again, it does not join by surprise: still in its room, nothing counting',
		alShown.me === alWon.before.me &&
			alShown.screens?.won?.count === 'stopped' &&
			alShown.screens.won.next === null &&
			alShown.screens.won.label === 'Join New Game',
		{
			screen: alShown.screens?.won,
			me: alShown.me,
			docs: (await documentOf(al.page)).docs,
			console: al.page.consoleLines.slice(-8),
		},
	);
	for (const [name, game, was] of [
		['al', al, alWon.before],
		['ida', ida, idaIn],
	]) {
		const button = (await game.online()).screens?.won?.button;
		const { now, pressed } = await joinNew(game, was, button);
		const room = now.me ? await roomWith(now.me) : undefined;
		verdict(
			`${name}'s button still joins at once: “Joining…”, then another room's lobby`,
			joiningOn(pressed) && !!now.me && now.me !== was.me && !!room && room !== alWon.room,
			{ pressed, me: [was.me, now.me], room: room?.roomId },
		);
		const errors = await game.page.evaluate('window.__AR_ERRORS__');
		verdict(`page ${name}: no page error`, errors.length === 0, errors);
		await game.page.close();
	}
}

/** Page `tim` on the real clock: how long each of `rounds` switches takes, as a player sees it. */
async function timing(rounds) {
	const { page } = await open('tim', { rooms_name: 'Tim', ie_determinism: null });
	const times = [];
	try {
		for (let n = 1; n <= rounds; n++) {
			let mine;
			for (let i = 0; i < 600 && !mine; i++) {
				const found = await roomOfName('Tim');
				const shown = await page.evaluate(SHOWN).catch(() => []);
				// A loading screen that waits for a key gets one.
				if (shown.includes('loading') && i % 20 === 19)
					await page.page('Input.dispatchKeyEvent', {
						type: 'rawKeyDown',
						key: ' ',
						code: 'Space',
						windowsVirtualKeyCode: 32,
					});
				if (found?.room.sim.rules.phase === 'running' && shown.includes('basegame')) mine = found;
				else await wait(100);
			}
			if (!mine) {
				times.push({
					stopped: 'no running room',
					shown: await page.evaluate(SHOWN).catch(() => null),
					errors: await page.evaluate('window.__AR_ERRORS__').catch(() => null),
				});
				break;
			}
			await wait(1500);
			let button = null;
			for (let i = 0; i < 200 && !button; i++) {
				// Only a free salmon wins: Space jumps one the sand grounded off it.
				if (i % 10 === 0 && !mine.room.sim.rules.winner) {
					standInSource(mine.room, mine.id);
					for (const type of ['rawKeyDown', 'keyUp'])
						await page.page('Input.dispatchKeyEvent', {
							type,
							key: ' ',
							code: 'Space',
							windowsVirtualKeyCode: 32,
						});
				}
				await wait(100);
				button = JSON.parse(await page.evaluate(WIN_BUTTON).catch(() => 'null'));
			}
			if (!button) {
				times.push({
					stopped: 'no button',
					shown: await page.evaluate(SHOWN).catch(() => null),
					winner: mine.room.sim.rules.winner,
					errors: await page.evaluate('window.__AR_ERRORS__').catch(() => null),
				});
				break;
			}
			// The eggs fall for a moment, as a person would watch them.
			await wait(1500);
			const docs = (await documentOf(page)).docs;
			await page.evaluate(`window.__ptNet.length = 0; sessionStorage.setItem('pt:watch', '1')`);
			await clickCanvas(page, button);
			const pressed = Date.now();
			/** The page's notes since the press, each `[what, ms after it, …]`. */
			const noted = async () =>
				JSON.parse(await page.evaluate('JSON.stringify(window.__ptNet ?? [])').catch(() => '[]'))
					.filter(([, at]) => at >= pressed)
					.map(([what, at, ...more]) => [what, at - pressed, ...more]);
			const inLobby = ([what, , ids]) =>
				what === 'shown' && /salmonsLobby/.test(ids) && !/loading|salmonsWon/.test(ids);
			let notes = [];
			let lobbyShot;
			for (let i = 0; i < 600 && !notes.some(([what]) => what === 'art'); i++) {
				// A page that loads again waits on its loading screen for a key: it gets one at once.
				if ((await page.evaluate(SHOWN).catch(() => [])).includes('loading'))
					await page
						.page('Input.dispatchKeyEvent', {
							type: 'rawKeyDown',
							key: ' ',
							code: 'Space',
							windowsVirtualKeyCode: 32,
						})
						.catch(() => {});
				await wait(100);
				notes = await noted();
				if (!lobbyShot && notes.some(inLobby))
					lobbyShot = {
						png: await page.screenshot().catch(() => undefined),
						art: (await noted()).some(([what]) => what === 'art'),
					};
			}
			await page.evaluate(`sessionStorage.removeItem('pt:watch')`);
			if (lobbyShot?.png) writeFileSync(join(out, `timing-${n}-lobby.png`), lobbyShot.png);
			writeFileSync(join(out, `timing-${n}-art.png`), await page.screenshot());
			const first = (test) => notes.find(test)?.[1] ?? null;
			const of = (kind) => first(([what]) => what === kind);
			const frames = notes.filter(([what]) => what === 'frame').map(([, at]) => at);
			const framesBy = (ms) => (ms === null ? null : frames.filter((at) => at <= ms).length);
			const gaps = frames.map((at, f) => at - (frames[f - 1] ?? 0)).sort((a, b) => a - b);
			const lobby = first(inLobby);
			times.push({
				documents: (await documentOf(page)).docs - docs,
				lobbyShownMs: lobby,
				artDrawnMs: of('art'),
				frames: { lobbyShown: framesBy(lobby), artDrawn: framesBy(of('art')) },
				frameMs: gaps[Math.floor(gaps.length / 2)] ?? null,
				joinMs: {
					asked: of('matchmake'),
					seat: of('seat'),
					socket: of('socket'),
					state: of('state'),
				},
				shown: notes
					.filter(([what]) => what === 'shown')
					.map(([, at, ids]) => `${at}: ${ids || '(nothing)'}`),
				lobbyShotBeforeArt: lobbyShot ? !lobbyShot.art : null,
			});
		}
	} finally {
		await page.close();
	}
	return times;
}

try {
	if (!opt.timing) {
		const jo = await ready(await open('jo', { rooms_name: 'Jo' }));
		await jo.when((o) => !!o.art, 240);
		const start = await heldBy(jo.page);
		const switches = [];
		for (let n = 1; n <= 3; n++) {
			const made = await switchVerdicts(jo, n, n === 3);
			if (!made) break;
			switches.push(made);
		}
		verdict('three games were won and left on one document', switches.length === 3, {
			switches: switches.length,
		});
		result.measures.held = { start, afterSwitch: switches.map((s) => s.held) };
		result.measures.artInFirstFrame = switches.map((s) => s.artAtOnce);
		const joErrors = await jo.page.evaluate('window.__AR_ERRORS__');
		verdict('page jo: no page error', joErrors.length === 0, joErrors);
		await jo.page.close();

		await idleAndHidden();

		// Switches that fail. The page's launch names no character, so only a kept join spares it
		// the start menu: its first boot finds one seeded, each later one the join a failed switch
		// kept.
		let fay = await ready(
			await open(
				'fay',
				{ rooms_name: 'Fay', rooms_character: null },
				{ name: 'Fay', character: 'salmon' },
			),
		);
		const FAILURES = [
			{
				id: 'refused',
				what: 'a join the server refuses',
				arm: 'window.__ptRefuseJoins = true',
				reason: 'the game server did not let it in',
				golden: true,
			},
			{
				id: 'stalled',
				what: 'a join that never answers',
				arm: 'window.__ptStallJoins = true',
				reason: 'did not answer in time',
				golden: true,
				joining: true,
			},
			{
				id: 'thrown',
				what: 'something thrown in the swap',
				arm: `window.__IE_FLOW_V2__.mount.hide = () => { throw new Error('pt: thrown in the swap'); }`,
				reason: 'pt: thrown in the swap',
			},
			{
				id: 'art',
				what: 'art that does not load for the new room',
				arm: 'window.__ptFailArt = true',
				reason: 'art did not load',
			},
		];
		for (const failure of FAILURES) {
			const won = await win(fay);
			const before = await documentOf(fay.page);
			await fay.page.evaluate(
				`window.__ptMark = ${JSON.stringify(failure.id)}; ${failure.arm}; true`,
			);
			if (won.screen?.button) await clickCanvas(fay.page, won.screen.button);
			let joining = !failure.joining;
			if (failure.joining) {
				for (let i = 0; i < 20 && !joining; i++) {
					await fay.play([{ op: 'step', frames: 2 }]);
					joining = await fay.page.evaluate(SAYS_JOINING);
				}
				writeFileSync(join(out, 'joining.png'), await fay.page.screenshot());
			}
			let loaded = before;
			for (let i = 0; i < 400 && loaded.docs === before.docs; i++) {
				await fay.play([{ op: 'step', frames: 6 }]).catch(() => {});
				await wait(30);
				loaded = await documentOf(fay.page).catch(() => loaded);
			}
			const said = fay.page.consoleLines.filter((line) => line.includes('could not change rooms'));
			fay = await ready(fay);
			const lobby = await fay.when((o) => !!o.me && o.screens?.lobby?.shown === true, 240);
			// The page's boot splash fades for a moment over the game it has loaded.
			await fay.settle(1500);
			// A cold boot into a lobby: the flow decides its lobby at the start screen's tap, before
			// the play field ticks, from the variables the room's states wrote (code review, T6).
			const shownCold = await shownOn(fay.page);
			verdict(
				`${failure.what}: the loaded page's flow shows the lobby (salmonsLobby), its phase the room's`,
				shownCold.includes('salmonsLobby') && (await variableOn(fay.page, 'phase')) === 'waiting',
				{ shown: shownCold, phase: await variableOn(fay.page, 'phase') },
			);
			writeFileSync(join(out, `failed-${failure.id}-end.png`), await fay.page.screenshot());
			const room = lobby.me ? await roomWith(lobby.me) : undefined;
			const player = room?.sim.players.get(lobby.me);
			const marked = failure.golden
				? await fay.when((o) => (o.marked ?? []).includes(o.me), 120)
				: lobby;
			verdict(
				`${failure.what}: ${failure.joining ? 'the button reads “Joining…”, then ' : ''}the page loads again and the person is in a new room’s lobby as they were (Fay, a salmon${failure.golden ? ', golden' : ''}), with no start menu, the kept join spent and the reason said`,
				joining &&
					loaded.docs === before.docs + 1 &&
					loaded.mark === null &&
					said.some((line) => line.includes(failure.reason)) &&
					player?.name === 'Fay' &&
					player.character.id === 'salmon' &&
					lobby.screens.lobby.you === 'You are Fay, a Salmon' &&
					Object.keys(lobby.screens.lobby.buttons ?? {}).length === 3 &&
					(!failure.golden || (marked.marked ?? []).includes(marked.me)) &&
					(await fay.page.evaluate('!document.getElementById("sm-start-menu")')) &&
					(await fay.page.evaluate(
						`sessionStorage.getItem(${JSON.stringify(NEXT_JOIN_KEY)}) === null`,
					)),
				{
					joining,
					docs: [before.docs, loaded.docs],
					said: said.slice(-2),
					player: player && { name: player.name, character: player.character.id },
					note: lobby.screens?.lobby,
					marked: marked.marked,
				},
			);
		}
		const fayErrors = await fay.page.evaluate('window.__AR_ERRORS__');
		verdict('page fay: no page error in the room it ended in', fayErrors.length === 0, fayErrors);
		await fay.page.close();
	}
	if (!opt.baked) result.measures.switchMs = await timing(opt.timing ? 4 : 3);
} finally {
	server.stop();
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	await snap.close();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts)
	console.log(
		`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}${v.ok ? '' : ` ${JSON.stringify(v.detail)}`}`,
	);
console.log(`  measures: ${JSON.stringify(result.measures)}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\nsalmons rejoin: ${failed} FAILED` : `\nsalmons rejoin: OK → ${out}`);
process.exit(failed ? 1 : 0);
