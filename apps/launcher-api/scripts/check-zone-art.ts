/**
 * ZONE ART (`docs/design/zone-art.md`, Game Config `arcade.zoneArt`): what an arcade game's zone
 * families are drawn with, from `/config` to the room. This holds:
 *
 *  1. the schema: a sheet's frame, a Flipbook clip and a rig (its animation, played once or looped)
 *     are kept as authored; a rig that names no rig or no animation, a `fill` or `edge` placement,
 *     a frame that names no sheet, a blank clip are dropped, as are a scale of 1, an fps out of
 *     range and variants past the limit. It is CARRIED: the normalizer every runtime carries drops
 *     it (so no other runtime's bytes move), the launcher's save and Raw JSON's Apply put it back
 *     normalized, and the runtime reads the stored map;
 *  2. the family is the Zones chips' group (`zoneFamilyOf` is what `/config` groups by), and the
 *     picture a zone draws is chosen by the seed and the zone alone, the same on every device; so
 *     is where a zone's rig starts, and neighbouring zones' rigs start apart;
 *  3. the stamps: one per zone of a family with an entry, its box the zone's grown about its centre
 *     by the scale, a rig's with its start; none for an empty or absent map;
 *  4. the validator: a family no stored zone has is warned of; a generated game is not judged; a
 *     rig picture that names no rig or no animation is warned of;
 *  5. COSMETIC: a Salmons room made by the game server's own read of a config with zone art plays
 *     the same level, levels and fingerprint as without, and a device with zone art adopts nothing
 *     and is never refused; the game a room plays is the same game;
 *  6. a PLAIN arcade game (no generator): its stamps are layout nodes in one container under its
 *     play field's spawn layer, with the layer's transform; a sprite keeps its frame's ratio and a
 *     clip with a Bounds box its own; a rig is a container bound to the one component the runtime
 *     registers for it, handed its picture, its start and its box; no zone art, or no such layer,
 *     leaves the doc as it was;
 *  7. the Zone art card's rows and edits (`zoneArtDoc.ts`): a Salmons level's rule-only families
 *     are hidden unless asked; a pick writes a stamp; a variant, a scale, a cleared picture and
 *     the bin all store what the normalizer keeps, and the last one leaves no field behind; a rig
 *     picked keeps its animation on another rig that has it and asks for one otherwise, its loop
 *     is stored only when off, the rigs it names are the ones whose animations are read, and a
 *     family drawn as a rig on more than 100 zones is warned of;
 *  8. rule 8: the REAL `exportEditorArt` and `collectPlayedClipIds` over an in-memory R2 ship the
 *     sheet of a frame, the clip (and its sheet) and the rig (its skeleton, atlas and page) named
 *     ONLY by zone art, for a plain game and for Salmons, and name the frame and the rig in the
 *     index's `characterArt` (what the boot keeps loaded by); a sheet, a clip and a rig nothing
 *     names do not; without zone art none of them does, and an empty map exports exactly what a
 *     config without the field exports. Salmons' trees' art (`@trees`) ships the same way, with no
 *     code of its own;
 *  9. the card's Default line: Salmons' built-in pictures from the project's sheets, its trees too;
 * 10. SCENERY (`ZONE_ART_SCENERY`, `@trees`): a reserved key in the same map, kept by the
 *     normalizer, the save and Raw JSON as a family's entry is; no zone's family (`@` is in no
 *     generator's zone id, `/config` refuses one, and a zone so named is never stamped); not warned
 *     of in a Salmons config, and in a game with no generator warned of as scenery, never as a
 *     family no zone has; each tree's picture is picked by the seed and its cell alone; the card
 *     lists a Trees row for a Salmons generator only (and a stale one where an entry is left), not
 *     as a zone family, and its edits store what the normalizer keeps;
 * 11. SCENERY IS NEVER A RIG (`zoneArtTakesRig`): Salmons' ~430 trees as as many rigs are too
 *     heavy for a phone (`docs/design/zone-art.md` §3). A rig picture of `@trees` is dropped by the
 *     normalizer, warned of, refused by the card, never stamped and never shipped; a zone family
 *     takes one;
 * 12. THE RIG DRAWING (`engine-layout/zone-art-rig`), over a real rig: a picture is one `RigView`
 *     in a container whose origin is the middle of the rig's Bounds box and which measures as that
 *     box; it starts at its phase of its animation when looped (from its start when played once),
 *     moves on by the time it is given (no more than a tenth of a second at once), and draws
 *     nothing for an animation the rig lacks; a plain game's mount fits it inside the stamp's box
 *     (its ratio kept), moves it on with the app's ticker and lets it all go; a rig not loaded
 *     mounts nothing.
 *
 * Run: pnpm --filter launcher-api check:zone-art
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import type { LayoutDoc } from 'engine-layout';
import type { GameConfigDoc } from 'game-config';

interface Stored {
	text: string;
	modified: number;
}
const bucket = new Map<string, Stored>();
const under = (prefix: string) =>
	[...bucket.entries()]
		.filter(([key]) => key.startsWith(prefix))
		.map(([key, o]) => ({ key, size: o.text.length, lastModified: o.modified }));
const etagOf = (o: Stored) => `"${createHash('md5').update(o.text).digest('hex')}"`;
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
const realR2 = await import(r2Url);
mock.module(r2Url, {
	namedExports: {
		...realR2,
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		getObjectTextWithEtag: async (key: string) => {
			const o = bucket.get(key);
			return o ? { text: o.text, etag: etagOf(o) } : null;
		},
		getObjectBytes: async (key: string) => {
			const o = bucket.get(key);
			return o
				? { body: new TextEncoder().encode(o.text), contentType: 'application/json', etag: null }
				: null;
		},
		putObjectText: async (key: string, text: string) => {
			const stored = { text, modified: Date.now() };
			bucket.set(key, stored);
			return etagOf(stored);
		},
		copyObject: async (from: string, to: string) => {
			const o = bucket.get(from);
			if (o) bucket.set(to, { ...o });
			return !!o;
		},
		deleteObjects: async (keys: string[]) => {
			for (const key of keys) bucket.delete(key);
		},
		listAllKeys: async (prefix: string) => under(prefix).map((o) => o.key),
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: etagOf(o), size: o.text.length, lastModified: o.modified } : null;
		},
		objectExists: async (key: string) => bucket.has(key),
		listAllObjects: async (prefix: string) => under(prefix),
		listObjects: async (prefix: string) => ({
			keys: under(prefix).map((o) => o.key),
			prefixes: [],
		}),
		listFolder: async (prefix: string) => {
			const direct = (key: string) => !key.slice(prefix.length).includes('/');
			return {
				files: under(prefix)
					.filter((o) => direct(o.key))
					.map((o) => ({ ...o, lastModified: new Date(o.lastModified).toISOString() })),
				folders: [
					...new Set(
						under(prefix)
							.filter((o) => !direct(o.key))
							.map((o) => `${prefix}${o.key.slice(prefix.length).split('/')[0]}/`),
					),
				],
			};
		},
	},
});

const gc = await import('game-config');
const {
	ZONE_ART_SCENERY,
	isZoneArtScenery,
	normalizeGameConfigDoc,
	normalizeZoneArt,
	onlineGameOf,
	sceneryArtSourceFor,
	shapedOnlineGame,
	withOnlineSlide,
	zoneArtArtNames,
	zoneArtClipRoots,
	zoneArtOf,
	zoneArtPhaseFor,
	zoneArtRigRoots,
	zoneArtSourceFor,
	zoneArtTakesRig,
	zoneArtStamps,
	zoneArtStillRoots,
	zoneFamilyOf,
} = gc;
const { roomLevelGame, roomLevelState, levelHash } =
	await import('../../../packages/engine-mechanics/src/onlineGenerators.js');
const { SALMONS_LEVELS, salmonsConfig } =
	await import('../../../packages/engine-mechanics/src/salmons.js');
const { SALMONS_MAP_SEED, salmonsMapRiver } =
	await import('../../../packages/engine-mechanics/src/salmonsMap.js');
const { createConfigSource } = await import('../../../services/game-server/src/configSource.ts');
const { createRoomSim } = await import('../../../services/game-server/src/roomSim.ts');
const { ZONE_ART_NODE, ZONE_ART_RIG, withZoneArtNodes } =
	await import('../../../packages/engine-layout/src/lib/zoneArtNodes.ts');
const { zoneGroups, generatedZones } = await import('../src/routes/(app)/config/zones.ts');
const cardEdits = await import('../src/routes/(app)/config/zoneArtDoc.ts');
const { setZoneField } = await import('../src/routes/(app)/config/familyDoc.ts');
const { exportEditorArt } = await import('../src/lib/server/editorArtExport.ts');
const { prepareGameConfigDoc } = await import('../src/lib/server/gameConfigStorage.ts');
const { applyPasted } = await import('../src/routes/(app)/config/pageDoc.ts');
const { collectPlayedClipIds } = await import('../src/lib/server/clipReachability.ts');
const { clipDocKey, editorDocKey, gameConfigDocKey, SUB } =
	await import('../src/lib/server/projectPaths.ts');

let passed = 0;
let failed = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	if (isDeepStrictEqual(actual, expected)) {
		passed += 1;
		return;
	}
	failed += 1;
	console.error(
		`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`,
	);
}
const ok = (name: string, cond: boolean, detail = '') => {
	if (cond) passed += 1;
	else {
		failed += 1;
		console.error(`✗ ${name}${detail ? `\n    ${detail}` : ''}`);
	}
};

const SHEET = 'invisible_wall/plain/manifests/atlas_manifest_S_Rocks.json';
const ROCK = `${SHEET}::boulder`;

// 1. The schema.
eq(
	'1. a frame, a clip with its fps, variants and a scale are kept as authored',
	normalizeZoneArt({
		'rock#': {
			source: { kind: 'sprite', region: ROCK },
			variants: [
				{ kind: 'sprite', region: `${SHEET}::pebble` },
				{ kind: 'flipbook', clip: 'rock_spin', fps: 12 },
			],
			placement: 'stamp',
			scale: 1.5,
		},
		'whirlpool#': { source: { kind: 'flipbook', clip: 'swirl' }, placement: 'stamp' },
	}),
	{
		'rock#': {
			source: { kind: 'sprite', region: ROCK },
			variants: [
				{ kind: 'sprite', region: `${SHEET}::pebble` },
				{ kind: 'flipbook', clip: 'rock_spin', fps: 12 },
			],
			placement: 'stamp',
			scale: 1.5,
		},
		'whirlpool#': { source: { kind: 'flipbook', clip: 'swirl' }, placement: 'stamp' },
	},
);
eq(
	'1. a rig, played once or looped, is kept as authored, as a source and as a variant',
	normalizeZoneArt({
		'rock#': {
			source: { kind: 'rig', rig: ' R_Rock ', animation: 'idle', loop: false },
			variants: [
				{ kind: 'rig', rig: 'R_Rock', animation: 'sway', loop: true },
				{ kind: 'sprite', region: ROCK },
			],
			placement: 'stamp',
		},
	}),
	{
		'rock#': {
			source: { kind: 'rig', rig: 'R_Rock', animation: 'idle', loop: false },
			variants: [
				{ kind: 'rig', rig: 'R_Rock', animation: 'sway' },
				{ kind: 'sprite', region: ROCK },
			],
			placement: 'stamp',
		},
	},
);
eq(
	'1. a rig with no animation or no rig, a fill or edge placement, an unscoped frame and a blank clip are dropped',
	normalizeZoneArt({
		a: { source: { kind: 'rig', rig: 'R_Rock', animation: ' ' }, placement: 'stamp' },
		g: { source: { kind: 'rig', animation: 'idle' }, placement: 'stamp' },
		b: { source: { kind: 'sprite', region: ROCK }, placement: 'fill' },
		c: { source: { kind: 'sprite', region: ROCK }, placement: 'edge' },
		d: { source: { kind: 'sprite', region: 'boulder' }, placement: 'stamp' },
		e: { source: { kind: 'flipbook', clip: '  ' }, placement: 'stamp' },
		f: { source: { kind: 'sprite', region: ROCK } },
	}),
	undefined,
);
eq(
	'1. a scale of 1, an fps out of range and variants past eight are dropped',
	normalizeZoneArt({
		'rock#': {
			source: { kind: 'flipbook', clip: 'x', fps: 500 },
			variants: Array.from({ length: 12 }, (_, i) => ({ kind: 'flipbook', clip: `v${i}` })),
			placement: 'stamp',
			scale: 1,
		},
	})?.['rock#'],
	{
		source: { kind: 'flipbook', clip: 'x' },
		variants: Array.from({ length: 8 }, (_, i) => ({ kind: 'flipbook', clip: `v${i}` })),
		placement: 'stamp',
	},
);
const PLAIN: GameConfigDoc = {
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Plain',
	arcade: {
		field: { w: 1000, h: 800 },
		zones: [
			{ id: 'rock1', x: 100, y: 100, w: 80, h: 40 },
			{ id: 'rock2', x: 400, y: 300, w: 60, h: 60 },
			{ id: 'pond', x: 600, y: 500, w: 200, h: 100 },
		],
	},
} as unknown as GameConfigDoc;
const RIG_SOURCE = { kind: 'rig', rig: 'R_Rock', animation: 'idle' } as const;
const PLAIN_ART = {
	'rock#': { source: { kind: 'sprite', region: ROCK }, placement: 'stamp', scale: 2 },
	pond: { source: { kind: 'flipbook', clip: 'pond_ripple' }, placement: 'stamp' },
};
const withArt = (doc: GameConfigDoc, zoneArt: unknown): GameConfigDoc =>
	({ ...doc, arcade: { ...doc.arcade, zoneArt } }) as unknown as GameConfigDoc;
ok(
	'1. the normalizer every runtime carries drops it: a config normalizes as without it',
	isDeepStrictEqual(
		normalizeGameConfigDoc(withArt(PLAIN, PLAIN_ART)),
		normalizeGameConfigDoc(PLAIN),
	),
);
const saved = prepareGameConfigDoc(withArt(PLAIN, PLAIN_ART));
ok(
	'1. the launcher’s save carries it, normalized, and warns of nothing in it',
	isDeepStrictEqual(saved.doc.arcade?.zoneArt, normalizeZoneArt(PLAIN_ART)) &&
		!saved.warnings.some((i) => i.path.startsWith('arcade.zoneArt')),
	JSON.stringify(saved.doc.arcade?.zoneArt),
);
ok(
	'1. the save of a config without it stores no field, and Raw JSON’s Apply keeps a pasted one',
	!('zoneArt' in (prepareGameConfigDoc(PLAIN).doc.arcade ?? {})) &&
		isDeepStrictEqual(
			applyPasted(withArt(PLAIN, PLAIN_ART))?.arcade?.zoneArt,
			normalizeZoneArt(PLAIN_ART),
		),
);
ok(
	'1. what the runtime reads is the save’s: zoneArtOf the stored doc',
	isDeepStrictEqual(zoneArtOf(saved.doc), normalizeZoneArt(PLAIN_ART)) &&
		zoneArtOf(PLAIN) === undefined,
);

// 2. The family, and the picture a zone draws.
const ids = ['rock0', 'rock12', 'band3Water', 'band40Water', 'waterfall2Bear', 'source', 'sea'];
eq(
	'2. a family is the Zones chips’ group',
	[...new Set(ids.map(zoneFamilyOf))].sort(),
	zoneGroups(ids.map((id) => ({ id })))
		.map((g) => g.label)
		.sort(),
);
eq('2. the families of Salmons’ ids', ids.map(zoneFamilyOf), [
	'rock#',
	'rock#',
	'band#Water',
	'band#Water',
	'waterfall#Bear',
	'source',
	'sea',
]);
const VARIED = normalizeZoneArt({
	'rock#': {
		source: { kind: 'sprite', region: `${SHEET}::a` },
		variants: [
			{ kind: 'sprite', region: `${SHEET}::b` },
			{ kind: 'sprite', region: `${SHEET}::c` },
		],
		placement: 'stamp',
	},
})!['rock#'];
const picks = (seed: number) =>
	Array.from({ length: 60 }, (_, i) => zoneArtSourceFor(VARIED, `rock${i}`, seed));
ok('2. a seed and a zone pick the same picture every time', isDeepStrictEqual(picks(7), picks(7)));
ok(
	'2. every picture is drawn somewhere, and another seed picks otherwise',
	new Set(picks(7).map((s) => (s.kind === 'sprite' ? s.region : ''))).size === 3 &&
		!isDeepStrictEqual(picks(7), picks(8)),
);

{
	const rocks = Array.from({ length: 24 }, (_, i) => `rock${i}`);
	const phases = (seed: number) => rocks.map((id) => zoneArtPhaseFor(id, seed));
	ok(
		'2. where a zone’s rig starts is the seed’s and the zone’s alone, 0 to 1, the same every time',
		isDeepStrictEqual(phases(7), phases(7)) &&
			phases(7).every((p) => p >= 0 && p < 1) &&
			!isDeepStrictEqual(phases(7), phases(8)),
	);
	const steps = phases(7)
		.slice(1)
		.map((p, i) => Math.abs(p - phases(7)[i]));
	// An unmixed FNV-1a moves rock0 … rock23 by about 0.004 a step: lockstep. Uniform starts are a
	// third of a cycle apart on average.
	ok(
		'2. … and neighbouring zones’ rigs start apart: rock0 … rock23 spread over the cycle',
		Math.max(...phases(7)) - Math.min(...phases(7)) > 0.8 &&
			steps.reduce((sum, d) => sum + d, 0) / steps.length > 0.2,
		JSON.stringify(phases(7).map((p) => p.toFixed(3))),
	);
}

// 3. The stamps.
const plainArt = normalizeZoneArt(PLAIN_ART);
eq(
	'3. a zone of a family with an entry is stamped, grown about its centre',
	zoneArtStamps(PLAIN.arcade!.zones!, plainArt, 0),
	[
		{
			zone: 'rock1',
			family: 'rock#',
			source: { kind: 'sprite', region: ROCK },
			scale: 2,
			x: 60,
			y: 80,
			w: 160,
			h: 80,
		},
		{
			zone: 'rock2',
			family: 'rock#',
			source: { kind: 'sprite', region: ROCK },
			scale: 2,
			x: 370,
			y: 270,
			w: 120,
			h: 120,
		},
		{
			zone: 'pond',
			family: 'pond',
			source: { kind: 'flipbook', clip: 'pond_ripple' },
			scale: 1,
			x: 600,
			y: 500,
			w: 200,
			h: 100,
		},
	],
);
eq('3. no map, no stamp', zoneArtStamps(PLAIN.arcade!.zones!, undefined, 0), []);
eq(
	'3. a rig’s stamp carries where it starts, by the seed and its zone',
	zoneArtStamps(
		PLAIN.arcade!.zones!,
		normalizeZoneArt({ pond: { source: RIG_SOURCE, placement: 'stamp' } }),
		7,
	),
	[
		{
			zone: 'pond',
			family: 'pond',
			source: RIG_SOURCE,
			scale: 1,
			x: 600,
			y: 500,
			w: 200,
			h: 100,
			phase: zoneArtPhaseFor('pond', 7),
		},
	],
);

// 4. The validator.
const issuesOf = (doc: GameConfigDoc) =>
	prepareGameConfigDoc(doc).warnings.filter((i) => i.path.startsWith('arcade.zoneArt'));
eq('4. every family named is one of the zones’', issuesOf(withArt(PLAIN, PLAIN_ART)), []);
eq(
	'4. a family no zone has is warned of',
	issuesOf(
		withArt(PLAIN, {
			...PLAIN_ART,
			'tree#': { source: { kind: 'sprite', region: ROCK }, placement: 'stamp' },
		}),
	).map((i) => [i.severity, i.path]),
	[['warning', 'arcade.zoneArt.tree#']],
);
eq(
	'4. a rig picture that names no animation, or no rig, is warned of: it is not drawn',
	issuesOf(
		withArt(PLAIN, {
			'rock#': {
				source: RIG_SOURCE,
				variants: [
					{ kind: 'rig', rig: 'R_Rock' },
					{ kind: 'rig', animation: 'idle' },
				],
				placement: 'stamp',
			},
		}),
	).map((i) => [i.severity, i.path, i.message.includes('not drawn')]),
	[
		['warning', 'arcade.zoneArt.rock#.variants.0', true],
		['warning', 'arcade.zoneArt.rock#.variants.1', true],
	],
);
eq(
	'4. … also where it was the entry’s only picture, so the entry is gone',
	issuesOf(
		withArt(PLAIN, { pond: { source: { kind: 'rig', rig: 'R_Pond' }, placement: 'stamp' } }),
	).map((i) => i.path),
	['arcade.zoneArt.pond.source'],
);

// 5. Cosmetic: the game server's own read, with and without zone art.
const salmonsRaw = (): GameConfigDoc =>
	salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED), {
		levels: SALMONS_LEVELS,
	}) as unknown as GameConfigDoc;
const SALMONS_ART = {
	'rock#': {
		source: { kind: 'sprite', region: ROCK },
		variants: [{ kind: 'flipbook', clip: 'rock_spin' }, RIG_SOURCE],
		placement: 'stamp',
	},
	'whirlpool#': {
		source: { kind: 'rig', rig: 'R_Pool', animation: 'spin', loop: false },
		placement: 'stamp',
	},
	'sandbank#': { source: { kind: 'sprite', region: `${SHEET}::sand` }, placement: 'stamp' },
	'@trees': {
		source: { kind: 'sprite', region: `${SHEET}::pine` },
		variants: [{ kind: 'flipbook', clip: 'tree_sway' }],
		placement: 'stamp',
		scale: 1.2,
	},
};
eq(
	'5. a Salmons config’s zone art, its trees’ too, is not warned of (its zones are its generator’s)',
	issuesOf(withArt(salmonsRaw(), SALMONS_ART)),
	[],
);
const dir = mkdtempSync(join(tmpdir(), 'zone-art-'));
try {
	writeFileSync(join(dir, 'bare.json'), JSON.stringify(salmonsRaw()));
	writeFileSync(join(dir, 'art.json'), JSON.stringify(withArt(salmonsRaw(), SALMONS_ART)));
	const loadGame = createConfigSource({ dir });
	const device = (baked: GameConfigDoc) =>
		shapedOnlineGame(
			withOnlineSlide(onlineGameOf(normalizeGameConfigDoc(baked) ?? null), baked),
			baked,
		);
	for (const seed of [0, 7, 31337, 123_456_789]) {
		const bare = createRoomSim(await loadGame('bare'), { seed });
		const art = createRoomSim(await loadGame('art'), { seed });
		const said = roomLevelState(bare.game, seed, bare.made);
		ok(
			`5. seed ${seed}: the room plays the same level, levels and fingerprint with zone art`,
			!!said &&
				isDeepStrictEqual(said, roomLevelState(art.game, seed, art.made)) &&
				levelHash(art.game, art.made) === said.levelHash &&
				isDeepStrictEqual(art.game.zones, bare.game.zones),
		);
		const played = roomLevelGame(device(withArt(salmonsRaw(), SALMONS_ART)), seed, said);
		ok(
			`5. seed ${seed}: a device with zone art in a room without it adopts nothing and is not refused`,
			!('refused' in played) && !played.adopted && played.differs.length === 0,
			JSON.stringify('refused' in played ? played : played.differs),
		);
		if ('refused' in played) continue;
		const stamps = zoneArtStamps(played.game.zones, normalizeZoneArt(SALMONS_ART), seed);
		ok(
			`5. seed ${seed}: its stamps are of its rocks, whirlpools and sandbanks only (the trees are no zone)`,
			stamps.length > 0 &&
				stamps.every((s) => ['rock#', 'whirlpool#', 'sandbank#'].includes(s.family)) &&
				stamps.filter((s) => s.family === 'rock#').length ===
					played.game.zones.filter((z) => /^rock\d+$/.test(z.id)).length,
		);
		eq(
			`5. seed ${seed}: an empty map stamps nothing: the river draws its built-in art alone`,
			zoneArtStamps(played.game.zones, normalizeZoneArt({}), seed),
			[],
		);
	}
	const bareGame = device(salmonsRaw());
	const artGame = device(withArt(salmonsRaw(), SALMONS_ART));
	ok(
		'5. the game a device plays is the same game with zone art',
		!!bareGame && isDeepStrictEqual(bareGame, artGame),
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

// 6. A plain arcade game's stamps as layout nodes.
const layer = {
	id: 'field',
	kind: 'spawnLayer',
	x: 40,
	y: 20,
	scale: { x: 0.5, y: 0.5 },
	zIndex: 3,
	spawnable: ['hero'],
	placement: 'free',
};
const LAYOUT = {
	scenes: [
		{ id: 'hud', name: 'HUD', nodes: [{ id: 'title', kind: 'text', x: 0, y: 0, text: 'Hi' }] },
		{
			id: 'play',
			name: 'Play',
			world: { w: 1000, h: 800 },
			nodes: [{ id: 'bg', kind: 'rect', x: 0, y: 0, width: 10, height: 10, color: 0 }, layer],
		},
	],
} as unknown as LayoutDoc;
const plainStamps = zoneArtStamps(PLAIN.arcade!.zones!, plainArt, 0);
const drawn = withZoneArtNodes(LAYOUT, plainStamps, {
	clipSize: (id: string) => (id === 'pond_ripple' ? { w: 100, h: 100 } : undefined),
});
const play = drawn.scenes[1].nodes;
eq(
	'6. the container stands just before the play field’s layer',
	play.map((n) => n.id),
	['bg', ZONE_ART_NODE, 'field'],
);
const container = play[1] as unknown as Record<string, unknown> & { children: unknown[] };
eq(
	'6. … with the layer’s place, scale and depth',
	[container.kind, container.x, container.y, container.scale, container.zIndex],
	['container', 40, 20, { x: 0.5, y: 0.5 }, 3],
);
eq('6. a sprite stamp keeps its frame’s ratio inside its zone, centred', container.children[0], {
	id: `${ZONE_ART_NODE}:rock1`,
	x: 140,
	y: 120,
	anchor: { x: 0.5, y: 0.5 },
	locked: true,
	kind: 'sprite',
	assetKey: SHEET,
	region: ROCK,
	width: 160,
	height: 80,
	keepAspect: true,
});
eq('6. a clip with a Bounds box keeps its own ratio', container.children[2], {
	id: `${ZONE_ART_NODE}:pond`,
	x: 700,
	y: 550,
	anchor: { x: 0.5, y: 0.5 },
	locked: true,
	kind: 'flipbook',
	clipId: 'pond_ripple',
	width: 100,
	height: 100,
	loop: true,
});
ok('6. the other screens are the same objects', drawn.scenes[0] === LAYOUT.scenes[0]);
ok('6. no stamp: the doc itself', withZoneArtNodes(LAYOUT, [], {}) === LAYOUT);
ok(
	'6. no such layer: the doc itself',
	withZoneArtNodes(LAYOUT, plainStamps, { layer: 'nowhere' }) === LAYOUT,
);
ok('6. drawn once: a second pass leaves it', withZoneArtNodes(drawn, plainStamps, {}) === drawn);
{
	const rigStamps = zoneArtStamps(
		PLAIN.arcade!.zones!,
		normalizeZoneArt({ 'rock#': { source: RIG_SOURCE, placement: 'stamp', scale: 2 } }),
		0,
	);
	const rigNodes = (
		withZoneArtNodes(LAYOUT, rigStamps, {}).scenes[1].nodes[1] as unknown as {
			children: unknown[];
		}
	).children;
	eq(
		'6. a rig stamp is a container bound to the runtime’s rig component: its picture, its start and its box',
		rigNodes[0],
		{
			id: `${ZONE_ART_NODE}:rock1`,
			x: 140,
			y: 120,
			anchor: { x: 0.5, y: 0.5 },
			locked: true,
			kind: 'container',
			children: [],
			bind: {
				component: ZONE_ART_RIG,
				props: { source: RIG_SOURCE, phase: zoneArtPhaseFor('rock1', 0), w: 160, h: 80 },
			},
		},
	);
	ok(
		'6. … each with its own start',
		rigNodes.length === 2 &&
			isDeepStrictEqual(
				rigNodes.map((n) => (n as { bind: { props: { phase: number } } }).bind.props.phase),
				['rock1', 'rock2'].map((id) => zoneArtPhaseFor(id, 0)),
			),
	);
}

// 7. The Zone art card.
const salmonsLevel = generatedZones(salmonsRaw(), 'salmonsMap', 7);
const rows = cardEdits.zoneArtRows(salmonsLevel.zones, salmonsRaw(), 'salmonsMap');
const listed = cardEdits.shownZoneArtRows(rows, false).map((r) => r.family);
eq(
	'7. a Salmons level lists the families its art draws, rule-only ones hidden',
	[...listed].sort(),
	['bridge#', 'rock#', 'sandbank#', 'sea', 'source', 'waterfall#', 'whirlpool#'].filter((f) =>
		rows.some((r) => r.family === f),
	),
);
ok(
	'7. … and every family when asked',
	cardEdits.shownZoneArtRows(rows, true).length === rows.length &&
		rows.some((r) => r.family === 'band#Water' && r.ruleOnly),
);
eq(
	'7. a plain game hides nothing',
	cardEdits.zoneArtRows(PLAIN.arcade!.zones!, PLAIN, undefined).map((r) => [r.family, r.ruleOnly]),
	[
		['rock#', false],
		['pond', false],
	],
);
const card = structuredClone(PLAIN);
cardEdits.setZoneArtSource(card, 'rock#', 0, { kind: 'sprite', region: ROCK });
eq('7. a pick writes a stamp', card.arcade?.zoneArt, {
	'rock#': { source: { kind: 'sprite', region: ROCK }, placement: 'stamp' },
});
ok('7. a variant is added as a copy', cardEdits.addZoneArtVariant(card, 'rock#'));
cardEdits.setZoneArtSource(card, 'rock#', 1, { kind: 'flipbook', clip: 'rock_spin' });
cardEdits.setZoneArtScale(card, 'rock#', '2.5');
eq('7. … changed, with a scale', card.arcade?.zoneArt?.['rock#'], {
	source: { kind: 'sprite', region: ROCK },
	variants: [{ kind: 'flipbook', clip: 'rock_spin' }],
	placement: 'stamp',
	scale: 2.5,
});
cardEdits.setZoneArtScale(card, 'rock#', 'big');
cardEdits.setZoneArtSource(card, 'rock#', 0, undefined);
eq(
	'7. a scale that is no number goes; a cleared source gives way to the first variant',
	card.arcade?.zoneArt?.['rock#'],
	{ source: { kind: 'flipbook', clip: 'rock_spin' }, placement: 'stamp' },
);
cardEdits.removeZoneArt(card, 'rock#');
ok(
	'7. the bin on the last entry leaves no field behind, and the zones as they were',
	!!card.arcade && !('zoneArt' in card.arcade) && isDeepStrictEqual(card, PLAIN),
);
eq(
	'7. a clip’s thumbnail is its first frame, scoped',
	[
		cardEdits.clipThumbRef({ assetKey: SHEET, firstFrame: 'f0' }),
		cardEdits.clipThumbRef({ assetKey: SHEET, firstFrame: `${SHEET}::f1` }),
		cardEdits.clipThumbRef(undefined),
	],
	[`${SHEET}::f0`, `${SHEET}::f1`, ''],
);
eq(
	'7. the roots of the ship chain',
	[zoneArtStillRoots(withArt(PLAIN, PLAIN_ART)), zoneArtClipRoots(withArt(PLAIN, PLAIN_ART))],
	[[{ assetKey: SHEET, region: 'boulder' }], ['pond_ripple']],
);
{
	const rigCard = structuredClone(PLAIN);
	cardEdits.setZoneArtSource(
		rigCard,
		'rock#',
		0,
		cardEdits.rigSourceOf(undefined, 'R_Rock', 'idle'),
	);
	cardEdits.addZoneArtVariant(rigCard, 'rock#');
	const looped = rigCard.arcade?.zoneArt?.['rock#'];
	cardEdits.setZoneArtSource(
		rigCard,
		'rock#',
		1,
		cardEdits.rigLooped({ kind: 'rig', rig: 'R_Moss', animation: 'grow' }, false),
	);
	eq(
		'7. a rig picked writes a stamp, looped unless its loop is turned off',
		rigCard.arcade?.zoneArt,
		{
			'rock#': {
				source: RIG_SOURCE,
				variants: [{ kind: 'rig', rig: 'R_Moss', animation: 'grow', loop: false }],
				placement: 'stamp',
			},
		},
	);
	ok(
		'7. … a variant added is a copy of its rig, and the loop turned back on stores nothing',
		isDeepStrictEqual(looped?.variants, [RIG_SOURCE]) &&
			isDeepStrictEqual(cardEdits.rigLooped({ ...RIG_SOURCE, loop: false }, true), RIG_SOURCE),
	);
	eq(
		'7. another rig keeps the animation when it has one of that name, and asks for one otherwise',
		[
			cardEdits.rigPicked(RIG_SOURCE, 'R_Boulder', ['sway', 'idle']),
			cardEdits.rigPicked({ ...RIG_SOURCE, loop: false }, 'R_Boulder', ['idle']),
			cardEdits.rigPicked(RIG_SOURCE, 'R_Boulder', ['sway']),
			cardEdits.rigPicked(RIG_SOURCE, 'R_Boulder', undefined),
			cardEdits.rigPicked(RIG_SOURCE, 'R_Rock', undefined),
			cardEdits.rigPicked({ kind: 'sprite', region: ROCK }, 'R_Rock', ['idle']),
		],
		[
			{ kind: 'rig', rig: 'R_Boulder', animation: 'idle' },
			{ kind: 'rig', rig: 'R_Boulder', animation: 'idle', loop: false },
			undefined,
			undefined,
			RIG_SOURCE,
			undefined,
		],
	);
	eq(
		'7. an animation picked keeps the picture’s loop; the rigs whose animations the card reads',
		[
			cardEdits.rigSourceOf({ ...RIG_SOURCE, loop: false }, 'R_Boulder', 'sway'),
			cardEdits.rigSourceOf({ kind: 'sprite', region: ROCK }, 'R_Boulder', 'sway'),
			cardEdits.zoneArtRigNames(rigCard),
			cardEdits.zoneArtRigNames(PLAIN),
		],
		[
			{ kind: 'rig', rig: 'R_Boulder', animation: 'sway', loop: false },
			{ kind: 'rig', rig: 'R_Boulder', animation: 'sway' },
			['R_Rock', 'R_Moss'],
			[],
		],
	);
	eq(
		'7. a family drawn as a rig on more than 100 zones is warned of; a frame or 100 rigs are not',
		[
			cardEdits.rigCrowdWarning(318, rigCard.arcade?.zoneArt?.['rock#']).startsWith('318 zones'),
			cardEdits.rigCrowdWarning(cardEdits.ZONE_ART_RIG_CROWD, rigCard.arcade?.zoneArt?.['rock#']),
			cardEdits.rigCrowdWarning(318, normalizeZoneArt(PLAIN_ART)?.['rock#']),
			cardEdits.rigCrowdWarning(318, undefined),
		],
		[true, '', '', ''],
	);
	cardEdits.removeZoneArt(rigCard, 'rock#');
	ok('7. the bin leaves no field behind', isDeepStrictEqual(rigCard, PLAIN));
	eq(
		'7. the rig roots of the ship chain, and the names the boot keeps loaded: frames, then rigs',
		[zoneArtRigRoots(withArt(PLAIN, SALMONS_ART)), zoneArtArtNames(withArt(PLAIN, SALMONS_ART))],
		[
			['R_Rock', 'R_Pool'],
			[ROCK, `${SHEET}::sand`, `${SHEET}::pine`, 'R_Rock', 'R_Pool'],
		],
	);
}

// 8. Rule 8, through the real exporter.
const CLIENT = 'invisible_wall';
const put = (key: string, body: unknown) =>
	bucket.set(key, {
		text: typeof body === 'string' ? body : JSON.stringify(body),
		modified: 1_700_000_000_000,
	});
const sheetIn = (project: string, stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, project)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, project)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const clipIn = (project: string, id: string, sheet: string, frame: string) =>
	put(clipDocKey(CLIENT, project, id), { id, name: id, assetKey: sheet, frames: [frame] });
const RIG_OF_MOSS = { kind: 'rig', rig: 'R_Moss', animation: 'grow' } as const;
/** A project's rigs as the Rigger stores them: each bundle's skeleton, atlas and page, listed. */
const rigsIn = (project: string, names: string[]) => {
	for (const name of names) {
		const folder = `${SUB.spines(CLIENT, project)}/${name}`;
		put(`${folder}/${name}.atlas`, `${name}.webp\nsize: 8,8\nbone\n  bounds: 0,0,8,8\n`);
		put(`${folder}/${name}.json`, { skeleton: { spine: '4.2' } });
		put(`${folder}/${name}.webp`, 'x');
	}
	put(`${SUB.spines(CLIENT, project)}/skeletons.json`, {
		skeletons: names.map((name) => ({
			folder: name,
			name,
			atlas_file: `${name}.atlas`,
			skeleton_file: `${name}.json`,
		})),
	});
};

for (const [project, base] of [
	['plain', PLAIN],
	['salmons_zone', salmonsRaw()],
] as const) {
	const rocks = sheetIn(project, 'S_Rocks', 'boulder');
	const ripple = sheetIn(project, 'S_Ripple', 'ripple_0');
	const other = sheetIn(project, 'S_Other', 'tree');
	const otherClip = sheetIn(project, 'S_OtherClip', 'leaf_0');
	const pines = sheetIn(project, 'S_Pines', 'pine');
	const sway = sheetIn(project, 'S_Sway', 'sway_0');
	clipIn(project, 'pond_ripple', ripple, 'ripple_0');
	clipIn(project, 'leaf_fall', otherClip, 'leaf_0');
	clipIn(project, 'tree_sway', sway, 'sway_0');
	rigsIn(project, ['R_Moss', 'R_Unnamed', 'R_Pine']);
	put(editorDocKey(CLIENT, project), LAYOUT);
	const salmons = project !== 'plain';
	const art = {
		'rock#': {
			source: { kind: 'sprite', region: `${rocks}::boulder` },
			variants: [{ kind: 'rig', rig: 'R_Moss', animation: 'grow' }],
			placement: 'stamp',
		},
		[salmons ? 'whirlpool#' : 'pond']: {
			source: { kind: 'flipbook', clip: 'pond_ripple' },
			placement: 'stamp',
		},
		// Salmons' trees: a frame of one sheet, a clip of another, in the same map.
		...(salmons
			? {
					'@trees': {
						source: { kind: 'sprite', region: `${pines}::pine` },
						variants: [{ kind: 'flipbook', clip: 'tree_sway' }],
						placement: 'stamp',
					},
				}
			: {}),
	};
	const config = (zoneArt?: unknown) =>
		put(gameConfigDocKey(CLIENT, project), zoneArt === undefined ? base : withArt(base, zoneArt));

	config(art);
	const played = await collectPlayedClipIds(CLIENT, project);
	const index = await exportEditorArt(CLIENT, project);
	const shipped = (key: string) => index.sheets.some((s) => s.key === key);
	ok(`8. ${project}: the clip zone art names is played`, !!played?.has('pond_ripple'));
	ok(`8. ${project}: a clip nothing names is not`, !!played && !played.has('leaf_fall'));
	ok(
		`8. ${project}: the trees’ clip is played (Salmons), and ships its sheet with the trees’ frame’s`,
		salmons
			? !!played?.has('tree_sway') && shipped(pines) && shipped(sway)
			: !played?.has('tree_sway') && !shipped(pines) && !shipped(sway),
		JSON.stringify(index.sheets.map((s) => s.key)),
	);
	ok(
		`8. ${project}: the frame’s sheet and the clip’s sheet ship, written under deploy/editor-art/`,
		shipped(rocks) &&
			shipped(ripple) &&
			index.sheets
				.filter((s) => s.key === rocks || s.key === ripple)
				.every((s) => bucket.has(`${SUB.deploy(CLIENT, project)}/${s.json}`)),
		JSON.stringify(index.sheets.map((s) => s.key)),
	);
	ok(
		`8. ${project}: the frame is covered, not dangling`,
		!index.missing.includes('boulder'),
		JSON.stringify(index.missing),
	);
	ok(`8. ${project}: a sheet nothing names does not ship`, !shipped(other) && !shipped(otherClip));
	// A rig ships as a character sheet's does (`exportRigBundle`): its skeleton and atlas under
	// `deploy/editor-art/<name>/`, its page in the shared `deploy/_pages/` store the atlas names.
	const rigShipped = (name: string, of = index) => {
		const entry = of.spines.find((r) => r.key === name);
		const atlas = entry && bucket.get(`${SUB.deploy(CLIENT, project)}/${entry.atlas}`)?.text;
		const page = atlas?.split('\n')[0].trim() ?? '';
		return (
			!!entry &&
			bucket.has(`${SUB.deploy(CLIENT, project)}/${entry.skeleton}`) &&
			page.startsWith('../../_pages/') &&
			bucket.has(`${SUB.deploy(CLIENT, project)}/${page.slice('../../'.length)}`)
		);
	};
	ok(
		`8. ${project}: the rig zone art names ships under its name: its skeleton, atlas and page under deploy/editor-art/`,
		rigShipped('R_Moss'),
		JSON.stringify(index.spines),
	);
	ok(
		`8. ${project}: a rig nothing names does not`,
		!index.spines.some((r) => r.key === 'R_Unnamed'),
	);
	ok(
		`8. ${project}: the index names the frame (and the trees’) and the rig, so the game's boot keeps them loaded`,
		isDeepStrictEqual(
			index.characterArt,
			salmons ? [`${rocks}::boulder`, `${pines}::pine`, 'R_Moss'] : [`${rocks}::boulder`, 'R_Moss'],
		),
		JSON.stringify(index.characterArt),
	);
	ok(
		`8. ${project}: the trees’ frame is covered, not dangling`,
		!index.missing.includes('pine'),
		JSON.stringify(index.missing),
	);

	config(undefined);
	const without = await exportEditorArt(CLIENT, project);
	const playedWithout = await collectPlayedClipIds(CLIENT, project);
	ok(
		`8. ${project}: without zone art no sheet of it ships, no clip is played, nothing is named`,
		without.characterArt === undefined &&
			!without.spines.length &&
			!without.sheets.some((s) => [rocks, ripple, pines, sway].includes(s.key)) &&
			!!playedWithout &&
			!playedWithout.has('pond_ripple') &&
			!playedWithout.has('tree_sway'),
	);
	if (salmons) {
		config({ '@trees': art['@trees'] });
		const treesOnly = await exportEditorArt(CLIENT, project);
		const playedTrees = await collectPlayedClipIds(CLIENT, project);
		ok(
			`8. ${project}: the trees’ art alone ships its frame’s and its clip’s sheets, and no other`,
			treesOnly.sheets.some((s) => s.key === pines) &&
				treesOnly.sheets.some((s) => s.key === sway) &&
				!treesOnly.sheets.some((s) => s.key === rocks || s.key === ripple) &&
				isDeepStrictEqual(treesOnly.characterArt, [`${pines}::pine`]) &&
				!!playedTrees?.has('tree_sway') &&
				!playedTrees.has('pond_ripple'),
			JSON.stringify([treesOnly.sheets.map((s) => s.key), treesOnly.characterArt]),
		);
		config({
			'@trees': {
				source: { kind: 'sprite', region: `${pines}::pine` },
				variants: [{ kind: 'rig', rig: 'R_Pine', animation: 'sway' }],
				placement: 'stamp',
			},
		});
		const treeRig = await exportEditorArt(CLIENT, project);
		ok(
			`8. ${project}: a rig named for the trees is not shipped (scenery is never a rig): its frame is`,
			!treeRig.spines.some((r) => r.key === 'R_Pine') &&
				isDeepStrictEqual(treeRig.characterArt, [`${pines}::pine`]),
			JSON.stringify([treeRig.spines, treeRig.characterArt]),
		);
	}
	config({ [salmons ? 'whirlpool#' : 'pond']: { source: RIG_OF_MOSS, placement: 'stamp' } });
	const rigOnly = await exportEditorArt(CLIENT, project);
	ok(
		`8. ${project}: a rig alone ships, named for the boot, and no sheet of zone art does`,
		rigShipped('R_Moss', rigOnly) &&
			rigOnly.spines.length === 1 &&
			isDeepStrictEqual(rigOnly.characterArt, ['R_Moss']) &&
			!rigOnly.sheets.some((s) => [rocks, ripple, pines, sway].includes(s.key)),
		JSON.stringify([rigOnly.spines, rigOnly.characterArt]),
	);
	config({});
	const empty = await exportEditorArt(CLIENT, project);
	ok(
		`8. ${project}: an empty map exports exactly what no field does`,
		isDeepStrictEqual(empty, without),
	);
}

{
	const { zoneArtDefault } = cardEdits;
	const props = `invisible_wall/salmons/manifests/${gc.salmonsProjectManifestName('salmons_props')}`;
	eq(
		'9. a Salmons rock shows its 9 built-in rocks from the project sheet',
		zoneArtDefault('rock#', 'salmonsMap', [{ key: props }]),
		{
			label: 'Built-in rocks, one of 9 per rock',
			thumbs: Array.from({ length: 9 }, (_, i) => `${props}::rock_${i}`),
		},
	);
	eq(
		'9. without the project sheet the line stays, no thumbnail',
		zoneArtDefault('whirlpool#', 'salmonsMap', []).thumbs,
		[],
	);
	eq(
		'9. a rule-only family says it is invisible',
		zoneArtDefault('band#Left', 'salmonsMap', [{ key: props }], true),
		{ label: 'Invisible (rules only)', thumbs: [] },
	);
	eq(
		'9. a family drawn in code names its swatch',
		zoneArtDefault('sea', 'salmonsMap', []).drawn,
		'sea',
	);
	eq(
		'9. a plain game draws nothing by default',
		zoneArtDefault('rock#', undefined, [{ key: props }]),
		{
			label: 'Nothing drawn',
			thumbs: [],
		},
	);
	eq(
		'9. Salmons’ trees show the 6 built-in trees from the project sheet',
		zoneArtDefault('@trees', 'salmonsRiver', [{ key: props }]),
		{
			label: 'Built-in trees, 6 kinds',
			thumbs: Array.from({ length: 6 }, (_, i) => `${props}::tree_${i}`),
		},
	);
}

// 10. Scenery: a reserved key in the same map.
{
	const TREES = {
		source: { kind: 'sprite', region: `${SHEET}::pine` },
		variants: [
			{ kind: 'sprite', region: `${SHEET}::birch` },
			{ kind: 'flipbook', clip: 'tree_sway', fps: 6 },
		],
		placement: 'stamp',
		scale: 1.5,
	};
	eq('10. the scenery keys', [...ZONE_ART_SCENERY], ['@trees']);
	ok(
		'10. no zone Salmons’ generator makes has an @ in its id; every scenery key is an @-name',
		[0, 7, 31337].every((seed) =>
			generatedZones(salmonsRaw(), 'salmonsMap', seed).zones.every(
				(z) => !z.id.includes('@') && !isZoneArtScenery(zoneFamilyOf(z.id)),
			),
		) && ZONE_ART_SCENERY.every((key) => key.startsWith('@') && zoneFamilyOf(key) === key),
	);
	eq(
		'10. the trees’ entry is kept as authored, beside a family’s',
		normalizeZoneArt({ '@trees': TREES, 'rock#': PLAIN_ART['rock#'] }),
		{ '@trees': TREES, 'rock#': PLAIN_ART['rock#'] },
	);
	eq(
		'10. … and dropped as a family’s is when unusable',
		normalizeZoneArt({
			'@trees': { source: { kind: 'sprite', region: 'pine' }, placement: 'stamp' },
		}),
		undefined,
	);
	const salmonsTrees = withArt(salmonsRaw(), { '@trees': TREES });
	const savedTrees = prepareGameConfigDoc(salmonsTrees);
	ok(
		'10. a Salmons save carries the trees’ art, normalized, and warns of nothing in it',
		isDeepStrictEqual(savedTrees.doc.arcade?.zoneArt, { '@trees': TREES }) &&
			!savedTrees.warnings.some((i) => i.path.startsWith('arcade.zoneArt')) &&
			isDeepStrictEqual(applyPasted(salmonsTrees)?.arcade?.zoneArt, { '@trees': TREES }),
		JSON.stringify(savedTrees.warnings.filter((i) => i.path.startsWith('arcade.zoneArt'))),
	);
	ok(
		'10. the normalizer every runtime carries drops it: a Salmons config normalizes as without it',
		isDeepStrictEqual(normalizeGameConfigDoc(salmonsTrees), normalizeGameConfigDoc(salmonsRaw())),
	);
	eq(
		'10. in a game with no generator the trees are warned of as scenery, not as a family',
		issuesOf(withArt(PLAIN, { ...PLAIN_ART, '@trees': TREES })).map((i) => [
			i.path,
			i.message.includes('scenery'),
			i.message.includes('No zone'),
		]),
		[['arcade.zoneArt.@trees', true, false]],
	);
	const named = {
		...PLAIN,
		arcade: { ...PLAIN.arcade, zones: [{ id: '@trees', x: 0, y: 0, w: 50, h: 50 }] },
	} as unknown as GameConfigDoc;
	eq(
		'10. a zone stored as `@trees` is never stamped with the trees’ art',
		zoneArtStamps(named.arcade!.zones!, normalizeZoneArt({ '@trees': TREES }), 0),
		[],
	);
	const edited = structuredClone(PLAIN);
	setZoneField(edited, 0, 'id', '@trees');
	setZoneField(edited, 1, 'id', 'tree@1');
	setZoneField(edited, 2, 'id', 'lake');
	eq(
		'10. /config refuses an @ in a zone id',
		edited.arcade?.zones?.map((z) => z.id),
		['rock1', 'rock2', 'lake'],
	);
	const art = normalizeZoneArt({ '@trees': TREES })!['@trees'];
	const single = normalizeZoneArt({ '@trees': { source: TREES.source, placement: 'stamp' } })![
		'@trees'
	];
	const cells = Array.from({ length: 200 }, (_, i) => [i % 20, Math.floor(i / 20)] as const);
	const treePicks = (seed: number) => cells.map(([c, r]) => sceneryArtSourceFor(art, c, r, seed));
	ok(
		'10. a tree’s picture is picked by the seed and its cell alone, the same every time',
		isDeepStrictEqual(treePicks(5), treePicks(5)) &&
			isDeepStrictEqual(
				treePicks(5),
				cells.map(([c, r]) => zoneArtSourceFor(art, `${c},${r}`, 5)),
			),
	);
	ok(
		'10. every picture is drawn on some tree, and another seed picks otherwise',
		new Set(treePicks(5)).size === 3 && !isDeepStrictEqual(treePicks(5), treePicks(6)),
	);
	eq(
		'10. one picture: every tree draws it',
		new Set(cells.map(([c, r]) => sceneryArtSourceFor(single, c, r, 5))).size,
		1,
	);

	// The card.
	const level = generatedZones(salmonsRaw(), 'salmonsMap', 7).zones;
	const withTrees = structuredClone(salmonsTrees);
	eq(
		'10. the card: a Salmons game has one Trees row, under Scenery, and no zone row of it',
		[
			cardEdits
				.zoneArtSceneryRows(salmonsRaw(), 'salmonsMap')
				.map((r) => [r.key, r.label, r.stale, !!r.art]),
			cardEdits.zoneArtSceneryRows(withTrees, 'salmonsRiver').map((r) => [r.key, !!r.art]),
			cardEdits.zoneArtRows(level, withTrees, 'salmonsMap').some((r) => isZoneArtScenery(r.family)),
		],
		[[['@trees', 'Trees', false, false]], [['@trees', true]], false],
	);
	eq(
		'10. … a plain game none, but a stale row where an entry was left, to be binned',
		[
			cardEdits.zoneArtSceneryRows(PLAIN, undefined),
			cardEdits
				.zoneArtSceneryRows(withArt(PLAIN, { '@trees': TREES }), undefined)
				.map((r) => [r.key, r.stale]),
			cardEdits
				.zoneArtRows(PLAIN.arcade!.zones!, withArt(PLAIN, { '@trees': TREES }), undefined)
				.map((r) => r.family),
		],
		[[], [['@trees', true]], ['rock#', 'pond']],
	);
	const card = structuredClone(salmonsRaw());
	const before = structuredClone(card);
	cardEdits.setZoneArtSource(card, '@trees', 0, { kind: 'sprite', region: `${SHEET}::pine` });
	ok(
		'10. a pick writes the trees’ entry; a variant is added',
		cardEdits.addZoneArtVariant(card, '@trees'),
	);
	cardEdits.setZoneArtSource(card, '@trees', 1, { kind: 'flipbook', clip: 'tree_sway' });
	cardEdits.setZoneArtScale(card, '@trees', '0.8');
	eq('10. … changed, with a scale', card.arcade?.zoneArt, {
		'@trees': {
			source: { kind: 'sprite', region: `${SHEET}::pine` },
			variants: [{ kind: 'flipbook', clip: 'tree_sway' }],
			placement: 'stamp',
			scale: 0.8,
		},
	});
	cardEdits.removeZoneArt(card, '@trees');
	ok('10. the bin leaves the config as it was', isDeepStrictEqual(card, before));
	eq(
		'10. an empty map is unchanged: no field, no stamp, nothing shipped',
		[
			normalizeZoneArt({}),
			zoneArtStillRoots(withArt(PLAIN, {})),
			zoneArtClipRoots(withArt(PLAIN, {})),
		],
		[undefined, [], []],
	);
}

// 11. Scenery is never a rig.
{
	const TREE_RIG = { kind: 'rig', rig: 'R_Pine', animation: 'sway' } as const;
	const PINE = { kind: 'sprite', region: `${SHEET}::pine` } as const;
	eq(
		'11. a zone family takes a rig; scenery does not',
		[zoneArtTakesRig('rock#'), zoneArtTakesRig('pond'), ...ZONE_ART_SCENERY.map(zoneArtTakesRig)],
		[true, true, ...ZONE_ART_SCENERY.map(() => false)],
	);
	eq(
		'11. the normalizer drops a rig of the trees, as their source (the entry with it) or a variant',
		[
			normalizeZoneArt({ '@trees': { source: TREE_RIG, placement: 'stamp' } }),
			normalizeZoneArt({ '@trees': { source: PINE, variants: [TREE_RIG], placement: 'stamp' } }),
		],
		[undefined, { '@trees': { source: PINE, placement: 'stamp' } }],
	);
	const salmonsRig = withArt(salmonsRaw(), {
		'@trees': { source: PINE, variants: [TREE_RIG], placement: 'stamp' },
		'rock#': { source: RIG_SOURCE, placement: 'stamp' },
	});
	const savedRig = prepareGameConfigDoc(salmonsRig);
	eq(
		'11. a Salmons save keeps the rocks’ rig and drops the trees’, warning of it',
		[
			savedRig.doc.arcade?.zoneArt,
			savedRig.warnings
				.filter((i) => i.path.startsWith('arcade.zoneArt'))
				.map((i) => [i.path, i.message.includes('not drawn with a rig')]),
		],
		[
			{
				'@trees': { source: PINE, placement: 'stamp' },
				'rock#': { source: RIG_SOURCE, placement: 'stamp' },
			},
			[['arcade.zoneArt.@trees.variants.0', true]],
		],
	);
	const card = structuredClone(salmonsRaw());
	cardEdits.setZoneArtSource(card, '@trees', 0, TREE_RIG);
	ok('11. the card cannot store a rig for the trees', !card.arcade?.zoneArt);
	ok(
		'11. a rig is drawn on no tree: the river is handed none (`zoneArtOf` drops it)',
		isDeepStrictEqual(zoneArtOf(savedRig.doc)?.['@trees'], { source: PINE, placement: 'stamp' }),
	);
}

// 12. The rig drawing, over a real rig. The rig runtime reads `pixi-svelte` for the scale a rig was
// loaded at: 1 here, the rig made in place.
mock.module('pixi-svelte', { namedExports: { getRigLoadScale: () => 1 } });
{
	const RIG = await import('engine-rig/pixi');
	const { Container, TextureSource } = await import('pixi.js');
	const { createZoneRig, zoneRigDataOf, zoneRigMount } =
		await import('../../../packages/engine-layout/src/lib/zoneArtRig.ts');
	const { BLINK_RIG } = await import('../../../scripts/playtest/fixtures/zoneRigStubs.mjs');
	/** The blink rig (cyan, then yellow half way through each second), its Bounds box `header`. */
	const blinkData = (header: object) => {
		const atlas = new RIG.TextureAtlas(['blink.png', ...BLINK_RIG.atlas, ''].join('\n'));
		atlas.pages[0].setTexture(
			RIG.RigPageTexture.from(new TextureSource({ width: 128, height: 32 })),
		);
		return new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData({
			...BLINK_RIG.skeleton,
			skeleton: { spine: '4.2.0', ...header },
		});
	};
	const data = blinkData({ x: -10, y: -8, width: 40, height: 80 });
	const BLINK = { kind: 'rig', rig: 'blink', animation: 'blink' } as const;
	const shows = (rig: NonNullable<ReturnType<typeof createZoneRig>>) =>
		(rig.view.children[0] as InstanceType<typeof RIG.RigView>).skeleton.slots[0].getAttachment()
			?.name;
	const late = createZoneRig(data, BLINK, 0.75)!;
	const early = createZoneRig(data, BLINK, 0.25)!;
	const once = createZoneRig(data, { ...BLINK, loop: false }, 0.75)!;
	const inner = late.view.children[0];
	eq(
		'12. a picture: its rig in a container at the middle of its Bounds box, measured as that box',
		[
			late.w,
			late.h,
			[inner instanceof RIG.RigView, inner.x, inner.y],
			[late.view.boundsArea?.x, late.view.boundsArea?.y],
			[late.view.getLocalBounds().width, late.view.getLocalBounds().height],
		],
		[40, 80, [true, -10, 32], [-20, -40], [40, 80]],
	);
	eq(
		'12. it starts at its phase when looped, posed at once; played once, from its start',
		[late.drawn().time, shows(late), early.drawn().time, shows(early), once.drawn()],
		[0.75, 'yellow', 0.25, 'cyan', { rig: 'blink', animation: 'blink', loop: false, time: 0 }],
	);
	late.update(100);
	early.update(10_000);
	ok(
		'12. it moves on by the time given, no more than a tenth of a second at once',
		Math.abs(late.drawn().time - 0.85) < 1e-9 && Math.abs(early.drawn().time - 0.35) < 1e-9,
		JSON.stringify([late.drawn(), early.drawn()]),
	);
	const centred = createZoneRig(blinkData({ width: 64, height: 32 }), BLINK)!;
	eq(
		'12. a header box with no corner is centred on the rig; an animation it lacks draws nothing',
		[
			[centred.view.children[0].x, centred.view.children[0].y, centred.w, centred.h],
			createZoneRig(data, { ...BLINK, animation: 'gone' }),
		],
		[[0, 0, 64, 32], undefined],
	);
	eq(
		'12. a rig loaded under its bundle name is found; a texture or nothing is not',
		[
			zoneRigDataOf({ blink: data }, 'blink') === data,
			zoneRigDataOf({ blink: { width: 1 } }, 'blink'),
			zoneRigDataOf(undefined, 'blink'),
			zoneRigDataOf({}, 'toString'),
		],
		[true, undefined, undefined, undefined],
	);
	const ticks: ((ticker: { deltaMS: number }) => void)[] = [];
	const app = {
		ticker: {
			add: (fn: (ticker: { deltaMS: number }) => void) => ticks.push(fn),
			remove: (fn: (ticker: { deltaMS: number }) => void) => ticks.splice(ticks.indexOf(fn), 1),
		},
	};
	const into = new Container();
	const stamp = { source: BLINK, phase: 0.5, w: 200, h: 140 };
	const teardown = zoneRigMount(stamp, () => ({ blink: data }))(into, app as never);
	const mounted = into.children[0];
	const before = (mounted.children[0] as InstanceType<typeof RIG.RigView>).state.getCurrent(
		0,
	)!.trackTime;
	for (const tick of [...ticks]) tick({ deltaMS: 50 });
	const after = (mounted.children[0] as InstanceType<typeof RIG.RigView>).state.getCurrent(
		0,
	)!.trackTime;
	eq(
		'12. a plain game’s stamp: fitted inside its box, ratio kept, moved on by the app’s ticker',
		[
			into.children.length,
			mounted.scale.x,
			mounted.scale.y,
			ticks.length,
			+(after - before).toFixed(9),
		],
		[1, 1.75, 1.75, 1, 0.05],
	);
	teardown();
	const empty = new Container();
	zoneRigMount(stamp, () => ({}))(empty, app as never)();
	ok(
		'12. … let go with its mount; a rig not loaded mounts nothing',
		ticks.length === 0 && mounted.destroyed && into.children.length === 0 && !empty.children.length,
	);
}

// 13. A prop component as a zone family's picture (`docs/design/arcade-prop-components.md` §6, P6):
// the source, the compile on save, the card, and rule 8.
{
	const { compileZoneArtProps } = await import('../src/lib/server/zoneArtProps.ts');
	const { zoneArtPropSeeds } = await import('../src/lib/server/zoneArtPropSeeds.ts');
	const { loadComponentForGame } = await import('../src/lib/server/componentStorage.ts');
	const { projectComponentKey, projectComponentVersionKey } =
		await import('../src/lib/server/projectPaths.ts');
	const { BRIDGE_PROP_DEF } =
		await import('../../../packages/engine-layout/src/lib/propComponents.ts');
	const { withProps, validateZoneArt, zoneArtComponentRoots } = gc;
	const COMPONENT = { kind: 'component', component: 'myBridge', version: 2 } as const;
	const bridgeArt = { 'bridge#': { source: COMPONENT, placement: 'stamp' } };

	// 13.1 The source.
	eq(
		'13. a component is a zone family’s picture, pinned at its version',
		normalizeZoneArt(bridgeArt),
		bridgeArt,
	);
	eq(
		'13. … never scenery, never a variant, never without a whole version',
		normalizeZoneArt({
			'@trees': { source: COMPONENT, placement: 'stamp' },
			'rock#': {
				source: { kind: 'sprite', region: ROCK },
				variants: [COMPONENT],
				placement: 'stamp',
			},
			'bridge#': { source: { ...COMPONENT, version: 1.5 }, placement: 'stamp' },
		}),
		{ 'rock#': { source: { kind: 'sprite', region: ROCK }, placement: 'stamp' } },
	);
	eq(
		'13. … a component’s family keeps no variant and stamps nothing (the game’s art places it)',
		[
			normalizeZoneArt({
				'bridge#': {
					source: COMPONENT,
					variants: [{ kind: 'sprite', region: ROCK }],
					placement: 'stamp',
				},
			}),
			zoneArtStamps([{ id: 'bridge0', x: 0, y: 0, w: 96, h: 48 }], bridgeArt, 1),
		],
		[bridgeArt, []],
	);
	eq(
		'13. … the roots the save compiles and the bundle ships',
		zoneArtComponentRoots({ arcade: { zoneArt: bridgeArt } }),
		[{ family: 'bridge#', component: 'myBridge', version: 2 }],
	);
	ok(
		'13. … the validator says when a component is a variant or scenery',
		validateZoneArt({
			arcade: {
				online: { generator: 'salmonsMap' },
				zoneArt: {
					'@trees': { source: COMPONENT, placement: 'stamp' },
					'rock#': {
						source: { kind: 'sprite', region: ROCK },
						variants: [COMPONENT],
						placement: 'stamp',
					},
				},
			},
		}).filter((i) => /component draws a whole zone family/.test(i.message)).length === 2,
	);

	// 13.2 The compile on save, with a stub store of the project's defs.
	const salmonsDoc = (zoneArt: unknown, props?: unknown) => {
		const raw = salmonsRaw() as { arcade: { zoneArt?: unknown; online: { props?: unknown } } };
		raw.arcade.zoneArt = zoneArt;
		if (props) raw.arcade.online.props = props;
		return prepareGameConfigDoc(raw).doc;
	};
	const copyOf = (version: number, ramps = { near: { length: 2 }, far: { length: 2 } }) => ({
		...structuredClone(BRIDGE_PROP_DEF),
		id: 'myBridge',
		version,
		internal: false,
		scope: 'project' as const,
		prop: {
			...structuredClone(BRIDGE_PROP_DEF.prop!),
			collider: { ...structuredClone(BRIDGE_PROP_DEF.prop!.collider), ramps },
		},
	});
	const store = (defs: ReturnType<typeof copyOf>[]) => async (id: string, version?: number) =>
		version === undefined
			? defs.filter((d) => d.id === id).at(-1)
			: defs.find((d) => d.id === id && d.version === version);
	const ramped = copyOf(2, { near: { length: 3 }, far: { length: 2 } });
	const compiled = await compileZoneArtProps(salmonsDoc(bridgeArt), store([ramped]));
	eq(
		'13. the save compiles the pinned component’s collider into arcade.online.props, stamped',
		[compiled.doc.arcade?.online?.props, compiled.warnings],
		[
			{
				'bridge#': {
					from: { component: 'myBridge', version: 2 },
					zoneKind: 'bridge',
					ramp: { near: 3, far: 2 },
				},
			},
			[],
		],
	);
	eq(
		'13. … a seed copy compiles to today’s bridge: its stamp alone',
		(await compileZoneArtProps(salmonsDoc(bridgeArt), store([copyOf(2)]))).doc.arcade?.online
			?.props,
		{ 'bridge#': { from: { component: 'myBridge', version: 2 }, zoneKind: 'bridge' } },
	);
	const stale = await compileZoneArtProps(salmonsDoc(bridgeArt), store([ramped, copyOf(3)]));
	ok(
		'13. a stale pin warns and still plays the pinned version',
		stale.warnings.some((w) => /newer version \(v3\)/.test(w.message)) &&
			stale.doc.arcade?.online?.props?.['bridge#']?.from.version === 2,
		JSON.stringify(stale.warnings),
	);
	const missing = await compileZoneArtProps(salmonsDoc(bridgeArt), store([]));
	ok(
		'13. a missing component warns and adds no collider',
		missing.warnings.some((w) => /is not in this project/.test(w.message)) &&
			!missing.doc.arcade?.online?.props,
	);
	const solids = Array.from({ length: 9 }, (_, k) => ({
		x: k,
		y: 0,
		w: 0.5,
		h: 0.5,
		collide: 'solid',
	}));
	const oversize = await compileZoneArtProps(
		salmonsDoc(bridgeArt),
		store([
			{
				...ramped,
				prop: { ...ramped.prop!, collider: { ...ramped.prop!.collider, solids } },
			} as never,
		]),
	);
	ok(
		'13. a collider past the cap is refused at save, said, and plays today’s rule',
		oversize.warnings.some((w) => /at most 8 solids/.test(w.message)) &&
			!oversize.doc.arcade?.online?.props,
		JSON.stringify(oversize.warnings),
	);
	const pasted = await compileZoneArtProps(
		salmonsDoc(undefined, {
			'bridge#': { from: { component: 'x', version: 1 }, zoneKind: 'bridge', snap: 0.25 },
		}),
		store([]),
	);
	ok(
		'13. a collider no component draws is dropped, and said',
		!pasted.doc.arcade?.online?.props &&
			pasted.warnings.some((w) => /No component draws bridge#/.test(w.message)),
	);
	const carried = compiled.doc;
	eq(
		'13. the props are carried on load and paste (withProps, applyPasted)',
		[
			withProps(normalizeGameConfigDoc(carried), carried)?.arcade?.online?.props,
			applyPasted(structuredClone(carried))?.arcade?.online?.props,
			prepareGameConfigDoc(structuredClone(carried)).doc.arcade?.online?.props,
		],
		Array(3).fill(compiled.doc.arcade?.online?.props),
	);

	// 13.3 The card.
	const propsList = [
		{ id: 'myBridge', name: 'My bridge', version: 3, zoneKind: 'bridge' },
		{ id: 'myLog', name: 'My log', version: 1, zoneKind: 'log' },
	];
	eq(
		'13. the card lists the project’s props of the family’s kind',
		cardEdits.zoneArtPropsFor('bridge#', propsList).map((p) => p.id),
		['myBridge'],
	);
	eq(
		'13. … picks one at its latest, notes a newer version, shows the compiled collider',
		[
			cardEdits.componentSourceOf(propsList[0]),
			cardEdits.zoneArtPinNote(COMPONENT, propsList),
			cardEdits.zoneArtPinNote({ ...COMPONENT, version: 3 }, propsList),
			cardEdits.compiledPropText(compiled.doc, 'bridge#'),
		],
		[
			{ kind: 'component', component: 'myBridge', version: 3 },
			'v3 is newer: this game plays v2 until you choose it.',
			'',
			'{"ramp":{"near":3,"far":2}}',
		],
	);
	const edited = structuredClone(compiled.doc);
	cardEdits.setZoneArtSource(edited, 'rock#', 0, { kind: 'sprite', region: ROCK });
	cardEdits.setZoneArtSource(edited, 'bridge#', 0, cardEdits.componentSourceOf(propsList[0]));
	eq(
		'13. … a re-pin is the author’s choice: the card writes it, the save compiles it',
		edited.arcade?.zoneArt?.['bridge#']?.source,
		{ kind: 'component', component: 'myBridge', version: 3 },
	);

	// 13.4 Rule 8: the def at its pin, its pieces and its art are in the bundle's closure, and a game
	// is never handed the editor-only preview.
	const project = 'salmons_zone';
	put(projectComponentKey(project, 'myBridge'), copyOf(3));
	put(projectComponentVersionKey(project, 'myBridge', 2), ramped);
	const seeds = await zoneArtPropSeeds(compiled.doc, (id, version) =>
		loadComponentForGame(id, project, version),
	);
	ok(
		'13. the closure is seeded with the component and its pieces, and ships the pinned def',
		seeds.ids.includes('myBridge') &&
			['bridgePropWater', 'bridgePropPillar', 'bridgePropDeckMiddle', 'bridgePropSlope'].every(
				(id) => seeds.ids.includes(id),
			) &&
			seeds.pinned.length === 1 &&
			seeds.pinned[0].version === 2,
		JSON.stringify(seeds.ids),
	);
	ok(
		'13. … without its editor-only preview',
		!!ramped.prop?.preview && !seeds.pinned[0].prop?.preview && !!seeds.pinned[0].prop?.collider,
	);
	put(gameConfigDocKey(CLIENT, project), compiled.doc);
	const shippedProps = await exportEditorArt(CLIENT, project);
	ok('13. the export walks it with the rest (no art of its own to ship)', !!shippedProps);
}

console.log(`check:zone-art — ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
