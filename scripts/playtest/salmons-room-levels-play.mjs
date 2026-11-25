// SALMONS: A DEVICE PLAYS ITS ROOM'S LEVELS (owner, 2026-11-25: "changing the seed generates a new
// level, but does not update collisions"), in a headless shell against a real game server on
// localhost. The room is given the PUBLISHED config (no `arcade.online.levels`: the original's
// river) and the page the LIVE one (`SALMONS_LEVELS`: the winding river, the tall waterfalls), as a
// launcher link booted between a Save levels in `/editor` and a Publish.
//
// Five pages, one after the other:
//  - `authoring` (`ie_authoring=1`, live config, published room): the page adopted the room's
//    levels, names river and waterfalls as what differed, made a level with the room's fingerprint,
//    predicts on the room's zones and drew the room's rocks, whirlpools and waterfalls; the notice
//    is on screen over the game, small, and stays; a pointer on its words reaches the game under
//    it; its ✕ takes it away and the game goes on.
//  - `player` (no `ie_authoring`, the same drift): the same adoption, and no notice.
//  - `equal` (`ie_authoring=1`, the room's own config): nothing adopted, no notice.
//  - `reverse` (`ie_authoring=1`, published config, a room of the live one): the winding river
//    adopted, and the notice.
//  - `refused` (`ie_authoring=1`): a room made by another release of the generator (one rock a
//    pixel over, for the time the room is made). The page cannot make that level from the room's
//    own levels: it leaves the room and stops on the error screen, which says to reload.
// Screenshots at 2× go to `--out` (`authoring-notice.png` whole, `authoring-notice-detail.png` the
// strip, `authoring-dismissed.png`, and one per other page); `result.json` holds the verdicts.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-room-levels-play.mjs --runtime apps/lines/build --out <dir> \
//     [--chrome <exe>]
//
// The runtime must play arcade: build it with
// `PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build`.
// Exit 1 when a verdict fails. What is decided, over many seeds and configs, is `pnpm
// check:room-levels`'s, not this run's.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

import {
	ONLINE_GENERATORS,
	generatedOnlineGame,
} from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { SALMONS_LEVELS, salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import {
	SALMONS_MAP_SEED,
	levelShape,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import {
	normalizeGameConfigDoc,
	onlineGameOf,
	shapedOnlineGame,
	withLevelsShape,
	withOnlineCarry,
	withOnlineSlide,
	withSlide,
	withTouchSchemes,
} from '../../packages/game-config/index.ts';
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
		out: { type: 'string', default: join(ROOT, '.cache/salmons-room-levels-play') },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });

const result = { verdicts: [], pages: {} };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), 'salmons-room-levels-play-'));

/**
 * Salmons' config as its export ships it (`scripts/salmons/export.mjs`: no level snapshot, the
 * blocks the normalizer drops carried past it) with `levels` as its `arcade.online.levels`; still
 * bears only, so nothing hunts the page's salmon.
 */
const shipped = (levels) => {
	const river = salmonsMapRiver(SALMONS_MAP_SEED, undefined, levelShape(levels));
	const authored = salmonsConfig(river, { levels });
	authored.arcade.online.bots.characters = [{ character: 'bear', brain: 'bearBot' }];
	for (const character of authored.arcade.characters)
		character.brain = {
			initial: 'rest',
			states: [{ id: 'rest', behaviour: 'idle' }],
			transitions: [],
		};
	delete authored.arcade.zones;
	delete authored.arcade.online.rules.zones;
	return withLevelsShape(
		withSlide(
			withOnlineCarry(withTouchSchemes(normalizeGameConfigDoc(authored), authored), authored),
			authored,
		),
		authored,
	);
};
/** The two configs of 2026-11-25: the published snapshot had no `levels`, the live config these. */
const CONFIGS = { published: shipped(undefined), live: shipped(SALMONS_LEVELS) };
/** A game as a page resolves the config it booted with (`online.ts` `joinOnlineRoom`). */
const deviceGame = (baked) =>
	shapedOnlineGame(
		withOnlineSlide(onlineGameOf(normalizeGameConfigDoc(baked) ?? null), baked),
		baked,
	);

const configs = join(work, 'configs');
mkdirSync(configs);
const ROOM_GAME = { published: 'salmons-published', live: 'salmons-live' };
for (const [name, config] of Object.entries(CONFIGS))
	writeFileSync(join(configs, `${ROOM_GAME[name]}.json`), JSON.stringify(config));
/** The live config under a key of its own: the room the `refused` page is sent to. */
const DRIFT_GAME = 'salmons-drift';
writeFileSync(join(configs, `${DRIFT_GAME}.json`), JSON.stringify(CONFIGS.live));

const doc = salmonsReferenceLayout(salmonsMapRiver(SALMONS_MAP_SEED));
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);
const KEY = 'salmons';
const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'freePlay',
	name: 'Salmons',
	projectKey: KEY,
});
const server = await startTestServer(tree, {});
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(join(snapshot, 'runtime.json'), JSON.stringify({}));
/** The launcher's answer to a boot, by the config it hands the page. */
const snaps = {};
for (const [name, config] of Object.entries(CONFIGS)) {
	const bundleFile = join(work, `runtime-${name}.json`);
	writeFileSync(
		bundleFile,
		JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
	);
	snaps[name] = await serveSnapshot({
		dir: snapshot,
		bundleFile,
		name: 'Salmons',
		snapshotId: `salmons-${name}`,
		assetBase: `${server.origin}/${KEY}/`,
	});
}
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 12,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;
const WINDOW = { w: 1280, h: 720 };
const NOTICE_ID = 'ie-room-levels-notice';

/** The notice as the page shows it, or `null`: its text, its box, its ✕, whether a click on the
 *  ✕ reaches the ✕ (on top), whether one on its words reaches what is under it (`passes`), and
 *  whether the middle of the game is clear of it. */
const noticeOf = (page) =>
	page.evaluate(`(() => {
		const notice = document.getElementById(${JSON.stringify(NOTICE_ID)});
		if (!notice) return null;
		const box = notice.getBoundingClientRect();
		const close = notice.querySelector('button');
		const closeBox = close.getBoundingClientRect();
		const at = (x, y) => document.elementFromPoint(x, y);
		return {
			text: notice.querySelector('span').textContent,
			box: { x: box.x, y: box.y, w: box.width, h: box.height },
			close: {
				label: close.getAttribute('aria-label'),
				x: closeBox.x + closeBox.width / 2,
				y: closeBox.y + closeBox.height / 2,
			},
			onTop: at(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2) === close,
			passes: !notice.contains(at(box.x + 24, box.y + box.height / 2)),
			overTheMiddle: notice.contains(at(innerWidth / 2, innerHeight / 2)),
			shown: getComputedStyle(notice).visibility !== 'hidden' && box.width > 0 && box.height > 0,
		};
	})()`);

/** The room's own record of the session `id`: its sim and the state it sends. */
const roomWith = async (id) => {
	for (const listed of await matchMaker.query({})) {
		const room = matchMaker.getLocalRoomById(listed.roomId);
		if (room?.sim?.players.has(id)) return room;
	}
	return undefined;
};

/** Open a page of `config` on a room of the game `roomGame`: the launcher's link when
 *  `authoring`. */
async function open(name, { config, roomGame, authoring }) {
	const page = await openPage(headlessShell(opt.chrome), join(work, name));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: WINDOW.w,
		height: WINDOW.h,
		deviceScaleFactor: 2,
		mobile: false,
	});
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'room-levels-play',
		editorDocBase: snaps[config].origin,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		rooms_character: 'salmon',
		rooms_name: name,
		rooms_game: roomGame,
		...(authoring ? { ie_authoring: '1' } : {}),
	});
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	return page;
}

/** Boot a page of `config` in a room of `roomConfig`, to the game on screen with its art drawn. */
async function boot(name, { config, roomConfig, authoring }) {
	const page = await open(name, { config, roomGame: ROOM_GAME[roomConfig], authoring });
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
	for (let i = 0; i < 120; i++) {
		await settle(500);
		if ((await state()).arcade?.online?.art) break;
	}
	return { page, state, settle };
}

/** What every page must hold: its level is its room's, and the report of how it got there. */
async function levelVerdicts(name, game, { config, differs }) {
	const online = (await game.state()).arcade?.online ?? {};
	const room = await roomWith(online.me);
	const sim = room?.sim;
	const said = { levels: room?.state.levels, levelHash: room?.state.levelHash };
	verdict(
		`${name}: the page's report — ${differs.length ? `adopted, ${differs.join(' and ')} differ` : 'nothing adopted'}, its fingerprint the room's`,
		!!sim &&
			/^[0-9a-f]{16}$/.test(said.levelHash ?? '') &&
			isDeepStrictEqual(online.level, {
				adopted: differs.length > 0,
				differs,
				levelHash: said.levelHash,
				roomLevelHash: said.levelHash,
			}),
		{ level: online.level, room: said },
	);
	const zones = (g) => g.zones.map((z) => [z.id, z.x, z.y, z.w, z.h]);
	verdict(
		`${name}: the page predicts on the room's zones and drew its field`,
		!!sim &&
			online.seed === sim.seed &&
			online.fieldDrawn === true &&
			isDeepStrictEqual(online.zones, zones(sim.game)),
		{ seed: [online.seed, sim?.seed], zones: [online.zones?.length, sim?.game.zones.length] },
	);
	// What the page made before this change: its own config's level of the room's seed.
	const own = sim && generatedOnlineGame(deviceGame(CONFIGS[config]), sim.seed);
	const drifts = !!own && !isDeepStrictEqual(zones(own.game), zones(sim.game));
	verdict(
		`${name}: its own config's level of that seed ${differs.length ? 'is another river' : 'is the room’s'}`,
		drifts === differs.length > 0,
		{ own: own?.game.zones.length, room: sim?.game.zones.length },
	);
	const regions = online.art?.regions ?? {};
	const sum = (prefix) =>
		Object.entries(regions)
			.filter(([region]) => region.startsWith(prefix))
			.reduce((n, [, count]) => n + count, 0);
	const made = sim?.made;
	verdict(
		`${name}: the art drew the room's level (its rocks, whirlpools and waterfalls)`,
		!!made &&
			sum('rock_') === made.rocks.length &&
			sum('whirlpool_') === made.whirlpools.length * 4 &&
			(regions.waterfall_face ?? 0) === made.waterfalls.length * 2,
		{
			rocks: [sum('rock_'), made?.rocks.length, own?.made.rocks.length],
			whirlpools: [sum('whirlpool_') / 4, made?.whirlpools.length, own?.made.whirlpools.length],
			faces: [regions.waterfall_face, made && made.waterfalls.length * 2],
		},
	);
	result.pages[name] = { seed: online.seed, level: online.level, said };
}

const noErrors = async (name, game) => {
	const errors = await game.page.evaluate('window.__AR_ERRORS__').catch(() => []);
	verdict(`${name}: no page error`, errors.length === 0, { errors });
};

const NOTICE =
	'This room plays the level settings published when it opened, not the ones saved in the ' +
	'editor (different: river and waterfalls). Publish in Game Maker to play yours in new rooms.';

/** The notice is up over the game: its words, its ✕ on top, a pointer on its words let through,
 *  small, clear of the middle of the screen. */
const noticeVerdict = (name, notice) =>
	verdict(
		`${name}: the notice is on screen, names river and waterfalls, and does not cover the game`,
		!!notice &&
			notice.shown &&
			notice.text === NOTICE &&
			notice.onTop &&
			notice.passes &&
			!notice.overTheMiddle &&
			notice.close.label === 'Dismiss' &&
			notice.box.x >= 0 &&
			notice.box.y >= 0 &&
			notice.box.x + notice.box.w <= WINDOW.w &&
			notice.box.w * notice.box.h < 0.05 * WINDOW.w * WINDOW.h,
		notice,
	);

try {
	// --- An authoring boot: the launcher's link, between Save levels and Publish ----------------
	{
		const name = 'authoring';
		const game = await boot(name, { config: 'live', roomConfig: 'published', authoring: true });
		await levelVerdicts(name, game, { config: 'live', differs: ['river', 'waterfalls'] });
		// Past the boot splash's fade, so the screenshot is the game with the notice over it.
		await game.settle(2000);
		const notice = await noticeOf(game.page);
		noticeVerdict(name, notice);
		writeFileSync(join(out, 'authoring-notice.png'), await game.page.screenshot());
		if (notice) {
			const pad = 12;
			const { result: shot } = await game.page.page('Page.captureScreenshot', {
				format: 'png',
				clip: {
					x: Math.max(0, notice.box.x - pad),
					y: Math.max(0, notice.box.y - pad),
					width: notice.box.w + 2 * pad,
					height: notice.box.h + 2 * pad,
					scale: 2,
				},
			});
			writeFileSync(join(out, 'authoring-notice-detail.png'), Buffer.from(shot.data, 'base64'));
		}
		// It stays while the game is played.
		const before = (await game.state()).frame;
		await game.settle(4000);
		const later = await noticeOf(game.page);
		const frames = (await game.state()).frame - before;
		verdict(`${name}: the notice stays while the game runs`, !!later && later.shown && frames > 0, {
			frames,
			later: !!later,
		});
		// Its ✕ takes it away; the game is still there and still stepping.
		if (later) {
			const point = { x: Math.round(later.close.x), y: Math.round(later.close.y) };
			await game.page.mouse('mouseMoved', point.x, point.y);
			await game.page.mouse('mousePressed', point.x, point.y);
			await game.page.mouse('mouseReleased', point.x, point.y);
		}
		const steps = (await game.state()).arcade?.steps ?? 0;
		await game.settle(1500);
		const after = await game.state();
		verdict(
			`${name}: its ✕ dismisses it, and the game goes on in the room`,
			(await noticeOf(game.page)) === null &&
				(after.arcade?.steps ?? 0) > steps &&
				after.arcade?.online?.level?.adopted === true,
			{ steps: [steps, after.arcade?.steps] },
		);
		writeFileSync(join(out, 'authoring-dismissed.png'), await game.page.screenshot());
		await noErrors(name, game);
		await game.page.close();
	}

	// --- A player's boot with the same drift: the same level, and nothing said ------------------
	{
		const name = 'player';
		const game = await boot(name, { config: 'live', roomConfig: 'published', authoring: false });
		await levelVerdicts(name, game, { config: 'live', differs: ['river', 'waterfalls'] });
		await game.settle(2000);
		verdict(`${name}: no notice`, (await noticeOf(game.page)) === null);
		writeFileSync(join(out, 'player.png'), await game.page.screenshot());
		await noErrors(name, game);
		await game.page.close();
	}

	// --- The room's own config: nothing to adopt, nothing to say --------------------------------
	{
		const name = 'equal';
		const game = await boot(name, {
			config: 'published',
			roomConfig: 'published',
			authoring: true,
		});
		await levelVerdicts(name, game, { config: 'published', differs: [] });
		await game.settle(2000);
		verdict(`${name}: no notice`, (await noticeOf(game.page)) === null);
		writeFileSync(join(out, 'equal.png'), await game.page.screenshot());
		await noErrors(name, game);
		await game.page.close();
	}

	// --- The other way round: a room of the winding river, a page of the original's -------------
	{
		const name = 'reverse';
		const game = await boot(name, { config: 'published', roomConfig: 'live', authoring: true });
		await levelVerdicts(name, game, { config: 'published', differs: ['river', 'waterfalls'] });
		await game.settle(2000);
		noticeVerdict(name, await noticeOf(game.page));
		writeFileSync(join(out, 'reverse-notice.png'), await game.page.screenshot());
		await noErrors(name, game);
		await game.page.close();
	}

	// --- A room of another release of the generator: the page leaves and says to reload ---------
	{
		const name = 'refused';
		const original = ONLINE_GENERATORS.salmonsMap;
		ONLINE_GENERATORS.salmonsMap = {
			...original,
			make: (...args) => {
				const made = original.make(...args);
				return { ...made, rocks: made.rocks.map((r, i) => (i ? r : { ...r, x: r.x + 1 })) };
			},
		};
		let page;
		let screen = null;
		try {
			page = await open(name, { config: 'live', roomGame: DRIFT_GAME, authoring: true });
			for (let i = 0; i < 600 && !screen; i++) {
				await wait(100);
				screen = await page
					.evaluate(
						`(() => {
							const overlay = document.getElementById('ie-stale-data-banner');
							return overlay && {
								text: overlay.textContent,
								reload: !!overlay.querySelector('button'),
								covers: overlay.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2)),
								stale: window.__IE_RUNTIME_STALE__?.reason ?? null,
								playing: !!window.__IE_DETERMINISM__?.state().arcade,
							};
						})()`,
					)
					.catch(() => null);
			}
		} finally {
			ONLINE_GENERATORS.salmonsMap = original;
		}
		const REASON =
			'this online game could not join a room: the room plays a level this game cannot make ' +
			'from its seed (the game and the game server are of different versions): reload, or ' +
			'try again in a few minutes';
		// The reason ends with the two fingerprints, the page's and the room's, which differ.
		const stale = String(screen?.stale ?? '');
		const hashes = /^ \[level ([0-9a-f]{16}), the room's ([0-9a-f]{16})\]$/.exec(
			stale.startsWith(REASON) ? stale.slice(REASON.length) : '',
		);
		verdict(
			`${name}: the page stops on the error screen, with Reload and the reason`,
			!!screen &&
				screen.covers &&
				screen.reload &&
				!screen.playing &&
				!!hashes &&
				hashes[1] !== hashes[2] &&
				screen.text.includes('please reload') &&
				screen.text.includes(`Reason: ${stale}`),
			screen,
		);
		verdict(`${name}: no notice`, !!page && (await noticeOf(page)) === null);
		// It left: no room of that game holds a person.
		await wait(1000);
		const people = (await matchMaker.query({}))
			.filter((listed) => listed.metadata?.game === DRIFT_GAME)
			.map((listed) => listed.metadata.players);
		verdict(
			`${name}: the page left the room`,
			people.every((n) => n === 0),
			{ people },
		);
		if (page) {
			writeFileSync(join(out, 'refused.png'), await page.screenshot());
			await page.close();
		}
	}
} finally {
	server.stop();
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	for (const snap of Object.values(snaps)) await snap.close();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts)
	console.log(
		`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}${v.ok ? '' : ` ${JSON.stringify(v.detail)}`}`,
	);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(
	failed ? `\nsalmons room levels: ${failed} FAILED` : `\nsalmons room levels: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
