// Plays SALMONS (game-families P10.16) on the shared runtime, in two headless shells against a
// real game server (services/game-server) on localhost: the river a seed made, its online config
// (`engine-mechanics` `salmons.js`: 100 players, here with bear bots by count that keep each room
// at 20, the river's currents and banks, catches, the source as the goal, nearby-only state)
// and its layout (`engine-layout` `salmonsReferenceLayout`, placeholder looks until the S0 art).
//
// It reads each page's arcade probe (`state().arcade`: the room's step and the players the page is
// sent, `online.drawn`, `camera`) and checks: both pages join one room and the bots fill it to 20;
// each page is sent only the players near its own (the bear on its bank is not sent to the salmon
// at the sea); page A's camera frames its own salmon; ArrowUp held on page A swims its salmon
// upstream and the camera follows; at rest page A draws its own salmon where the room has it; nothing
// reached an RGS; no page error. With P11.2 it plays Salmons' flow (`engine-flow-v2`
// `SALMONS_SEED_DOC`) too: no HUD (the original has none), the room's status a variable the room
// owns; page B's Space swipes the bear on the press, before the room tells of it; and page C, in a
// room of its own whose rounds last 5 s (`rooms_game=salmons-short`), hears a round end on its
// clock (no game won: no win screen) and the next start. P11.2 (e): each room plays a river of its own, made from
// the seed its state carries — pages A and B (one room) make the same river, page C (another room)
// a different one, each the river whose sea the server started its salmon at. P11.3: page E, in a
// room of the authored river that starts its salmon below a waterfall, is stopped at the foot and
// climbs it by tapping Space; page F, below a sandbank, is grounded on it and jumps off. P11.4: the
// river screen is isometric, and page A's salmon is drawn at its projected place. After P11.3
// (the visual fixes): pages G (a salmon on a sandbank) and H (a fisherman on the bank by it) share
// a room of the authored river: G's salmon, the room's only one, is golden and both pages draw it
// gold; H's cast hooks it and both draw the line until it is landed, and again until H leaves (the
// line breaks); page G2 then takes the golden salmon over (no banner). The rules' events
// (`climbed`, `grounded`, `jumped`, `hooked`, `escaped`, `golden`) reach each page's flow. The
// original art (built in, `engine-layout/salmons-art`): each page whose config names the
// `salmonsRiver` generator draws the river in the old game's images (grass, trees, rocks,
// whirlpools, waterfalls) and its characters as code looks (the salmon a rope through its pink or
// golden texture, the bear's sprite and its swipe, the fisherman's circle, the line 0xddddaa from
// his hand); a published clip still wins (page S). The pages boot the snapshot's config, which names
// the generator, so every page draws the art. The playbook is docs/playtest/salmons.md. It builds its own
// snapshot and config, so the current-games harness is not touched. `--netcode colyseus` plays it
// with the Colyseus SDK's own prediction (`arcade.online.netcode`): a nearby room and the world
// camera under that netcode; the pages must report the mode they ran.
//
// `--sheet` plays ONE room instead of all the above (character pipeline C2a): page Z's salmon is of
// a class that names a character sheet (`arcade.online.characters[].sheet`), in the config the page
// boots as a publish bakes it (not normalized: the normalizer drops a sheet). Its sheet names
// another clip prefix (`salmon_sheet`) than the game's own table (`salmon_pink`, whose clips are
// registered too) and an action on an event no `characterClips` block can hear (`grounded`), so
// the page's clip log says which of the two drew it.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>] \
//     [--netcode engine|colyseus] [--sheet] [--rig] [--hold] [--turn] [--trees] [--zone-rig]
//
// `--trees` plays ONE room too (zone art's scenery, docs/design/zone-art.md): page T boots the game
// with `arcade.zoneArt['@trees']` set to a magenta frame of a stub sheet exported as a publish
// exports one, in the room of the game's own config (zone art is cosmetic). Every tree of its
// river is drawn with the frame and none with the built-in trees, the rest of the river is drawn
// in the original images as without it, and the magenta is on screen.
//
// `--zone-rig` plays ONE room too (zone art's rig source, docs/design/zone-art.md): page ZR boots
// the game with `arcade.zoneArt['rock#']` and `['whirlpool#']` drawn by a stub rig exported as a
// publish exports one (`editorArt.spines`, named in `characterArt`): one slot whose `blink` shows
// a cyan drawing, then a yellow one, every second. Every rock and whirlpool of its river is drawn
// with the rig and none with the built-in pictures, the rest of the river as without it, the rig's
// colours are on screen and change as it plays. Trees are never a rig (`game-config`
// `zoneArtTakesRig`); what 430 rigs cost is measured by `zone-art-play.mjs --cost`.
//
// `--rig` plays ONE room too (character pipeline C6a): page R's salmon is of a class whose sheet
// names a RIG (one rig for every facing: a swim named for the action alone, a hop named for one
// facing), page G's the same salmon golden, in the skin its `marked` variant names, and page B's
// bear of a class whose sheet is STILL IMAGES (one frame of a project sheet for every action,
// another for its swipe). The rig and the sheet ship as
// a publish ships them (`editorArt.spines`, `editorArt.sheets`); neither character has a clip.
//
// `--hold` plays ONE room too (the hold play mode): page K's bear catches page Q's salmon, whose
// class's sheet is Salmons' own block made a sheet with its `caught` set to hold. The catch clip's
// last frame is the one magenta frame of the run: on K the salmon put out stays drawn on it, with
// no other clip, for seconds, and once Q leaves it is drawn no more.
//
// The bear wades (2026-11-25, `engine-layout` `salmonsArt/wade.ts`): pages WB (a bear) and WF (a
// fisherman) share a room of the original's level (`salmonsMap`, one seed pinned, no bots), whose
// water a bear walks into. The room stands the bear on a bank, WB's keys walk it into the water,
// and the room stands it in open water, then on the bank again, and the fisherman on a bridge's
// deck: the probe (`online.art.wading`) and the screenshots say the bear on the bank is drawn as
// ever with no filter, steps in over about 250 ms, stands with its fur above a waterline and the
// same fur under the water's tint below it, and steps out; the fisherman over the water is no
// wader.
//
// `--turn` plays the smooth turn (`view.turn`, character pipeline §13) in two rooms: page T's
// salmon is of a class whose sheet is frame clips in eight facings with the option on (five made,
// the three western ones their twins mirrored), page U's bear of a class whose sheet is still
// images without it, and page V's salmon of a class whose sheet is a rig with it. Both sheets
// have `turn: {}`, as an owner saves it: on an isometric view a picture tilts on the screen up to
// 8° either way, in proportion to the heading's distance from its facing's middle, and changes in
// one frame at the halfway point, with no cross-fade and its cycle carried on. T and V swim a
// reversal and a circle a frame at a time; each frame's lean, its facing and what the stage draws
// (the clip's sprites and the frame of its cycle, the rig's views and its phase) are read off the
// page, and cropped screenshots are taken, one a frame across the reversal's changes of picture.
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';

import { PNG } from 'pngjs';

import { generatedOnlineGame } from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { salmonsConfig, salmonsRiver } from '../../packages/engine-mechanics/src/salmons.js';
import {
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { CLIP_FACINGS, clipMirrorOf } from '../../packages/engine-layout/src/lib/characterClips.ts';
import { sheetOfCharacterClips } from '../../packages/engine-layout/src/lib/characterSheet.ts';
import {
	SHEET_TURN_BACK_BAND,
	facingHeading,
	wrapAngle,
} from '../../packages/engine-layout/src/lib/characterTurn.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CAMERA,
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_CHARACTER_CLIPS } from '../../packages/engine-layout/src/lib/referenceLayouts/salmonsClips.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import {
	normalizeGameConfigDoc,
	onlineGameOf,
	withZoneArt,
	zoneArtArtNames,
} from '../../packages/game-config/index.ts';
import { heldBy } from '../../services/game-server/src/addresses.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { issuePass } from '../../services/game-server/src/arcadeRoom.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { BLINK_RIG, CYAN, YELLOW, exportStubRig } from './fixtures/zoneRigStubs.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
// The game server's own matchmaker (it runs in this process): the wading's room is reached by it.
const { matchMaker } = await import(
	pathToFileURL(
		createRequire(join(ROOT, 'services/game-server/package.json')).resolve('@colyseus/core'),
	).href
);
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/salmons-play') },
		chrome: { type: 'string' },
		netcode: { type: 'string', default: 'engine' },
		sheet: { type: 'boolean', default: false },
		rig: { type: 'boolean', default: false },
		hold: { type: 'boolean', default: false },
		turn: { type: 'boolean', default: false },
		trees: { type: 'boolean', default: false },
		'zone-rig': { type: 'boolean', default: false },
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
// Each room makes its own river, bots' banks included, so the bots here are bears that stand still:
// nothing hunts page A's salmon while it swims (the hunt is check:room-bots').
const authored = salmonsConfig(river);
// By count (no share): the room is kept at 20, as before the room's own mix.
authored.arcade.online.bots.characters = [{ character: 'bear', brain: 'bearBot' }];
for (const character of authored.arcade.characters)
	character.brain = {
		initial: 'rest',
		states: [{ id: 'rest', behaviour: 'idle' }],
		transitions: [],
	};
authored.arcade.online.netcode = opt.netcode;
const config = normalizeGameConfigDoc(authored);
const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'salmons-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
);
const configs = join(work, 'configs');
mkdirSync(configs);
writeFileSync(join(configs, `${KEY}.json`), JSON.stringify(config));
// The same game with 5 s rounds and 3 s between them, for page C's round over (Salmons itself plays
// one game a room, won at the source).
const SHORT = 'salmons-short';
const short = structuredClone(authored);
short.arcade.online.rules.round = { seconds: 5, nextRoundSeconds: 3 };
delete short.arcade.online.bots;
writeFileSync(join(configs, `${SHORT}.json`), JSON.stringify(normalizeGameConfigDoc(short)));
writeFileSync(join(configs, 'salmons-noriver.json'), JSON.stringify(normalizeGameConfigDoc(short)));
// P11.3: rooms that play the authored river (no generator, no bots), each salmon starting just
// below a waterfall (page E) or a sandbank (page F) of it.
const FALL = river.waterfalls[0];
const BELOW = river.bands.find((band) => band.y === FALL.y + FALL.h / 2);
const ROCK = river.rocks.find((r) => r.y < BELOW.y + BELOW.h && r.y + r.h > BELOW.y);
const midBelow = (BELOW.left + BELOW.right) / 2;
const FALL_X =
	!ROCK || midBelow < ROCK.x - 60 || midBelow > ROCK.x + ROCK.w + 60
		? midBelow
		: ROCK.x - BELOW.left > BELOW.right - ROCK.x - ROCK.w
			? ROCK.x - 70
			: ROCK.x + ROCK.w + 70;
const SAND = river.sandbanks[0];
/** The whirlpool just below the sandbank, which page S's swim must keep out of. */
const POOL = river.whirlpools
	.filter((p) => p.y > SAND.y + SAND.h)
	.sort((a, b) => a.y - b.y)
	.find((p) => p.y - p.r < SAND.y + SAND.h + 600);
/** Start `game`'s salmon at `at`: the band river's salmon class names its own start (the river's
 *  spawn), which the game's `spawn` alone no longer moves. */
const salmonAt = (game, at) => {
	game.arcade.online.spawn = at;
	for (const character of game.arcade.online.characters)
		if (character.id === 'salmon') character.spawns = [at];
};
const ruleRoom = (name, spawn) => {
	const game = structuredClone(short);
	delete game.arcade.online.generator;
	salmonAt(game, spawn);
	game.arcade.online.rules.round = authored.arcade.online.rules.round;
	writeFileSync(join(configs, `${name}.json`), JSON.stringify(normalizeGameConfigDoc(game)));
};
ruleRoom('salmons-falls', { x: FALL_X, y: FALL.y + FALL.h + 22 + 80 });
ruleRoom('salmons-sand', { x: SAND.x + SAND.w / 2, y: SAND.y + SAND.h + 80 });
ruleRoom('salmons-clips', { x: SAND.x + SAND.w / 2, y: SAND.y + SAND.h + 80 });
// The game won: a salmon starting just below the source (page W).
const WIN_GAME = 'salmons-win';
ruleRoom(WIN_GAME, {
	x: river.source.x + river.source.w / 2,
	y: river.source.y + river.source.h + 120,
});
// After P11.3: a salmon starting on the sandbank (held there, grounded) and a fisherman on the far
// bank (a cast reaches any water): the reel home (8 tiles/s) is long enough to see and to break.
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
{
	const game = structuredClone(short);
	delete game.arcade.online.generator;
	salmonAt(game, LINE_AT);
	for (const character of game.arcade.online.characters)
		if (character.id === 'fisherman') character.spawns = [FISHER_AT];
	game.arcade.online.rules.round = authored.arcade.online.rules.round;
	const line = JSON.stringify(normalizeGameConfigDoc(game));
	writeFileSync(join(configs, 'salmons-line.json'), line);
	// The same game for the clip-drawn fisherman's pages (X, Y, V), in a room of their own.
	writeFileSync(join(configs, 'salmons-catcher.json'), line);
}
// The bloodstain: a salmon in open water by a bank (no rock, sandbank or whirlpool near, no
// rapids), and a bear on that bank a little downstream: the current carries the salmon past him,
// within his swipe.
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
{
	const game = structuredClone(short);
	delete game.arcade.online.generator;
	salmonAt(game, BLOOD_AT);
	for (const character of game.arcade.online.characters)
		if (character.id === 'bear')
			character.spawns = [{ x: BLOOD_BAND.left - 40, y: BLOOD_AT.y + 60 }];
	game.arcade.online.rules.round = authored.arcade.online.rules.round;
	writeFileSync(join(configs, 'salmons-blood.json'), JSON.stringify(normalizeGameConfigDoc(game)));
}
// The bear wades: the original's level, whose water a bear walks into (the band river's stops
// it), pinned to one seed so that the room's river is the one made here, with no bots.
const WADE_GAME = 'salmons-wade';
const wadeRiver = salmonsMapRiver(SALMONS_MAP_SEED);
/** `salmonsConfig` of the original's level as a wading's room plays it; `edit` changes it first. */
const wadeGame = (edit = () => {}) => {
	const game = salmonsConfig(wadeRiver);
	delete game.arcade.online.bots;
	game.arcade.online.netcode = opt.netcode;
	game.arcade.online.levels = { seeds: [SALMONS_MAP_SEED] };
	edit(game);
	return game;
};
const wadeConfig = normalizeGameConfigDoc(wadeGame());
writeFileSync(join(configs, `${WADE_GAME}.json`), JSON.stringify(wadeConfig));

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
// The same game with a layout that lost its `river` node: page D must stop before it plays.
const noRiver = join(work, 'runtime-noriver.json');
writeFileSync(
	noRiver,
	JSON.stringify({
		doc: {
			...doc,
			scenes: doc.scenes.map((scene) => ({
				...scene,
				nodes: scene.nodes.filter((node) => node.id !== 'river'),
			})),
		},
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: SALMONS_SEED_DOC,
	}),
);
const snapNoRiver = await serveSnapshot({
	dir: snapshot,
	bundleFile: noRiver,
	name: 'Salmons',
	snapshotId: 'salmons-noriver',
	assetBase: `${server.origin}/${KEY}/`,
});
// The wading's pages boot the original's level: the same layout, whose river the room's replaces.
const withWade = join(work, 'runtime-wade.json');
writeFileSync(
	withWade,
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config: wadeConfig,
		flowV2: SALMONS_SEED_DOC,
	}),
);
const snapWade = await serveSnapshot({
	dir: snapshot,
	bundleFile: withWade,
	name: 'Salmons',
	snapshotId: 'salmons-wade',
	assetBase: `${server.origin}/${KEY}/`,
});
// S0: the same game with three stub clips of the salmon (no bear or fisherman clips), exported as
// a publish would: a sheet under `deploy/editor-art/`, listed in `editorArt`, and the clips in
// `flipbooks`. Each frame is a 32 × 64 box, drawn 90 wide (the salmon's body): 180 px tall, far
// above the 44 px placeholder.
const CLIP_SHEET = 'invisible_wall/salmons/manifests/atlas_manifest_S_SalmonStub.json';
const CLIP_RGB = [0x30, 0xd0, 0x30];
mkdirSync(join(snapshot, 'deploy', 'editor-art'), { recursive: true });
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'S_SalmonStub.png'),
	png(128, 64, () => CLIP_RGB),
);
const stubFrame = (i) => ({
	frame: { x: i * 32, y: 0, w: 32, h: 64 },
	rotated: false,
	trimmed: false,
	spriteSourceSize: { x: 0, y: 0, w: 32, h: 64 },
	sourceSize: { w: 32, h: 64 },
});
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'S_SalmonStub.json'),
	JSON.stringify({
		frames: Object.fromEntries([0, 1, 2, 3].map((i) => [`stub${i}`, stubFrame(i)])),
		meta: { image: 'S_SalmonStub.png', format: 'RGBA8888', size: { w: 128, h: 64 }, scale: '1' },
	}),
);
const stubClip = (id, frames, loop) => ({
	id,
	name: id,
	assetKey: CLIP_SHEET,
	frames: frames.map((i) => `stub${i}`),
	fps: 8,
	loop,
	bounds: { x: -16, y: -32, w: 32, h: 64 },
});
const STUB_CLIPS = [
	stubClip('salmon_pink_swim_se', [0, 1], true),
	stubClip('salmon_pink_swim_ne', [2, 3], true),
	stubClip('salmon_pink_hop_se', [0, 1, 2, 3, 0, 1, 2, 3], false),
];
const withClips = join(work, 'runtime-clips.json');
writeFileSync(
	withClips,
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: SALMONS_SEED_DOC,
		flipbooks: STUB_CLIPS,
		editorArt: {
			sheets: [{ key: CLIP_SHEET, json: 'editor-art/S_SalmonStub.json' }],
			images: [],
		},
	}),
);
const snapClips = await serveSnapshot({
	dir: snapshot,
	bundleFile: withClips,
	name: 'Salmons',
	snapshotId: 'salmons-clips',
});
// Page S plays its clips on the authored river the room plays (no generator), so it predicts that
// very river: with the generator a page makes its seed's river and predicts the room's salmon
// against the wrong banks and pools, and the corrections swing its facing (the flake of the
// "swimming upstream" verdict, 2026-11-19). No generator, no art: S draws the clips alone.
const withClipsAuthored = join(work, 'runtime-clips-authored.json');
writeFileSync(
	withClipsAuthored,
	JSON.stringify({
		...JSON.parse(readFileSync(withClips, 'utf8')),
		config: JSON.parse(readFileSync(join(configs, 'salmons-clips.json'), 'utf8')),
	}),
);
const snapClipsAuthored = await serveSnapshot({
	dir: snapshot,
	bundleFile: withClipsAuthored,
	name: 'Salmons',
	snapshotId: 'salmons-clips-authored',
});
// Eight facings (game-families §9 #28): the same game with stub clips of the fisherman's walk
// drawn facing east and south-east, and its components as a project may hold them without a
// re-upload: the fisherman's `characterClips` as exported before a character could have eight
// facings (none named: he takes the game's eight), the bear's taken out (the game names its clips
// itself). A bear clip whose frames no sheet packs is registered too: its first frame never loads.
const CATCHER_CLIPS = [
	stubClip('fisherman_walk_e', [0, 1], true),
	stubClip('fisherman_walk_se', [2, 3], true),
	{ ...stubClip('bear_idle_se', [], true), frames: ['unpacked0', 'unpacked1'] },
];
/** The fisherman's hand on a stub clip's 32 × 64 box drawn 56 wide (his body's width; 112 tall,
 *  his feet at its bottom): the default hand (`engine-layout` `CLIP_HAND`), 0.75 across and 0.4
 *  down. */
const STUB_HAND = { dx: (0.75 - 0.5) * 56, lift: (1 - 0.4) * 112 };
const withCatcherClips = join(work, 'runtime-catcher-clips.json');
writeFileSync(
	withCatcherClips,
	JSON.stringify({
		...JSON.parse(readFileSync(withClips, 'utf8')),
		componentDefs: Object.fromEntries(
			Object.entries(componentDefs).map(([id, def]) => {
				if (id !== 'salmonsFisherman' && id !== 'salmonsBear') return [id, def];
				const { characterClips, ...bare } = def;
				const before = Object.fromEntries(
					Object.entries(characterClips).filter(([field]) => field !== 'facings'),
				);
				return [id, id === 'salmonsBear' ? bare : { ...bare, characterClips: before }];
			}),
		),
		flipbooks: CATCHER_CLIPS,
	}),
);
const snapCatcher = await serveSnapshot({
	dir: snapshot,
	bundleFile: withCatcherClips,
	name: 'Salmons',
	snapshotId: 'salmons-catcher-clips',
});
/**
 * Put `sheet` on the class `classId`. A component is one character's look (the validator refuses
 * a second character on it), and each class's is its bot's: that entry takes the sheet, less the
 * id and the component a tool's own entry for it has.
 */
const sheetOn = (raw, classId, sheet) => {
	const played = raw.arcade.online.characters.find((c) => c.id === classId);
	const entry = raw.arcade.characters.find((c) => c.component === played.body);
	if (!entry) throw new Error(`no character uses the look of the class "${classId}"`);
	Object.assign(entry, sheet, { id: entry.id, component: entry.component });
	played.sheet = entry.id;
	return played;
};
// `--sheet`: the room of page S (the authored river, a salmon below the sandbank) with the salmon
// class naming a sheet. The sheet is the one Invisible Characters' own edits make of a Salmons
// config and the launcher's save stores (`fixtures/salmons-tool-sheet.json`): the game's own block
// made a sheet, under a prefix of its own, with one more action, `flop`, on the room's `grounded`,
// whose north-east clip its cell names. `pnpm --filter launcher-api check:art-scope` §14 makes it
// with the tool, holds the file to it, and publishes and bakes it; this script cannot import the
// tool (`ts-loader.mjs` does not load `engine-layout`'s index). The page boots the config with the
// sheet on it; the server is given the same config normalized, which has none.
const SHEET_GAME = 'salmons-sheet';
const TOOL_SHEET = JSON.parse(
	readFileSync(join(import.meta.dirname, 'fixtures/salmons-tool-sheet.json'), 'utf8'),
);
const SHEET_PREFIX = TOOL_SHEET.character.source.prefix;
const SHEET_FLOP = TOOL_SHEET.character.actions.find((action) => action.id === 'flop');
const withSheet = join(work, 'runtime-sheet.json');
{
	const raw = JSON.parse(readFileSync(join(configs, 'salmons-clips.json'), 'utf8'));
	const salmonClass = raw.arcade.online.characters.find((c) => c.id === TOOL_SHEET.class);
	if (salmonClass.body !== TOOL_SHEET.character.component)
		throw new Error('the tool’s sheet is of another look than the salmon class');
	sheetOn(raw, TOOL_SHEET.class, TOOL_SHEET.character);
	writeFileSync(join(configs, `${SHEET_GAME}.json`), JSON.stringify(normalizeGameConfigDoc(raw)));
	writeFileSync(
		withSheet,
		JSON.stringify({
			...JSON.parse(readFileSync(withClips, 'utf8')),
			config: raw,
			flipbooks: [
				...STUB_CLIPS,
				stubClip(`${SHEET_PREFIX}_swim_se`, [0, 1], true),
				stubClip(`${SHEET_PREFIX}_swim_ne`, [2, 3], true),
				stubClip(`${SHEET_PREFIX}_hop_se`, [0, 1, 2, 3], false),
				stubClip(`${SHEET_PREFIX}_flop_se`, [3, 2, 1, 0], false),
				stubClip(SHEET_FLOP.anim.ne.clip, [1, 0, 3, 2], false),
			],
		}),
	);
}
const snapSheet = await serveSnapshot({
	dir: snapshot,
	bundleFile: withSheet,
	name: 'Salmons',
	snapshotId: 'salmons-sheet',
});
// `--hold`: the bloodstain's room (a bear's spawn beside the salmon's), the salmon class naming a
// sheet that is its own block made a sheet (`sheetOfCharacterClips`) with `caught` held. Its catch
// clip ends on a frame of a sheet of its own, magenta, which no other clip draws.
const HOLD_GAME = 'salmons-hold';
const HOLD_SHEET = 'invisible_wall/salmons/manifests/atlas_manifest_S_HoldStub.json';
const HOLD_RGB = [0xff, 0x00, 0xff];
const withHold = join(work, 'runtime-hold.json');
{
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', 'S_HoldStub.png'),
		png(64, 64, (x) => (x < 32 ? CLIP_RGB : HOLD_RGB)),
	);
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', 'S_HoldStub.json'),
		JSON.stringify({
			frames: { held0: stubFrame(0), held1: stubFrame(1) },
			meta: { image: 'S_HoldStub.png', format: 'RGBA8888', size: { w: 64, h: 64 }, scale: '1' },
		}),
	);
	const raw = JSON.parse(readFileSync(join(configs, 'salmons-blood.json'), 'utf8'));
	// A page that closes leaves at once (a dropped player otherwise keeps its seat, and its hold,
	// for `rejoinSeconds`).
	raw.arcade.online.rejoinSeconds = 0;
	writeFileSync(join(configs, `${HOLD_GAME}.json`), JSON.stringify(raw));
	const sheet = sheetOfCharacterClips(SALMONS_CHARACTER_CLIPS.salmon);
	sheetOn(raw, 'salmon', {
		...sheet,
		actions: sheet.actions.map((action) =>
			action.id === 'caught' ? { ...action, play: 'hold' } : action,
		),
	});
	// The room's only salmon is golden: its own catch clip is drawn as made, not tinted.
	const caughtClip = (prefix, facing) => ({
		...stubClip(`${prefix}_caught_${facing}`, [], false),
		assetKey: HOLD_SHEET,
		frames: ['held0', 'held0', 'held0', 'held1'],
	});
	const clips = JSON.parse(readFileSync(withClips, 'utf8'));
	writeFileSync(
		withHold,
		JSON.stringify({
			...clips,
			config: raw,
			flipbooks: [
				...STUB_CLIPS,
				...[sheet.source.prefix, sheet.source.variants.marked].flatMap((prefix) =>
					['se', 'ne'].map((facing) => caughtClip(prefix, facing)),
				),
			],
			editorArt: {
				...clips.editorArt,
				sheets: [
					...clips.editorArt.sheets,
					{ key: HOLD_SHEET, json: 'editor-art/S_HoldStub.json' },
				],
			},
		}),
	);
}
const snapHold = await serveSnapshot({
	dir: snapshot,
	bundleFile: withHold,
	name: 'Salmons',
	snapshotId: 'salmons-hold',
});
// `--trees`: the game's own config with zone art's trees, as a publish stores it (carried past the
// normalizer), a magenta frame of a stub sheet exported as a publish exports one and named in
// `characterArt`, so the boot keeps its sheet loaded.
const TREES_SHEET = 'invisible_wall/salmons/manifests/atlas_manifest_S_TreeStub.json';
const TREE_RGB = [0xff, 0x00, 0xff];
const withTrees = join(work, 'runtime-trees.json');
{
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', 'S_TreeStub.png'),
		png(32, 64, () => TREE_RGB),
	);
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', 'S_TreeStub.json'),
		JSON.stringify({
			frames: { pine: stubFrame(0) },
			meta: { image: 'S_TreeStub.png', format: 'RGBA8888', size: { w: 32, h: 64 }, scale: '1' },
		}),
	);
	const zoneArt = {
		'@trees': { source: { kind: 'sprite', region: `${TREES_SHEET}::pine` }, placement: 'stamp' },
	};
	writeFileSync(
		withTrees,
		JSON.stringify({
			doc,
			componentDefs,
			componentDefaults: {},
			config: withZoneArt(config, { ...authored, arcade: { ...authored.arcade, zoneArt } }),
			flowV2: SALMONS_SEED_DOC,
			editorArt: {
				sheets: [{ key: TREES_SHEET, json: 'editor-art/S_TreeStub.json' }],
				images: [],
			},
			characterArt: [`${TREES_SHEET}::pine`],
		}),
	);
}
const snapTrees = await serveSnapshot({
	dir: snapshot,
	bundleFile: withTrees,
	name: 'Salmons',
	snapshotId: 'salmons-trees',
});
// `--zone-rig`: the game's own config with its rocks and whirlpools drawn by a stub rig, as a
// publish stores the config and exports the rig.
const ZONE_RIG = 'ZoneRigStub';
const zoneRigEntry = exportStubRig(snapshot, ZONE_RIG, BLINK_RIG, png);
const withZoneRig = join(work, 'runtime-zone-rig.json');
{
	const blink = { kind: 'rig', rig: ZONE_RIG, animation: 'blink' };
	const zoneArt = {
		'rock#': { source: blink, placement: 'stamp' },
		'whirlpool#': { source: blink, placement: 'stamp' },
	};
	writeFileSync(
		withZoneRig,
		JSON.stringify({
			doc,
			componentDefs,
			componentDefaults: {},
			config: withZoneArt(config, { ...authored, arcade: { ...authored.arcade, zoneArt } }),
			flowV2: SALMONS_SEED_DOC,
			editorArt: { sheets: [], images: [], spines: [zoneRigEntry] },
			// As the art export lists them (`zoneArtArtNames`): the rig, kept loaded by the boot.
			characterArt: zoneArtArtNames({ arcade: { zoneArt } }),
		}),
	);
}
const snapZoneRig = await serveSnapshot({
	dir: snapshot,
	bundleFile: withZoneRig,
	name: 'Salmons',
	snapshotId: 'salmons-zone-rig',
});
// `--rig`: the same room with the salmon class naming a sheet whose source is a rig, and the bear
// class one of still images. Both sheets are the ones Invisible Characters' own edits make of a
// Salmons config (`fixtures/salmons-tool-rig.json`, which `pnpm --filter launcher-api
// check:characters-tool` §16 makes with the tool and holds the file to): the salmon's block made
// a sheet and its source changed to a rig, with the skin its `marked` variant names and the bone
// its hand follows; the bear's bot drawn as one image, with a walk that stands in from it and a
// swipe that has an image of its own. The rig is a 32 × 64 box (its Bounds box, feet at its
// origin) of one colour, with the skin of another and the bone the sheet names; it is exported as
// a publish exports a rig (`deploy/editor-art/<name>/`, listed in `editorArt.spines` under its
// bundle name).
const RIG_GAME = 'salmons-rig';
const TOOL_RIG = JSON.parse(
	readFileSync(join(import.meta.dirname, 'fixtures/salmons-tool-rig.json'), 'utf8'),
);
const RIG = TOOL_RIG.salmon.character.source.rig;
const RIG_SKIN = TOOL_RIG.salmon.character.source.variants.marked;
const RIG_HAND = TOOL_RIG.salmon.character.draw.bones.hand;
const RIG_RGB = [0xe0, 0x20, 0xe0];
const RIG_GOLD_RGB = [0x20, 0x60, 0xe0];
const stillOf = (id) =>
	TOOL_RIG.bear.sheet.actions.find((action) => action.id === id)?.anim?.se?.still;
const STILL = stillOf('idle');
const STILL_SWIPE = stillOf('swipe');
if (![STILL, STILL_SWIPE].every((still) => still?.assetKey === CLIP_SHEET))
	throw new Error('the tool’s still images are not frames of the playtest’s stub sheet');
const stillId = (still) => `still::${still.assetKey}::${still.region}`;
const withRig = join(work, 'runtime-rig.json');
{
	mkdirSync(join(snapshot, 'deploy', 'editor-art', RIG), { recursive: true });
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', RIG, `${RIG}.png`),
		png(64, 64, (x) => (x < 32 ? RIG_RGB : RIG_GOLD_RGB)),
	);
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', RIG, `${RIG}.atlas`),
		[
			`${RIG}.png`,
			'size: 64,64',
			'filter: Nearest,Nearest',
			'body',
			'bounds: 0,0,32,64',
			RIG_SKIN,
			'bounds: 32,0,32,64',
			'',
		].join('\n'),
	);
	const body = (path) => ({ body: { body: { path, x: 0, y: 32, width: 32, height: 64 } } });
	const sway = (angle) => ({
		bones: {
			[RIG_HAND]: {
				rotate: [{ value: 0 }, { time: 0.25, value: angle }, { time: 0.5, value: 0 }],
			},
		},
	});
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', RIG, `${RIG}.json`),
		JSON.stringify({
			skeleton: { spine: '4.2.0', x: -16, y: 0, width: 32, height: 64 },
			bones: [{ name: 'root' }, { name: RIG_HAND, parent: 'root', x: 8, y: 48 }],
			slots: [{ name: 'body', bone: 'root', attachment: 'body' }],
			skins: [
				{ name: 'default', attachments: body('body') },
				{ name: RIG_SKIN, attachments: body(RIG_SKIN) },
			],
			animations: { swim: sway(20), hop_se: sway(-40) },
		}),
	);
	const raw = JSON.parse(readFileSync(join(configs, 'salmons-clips.json'), 'utf8'));
	const salmonClass = raw.arcade.online.characters.find((c) => c.id === 'salmon');
	const bearClass = raw.arcade.online.characters.find((c) => c.id === 'bear');
	if (salmonClass.body !== TOOL_RIG.salmon.character.component)
		throw new Error('the tool’s rig sheet is of another look than the salmon class');
	sheetOn(raw, 'salmon', TOOL_RIG.salmon.character);
	// A component is one character's look, and the bear's is its bot's: that entry is its sheet.
	const bearEntry = raw.arcade.characters.find((c) => c.id === TOOL_RIG.bear.character);
	if (bearEntry?.component !== bearClass.body)
		throw new Error('the tool’s stills sheet is of another look than the bear class');
	Object.assign(bearEntry, TOOL_RIG.bear.sheet);
	bearClass.sheet = bearEntry.id;
	// A bear beside the salmon's start, in its water (page B's own place is all it needs).
	delete bearClass.spawns;
	delete bearClass.randomSpawn;
	writeFileSync(join(configs, `${RIG_GAME}.json`), JSON.stringify(normalizeGameConfigDoc(raw)));
	const published = JSON.parse(readFileSync(withClips, 'utf8'));
	writeFileSync(
		withRig,
		JSON.stringify({
			...published,
			config: raw,
			flipbooks: [],
			// As the art export writes them: each sheet with the frames it registers, the rig at
			// the editor's load scale, and the names the sheets' art goes by (`characterArt`),
			// without which the boot leaves a rig and a sheet nothing else names unloaded.
			editorArt: {
				...published.editorArt,
				sheets: published.editorArt.sheets.map((sheet) => ({
					...sheet,
					names: ['stub0', 'stub1', 'stub2', 'stub3'],
				})),
				spines: [
					{
						key: RIG,
						atlas: `editor-art/${RIG}/${RIG}.atlas`,
						skeleton: `editor-art/${RIG}/${RIG}.json`,
						scale: 1,
					},
				],
			},
			characterArt: [RIG, ...[STILL, STILL_SWIPE].map((s) => `${s.assetKey}::${s.region}`)],
		}),
	);
}
const snapRig = await serveSnapshot({
	dir: snapshot,
	bundleFile: withRig,
	name: 'Salmons',
	snapshotId: 'salmons-rig',
});
// `--rig`, the bear wades whatever draws it: the same rig on the BEAR's class (the owner's bear
// is a rig), in the wading's room (the original's level, `wadeGame`).
const RIG_WADE_GAME = 'salmons-rig-wade';
const withRigWade = join(work, 'runtime-rig-wade.json');
{
	const raw = wadeGame((game) => sheetOn(game, 'bear', TOOL_RIG.salmon.character));
	writeFileSync(
		withRigWade,
		JSON.stringify({ ...JSON.parse(readFileSync(withRig, 'utf8')), config: raw }),
	);
	writeFileSync(
		join(configs, `${RIG_WADE_GAME}.json`),
		JSON.stringify(normalizeGameConfigDoc(raw)),
	);
}
const snapRigWade = await serveSnapshot({
	dir: snapshot,
	bundleFile: withRigWade,
	name: 'Salmons',
	snapshotId: 'salmons-rig-wade',
});
// `--turn`: a salmon in open water (the river's lowest band but one: no rock, pool, sandbank or
// waterfall), its class naming a sheet of frame clips in eight facings that turns smoothly
// (`view.turn`), and a bear beside it whose sheet (the tool's still images) does not. The clips
// are of a sheet of their own: one frame for each facing from north round to south (the western
// three are their twins mirrored), each a body of its own colour with a white head and a black
// nose on its right, in a Bounds box wider than the frame. Its `turn` is the empty one an owner
// saves by turning the option on: no blend, and on an isometric view the 8° lean. A second room
// has the tool's rig sheet with the same facings and the same `turn`, about its middle (the
// default pivot).
const TURN_GAME = 'salmons-turn';
const TURN_RIG_GAME = 'salmons-turn-rig';
const TURN_SHEET = 'invisible_wall/salmons/manifests/atlas_manifest_S_TurnStub.json';
const TURN_PREFIX = 'salmon_turn';
const TURN_MADE = ['n', 'ne', 'e', 'se', 's'];
const TURN_RGB = [
	[0xe0, 0x40, 0x40],
	[0xe0, 0x90, 0x30],
	[0xd0, 0xd0, 0x30],
	[0x40, 0xc0, 0x60],
	[0x40, 0x80, 0xe0],
];
const TURN_FRAME = { w: 48, h: 96 };
const TURN_CYCLE = 4;
const TURN_BOUNDS = { x: -32, y: -48, w: 64, h: 96 };
const TURN_VIEW = { kind: 'isometric', facings: 8, turn: {} };
const TURN_RIG_VIEW = { kind: 'isometric', facings: 8, turn: {} };
const TURN_BAND = river.bands.at(-2);
const TURN_AT = {
	x: Math.round((TURN_BAND.left + TURN_BAND.right) / 2),
	y: TURN_BAND.y + 90,
};
ruleRoom(TURN_GAME, TURN_AT);
const withTurn = join(work, 'runtime-turn.json');
const withTurnRig = join(work, 'runtime-turn-rig.json');
{
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', 'S_TurnStub.png'),
		png(TURN_FRAME.w * TURN_MADE.length, TURN_FRAME.h, (x, y) => {
			const across = x % TURN_FRAME.w;
			if (across >= 36 && y >= 8 && y < 18) return [0, 0, 0];
			return y < 26 ? [0xff, 0xff, 0xff] : TURN_RGB[Math.floor(x / TURN_FRAME.w)];
		}),
	);
	writeFileSync(
		join(snapshot, 'deploy', 'editor-art', 'S_TurnStub.json'),
		JSON.stringify({
			frames: Object.fromEntries(
				TURN_MADE.map((facing, i) => [
					`turn_${facing}`,
					{
						frame: { x: i * TURN_FRAME.w, y: 0, ...TURN_FRAME },
						rotated: false,
						trimmed: false,
						spriteSourceSize: { x: 0, y: 0, ...TURN_FRAME },
						sourceSize: TURN_FRAME,
					},
				]),
			),
			meta: {
				image: 'S_TurnStub.png',
				format: 'RGBA8888',
				size: { w: TURN_FRAME.w * TURN_MADE.length, h: TURN_FRAME.h },
				scale: '1',
			},
		}),
	);
	const stillBear = (raw) => {
		const bearClass = sheetOn(raw, 'bear', TOOL_RIG.bear.sheet);
		delete bearClass.spawns;
		delete bearClass.randomSpawn;
	};
	const authoredTurn = readFileSync(join(configs, `${TURN_GAME}.json`), 'utf8');
	const raw = JSON.parse(authoredTurn);
	sheetOn(raw, 'salmon', {
		view: TURN_VIEW,
		source: { kind: 'clips', prefix: TURN_PREFIX },
		draw: { width: 90 },
		actions: [{ id: 'swim', when: [{ motion: 'still' }, { motion: 'moving' }] }],
	});
	stillBear(raw);
	writeFileSync(join(configs, `${TURN_GAME}.json`), JSON.stringify(normalizeGameConfigDoc(raw)));
	const published = JSON.parse(readFileSync(withRig, 'utf8'));
	writeFileSync(
		withTurn,
		JSON.stringify({
			...published,
			config: raw,
			flipbooks: TURN_MADE.map((facing) => ({
				id: `${TURN_PREFIX}_swim_${facing}`,
				name: `swim ${facing}`,
				assetKey: TURN_SHEET,
				// One picture, four frames long: the look reports which frame of its cycle a clip is on.
				frames: Array(TURN_CYCLE).fill(`turn_${facing}`),
				fps: 8,
				loop: true,
				bounds: TURN_BOUNDS,
			})),
			editorArt: {
				...published.editorArt,
				sheets: [
					...published.editorArt.sheets,
					{ key: TURN_SHEET, json: 'editor-art/S_TurnStub.json' },
				],
				spines: [],
			},
			characterArt: published.characterArt.filter((name) => name !== RIG),
		}),
	);
	const rawRig = JSON.parse(authoredTurn);
	sheetOn(rawRig, 'salmon', { ...TOOL_RIG.salmon.character, view: TURN_RIG_VIEW });
	stillBear(rawRig);
	writeFileSync(
		join(configs, `${TURN_RIG_GAME}.json`),
		JSON.stringify(normalizeGameConfigDoc(rawRig)),
	);
	writeFileSync(withTurnRig, JSON.stringify({ ...published, config: rawRig }));
}
const snapTurn = await serveSnapshot({
	dir: snapshot,
	bundleFile: withTurn,
	name: 'Salmons',
	snapshotId: 'salmons-turn',
});
const snapTurnRig = await serveSnapshot({
	dir: snapshot,
	bundleFile: withTurnRig,
	name: 'Salmons',
	snapshotId: 'salmons-turn-rig',
});
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 16,
	commit: 'playtest',
	gracefullyShutdown: false,
	// Every page is on this machine's one address: with pages X, Y and V, the open pages and the
	// seats held for closed ones come to the server's 16 an address, and the next socket is refused.
	perAddress: { sockets: 32, upgrades: 60 },
});
await rooms.listen(roomsPort);
let roomsClosed = false;

const paramsFor = (extra) =>
	new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'online-play',
		editorDocBase: snap.origin,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		...extra,
	});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a page on the game. `next` is a join the page finds kept for it, as after a leave for a new
 * room that did not get in (`online.ts` `takeNextJoin`: session storage, scoped to this server and
 * game), seeded once: a winner's `pass` makes its salmon golden.
 */
async function boot(profile, extra = {}, next = undefined) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	if (next) {
		const join = JSON.stringify({
			server: `ws://127.0.0.1:${roomsPort}`,
			game: extra.rooms_game ?? KEY,
			...next,
		});
		await page.page('Page.addScriptToEvaluateOnNewDocument', {
			source: `if (!sessionStorage.getItem('pt:seeded')) { sessionStorage.setItem('pt:seeded', '1'); sessionStorage.setItem('ie:rooms:next-join', ${JSON.stringify(join)}); }`,
		});
	}
	const params = paramsFor(extra);
	for (const [k, v] of Object.entries(extra)) if (v === null) params.delete(k);
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	return page;
}

/** The keys are the screen's on the isometric river (`online.ts` `keysOf`): straight up the river
 *  (world −y, drawn up and LEFT on Salmons' mirrored screen, as the original's) is Up + Left, down
 *  it Down + Right. `ArrowUp` / `ArrowDown` here mean up and down the river. */
const STREAM_KEYS = { ArrowUp: ['ArrowUp', 'ArrowLeft'], ArrowDown: ['ArrowDown', 'ArrowRight'] };
const KEY_CODES = {
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	KeyJ: 74,
	Space: 32,
};

async function ready(page) {
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
	return {
		page,
		state: () => api('state()'),
		play,
		key: async (name, type) => {
			for (const code of STREAM_KEYS[name] ?? [name])
				await page.page('Input.dispatchKeyEvent', {
					type: type === 'down' ? 'rawKeyDown' : 'keyUp',
					key: { KeyJ: 'j', Space: ' ' }[code] ?? code,
					code,
					windowsVirtualKeyCode: KEY_CODES[code],
				});
		},
		flow: (expr) => page.evaluate(`(() => { const f = window.__IE_FLOW_V2__; return ${expr}; })()`),
	};
}

/** Step a page's frames while real time passes, so the room's patches reach it. */
const settle = async (game, ms) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		await game.play([{ op: 'step', frames: 6 }]);
		await wait(50);
	}
};
const players = async (game) => (await game.state()).arcade?.bodies ?? [];

/** Whether a screenshot shows the own salmon's colour at its isometric place and not at its flat
 *  one (`engine-layout` `projection.ts`; the screen is the design box, scaled to the page). */
function isometricAt(png, arcade, me) {
	const cam = arcade?.camera;
	const at = arcade?.online?.drawn.find((d) => d.id === me);
	const k = cam ? png.width / cam.view.w : 0;
	if (!cam || !at || Math.abs(cam.view.h * k - png.height) > 2)
		return { ok: false, cam, at, size: [png.width, png.height] };
	const dx = at.x - (cam.x + cam.view.w / 2);
	const dy = at.y - (cam.y + cam.view.h / 2);
	// Raised with the ground under it, the camera raised with the own player's (the waterfalls).
	const centre = {
		x: cam.view.w / 2 + cam.shakeX,
		y: cam.view.h / 2 + cam.shakeY + (cam.lift ?? 0) - (at.ground ?? 0),
	};
	// The placeholder look stands on its place, 44 px tall: its middle is where its colour is sure.
	const screen = (x, y) => ({ x: Math.round(x * k), y: Math.round((y - 22) * k) });
	const projected = screen(centre.x + dy - dx, centre.y + (dx + dy) / 2);
	const flat = screen(centre.x + dx, centre.y + dy);
	// Swimming in open water it is drawn under the water's tint (2026-11-18): its colour is read
	// back through each of the river's tints.
	const under = arcade.online.art?.looks?.[me]?.underwater === true;
	const salmon = ({ x, y }) => {
		if (x < 0 || y < 0 || x >= png.width || y >= png.height) return false;
		const i = (y * png.width + x) * 4;
		const seen = [...png.data.subarray(i, i + 3)];
		// Pink, or gold: page A's is the only salmon in its room, so the golden one.
		const pinkOrGold = ([r, g, b]) =>
			(Math.abs(r - 0xfa) < 12 && Math.abs(g - 0x80) < 12 && Math.abs(b - 0x72) < 12) ||
			isGold([r, g, b]);
		return under ? throughWater(seen).some(pinkOrGold) : pinkOrGold(seen);
	};
	const apart = Math.hypot(projected.x - flat.x, projected.y - flat.y) > 60;
	return {
		ok: salmon(projected) && (!apart || !salmon(flat)),
		projected,
		flat,
		apart,
	};
}
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
		for (let x = 0; x < w; x++) rows.set([...paint(x, y), 255], y * (w * 4 + 1) + 1 + x * 4);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(rows)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}
/** The salmon's pink through `SpawnLayer`'s gold ramp. */
const isGold = ([r, g, b]) => r > 190 && g > 150 && g < 225 && b < 110;
/** The river's water tints (`engine-layout` `salmonsArt/water.ts`: water, rapids, source) and how
 *  strongly they cover what swims under them. */
const WATER_TINTS = [0x0ea5e9, 0x38bdf8, 0x7dd3fc];
const TINT_ALPHA = 0.75;
/** What a pixel drawn under each water tint was before it: `(seen − a·T) / (1 − a)`. */
const throughWater = (seen) =>
	WATER_TINTS.map((t) =>
		[(t >> 16) & 0xff, (t >> 8) & 0xff, t & 0xff].map((c, i) =>
			Math.round((seen[i] - TINT_ALPHA * c) / (1 - TINT_ALPHA)),
		),
	);
/** A screenshot's pixel at (x, y), design px through `toScreen`; undefined off the image. */
const rgbAt = (png, { x, y }) => {
	if (x < 0 || y < 0 || x >= png.width || y >= png.height) return undefined;
	const i = (y * png.width + x) * 4;
	return [...png.data.subarray(i, i + 3)];
};
/** Where a world point is drawn on a page's isometric screen (as `isometricAt`), in image px,
 *  raised by `lift` design px and by the ground under it (`at.ground`, the waterfalls'). */
const isoScreen = (png, cam, at, lift = 0) => {
	const k = png.width / cam.view.w;
	const dx = at.x - (cam.x + cam.view.w / 2);
	const dy = at.y - (cam.y + cam.view.h / 2);
	const raised = lift + (at.ground ?? 0) - (cam.lift ?? 0);
	return {
		x: Math.round((cam.view.w / 2 + cam.shakeX + dy - dx) * k),
		y: Math.round((cam.view.h / 2 + cam.shakeY + (dx + dy) / 2 - raised) * k),
	};
};
/** Whether a screenshot shows `id` drawn gold (`engine-layout` `SpawnLayer`'s gold ramp over the
 *  salmon's pink), sampled at its look's middle. */
function goldAt(png, arcade, id) {
	const cam = arcade?.camera;
	const at = arcade?.online?.drawn.find((d) => d.id === id);
	if (!cam || !at) return { ok: false, cam, at };
	const at22 = isoScreen(png, cam, at, 22);
	// The golden texture is shaded: the sample is the brightest of the 7 × 7 px round it (one pixel
	// could land on a dark stroke, more so since the camera's zoom draws the fish smaller).
	const around = [];
	for (let dx = -3; dx <= 3; dx++)
		for (let dy = -3; dy <= 3; dy++) around.push(rgbAt(png, { x: at22.x + dx, y: at22.y + dy }));
	const rgb = around.find((c) => c && isGold(c)) ?? rgbAt(png, at22);
	// A salmon swimming in open water is drawn under the water's tint (the original's
	// `underwaterEntityLayer`, 2026-11-18): only a quarter of its gold shows through, so there its
	// look must be the golden texture instead.
	const look = arcade.online.art?.looks?.[id];
	const under = look?.underwater === true;
	const ok = under ? look.region === 'salmon_golden' : !!rgb && isGold(rgb);
	return { ok, rgb, under };
}
/** Whether a screenshot shows a white line from `by` (raised to his hand) to `target` (its
 *  middle): near-white pixels near points along the way. */
function lineAt(png, arcade, by, target) {
	const cam = arcade?.camera;
	const from = arcade?.online?.drawn.find((d) => d.id === by);
	const to = arcade?.online?.drawn.find((d) => d.id === target);
	if (!cam || !from || !to) return { ok: false, cam, from, to };
	// Drawn in the original art: from the fisherman's hand (his code look's, or his clip's) to the
	// salmon's middle, 0xddddaa, wiggling for its first 450 ms.
	const looks = arcade.online.art?.looks;
	const hand = arcade.online.art?.hands?.[by] ?? looks?.[by]?.hand;
	const art = !!hand;
	const a = isoScreen(png, cam, from, art ? hand.lift : 88 * 0.75);
	if (art) a.x += Math.round(hand.dx * (png.width / cam.view.w));
	const b = isoScreen(png, cam, to, art ? (looks[target]?.middle ?? 22) : 22);
	const reach = art ? 12 : 3;
	const lineColour = (rgb) =>
		art
			? rgb[0] > 185 && Math.abs(rgb[0] - rgb[1]) < 25 && rgb[2] > 120 && rgb[2] < 205
			: rgb.every((v) => v > 235);
	const near = (t) => {
		const x = Math.round(a.x + (b.x - a.x) * t);
		const y = Math.round(a.y + (b.y - a.y) * t);
		for (let oy = -reach; oy <= reach; oy++)
			for (let ox = -reach; ox <= reach; ox++) {
				const rgb = rgbAt(png, { x: x + ox, y: y + oy });
				if (rgb && lineColour(rgb)) return true;
			}
		return false;
	};
	const hits = [0.3, 0.5, 0.7].filter(near).length;
	return { ok: hits >= 2, hits, a, b };
}
const drawnOf = async (game) => (await game.state()).arcade?.online ?? { drawn: [] };
/** A golden salmon's join: a winner's pass for `game` (the server runs in this process). */
const goldenJoin = (game) => ({ character: 'salmon', pass: issuePass(game) });
/** Click the page's canvas at a point of its stage (canvas px). */
const clickAt = async (game, at) => {
	const rect = JSON.parse(
		await game.page.evaluate(
			'JSON.stringify(document.querySelector("canvas").getBoundingClientRect())',
		),
	);
	const point = { x: Math.round(rect.left + at.x), y: Math.round(rect.top + at.y) };
	await game.page.page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
	for (const type of ['mousePressed', 'mouseReleased'])
		await game.page.page('Input.dispatchMouseEvent', {
			type,
			...point,
			button: 'left',
			buttons: type === 'mousePressed' ? 1 : 0,
			clickCount: 1,
		});
	await game.play([{ op: 'step', frames: 3 }]);
};
/** Where world point `at` is on a page's canvas, in stage px (the isometric screen). */
const stageOf = async (game, at) => {
	const cam = (await game.state()).arcade?.camera;
	const dx = at.x - (cam.x + cam.view.w / 2);
	const dy = at.y - (cam.y + cam.view.h / 2);
	const rect = JSON.parse(
		await game.page.evaluate(
			'JSON.stringify(document.querySelector("canvas").getBoundingClientRect())',
		),
	);
	const k = rect.width / cam.view.w;
	return {
		// Salmons' screen is mirrored (`Scene.mirrored`): world (x, y) is drawn at (y − x, (x + y) / 2).
		x: Math.round((cam.view.w / 2 + cam.shakeX + dy - dx) * k),
		y: Math.round((cam.view.h / 2 + cam.shakeY + (dx + dy) / 2 - (at.lift ?? 0)) * k),
	};
};
/**
 * A caught page's death screen, read and used: it waits for the screen (the flow's
 * `salmonsCaught`, the art's `screens.caught` with its buttons), picks `character` and presses
 * Respawn, then waits until the page's player is drawn again. Returns what it saw.
 */
const respawnThrough = async (game, me, character) => {
	let screen;
	for (let i = 0; i < 30 && !screen?.buttons; i++) {
		await settle(game, 150);
		screen = (await drawnOf(game)).screens?.caught;
	}
	const flowShown = (await shown(game)).includes('salmonsCaught');
	if (!screen?.buttons) return { screen, flowShown, back: false };
	await clickAt(game, screen.buttons[character]);
	await clickAt(game, screen.buttons.respawn);
	let back = false;
	for (let i = 0; i < 30 && !back; i++) {
		await settle(game, 150);
		const online = await drawnOf(game);
		back = online.drawn.some((d) => d.id === me) && !online.hidden?.includes(me);
	}
	const after = await drawnOf(game);
	return {
		screen,
		flowShown,
		back,
		gone: await (async () => {
			for (let i = 0; i < 10; i++) {
				const online = await drawnOf(game);
				if (!(await shown(game)).includes('salmonsCaught') && !online.screens?.caught?.shown)
					return true;
				await settle(game, 150);
			}
			return false;
		})(),
		respawned: after.events.some((ev) => ev.type === 'respawned' && ev.id === me),
	};
};
/** A page whose player bots caught comes back through its death screen as `character`. */
const keepPlaying = async (game, me, character) => {
	if ((await drawnOf(game)).hidden?.includes(me)) await respawnThrough(game, me, character);
};
const shown = (game) => game.flow('f ? f.ordered().map((c) => c.id) : []');
const zonesOf = (game) => game.zones.map((z) => [z.id, z.x, z.y, z.w, z.h]);
/** What a page made of its room's field, and what the room's seed makes here, in Node. */
const riverOf = async (page, doc) => {
	const online = (await page.state()).arcade?.online ?? {};
	const made =
		typeof online.seed === 'number' ? generatedOnlineGame(onlineGameOf(doc), online.seed) : null;
	return { seed: online.seed, drawn: online.fieldDrawn, zones: online.zones, made };
};
const variable = (game, id) => game.flow(`f?.state?.read(${JSON.stringify(id)})`);

// The bear wades (`engine-layout` `salmonsArt/wade.ts`): what its pages are asked and shown.
/** The room of game `key` on the game server (it runs in this process). */
const roomOf = async (key) =>
	matchMaker.getLocalRoomById(
		(await matchMaker.query({})).find((room) => room.metadata?.game === key)?.roomId,
	);
/** How a page says player `id` wades (`online.art.wading`); `undefined` for one that does not. */
const wadingOf = async (game, id) => (await drawnOf(game)).art?.wading?.[id];
/**
 * Where a wading's players are stood on the original's level ({@link wadeRiver}): in calm water
 * below its last waterfall (nothing there is drawn raised), three cells in from its left bank,
 * with no rock, sandbank, whirlpool or bridge within three cells of the way there; on that bank,
 * a cell and a half from the water; and on the middle of a bridge's deck.
 */
const WADE_AT = (() => {
	const cell = wadeRiver.grid.cell;
	const pad = 3 * cell;
	const lastFall = Math.max(...wadeRiver.waterfalls.map((fall) => fall.y + fall.h));
	const blocked = [
		...wadeRiver.rocks,
		...wadeRiver.sandbanks,
		...wadeRiver.whirlpools.map((w) => ({ x: w.x - w.r, y: w.y - w.r, w: 2 * w.r, h: 2 * w.r })),
		...wadeRiver.bridges,
	];
	const band = wadeRiver.bands.find((b) => {
		if (b.y < lastFall + 6 * cell || b.current > 100 || b.right - b.left < 8 * cell) return false;
		const y = b.y + cell / 2;
		return !blocked.some(
			(r) =>
				r.x - pad < b.left + 5 * cell &&
				r.x + r.w + pad > b.left - 3 * cell &&
				r.y - pad < y &&
				r.y + r.h + pad > y,
		);
	});
	const y = band.y + cell / 2;
	const [deck] = wadeRiver.bridges;
	return {
		bank: { x: band.left - 1.5 * cell, y },
		water: { x: band.left + 3 * cell, y },
		bridge: { x: deck.x + deck.w / 2, y: deck.y + deck.h / 2 },
	};
})();
/** Have `room` stand player `id` at `place`; true once `game`'s page draws it there. */
const standAt = async (room, game, id, place) => {
	const body = room?.sim.players.get(id)?.body;
	if (!body || !place) return false;
	Object.assign(body, place);
	for (let i = 0; i < 60; i++) {
		await settle(game, 100);
		const at = (await drawnOf(game)).drawn?.find((d) => d.id === id);
		if (at && Math.hypot(at.x - place.x, at.y - place.y) < 2) return true;
	}
	return false;
};
/**
 * How deep `game`'s page says player `id` wades, read two frames of the page's own clock at a
 * time, from the first change until it is `end` (1 in, 0 out).
 */
const depthsTo = async (game, id, end) => {
	const depths = [];
	for (let i = 0; i < 150 && depths.at(-1) !== end; i++) {
		await game.play([{ op: 'step', frames: 2 }]);
		await wait(15);
		const now = await wadingOf(game, id);
		if (now && (now.depth !== 1 - end || depths.length)) depths.push(now.depth);
	}
	return depths;
};
/** Stand player `id` somewhere at once, for {@link depthsTo} to follow. */
const moveTo = (room, id, place) => Object.assign(room?.sim.players.get(id)?.body ?? {}, place);
/** Whether depths read two frames apart are an eased step to `end` over about 250 ms (seven or
 *  eight readings): one way only, through at least three depths between out and in. */
const steppedOver = (depths, end) =>
	depths.at(-1) === end &&
	depths.every((depth, i) => i === 0 || (end ? depth >= depths[i - 1] : depth <= depths[i - 1])) &&
	new Set(depths.filter((depth) => depth > 0 && depth < 1)).size >= 3 &&
	depths.length >= 6 &&
	depths.length <= 11;
/** Whether a page's wading of a player is a look half under: all the way in, through its filter,
 *  under one of the water's tints, its line's ends over the look's `middle` and its lowest point
 *  under it. */
const halfUnder = (wading, middle) =>
	wading?.depth === 1 &&
	wading.filtered === true &&
	WATER_TINTS.includes(wading.tint) &&
	!!wading.line &&
	typeof middle === 'number' &&
	wading.line.sag > 0 &&
	-wading.line.level > middle &&
	-(wading.line.level + wading.line.sag) < middle;
/** The 5 × 5 px of a screenshot round a point `lift` px above the world place `at`. */
const patchAt = (shot, cam, at, lift) => {
	if (!cam || !at) return [];
	const centre = isoScreen(shot, cam, at, lift);
	const seen = [];
	for (let dx = -2; dx <= 2; dx++)
		for (let dy = -2; dy <= 2; dy++) {
			const rgb = rgbAt(shot, { x: centre.x + dx, y: centre.y + dy });
			if (rgb) seen.push(rgb);
		}
	return seen;
};
/** The same round a point `lift` px above where player `id` stands. */
const lookAt = (shot, arcade, id, lift) =>
	patchAt(
		shot,
		arcade?.camera,
		arcade?.online?.drawn.find((d) => d.id === id),
		lift,
	);
const mostly = (seen, test) => seen.length > 0 && seen.filter(test).length * 2 > seen.length;

play: try {
	if (opt.turn) {
		const DEG = Math.PI / 180;
		// Neither sheet names a `lean`: on an isometric view of eight facings the picture is tilted
		// 8° on the screen at the halfway point between two (the sector's edge), none at its middle.
		const SECTOR = 45 * DEG;
		const MOST = 8 * DEG;
		const FRAME_MS = 1000 / 60;
		// At the sheet's 360° a second a frame of the stepped clock (60 a second) turns the drawn
		// heading 6°, which is 2.13° of lean.
		const STEP = 6 * DEG;
		// A heading that goes back over the edge it has just crossed keeps its picture for
		// `SHEET_TURN_BACK_BAND` (2°), its lean held at 8° there: so a picture changes a frame's
		// turn past the edge at most, or that and the band where the heading wavered on it, and a
		// heading read back from the lean is that much short.
		const SLACK = STEP + SHEET_TURN_BACK_BAND;
		const EDGE_LEAN = MOST - (MOST * SLACK) / (SECTOR / 2);
		const raw = (game, code, type) =>
			game.page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: code,
				code,
				windowsVirtualKeyCode: KEY_CODES[code],
			});
		/** Hold exactly `keys` (the screen's own: no stream mapping). */
		const hold = async (game, held, keys) => {
			for (const code of held) if (!keys.includes(code)) await raw(game, code, 'up');
			for (const code of keys) if (!held.includes(code)) await raw(game, code, 'down');
			return keys;
		};
		/**
		 * What the stage draws of the turn's stubs near player `id` (within 120 px of its place on
		 * the screen: another salmon is not its picture): every shown sprite of the clip stub (the
		 * frame of its cycle it is on, its opacity as drawn and how many filters are on it or
		 * over it) and every shown rig view (where in its animation it is).
		 */
		const STAGE = (feet) => `(() => {
			const found = { sprites: [], rigs: [] };
			const near = (node) => {
				const at = node.getGlobalPosition();
				return Math.hypot(at.x - ${feet.x}, at.y - ${feet.y}) < 120;
			};
			const walk = (node, alpha, filters) => {
				if (!node.visible) return;
				const a = alpha * node.alpha;
				const f = filters + (node.filters?.length ?? 0);
				const source = node.texture?.source;
				const label = String(source?.label ?? '') + String(source?.resource?.src ?? '');
				if (typeof node.currentFrame === 'number' && label.includes('TurnStub') && near(node))
					found.sprites.push({ frame: node.currentFrame, frames: node.totalFrames, alpha: a, filters: f });
				const entry = node.skeleton && node.state?.getCurrent?.(0);
				if (entry && near(node))
					found.rigs.push({
						animation: entry.animation?.name,
						time: entry.trackTime,
						length: entry.animationEnd - entry.animationStart,
						alpha: a,
						filters: f,
					});
				for (const child of node.children ?? []) walk(child, a, f);
			};
			walk(globalThis.__PIXI_APP__.stage, 1, 0);
			return found;
		})()`;
		/** What page `game` reads of player `id` (`read` of its online probe) and draws of it. */
		const drawnNear = async (game, id, read) => {
			const arcade = (await game.state()).arcade;
			const drawn = arcade?.online && read(arcade.online, id);
			const at = arcade?.online?.drawn.find((d) => d.id === id);
			if (!drawn || !arcade.camera || !at) return undefined;
			const feet = isoScreen({ width: 1280 }, arcade.camera, at);
			return { ...drawn, stage: await game.page.evaluate(STAGE(feet)) };
		};
		// A cropped picture: 320 px square, the player's place 160 across and 250 down.
		const CROP = { size: 320, left: 160, up: 250 };
		const crop = async (game, id, file) => {
			const arcade = (await game.state()).arcade;
			const at = arcade?.online?.drawn.find((d) => d.id === id);
			if (!arcade?.camera || !at) return undefined;
			const feet = isoScreen({ width: 1280 }, arcade.camera, at);
			const { result: shot, error } = await game.page.page('Page.captureScreenshot', {
				format: 'png',
				clip: {
					x: feet.x - CROP.left,
					y: feet.y - CROP.up,
					width: CROP.size,
					height: CROP.size,
					scale: 1,
				},
			});
			if (error) throw new Error(`screenshot: ${error.message}`);
			const data = Buffer.from(shot.data, 'base64');
			writeFileSync(join(out, file), data);
			result.shots.push(file);
			return PNG.sync.read(data);
		};
		const degrees = (angle) => Math.round((angle / DEG) * 10) / 10;
		const round3 = (n) => Math.round(n * 1000) / 1000;
		const tagOf = (sample) => `${sample.facing}${sample.flipX ? '-mirrored' : ''}`;
		/** The ground heading a frame is drawn for, read back from its facing and its lean (which
		 *  is in proportion to how far the heading is from the facing's middle). */
		const headingOfSample = (s) =>
			wrapAngle(facingHeading(s.facing) + (s.lean / MOST) * (SECTOR / 2));
		/**
		 * Swim `legs` (each the keys held and for how many frames) a frame at a time, reading what
		 * `read` says page `from` draws after each (the page that swims, unless another watches),
		 * and what its stage draws. A leg's `seq` ([first, end) of its frames) is shot on every
		 * frame; else `wants` names a frame to take a cropped picture of (its file's tag). `see` is
		 * what is read off a picture.
		 */
		const swim = async (game, id, read, legs, name, { wants, see, from = game } = {}) => {
			const samples = [];
			let held = [];
			for (const [index, leg] of legs.entries()) {
				held = await hold(game, held, leg.keys);
				for (let frame = 0; frame < leg.frames; frame++) {
					await game.play([{ op: 'step', frames: 1 }]);
					if (from !== game) await from.play([{ op: 'step', frames: 1 }]);
					await wait(12);
					const drawn = await drawnNear(from, id, read);
					if (!drawn) continue;
					const sample = { ...drawn, leg: index };
					sample.heading = headingOfSample(sample);
					samples.push(sample);
					const tag =
						leg.seq && frame >= leg.seq[0] && frame < leg.seq[1]
							? `seq-${tagOf(sample)}-lean${degrees(sample.lean)}`
							: wants?.(sample, samples);
					if (!tag) continue;
					const file = `${name}-${String(result.shots.length + 1).padStart(2, '0')}-${tag}.png`;
					const shot = await crop(from, id, file);
					sample.shot = file;
					if (shot && see) sample.seen = see(shot);
				}
			}
			await hold(game, held, []);
			return samples;
		};
		const turnOf = (samples) =>
			samples.slice(1).reduce((sum, s, i) => sum + wrapAngle(s.heading - samples[i].heading), 0);
		/** The runs of frames drawn in one facing, in order. */
		const runsOf = (samples) =>
			samples.reduce((runs, s) => {
				const last = runs.at(-1);
				if (last && last[0].facing === s.facing) last.push(s);
				else runs.push([s]);
				return runs;
			}, []);
		/** How many facings round (clockwise) a frame's facing is from the one before. */
		const roundOf = (s, before) => {
			const round = CLIP_FACINGS.indexOf(s.facing) - CLIP_FACINGS.indexOf(before.facing);
			return ((round + 12) % 8) - 4;
		};
		/** Each change of picture in a swim (a change of facing): the frame before and its own. */
		const changesOf = (samples) =>
			samples.flatMap((s, i) => {
				const before = samples[i - 1];
				return before && before.facing !== s.facing
					? [{ before, at: s, round: roundOf(s, before) }]
					: [];
			});
		const facingSteps = (samples) => changesOf(samples).map((change) => change.round);
		// A reversal (down the screen, then up it, its first 40 frames shot one by one), and a
		// circle clockwise on the screen.
		const REVERSAL = [
			{ keys: ['ArrowDown'], frames: 36 },
			{ keys: ['ArrowUp'], frames: 48, seq: [0, 40] },
		];
		const CIRCLE = [
			['ArrowUp', 'ArrowRight'],
			['ArrowRight'],
			['ArrowRight', 'ArrowDown'],
			['ArrowDown'],
			['ArrowDown', 'ArrowLeft'],
			['ArrowLeft'],
			['ArrowLeft', 'ArrowUp'],
			['ArrowUp'],
		].map((keys) => ({ keys, frames: 26 }));
		const EPS = 1e-6;
		/** What is wrong with a change of picture: nothing when the frame before leans toward the
		 *  turn and the frame of the change the other way, each a frame's turn from the most. */
		const changeFaults = ({ before, at, round }) => {
			const faults = [];
			if (Math.abs(round) !== 1) faults.push(`${round} facings round`);
			const toward = Math.sign(round);
			if (Math.sign(before.lean) !== toward) faults.push('the frame before leans against the turn');
			if (Math.sign(at.lean) !== -toward)
				faults.push('the frame of the change leans with the turn');
			for (const [which, s] of [
				['before', before],
				['change', at],
			])
				if (Math.abs(s.lean) < EDGE_LEAN - EPS || Math.abs(s.lean) > MOST + EPS)
					faults.push(`${which} ${degrees(s.lean)}° is not within a frame’s turn of 8°`);
			return faults;
		};
		const changeDetail = (swims) =>
			swims.flatMap(changesOf).map((change) => ({
				from: tagOf(change.before),
				to: tagOf(change.at),
				before: degrees(change.before.lean),
				at: degrees(change.at.lean),
				faults: changeFaults(change),
			}));
		/** What the verdicts say of how a swim turns and leans, whatever draws it. */
		const judgeTurn = (page, reversal, circle) => {
			const all = [...reversal, ...circle];
			const leans = all.map((s) => Math.abs(s.lean));
			verdict(
				`${page}: every frame leans (a number, within ±8°: the default isometric lean), and the lean changes from frame to frame, up to 8° either way`,
				all.length > 200 &&
					all.every((s) => Number.isFinite(s.lean) && Math.abs(s.lean) <= MOST + EPS) &&
					all.some((s) => s.lean > 7 * DEG) &&
					all.some((s) => s.lean < -7 * DEG) &&
					new Set(all.map((s) => degrees(s.lean))).size > 20,
				{
					frames: all.length,
					most: degrees(Math.max(...leans)),
					leans: new Set(all.map((s) => degrees(s.lean))).size,
					over: all.filter((s) => Math.abs(s.lean) > MOST + EPS).map((s) => degrees(s.lean)),
				},
			);
			const changes = [reversal, circle].flatMap(changesOf);
			verdict(
				'…at every change of picture the tilt swaps sides: the frame before leans toward the turn and the frame of the change the other way, each within a frame’s turn (and the 2° band) of 8° (5.2° to 8°): the picture changes where the drawn heading crosses the halfway point, with no wait there',
				changes.length >= 10 && changes.every((change) => changeFaults(change).length === 0),
				{ changes: changeDetail([reversal, circle]) },
			);
			// The current skews what the keys ask (down the screen is drawn some 163°, up it 24°).
			const back = reversal.filter((s) => s.leg === 1);
			const between = new Set(back.map((s) => s.facing));
			const backSteps = facingSteps(back);
			const steps = [reversal, circle].flatMap((samples) =>
				samples.slice(1).map((s, i) => Math.abs(wrapAngle(s.heading - samples[i].heading))),
			);
			verdict(
				'…the reversal sweeps through the facings in between (three or more pictures, each the next one round: none is skipped), 120° or more of heading in all, and no frame turns the heading more than 360° a second does (6°, and the 2° band)',
				between.size >= 3 &&
					Math.abs(turnOf(back)) > 120 * DEG &&
					backSteps.every((step) => step === backSteps[0] && Math.abs(step) === 1) &&
					Math.max(...steps) <= SLACK + 1e-4,
				{
					facings: [...between],
					turned: degrees(turnOf(back)),
					steps: backSteps,
					most: degrees(Math.max(...steps)),
				},
			);
			const seen = new Set(circle.map((s) => s.facing));
			verdict(
				'…the circle is drawn in all eight facings, turning clockwise 270° or more, each step to the next facing round (back one, at most twice, where the swim wavers on an edge by more than the 2° band)',
				CLIP_FACINGS.every((facing) => seen.has(facing)) &&
					turnOf(circle) > 270 * DEG &&
					facingSteps(circle).every((step) => Math.abs(step) === 1) &&
					facingSteps(circle).filter((step) => step === -1).length <= 2,
				{ facings: [...seen], turned: degrees(turnOf(circle)), steps: facingSteps(circle) },
			);
			// A picture the clockwise circle passes through whole: it comes in leaning back and
			// goes out leaning on, mirrored or not.
			const runs = runsOf(circle);
			const whole = runs.filter(
				(run, i) =>
					i > 0 &&
					i < runs.length - 1 &&
					roundOf(run[0], runs[i - 1].at(-1)) === 1 &&
					roundOf(runs[i + 1][0], run.at(-1)) === 1,
			);
			const mirrored = whole.filter((run) => run[0].flipX);
			// The drawn heading follows where the salmon swims, which swings back a little as the
			// keys change against the current: a frame may go back, a frame's turn at most.
			const backStep = (MOST * STEP) / (SECTOR / 2);
			const withTheTurn = (run) =>
				run.at(-1).lean - run[0].lean > 10 * DEG &&
				run.slice(1).every((s, i) => s.lean >= run[i].lean - backStep - EPS);
			verdict(
				'…a mirrored facing leans the way the character turns, as an unmirrored one does: clockwise, from one side to the other, never going back more than a frame’s turn (where the swim itself swings back as the keys change)',
				mirrored.length >= 2 && whole.every(withTheTurn),
				whole.map((run) => ({
					facing: run[0].facing,
					mirrored: run[0].flipX,
					from: degrees(run[0].lean),
					to: degrees(run.at(-1).lean),
					frames: run.length,
				})),
			);
		};
		const phaseOfRig = (rig) => (rig.length > 0 ? (rig.time % rig.length) / rig.length : 0);
		const readings = (samples) =>
			samples.map((s) => ({
				leg: s.leg,
				facing: s.facing,
				mirrored: s.flipX,
				lean: degrees(s.lean),
				heading: degrees(s.heading),
				...(s.stage.sprites.length ? { frame: s.stage.sprites.map((sprite) => sprite.frame) } : {}),
				...(s.stage.rigs.length
					? { phase: s.stage.rigs.map((rig) => round3(phaseOfRig(rig))) }
					: {}),
				...(s.shot ? { shot: s.shot, seen: s.seen } : {}),
			}));
		const twice = (page) =>
			page.page('Emulation.setDeviceMetricsOverride', {
				width: 1280,
				height: 720,
				deviceScaleFactor: 2,
				mobile: false,
			});

		// The clip sheet: page T's salmon, with page U's bear (still images, no turn) beside it.
		const tBoot = await boot('t', {
			rooms_name: 'Tess',
			rooms_character: 'salmon',
			rooms_game: TURN_GAME,
			editorDocBase: snapTurn.origin,
		});
		await twice(tBoot);
		const t = await ready(tBoot);
		const u = await ready(
			await boot('u', {
				rooms_name: 'Ursa',
				rooms_character: 'bear',
				rooms_game: TURN_GAME,
				editorDocBase: snapTurn.origin,
			}),
		);
		await settle(t, 600);
		await settle(u, 600);
		await settle(t, 300);
		const { me } = await drawnOf(t);
		const { me: bear } = await drawnOf(u);
		const madeOf = (clipId) => clipId.slice(clipId.lastIndexOf('_') + 1);
		const readClip = (online, id) => {
			const clip = online.clips?.[id];
			const look = online.turned?.[id];
			if (!clip || !look) return undefined;
			const made = madeOf(clip.clipId);
			return {
				lean: clip.lean,
				flipX: clip.flipX,
				name: clip.clipId,
				facing: (clip.flipX && clipMirrorOf(made)) || made,
				look,
			};
		};
		/** One picture on the stage: the look reports no blend, and one sprite of the stub is
		 *  shown, opaque, with no filter but a golden salmon's own tint. */
		const onePicture = (s) =>
			s.look.blend === undefined &&
			s.stage.sprites.length === 1 &&
			s.stage.sprites[0].alpha === 1 &&
			s.stage.sprites[0].filters === (s.look.gold ? 1 : 0);
		const notOnePicture = (samples) =>
			samples
				.filter((s) => !onePicture(s))
				.slice(0, 8)
				.map((s) => ({ facing: tagOf(s), blend: s.look.blend, sprites: s.stage.sprites }));
		// A picture of every facing, the first frame it is drawn in.
		const clipWants = (sample, samples) =>
			samples.some((s) => s.shot && s.name === sample.name && s.flipX === sample.flipX)
				? undefined
				: tagOf(sample);
		/** The stub's body colour 30 px above the player's place, where every clip has its body. */
		const bodyOf = (shot) => {
			const k = shot.width / CROP.size;
			return rgbAt(shot, { x: Math.round(CROP.left * k), y: Math.round((CROP.up - 30) * k) });
		};
		/** `SpawnLayer`'s gold ramp, which the look's own tint is the twin of (`sheetClipLook.ts`
		 *  `SHEET_CLIP_GOLD`; the turn gate holds the two equal). */
		const goldOf = ([r, g, b]) =>
			[
				0.435 * r + 0.856 * g + 0.16 * b,
				0.36 * r + 0.708 * g + 0.132 * b,
				0.114 * r + 0.224 * g + 0.042 * b,
			].map((c) => Math.min(c, 255));
		/** The body colour a frame should show: its one clip's. */
		const bodyWanted = (sample, gold) => {
			const rgb = TURN_RGB[TURN_MADE.indexOf(madeOf(sample.name))];
			return gold ? goldOf(rgb) : rgb;
		};
		const bodyAsWanted = (sample, gold = false) =>
			!!sample.seen && bodyWanted(sample, gold).every((c, i) => Math.abs(c - sample.seen[i]) <= 4);
		const bodyDetail = (samples, gold = false) =>
			samples
				.filter((s) => s.shot)
				.map((s) => ({
					shot: s.shot,
					seen: s.seen,
					wanted: bodyWanted(s, gold).map(Math.round),
					ok: bodyAsWanted(s, gold),
				}));
		const standing = await drawnOf(t);
		const { stage: standingStage } = await drawnNear(t, me, readClip);
		verdict(
			'page T: its class’s sheet turns smoothly, so its clip is drawn by a look of its own, mounted: the clip’s Bounds box the sheet’s width wide (90 × 135), upright while it stands, one picture',
			standing.clips?.[me]?.clipId?.startsWith(`${TURN_PREFIX}_swim_`) === true &&
				standing.clips[me].lean === 0 &&
				standing.turned?.[me]?.mounted === true &&
				standing.turned[me].visible === true &&
				standing.turned[me].clipId === standing.clips[me].clipId &&
				standing.turned[me].blend === undefined &&
				standingStage.sprites.length === 1 &&
				Math.round(standing.turned[me].width) === 90 &&
				Math.round(standing.turned[me].height) === 135,
			{ clip: standing.clips?.[me], look: standing.turned?.[me], stage: standingStage },
		);
		verdict(
			'…and the bear beside it, whose sheet has no `turn`, is a published clip with no lean and no such look',
			typeof standing.clips?.[bear]?.clipId === 'string' &&
				!('lean' in standing.clips[bear]) &&
				standing.turned?.[bear] === undefined &&
				(await drawnOf(u)).turned?.[bear] === undefined &&
				!('lean' in ((await drawnOf(u)).clips?.[bear] ?? { lean: 0 })),
			{ onT: standing.clips?.[bear], onU: (await drawnOf(u)).clips?.[bear] },
		);
		await crop(t, me, 'turn-clip-00-standing.png');
		const seeing = { wants: clipWants, see: bodyOf };
		const reversal = await swim(t, me, readClip, REVERSAL, 'turn-clip', seeing);
		const circle = await swim(t, me, readClip, CIRCLE, 'turn-clip', seeing);
		const all = [...reversal, ...circle];
		verdict(
			'page T: no fade: on every frame the look reports no blend, and the stage shows one sprite of the clips, opaque (alpha 1) and with no filter',
			all.length > 200 && all.every(onePicture),
			{ frames: all.length, faults: notOnePicture(all) },
		);
		judgeTurn('page T', reversal, circle);
		verdict(
			'…the screenshots show it: the body is its one clip’s colour (in every facing, and on every frame shot one by one across the reversal’s changes of picture), no mix and no other colour',
			new Set(all.filter((s) => s.shot).map(tagOf)).size === 8 &&
				all.filter((s) => s.shot).length >= 40 &&
				all.filter((s) => s.shot).every((s) => bodyAsWanted(s)),
			bodyDetail(all).filter((s) => !s.ok),
		);
		// Each stub clip is four frames long (of one picture, eight a second): the stage's sprite
		// moves on a frame of its four every 7.5 frames of the clock.
		const framesOn = (samples) =>
			samples.slice(1).map((s, i) => {
				const from = samples[i].stage.sprites[0]?.frame;
				const to = s.stage.sprites[0]?.frame;
				return { change: samples[i].facing !== s.facing, from, to, on: (to - from + 4) % 4 };
			});
		/** Whether the cycle is kept in `swims`: `least` changes of picture or more, landing on
		 *  `kinds` of the four frames or more. */
		const keptCycle = (swims, least, kinds) => {
			const steps = swims.flatMap(framesOn);
			const changes = steps.filter((step) => step.change);
			return (
				swims.every((samples) =>
					samples.every((s) => s.look.frames === TURN_CYCLE && s.look.playing),
				) &&
				steps.every((step) => step.on === 0 || step.on === 1) &&
				changes.length >= least &&
				changes.filter((step) => step.to !== 0).length >= Math.ceil(least / 2) &&
				new Set(changes.map((step) => step.to)).size >= kinds
			);
		};
		const cycleDetail = (swims) =>
			swims
				.flatMap(framesOn)
				.filter((step) => step.change || (step.on !== 0 && step.on !== 1))
				.map((step) => `${step.change ? '' : '!'}${step.from}→${step.to}`)
				.join(' ');
		verdict(
			'…and the cycle is kept across a change of picture: on the frame of the change the clip taken is on the frame of its four the one left was on (or the next, when the clock moves it on), not its first; on every frame the cycle stays or moves on by one',
			keptCycle([reversal, circle], 10, TURN_CYCLE),
			cycleDetail([reversal, circle]),
		);
		/** The frames of a swim each frame of the cycle is held for, between the first and the
		 *  last (cut by the swim), and how many changes of picture each holds. */
		const heldFor = (samples) =>
			samples
				.reduce((runs, s, i) => {
					const last = runs.at(-1);
					const change = i > 0 && samples[i - 1].facing !== s.facing ? 1 : 0;
					if (last && last.frame === s.stage.sprites[0]?.frame) {
						last.frames++;
						last.changes += change;
					} else runs.push({ frame: s.stage.sprites[0]?.frame, frames: 1, changes: 0 });
					return runs;
				}, [])
				.slice(1, -1);
		// Eight a second is a frame of the cycle every 7.5 of the clock.
		const held = [reversal, circle].flatMap(heldFor);
		verdict(
			'…and the cycle keeps its time across a change: no frame of it is held longer than its 125 ms (8 frames of the clock), a frame a change falls in as well',
			held.length >= 20 && held.every((run) => run.frames <= 8),
			held.filter((run) => run.frames > 8),
		);
		verdict(
			'…what is drawn is what was read: the look’s rotation is the frame’s lean, its mirror the clip’s, every frame',
			all.every(
				(s) =>
					Math.abs(s.look.lean - s.lean) < 1e-9 &&
					s.look.flipX === s.flipX &&
					s.look.clipId === s.name &&
					s.look.mounted &&
					s.look.visible,
			),
			all.find((s) => Math.abs(s.look.lean - s.lean) >= 1e-9 || s.look.flipX !== s.flipX) ?? null,
		);
		// The same salmon as page U draws it, while page T swims a second reversal.
		const watched = await swim(t, me, readClip, REVERSAL, 'turn-clip-other', { from: u });
		const watchedChanges = changesOf(watched);
		verdict(
			'page U: the salmon as another device draws it is the same look, one picture on every frame (no blend, one opaque sprite), leaning within ±8°, the tilt swapping sides at each change of picture, its cycle kept',
			watched.length > 60 &&
				watched.every((s) => s.look.mounted) &&
				watched.every(onePicture) &&
				watched.every((s) => Math.abs(s.lean) <= MOST + EPS) &&
				watchedChanges.length >= 3 &&
				watchedChanges.every((change) => changeFaults(change).length === 0) &&
				keptCycle([watched], 3, 2),
			{
				frames: watched.length,
				faults: notOnePicture(watched),
				changes: changeDetail([watched]),
				cycle: cycleDetail([watched]),
			},
		);
		result.turn = {
			clip: {
				reversal: readings(reversal),
				circle: readings(circle),
				other: readings(watched),
			},
		};
		for (const [name, page] of [
			['T', t],
			['U', u],
		]) {
			const errors = await page.page.evaluate('window.__AR_ERRORS__');
			verdict(`page ${name}: no page error`, errors.length === 0, errors);
		}
		await t.page.close();
		await u.page.close();

		// The room's golden salmon (a winner's pass): its base clip gold over the glow, the clip
		// taken at every change of picture gold too.
		const g = await ready(
			await boot(
				'g',
				{ rooms_name: 'Gil', rooms_game: TURN_GAME, editorDocBase: snapTurn.origin },
				goldenJoin(TURN_GAME),
			),
		);
		await settle(g, 600);
		const { me: gold } = await drawnOf(g);
		const goldShot = await g.page.screenshot();
		writeFileSync(join(out, 'turn-clip-gold.png'), goldShot);
		result.shots.push('turn-clip-gold.png');
		const golden = await drawnOf(g);
		const seenGold = goldAt(PNG.sync.read(goldShot), (await g.state()).arcade, gold);
		const goldSwim = await swim(g, gold, readClip, REVERSAL, 'turn-gold', seeing);
		verdict(
			'page G: the golden salmon’s clip is drawn gold by its look as a published clip is tinted, upright standing, over the glow the layer still draws; as it turns every clip is gold, one picture on every frame, leaning within ±8° (the body gold, in the screenshots)',
			(golden.marked ?? []).includes(gold) &&
				(golden.glowed ?? []).includes(gold) &&
				golden.turned?.[gold]?.gold === true &&
				golden.turned[gold].lean === 0 &&
				seenGold.ok &&
				goldSwim.length > 60 &&
				goldSwim.every((s) => s.look.gold === true) &&
				goldSwim.every(onePicture) &&
				goldSwim.every((s) => Math.abs(s.lean) <= MOST + EPS) &&
				changesOf(goldSwim).length >= 3 &&
				goldSwim.filter((s) => s.shot).length >= 3 &&
				goldSwim.filter((s) => s.shot).every((s) => bodyAsWanted(s, true)),
			{
				look: golden.turned?.[gold],
				marked: golden.marked,
				glowed: golden.glowed,
				seenGold,
				faults: notOnePicture(goldSwim),
				body: bodyDetail(goldSwim, true).filter((s) => !s.ok),
			},
		);
		result.turn.gold = readings(goldSwim);
		const errorsG = await g.page.evaluate('window.__AR_ERRORS__');
		verdict('page G: no page error', errorsG.length === 0, errorsG);
		await g.page.close();

		// The rig sheet, the same `turn: {}`, about its middle (the default pivot): page V.
		const vBoot = await boot('v', {
			rooms_name: 'Vic',
			rooms_character: 'salmon',
			rooms_game: TURN_RIG_GAME,
			editorDocBase: snapTurnRig.origin,
		});
		await twice(vBoot);
		const v = await ready(vBoot);
		await settle(v, 600);
		const { me: rigged } = await drawnOf(v);
		const readRig = (online, id) => {
			const rig = online.rigs?.[id];
			return rig && typeof rig.facing === 'string'
				? {
						lean: rig.lean,
						flipX: rig.flipX,
						name: rig.animation,
						facing: rig.facing,
						rig,
					}
				: undefined;
		};
		/** The rig's own view on the stage: the one view that plays its animation. */
		const rigViews = (s) => s.stage.rigs.filter((view) => view.animation === s.name);
		const oneView = (s) =>
			s.rig.blend === undefined &&
			rigViews(s).length === 1 &&
			rigViews(s)[0].alpha === 1 &&
			rigViews(s)[0].filters === 0;
		/**
		 * The rig's box as a picture shows it: the middle of its paint (image px), how much of it
		 * there is, and the angle its long side stands at, clockwise from upright (the second
		 * moments of the paint: the box is twice as tall as wide).
		 */
		const boxOf = (shot) => {
			let n = 0;
			let sx = 0;
			let sy = 0;
			let sxx = 0;
			let syy = 0;
			let sxy = 0;
			for (let y = 0; y < shot.height; y++)
				for (let x = 0; x < shot.width; x++) {
					const i = (y * shot.width + x) * 4;
					const near = RIG_RGB.every((c, at) => Math.abs(shot.data[i + at] - c) <= 40);
					if (!near) continue;
					n++;
					sx += x;
					sy += y;
					sxx += x * x;
					syy += y * y;
					sxy += x * y;
				}
			if (!n) return undefined;
			const cx = sx / n;
			const cy = sy / n;
			const axis = Math.atan2(2 * (sxy / n - cx * cy), sxx / n - cx * cx - (syy / n - cy * cy)) / 2;
			const lean = axis + Math.PI / 2;
			return {
				x: round3(cx),
				y: round3(cy),
				px: n,
				lean: lean > Math.PI / 2 ? lean - Math.PI : lean,
			};
		};
		// A picture of each facing leaning each way (5° or more), mirrored or not.
		const rigWants = (sample, samples) =>
			Math.abs(sample.lean) < 5 * DEG ||
			samples.some(
				(s) =>
					s.shot &&
					s.facing === sample.facing &&
					Math.sign(s.lean) === Math.sign(sample.lean) &&
					Math.abs(s.lean) >= 5 * DEG,
			)
				? undefined
				: `${tagOf(sample)}-lean${degrees(sample.lean)}`;
		const rigStanding = (await drawnOf(v)).rigs?.[rigged];
		const { stage: rigStage } = await drawnNear(v, rigged, readRig);
		verdict(
			'page V: its class’s sheet is a rig that turns smoothly: the rig is mounted, upright while it stands, one view, and no clip look is made',
			rigStanding?.rig === RIG &&
				rigStanding.mounted === true &&
				rigStanding.lean === 0 &&
				rigStanding.blend === undefined &&
				rigStage.rigs.filter((view) => view.animation === rigStanding.animation).length === 1 &&
				(await drawnOf(v)).turned?.[rigged] === undefined,
			{ rigStanding, rigs: rigStage.rigs, turned: (await drawnOf(v)).turned },
		);
		const stood = boxOf(await crop(v, rigged, 'turn-rig-00-standing.png'));
		const rigSeeing = { wants: rigWants, see: boxOf };
		const rigReversal = await swim(v, rigged, readRig, REVERSAL, 'turn-rig', rigSeeing);
		const rigCircle = await swim(v, rigged, readRig, CIRCLE, 'turn-rig', rigSeeing);
		// The circle ends heading north. Back and forth over north, then over south: each crossing
		// of either is a mirror flip.
		const rigFlips = await swim(
			v,
			rigged,
			readRig,
			[
				['ArrowUp', 'ArrowRight'],
				['ArrowLeft', 'ArrowUp'],
				['ArrowDown', 'ArrowLeft'],
				['ArrowRight', 'ArrowDown'],
				['ArrowDown', 'ArrowLeft'],
			].map((keys) => ({ keys, frames: 34 })),
			'turn-rig-flip',
			rigSeeing,
		);
		const rigAll = [...rigReversal, ...rigCircle, ...rigFlips];
		const mirrorFlips = [rigCircle, rigFlips]
			.flatMap(changesOf)
			.filter((change) => change.before.flipX !== change.at.flipX);
		verdict(
			'page V: no fade: on every frame the rig reports no blend, and the stage shows one view of it, opaque (alpha 1) and with no filter, its mirror flips (four or more) included',
			rigAll.length > 250 && rigAll.every(oneView) && mirrorFlips.length >= 4,
			{
				flips: mirrorFlips.map((change) => `${tagOf(change.before)} → ${tagOf(change.at)}`),
				faults: rigAll
					.filter((s) => !oneView(s))
					.slice(0, 8)
					.map((s) => ({ facing: tagOf(s), blend: s.rig.blend, rigs: s.stage.rigs })),
			},
		);
		judgeTurn('page V', rigReversal, rigCircle);
		// About the middle of its box, a lean leaves the middle of the paint where it stands
		// upright; about its feet it would carry it half the box's height times the lean's sine.
		const leaned = rigAll.filter((s) => s.shot && Math.abs(s.lean) >= 5 * DEG);
		const moved = (s) => (s.seen ? Math.hypot(s.seen.x - stood.x, s.seen.y - stood.y) : Infinity);
		verdict(
			'…its pivot is the middle of its box: in the screenshots the box’s middle stays where it stands upright whatever the lean (within 2.5 px of 2× px; about its feet 8° would move it 10 px or more), the box is as large, and its long side stands at the lean the probe reads (within 1.5°), either way and mirrored or not',
			!!stood &&
				stood.px > 5000 &&
				Math.abs(stood.lean) < 0.5 * DEG &&
				leaned.length >= 8 &&
				leaned.some((s) => s.lean > 0 && s.flipX) &&
				leaned.some((s) => s.lean < 0 && s.flipX) &&
				leaned.some((s) => s.lean > 0 && !s.flipX) &&
				leaned.some((s) => s.lean < 0 && !s.flipX) &&
				leaned.every(
					(s) =>
						moved(s) <= 2.5 &&
						Math.abs(s.seen.px / stood.px - 1) < 0.03 &&
						Math.abs(s.seen.lean - s.lean) < 1.5 * DEG,
				),
			{
				stood,
				leaned: leaned.map((s) => ({
					shot: s.shot,
					lean: degrees(s.lean),
					seenLean: s.seen && degrees(s.seen.lean),
					moved: round3(moved(s)),
					px: s.seen?.px,
				})),
			},
		);
		// The swim cycle moves on by a frame of the clock (its length's share of 1/60 s) on every
		// frame: a cycle that started again at a change would jump back.
		const phaseSteps = (samples) =>
			samples.slice(1).flatMap((s, i) => {
				const [from] = rigViews(samples[i]);
				const [to] = rigViews(s);
				if (!from || !to) return [{ change: true, off: Infinity }];
				const step = FRAME_MS / 1000 / to.length;
				const on = (((phaseOfRig(to) - phaseOfRig(from)) % 1) + 1) % 1;
				return [{ change: samples[i].facing !== s.facing, off: Math.abs(on - step) }];
			});
		const rigSteps = [rigReversal, rigCircle, rigFlips].flatMap(phaseSteps);
		verdict(
			'…and the swim’s cycle is kept across every change of picture: on every frame, the frame of a change (a mirror flip included) too, its phase moves on by one frame of the clock and never starts again',
			rigSteps.filter((step) => step.change).length >= 10 &&
				rigSteps.every((step) => step.off < 1e-4),
			{
				changes: rigSteps.filter((step) => step.change).length,
				off: rigSteps
					.filter((step) => step.off >= 1e-4)
					.map((step) => ({ ...step, off: round3(step.off) })),
			},
		);
		result.turn.rig = {
			reversal: readings(rigReversal),
			circle: readings(rigCircle),
			flips: readings(rigFlips),
		};
		const errorsV = await v.page.evaluate('window.__AR_ERRORS__');
		verdict('page V: no page error', errorsV.length === 0, errorsV);
		await v.page.close();
		break play;
	}
	if (opt.rig) {
		const near = (rgb, want) => !!rgb && rgb.every((c, i) => Math.abs(c - want[i]) <= 24);
		const shotOf = async (game, file) => {
			const shot = await game.page.screenshot();
			writeFileSync(join(out, file), shot);
			result.shots.push(file);
			return PNG.sync.read(shot);
		};
		const r = await ready(
			await boot('r', {
				rooms_name: 'Rig',
				rooms_character: 'salmon',
				rooms_game: RIG_GAME,
				editorDocBase: snapRig.origin,
			}),
		);
		await settle(r, 600);
		const { me } = await drawnOf(r);
		const logOf = async (game, id) =>
			((await drawnOf(game)).clipLog ?? [])
				.filter((line) => line.startsWith(`${id}:`))
				.map((line) => line.slice(id.length + 1));
		const eventOf = async (type) =>
			((await r.state()).arcade?.online?.events ?? []).find(
				(ev) => ev.type === type && ev.id === me,
			);
		const standing = (await drawnOf(r)).rigs?.[me];
		verdict(
			'page R: its class’s sheet names a rig, so the rig is mounted and plays the loop’s animation (swim), no clip',
			standing?.rig === RIG &&
				standing.animation === 'swim' &&
				standing.loop === true &&
				standing.mounted === true &&
				(await drawnOf(r)).clips?.[me] === undefined,
			{ standing, clips: (await drawnOf(r)).clips, log: await logOf(r, me) },
		);
		verdict(
			'…drawn its Bounds box the sheet’s width wide (90 × 180), unskinned',
			Math.round(standing?.width) === 90 &&
				Math.round(standing?.height) === 180 &&
				standing?.skin === undefined,
			standing,
		);
		const shot = await shotOf(r, 'rig-salmon.png');
		const arcade = (await r.state()).arcade;
		const at = arcade?.online?.drawn.find((d) => d.id === me);
		const column = Object.fromEntries(
			[8, 90, 170, 200].map((lift) => [
				lift,
				arcade?.camera && at && rgbAt(shot, isoScreen(shot, arcade.camera, at, lift)),
			]),
		);
		verdict(
			'…on screen: the rig’s colour from its feet up to 180 px and not above, in place of the placeholder',
			[8, 90, 170].every((lift) => near(column[lift], RIG_RGB)) && !near(column[200], RIG_RGB),
			{ column },
		);
		await r.key('ArrowUp', 'down');
		let grounded;
		let up;
		for (let i = 0; i < 75 && !grounded; i++) {
			await settle(r, 60);
			const now = (await drawnOf(r)).rigs?.[me];
			if (now?.animation === 'swim' && now.flipX) up ??= now;
			grounded = await eventOf('grounded');
		}
		verdict(
			'…swimming upstream (screen north-west) the one rig’s swim is drawn mirrored',
			up?.flipX === true && up.rig === RIG,
			{ up, log: await logOf(r, me) },
		);
		await r.key('Space', 'down');
		await r.play([{ op: 'step', frames: 4 }]);
		await r.key('Space', 'up');
		for (let i = 0; i < 16; i++) await settle(r, 150);
		await r.key('ArrowUp', 'up');
		const log = await logOf(r, me);
		const hopAt = log.findLastIndex((line) => line.startsWith(`rig:${RIG}/hop_se`));
		const jumped = await eventOf('jumped');
		verdict(
			'…Space jumps it: the hop named for the south-east facing plays once (mirrored, facing north-west), then the swim again',
			!!grounded &&
				!!jumped &&
				hopAt >= 0 &&
				log[hopAt] === `rig:${RIG}/hop_se~` &&
				log.slice(hopAt + 1).some((line) => line.startsWith(`rig:${RIG}/swim`)),
			{ grounded, jumped, log },
		);
		verdict(
			'…every line of its log is the rig’s: it never played a clip',
			log.every((line) => line === '' || line.startsWith(`rig:${RIG}/`)),
			log,
		);
		const rgsR = (await r.page.evaluate('window.__AR_WIRE__')).filter(
			(url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url),
		);
		verdict('page R sends the RGS nothing', rgsR.length === 0, rgsR);
		const errorsR = await r.page.evaluate('window.__AR_ERRORS__');
		verdict('page R: no page error', errorsR.length === 0, errorsR);
		await r.page.close();

		const g = await ready(
			await boot(
				'g',
				{ rooms_name: 'Gil', rooms_game: RIG_GAME, editorDocBase: snapRig.origin },
				goldenJoin(RIG_GAME),
			),
		);
		await settle(g, 600);
		const { me: gold } = await drawnOf(g);
		const worn = (await drawnOf(g)).rigs?.[gold];
		const goldShot = await shotOf(g, 'rig-salmon-gold.png');
		const arcadeG = (await g.state()).arcade;
		const atG = arcadeG?.online?.drawn.find((d) => d.id === gold);
		const middle =
			arcadeG?.camera && atG && rgbAt(goldShot, isoScreen(goldShot, arcadeG.camera, atG, 90));
		verdict(
			'page G: the golden salmon wears the skin its sheet’s `marked` variant names, drawn as the skin is (not tinted)',
			((await drawnOf(g)).marked ?? []).includes(gold) &&
				worn?.skin === RIG_SKIN &&
				worn.rig === RIG &&
				near(middle, RIG_GOLD_RGB),
			{ worn, middle, marked: (await drawnOf(g)).marked },
		);
		const errorsG = await g.page.evaluate('window.__AR_ERRORS__');
		verdict('page G: no page error', errorsG.length === 0, errorsG);
		await g.page.close();

		const b = await ready(
			await boot('b', {
				rooms_name: 'Bea',
				rooms_character: 'bear',
				rooms_game: RIG_GAME,
				editorDocBase: snapRig.origin,
			}),
		);
		await settle(b, 600);
		const { me: bear } = await drawnOf(b);
		const still = (await drawnOf(b)).clips?.[bear];
		verdict(
			'page B: its class’s sheet is still images, so the one image every action falls back to is drawn, as a clip of one frame',
			still?.clipId === stillId(STILL) && (await drawnOf(b)).rigs?.[bear] === undefined,
			{ still, log: await logOf(b, bear) },
		);
		const stillShot = await shotOf(b, 'still-bear.png');
		const arcadeB = (await b.state()).arcade;
		const atB = arcadeB?.online?.drawn.find((d) => d.id === bear);
		const k = arcadeB?.camera ? stillShot.width / arcadeB.camera.view.w : 0;
		const sample = (lift, dx = 0) => {
			if (!arcadeB?.camera || !atB) return undefined;
			const feet = isoScreen(stillShot, arcadeB.camera, atB, lift);
			return rgbAt(stillShot, { x: Math.round(feet.x + dx * k), y: feet.y });
		};
		const box = {
			up: Object.fromEntries([8, 60, 112, 130].map((lift) => [lift, sample(lift)])),
			across: Object.fromEntries([-40, -26, 26, 40].map((dx) => [dx, sample(60, dx)])),
		};
		verdict(
			'…at the sheet’s box: its 32 × 64 frame 60 wide and 120 tall, feet on its place',
			[8, 60, 112].every((lift) => near(box.up[lift], CLIP_RGB)) &&
				!near(box.up[130], CLIP_RGB) &&
				[-26, 26].every((dx) => near(box.across[dx], CLIP_RGB)) &&
				[-40, 40].every((dx) => !near(box.across[dx], CLIP_RGB)),
			box,
		);
		await b.key('ArrowLeft', 'down');
		await settle(b, 500);
		const walking = (await drawnOf(b)).clips?.[bear];
		await b.key('ArrowLeft', 'up');
		verdict(
			'…walking, the same image (its walk falls back to it)',
			walking?.clipId === stillId(STILL),
			{ walking, log: await logOf(b, bear) },
		);
		await b.key('KeyJ', 'down');
		await b.play([{ op: 'step', frames: 4 }]);
		await b.key('KeyJ', 'up');
		await settle(b, 300);
		const swiping = (await drawnOf(b)).clips?.[bear];
		for (let i = 0; i < 10; i++) await settle(b, 150);
		const after = (await drawnOf(b)).clips?.[bear];
		verdict(
			'…its swipe draws the image its cell names, for a second, then the first again',
			swiping?.clipId === stillId(STILL_SWIPE) && after?.clipId === stillId(STILL),
			{ swiping, after, log: await logOf(b, bear) },
		);
		const errorsB = await b.page.evaluate('window.__AR_ERRORS__');
		verdict('page B: no page error', errorsB.length === 0, errorsB);
		await b.page.close();

		// The bear wades whatever draws it (`salmonsArt/wade.ts`): page W's bear is drawn by the
		// rig, in a room whose river its page draws. Pixi measures no size for a rig when it
		// places a filter and would skip the pass, so this is the look the wading must be seen on.
		const w = await ready(
			await boot('w', {
				rooms_name: 'Wade',
				rooms_character: 'bear',
				rooms_game: RIG_WADE_GAME,
				editorDocBase: snapRigWade.origin,
			}),
		);
		await settle(w, 600);
		const { me: wader } = await drawnOf(w);
		for (let i = 0; i < 80 && !(await wadingOf(w, wader)); i++) await settle(w, 250);
		const rigRoom = await roomOf(RIG_WADE_GAME);
		// The rig's box is 32 × 64, drawn 90 wide: 180 tall, its middle 90 up. One height under
		// the line's lowest point (and its rim and bob), one over its ends.
		const RIG_LIFT = { low: 40, high: 130 };
		const rigSeen = async (file) => {
			const shot = await shotOf(w, file);
			const arcadeW = (await w.state()).arcade;
			return {
				low: lookAt(shot, arcadeW, wader, RIG_LIFT.low),
				high: lookAt(shot, arcadeW, wader, RIG_LIFT.high),
			};
		};
		const isRig = (rgb) => near(rgb, RIG_RGB);
		const rigOnBank = await standAt(rigRoom, w, wader, WADE_AT.bank);
		await settle(w, 1200);
		const rigDry = await wadingOf(w, wader);
		const rigDrawn = (await drawnOf(w)).rigs?.[wader];
		const drySeen = await rigSeen('rig-bear-on-the-bank.png');
		verdict(
			'page W: its bear’s class names the rig, so the rig draws it; on the bank it is not wading: no filter, its own colour from top to bottom',
			rigOnBank &&
				rigDrawn?.rig === RIG &&
				rigDrawn.mounted === true &&
				(await drawnOf(w)).clips?.[wader] === undefined &&
				rigDry?.depth === 0 &&
				rigDry.filtered === false &&
				mostly(drySeen.low, isRig) &&
				mostly(drySeen.high, isRig),
			{ rigOnBank, rigDrawn, rigDry, low: drySeen.low[12], high: drySeen.high[12] },
		);
		moveTo(rigRoom, wader, WADE_AT.water);
		const rigRising = await depthsTo(w, wader, 1);
		const rigInWater = await standAt(rigRoom, w, wader, WADE_AT.water);
		await settle(w, 1200);
		const rigWet = await wadingOf(w, wader);
		const wetSeen = await rigSeen('rig-bear-wades.png');
		const rigMiddle = ((await drawnOf(w)).rigs?.[wader]?.height ?? 0) / 2;
		verdict(
			'…stood in open water the rig steps in and stands half under the water’s tint: its colour above the waterline, the same colour through the tint below it',
			rigInWater &&
				steppedOver(rigRising, 1) &&
				halfUnder(rigWet, rigMiddle) &&
				(await drawnOf(w)).rigs?.[wader]?.mounted === true &&
				mostly(wetSeen.high, isRig) &&
				!mostly(wetSeen.low, isRig) &&
				mostly(wetSeen.low, (rgb) => throughWater(rgb).some(isRig)),
			{ rigInWater, rigRising, rigWet, rigMiddle, low: wetSeen.low[12], high: wetSeen.high[12] },
		);
		moveTo(rigRoom, wader, WADE_AT.bank);
		const rigFalling = await depthsTo(w, wader, 0);
		await settle(w, 300);
		const rigAshore = await wadingOf(w, wader);
		verdict(
			'…back on the bank it steps out, and the rig has no filter again',
			steppedOver(rigFalling, 0) && rigAshore?.depth === 0 && rigAshore.filtered === false,
			{ rigFalling, rigAshore },
		);
		const errorsW = await w.page.evaluate('window.__AR_ERRORS__');
		verdict('page W: no page error', errorsW.length === 0, errorsW);
		await w.page.close();
		break play;
	}
	if (opt.hold) {
		const holdPage = async (profile, name, character) =>
			ready(
				await boot(profile, {
					rooms_name: name,
					rooms_character: character,
					rooms_game: HOLD_GAME,
					editorDocBase: snapHold.origin,
				}),
			);
		const k = await holdPage('k', 'Kit', 'bear');
		const q = await holdPage('q', 'Quill', 'salmon');
		await settle(q, 300);
		const { me: meQ } = await drawnOf(q);
		const magentaOf = async (game) => {
			const shot = PNG.sync.read(await game.page.screenshot());
			let n = 0;
			for (let i = 0; i < shot.data.length; i += 4)
				if (shot.data[i] > 200 && shot.data[i + 1] < 60 && shot.data[i + 2] > 200) n += 1;
			return n;
		};
		const logOfQ = async () =>
			((await drawnOf(k)).clipLog ?? [])
				.filter((line) => line.startsWith(`${meQ}:`))
				.map((line) => line.slice(meQ.length + 1));
		// A swipe lands a tile ahead of its user's last move. Screen left and down at once is world
		// +x on Salmons' mirrored screen: into the water, where the salmon is (the bank holds the
		// bear where it stands). `key` reads ArrowDown as down the river, so the raw key is sent.
		const raw = (code, type) =>
			k.page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: code,
				code,
				windowsVirtualKeyCode: KEY_CODES[code],
			});
		await raw('ArrowLeft', 'down');
		await raw('ArrowDown', 'down');
		await settle(k, 200);
		await raw('ArrowDown', 'up');
		await raw('ArrowLeft', 'up');
		let caught;
		for (let i = 0; i < 40 && !caught; i++) {
			await k.key('KeyJ', 'down');
			await k.play([{ op: 'step', frames: 3 }]);
			await k.key('KeyJ', 'up');
			await settle(k, 150);
			caught = (await drawnOf(k)).events?.find((ev) => ev.type === 'caught' && ev.target === meQ);
		}
		verdict('page K’s bear catches page Q’s salmon', !!caught, {
			caught,
			bodies: await players(k),
		});
		const samples = [];
		for (const atMs of [1500, 3000, 4500]) {
			await settle(k, 1500);
			const online = await drawnOf(k);
			samples.push({
				atMs,
				out: online.hidden?.includes(meQ) === true,
				clip: online.clips?.[meQ]?.clipId ?? null,
				magenta: await magentaOf(k),
			});
		}
		writeFileSync(join(out, 'hold-caught.png'), await k.page.screenshot());
		result.shots.push('hold-caught.png');
		const heldLog = await logOfQ();
		const caughtAt = heldLog.findLastIndex((id) => /^salmon_(pink|golden)_caught_/.test(id));
		verdict(
			'…put out, its catch held: drawn on the catch clip’s last frame (magenta) seconds after it played, and on no other clip',
			!!caught &&
				samples.every(
					(sample) =>
						sample.out &&
						/^salmon_(pink|golden)_caught_/.test(sample.clip ?? '') &&
						sample.magenta > 200,
				) &&
				caughtAt >= 0 &&
				caughtAt === heldLog.length - 1,
			{ samples, log: heldLog },
		);
		// This room has no generator, so no art and no death screen to press Respawn on: Q leaves.
		const errorsQ = await q.page.evaluate('window.__AR_ERRORS__');
		await q.page.close();
		let after;
		for (let i = 0; i < 40; i++) {
			await settle(k, 150);
			after = await drawnOf(k);
			if (!(await players(k)).some((b) => b.id === meQ)) break;
		}
		const magentaAfter = await magentaOf(k);
		verdict(
			'…and once Q leaves the room it is drawn no more: no clip, the held frame gone',
			!(await players(k)).some((b) => b.id === meQ) && !after?.clips?.[meQ] && magentaAfter === 0,
			{ clip: after?.clips?.[meQ] ?? null, magentaAfter, log: (await logOfQ()).slice(caughtAt) },
		);
		writeFileSync(join(out, 'hold-gone.png'), await k.page.screenshot());
		result.shots.push('hold-gone.png');
		const errorsK = await k.page.evaluate('window.__AR_ERRORS__');
		verdict('page K: no page error', errorsK.length === 0, errorsK);
		verdict('page Q: no page error', errorsQ.length === 0, errorsQ);
		await k.page.close();
		break play;
	}
	if (opt.trees) {
		const t = await ready(
			await boot('t', {
				rooms_name: 'Tam',
				rooms_character: 'salmon',
				editorDocBase: snapTrees.origin,
			}),
		);
		await settle(t, 1500);
		const regions = (await drawnOf(t)).art?.regions ?? {};
		const sum = (prefix) =>
			Object.entries(regions)
				.filter(([name]) => name.startsWith(prefix))
				.reduce((total, [, n]) => total + n, 0);
		const made = (await riverOf(t, config)).made?.made;
		verdict(
			'trees: page T draws every tree of its river with the trees’ art, and no built-in tree',
			(regions['zoneArt:@trees'] ?? 0) > 50 && sum('tree_') === 0,
			{ trees: regions['zoneArt:@trees'], builtIn: sum('tree_') },
		);
		verdict(
			'…and the rest of its river in the original images, as without it',
			!!made &&
				regions.grass_c > 100 &&
				sum('rock_') === (made.rocks?.length ?? 0) &&
				sum('whirlpool_') === made.whirlpools.length * 4 &&
				(regions.waterfall_face ?? 0) === (made.waterfalls?.length ?? 0) * 2,
			{ regions, rocks: made?.rocks?.length, pools: made?.whirlpools.length },
		);
		const shot = await t.page.screenshot();
		writeFileSync(join(out, 'trees.png'), shot);
		result.shots.push('trees.png');
		const png = PNG.sync.read(shot);
		let magenta = 0;
		for (let i = 0; i < png.data.length; i += 4)
			if (png.data[i] > 200 && png.data[i + 1] < 60 && png.data[i + 2] > 200) magenta += 1;
		verdict('…and the trees’ frame is on screen (magenta)', magenta > 500, { magenta });
		const errors = await t.page.evaluate('window.__AR_ERRORS__');
		verdict('page T: no page error', errors.length === 0, errors);
		await t.page.close();
		break play;
	}
	if (opt['zone-rig']) {
		const zr = await ready(
			await boot('zr', {
				rooms_name: 'Zora',
				rooms_character: 'salmon',
				editorDocBase: snapZoneRig.origin,
			}),
		);
		await settle(zr, 1500);
		const regions = (await drawnOf(zr)).art?.regions ?? {};
		const sum = (prefix) =>
			Object.entries(regions)
				.filter(([name]) => name.startsWith(prefix))
				.reduce((total, [, n]) => total + n, 0);
		const made = (await riverOf(zr, config)).made?.made;
		verdict(
			'zone rig: page ZR draws every rock and whirlpool of its river with the rig, none built in',
			!!made &&
				regions['zoneArt:rock#'] === (made.rocks?.length ?? 0) &&
				regions['zoneArt:whirlpool#'] === made.whirlpools.length &&
				sum('rock_') === 0 &&
				sum('whirlpool_') === 0,
			{
				rocks: [regions['zoneArt:rock#'], made?.rocks?.length, sum('rock_')],
				pools: [regions['zoneArt:whirlpool#'], made?.whirlpools.length, sum('whirlpool_')],
			},
		);
		verdict(
			'…and the rest of its river in the original images, as without it',
			!!made &&
				regions.grass_c > 100 &&
				sum('tree_') > 50 &&
				(regions.waterfall_face ?? 0) === (made.waterfalls?.length ?? 0) * 2,
			regions,
		);
		const near = (data, i, rgb) => rgb.every((c, k) => Math.abs(data[i + k] - c) <= 40);
		const coloursOf = async () => {
			const shot = await zr.page.screenshot();
			const { data } = PNG.sync.read(shot);
			const seen = { cyan: 0, yellow: 0 };
			for (let k = 0; k < data.length; k += 4)
				if (near(data, k, CYAN)) seen.cyan += 1;
				else if (near(data, k, YELLOW)) seen.yellow += 1;
			return { shot, seen };
		};
		// Upstream (the salmon starts at the sea) until a piece of the rig is well in view, then at
		// rest (the current carries it back down: the piece is watched while it is in view).
		// Whether two pieces start apart is held in Node (`check:salmons-art`): the room's river
		// is another every run, and two pieces are not always in one view.
		await zr.key('ArrowUp', 'down');
		for (let i = 0; i < 60; i++) {
			await settle(zr, 200);
			const { seen } = await coloursOf();
			if (seen.cyan + seen.yellow > 400) {
				await settle(zr, 600);
				break;
			}
		}
		await zr.key('ArrowUp', 'up');
		const colours = [];
		for (let i = 0; i < 16; i++) {
			await zr.play([{ op: 'step', frames: 4 }]);
			const { shot, seen } = await coloursOf();
			if (i === 0) {
				writeFileSync(join(out, 'zone-rig.png'), shot);
				result.shots.push('zone-rig.png');
			}
			colours.push(seen);
		}
		const shown = colours.filter((c) => c.cyan + c.yellow > 100);
		verdict(
			'…the rig is on screen, and plays: both of its drawings show over a second',
			shown.length >= 3 && shown.some((c) => c.cyan > 100) && shown.some((c) => c.yellow > 100),
			colours,
		);
		const errorsZr = await zr.page.evaluate('window.__AR_ERRORS__');
		verdict('page ZR: no page error', errorsZr.length === 0, errorsZr);
		await zr.page.close();

		break play;
	}
	if (opt.sheet) {
		const z = await ready(
			await boot('z', {
				rooms_name: 'Zed',
				rooms_character: 'salmon',
				rooms_game: SHEET_GAME,
				editorDocBase: snapSheet.origin,
			}),
		);
		await settle(z, 600);
		const { me } = await drawnOf(z);
		const logOf = async () =>
			((await drawnOf(z)).clipLog ?? [])
				.filter((line) => line.startsWith(`${me}:`))
				.map((line) => line.slice(me.length + 1));
		const eventOf = async (type) =>
			((await z.state()).arcade?.online?.events ?? []).find(
				(ev) => ev.type === type && ev.id === me,
			);
		const standing = (await drawnOf(z)).clips?.[me];
		verdict(
			'page Z: its class names a sheet, so the sheet’s clips draw its salmon (salmon_sheet_swim_*), not the game’s own (salmon_pink_*), which are registered too',
			standing?.clipId?.startsWith(`${SHEET_PREFIX}_swim_`) === true &&
				(await logOf()).every((clipId) => clipId === '' || clipId.startsWith(`${SHEET_PREFIX}_`)),
			{ standing, log: await logOf() },
		);
		await z.key('ArrowUp', 'down');
		let grounded;
		let up;
		for (let i = 0; i < 75 && !grounded; i++) {
			await settle(z, 60);
			const now = (await drawnOf(z)).clips?.[me];
			if (now?.clipId === `${SHEET_PREFIX}_swim_ne` && now.flipX) up ??= now;
			grounded = await eventOf('grounded');
		}
		verdict(
			'…swimming upstream (screen north-west) it plays the sheet’s swim_ne mirrored, as a block’s salmon does',
			up?.flipX === true,
			{ up, log: await logOf() },
		);
		await settle(z, 300);
		verdict(
			'…grounded on the sandbank heading upstream, it plays the action the tool added on that event (flop), which no characterClips block can name: the clip its north-east cell names',
			!!grounded && (await logOf()).at(-1) === SHEET_FLOP.anim.ne.clip,
			{ grounded, log: await logOf() },
		);
		writeFileSync(join(out, 'sheet-salmon-flop.png'), await z.page.screenshot());
		result.shots.push('sheet-salmon-flop.png');
		await z.key('Space', 'down');
		await z.play([{ op: 'step', frames: 4 }]);
		await z.key('Space', 'up');
		for (let i = 0; i < 16; i++) await settle(z, 150);
		await z.key('ArrowUp', 'up');
		const log = await logOf();
		const hopAt = log.lastIndexOf(`${SHEET_PREFIX}_hop_se`);
		const jumped = await eventOf('jumped');
		verdict(
			'…Space jumps it off the sandbank: the sheet’s hop once, then its swim again',
			!!jumped && hopAt >= 0 && log.slice(hopAt + 1).some((id) => id.includes('_swim_')),
			{ jumped, log },
		);
		// Back down onto the sandbank, heading downstream: the south-east flop has no cell, so the
		// sheet finds its clip by name.
		const groundings = async () =>
			((await z.state()).arcade?.online?.events ?? []).filter(
				(ev) => ev.type === 'grounded' && ev.id === me,
			).length;
		const before = { log: log.length, grounded: await groundings() };
		await z.key('ArrowDown', 'down');
		let down;
		for (let i = 0; i < 100 && !down; i++) {
			await settle(z, 60);
			if ((await logOf()).slice(before.log).includes(`${SHEET_PREFIX}_flop_se`)) down = true;
		}
		await z.key('ArrowDown', 'up');
		verdict(
			'…grounded again heading downstream, it plays the flop’s clip found by name (salmon_sheet_flop_se)',
			down === true,
			{ before, grounded: await groundings(), log: await logOf() },
		);
		const wire = await z.page.evaluate('window.__AR_WIRE__');
		const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
		verdict('page Z sends the RGS nothing', rgs.length === 0, rgs);
		const errors = await z.page.evaluate('window.__AR_ERRORS__');
		verdict('page Z: no page error', errors.length === 0, errors);
		await z.page.close();
		break play;
	}
	// Page A comes in as the last game's winner (a pass), so its salmon is golden.
	const a = await ready(
		await boot('a', { rooms_name: 'Ann', rooms_character: 'salmon' }, goldenJoin(KEY)),
	);
	const b = await ready(await boot('b', { rooms_name: 'Bo', rooms_character: 'bear' }));
	await settle(a, 800);
	await settle(b, 800);
	const listing = await fetch(`http://127.0.0.1:${roomsPort}/healthz`).then((r) => r.json());
	verdict('one room on the server', listing.rooms === 1, listing);
	const seenA = await players(a);
	const seenB = await players(b);
	const { me } = await drawnOf(a);
	const { me: meB } = await drawnOf(b);
	verdict(
		'both pages are in the room and see themselves',
		!!seenA.find((p) => p.id === me) && !!seenB.find((p) => p.id === meB),
		{ seenA, seenB },
	);
	for (const [name, game] of [
		['A', a],
		['B', b],
	])
		verdict(
			`page ${name} plays the ${opt.netcode} netcode`,
			(await drawnOf(game)).netcode === opt.netcode,
		);
	const botsIn = (list) => list.filter((p) => p.id.startsWith('bot:'));
	verdict(
		'the bots fill the room: page B is sent the bots near its bank',
		botsIn(seenB).length > 0,
		{
			seenB,
		},
	);
	verdict(
		'nearby: the bear on its bank far upstream is not sent to the salmon at the sea, nor it to the bear',
		!seenA.find((p) => p.id === meB) && !seenB.find((p) => p.id === me),
		{ seenA, seenB },
	);
	// The start menu's river list (`online.ts` `listRivers`): the server's `GET /rooms`, read from
	// the page's own origin, lists the room A and B are in with its people.
	const listedA = JSON.parse(
		await a.page.evaluate(
			`fetch('http://127.0.0.1:${roomsPort}/rooms?game=${KEY}').then((r) => r.json()).then((j) => JSON.stringify(j), (e) => JSON.stringify(String(e)))`,
		),
	);
	verdict(
		'the river list: the server lists this game’s room to the page, with its two people',
		Array.isArray(listedA) &&
			listedA.some((room) => typeof room.roomId === 'string' && room.players === 2),
		listedA,
	);
	const ownA = seenA.find((p) => p.id === me);
	verdict('page A’s salmon starts at the sea', ownA && ownA.y > river.sea.y - 200, ownA);
	const riverA = await riverOf(a, config);
	const riverB = await riverOf(b, config);
	verdict(
		'pages A and B (one room) make the river of the room’s seed and draw it',
		riverA.made !== null &&
			riverA.seed === riverB.seed &&
			riverA.drawn === true &&
			riverB.drawn === true &&
			JSON.stringify(riverA.zones) === JSON.stringify(zonesOf(riverA.made.game)) &&
			JSON.stringify(riverB.zones) === JSON.stringify(riverA.zones),
		{ seeds: [riverA.seed, riverB.seed], drawn: [riverA.drawn, riverB.drawn] },
	);
	verdict(
		'…the river the server plays: page A’s salmon started at that river’s sea',
		!!riverA.made &&
			!!ownA &&
			ownA.x === riverA.made.game.online.spawn.x &&
			ownA.y === riverA.made.game.online.spawn.y,
		{ ownA, spawn: riverA.made?.game.online.spawn },
	);
	verdict(
		'…and not the authored river',
		JSON.stringify(riverA.zones) !== JSON.stringify(zonesOf(onlineGameOf(config))),
	);
	const cam0 = (await a.state()).arcade?.camera;
	const frames = (cam, p) =>
		!!cam &&
		!!p &&
		p.x >= cam.x &&
		p.x <= cam.x + cam.view.w &&
		p.y >= cam.y &&
		p.y <= cam.y + cam.view.h;
	verdict('page A’s camera frames its own salmon', frames(cam0, ownA), { cam0, ownA });
	writeFileSync(join(out, '01-salmon-at-the-sea.png'), await a.page.screenshot());
	writeFileSync(join(out, '02-bear-on-its-bank.png'), await b.page.screenshot());
	result.shots.push('01-salmon-at-the-sea.png', '02-bear-on-its-bank.png');

	// Held until the salmon is 600 px upstream: how far a stretch of real time takes it depends on
	// how fast the shell steps its frames.
	await a.key('ArrowUp', 'down');
	for (let i = 0; i < 40; i++) {
		await settle(a, 500);
		const at = (await players(a)).find((p) => p.id === me);
		if (at && ownA && at.y < ownA.y - 600) break;
	}
	await a.key('ArrowUp', 'up');
	await settle(a, 600);
	const upA = (await players(a)).find((p) => p.id === me);
	const cam1 = (await a.state()).arcade?.camera;
	verdict('ArrowUp held swims page A’s salmon upstream', upA && ownA && upA.y < ownA.y - 500, {
		ownA,
		upA,
	});
	// The camera holds the salmon in its dead zone (none since 2026-11-18, the original's: it centres
	// on it, eased, so a little behind the room's place by the easing and the netcode's lag).
	const inDeadZone =
		!!cam1 &&
		!!upA &&
		Math.abs(upA.y - (cam1.y + cam1.view.h / 2)) <= SALMONS_CAMERA.deadZone.h / 2 + 24;
	verdict(
		'…and the camera follows it, holding it in its dead zone',
		!!cam0 && cam1.y < cam0.y - 100 && inDeadZone,
		{ cam0, cam1, upA },
	);
	const restFrom = (await players(a)).find((p) => p.id === me);
	await settle(a, 1200);
	// Resting in the water, the current carries the salmon down (it acts on every applied input,
	// and the page sends one each step): the page predicts the drift, a little ahead of the room's
	// last state.
	const drift = (await a.state()).arcade;
	const drawnMe = drift?.online?.drawn.find((d) => d.id === me);
	const roomMe = drift?.bodies.find((b) => b.id === me);
	const gap = drawnMe && roomMe ? Math.hypot(drawnMe.x - roomMe.x, drawnMe.y - roomMe.y) : Infinity;
	verdict('resting, page A draws its drifting salmon within 20 px of the room’s place', gap <= 20, {
		drawnMe,
		roomMe,
		gap,
	});
	verdict(
		'…and the current carried it downstream',
		!!roomMe && !!restFrom && roomMe.y > restFrom.y,
		{
			restFrom,
			roomMe,
		},
	);
	const shot = await a.page.screenshot();
	writeFileSync(join(out, '03-salmon-upstream.png'), shot);
	result.shots.push('03-salmon-upstream.png');
	// P11.4: the river screen is isometric. The own salmon is drawn upright where the projection
	// puts it, (y − x, (x + y) / 2) from the camera's centre (mirrored, as the original), not where
	// the flat world would.
	const iso = isometricAt(PNG.sync.read(shot), (await a.state()).arcade, me);
	verdict(
		'isometric: page A draws its salmon at its projected place, not its flat one',
		iso.ok,
		iso,
	);

	// The original art: the river a seed made, drawn in the old game's images, and the characters.
	const artA = (await a.state()).arcade?.online?.art;
	const made = riverA.made?.made;
	const regionsA = artA?.regions ?? {};
	const sum = (prefix) =>
		Object.entries(regionsA)
			.filter(([name]) => name.startsWith(prefix))
			.reduce((total, [, n]) => total + n, 0);
	verdict(
		'art: page A draws its room’s river in the original images (grass, trees, rocks, whirlpools, waterfalls)',
		!!made &&
			regionsA.grass_c > 100 &&
			sum('grass_') > regionsA.grass_c &&
			sum('tree_') > 50 &&
			sum('rock_') === (made.rocks?.length ?? 0) &&
			sum('whirlpool_') === made.whirlpools.length * 4 &&
			(regionsA.waterfall_face ?? 0) === (made.waterfalls?.length ?? 0) * 2 &&
			sum('sand_') > 0,
		{ regionsA, rocks: made?.rocks?.length, pools: made?.whirlpools.length },
	);
	verdict(
		'…and its salmon (golden) as a rope through the golden salmon texture, with no glow (the original’s look)',
		artA?.looks?.[me]?.kind === 'rope' &&
			artA.looks[me].region === 'salmon_golden' &&
			(await drawnOf(a)).marked?.includes(me) &&
			!(await drawnOf(a)).glowed?.includes(me),
		{ look: artA?.looks?.[me], glowed: (await drawnOf(a)).glowed },
	);
	// The leap (the original's, 2026-11-17): Space in open water lifts the salmon off the river,
	// curling, about 1.1 s, and it lands again.
	await a.key('Space', 'down');
	let leapTop = { lift: 0, curl: 0 };
	for (let i = 0; i < 12; i++) {
		await a.play([{ op: 'step', frames: 6 }]);
		await wait(50);
		const look = (await a.state()).arcade?.online?.art?.looks?.[me];
		if ((look?.lift ?? 0) > leapTop.lift) leapTop = { lift: look.lift, curl: look.curl };
	}
	await a.key('Space', 'up');
	await settle(a, 1500);
	const landedA = (await a.state()).arcade?.online?.art?.looks?.[me];
	verdict(
		'Space in open water: page A’s salmon leaps off the river and curls',
		leapTop.lift > 30 && leapTop.curl > 0.3,
		leapTop,
	);
	verdict('…and lands on the water again', landedA?.lift === 0, landedA);
	// No HUD (the original has none): the river alone, and the room's status as a variable.
	const shownA = await shown(a);
	const roomA = (await a.state()).arcade?.online;
	verdict(
		'page A shows the river with no HUD and no win screen, its flow reading the room’s status',
		shownA.includes('basegame') &&
			!shownA.includes('salmonsWon') &&
			!shownA.includes('salmonsCaught') &&
			(await variable(a, 'status')) === 'free',
		{ shown: shownA, round: roomA?.round },
	);

	// The bear's swipe on Space (the original's key), drawn on the press: its claw streak. Bears
	// catch bears (the original's): a bot may catch page B's bear at any time. Caught, it comes back
	// as a bear through its death screen, and an attempt it was caught in is played again.
	const mineB = (online) =>
		(online?.signals ?? []).filter((sig) => sig.name === 'ability' && sig.payload.mine);
	const caughtB = (online) =>
		(online?.events ?? []).filter((ev) => ev.type === 'caught' && ev.target === meB).length;
	const abilitiesB = (online) =>
		(online?.events ?? []).filter((ev) => ev.type === 'ability' && ev.by === meB).length;
	const swipeB = async () => {
		await keepPlaying(b, meB, 'bear');
		const before = (await b.state()).arcade?.online;
		const look = before?.art?.looks?.[meB];
		await b.key('Space', 'down');
		await b.play([{ op: 'step', frames: 3 }]);
		const pressed = (await b.state()).arcade?.online;
		await b.key('Space', 'up');
		const shot = await b.page.screenshot();
		await settle(b, 800);
		const after = (await b.state()).arcade?.online;
		return {
			look,
			shot,
			claw: pressed?.art?.looks?.[meB],
			predicted: mineB(pressed).slice(mineB(before).length),
			toldYet: abilitiesB(pressed) - abilitiesB(before),
			told: abilitiesB(after) > abilitiesB(before),
			raised: mineB(after).length - mineB(before).length,
			clawAfter: after?.art?.looks?.[meB],
			caught: caughtB(after) > caughtB(before) || !!after?.hidden?.includes(meB),
			events: after?.events,
		};
	};
	let swipe;
	for (let i = 0; i < 4 && (!swipe || swipe.caught); i++) swipe = await swipeB();
	verdict(
		'page B draws its bear as the bear sprite',
		swipe.look?.kind === 'sprite' && swipe.look.region === 'bear',
		swipe.look,
	);
	verdict(
		'page B’s Space swipes the bear on the press, before the room tells of it',
		swipe.predicted.length === 1 &&
			swipe.predicted[0].payload.predicted === true &&
			swipe.predicted[0].payload.character === 'bear' &&
			swipe.toldYet === 0,
		{ predicted: swipe.predicted, toldYet: swipe.toldYet },
	);
	writeFileSync(join(out, '04-bear-swipes.png'), swipe.shot);
	result.shots.push('04-bear-swipes.png');
	verdict(
		'…its claw streak sweeps beside the bear sprite',
		swipe.claw?.swiping === true,
		swipe.claw,
	);
	verdict(
		'…the room then tells of it, the device does not draw it twice, and the claw is gone',
		swipe.told && swipe.raised === 1 && swipe.clawAfter?.swiping !== true && !swipe.caught,
		{ events: swipe.events, claw: swipe.clawAfter, caught: swipe.caught },
	);

	// A round's end and the next round, in a room of 5 s rounds.
	const c = await ready(
		await boot('c', { rooms_name: 'Cy', rooms_character: 'salmon', rooms_game: SHORT }),
	);
	await settle(c, 600);
	const riverC = await riverOf(c, normalizeGameConfigDoc(short));
	verdict(
		'page C (another room) plays another river, its own room’s',
		riverC.made !== null &&
			riverC.seed !== riverA.seed &&
			riverC.drawn === true &&
			JSON.stringify(riverC.zones) === JSON.stringify(zonesOf(riverC.made.game)) &&
			JSON.stringify(riverC.made.made.bands) !== JSON.stringify(riverA.made?.made.bands),
		{ seeds: [riverA.seed, riverC.seed] },
	);
	writeFileSync(join(out, '05-another-river.png'), await c.page.screenshot());
	result.shots.push('05-another-river.png');
	const roundOf = async () => (await c.state()).arcade?.online?.round;
	const roundOne = await roundOf();
	let over;
	for (let i = 0; i < 40 && !over; i++) {
		await settle(c, 300);
		const signals = (await c.state()).arcade?.online?.signals.map((s) => s.name) ?? [];
		if (signals.includes('roundEnd')) over = { shown: await shown(c), signals };
	}
	verdict(
		'page C: the round ends on its clock and its flow hears it; no game was won, so no win screen',
		!!over &&
			roundOne === 1 &&
			!over.signals.includes('gameWon') &&
			!over.shown.includes('salmonsWon'),
		{ roundOne, over },
	);
	if (over) writeFileSync(join(out, '06-round-over.png'), await c.page.screenshot());
	if (over) result.shots.push('06-round-over.png');
	let next;
	for (let i = 0; i < 30 && !next; i++) {
		await settle(c, 300);
		if ((await roundOf()) === 2) next = await shown(c);
	}
	verdict(
		'…and the next round starts',
		!!next && !next.includes('salmonsWon') && next.includes('basegame'),
		next,
	);

	// P11.3, page E: a waterfall stops the salmon from below; tapping Space climbs it.
	const ownOf = async (game) => {
		const { me: id } = await drawnOf(game);
		return (await players(game)).find((p) => p.id === id);
	};
	const eventsOf = async (game) => (await game.state()).arcade?.online?.events ?? [];
	const tap = async (game) => {
		await game.key('Space', 'down');
		await game.play([{ op: 'step', frames: 4 }]);
		await game.key('Space', 'up');
		await game.play([{ op: 'step', frames: 4 }]);
	};
	const e = await ready(
		await boot('e', { rooms_name: 'Ed', rooms_character: 'salmon', rooms_game: 'salmons-falls' }),
	);
	await settle(e, 600);
	const { me: meE } = await drawnOf(e);
	await e.key('ArrowUp', 'down');
	await settle(e, 2000);
	const footA = await ownOf(e);
	await settle(e, 800);
	const footB = await ownOf(e);
	const foot = FALL.y + FALL.h + 22;
	verdict(
		'page E: holding ArrowUp, its salmon is stopped at the foot of the waterfall',
		!!footA && !!footB && Math.abs(footB.y - foot) < 2 && Math.abs(footB.y - footA.y) < 2,
		{ footA, footB, foot },
	);
	writeFileSync(join(out, '07-at-the-waterfall.png'), await e.page.screenshot());
	result.shots.push('07-at-the-waterfall.png');
	let climbed;
	for (let i = 0; i < 40 && !climbed; i++) {
		await tap(e);
		climbed = (await eventsOf(e)).find((ev) => ev.type === 'climbed' && ev.id === meE);
	}
	// Let go at the top (no lift over it, since 2026-11-17), it swims on over the waterfall.
	await settle(e, 1500);
	const above = await ownOf(e);
	await e.key('ArrowUp', 'up');
	verdict(
		'…tapping Space climbs it: the room tells of the climb, and the salmon swims on over it',
		!!climbed && !!above && above.y < FALL.y,
		{ climbed, above, fall: FALL },
	);
	writeFileSync(join(out, '08-over-the-waterfall.png'), await e.page.screenshot());
	result.shots.push('08-over-the-waterfall.png');

	// Mouse and touch (docs/design/arcade-pointer-controller.md), page P, in page E's river: a finger
	// held upstream swims the salmon there; lifted, it stops steering; a tap at the waterfall's
	// foot is a jump, so taps climb it as Space did; a hovering mouse steers with no button.
	const p = await ready(
		await boot('p', { rooms_name: 'Pi', rooms_character: 'salmon', rooms_game: 'salmons-falls' }),
	);
	await p.page.page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	await settle(p, 600);
	const { me: meTouch } = await drawnOf(p);
	/** Where world point `at` is on page P's canvas, in CSS px (the isometric screen). */
	const screenOfP = async (at) => {
		const cam = (await p.state()).arcade?.camera;
		const rect = JSON.parse(
			await p.page.evaluate(
				'JSON.stringify(document.querySelector("canvas").getBoundingClientRect())',
			),
		);
		const k = rect.width / cam.view.w;
		const dx = at.x - (cam.x + cam.view.w / 2);
		const dy = at.y - (cam.y + cam.view.h / 2);
		return {
			x: Math.round(rect.left + (cam.view.w / 2 + cam.shakeX + dy - dx) * k),
			y: Math.round(rect.top + (cam.view.h / 2 + cam.shakeY + (dx + dy) / 2) * k),
		};
	};
	const touchP = (type, points) =>
		p.page.page('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((point, id) => ({ ...point, id })),
		});
	const startP = await ownOf(p);
	const fingerAt = await screenOfP({ x: startP.x, y: startP.y - 300 });
	await touchP('touchStart', [fingerAt]);
	let footP;
	for (let i = 0; i < 30; i++) {
		await settle(p, 300);
		footP = await ownOf(p);
		if (footP && Math.abs(footP.y - foot) < 3) break;
	}
	verdict(
		'page P: a finger held upstream swims its salmon there, to the foot of the waterfall',
		!!footP && !!startP && footP.y < startP.y - 40 && Math.abs(footP.y - foot) < 3,
		{ startP, footP, foot, fingerAt },
	);
	await touchP('touchMove', [{ x: fingerAt.x + 30, y: fingerAt.y }]);
	await touchP('touchEnd', []);
	await settle(p, 1200);
	const liftedP = await ownOf(p);
	verdict(
		'…lifted (after a drag, so no tap), it stops steering and the current carries it down',
		!!liftedP &&
			liftedP.y > footP.y + 5 &&
			!(await eventsOf(p)).some((ev) => ev.type === 'climbed' && ev.id === meTouch),
		{ footP, liftedP },
	);
	await p.key('ArrowUp', 'down');
	await settle(p, 1500);
	let climbedP;
	for (let i = 0; i < 40 && !climbedP; i++) {
		const at = await screenOfP((await ownOf(p)) ?? footP);
		await touchP('touchStart', [at]);
		await p.play([{ op: 'step', frames: 4 }]);
		await touchP('touchEnd', []);
		await p.play([{ op: 'step', frames: 4 }]);
		climbedP = (await eventsOf(p)).find((ev) => ev.type === 'climbed' && ev.id === meTouch);
	}
	// Let go at the top it swims on over (as page E's, up to 1.5 s: a one-tap fall may be climbed
	// again by the taps still on their way).
	let overP;
	for (let i = 0; i < 10 && !(overP && overP.y < FALL.y); i++) {
		await settle(p, 150);
		overP = await ownOf(p);
	}
	verdict(
		'…taps on the screen are its jump: with ArrowUp held, they climb the waterfall',
		!!climbedP && !!overP && overP.y < FALL.y,
		{ climbedP, overP, fall: FALL },
	);
	writeFileSync(join(out, '08b-touch-over-the-waterfall.png'), await p.page.screenshot());
	result.shots.push('08b-touch-over-the-waterfall.png');
	// The leap heads for the tap (the original's `targetX/Y`, 2026-11-18): upstream of the waterfall
	// (out of its climb's reach), a quick tap four cells across the river from the salmon, the
	// finger lifted at once and no key held, leaps it there, and it carries the leap across until it
	// lands (without the carry it would only drift down with the current).
	await settle(p, 600);
	await p.key('ArrowUp', 'up');
	const leapFrom = await ownOf(p);
	const leapBand = river.bands.find((b) => leapFrom && leapFrom.y >= b.y && leapFrom.y < b.y + b.h);
	const across = leapBand && leapFrom.x - leapBand.left < leapBand.right - leapFrom.x ? 1 : -1;
	const tapAt = await screenOfP({ x: leapFrom.x + across * 4 * 48, y: leapFrom.y });
	await touchP('touchStart', [tapAt]);
	await p.play([{ op: 'step', frames: 2 }]);
	await touchP('touchEnd', []);
	await settle(p, 1800);
	const leapTo = await ownOf(p);
	verdict(
		'…a tap across the river leaps it towards the tap, carried across with the finger lifted',
		!!leapTo && across * (leapTo.x - leapFrom.x) > 120,
		{ leapFrom, leapTo, across, tapAt },
	);
	await p.page.page('Emulation.setTouchEmulationEnabled', { enabled: false });
	const hoverFrom = await ownOf(p);
	const cursor = await screenOfP({ x: hoverFrom.x, y: hoverFrom.y - 400 });
	await p.page.page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cursor.x, y: cursor.y });
	await settle(p, 1500);
	const hoverTo = await ownOf(p);
	verdict(
		"…and a mouse hovering upstream, no button pressed, swims it there (the original's hover)",
		!!hoverTo && !!hoverFrom && hoverTo.y < hoverFrom.y - 100,
		{ hoverFrom, hoverTo, cursor },
	);
	await p.page.close();

	// P11.3, page F: a sandbank grounds the salmon until it jumps.
	const f = await ready(
		await boot('f', { rooms_name: 'Fi', rooms_character: 'salmon', rooms_game: 'salmons-sand' }),
	);
	await settle(f, 600);
	const { me: meF } = await drawnOf(f);
	await f.key('ArrowUp', 'down');
	let grounded;
	for (let i = 0; i < 20 && !grounded; i++) {
		await settle(f, 200);
		grounded = (await eventsOf(f)).find((ev) => ev.type === 'grounded' && ev.id === meF);
	}
	await settle(f, 300);
	const sandA = await ownOf(f);
	await settle(f, 1000);
	const sandB = await ownOf(f);
	verdict(
		'page F: its salmon swims onto the sandbank and is grounded: ArrowUp held, it stays put',
		!!grounded && !!sandA && !!sandB && sandA.x === sandB.x && sandA.y === sandB.y,
		{ grounded, sandA, sandB },
	);
	writeFileSync(join(out, '09-grounded.png'), await f.page.screenshot());
	result.shots.push('09-grounded.png');
	await tap(f);
	let off;
	for (let i = 0; i < 20; i++) {
		await settle(f, 200);
		off = await ownOf(f);
		if (off && off.y < SAND.y - 30) break;
	}
	await f.key('ArrowUp', 'up');
	const jumped = (await eventsOf(f)).find((ev) => ev.type === 'jumped' && ev.id === meF);
	verdict(
		'…Space jumps it off, and it swims on upstream',
		!!jumped && !!off && off.y < SAND.y - 30,
		{ jumped, off, sand: SAND },
	);

	// The rules' events reach Flow as online events (after P11.3).
	const signalsOf = async (game, name) =>
		((await game.state()).arcade?.online?.signals ?? []).filter((sig) => sig.name === name);
	const climbedE = await signalsOf(e, 'climbed');
	const groundedF = await signalsOf(f, 'grounded');
	const jumpedF = await signalsOf(f, 'jumped');
	verdict(
		'Flow hears the rules’ events: page E’s climb (`climbed`), page F’s `grounded` and `jumped`',
		climbedE.some((sig) => sig.payload.player === meE && sig.payload.me && sig.payload.zone) &&
			groundedF.some((sig) => sig.payload.player === meF && sig.payload.me) &&
			jumpedF.some((sig) => sig.payload.player === meF && sig.payload.me),
		{ climbedE, groundedF, jumpedF },
	);

	// After P11.3, pages G and H: the golden salmon drawn gold, and the fishing line.
	const LINE_GAME = 'salmons-line';
	const h = await ready(
		await boot('h', { rooms_name: 'Hal', rooms_character: 'fisherman', rooms_game: LINE_GAME }),
	);
	// Page G comes in as the last game's winner: its salmon is golden (cosmetic, owner decision 3).
	const g = await ready(
		await boot(
			'g',
			{ rooms_name: 'Gil', rooms_character: 'salmon', rooms_game: LINE_GAME },
			goldenJoin(LINE_GAME),
		),
	);
	await settle(g, 600);
	await settle(h, 600);
	const { me: meG } = await drawnOf(g);
	const { me: meH } = await drawnOf(h);
	const shotOf = async (game, file) => {
		const png = await game.page.screenshot();
		writeFileSync(join(out, file), png);
		result.shots.push(file);
		return PNG.sync.read(png);
	};
	const markedG = (await drawnOf(g)).marked ?? [];
	const markedH = (await drawnOf(h)).marked ?? [];
	const goldG = goldAt(await shotOf(g, '10-golden-salmon.png'), (await g.state()).arcade, meG);
	const goldH = goldAt(
		await shotOf(h, '11-golden-seen-by-fisherman.png'),
		(await h.state()).arcade,
		meG,
	);
	verdict(
		'page G’s salmon (its pass: the last game’s winner) is golden, and pages G and H both draw it gold',
		markedG.includes(meG) &&
			markedH.includes(meG) &&
			goldG.ok &&
			goldH.ok &&
			!(await drawnOf(g)).glowed?.includes(meG) &&
			!(await drawnOf(h)).glowed?.includes(meG),
		{ markedG, markedH, goldG, goldH },
	);
	verdict(
		'…the room’s `golden` reached page G’s flow',
		(await signalsOf(g, 'golden')).some((sig) => sig.payload.player === meG && sig.payload.me),
	);
	/** A tap on the salmon, as the original's click casts. */
	const castUntilHooked = async () => {
		const atG = (await drawnOf(h)).drawn.find((d) => d.id === meG);
		if (!atG) return false;
		await clickAt(h, await stageOf(h, { ...atG, lift: 20 }));
		for (let i = 0; i < 60; i++) {
			await h.play([{ op: 'step', frames: 2 }]);
			const online = await drawnOf(h);
			if (online.lines?.some((l) => l.by === meH && l.target === meG)) return true;
		}
		return false;
	};
	const lookH = (await drawnOf(h)).art?.looks?.[meH];
	verdict(
		'page H draws its fisherman as the original circle, his line from his hand',
		lookH?.kind === 'circle' && !!lookH.hand && lookH.hand.dx > 0,
		lookH,
	);
	// The cast is aimed (the original's). H has not moved, so J casts at the nearest salmon (the
	// device's key-only aim). The reel lands it within about a second (8 tiles/s), and pages drawing
	// the art step slowly in the headless shell: H and G are stepped in turn, H's state and screen
	// taken in the frame its line first shows (a page's canvas holds its last stepped frame), G's
	// lines read as soon as it draws one.
	await h.key('KeyJ', 'down');
	await h.play([{ op: 'step', frames: 2 }]);
	await h.key('KeyJ', 'up');
	let arcadeH;
	let shotH;
	let linesG = [];
	const onLine = (lines) => (lines ?? []).some((l) => l.by === meH && l.target === meG);
	const drawnByG = async () =>
		linesG.some((l) => l.by === meH) || ((await drawnOf(g)).lineLog ?? []).includes(meH);
	for (let i = 0; i < 40 && !(arcadeH && (await drawnByG())); i++) {
		// G first: its frames run only when stepped, and the line is out for well under a second.
		if (!(await drawnByG())) {
			await g.play([{ op: 'step', frames: 2 }]);
			linesG = (await drawnOf(g)).lines ?? [];
		}
		if (!arcadeH) {
			await h.play([{ op: 'step', frames: 2 }]);
			const seen = (await h.state()).arcade;
			if (onLine(seen?.online?.lines)) {
				arcadeH = seen;
				shotH = await shotOf(h, '12-the-line.png');
			}
		}
		await wait(30);
	}
	const hooked = !!arcadeH;
	shotH ??= await shotOf(h, '12-the-line.png');
	const lineH = lineAt(shotH, arcadeH, meH, meG);
	const lineArt = arcadeH?.online?.art?.lines ?? [];
	const hookedG = await signalsOf(g, 'hooked');
	verdict(
		'page H’s J (not moved yet: aimed at the nearest salmon) hooks it: both pages draw the line from the fisherman to it',
		hooked && lineH.ok && (await drawnByG()),
		{ hooked, lineH, linesG },
	);
	verdict(
		'…the old client’s line: 0xddddaa',
		lineArt.length > 0 && lineArt.every((c) => c === 0xddddaa),
		lineArt,
	);
	verdict(
		'…Flow hears `hooked` on page G (it is on the line)',
		hookedG.some((sig) => sig.payload.by === meH && sig.payload.me && !sig.payload.mine),
		{ hookedG },
	);
	let landed;
	for (let i = 0; i < 30 && !landed; i++) {
		await settle(h, 150);
		landed = (await eventsOf(h)).find((ev) => ev.type === 'caught' && ev.target === meG);
	}
	await settle(g, 300);
	await settle(h, 300);
	const goneH = await drawnOf(h);
	const goneG = await drawnOf(g);
	const arcadeLanded = (await h.state()).arcade;
	// In the art the line's colour is the sandbank's under the salmon: the probe says it is gone.
	const lineGone = arcadeLanded?.online?.art
		? { ok: (arcadeLanded.online.art.lines ?? []).length > 0 }
		: lineAt(await shotOf(h, '13-landed.png'), arcadeLanded, meH, meG);
	if (arcadeLanded?.online?.art) await shotOf(h, '13-landed.png');
	verdict(
		'…reeled in and landed (`caught`): the line is gone on both pages',
		!!landed && !goneH.lines?.length && !goneG.lines?.length && !lineGone.ok,
		{ landed, linesH: goneH.lines, linesG: goneG.lines, hidden: goneH.hidden },
	);
	// The catch on both pages: H's fisherman says so over himself, G's death screen names him.
	const floatsH = (await drawnOf(h)).art?.floats?.[meH] ?? [];
	verdict(
		'…page H’s fisherman shows "you catch Gil!" over him',
		floatsH.includes('you catch Gil!'),
		floatsH,
	);
	// Page G presses Respawn as a salmon on its death screen; back on the sand (after its grace),
	// it is hooked again by a click on it; then the fisherman leaves and the line breaks.
	const deathG = await respawnThrough(g, meG, 'salmon');
	verdict(
		'page G’s death screen: “by Hal”, shown by its flow; Respawn as a salmon brings it back and the screen goes',
		deathG.flowShown &&
			deathG.screen?.by === 'Hal' &&
			deathG.back &&
			deathG.gone &&
			deathG.respawned,
		deathG,
	);
	await settle(h, 1500);
	for (const [name, game] of [
		['G', g],
		['H', h],
	]) {
		const wire = await game.page.evaluate('window.__AR_WIRE__');
		const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
		verdict(`page ${name} sends the RGS nothing`, rgs.length === 0, rgs);
		const errors = await game.page.evaluate('window.__AR_ERRORS__');
		verdict(`page ${name}: no page error`, errors.length === 0, errors);
	}
	// Page G2 (no pass) is pink, and stays pink when the golden salmon leaves: golden is the last
	// game's winner, never passed on.
	const g2 = await ready(
		await boot('g2', { rooms_name: 'Gus', rooms_character: 'salmon', rooms_game: LINE_GAME }),
	);
	await settle(g2, 400);
	const { me: meG2 } = await drawnOf(g2);
	const looksG2 = (await drawnOf(g2)).art?.looks ?? {};
	verdict(
		'page G2 draws its own salmon pink and page G’s golden, each a rope through its texture',
		looksG2[meG2]?.kind === 'rope' &&
			looksG2[meG2].region === 'salmon_pink' &&
			looksG2[meG]?.region === 'salmon_golden',
		{ mine: looksG2[meG2], golden: looksG2[meG] },
	);
	// H leaves as soon as it sees the salmon on the line again, before the reel (8 tiles/s) lands it.
	const again = await castUntilHooked();
	await h.page.close();
	let escaped;
	for (let i = 0; i < 40 && !escaped; i++) {
		await settle(g, 150);
		escaped = (await signalsOf(g, 'escaped')).find((sig) => sig.payload.target === meG);
	}
	await settle(g, 300);
	const brokenG = await drawnOf(g);
	verdict(
		'…hooked again by a click on it, the fisherman leaves: the line breaks (`escaped` heard on page G) and is gone',
		again && !!escaped && escaped.payload.me === true && !brokenG.lines?.length,
		{ again, escaped, lines: brokenG.lines },
	);
	await g.page.close();
	await settle(g2, 3000);
	const pinkG2 = (await drawnOf(g2)).art?.looks?.[meG2];
	writeFileSync(join(out, '14-golden-passes-on.png'), await g2.page.screenshot());
	result.shots.push('14-golden-passes-on.png');
	verdict(
		'…the golden salmon leaves: page G2’s stays pink (no banner)',
		pinkG2?.region === 'salmon_pink' &&
			!((await drawnOf(g2)).marked ?? []).includes(meG2) &&
			!(await signalsOf(g2, 'golden')).some((sig) => sig.payload.me),
		{ pinkG2 },
	);

	// The game won (the original's one game a room): page W's salmon starts just below the source
	// and swims into it. The win animation comes up (it won: "You Won!", eggs), the room gives it a
	// winner's pass, and its button leaves for a new room, where it is golden.
	const w = await ready(
		await boot('w', { rooms_name: 'Wyn', rooms_character: 'salmon', rooms_game: WIN_GAME }),
	);
	await settle(w, 600);
	const { me: meW, seed: seedW } = await drawnOf(w);
	await w.key('ArrowUp', 'down');
	let wonW;
	for (let i = 0; i < 40 && !wonW; i++) {
		await settle(w, 250);
		wonW = (await eventsOf(w)).find((ev) => ev.type === 'gameWon');
	}
	await w.key('ArrowUp', 'up');
	let winScreen;
	for (let i = 0; i < 20 && !(winScreen?.eggs > 0); i++) {
		await settle(w, 150);
		winScreen = (await drawnOf(w)).screens?.won;
	}
	writeFileSync(join(out, '14b-you-won.png'), await w.page.screenshot());
	result.shots.push('14b-you-won.png');
	const passW = (await eventsOf(w)).some((ev) => ev.type === 'winnerPass');
	verdict(
		'page W reaches the source: `gameWon` for it, the win screen says “You Won!” and lays eggs, and the room gives it a pass',
		wonW?.winner === meW &&
			wonW.winnerName === 'Wyn' &&
			(await shown(w)).includes('salmonsWon') &&
			winScreen?.title === 'You Won!' &&
			winScreen.eggs > 0 &&
			passW,
		{ wonW, winScreen, passW },
	);
	// The button leaves for a new room on the same page (`online.ts` `switchRoom`): the page is
	// stepped until it is another session's. A page that loaded again would have lost the mark.
	await w.page.evaluate('window.__ptBeforeRejoin = true');
	if (winScreen?.button) await clickAt(w, winScreen.button);
	let newW = {};
	for (let i = 0; i < 120 && !(newW.me && newW.me !== meW); i++) {
		await w.play([{ op: 'step', frames: 6 }]).catch(() => {});
		await wait(50);
		newW = await drawnOf(w).catch(() => ({}));
	}
	const stayed = await w.page.evaluate('window.__ptBeforeRejoin === true').catch(() => false);
	const shownNewW = await shown(w);
	// Its room marks the golden salmon as its round runs, and its art comes under it.
	for (let i = 0; i < 40 && !((newW.marked ?? []).includes(newW.me) && newW.art); i++) {
		await settle(w, 150);
		newW = await drawnOf(w);
	}
	writeFileSync(join(out, '14c-joined-new-game.png'), await w.page.screenshot());
	result.shots.push('14c-joined-new-game.png');
	verdict(
		'…“Join New Game” leaves for a new room (another river) on the same page, with no reload: the win screen is gone, no loading screen shows, and its salmon is golden',
		stayed &&
			!!newW.me &&
			newW.me !== meW &&
			newW.seed !== seedW &&
			shownNewW.includes('basegame') &&
			!shownNewW.includes('salmonsWon') &&
			!shownNewW.includes('loading') &&
			newW.screens?.won?.shown === false &&
			!(newW.events ?? []).some((ev) => ev.type === 'gameWon') &&
			(newW.marked ?? []).includes(newW.me) &&
			newW.art?.looks?.[newW.me]?.region === 'salmon_golden',
		{ stayed, seeds: [seedW, newW.seed], shown: shownNewW, marked: newW.marked },
	);
	const wErrors = await w.page.evaluate('window.__AR_ERRORS__').catch(() => ['the page is gone']);
	verdict('page W: no page error across the two rooms', wErrors.length === 0, wErrors);
	await w.page.close();

	// The bloodstain (GuiltyForever/Salmon- PR #8): page K's bear catches page Q's salmon in open
	// water; both pages are sent the stain and draw it. (The red and the trail are pinned by
	// check:salmons-art: these pages draw a river of the room's seed while the room plays the
	// authored one, so the water a page draws under a stain is not the room's.)
	const BLOOD_GAME = 'salmons-blood';
	const k = await ready(
		await boot('k', { rooms_name: 'Kit', rooms_character: 'bear', rooms_game: BLOOD_GAME }),
	);
	const q = await ready(
		await boot('q', { rooms_name: 'Quill', rooms_character: 'salmon', rooms_game: BLOOD_GAME }),
	);
	await settle(q, 300);
	const { me: meQ } = await drawnOf(q);
	// A swipe is one a press (WS-B's `onPress`): J tapped until the salmon, out of its join's grace
	// and in reach, is caught.
	// The swipe lands a tile ahead of the bear's last move (WS-B's `ahead`): K first steps towards
	// the water (world +x), to its left on the mirrored screen.
	await k.key('ArrowLeft', 'down');
	await settle(k, 200);
	await k.key('ArrowLeft', 'up');
	let stainK;
	for (let i = 0; i < 40 && !stainK?.stains?.length; i++) {
		await k.key('KeyJ', 'down');
		await k.play([{ op: 'step', frames: 3 }]);
		await k.key('KeyJ', 'up');
		await settle(k, 150);
		stainK = await drawnOf(k);
	}
	// The stain may be read from a patch the page has not drawn yet, and `caught` comes after it.
	await settle(k, 300);
	stainK = await drawnOf(k);
	const caught = stainK.events?.find((ev) => ev.type === 'caught' && ev.target === meQ);
	// Out for 3 s, the salmon is held where it was caught.
	const outAt = (await players(k)).find((body) => body.id === meQ);
	await settle(q, 300);
	const stainQ = await drawnOf(q);
	const [sx, sy] = stainK?.stains?.[0] ?? [];
	verdict(
		'a bear’s catch leaves a bloodstain where the salmon was: both pages are sent it and draw it',
		!!caught &&
			stainK?.stains?.length === 1 &&
			stainQ.stains?.length === 1 &&
			!!outAt &&
			Math.hypot(sx - outAt.x, sy - outAt.y) < 1 &&
			stainK.art?.blood?.stains === 1 &&
			stainQ.art?.blood?.stains === 1,
		{ caught, outAt, stainsK: stainK?.stains, stainsQ: stainQ.stains, blood: stainK?.art?.blood },
	);
	await shotOf(k, '14b-bloodstain.png');
	await k.page.close();
	await q.page.close();

	// The bear wades (owner, 2026-11-25; `engine-layout` `salmonsArt/wade.ts`), on the original's
	// level: the band river's water stops a bear, this one's lets it in (check:room-bots). The
	// level is pinned, so the room plays, and the pages draw, the river made here (`wadeRiver`).
	const wadePage = (profile, name, character) =>
		boot(profile, {
			rooms_name: name,
			rooms_character: character,
			rooms_game: WADE_GAME,
			editorDocBase: snapWade.origin,
		});
	const wb = await ready(await wadePage('wb', 'Wade', 'bear'));
	const wf = await ready(await wadePage('wf', 'Finn', 'fisherman'));
	await settle(wb, 600);
	await settle(wf, 400);
	const { me: meWb } = await drawnOf(wb);
	const { me: meWf } = await drawnOf(wf);
	// The wading comes with the bear's code look, once the art has loaded (in real time).
	for (let i = 0; i < 80 && !(await wadingOf(wb, meWb)); i++) await settle(wb, 250);
	const wadeRoom = await roomOf(WADE_GAME);
	// The bear sprite's fur: brown, red over green over blue.
	const isFur = ([r, g, b]) => r > g && g > b && r - b > 30;
	const furUnder = (seen) => throughWater(seen).some(isFur);
	const meanOf = (seen) =>
		[0, 1, 2].map((c) => seen.reduce((sum, rgb) => sum + rgb[c], 0) / seen.length);
	/** Whether a patch is darker than another in every channel, by more than the water's shimmer. */
	const darker = (seen, than) =>
		seen.length > 0 && than.length > 0 && meanOf(seen).every((c, i) => c < meanOf(than)[i] - 6);
	// Two heights up the bear's middle, clear of the line whichever way the sprite is turned: one
	// under the line's lowest point (and its rim and bob), one over its ends.
	const WADE_LIFT = { low: 10, high: 36 };

	const onBank = await standAt(wadeRoom, wb, meWb, WADE_AT.bank);
	await settle(wb, 1200);
	const dry = await wadingOf(wb, meWb);
	const dryShot = await shotOf(wb, '14c-bear-on-the-bank.png');
	const dryArcade = (await wb.state()).arcade;
	const drySeen = {
		low: lookAt(dryShot, dryArcade, meWb, WADE_LIFT.low),
		high: lookAt(dryShot, dryArcade, meWb, WADE_LIFT.high),
	};
	verdict(
		'page WB: on the bank its bear is not wading: no filter on its look, its fur drawn as it is',
		onBank &&
			dry?.depth === 0 &&
			dry.filtered === false &&
			dry.line === null &&
			mostly(drySeen.low, isFur) &&
			mostly(drySeen.high, isFur),
		{ onBank, at: WADE_AT.bank, dry, low: drySeen.low[12], high: drySeen.high[12] },
	);

	// Its own keys walk it in: the screen's Left is across the river and up it (world +x, −y).
	await wb.key('ArrowLeft', 'down');
	const rising = await depthsTo(wb, meWb, 1);
	await wb.key('ArrowLeft', 'up');
	const walkedTo = (await drawnOf(wb)).drawn?.find((d) => d.id === meWb);
	verdict(
		'…its keys walk it into the water, and it steps in: the waterline rises over about 250 ms, never falling back',
		steppedOver(rising, 1) && !!walkedTo && walkedTo.x > WADE_AT.bank.x + 48,
		{ rising, from: WADE_AT.bank, walkedTo },
	);
	const inWater = await standAt(wadeRoom, wb, meWb, WADE_AT.water);
	await settle(wb, 1200);
	const wet = await wadingOf(wb, meWb);
	const wetShot = await shotOf(wb, '14d-bear-wades.png');
	const wetArcade = (await wb.state()).arcade;
	const wetSeen = {
		low: lookAt(wetShot, wetArcade, meWb, WADE_LIFT.low),
		high: lookAt(wetShot, wetArcade, meWb, WADE_LIFT.high),
	};
	const lookWb = wetArcade?.online?.art?.looks?.[meWb];
	// The water it now stands in, as the bank's picture showed it bare. The riverbed's sand is a
	// brown too and un-mixes to itself, so the bear's lower half is told from a hole in it by the
	// place: fur under the tint is darker than that water was.
	const bareSeen = patchAt(
		dryShot,
		dryArcade?.camera,
		wetArcade?.online?.drawn.find((d) => d.id === meWb),
		WADE_LIFT.low,
	);
	verdict(
		'…and stands half under the water’s tint: its fur above the waterline, the same fur through the tint below it',
		inWater &&
			halfUnder(wet, lookWb?.middle) &&
			mostly(wetSeen.high, isFur) &&
			!mostly(wetSeen.low, isFur) &&
			mostly(wetSeen.low, furUnder) &&
			darker(wetSeen.low, bareSeen),
		{
			inWater,
			wet,
			middle: lookWb?.middle,
			low: wetSeen.low.length ? meanOf(wetSeen.low) : null,
			high: wetSeen.high[12],
			bare: bareSeen.length ? meanOf(bareSeen) : null,
		},
	);
	// The fisherman on a bridge's deck is over open water and is no wader: his own page, which
	// draws him by his code look, says so of him.
	const onBridge = await standAt(wadeRoom, wf, meWf, WADE_AT.bridge);
	await settle(wf, 1200);
	await shotOf(wf, '14e-fisherman-on-a-bridge.png');
	const onlineWf = await drawnOf(wf);
	verdict(
		'…page WF’s fisherman, stood on a bridge’s deck over open water, is no wader: the art holds no wading for him',
		onBridge &&
			onlineWf.art?.looks?.[meWf]?.kind === 'circle' &&
			!!onlineWf.art.wading &&
			!(meWf in onlineWf.art.wading),
		{
			onBridge,
			at: WADE_AT.bridge,
			look: onlineWf.art?.looks?.[meWf],
			wading: onlineWf.art?.wading,
		},
	);
	moveTo(wadeRoom, meWb, WADE_AT.bank);
	const falling = await depthsTo(wb, meWb, 0);
	await settle(wb, 300);
	const ashore = await wadingOf(wb, meWb);
	verdict(
		'…back on the bank it steps out: the line falls, and its look has no filter again',
		steppedOver(falling, 0) && ashore?.depth === 0 && ashore.filtered === false,
		{ falling, ashore },
	);
	for (const [name, game] of [
		['WB', wb],
		['WF', wf],
	]) {
		const errors = await game.page.evaluate('window.__AR_ERRORS__');
		verdict(`page ${name}: no page error`, errors.length === 0, errors);
	}
	await wb.page.close();
	await wf.page.close();

	// S0: page S's salmon plays the stub clips the snapshot registers (`characterClips`), and page
	// T's bear, which has none, keeps its placeholder. S is the room's only salmon, so golden: no
	// `salmon_golden_*` clip, so the pink one drawn gold.
	const CLIPS_GAME = 'salmons-clips';
	const sPage = await ready(
		await boot(
			's',
			{
				rooms_name: 'Sal',
				rooms_character: 'salmon',
				rooms_game: CLIPS_GAME,
				editorDocBase: snapClipsAuthored.origin,
			},
			goldenJoin(CLIPS_GAME),
		),
	);
	const tPage = await ready(
		await boot('t', {
			rooms_name: 'Ted',
			rooms_character: 'bear',
			rooms_game: CLIPS_GAME,
			editorDocBase: snapClips.origin,
		}),
	);
	await settle(sPage, 600);
	await settle(tPage, 400);
	const { me: meS } = await drawnOf(sPage);
	const { me: meT } = await drawnOf(tPage);
	const clipOfS = async () => (await drawnOf(sPage)).clips?.[meS];
	// Down the river and back up to the sandbank, the swim back long enough to turn on the way, but
	// never into the whirlpool below the sandbank (POOL): one held there circles, and its facing
	// says nothing of the keys (the "swim_ne mirrored" flake, 2026-11-19).
	const yOfS = async () => (await drawnOf(sPage)).drawn?.find((d) => d.id === meS)?.y ?? Number.NaN;
	const turnAt = POOL ? POOL.y - POOL.r - 40 : SAND.y + SAND.h + 320;
	await sPage.key('ArrowDown', 'down');
	let down;
	for (let i = 0; i < 40; i++) {
		await settle(sPage, 60);
		const now = await clipOfS();
		if (now?.clipId === 'salmon_pink_swim_se' && !now.flipX) down = now;
		if (down && (await yOfS()) >= turnAt) break;
	}
	await sPage.key('ArrowDown', 'up');
	verdict(
		'page S: swimming downstream (screen south-east: the mirrored screen) plays swim_se as drawn',
		down?.clipId === 'salmon_pink_swim_se' && down.flipX === false,
		down,
	);
	await sPage.key('ArrowUp', 'down');
	let up;
	let groundedS;
	const seenUp = [];
	for (let i = 0; i < 75 && !groundedS; i++) {
		await settle(sPage, 60);
		const now = await clipOfS();
		const atS = (await drawnOf(sPage)).drawn?.find((d) => d.id === meS);
		seenUp.push(
			`${now ? `${now.clipId}${now.flipX ? '~' : ''}` : '-'}@${Math.round(atS?.x)},${Math.round(atS?.y)}`,
		);
		// The facing the upstream swim turns to and holds (the first of it): near the sandbank the
		// bank's push may swing it across the river (north-east) for a frame, which says nothing of
		// the turn. Sampling the last swim_ne was the colyseus flake.
		if (now?.clipId === 'salmon_pink_swim_ne' && now.flipX) up ??= now;
		groundedS = (await eventsOf(sPage)).find((ev) => ev.type === 'grounded' && ev.id === meS);
	}
	verdict(
		'…swimming upstream (world −y, screen north-west) plays swim_ne mirrored',
		up?.clipId === 'salmon_pink_swim_ne' && up.flipX === true,
		{
			up,
			seenUp,
			log: ((await drawnOf(sPage)).clipLog ?? []).filter((e) => e.startsWith(`${meS}:`)),
		},
	);
	await settle(sPage, 400);
	const clipShot = await shotOf(sPage, '15-salmon-clip.png');
	const arcadeS = (await sPage.state()).arcade;
	const atS = arcadeS?.online?.drawn.find((d) => d.id === meS);
	// The clip's box, 90 × 180 with its bottom centre at the feet: gold from the feet up to 180 px,
	// and not above it.
	const liftRgb = (lift) =>
		arcadeS?.camera && atS && rgbAt(clipShot, isoScreen(clipShot, arcadeS.camera, atS, lift));
	const column = Object.fromEntries([8, 120, 170, 200].map((lift) => [lift, liftRgb(lift)]));
	verdict(
		'…grounded, the clip stands on its feet, 180 px tall (its box at the body’s width), drawn gold',
		!!groundedS &&
			[8, 120, 170].every((lift) => column[lift] && isGold(column[lift])) &&
			!!column[200] &&
			!isGold(column[200]),
		{ groundedS, column, marked: arcadeS?.online?.marked },
	);
	await tap(sPage);
	for (let i = 0; i < 16; i++) await settle(sPage, 150);
	await sPage.key('ArrowUp', 'up');
	const logS = ((await drawnOf(sPage)).clipLog ?? []).filter((e) => e.startsWith(`${meS}:`));
	const hopAt = logS.lastIndexOf(`${meS}:salmon_pink_hop_se`);
	const jumpedS = (await eventsOf(sPage)).find((ev) => ev.type === 'jumped' && ev.id === meS);
	verdict(
		'…Space jumps it off the sandbank: hop (its vertical twin, hop_se) once, then swim_ne again',
		!!jumpedS && hopAt >= 0 && logS.slice(hopAt + 1).includes(`${meS}:salmon_pink_swim_ne`),
		{ jumpedS, logS },
	);
	// Page T was stepped only 400 ms after its start, so its canvas still holds a frame of the
	// loading screen fading out over the river (its frames run only when stepped). Its code look is
	// made once the art has loaded, in real time, and turns to its heading as it is made: step on
	// until it is there, then until it and the camera rest.
	const lookOfT = async () => (await tPage.state()).arcade?.online?.art?.looks?.[meT];
	for (let i = 0; i < 40 && !(await lookOfT()); i++) await settle(tPage, 250);
	await settle(tPage, 1000);
	const bearShot = await shotOf(tPage, '16-bear-code-look.png');
	const arcadeT = (await tPage.state()).arcade;
	const atT = arcadeT?.online?.drawn.find((d) => d.id === meT);
	const lookT = arcadeT?.online?.art?.looks?.[meT];
	const bearRgb =
		arcadeT?.camera &&
		atT &&
		rgbAt(bearShot, isoScreen(bearShot, arcadeT.camera, atT, lookT?.middle ?? 46));
	// The bear sprite's fur: brown, red over green over blue.
	verdict(
		'page T: the bear, with no clips, plays none and keeps its code look (the bear sprite)',
		!(meT in ((await drawnOf(tPage)).clips ?? {})) &&
			lookT?.region === 'bear' &&
			!!bearRgb &&
			bearRgb[0] > bearRgb[1] &&
			bearRgb[1] > bearRgb[2] &&
			bearRgb[0] - bearRgb[2] > 30,
		{ bearRgb, lookT, clips: (await drawnOf(tPage)).clips },
	);

	// A layout with no `river` node: the join refuses it before the game mounts, and leaves.
	const NO_RIVER = 'salmons-noriver';
	const roomsBefore = (await fetch(`http://127.0.0.1:${roomsPort}/healthz`).then((r) => r.json()))
		.rooms;
	// What this machine's address holds on the server (open pages and seats held for closed ones):
	// at the server's cap a page's socket is refused, and the page says only that it was not let in.
	const heldBefore = heldBy('127.0.0.1');
	const d = await boot('d', {
		rooms_name: 'Di',
		rooms_character: 'salmon',
		rooms_game: NO_RIVER,
		editorDocBase: snapNoRiver.origin,
	});
	let stopped = null;
	for (let i = 0; i < 100 && !stopped; i++) {
		await wait(100);
		stopped = await d.evaluate('window.__IE_RUNTIME_STALE__?.reason ?? null').catch(() => null);
	}
	await wait(1500);
	const roomsAfter = (await fetch(`http://127.0.0.1:${roomsPort}/healthz`).then((r) => r.json()))
		.rooms;
	const mounted = await d.evaluate("!!document.querySelector('canvas')").catch(() => true);
	verdict(
		'page D, whose layout lost its river node, stops before the game with what to do, and leaves the room',
		!!stopped &&
			stopped.includes('keep a node with id "river"') &&
			stopped.includes('arcade.online.generator') &&
			!mounted &&
			roomsAfter === roomsBefore,
		{ stopped, mounted, roomsBefore, roomsAfter, heldBefore },
	);
	await d.close();

	// Eight facings (game-families §9 #28), and what the game draws for a catcher a clip draws. Page
	// X's fisherman has stub clips of his walk facing east and south-east, and a component whose
	// clips block names no facings (a project never re-uploaded): he takes the game's eight. Page Y
	// is the salmon he lands, on the sandbank across the water.
	const CATCHER_GAME = 'salmons-catcher';
	const x = await ready(
		await boot('x', {
			rooms_name: 'Xan',
			rooms_character: 'fisherman',
			rooms_game: CATCHER_GAME,
			editorDocBase: snapCatcher.origin,
		}),
	);
	const y = await ready(
		await boot('y', {
			rooms_name: 'Yan',
			rooms_character: 'salmon',
			rooms_game: CATCHER_GAME,
			editorDocBase: snapCatcher.origin,
		}),
	);
	await settle(y, 600);
	await settle(x, 600);
	const { me: meX } = await drawnOf(x);
	const { me: meY } = await drawnOf(y);
	const clipOfX = async () => (await drawnOf(x)).clips?.[meX];
	/** X's fisherman as page Y draws him: from the room's states, as every other player. */
	const xSeenByY = async () => (await drawnOf(y)).clips?.[meX];
	// Until each page draws him by a clip and X's art is loaded (which would draw his code look).
	let standing;
	let artX;
	for (let i = 0; i < 60 && !(standing && artX && (await xSeenByY())); i++) {
		await settle(x, 150);
		await settle(y, 150);
		standing = await clipOfX();
		artX = (await drawnOf(x)).art;
	}
	// Which of the two depends on the facing he came in with (a netcode may ease him to his place).
	verdict(
		'page X: standing, one of his walk clips draws the fisherman (no idle clip), not his code look',
		/^fisherman_walk_(e|se)$/.test(standing?.clipId ?? '') && !!artX && !(meX in artX.looks),
		{ standing, looks: artX && Object.keys(artX.looks), log: (await drawnOf(x)).clipLog },
	);
	// Straight along the screen's x axis is a world diagonal, so the way from the water is walked
	// first, then part of the way back: he never reaches the bank, which would turn him along it.
	// Left on the mirrored screen is world +x. His facing is read on page Y, and how far he went
	// off the room's own place for him: page X predicts him on a river of the room's seed, not on
	// the authored one the room plays, so what it draws of its own player says nothing of the keys.
	const awayKey = FISHER_AT.x > LINE_AT.x ? 'ArrowLeft' : 'ArrowRight';
	const backKey = awayKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
	const roomXOfX = async () => (await players(x)).find((p) => p.id === meX)?.x ?? Number.NaN;
	/** Hold `key` until page Y draws him by the east clip, mirrored for the west (it sees the turn
	 *  about half a second after the key), and he is `farther` px across from where he stood. */
	const walkX = async (key, farther) => {
		const from = await roomXOfX();
		const seen = [];
		let straight;
		await x.key(key, 'down');
		for (let i = 0; i < 40; i++) {
			await settle(x, 60);
			await settle(y, 60);
			const now = await xSeenByY();
			seen.push(now ? `${now.clipId}${now.flipX ? '~' : ''}` : '-');
			if (now?.clipId === 'fisherman_walk_e' && now.flipX === (key === 'ArrowLeft')) straight = now;
			const gone = Math.abs((await roomXOfX()) - from);
			if (gone >= (straight ? farther : farther + 100)) break;
		}
		await x.key(key, 'up');
		return { straight, seen };
	};
	const walked = { [awayKey]: await walkX(awayKey, 120), [backKey]: await walkX(backKey, 20) };
	verdict(
		'…walking straight right on the screen, page Y draws him by his east clip as made, not the south-east one: his component’s block names no facings, so he takes the game’s eight',
		!!walked.ArrowRight.straight,
		walked.ArrowRight,
	);
	verdict(
		'…walking straight left, by the east clip mirrored (no west clip is drawn)',
		!!walked.ArrowLeft.straight,
		walked.ArrowLeft,
	);
	// A click on the salmon casts there. X and Y are stepped in turn (the reel lands it within a
	// second), X's state and screen taken in the frame its line first shows.
	const atY = (await drawnOf(x)).drawn.find((d) => d.id === meY);
	if (atY) await clickAt(x, await stageOf(x, { ...atY, lift: 20 }));
	let arcadeX;
	let shotX;
	for (let i = 0; i < 60 && !arcadeX; i++) {
		await x.play([{ op: 'step', frames: 2 }]);
		const seen = (await x.state()).arcade;
		if (seen?.online?.lines?.some((l) => l.by === meX && l.target === meY)) {
			arcadeX = seen;
			shotX = await shotOf(x, '17-line-from-a-clip.png');
		}
		await y.play([{ op: 'step', frames: 2 }]);
		await wait(30);
	}
	shotX ??= await shotOf(x, '17-line-from-a-clip.png');
	const handX = arcadeX?.online?.art?.hands?.[meX];
	const clipX = arcadeX?.online?.clips?.[meX];
	const lineX = lineAt(shotX, arcadeX, meX, meY);
	verdict(
		'page X’s click on the salmon hooks it: the line starts at the hand on his clip’s box, mirrored with the clip',
		!!clipX &&
			!!handX &&
			!(meX in (arcadeX.online.art.looks ?? {})) &&
			Math.abs(handX.dx - (clipX.flipX ? -STUB_HAND.dx : STUB_HAND.dx)) < 1e-6 &&
			Math.abs(handX.lift - STUB_HAND.lift) < 1e-6,
		{ handX, clipX, expected: STUB_HAND },
	);
	verdict(
		'…drawn as the old client’s line (0xddddaa) from that hand to the salmon',
		lineX.ok && (arcadeX?.online?.art?.lines ?? []).every((c) => c === 0xddddaa),
		{ lineX, colours: arcadeX?.online?.art?.lines },
	);
	let landedX;
	let floatsX = [];
	for (let i = 0; i < 40 && !(landedX && floatsX.length); i++) {
		await settle(x, 100);
		landedX ??= (await eventsOf(x)).find((ev) => ev.type === 'caught' && ev.target === meY);
		floatsX = (await drawnOf(x)).art?.floats?.[meX] ?? [];
	}
	await shotOf(x, '18-catch-text-over-a-clip.png');
	verdict(
		'…landed: "you catch Yan!" rises over the fisherman his clip draws',
		landedX?.by === meX &&
			floatsX.includes('you catch Yan!') &&
			meX in ((await drawnOf(x)).clips ?? {}),
		{ landedX, floatsX },
	);
	// Page V's bear has a component that names no clips at all: the game names them itself. Of
	// them only `bear_idle_se` is registered, and no sheet packs its frames: its first frame never
	// loads.
	const v = await ready(
		await boot('v', {
			rooms_name: 'Val',
			rooms_character: 'bear',
			rooms_game: CATCHER_GAME,
			editorDocBase: snapCatcher.origin,
		}),
	);
	await settle(v, 600);
	const { me: meV } = await drawnOf(v);
	let onlineV;
	for (let i = 0; i < 60 && !onlineV?.art?.looks?.[meV]; i++) {
		await settle(v, 150);
		onlineV = await drawnOf(v);
	}
	await shotOf(v, '19-bear-clip-not-loaded.png');
	verdict(
		'page V: its bear’s component names no clips, so the game’s own names do (`bear_idle_se`); that clip’s frames never load, so the bear keeps its code look (the sprite), not the placeholder',
		(onlineV?.clipLog ?? []).includes(`${meV}:bear_idle_se`) &&
			!(meV in (onlineV.clips ?? {})) &&
			onlineV.art?.looks?.[meV]?.region === 'bear',
		{ log: onlineV?.clipLog, clips: onlineV?.clips, look: onlineV?.art?.looks?.[meV] },
	);

	for (const [name, game] of [
		['A', a],
		['B', b],
		['C', c],
		['E', e],
		['F', f],
		['G2', g2],
		['S', sPage],
		['T', tPage],
		['X', x],
		['Y', y],
		['V', v],
	]) {
		const wire = await game.page.evaluate('window.__AR_WIRE__');
		const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
		verdict(`page ${name} sends the RGS nothing`, rgs.length === 0, rgs);
		const errors = await game.page.evaluate('window.__AR_ERRORS__');
		verdict(`page ${name}: no page error`, errors.length === 0, errors);
	}
	// The room goes (the server shuts down): page A's river art is torn down, every piece of it.
	const artBefore = (await a.state()).arcade?.fieldArt;
	await rooms.close();
	roomsClosed = true;
	let artAfter;
	for (let i = 0; i < 30; i++) {
		await wait(100);
		artAfter = await a.state().catch(() => undefined);
		artAfter = artAfter?.arcade?.fieldArt;
		if (artAfter?.live === 0) break;
	}
	verdict(
		'art: when the room goes, page A’s river is destroyed (none drawn, every piece it made destroyed)',
		artBefore?.live === 1 && artAfter?.live === 0 && artAfter.destroyed === true,
		{ artBefore, artAfter },
	);
	await a.page.close();
	await b.page.close();
	await c.page.close();
	await e.page.close();
	await f.page.close();
	await g2.page.close();
	await sPage.page.close();
	await tPage.page.close();
	await x.page.close();
	await y.page.close();
	await v.page.close();
} finally {
	server.stop();
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	if (!roomsClosed) await rooms.close();
	await snap.close();
	await snapNoRiver.close();
	await snapWade.close();
	await snapRigWade.close();
	await snapClips.close();
	await snapClipsAuthored.close();
	await snapCatcher.close();
	await snapSheet.close();
	await snapTrees.close();
	await snapTurn.close();
	await snapTurnRig.close();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\nsalmons play: ${failed} FAILED` : `\nsalmons play: OK → ${out}`);
process.exit(failed ? 1 : 0);
