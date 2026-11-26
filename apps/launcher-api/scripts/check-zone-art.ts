/**
 * ZONE ART (`docs/design/zone-art.md`, Game Config `arcade.zoneArt`): what an arcade game's zone
 * families are drawn with, from `/config` to the room. This holds:
 *
 *  1. the schema: a sheet's frame and a Flipbook clip are kept as authored; a rig source, a `fill`
 *     or `edge` placement, a frame that names no sheet, a blank clip are dropped, as are a scale of
 *     1, an fps out of range and variants past the limit. It is CARRIED: the normalizer every
 *     runtime carries drops it (so no other runtime's bytes move), the launcher's save and Raw
 *     JSON's Apply put it back normalized, and the runtime reads the stored map;
 *  2. the family is the Zones chips' group (`zoneFamilyOf` is what `/config` groups by), and the
 *     picture a zone draws is chosen by the seed and the zone alone, the same on every device;
 *  3. the stamps: one per zone of a family with an entry, its box the zone's grown about its centre
 *     by the scale; none for an empty or absent map;
 *  4. the validator: a family no stored zone has is warned of; a generated game is not judged;
 *  5. COSMETIC: a Salmons room made by the game server's own read of a config with zone art plays
 *     the same level, levels and fingerprint as without, and a device with zone art adopts nothing
 *     and is never refused; the game a room plays is the same game;
 *  6. a PLAIN arcade game (no generator): its stamps are layout nodes in one container under its
 *     play field's spawn layer, with the layer's transform; a sprite keeps its frame's ratio and a
 *     clip with a Bounds box its own; no zone art, or no such layer, leaves the doc as it was;
 *  7. the Zone art card's rows and edits (`zoneArtDoc.ts`): a Salmons level's rule-only families
 *     are hidden unless asked; a pick writes a stamp; a variant, a scale, a cleared picture and
 *     the bin all store what the normalizer keeps, and the last one leaves no field behind;
 *  8. rule 8: the REAL `exportEditorArt` and `collectPlayedClipIds` over an in-memory R2 ship the
 *     sheet of a frame and the clip (and its sheet) named ONLY by zone art, for a plain game and
 *     for Salmons, and name the frame in the index's `characterArt` (what the boot keeps loaded by);
 *     a sheet and a clip nothing names do not; without zone art none of them does, and an empty
 *     map exports exactly what a config without the field exports. Salmons' trees' art (`@trees`)
 *     ships the same way, with no code of its own;
 *  9. the card's Default line: Salmons' built-in pictures from the project's sheets, its trees too;
 * 10. SCENERY (`ZONE_ART_SCENERY`, `@trees`): a reserved key in the same map, kept by the
 *     normalizer, the save and Raw JSON as a family's entry is; no zone's family (`@` is in no
 *     generator's zone id, `/config` refuses one, and a zone so named is never stamped); not warned
 *     of in a Salmons config, and in a game with no generator warned of as scenery, never as a
 *     family no zone has; each tree's picture is picked by the seed and its cell alone; the card
 *     lists a Trees row for a Salmons generator only (and a stale one where an entry is left), not
 *     as a zone family, and its edits store what the normalizer keeps.
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
	zoneArtClipRoots,
	zoneArtOf,
	zoneArtSourceFor,
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
const { ZONE_ART_NODE, withZoneArtNodes } =
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
	'1. a rig, a fill or edge placement, an unscoped frame and a blank clip are dropped',
	normalizeZoneArt({
		a: { source: { kind: 'rig', rig: 'R_Rock', animation: 'idle' }, placement: 'stamp' },
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

// 5. Cosmetic: the game server's own read, with and without zone art.
const salmonsRaw = (): GameConfigDoc =>
	salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED), {
		levels: SALMONS_LEVELS,
	}) as unknown as GameConfigDoc;
const SALMONS_ART = {
	'rock#': {
		source: { kind: 'sprite', region: ROCK },
		variants: [{ kind: 'flipbook', clip: 'rock_spin' }],
		placement: 'stamp',
	},
	'whirlpool#': { source: { kind: 'flipbook', clip: 'swirl' }, placement: 'stamp' },
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
	put(editorDocKey(CLIENT, project), LAYOUT);
	const salmons = project !== 'plain';
	const art = {
		'rock#': { source: { kind: 'sprite', region: `${rocks}::boulder` }, placement: 'stamp' },
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
	ok(
		`8. ${project}: the index names the frame (and the trees’), so the game's boot keeps its sheet loaded`,
		isDeepStrictEqual(
			index.characterArt,
			salmons ? [`${rocks}::boulder`, `${pines}::pine`] : [`${rocks}::boulder`],
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
	}
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

console.log(`check:zone-art — ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
