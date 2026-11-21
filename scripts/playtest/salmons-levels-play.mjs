// Plays SALMONS ON THE ORIGINAL GAME'S LEVEL (docs/design/salmons-levels.md) in a headless shell
// against a real game server on localhost: the exported config (`salmonsMap`, no pinned seeds), so
// the room picks a random level and the page makes it from the seed the room's state carries. It
// checks: the page made the level the room's seed makes in Node (`generatedOnlineGame`, the server's
// own function), drew it in the original art (one rock and whirlpool per generated one, a waterfall
// face per waterfall, sand), the own salmon swims upstream on ArrowUp (tapping Space off the delta's
// sand), and no page error. It prints
// how long the art took and the page's JS heap, since the original's river is about 2.7× longer and
// 3.8× wider than P10.16's. A second config pins one seed, and its room must play it.
// A pinned level with a waterfall of height 8 added by an overlay near the sea: a cliff stands under
// every waterfall, Space climbs it in place and, tapped on at the top, the salmon swims over, drawn
// raised past it.
// The start menu before the join (owner bug, 2026-11-19): once a room's lobby is over, a page that
// opens the game with no character carried gets the menu and is in no room while it is up; picking
// Fisherman (another page: Bear) and Join River puts it in that running room as that; a reload asks
// again; a join carried from the last page plays at once, with no menu.
// The lobby asks nothing (owner, 2026-11-20): while a new room waits, its lobby shows the room's
// river with the people in it and who the page plays, and no name field, class or Join River, for a
// page that carried its character and for one that came through the start menu alike.
// Project art (docs/status/salmons.md "Original art as project art"): a third page boots a snapshot
// whose editor art ships the project sheets `salmons_terrain` (every ground tile painted magenta, at
// the built-in frames) and `salmons_waterfall_face`: its banks and waterfalls are drawn from them, and the other pages, with no such sheet, draw
// the built-in tiles.
// The device's view (docs/design/realtime-multiplayer.md §5): a page says what its window shows and
// the room sends it the players there as well as the nearby box's. A 1920 × 1080 page among still
// bears placed at known offsets is sent the one on its screen and not the one 36 cells up-river;
// resized to 2560 × 1440 with no reload it is sent those up to its edge and at its corners, and
// not the one just past the edge. A 390 × 844 phone is sent what the box sends: the bear 25 cells
// up-river, off its screen, as before the view; and none past the box.
// A bot salmon wins (owner, 2026-11-21): a bear's page in a test room of 10 (`room_size=10`) sees
// a bot salmon win the game, its win screen naming the bot ("Bot N won!!!"): no eggs, no "You
// Won!".
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-levels-play.mjs --runtime apps/lines/build --out <dir> \
//     [--chrome <exe>] [--netcode engine|colyseus]
//
// The runtime must play arcade: build it with `PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build`.
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { PNG } from 'pngjs';

import { cameraZoom } from '../../packages/engine-mechanics/src/camera.js';
import { generatedOnlineGame } from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	SALMONS_MAP,
	SALMONS_MAP_SEED,
	buildMeanderTable,
	generateSalmonsMap,
	meanderAt,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import {
	boxRegion,
	regionHolds,
	shownOf,
	viewRegion,
} from '../../packages/engine-mechanics/src/shown.js';
import { SALMONS_SHEETS } from '../../packages/engine-layout/src/lib/salmonsArt/sheets/frames.ts';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import {
	sceneCameraZoom,
	worldCameraScene,
} from '../../packages/engine-layout/src/lib/worldCamera.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createGameServer, listRooms } from '../../services/game-server/src/server.ts';
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
		out: { type: 'string', default: join(ROOT, '.cache/salmons-levels-play') },
		chrome: { type: 'string' },
		netcode: { type: 'string', default: 'engine' },
	},
});
if (opt.netcode !== 'engine' && opt.netcode !== 'colyseus') {
	console.error(`--netcode is engine or colyseus, not "${opt.netcode}"`);
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';
const PINNED = 31337;

const river = salmonsMapRiver(SALMONS_MAP_SEED);
const authored = salmonsConfig(river);
// Bears that stand still, by count (no share: the room is kept at 20): nothing hunts the salmon
// while it swims.
authored.arcade.online.bots.characters = [{ character: 'bear', brain: 'bearBot' }];
for (const character of authored.arcade.characters)
	character.brain = {
		initial: 'rest',
		states: [{ id: 'rest', behaviour: 'idle' }],
		transitions: [],
	};
authored.arcade.online.netcode = opt.netcode;
const config = normalizeGameConfigDoc(authored);
const pinned = normalizeGameConfigDoc({
	...authored,
	arcade: {
		...authored.arcade,
		online: { ...authored.arcade.online, levels: { seeds: [PINNED] } },
	},
});
const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { verdicts: [], measures: {} };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'salmons-levels-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
);
const configs = join(work, 'configs');
mkdirSync(configs);
writeFileSync(join(configs, `${KEY}.json`), JSON.stringify(config));
writeFileSync(join(configs, 'salmons-pinned.json'), JSON.stringify(pinned));
// Waterfall heights (2026-11-17): the pinned level with a waterfall of height 8 added four cells
// upstream of where salmon start, so a page meets it at once. That is in the delta's sand, which
// the original's waterfalls never are, and a salmon is grounded each time it comes down on sand
// (2026-11-18), so the overlay takes the sand away from the cliff down to the sea.
const CLIFF_GX = SALMONS_MAP.RIVER_LENGTH - 14;
const cliffCell = [CLIFF_GX, Math.round(meanderAt(buildMeanderTable(String(PINNED)), CLIFF_GX))];
const cliffSand = generateSalmonsMap(PINNED)
	.obstacles.filter((o) => o.type === 'sandbank' && o.x >= CLIFF_GX)
	.map((o) => [o.x, o.y]);
const cliffConfig = normalizeGameConfigDoc({
	...authored,
	arcade: {
		...authored.arcade,
		online: {
			...authored.arcade.online,
			levels: {
				seeds: [PINNED],
				overlays: {
					[PINNED]: {
						remove: cliffSand,
						add: [{ cell: cliffCell, kind: 'waterfall', height: 8 }],
					},
				},
			},
		},
	},
});
writeFileSync(join(configs, 'salmons-cliff.json'), JSON.stringify(cliffConfig));
// A room with a lobby that needs two people, so two pages start it (the lobby screen, then its
// countdown, then round 1). No bots: the pages that later join it as a fisherman and a bear get a
// catcher's place at random, and a bear bot standing on that very place would swipe them.
const LOBBY = { minPlayers: 2, maxWaitSeconds: 120, countdownSeconds: 20 };
const LOBBY_GAME = 'salmons-lobby';
// The same game under a second key: a room of its own, still waiting when a page comes to it.
const NEW_LOBBY_GAME = 'salmons-lobby-new';
for (const key of [LOBBY_GAME, NEW_LOBBY_GAME])
	writeFileSync(
		join(configs, `${key}.json`),
		JSON.stringify(
			normalizeGameConfigDoc({
				...authored,
				arcade: {
					...authored.arcade,
					online: {
						...authored.arcade.online,
						rules: { ...authored.arcade.online.rules, lobby: LOBBY },
						bots: undefined,
					},
				},
			}),
		),
	);

// The device's view: the shipped level pinned, the own bear in a rock-free lane of the water below
// its last waterfall (one terrace: nothing there is drawn raised) and a still bear bot for each
// place, in cells from it (x across the river, y along it: up-river is −y).
const VIEW_OWN = [300, 2];
const VIEW_GAMES = {
	'salmons-view': {
		up30: [0, -30],
		up36: [0, -36],
		up40: [0, -40],
		pastEdge: [0, -43],
		topLeft: [-2, -41],
		// The far bank's own corner is past where a bear may stand; this is the nearest it stays.
		topRight: [-35, -7],
		bottomLeft: [41, 2],
		bottomRight: [2, 41],
	},
	'salmons-view-phone': {
		up25: [0, -25],
		up12: [0, -12],
		down26: [26, 26],
		across5: [-5, 5],
		up36: [0, -36],
	},
};
for (const [key, places] of Object.entries(VIEW_GAMES))
	writeFileSync(
		join(configs, `${key}.json`),
		JSON.stringify(
			normalizeGameConfigDoc({
				...authored,
				arcade: {
					...authored.arcade,
					online: {
						...authored.arcade.online,
						levels: { seeds: [SALMONS_MAP_SEED] },
						// By count, bears first: the room's own mix (by shares) would fill it.
						bots: {
							characters: [
								{ character: 'bear', brain: 'bearBot' },
								{ character: 'fisherman', brain: 'fishermanBot' },
							],
							spawns: authored.arcade.online.bots.spawns,
							fillTo: 1 + Object.keys(places).length,
						},
					},
				},
			}),
		),
	);

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
// The project's `salmons_terrain` sheet as a publish ships it (`deploy/editor-art/`, listed in
// `editorArt` by its manifest key): the built-in frames, every pixel magenta.
const MAGENTA = [255, 0, 255];
const terrain = SALMONS_SHEETS.terrain;
const terrainPage = new PNG({ width: terrain.meta.size.w, height: terrain.meta.size.h });
for (let i = 0; i < terrainPage.data.length; i += 4) terrainPage.data.set([...MAGENTA, 255], i);
mkdirSync(join(snapshot, 'deploy', 'editor-art'), { recursive: true });
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_terrain.png'),
	PNG.sync.write(terrainPage),
);
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_terrain.json'),
	JSON.stringify({ ...terrain, meta: { ...terrain.meta, image: 'salmons_terrain.png' } }),
);
// And `salmons_waterfall_face`, the tile a TilingSprite scrolls, as its own one-region sheet.
const FACE = { w: 256, h: 64 };
const facePage = new PNG({ width: FACE.w, height: FACE.h });
for (let i = 0; i < facePage.data.length; i += 4) facePage.data.set([...MAGENTA, 255], i);
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_waterfall_face.png'),
	PNG.sync.write(facePage),
);
const faceFrame = { x: 0, y: 0, ...FACE };
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_waterfall_face.json'),
	JSON.stringify({
		frames: {
			waterfall_face: {
				frame: faceFrame,
				rotated: false,
				trimmed: false,
				spriteSourceSize: faceFrame,
				sourceSize: FACE,
			},
		},
		meta: { image: 'salmons_waterfall_face.png', format: 'RGBA8888', size: FACE, scale: '1' },
	}),
);
const withProjectArt = join(work, 'runtime-project-art.json');
writeFileSync(
	withProjectArt,
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: SALMONS_SEED_DOC,
		editorArt: {
			sheets: [
				{
					key: `invisible_wall/${KEY}/manifests/atlas_manifest_salmons_terrain.json`,
					json: 'editor-art/salmons_terrain.json',
				},
				{
					key: `invisible_wall/${KEY}/manifests/atlas_manifest_salmons_waterfall_face.json`,
					json: 'editor-art/salmons_waterfall_face.json',
				},
			],
			images: [],
		},
	}),
);
const snapProjectArt = await serveSnapshot({
	dir: snapshot,
	bundleFile: withProjectArt,
	name: 'Salmons',
	snapshotId: 'salmons-project-art',
});
// The cliff room's device must make the level from the same config (its overlay) as the server.
const withCliff = join(work, 'runtime-cliff.json');
writeFileSync(
	withCliff,
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config: cliffConfig,
		flowV2: SALMONS_SEED_DOC,
	}),
);
const snapCliff = await serveSnapshot({
	dir: snapshot,
	bundleFile: withCliff,
	name: 'Salmons',
	snapshotId: 'salmons-cliff',
});
/** The share of a screenshot's pixels that are the project sheet's magenta. */
const magentaShare = (shot) => {
	const { data } = PNG.sync.read(shot);
	let hits = 0;
	for (let i = 0; i < data.length; i += 4)
		if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) hits += 1;
	return hits / (data.length / 4);
};

const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 12,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PHONE_UA =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
/** Give a page a window of `w` × `h` CSS px (device scale factor 1), now. */
const resizeTo = (page, { w, h, mobile = false }) =>
	page.page('Emulation.setDeviceMetricsOverride', {
		width: w,
		height: h,
		deviceScaleFactor: 1,
		mobile,
	});

/**
 * Open a page on the game. `device` gives it a window of its own (`{ w, h, mobile }`: a phone has
 * a phone's user agent and touch). A `null` in `extra` takes a launch parameter away
 * (`rooms_character`: the published link carries none); `next` is a join the last page carried
 * (`online.ts` `takeNextJoin`: session storage, scoped to this server and game), seeded once.
 */
async function open(profile, extra = {}, next = undefined, device = undefined) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.page('Performance.enable');
	if (device) await resizeTo(page, device);
	if (device?.mobile) {
		await page.page('Emulation.setUserAgentOverride', { userAgent: PHONE_UA });
		await page.page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	}
	if (next) {
		const carried = JSON.stringify({
			server: `ws://127.0.0.1:${roomsPort}`,
			game: extra.rooms_game ?? KEY,
			...next,
		});
		await page.page('Page.addScriptToEvaluateOnNewDocument', {
			source: `if (!sessionStorage.getItem('pt:seeded')) { sessionStorage.setItem('pt:seeded', '1'); sessionStorage.setItem('ie:rooms:next-join', ${JSON.stringify(carried)}); }`,
		});
	}
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'levels-play',
		editorDocBase: snap.origin,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		rooms_character: 'salmon',
	});
	for (const [k, v] of Object.entries(extra))
		if (v === null) params.delete(k);
		else params.set(k, v);
	const url = `${server.origin}/${KEY}/?${params}`;
	const started = Date.now();
	await page.navigate(url);
	return { page, url, started };
}

/** The game on an opened page, once it has joined its room: loaded, started, its art drawn. */
async function ready({ page, started }) {
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
	const state = () => api('state()');
	const settle = async (ms) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			await play([{ op: 'step', frames: 6 }]);
			await wait(50);
		}
	};
	let artMs;
	for (let i = 0; i < 120 && artMs === undefined; i++) {
		await settle(500);
		if ((await state()).arcade?.online?.art) artMs = Date.now() - started;
	}
	// The keys are the screen's on the isometric river (`online.ts` `keysOf`): up the river (world
	// −y, drawn up and left on Salmons' mirrored screen, as the original's) is Up + Left.
	const key = async (name, type) => {
		for (const code of name === 'ArrowUp' ? ['ArrowUp', 'ArrowLeft'] : [name])
			await page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: { Space: ' ' }[code] ?? code,
				code,
				windowsVirtualKeyCode: { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, Space: 32 }[code],
			});
	};
	const shown = () =>
		page.evaluate(
			'(() => { const f = window.__IE_FLOW_V2__; return f ? f.ordered().map((c) => c.id) : []; })()',
		);
	return { page, state, settle, key, artMs, shown };
}

const boot = async (profile, extra) => ready(await open(profile, extra));

/** The start menu a page shows before it joins (`engine-layout` `salmonsArt/startMenu.ts`), or
 *  `null`: its name field, its buttons (each one's centre, CSS px) and its river list. */
const menuOf = (page) =>
	page.evaluate(`(() => {
		const menu = document.getElementById('sm-start-menu');
		if (!menu) return null;
		const buttons = [...menu.querySelectorAll('button')].map((b) => {
			const box = b.getBoundingClientRect();
			return {
				label: b.textContent,
				pressed: b.getAttribute('aria-pressed') === 'true',
				shown: getComputedStyle(b).visibility !== 'hidden' && box.width > 0,
				x: box.x + box.width / 2,
				y: box.y + box.height / 2,
			};
		});
		return {
			name: menu.querySelector('input').value,
			buttons,
			rivers: menu.querySelector('form').lastElementChild.textContent,
			onTop: document.elementFromPoint(innerWidth / 2, 8) === menu,
		};
	})()`);
/** The page's start menu once it is up; `null` if the page joined a room without asking (its play
 *  field is mounted: the probe itself is there before any join, so it says nothing). */
const awaitMenu = async (page) => {
	for (let i = 0; i < 300; i++) {
		const menu = await menuOf(page).catch(() => null);
		if (menu) return menu;
		const playing = await page
			.evaluate('!!window.__IE_DETERMINISM__?.state().arcade')
			.catch(() => false);
		if (playing) return null;
		await wait(100);
	}
	return null;
};
/** Click the menu's button whose label holds `label`, as a mouse does. */
const pressMenu = async (page, label) => {
	const button = (await menuOf(page))?.buttons.find((b) => b.shown && b.label.includes(label));
	if (!button) throw new Error(`the start menu has no "${label}" button`);
	const point = { x: Math.round(button.x), y: Math.round(button.y) };
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
/**
 * What a page's lobby shows and asks: the note the room's art draws in it (the probe's
 * `online.screens.lobby`: the room's river with its people, who the page plays), a form drawn in
 * the canvas (`online.screens.menu`, which a runtime before 2026-11-20 drew there), the text
 * fields on the page and whether the start menu is over it.
 */
const lobbyOf = async (game) => {
	const screens = (await game.state()).arcade?.online?.screens ?? {};
	const dom = await game.page.evaluate(`({
		fields: [...document.querySelectorAll('input, textarea, select')].filter(
			(field) => field.getBoundingClientRect().width > 0,
		).length,
		startMenu: !!document.getElementById('sm-start-menu'),
	})`);
	return { note: screens.lobby, menu: screens.menu, ...dom };
};
/** The same once its note counts `people` in the room (the server's listing, asked every 3 s). */
const lobbyCounting = async (game, people) => {
	let lobby = await lobbyOf(game);
	for (let i = 0; i < 12 && lobby.note?.players !== people; i++) {
		await game.settle(500);
		lobby = await lobbyOf(game);
	}
	return lobby;
};
/** Whether a lobby asks nothing: no form in the canvas, no field on the page, no start menu. */
const asksNothing = (lobby) => lobby.menu === undefined && lobby.fields === 0 && !lobby.startMenu;
const inRiver = (people) => new RegExp(`^${people} players in .+ River$`);

/** The room's own record of a session: which room, its phase, and the player as the room has it. */
const inRoom = async (sessionId) => {
	for (const listed of await matchMaker.query({})) {
		const sim = matchMaker.getLocalRoomById(listed.roomId)?.sim;
		const player = sim?.players.get(sessionId);
		if (player)
			return {
				roomId: listed.roomId,
				phase: sim.rules.phase,
				character: player.character.id,
				name: player.name,
				status: player.status,
				bots: [...sim.players.values()].filter((p) => p.bot).length,
				players: sim.players.size,
			};
	}
	return null;
};

const heapOf = async (page) => {
	const { result: metrics } = await page.page('Performance.getMetrics');
	const m = Object.fromEntries((metrics?.metrics ?? []).map((x) => [x.name, x.value]));
	return Math.round((m.JSHeapUsedSize ?? 0) / 1e6);
};

try {
	const a = await boot('a', { rooms_name: 'Ann' });
	const online = (await a.state()).arcade?.online ?? {};
	const made =
		typeof online.seed === 'number' ? generatedOnlineGame(onlineGameOf(config), online.seed) : null;
	verdict('the page joined a room carrying a seed', typeof online.seed === 'number', {
		seed: online.seed,
	});
	verdict(
		"the page made the room seed's level, the server's own generator's (zones alike)",
		!!made &&
			online.fieldDrawn === true &&
			JSON.stringify(online.zones) ===
				JSON.stringify(made.game.zones.map((z) => [z.id, z.x, z.y, z.w, z.h])),
		{ drawn: online.fieldDrawn, zones: online.zones?.length, expected: made?.game.zones.length },
	);
	const regions = online.art?.regions ?? {};
	const sum = (prefix) =>
		Object.entries(regions)
			.filter(([name]) => name.startsWith(prefix))
			.reduce((n, [, c]) => n + c, 0);
	const level = made?.made;
	verdict(
		'the level is drawn in the original art: its rocks, whirlpools, waterfalls and sand',
		!!level &&
			sum('rock_') === level.rocks.length &&
			sum('whirlpool_') === level.whirlpools.length * 4 &&
			(regions.waterfall_face ?? 0) === level.waterfalls.length * 2 &&
			sum('sand_') > 0 &&
			sum('tree_') > 50,
		{
			rocks: [sum('rock_'), level?.rocks.length],
			pools: [sum('whirlpool_'), level?.whirlpools.length],
		},
	);
	const among = (await a.state()).arcade?.fieldArt?.among;
	verdict(
		'the forest and the bridges stand among the players, in their spawn layer',
		among?.layer === true && among.drawn > 0,
		among,
	);
	result.measures.artMs = a.artMs;
	result.measures.heapMB = await heapOf(a.page);
	const me = (await a.state()).arcade?.online?.me;
	const yOf = async () =>
		(await a.state()).arcade?.online?.drawn?.find((d) => d.id === me)?.y ?? Number.NaN;
	const before = await yOf();
	await a.key('ArrowUp', 'down');
	const t0 = Date.now();
	const f0 = (await a.state()).frame;
	// Tapping Space as it swims: a delta sand island grounds a salmon until it jumps.
	for (let i = 0; i < 12; i++) {
		await a.key('Space', 'down');
		await a.settle(250);
		await a.key('Space', 'up');
		await a.settle(250);
	}
	result.measures.fps = Math.round((((await a.state()).frame - f0) * 1000) / (Date.now() - t0));
	await a.key('ArrowUp', 'up');
	const after = await yOf();
	verdict('ArrowUp (and Space off the sand) swims the salmon upstream', after < before - 100, {
		before,
		after,
	});
	const levelShot = await a.page.screenshot();
	writeFileSync(join(out, 'level.png'), levelShot);
	const builtinMagenta = magentaShare(levelShot);
	const errors = await a.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
	await a.page.close();

	const pa = await boot('pa', { rooms_name: 'Pat', editorDocBase: snapProjectArt.origin });
	const paArt = (await pa.state()).arcade?.online?.art;
	await pa.settle(1000);
	const projectShot = await pa.page.screenshot();
	writeFileSync(join(out, 'project-art.png'), projectShot);
	const projectMagenta = magentaShare(projectShot);
	result.measures.magenta = { builtin: builtinMagenta, project: projectMagenta };
	verdict(
		"a snapshot shipping the project's salmons_terrain draws the banks from it",
		!!paArt && projectMagenta > 0.05,
		{ share: projectMagenta },
	);
	verdict('without it the built-in tiles are drawn (no magenta)', builtinMagenta < 0.001, {
		share: builtinMagenta,
	});
	const paRegions = (await pa.state()).arcade?.online?.art?.regions ?? {};
	verdict(
		'with the project’s face tile the waterfalls still draw (the TilingSprite path)',
		(paRegions.waterfall_face ?? 0) > 0,
		{
			faces: paRegions.waterfall_face,
		},
	);
	const paErrors = await pa.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error with the project art', paErrors.length === 0, paErrors);
	await pa.page.close();

	const p = await boot('p', { rooms_name: 'Pia', rooms_game: 'salmons-pinned' });
	const pSeed = (await p.state()).arcade?.online?.seed;
	verdict('a config that pins a seed: its room plays that level', pSeed === PINNED, {
		seed: pSeed,
	});
	await p.page.close();

	const c = await boot('c', {
		rooms_name: 'Cy',
		rooms_game: 'salmons-cliff',
		editorDocBase: snapCliff.origin,
	});
	const cliffLevel = generatedOnlineGame(onlineGameOf(cliffConfig), PINNED).made;
	const line = (cliffLevel.grid.sourceRows + CLIFF_GX) * CELL;
	const cRegions = (await c.state()).arcade?.online?.art?.regions ?? {};
	verdict(
		'a cliff of cliff.png stands under every waterfall',
		(cRegions.cliff ?? 0) === cliffLevel.waterfalls.length,
		{ cliffs: cRegions.cliff, waterfalls: cliffLevel.waterfalls.length },
	);
	const meC = (await c.state()).arcade?.online?.me;
	const ownC = async () => {
		const st = await c.state();
		return {
			body: st.arcade?.bodies?.find((b) => b.id === meC),
			drawn: st.arcade?.online?.drawn?.find((d) => d.id === meC),
			events: (st.arcade?.online?.events ?? []).filter((e) => e.id === meC),
		};
	};
	await c.key('ArrowUp', 'down');
	let climbed;
	let climbPose = false;
	let below = true;
	let taps = 0;
	let atFoot;
	for (; taps < 40 && !climbed; taps++) {
		await c.key('Space', 'down');
		await c.settle(150);
		await c.key('Space', 'up');
		await c.settle(350);
		const now = await ownC();
		climbPose ||= (await c.state()).arcade?.online?.art?.looks?.[meC]?.climbing === true;
		climbed = now.events.find((e) => e.type === 'climbed');
		if (!climbed && now.body) {
			below &&= now.body.y > line;
			if (now.body.y < line + 3 * CELL) atFoot ??= now;
		}
		if (atFoot && !climbed && taps % 4 === 0)
			writeFileSync(join(out, 'cliff.png'), await c.page.screenshot());
	}
	// Let go at the top it passes only while that high (the original's rule, since 2026-11-18):
	// as the original's player, it keeps tapping at the top, ArrowUp held, until it is over.
	let over = await ownC();
	for (let i = 0; i < 20 && !(over.body && over.body.y < line); i++) {
		await c.key('Space', 'down');
		await c.settle(150);
		await c.key('Space', 'up');
		await c.settle(350);
		over = await ownC();
	}
	await c.settle(2000);
	// The drawn lift eases onto the step once the salmon crosses the lip, which can be well after
	// it is let go at the top: read it only once it has stopped moving.
	over = await ownC();
	for (let i = 0; i < 40; i++) {
		await c.settle(100);
		const next = await ownC();
		const settled = next.drawn?.ground === over.drawn?.ground && next.body && next.body.y < line;
		over = next;
		if (settled) break;
	}
	await c.key('ArrowUp', 'up');
	writeFileSync(join(out, 'over-the-cliff.png'), await c.page.screenshot());
	const step = 24 + 24 * 8;
	verdict(
		'a waterfall of height 8: Space climbs it in place, and let go at the top the salmon swims over',
		!!climbed && below && !!over.body && over.body.y < line,
		{ climbed, taps, line, foot: atFoot?.body?.y, over: over.body?.y },
	);
	verdict(
		'…and is drawn raised with the river past it (the waterfall’s step, 24 + 24 × 8 px)',
		Math.abs((over.drawn?.ground ?? 0) - (atFoot?.drawn?.ground ?? 0) - step) < 0.5,
		{ before: atFoot?.drawn?.ground ?? 0, after: over.drawn?.ground ?? 0 },
	);
	verdict('…drawn nose up in the climb’s pose while it climbs (the room holds it)', climbPose);
	const cErrors = await c.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error on the raised river', cErrors.length === 0, cErrors);
	await c.page.close();

	const l1 = await boot('l1', { rooms_name: 'Lia', rooms_game: LOBBY_GAME });
	await l1.settle(1500);
	const waiting = await l1.shown();
	const phase1 = (await l1.state()).arcade?.online?.phase;
	verdict(
		'a room with a lobby: the first person waits on the lobby screen, no countdown yet',
		phase1 === 'waiting' &&
			waiting.includes('salmonsLobby') &&
			!waiting.includes('salmonsCountdown'),
		{ phase: phase1, shown: waiting },
	);
	const alone = await lobbyCounting(l1, 1);
	writeFileSync(join(out, 'lobby-waiting.png'), await l1.page.screenshot());
	verdict(
		'…which shows the room’s river with its one person and who the page plays, and asks nothing: no name field, no class, no Join River',
		alone.note?.shown === true &&
			inRiver(1).test(alone.note.river) &&
			alone.note.you === 'You are Lia, a Salmon' &&
			asksNothing(alone),
		{ lobby: alone },
	);
	const l2 = await boot('l2', { rooms_name: 'Leo', rooms_game: LOBBY_GAME });
	const countingFrom = Date.now();
	await Promise.all([l1.settle(1500), l2.settle(1500)]);
	const counting = [await l1.shown(), await l2.shown()];
	verdict(
		'the second person starts the countdown: both pages show the lobby and its countdown',
		counting.every((ids) => ids.includes('salmonsLobby') && ids.includes('salmonsCountdown')),
		{ shown: counting },
	);
	const pair = [await lobbyCounting(l1, 2), await lobbyCounting(l2, 2)];
	writeFileSync(join(out, 'lobby-countdown.png'), await l2.page.screenshot());
	verdict(
		'…and each lobby counts both people in the one river, still asking nothing',
		pair.every((lobby) => inRiver(2).test(lobby.note?.river ?? '') && asksNothing(lobby)) &&
			pair[0].note.river === pair[1].note.river &&
			pair[1].note.you === 'You are Leo, a Salmon',
		{ lobbies: pair },
	);
	const left = Math.max(0, LOBBY.countdownSeconds * 1000 + 4000 - (Date.now() - countingFrom));
	await Promise.all([l1.settle(left), l2.settle(left)]);
	const started = [await l1.shown(), await l2.shown()];
	const phases = [
		(await l1.state()).arcade?.online?.phase,
		(await l2.state()).arcade?.online?.phase,
	];
	const dropped = [await lobbyOf(l1), await lobbyOf(l2)];
	verdict(
		'when it ends round 1 starts and both pages drop the lobby',
		phases.every((p) => p === 'running') &&
			started.every((ids) => !ids.includes('salmonsLobby') && !ids.includes('salmonsCountdown')) &&
			dropped.every((lobby) => lobby.note?.shown === false),
		{ phases, shown: started, notes: dropped.map((lobby) => lobby.note) },
	);
	writeFileSync(join(out, 'lobby.png'), await l2.page.screenshot());

	// The start menu before the join: the lobby's room is running now, Lia and Leo in it. A page
	// opens the game as the published link does, no character carried.
	const published = { rooms_game: LOBBY_GAME, rooms_character: null };
	const riversNow = async () => (await listRooms(LOBBY_GAME)).map((r) => [r.roomId, r.players]);
	const lobbyRoom = (await inRoom((await l1.state()).arcade?.online?.me))?.roomId;
	const listedBefore = await riversNow();
	const m1 = await open('m1', published);
	const menu = await awaitMenu(m1.page);
	// Real time with the menu up: a device that had joined would be in the room, and listed, by now.
	await Promise.all([l1.settle(4000), l2.settle(4000)]);
	const listed = (await menuOf(m1.page))?.rivers ?? '';
	const during = await riversNow();
	writeFileSync(join(out, 'start-menu.png'), await m1.page.screenshot());
	const labels = (menu?.buttons ?? []).filter((b) => b.shown).map((b) => b.label);
	verdict(
		'a page that opens the game into a running room with no character carried gets the start menu',
		!!menu &&
			menu.onTop &&
			menu.name === 'Guest' &&
			['Salmon', 'Catcher', 'Join River'].every((word) => labels.some((l) => l.includes(word))) &&
			menu.buttons.find((b) => b.label.includes('Salmon'))?.pressed === true &&
			!labels.some((l) => l.includes('Bear')),
		{ menu },
	);
	verdict(
		'…and is in no room while it is up: the running room keeps its two people, and no room is made',
		JSON.stringify(listedBefore) === JSON.stringify([[lobbyRoom, 2]]) &&
			JSON.stringify(during) === JSON.stringify(listedBefore) &&
			/^2 players in .+ River$/.test(listed),
		{ listedBefore, during, listed },
	);
	const menuPages = [m1.page];
	// Without the menu the page is already in the room as what the room picked: nothing to pick.
	if (!menu) verdict('the start menu came up, so its choices could be played', false);
	else {
		await pressMenu(m1.page, 'Catcher');
		const catcher = await menuOf(m1.page);
		await m1.page.evaluate(
			"(() => { const name = document.querySelector('#sm-start-menu input'); name.focus(); name.select(); })()",
		);
		await m1.page.page('Input.insertText', { text: 'Finn' });
		await pressMenu(m1.page, 'Join River');
		const f = await ready(m1);
		await f.settle(1000);
		/** How a page plays once it is in: who the room has it as, how it is drawn, and whether it walks. */
		const playing = async (game) => {
			const me = (await game.state()).arcade?.online?.me;
			const at = async () => (await game.state()).arcade?.bodies?.find((b) => b.id === me);
			const from = await at();
			await game.key('ArrowUp', 'down');
			await game.settle(1500);
			await game.key('ArrowUp', 'up');
			const to = await at();
			const online = (await game.state()).arcade?.online ?? {};
			return {
				room: await inRoom(me),
				look: online.art?.looks?.[me],
				phase: online.phase,
				walked: from && to ? Math.round(Math.hypot(to.x - from.x, to.y - from.y)) : 0,
				flow: await game.shown(),
				menu: await menuOf(game.page),
			};
		};
		const asFisherman = await playing(f);
		writeFileSync(join(out, 'joined-as-fisherman.png'), await f.page.screenshot());
		verdict(
			'Catcher offers Fisherman (picked) and Bear; Join River puts the page in that running room as a fisherman, by the name typed',
			catcher?.buttons.find((b) => b.label === 'Fisherman')?.pressed === true &&
				catcher.buttons.some((b) => b.label === 'Bear' && b.shown && !b.pressed) &&
				asFisherman.room?.roomId === lobbyRoom &&
				asFisherman.room.phase === 'running' &&
				asFisherman.room.character === 'fisherman' &&
				asFisherman.room.name === 'Finn' &&
				asFisherman.menu === null,
			{ asFisherman },
		);
		verdict(
			'…where it plays at once: drawn as the fisherman, walking on its keys, no lobby screen',
			asFisherman.look?.kind === 'circle' &&
				asFisherman.walked > 48 &&
				!asFisherman.flow.includes('salmonsLobby'),
			{ look: asFisherman.look, walked: asFisherman.walked, flow: asFisherman.flow },
		);
		const m2 = await open('m2', published);
		menuPages.push(m2.page);
		await awaitMenu(m2.page);
		await pressMenu(m2.page, 'Catcher');
		await pressMenu(m2.page, 'Bear');
		await pressMenu(m2.page, 'Join River');
		const b = await ready(m2);
		await b.settle(1000);
		const asBear = await playing(b);
		writeFileSync(join(out, 'joined-as-bear.png'), await b.page.screenshot());
		verdict(
			'another page picks Catcher, Bear: it plays in that room as a bear',
			asBear.room?.roomId === lobbyRoom &&
				asBear.room.character === 'bear' &&
				asBear.look?.kind === 'sprite' &&
				asBear.look.region === 'bear' &&
				asBear.walked > 48 &&
				asBear.menu === null,
			{ asBear },
		);
		// The fisherman's page loaded again carries nothing: it is asked again, and joins nothing
		// meanwhile (the room only holds its old place for a return).
		const joined = (await riversNow())[0]?.[1];
		await m1.page.navigate(m1.url);
		const again = await awaitMenu(m1.page);
		await Promise.all([l1.settle(3000), l2.settle(3000)]);
		const afterReload = await riversNow();
		verdict(
			'a reload carries no choice: the start menu again (the name kept), and no new player meanwhile',
			!!again && again.name === 'Finn' && joined === 4 && afterReload[0]?.[1] === joined,
			{ again: again?.name, joined, afterReload },
		);
		// A join the last page carried (the win screen's "Join New Game"): no menu, at once.
		const m3 = await open('m3', published, { name: 'Cara', character: 'bear' });
		menuPages.push(m3.page);
		const c2 = await ready(m3);
		await c2.settle(500);
		const carried = await inRoom((await c2.state()).arcade?.online?.me);
		verdict(
			'a launch whose last page carried its join plays at once as that, with no menu',
			carried?.character === 'bear' && carried.name === 'Cara' && (await menuOf(c2.page)) === null,
			{ carried },
		);
		// Through the menu into a room nobody is in yet: its lobby shows what was picked before the
		// join and does not ask a second time.
		const m4 = await open('m4', { rooms_game: NEW_LOBBY_GAME, rooms_character: null });
		menuPages.push(m4.page);
		await awaitMenu(m4.page);
		await pressMenu(m4.page, 'Catcher');
		await pressMenu(m4.page, 'Bear');
		await pressMenu(m4.page, 'Join River');
		const n = await ready(m4);
		await n.settle(1500);
		const freshRoom = await inRoom((await n.state()).arcade?.online?.me);
		const freshShown = await n.shown();
		const freshLobby = await lobbyCounting(n, 1);
		writeFileSync(join(out, 'menu-then-lobby.png'), await n.page.screenshot());
		verdict(
			'through the menu into a new room: its lobby shows the class picked there and does not ask again',
			freshRoom?.phase === 'waiting' &&
				freshRoom.character === 'bear' &&
				freshShown.includes('salmonsLobby') &&
				freshLobby.note?.shown === true &&
				freshLobby.note.you === `You are ${freshRoom.name}, a Bear` &&
				inRiver(1).test(freshLobby.note.river) &&
				asksNothing(freshLobby),
			{ freshRoom, shown: freshShown, lobby: freshLobby },
		);
	}
	const menuErrors = [];
	for (const page of menuPages)
		menuErrors.push(...(await page.evaluate('window.__AR_ERRORS__').catch(() => [])));
	verdict('no page error on the pages that came in through the menu', menuErrors.length === 0, {
		menuErrors,
	});
	for (const page of [l1.page, l2.page, ...menuPages]) await page.close();

	// THE DEVICE'S VIEW. What a page says its window shows, by the engine's own functions on the
	// exported layout's camera and the config's bodies (`apps/lines` `online.ts` `follow`).
	const viewCamera = sceneCameraZoom(worldCameraScene(doc.scenes));
	const viewGame = onlineGameOf(config);
	const viewReach = Math.max(
		...viewGame.online.characters.map(({ body }) => {
			const { shape, r, w, h } = viewGame.bodies[body];
			return shape === 'circle' ? 2 * r : Math.max(w, h);
		}),
	);
	const saysOn = ({ w, h, mobile = false }) =>
		shownOf({
			window: { w, h },
			zoom: cameraZoom(viewCamera, { mobile, windowScale: 1 }),
			iso: true,
			margin: viewReach,
		});
	const { gyMin, sourceRows } = river.grid;
	const cellAt = (gx, gy) => ({
		x: (gy - gyMin) * CELL + CELL / 2,
		y: (gx + sourceRows) * CELL + CELL / 2,
	});
	const viewOwn = cellAt(...VIEW_OWN);
	/**
	 * A page of `key`'s room in a window of `device`, its own bear stood at {@link VIEW_OWN} and
	 * the bots parked out of every view until its camera rests there and the room sends it by
	 * that view alone (a camera easing after a placement sweeps a larger view, which the room
	 * holds a second or two, and a player once sent is kept 25 % past the edge); then each bot at
	 * its place, but for those named in `later`, which `place` stands there when asked. `read`
	 * says who the page holds and draws, what it says and what the room holds for it.
	 */
	const viewPage = async (profile, key, device, later = []) => {
		const game = await ready(
			await open(
				profile,
				{
					rooms_name: 'Vi',
					rooms_character: 'bear',
					rooms_game: key,
					...(device.mobile ? { device: 'mobile' } : {}),
				},
				undefined,
				device,
			),
		);
		const me = (await game.state()).arcade?.online?.me;
		const listed = (await matchMaker.query({})).find((room) => room.metadata?.game === key);
		const room = matchMaker.getLocalRoomById(listed.roomId);
		const bots = [...room.sim.players.values()]
			.filter((player) => player.bot)
			.sort((a, b) => Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]));
		const names = Object.keys(VIEW_GAMES[key]);
		const idOf = Object.fromEntries(names.map((name, i) => [name, bots[i]?.id]));
		const read = async () => {
			const arcade = (await game.state()).arcade ?? {};
			const sent = new Set((arcade.bodies ?? []).map((body) => body.id));
			const drawn = new Set((arcade.online?.drawn ?? []).map((d) => d.id));
			const latest = room.inputs.get(me)?.latest;
			return {
				sent: names.filter((name) => sent.has(idOf[name])),
				drawn: names.filter((name) => drawn.has(idOf[name])),
				says: arcade.camera?.shown ?? null,
				roomHolds: latest && {
					shownW: latest.shownW,
					shownH: latest.shownH,
					shownIso: latest.shownIso,
				},
				netcode: arcade.online?.netcode,
			};
		};
		/** Step the page until it says `says`, the room sends it by that view and no wider one it
		 *  still holds (`holdView`), and it holds exactly `sent` (or 20 s pass), then a second
		 *  more: a player on its way in or out has settled. */
		const until = async (says, sent) => {
			const view = JSON.stringify(viewRegion(room.sim.game.online.nearby, says));
			let now = await read();
			for (let i = 0; i < 50; i++) {
				if (
					JSON.stringify(now.says) === JSON.stringify(says) &&
					JSON.stringify(now.sent) === JSON.stringify(sent) &&
					JSON.stringify(room.held.get(me)?.view) === view
				)
					break;
				await game.settle(400);
				now = await read();
			}
			await game.settle(1000);
			return read();
		};
		Object.assign(room.sim.players.get(me).body, viewOwn);
		for (const bot of bots) Object.assign(bot.body, { x: viewOwn.x, y: viewOwn.y + 100 * CELL });
		// Until the page has taken its player's new place and its camera has come to rest on it.
		for (let i = 0, still = 0; i < 150 && still < 3; i++) {
			await game.settle(400);
			const camera = (await game.state()).arcade?.camera;
			const off = camera
				? Math.hypot(
						camera.x + camera.view.w / 2 - viewOwn.x,
						camera.y + camera.view.h / 2 - viewOwn.y,
					)
				: Infinity;
			still = off < 0.05 ? still + 1 : 0;
		}
		const alone = await until(saysOn(device), []);
		const place = (name) => {
			const [dx, dy] = VIEW_GAMES[key][name];
			const bot = bots[names.indexOf(name)];
			Object.assign(bot.body, { x: viewOwn.x + dx * CELL, y: viewOwn.y + dy * CELL });
		};
		for (const name of names) if (!later.includes(name)) place(name);
		return { game, read, until, place, alone, bots: bots.length === names.length };
	};
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

	const HD = { w: 1920, h: 1080 };
	const QHD = { w: 2560, h: 1440 };
	// The bear just past the larger window's edge comes last: resizing slides the camera to the
	// new window's centre, and a bear that the slide showed would be kept (25 % past the edge).
	const wide = await viewPage('view', 'salmons-view', HD, ['pastEdge']);
	const onHd = await wide.until(saysOn(HD), ['up30']);
	writeFileSync(join(out, 'view-1920.png'), await wide.game.page.screenshot());
	verdict(
		'view: a 1920 × 1080 page says what its camera shows there, and the room holds it',
		wide.bots && same(wide.alone.says, saysOn(HD)) && same(onHd.roomHolds, saysOn(HD)),
		{ says: onHd.says, roomHolds: onHd.roomHolds, expected: saysOn(HD), bots: wide.bots },
	);
	verdict(
		'view: it is sent and draws the bear at its screen’s edge, not the one 36 cells up-river',
		same(onHd.sent, ['up30']) && same(onHd.drawn, ['up30']),
		onHd,
	);
	await wide.game.page.evaluate('window.__VIEW_MARK__ = 1');
	await resizeTo(wide.game.page, QHD);
	const QHD_SENT = ['up30', 'up36', 'up40', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
	const resized = await wide.until(saysOn(QHD), QHD_SENT);
	wide.place('pastEdge');
	const onQhd = await wide.until(saysOn(QHD), QHD_SENT);
	writeFileSync(join(out, 'view-2560.png'), await wide.game.page.screenshot());
	verdict(
		'view: resized to 2560 × 1440 with no reload, it says the larger view',
		same(resized.says, saysOn(QHD)) &&
			same(resized.roomHolds, saysOn(QHD)) &&
			same(resized.sent, QHD_SENT) &&
			(await wide.game.page.evaluate('window.__VIEW_MARK__')) === 1,
		{ says: resized.says, roomHolds: resized.roomHolds, expected: saysOn(QHD), sent: resized.sent },
	);
	verdict(
		'view: …and is sent and draws the bears up to 40 cells up-river and at its corners, not the one past its edge',
		same(onQhd.sent, QHD_SENT) && same(onQhd.drawn, QHD_SENT),
		onQhd,
	);
	const PHONE = { w: 390, h: 844, mobile: true };
	const phone = await viewPage('view-phone', 'salmons-view-phone', PHONE);
	const PHONE_SENT = ['up25', 'up12', 'down26', 'across5'];
	const onPhone = await phone.until(saysOn(PHONE), PHONE_SENT);
	writeFileSync(join(out, 'view-phone.png'), await phone.game.page.screenshot());
	verdict(
		'view: a 390 × 844 phone says its own view, at the phone’s zoom',
		phone.bots && same(phone.alone.says, saysOn(PHONE)) && same(onPhone.roomHolds, saysOn(PHONE)),
		{ says: onPhone.says, roomHolds: onPhone.roomHolds, expected: saysOn(PHONE) },
	);
	// 25 cells up-river is off the phone's screen and inside the box: sent, as before the view (a
	// device is never sent less than the box). 36 cells is past both.
	const fromOwn = (name) => VIEW_GAMES['salmons-view-phone'][name].map((cells) => cells * CELL);
	const { nearby } = viewGame.online;
	verdict(
		'view: the phone is sent what the box sends: the bear 25 cells up-river, off its screen, and none past the box',
		same(onPhone.sent, PHONE_SENT) &&
			same(onPhone.drawn, PHONE_SENT) &&
			regionHolds(boxRegion(nearby), ...fromOwn('up25')) &&
			!regionHolds(viewRegion(nearby, saysOn(PHONE)), ...fromOwn('up25')) &&
			!regionHolds(boxRegion(nearby), ...fromOwn('up36')),
		{ ...onPhone, nearby },
	);
	verdict(
		`view: its pages play the ${opt.netcode} netcode`,
		onQhd.netcode === opt.netcode && onPhone.netcode === opt.netcode,
		{ desktop: onQhd.netcode, phone: onPhone.netcode },
	);
	const viewErrors = [];
	for (const { game } of [wide, phone])
		viewErrors.push(...(await game.page.evaluate('window.__AR_ERRORS__').catch(() => [])));
	verdict('no page error on the view pages', viewErrors.length === 0, { viewErrors });
	for (const { game } of [wide, phone]) await game.page.close();

	// A bot salmon wins (owner, 2026-11-21): a bear's page in a test room of 10 on the exported
	// game. No person's salmon is in it, so the first bot salmon at the source wins the game: the
	// page hears `gameWon` for the bot, by its name, and its win screen says "NAME won!!!" with no
	// eggs, never "You Won!". A game there lasts about 100 s (`measure-room.mjs --size 10`).
	const bw = await boot('bot-win', { rooms_name: 'Bea', rooms_character: 'bear', room_size: '10' });
	const bwStart = Date.now();
	let botWon;
	for (let i = 0; i < 1200 && !botWon && Date.now() - bwStart < 300_000; i++) {
		await bw.settle(250);
		botWon = ((await bw.state()).arcade?.online?.events ?? []).find((e) => e.type === 'gameWon');
	}
	result.measures.botWinSeconds = botWon ? Math.round((Date.now() - bwStart) / 1000) : null;
	let botWinScreen;
	for (let i = 0; i < 20 && !botWinScreen?.shown; i++) {
		await bw.settle(150);
		botWinScreen = (await bw.state()).arcade?.online?.screens?.won;
	}
	await bw.settle(1500);
	botWinScreen = (await bw.state()).arcade?.online?.screens?.won;
	writeFileSync(join(out, 'bot-won.png'), await bw.page.screenshot());
	const bwOnline = (await bw.state()).arcade?.online ?? {};
	verdict(
		'a room of 10: a bot salmon at the source wins the game, `gameWon` naming the bot',
		!!botWon &&
			botWon.winner.startsWith('bot:') &&
			/^Bot \d+$/.test(botWon.winnerName) &&
			botWon.winner !== bwOnline.me,
		{ botWon, me: bwOnline.me, seconds: result.measures.botWinSeconds },
	);
	verdict(
		'…and the bear’s win screen says “NAME won!!!” for the bot, with no eggs and no “You Won!”',
		botWinScreen?.shown === true &&
			botWinScreen.title === `${botWon?.winnerName} won!!!` &&
			botWinScreen.eggs === 0 &&
			(await bw.shown()).includes('salmonsWon'),
		{ botWinScreen },
	);
	const bwErrors = await bw.page.evaluate('window.__AR_ERRORS__').catch(() => []);
	verdict('no page error on the bot’s win', bwErrors.length === 0, { bwErrors });
	await bw.page.close();
} finally {
	server.stop();
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	await snap.close();
	await snapProjectArt.close();
	await snapCliff.close();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
console.log(`  measures: ${JSON.stringify(result.measures)}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(
	failed ? `\nsalmons levels play: ${failed} FAILED` : `\nsalmons levels play: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
