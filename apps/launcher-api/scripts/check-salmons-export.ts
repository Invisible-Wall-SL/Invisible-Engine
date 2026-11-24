/**
 * `scripts/salmons/export.mjs` writes the documents a person uploads to the `salmons` project. The
 * launcher only finds them at its own keys (`projectComponentKey` lowercases `salmonsBear` to
 * `salmonsbear`), so this runs the export and holds every key it writes to the launcher's, and the
 * export's copy of `r2Slug` to the launcher's.
 *
 * The config it writes carries no zones (owner, 2026-11-24): every room's are its generator's, so
 * this holds the game a room plays from it to the one it plays from the config with the scene's
 * level in it (`salmonsConfig`), seed by seed.
 *
 * Run: pnpm --filter launcher-api check:salmons-export
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ONLINE_GENERATORS, generatedOnlineGame } from 'engine-mechanics';
import {
	normalizeGameConfigDoc,
	onlineGameOf,
	validateGameConfigDoc,
	withTouchSchemes,
	type GameConfigDoc,
	type OnlineGame,
} from 'game-config';
import { SALMONS_CHARACTER_COMPONENTS } from '../../../packages/engine-layout/src/lib/referenceLayouts/salmons';
import { SALMONS_LOBBY, salmonsConfig } from '../../../packages/engine-mechanics/src/salmons.js';
import {
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../../../packages/engine-mechanics/src/salmonsMap.js';
import { r2Slug as exportSlug } from '../../../scripts/salmons/r2Slug.mjs';
import {
	editorDocKey,
	flowV2DocKey,
	gameConfigDocKey,
	projectComponentKey,
	r2Slug,
} from '../src/lib/server/projectPaths';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
	if (ok) passed += 1;
	else {
		failed += 1;
		console.error(`✗ ${name}${detail ? `\n    ${detail}` : ''}`);
	}
};

for (const name of [
	'salmonsBear',
	'salmons',
	'Invisible Wall',
	'my-game',
	'ÀÉ',
	'',
	'x'.repeat(80),
]) {
	check(`r2Slug(${JSON.stringify(name)}) is the launcher's`, exportSlug(name) === r2Slug(name));
}

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? files(path) : [relative(out, path)];
	});

const out = mkdtempSync(join(tmpdir(), 'salmons-export-'));
let configText: string;
try {
	execFileSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--no-warnings',
			'--import',
			'./scripts/ts-loader.mjs',
			'scripts/salmons/export.mjs',
			'--out',
			out,
		],
		{ cwd: root, stdio: 'pipe' },
	);
	const written = new Set(files(out).map((path) => path.split('\\').join('/')));
	const client = 'invisible_wall';
	const project = 'salmons';
	const expected = [
		gameConfigDocKey(client, project),
		editorDocKey(client, project),
		flowV2DocKey(client, project),
		...SALMONS_CHARACTER_COMPONENTS.map((def) => projectComponentKey(project, def.id)),
	];
	for (const key of expected)
		check(`the export writes ${key}`, written.has(key), [...written].join(', '));
	check(
		'the export writes nothing else',
		written.size === expected.length,
		[...written].filter((key) => !expected.includes(key)).join(', '),
	);
	check(
		'a component key is the lowercased id (salmonsBear → salmonsbear)',
		SALMONS_CHARACTER_COMPONENTS.some((def) => def.id !== def.id.toLowerCase()) &&
			[...written].every((key) => key === key.toLowerCase()),
	);
	configText = readFileSync(join(out, gameConfigDocKey(client, project)), 'utf8');
} finally {
	rmSync(out, { recursive: true, force: true });
}

// The config as the export wrote it until 2026-11-24, with the zones and zone rules of the scene's
// level (`SALMONS_MAP_SEED`): what `salmonsConfig` still makes.
const shipped: GameConfigDoc = JSON.parse(configText);
const authored = salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED), { lobby: SALMONS_LOBBY });
const snapshot: GameConfigDoc = JSON.parse(
	JSON.stringify(withTouchSchemes(normalizeGameConfigDoc(authored), authored)),
);
const zonesOf = (doc: GameConfigDoc) => [doc.arcade?.zones, doc.arcade?.online?.rules?.zones];
check(
	'the exported config carries no zones and no zone rules',
	zonesOf(shipped).every((list) => list === undefined),
	JSON.stringify(zonesOf(shipped).map((list) => list?.length)),
);
check(
	'salmonsConfig has the zones it leaves out, so the games below are compared with them',
	zonesOf(snapshot).every((list) => !!list?.length),
);
const less = structuredClone(snapshot);
delete less.arcade?.zones;
delete less.arcade?.online?.rules?.zones;
check(
	'it is salmonsConfig less those two lists: the field, the spawns and the rest are kept',
	configText === `${JSON.stringify(less, null, '\t')}\n`,
);
check(
	'it names a generator, which makes every room its zones',
	Object.hasOwn(ONLINE_GENERATORS, shipped.arcade?.online?.generator ?? ''),
	String(shipped.arcade?.online?.generator),
);
const issuesOf = (doc: GameConfigDoc) => {
	const normalized = normalizeGameConfigDoc(doc);
	return normalized ? validateGameConfigDoc(normalized) : [];
};
const withZones = issuesOf(snapshot);
const issues = issuesOf(shipped);
check(
	'the validator finds no error in it, and nothing it does not find with the zones',
	issues.every(
		(issue) =>
			issue.severity !== 'error' && withZones.some((other) => isDeepStrictEqual(other, issue)),
	),
	JSON.stringify(issues),
);

// As the game server (`configSource.ts`) and a device (`online.ts`) read a config.
const playedOf = (doc: GameConfigDoc, size?: number) =>
	onlineGameOf(normalizeGameConfigDoc(doc) ?? null, size ? { size } : {});
const played = (doc: GameConfigDoc, size?: number): OnlineGame | undefined => {
	const game = playedOf(doc, size);
	return game && !('refused' in game) ? game : undefined;
};
check('onlineGameOf plays it', !!played(shipped), JSON.stringify(playedOf(shipped)));
const unzoned = (game: OnlineGame | undefined) =>
	game && {
		...game,
		zones: [],
		online: { ...game.online, rules: { ...game.online.rules, zones: [] } },
	};
check(
	'before a room makes its level, the two games differ only in their zones and zone rules',
	!!played(snapshot) && isDeepStrictEqual(unzoned(played(snapshot)), unzoned(played(shipped))),
);
for (const size of [undefined, 10]) {
	const games = { with: played(snapshot, size), without: played(shipped, size) };
	for (const seed of [0, SALMONS_MAP_SEED, 7, 42, 123_456_789, 0xffff_ffff]) {
		check(
			`a room ${size ? `of ${size} ` : ''}seeded ${seed} plays the same game without them`,
			!!games.with &&
				!!games.without &&
				isDeepStrictEqual(
					generatedOnlineGame(games.with, seed),
					generatedOnlineGame(games.without, seed),
				),
		);
	}
}

// The looks sit on their places (the P10.8 offset, docs/knowledge/families/arcade.md): a `rect`
// is drawn about its centre unless it sets an anchor, so its x / y is where its middle goes. A
// character stands on its place (feet there, upright in the isometric river); a reach is centred.
const boxOf = (def: (typeof SALMONS_CHARACTER_COMPONENTS)[number]) => {
	const shape = def.root.children?.[0];
	if (shape?.kind !== 'rect') return undefined;
	const anchor = shape.anchor ?? { x: 0.5, y: 0.5 };
	const left = shape.x - anchor.x * shape.width;
	const top = shape.y - anchor.y * shape.height;
	return { left, right: left + shape.width, top, bottom: top + shape.height };
};
const STANDING = new Set(['salmonsSalmon', 'salmonsBear', 'salmonsFisherman']);
for (const def of SALMONS_CHARACTER_COMPONENTS) {
	const box = boxOf(def);
	const seated =
		!!box &&
		box.left === -box.right &&
		(STANDING.has(def.id) ? box.bottom === 0 : box.top === -box.bottom);
	check(
		`${def.id} is drawn ${STANDING.has(def.id) ? 'standing on' : 'centred on'} its place`,
		seated,
		JSON.stringify(box),
	);
}

console.log(`check:salmons-export — ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
