/**
 * The Scene Editor's art scope (`$lib/server/projectArtScope.ts`): a project may read the ATLASES its
 * doc and its placed component defs reference — a SHARED def's atlas authored in another project of
 * the same client (`hudReadout` → `test6`'s `S_UI`) — and nothing beyond them.
 *
 *   1. `candidateAtlases` keeps only this client's keys SHAPED like an atlas manifest: another
 *      client's key, a traversal, an arbitrary `.json` (a doc, a config), an image, a folder are
 *      dropped.
 *      An atlas PAGE (built from the manifest's own, writable fields) is trusted only inside the
 *      manifest's project and only as an image (`pageAllowed`).
 *   2. `borrowsClientArt` refuses the shared `unassigned` pseudo-client and the default project.
 *   3. `artScopeAllows` allows exactly the scope's keys — no prefix matching, no traversal.
 *   4. Both editor art gates (regions + asset) go through `assertProjectArt`, so a referenced atlas
 *      AND its page stream — without it the editor drew every such frame as a grey placeholder.
 *   5. The REAL `loadRegionSet` over an in-memory R2 that records every key it touches: a manifest's
 *      own (author-writable) fields drive R2 reads ONLY inside the manifest's own project — no
 *      existence probe, HEAD or TexturePacker read of another project's key — and a manifest
 *      BORROWED from a sibling project resolves its page in THAT project, not the caller's.
 *   6. Art an author picks ONLY in a per-ratio instance override (`overrides.portrait.params`)
 *      is in the scope AND ships: the REAL `exportEditorArt` writes its sheet and its rig
 *      bundle to `deploy/editor-art/`. The editor reads R2 directly, so without this the game
 *      looks the portrait frame up in an atlas that was never exported.
 *   7. A component placed NOWHERE but listed by a `spawnLayer` (game-families §3.3: Flow spawns it
 *      at runtime) is in the scope and ships, with the components it nests: its default art's
 *      sheet and a nested def's sprite sheet are written under `deploy/editor-art/`. Rule 8: a
 *      spawnable that did not ship would spawn as a blank frame.
 *   8. The same for an arcade CHARACTER (P10.11): a component placed nowhere and spawnable nowhere,
 *      named only as a character's `component` in the game config — or only as a `shootAt`
 *      state's projectile — ships its def's art (`characterComponentIds` seeds the export). The
 *      same config without characters ships neither: the seed, not the doc, carries them.
 *   9. A `tilemap` (P10.13): every tileset region a painted tile draws is in the scope and ships
 *      under `deploy/editor-art/`; an entry no tile uses does not. The tilemap is part of the layout
 *      doc, so it ships with it; its art would otherwise stay at its source R2 prefix (rule 8).
 *  10. A CARD GAME (card-games.md §9.3): a card frame named only by a card's `frame` in the config's
 *      library ships its own art, and a card's art named only in its `params` (an image param of the
 *      frame) ships too (`cardGameComponentIds` / `cardGameParamRefs` seed the export). The same
 *      config without cards ships neither.
 *  11. SALMONS' ART as project sheets (`game-config` `SALMONS_PROJECT_SHEETS`): for a config whose
 *      generator draws in it, the sheets the project holds ship by manifest key, though nothing
 *      places them; one it lacks is not reported missing (the runtime's built-in copy draws it); a
 *      sheet in another project, or an un-named sheet packing the same region, does not ship, but
 *      does when a look names that region bare (the Salmons sheet never stands in for it); the
 *      same config with another generator ships none.
 *  12. A SALMONS PROJECT'S CHARACTER CLIPS (`engine-layout` `SALMONS_CHARACTER_CLIPS`): for such a
 *      config a project clip under one of Salmons' own prefixes is played, and its sheet ships,
 *      though no component names the prefix (the runtime plays it for a character whose component
 *      carries no `characterClips`); a clip of another name is not, and with another generator
 *      neither is.
 *  13. A CHARACTER SHEET'S CLIPS (`game-config` `characterSheet.ts`, character-pipeline §8): a clip
 *      named ONLY by a sheet in the game config is played and its art ships: one under the sheet's
 *      prefix, one under a variant's prefix, one an `anim` cell names by id. A clip of another
 *      name is not, and neither is any of them once the config has no sheet.
 *  14. A SHEET THE TOOL MADE, END TO END (character-pipeline §6 C2b): a Salmons project's config
 *      goes through Invisible Characters' own edits (`$lib/characters`: *Make this a sheet* on the
 *      `salmon` class, a prefix of its own, an added action on a room event, one facing's clip
 *      named in its cell) and the REAL `saveGameConfigDoc`. Then the REAL `publishGame` freezes a
 *      snapshot, and the REAL `bake-editor-doc.mjs` and `pull-project-assets.mjs` run against the
 *      real routes they call. In the snapshot and in the baked bundle: the sheet and the class's
 *      `sheet` exactly as saved, the added action's clip found by name and the cell's clip with
 *      their sheets and files, no clip of another name, and `onlineClassSheetOf` (what the runtime
 *      reads) giving the sheet with the added action. With the sheet cleared, neither clip ships.
 *      The saved entry is `scripts/playtest/fixtures/salmons-tool-sheet.json`, which
 *      `salmons-play.mjs --sheet` plays on a built runtime.
 *
 *  15. A CHARACTER SHEET'S RIGS AND STILL IMAGES (character-pipeline §8, step C6a): a rig named
 *      only by a sheet's rig source (its one rig, a rig of a facing, the rig a cell names) and a
 *      project sheet named only by a still cell ship; a rig and a sheet no sheet names do not, and
 *      the same config with no sheet ships neither.
 *  16. A RIG AND STILL IMAGES THE TOOL CHOSE, END TO END (character-pipeline §6 C6b): on a Salmons
 *      project's config the `salmon` class is given a rig source (its one rig, a rig of a facing,
 *      a cell's rig, a skin variant) and the `bear` class still images (*Fill from names* over a
 *      project sheet's frames), with Invisible Characters' edits alone, then saved, published,
 *      baked and pulled as §14 does. In the snapshot and in the baked bundle: both sheets and
 *      both classes' `sheet` exactly as saved, the three rigs' files and the stills' sheet
 *      (manifest and page), `characterArt` listing exactly them, and next to a publish of the
 *      same project before the edits nothing else new. A rig and a sheet no sheet names ship in
 *      neither. With both sheets cleared in the tool, the next publish ships none of it.
 *
 * Run:  pnpm --filter launcher-api check:art-scope
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, posix, sep } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isHttpError } from '@sveltejs/kit';

interface Stored {
	text: string;
	modified: number;
}
const bucket = new Map<string, Stored>();
/** Every key / prefix an R2 call was given since the last `load`. */
const touched: string[] = [];
const under = (prefix: string) =>
	[...bucket.entries()]
		.filter(([key]) => key.startsWith(prefix))
		.map(([key, o]) => ({ key, size: o.text.length, lastModified: o.modified }));
/** An object's ETag, of its bytes as R2's is: §14's save is the real conditional write. */
const etagOf = (o: Stored) => `"${createHash('md5').update(o.text).digest('hex')}"`;
// The whole r2 surface the scope and the art export touch is in memory; the reads record.
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
const realR2 = await import(r2Url);
mock.module(r2Url, {
	namedExports: {
		...realR2,
		getObjectText: async (key: string) => {
			touched.push(key);
			return bucket.get(key)?.text ?? null;
		},
		getObjectTextWithEtag: async (key: string) => {
			touched.push(key);
			const o = bucket.get(key);
			return o ? { text: o.text, etag: etagOf(o) } : null;
		},
		getObjectBytes: async (key: string) => {
			touched.push(key);
			const o = bucket.get(key);
			return o
				? { body: new TextEncoder().encode(o.text), contentType: 'application/json', etag: null }
				: null;
		},
		putObjectText: async (
			key: string,
			text: string,
			_contentType?: string,
			cond?: { ifMatch?: string; ifNoneMatch?: string },
		) => {
			const held = bucket.get(key);
			if (cond?.ifNoneMatch ? held : cond?.ifMatch && (!held || etagOf(held) !== cond.ifMatch))
				throw new realR2.ConflictError(key);
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
		listAllKeys: async (prefix: string) => {
			touched.push(prefix);
			return under(prefix).map((o) => o.key);
		},
		headObject: async (key: string) => {
			touched.push(key);
			const o = bucket.get(key);
			return o ? { etag: etagOf(o), size: o.text.length, lastModified: o.modified } : null;
		},
		objectExists: async (key: string) => {
			touched.push(key);
			return bucket.has(key);
		},
		listAllObjects: async (prefix: string) => {
			touched.push(prefix);
			return under(prefix);
		},
		listObjects: async (prefix: string) => {
			touched.push(prefix);
			return { keys: under(prefix).map((o) => o.key), prefixes: [] };
		},
		listFolder: async (prefix: string) => {
			touched.push(prefix);
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

// §14 runs the real publish and the real build routes. What they read of Postgres (the project's
// row, the game's row, the deploy token, the bug store) and the one call that leaves the process
// are stood in for here; R2 above is the only store.
const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const SHIP_PROJECT = 'sheet_ship';
const SHIP_TOKEN = 'art-scope-deploy-token';
const overriding = async (rel: string, namedExports: Record<string, unknown>) =>
	mock.module(src(rel), { namedExports: { ...(await import(src(rel))), ...namedExports } });
await overriding('lib/server/appSettings.ts', { getDeployToken: async () => SHIP_TOKEN });
await overriding('lib/server/projects.ts', {
	projectClientKey: async () => 'invisible_wall',
	projectName: async (key: string) => key,
	projectGameType: async () => 'arcade',
	getOrMintReadToken: async (key: string) => `read-${key}`,
	projectAllowsRead: async (_key: string, token: string) => token === SHIP_TOKEN,
});
const gameRows = new Map<string, string>();
await overriding('lib/server/games.ts', {
	gameExists: async (key: string) => gameRows.has(key),
	createGame: async (key: string, _name: string, url: string) => void gameRows.set(key, url),
	setGameUrl: async (key: string, url: string) => void gameRows.set(key, url),
	renameGame: async () => undefined,
	setGameProject: async () => undefined,
});
await overriding('lib/server/bugReportsStore.ts', { resolveFixedBugs: async () => [] });
await overriding('lib/server/testServerRefresh.ts', {
	postTestServerRefresh: async () => new Response(null, { status: 202 }),
});

const { artScopeAllows, borrowsClientArt, candidateAtlases, isProjectArtAllowed, pageAllowed } =
	await import('../src/lib/server/projectArtScope.ts');
const { loadRegionSet } = await import('../src/lib/server/editorRegions.ts');
const { exportEditorArt } = await import('../src/lib/server/editorArtExport.ts');
const { collectPlayedClipIds } = await import('../src/lib/server/clipReachability.ts');
const {
	clipDocKey,
	editorDocKey,
	gameConfigDocKey,
	projectComponentKey,
	projectComponentVersionKey,
	SUB,
} = await import('../src/lib/server/projectPaths.ts');

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (label: string, ok: boolean) => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`);
	if (!ok) failures += 1;
};

const SHARED_DEF_ATLAS = 'invisible_wall/test6/manifests/atlas_manifest_S_UI.json';
const PAGE = 'invisible_wall/test6/sheets/S_UI/S_UI.png';

console.log('1. only this client’s atlas manifests');
const kept = candidateAtlases(
	[
		SHARED_DEF_ATLAS,
		'other_client/game/manifests/atlas_manifest_S_UI.json',
		'invisible_wall/../other_client/manifests/atlas_manifest_S_UI.json',
		'invisible_wall/test6/editor/scenes.json',
		'invisible_wall/test6/config/config.json',
		'invisible_wall/test6/sheets/S_UI/S_UI.png',
		'invisible_wall/',
		'invisible_wall/test6/spines/star/',
		'invisible_wall/test6/deep/manifests/atlas_manifest_S_UI.json',
	],
	'Invisible_Wall',
);
check('a sibling project’s atlas manifest is kept', kept.includes(SHARED_DEF_ATLAS));
check('everything else is dropped', kept.length === 1);
check(
	'NOT the shared library, for a client whose name slugs to `_shared`',
	candidateAtlases(['_shared/sheets/manifests/atlas_manifest_S_Sym.json'], '_Shared').length === 0,
);

console.log('1b. an atlas page is trusted only in its manifest’s project, and only as an image');
check('the atlas’s own page', pageAllowed(SHARED_DEF_ATLAS, PAGE));
check(
	'NOT a page a planted manifest points at another project’s editor doc',
	!pageAllowed(
		'invisible_wall/attacker/manifests/atlas_manifest_x.json',
		'invisible_wall/victim/editor/scenes.json',
	),
);
check(
	'NOT an image page in another project',
	!pageAllowed('invisible_wall/attacker/manifests/atlas_manifest_x.json', PAGE),
);
check(
	'NOT a non-image file in the same project',
	!pageAllowed(SHARED_DEF_ATLAS, 'invisible_wall/test6/config/config.json'),
);
check('NOT a traversal', !pageAllowed(SHARED_DEF_ATLAS, 'invisible_wall/test6/../victim/a.png'));

console.log('2. who may borrow client art');
check('a named client’s project may', borrowsClientArt('Invisible_Wall', 'hw-3pots-sample'));
check('NOT the unassigned pseudo-client', !borrowsClientArt('unassigned', 'some-game'));
check('NOT the default project', !borrowsClientArt('Invisible_Wall', 'cloud'));

console.log('3. what the scope allows');
const scope = { keys: new Set([SHARED_DEF_ATLAS, PAGE]) };
check('the referenced atlas', artScopeAllows(scope, SHARED_DEF_ATLAS));
check('its page', artScopeAllows(scope, PAGE));
check(
	'NOT a file next to the page',
	!artScopeAllows(scope, 'invisible_wall/test6/sheets/S_UI/x.png'),
);
check(
	'NOT a traversal dressed as a scope key',
	!artScopeAllows(scope, 'invisible_wall/test6/sheets/S_UI/../../editor/scenes.json'),
);

console.log('4. both editor art gates use the project art scope');
for (const route of ['regions', 'asset']) {
	const src = readFileSync(join(here, `../src/routes/api/editor/${route}/+server.ts`), 'utf8');
	check(
		`/api/editor/${route} gates through assertProjectArt`,
		/await assertProjectArt\(/.test(src),
	);
	check(
		`/api/editor/${route} no longer gates on the bare prefixes`,
		!/\bassertAllowed\(/.test(src),
	);
}

console.log('5. a manifest’s own fields read R2 only inside the manifest’s project');
const T0 = 1_700_000_000_000;
const put = (key: string, body: unknown, modified = T0) =>
	bucket.set(key, { text: typeof body === 'string' ? body : JSON.stringify(body), modified });
const REGIONS = [{ name: 'a', x: 0, y: 0, w: 8, h: 8 }];
const load = (manifestKey: string) => {
	touched.length = 0;
	return loadRegionSet(manifestKey);
};
const stayedIn = (home: string) => touched.every((key) => key.startsWith(home));

put('invisible_wall/victim/secret.png', 'x');
put('invisible_wall/victim/tp.json', {
	frames: { a: { frame: { x: 99, y: 99, w: 8, h: 8 } } },
	meta: { size: { w: 128, h: 128 } },
});
put('invisible_wall/victim/deploy/sprites/planted.webp', 'x');

const PLANTED = 'invisible_wall/attacker/manifests/atlas_manifest_planted.json';
put('invisible_wall/attacker/deploy/sprites/planted.webp', 'x');
put(
	PLANTED,
	{
		atlas: {
			source_image_path: 'invisible_wall/victim/secret.png',
			source_image: 'secret.png',
			texturepacker_json: 'invisible_wall/victim/tp.json',
		},
		export_prefix: 'invisible_wall/victim',
		regions: REGIONS,
	},
	T0 + 60_000,
);
let set = await load(PLANTED);
check(
	'L1 a planted `source_image_path` / `export_prefix` probes nothing outside its project',
	stayedIn('invisible_wall/attacker/'),
);
check(
	'L1 … not even the stale-deploy HEAD of its `source_image_path`',
	!touched.includes('invisible_wall/victim/secret.png'),
);
check(
	'L1 … so its page is its OWN deploy, whatever the foreign key holds',
	set.pageKey === 'invisible_wall/attacker/deploy/sprites/planted.webp',
);
check(
	'L2 a foreign `texturepacker_json` is never read',
	!touched.includes('invisible_wall/victim/tp.json'),
);
check('L2 … and its rects never land', set.regions[0]?.x === 0);
bucket.delete('invisible_wall/attacker/deploy/sprites/planted.webp');
set = await load(PLANTED);
check('L1 with no deploy of its own it resolves no page at all', set.pageKey === '');
check('L1 … still without leaving its project', stayedIn('invisible_wall/attacker/'));

const OWN = 'invisible_wall/test6/manifests/atlas_manifest_S_Own.json';
put('invisible_wall/test6/sheets/S_Own/S_Own.png', 'x');
put('invisible_wall/test6/sheets/S_Own/tp.json', {
	frames: { a: { frame: { x: 4, y: 4, w: 8, h: 8 } } },
	meta: { size: { w: 64, h: 64 } },
});
put(OWN, {
	atlas: {
		source_image_path: 'invisible_wall/test6/sheets/S_Own/S_Own.png',
		texturepacker_json: 'invisible_wall/test6/sheets/S_Own/tp.json',
	},
	regions: REGIONS,
});
set = await load(OWN);
check(
	'an own-project `source_image_path` still resolves',
	set.pageKey === 'invisible_wall/test6/sheets/S_Own/S_Own.png',
);
check('an own-project `texturepacker_json` still reconciles the rects', set.regions[0]?.x === 4);

const BORROWED = 'invisible_wall/test6/manifests/atlas_manifest_S_UI.json';
put(BORROWED, { atlas: { source_image: 'C:\\art\\S_UI.png' }, regions: REGIONS });
put('invisible_wall/test6/deploy/sprites/S_UI.webp', 'x');
put('invisible_wall/game/deploy/sprites/S_UI.webp', 'x', T0 + 120_000);
set = await load(BORROWED);
check(
	'L3 a borrowed legacy manifest shows ITS project’s deployed page, not the caller’s',
	set.pageKey === 'invisible_wall/test6/deploy/sprites/S_UI.webp',
);
bucket.delete('invisible_wall/test6/deploy/sprites/S_UI.webp');
put('invisible_wall/test6/atlas/S_UI.png', 'x');
set = await load(BORROWED);
check(
	'L3 … and, undeployed, its project’s atlas output',
	set.pageKey === 'invisible_wall/test6/atlas/S_UI.png',
);
check('L3 … never looking in the caller’s project', stayedIn('invisible_wall/test6/'));

const SHARED = '_shared/sheets/S_Sym/atlas_manifest_S_Sym.json';
put(SHARED, { atlas: { source_image: 'S_Sym.webp' }, regions: REGIONS });
put('_shared/sheets/S_Sym/S_Sym.webp', 'x');
set = await load(SHARED);
check(
	'a shared-library sheet resolves its page beside its manifest',
	set.pageKey === '_shared/sheets/S_Sym/S_Sym.webp',
);
check('… without listing any project’s deploy/', stayedIn('_shared/sheets/'));

console.log('6. art picked only in a per-ratio instance override is in the scope and ships');
const CLIENT = 'invisible_wall';
const PROJECT = 'ratio_art';
const sheet = (stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, PROJECT)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, PROJECT)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const LANDSCAPE_SHEET = sheet('S_Land', 'faceLand');
const PORTRAIT_SHEET = sheet('S_Port', 'facePort');
const LEGACY_SHEET = sheet('S_Legacy', 'faceLegacy');
const PINNED_SHEET = sheet('S_Pinned', 'facePinned');
const RIG = 'portraitRig';
const rigFolder = `${SUB.spines(CLIENT, PROJECT)}/${RIG}`;
put(`${SUB.spines(CLIENT, PROJECT)}/skeletons.json`, {
	skeletons: [{ folder: RIG, name: RIG, atlas_file: `${RIG}.atlas`, skeleton_file: `${RIG}.json` }],
});
put(`${rigFolder}/${RIG}.atlas`, `${RIG}.webp\nsize: 8,8\nbone\n  bounds: 0,0,8,8\n`);
put(`${rigFolder}/${RIG}.json`, { skeleton: { spine: '4.2' } });
put(`${rigFolder}/${RIG}.webp`, 'x');
const def = (id: string, version: number, params: { key: string; kind: string }[]) => ({
	id,
	name: id,
	version,
	scope: 'project',
	category: 'ui',
	params,
	root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
});
put(
	projectComponentKey(PROJECT, 'ratioFace'),
	def('ratioFace', 1, [
		{ key: 'faceImage', kind: 'image' },
		{ key: 'introSpine', kind: 'spine' },
	]),
);
// The instance below is pinned to v1, whose image param v2 renamed: it renders v1, so v1's kinds
// decide what its params reference.
put(
	projectComponentVersionKey(PROJECT, 'pinnedFace', 1),
	def('pinnedFace', 1, [{ key: 'faceImage', kind: 'image' }]),
);
put(
	projectComponentKey(PROJECT, 'pinnedFace'),
	def('pinnedFace', 2, [{ key: 'face', kind: 'image' }]),
);
put(editorDocKey(CLIENT, PROJECT), {
	scenes: [
		{
			id: 'base',
			name: 'Base',
			nodes: [
				{
					id: 'face',
					kind: 'componentInstance',
					componentId: 'ratioFace',
					x: 0,
					y: 0,
					params: { faceImage: `${LANDSCAPE_SHEET}::faceLand` },
					overrides: {
						portrait: {
							params: { faceImage: `${PORTRAIT_SHEET}::facePort`, introSpine: RIG },
						},
						// A patch with no params, and one holding a legacy bare-basename ref that only
						// the ship path's repair can pin (and a non-string, which names nothing).
						landscape: { x: 5 },
						desktop: { params: { faceImage: 'atlas_manifest_S_Legacy.json::faceLegacy' } },
						tablet: { params: { introSpine: 0 } },
					},
				},
				{
					id: 'pinned',
					kind: 'componentInstance',
					componentId: 'pinnedFace',
					componentVersion: 1,
					x: 0,
					y: 0,
					overrides: { portrait: { params: { faceImage: `${PINNED_SHEET}::facePinned` } } },
				},
			],
		},
	],
});

const inScope = (key: string) => isProjectArtAllowed(key, [], CLIENT, PROJECT);
check('the base-params sheet is in the art scope', await inScope(LANDSCAPE_SHEET));
check('the sheet picked only in the portrait override is too', await inScope(PORTRAIT_SHEET));
check('… a legacy ref in an override is repaired and pins its sheet', await inScope(LEGACY_SHEET));
check('… a pinned instance’s override is read by its pinned def', await inScope(PINNED_SHEET));

const index = await exportEditorArt(CLIENT, PROJECT);
const deployPrefix = `${SUB.deploy(CLIENT, PROJECT)}/`;
const artPrefix = `${deployPrefix}editor-art/`;
const ships = (key: string) => index.sheets.find((s) => s.key === key);
check('the base-params sheet ships', !!ships(LANDSCAPE_SHEET));
const shippedSheet = ships(PORTRAIT_SHEET);
check('the portrait-only sheet is in the shipped index', !!shippedSheet);
check(
	'… and its spritesheet is written under deploy/editor-art/',
	!!shippedSheet && bucket.has(`${deployPrefix}${shippedSheet.json}`),
);
check(
	'… and its scoped frame counts as covered, not dangling',
	!index.missing.includes('facePort'),
);
check('the pinned instance’s portrait-only sheet ships', !!ships(PINNED_SHEET));
check(
	'the rig bundle picked only in the portrait override ships under its name',
	index.spines.some((s) => s.key === RIG),
);
check(
	'… its skeleton copied under deploy/editor-art/',
	under(artPrefix).some((o) => o.key.endsWith(`/${RIG}.json`)),
);

console.log('7. a component only a spawn layer lists is in the scope and ships');
const SPAWN_PROJECT = 'spawn_art';
const spawnSheet = (stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, SPAWN_PROJECT)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, SPAWN_PROJECT)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const COIN_SHEET = spawnSheet('S_Coin', 'coinFace');
const SPARK_SHEET = spawnSheet('S_Spark', 'sparkFrame');
put(projectComponentKey(SPAWN_PROJECT, 'spawnCoin'), {
	...def('spawnCoin', 1, []),
	params: [{ key: 'face', kind: 'image', default: `${COIN_SHEET}::coinFace` }],
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [{ id: 'spark', kind: 'componentInstance', componentId: 'spawnSpark', x: 0, y: 0 }],
	},
});
put(projectComponentKey(SPAWN_PROJECT, 'spawnSpark'), {
	...def('spawnSpark', 1, []),
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [{ id: 'f', kind: 'sprite', x: 0, y: 0, region: `${SPARK_SHEET}::sparkFrame` }],
	},
});
put(editorDocKey(CLIENT, SPAWN_PROJECT), {
	scenes: [
		{
			id: 'field',
			name: 'Field',
			nodes: [
				{
					id: 'layer',
					kind: 'spawnLayer',
					x: 0,
					y: 0,
					spawnable: ['spawnCoin'],
					placement: 'free',
					cap: 8,
				},
			],
		},
	],
});
const spawnScope = (key: string) => isProjectArtAllowed(key, [], CLIENT, SPAWN_PROJECT);
check('the spawnable’s default-art sheet is in the art scope', await spawnScope(COIN_SHEET));
check('… and the sheet of a def it nests', await spawnScope(SPARK_SHEET));
const spawnIndex = await exportEditorArt(CLIENT, SPAWN_PROJECT);
const spawnDeploy = `${SUB.deploy(CLIENT, SPAWN_PROJECT)}/`;
const shippedCoin = spawnIndex.sheets.find((s) => s.key === COIN_SHEET);
check('the spawnable’s sheet ships', !!shippedCoin);
check(
	'… its spritesheet written under deploy/editor-art/',
	!!shippedCoin && bucket.has(`${spawnDeploy}${shippedCoin.json}`),
);
check(
	'the nested def’s sheet ships',
	spawnIndex.sheets.some((s) => s.key === SPARK_SHEET),
);
check(
	'… and neither frame counts as dangling',
	!spawnIndex.missing.includes('coinFace') && !spawnIndex.missing.includes('sparkFrame'),
);

console.log('8. a component only a character names ships');
const CHAR_PROJECT = 'character_art';
const charSheet = (stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, CHAR_PROJECT)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, CHAR_PROJECT)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const HERO_SHEET = charSheet('S_Hero', 'heroFrame');
const SHOT_SHEET = charSheet('S_Shot', 'shotFrame');
const spriteDef = (id: string, region: string) => ({
	...def(id, 1, []),
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [{ id: 'f', kind: 'sprite', x: 0, y: 0, region }],
	},
});
put(
	projectComponentKey(CHAR_PROJECT, 'charHero'),
	spriteDef('charHero', `${HERO_SHEET}::heroFrame`),
);
put(
	projectComponentKey(CHAR_PROJECT, 'charShot'),
	spriteDef('charShot', `${SHOT_SHEET}::shotFrame`),
);
put(editorDocKey(CLIENT, CHAR_PROJECT), { scenes: [{ id: 'field', name: 'Field', nodes: [] }] });
const ARCADE_CONFIG = { family: 'arcade', outcome: 'rules', gameName: 'Characters' };
put(gameConfigDocKey(CLIENT, CHAR_PROJECT), {
	...ARCADE_CONFIG,
	arcade: {
		characters: [
			{ id: 'hero', component: 'charHero', controller: { kind: 'topDown', speed: 200 } },
			{
				id: 'turret',
				component: 'charTurret',
				brain: {
					initial: 'fire',
					states: [
						{
							id: 'fire',
							behaviour: 'shootAt',
							params: { component: 'charShot', layer: 'shots' },
						},
					],
					transitions: [],
				},
			},
		],
	},
});
const charIndex = await exportEditorArt(CLIENT, CHAR_PROJECT);
const charDeploy = `${SUB.deploy(CLIENT, CHAR_PROJECT)}/`;
const shippedHero = charIndex.sheets.find((s) => s.key === HERO_SHEET);
check('a character’s look ships its sheet', !!shippedHero);
check(
	'… its spritesheet written under deploy/editor-art/',
	!!shippedHero && bucket.has(`${charDeploy}${shippedHero.json}`),
);
check(
	'a shootAt projectile ships its sheet',
	charIndex.sheets.some((s) => s.key === SHOT_SHEET),
);
check(
	'… and neither frame counts as dangling',
	!charIndex.missing.includes('heroFrame') && !charIndex.missing.includes('shotFrame'),
);
put(gameConfigDocKey(CLIENT, CHAR_PROJECT), ARCADE_CONFIG);
const bareIndex = await exportEditorArt(CLIENT, CHAR_PROJECT);
check(
	'without characters neither ships',
	!bareIndex.sheets.some((s) => s.key === HERO_SHEET || s.key === SHOT_SHEET),
);

console.log('9. a tilemap’s tileset regions ship');
const TILE_PROJECT = 'tilemap_art';
const tileSheet = (stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, TILE_PROJECT)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, TILE_PROJECT)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const GROUND_SHEET = tileSheet('S_Ground', 'groundTile');
const LEDGE_SHEET = tileSheet('S_Ledge', 'ledgeTile');
const SPARE_SHEET = tileSheet('S_Spare', 'spareTile');
put(editorDocKey(CLIENT, TILE_PROJECT), {
	scenes: [
		{
			id: 'field',
			name: 'Field',
			nodes: [
				{
					id: 'level',
					kind: 'tilemap',
					x: 0,
					y: 0,
					tileWidth: 64,
					tileHeight: 64,
					cols: 3,
					rows: 1,
					tiles: [0, 1, 0],
					tileset: [
						{ region: `${GROUND_SHEET}::groundTile`, collide: 'solid' },
						{ region: `${LEDGE_SHEET}::ledgeTile`, collide: 'oneWay' },
						{ region: `${SPARE_SHEET}::spareTile` },
					],
				},
			],
		},
	],
});
const tileScope = (key: string) => isProjectArtAllowed(key, [], CLIENT, TILE_PROJECT);
check('a painted tile’s sheet is in the art scope', await tileScope(GROUND_SHEET));
const tileIndex = await exportEditorArt(CLIENT, TILE_PROJECT);
const tileDeploy = `${SUB.deploy(CLIENT, TILE_PROJECT)}/`;
const shippedGround = tileIndex.sheets.find((s) => s.key === GROUND_SHEET);
check('a painted tile’s sheet ships', !!shippedGround);
check(
	'… its spritesheet written under deploy/editor-art/',
	!!shippedGround && bucket.has(`${tileDeploy}${shippedGround.json}`),
);
check(
	'every painted entry ships (the one-way ledge too)',
	tileIndex.sheets.some((s) => s.key === LEDGE_SHEET),
);
check(
	'a tileset entry no tile uses does not',
	!tileIndex.sheets.some((s) => s.key === SPARE_SHEET),
);
check(
	'… and no painted frame counts as dangling',
	!tileIndex.missing.includes('groundTile') && !tileIndex.missing.includes('ledgeTile'),
);

console.log('10. a card frame and art named only in the card library ship');
const CARD_PROJECT = 'card_art';
const cardSheet = (stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, CARD_PROJECT)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, CARD_PROJECT)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const FRAME_SHEET = cardSheet('S_Frame', 'frameBorder');
const ART_SHEET = cardSheet('S_CardArt', 'impArt');
put(projectComponentKey(CARD_PROJECT, 'unitFrame'), {
	...spriteDef('unitFrame', `${FRAME_SHEET}::frameBorder`),
	params: [{ key: 'art', kind: 'image' }],
});
put(editorDocKey(CLIENT, CARD_PROJECT), { scenes: [{ id: 'table', name: 'Table', nodes: [] }] });
const CARD_CONFIG = { family: 'card', outcome: 'rules', gameName: 'Cards' };
put(gameConfigDocKey(CLIENT, CARD_PROJECT), {
	...CARD_CONFIG,
	card: {
		library: [
			{
				id: 'imp',
				name: 'Imp',
				type: 'unit',
				cost: 1,
				attack: 1,
				health: 1,
				frame: 'unitFrame',
				params: { art: `${ART_SHEET}::impArt` },
			},
		],
	},
});
const cardIndex = await exportEditorArt(CLIENT, CARD_PROJECT);
const cardDeploy = `${SUB.deploy(CLIENT, CARD_PROJECT)}/`;
const shippedFrame = cardIndex.sheets.find((s) => s.key === FRAME_SHEET);
check('a card frame named only by a card ships its sheet', !!shippedFrame);
check(
	'… its spritesheet written under deploy/editor-art/',
	!!shippedFrame && bucket.has(`${cardDeploy}${shippedFrame.json}`),
);
check(
	'a card’s art named only in its params ships',
	cardIndex.sheets.some((s) => s.key === ART_SHEET),
);
check('… and its frame does not count as dangling', !cardIndex.missing.includes('impArt'));
put(gameConfigDocKey(CLIENT, CARD_PROJECT), CARD_CONFIG);
const noCards = await exportEditorArt(CLIENT, CARD_PROJECT);
check(
	'without cards neither ships',
	!noCards.sheets.some((s) => s.key === FRAME_SHEET || s.key === ART_SHEET),
);

console.log('11. Salmons’ art ships as project sheets for a Salmons generator');
const SALMONS_PROJECT = 'salmons_art';
const salmonsSheet = (project: string, stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, project)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, project)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const PROPS_SHEET = salmonsSheet(SALMONS_PROJECT, 'salmons_props', 'rock_0');
const CHARS_SHEET = salmonsSheet(SALMONS_PROJECT, 'salmons_characters', 'bear');
const LOOKALIKE_SHEET = salmonsSheet(SALMONS_PROJECT, 'S_Lookalike', 'bear');
const ELSEWHERE_SHEET = salmonsSheet('salmons_other', 'salmons_terrain', 'grass_c');
put(editorDocKey(CLIENT, SALMONS_PROJECT), { scenes: [{ id: 'field', name: 'Field', nodes: [] }] });
const SALMONS_CONFIG = (generator: string) => ({
	...ARCADE_CONFIG,
	arcade: { online: { generator } },
});
put(gameConfigDocKey(CLIENT, SALMONS_PROJECT), SALMONS_CONFIG('salmonsMap'));
const salmonsIndex = await exportEditorArt(CLIENT, SALMONS_PROJECT);
const salmonsDeploy = `${SUB.deploy(CLIENT, SALMONS_PROJECT)}/`;
const shippedProps = salmonsIndex.sheets.find((s) => s.key === PROPS_SHEET);
check('a Salmons project sheet ships though nothing places it', !!shippedProps);
check(
	'… its spritesheet written under deploy/editor-art/',
	!!shippedProps && bucket.has(`${salmonsDeploy}${shippedProps.json}`),
);
check(
	'every Salmons sheet the project holds ships',
	salmonsIndex.sheets.some((s) => s.key === CHARS_SHEET),
);
check(
	'a sheet it lacks is not reported missing',
	!salmonsIndex.missing.some((n) => ['grass_c', 'waterfall_face'].includes(n)),
);
check(
	'another sheet packing a Salmons region name does not ship',
	!salmonsIndex.sheets.some((s) => s.key === LOOKALIKE_SHEET),
);
check(
	'another project’s Salmons sheet does not ship',
	!salmonsIndex.sheets.some((s) => s.key === ELSEWHERE_SHEET),
);
// A character's look names `bear` bare (an image param), meaning the look-alike sheet: the Salmons sheet that also
// packs `bear` must not stand in for it.
put(projectComponentKey(SALMONS_PROJECT, 'bareBear'), {
	...spriteDef('bareBear', ''),
	params: [{ key: 'art', kind: 'image', default: 'bear' }],
});
put(gameConfigDocKey(CLIENT, SALMONS_PROJECT), {
	...SALMONS_CONFIG('salmonsMap'),
	arcade: {
		online: { generator: 'salmonsMap' },
		characters: [{ id: 'bear', component: 'bareBear' }],
	},
});
const bareIndex2 = await exportEditorArt(CLIENT, SALMONS_PROJECT);
check(
	'a bare region a look names ships the sheet the bare-name search finds, not a Salmons sheet',
	bareIndex2.sheets.some((s) => s.key === LOOKALIKE_SHEET) &&
		bareIndex2.sheets.some((s) => s.key === CHARS_SHEET),
);
put(gameConfigDocKey(CLIENT, SALMONS_PROJECT), SALMONS_CONFIG('otherGenerator'));
const notSalmons = await exportEditorArt(CLIENT, SALMONS_PROJECT);
check(
	'another generator ships none',
	!notSalmons.sheets.some((s) => s.key === PROPS_SHEET || s.key === CHARS_SHEET),
);

console.log('12. a Salmons project’s character clips ship though no component names them');
const clipOn = (id: string, sheet: string, frames: string[]) =>
	put(clipDocKey(CLIENT, SALMONS_PROJECT, id), { id, name: id, assetKey: sheet, frames });
const WALK_SHEET = salmonsSheet(SALMONS_PROJECT, 'S_BearWalk', 'bear_walk_e_00');
const SPIN_SHEET = salmonsSheet(SALMONS_PROJECT, 'S_RockSpin', 'rock_spin_00');
clipOn('bear_walk_e', WALK_SHEET, ['bear_walk_e_00']);
clipOn('rock_spin', SPIN_SHEET, ['rock_spin_00']);
put(gameConfigDocKey(CLIENT, SALMONS_PROJECT), SALMONS_CONFIG('salmonsMap'));
const playedClips = await collectPlayedClipIds(CLIENT, SALMONS_PROJECT);
check(
	'the clip under a Salmons prefix is played, the other is not',
	!!playedClips && playedClips.has('bear_walk_e') && !playedClips.has('rock_spin'),
);
const clipsIndex = await exportEditorArt(CLIENT, SALMONS_PROJECT);
check(
	'… and its sheet ships, the unplayed clip’s does not',
	clipsIndex.sheets.some((s) => s.key === WALK_SHEET) &&
		!clipsIndex.sheets.some((s) => s.key === SPIN_SHEET),
);
put(gameConfigDocKey(CLIENT, SALMONS_PROJECT), SALMONS_CONFIG('otherGenerator'));
const playedElsewhere = await collectPlayedClipIds(CLIENT, SALMONS_PROJECT);
check(
	'with another generator the same clip is not played',
	!!playedElsewhere && !playedElsewhere.has('bear_walk_e'),
);

console.log('13. a clip named only by a character sheet ships');
const SHEET_PROJECT = 'sheet_art';
const sheetClip = (id: string, stem: string) => {
	const manifest = salmonsSheet(SHEET_PROJECT, stem, `${id}_00`);
	put(clipDocKey(CLIENT, SHEET_PROJECT, id), {
		id,
		name: id,
		assetKey: manifest,
		frames: [`${id}_00`],
	});
	return manifest;
};
const BY_PREFIX = sheetClip('otter_walk_se', 'S_OtterWalk');
const BY_VARIANT = sheetClip('otter_gold_walk_se', 'S_OtterGold');
const BY_CELL = sheetClip('grab_side', 'S_Grab');
const UNNAMED = sheetClip('heron_walk_se', 'S_Heron');
put(editorDocKey(CLIENT, SHEET_PROJECT), { scenes: [{ id: 'field', name: 'Field', nodes: [] }] });
const SHEET_CONFIG = (sheet: object) => ({
	...ARCADE_CONFIG,
	arcade: { characters: [{ id: 'otter', component: 'otterLook', ...sheet }] },
});
put(
	gameConfigDocKey(CLIENT, SHEET_PROJECT),
	SHEET_CONFIG({
		source: { kind: 'clips', prefix: 'otter', variants: { marked: 'otter_gold' } },
		draw: { width: 64 },
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'grab', when: { event: 'caught' }, anim: { e: { clip: 'grab_side' } } },
		],
	}),
);
const sheetPlayed = await collectPlayedClipIds(CLIENT, SHEET_PROJECT);
check('the clip under the sheet’s prefix is played', !!sheetPlayed?.has('otter_walk_se'));
check('… and the one under a variant’s prefix', !!sheetPlayed?.has('otter_gold_walk_se'));
check('… and the one an anim cell names', !!sheetPlayed?.has('grab_side'));
check('a clip no sheet names is not', !!sheetPlayed && !sheetPlayed.has('heron_walk_se'));
const sheetIndex = await exportEditorArt(CLIENT, SHEET_PROJECT);
check(
	'their three sheets ship, the unnamed clip’s does not',
	[BY_PREFIX, BY_VARIANT, BY_CELL].every((key) => sheetIndex.sheets.some((s) => s.key === key)) &&
		!sheetIndex.sheets.some((s) => s.key === UNNAMED),
);
put(gameConfigDocKey(CLIENT, SHEET_PROJECT), SHEET_CONFIG({}));
touched.length = 0;
const noSheetPlayed = await collectPlayedClipIds(CLIENT, SHEET_PROJECT);
check('the same config with no sheet plays none of them', !!noSheetPlayed && !noSheetPlayed.size);
check('… and does not list the project’s clips', !touched.some((key) => key.includes('/clips')));

console.log('14. a sheet the tool’s own edits made ships: saved, published, baked and pulled');
const { addAction, addTrigger, actionClipsByName, setActionAnim } =
	await import('../src/lib/characters/characterSheetActions.ts');
const { clearSheet, findClass, makeClassSheet, setSourcePrefix, sheetOf } =
	await import('../src/lib/characters/characterSheetEdit.ts');
const { loadGameConfigDocWithEtag, saveGameConfigDoc } =
	await import('../src/lib/server/gameConfigStorage.ts');
const { publishGame } = await import('../src/lib/server/publishGame.ts');
const { currentPointer, readSnapshotBundle, snapshotDeployKey } =
	await import('../src/lib/server/publishedRuntime.ts');
const { onlineClassSheetOf } = await import('game-config');
const { salmonsBeforeItsBotSalmon } = await import('./charactersTool/salmonsBefore.ts');
const { SALMONS_CHARACTER_COMPONENTS } =
	await import('../../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts');

type ShipConfig = {
	arcade?: {
		characters?: { id: string }[];
		online?: { characters?: { id: string; sheet?: string }[] };
	};
};
type Shipped = {
	config?: ShipConfig;
	componentDefs?: Record<string, unknown>;
	flipbooks?: { id: string }[];
	editorArt: { sheets: { key: string; json: string }[] };
};
const same = (a: unknown, b: unknown) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);
const SHIP_CLASS = 'salmon';
const SHIP_PREFIX = 'salmon_sheet';
const SHIP_ACTION = 'flop';
const shipClip = (id: string, stem: string) => {
	const manifest = salmonsSheet(SHIP_PROJECT, stem, `${id}_00`);
	put(clipDocKey(CLIENT, SHIP_PROJECT, id), {
		id,
		name: id,
		assetKey: manifest,
		frames: [`${id}_00`],
	});
	return manifest;
};
// A Salmons project as its export uploaded it before its bot salmon (no config character draws the
// salmon's look yet, so the tool makes one): the three looks with their `characterClips`, the
// config, a clip of the salmon's own, and an arcade runtime to be played on.
for (const look of SALMONS_CHARACTER_COMPONENTS)
	put(projectComponentKey(SHIP_PROJECT, look.id), look);
put(editorDocKey(CLIENT, SHIP_PROJECT), { scenes: [{ id: 'field', name: 'Field', nodes: [] }] });
put('test_server/_runtime/arcade/current.json', { version: 1 });
const OWN_CLIP = shipClip('salmon_pink_swim_se', 'S_PinkSwim');
await saveGameConfigDoc(CLIENT, SHIP_PROJECT, salmonsBeforeItsBotSalmon());

// The page: the stored config, *Make this a sheet* on the class with the block it plays today, a
// prefix of its own, a new action on a room event, and one facing's clip named in its cell.
const opened = await loadGameConfigDocWithEtag(CLIENT, SHIP_PROJECT);
const page = JSON.parse(JSON.stringify(opened.doc)) as NonNullable<typeof opened.doc>;
const playedBlock = SALMONS_CHARACTER_COMPONENTS.find(
	(look) => look.id === findClass(page, SHIP_CLASS)?.body,
)?.characterClips;
const made = makeClassSheet(page, SHIP_CLASS, playedBlock ?? { prefixes: { base: '' } });
const sheetId = made.characterId ?? '';
const edits = [
	made.refused,
	setSourcePrefix(page, sheetId, SHIP_PREFIX),
	addAction(page, sheetId, SHIP_ACTION).refused,
	addTrigger(page, sheetId, SHIP_ACTION, { event: 'grounded' }),
	setActionAnim(page, sheetId, SHIP_ACTION, 'ne', 'sandbank_flop'),
];
check(
	'every edit is accepted, on a new character for the class’s look',
	!!playedBlock && made.created === true && edits.every((refused) => refused === null),
);
// The artist's part: the new action's clip under the name the sheet finds it by, the clip its
// cell names, and a clip of another character's.
const SHIP_NAMED = shipClip(`${SHIP_PREFIX}_${SHIP_ACTION}_se`, 'S_SalmonFlop');
const SHIP_CELL = shipClip('sandbank_flop', 'S_SandbankFlop');
const SHIP_OTHER = shipClip('heron_walk_se', 'S_HeronWalk');
check(
	'the clip made for the new action is the one the tool finds by name',
	same(
		actionClipsByName(sheetOf(page, sheetId), SHIP_ACTION, [
			`${SHIP_PREFIX}_${SHIP_ACTION}_se`,
			'sandbank_flop',
			'heron_walk_se',
		]),
		[`${SHIP_PREFIX}_${SHIP_ACTION}_se`],
	),
);

const entryOf = (config: ShipConfig | null | undefined) =>
	config?.arcade?.characters?.find((c) => c.id === sheetId);
const classSheetOf = (config: ShipConfig | null | undefined) =>
	config?.arcade?.online?.characters?.find((c) => c.id === SHIP_CLASS)?.sheet;
await saveGameConfigDoc(CLIENT, SHIP_PROJECT, page, opened.etag);
const storedConfig = JSON.parse(
	bucket.get(gameConfigDocKey(CLIENT, SHIP_PROJECT))?.text ?? 'null',
) as ShipConfig | null;
const savedEntry = entryOf(storedConfig);
check(
	'the save stores the sheet as the page holds it, and the class names it',
	same(savedEntry, entryOf(page)) && classSheetOf(storedConfig) === sheetId,
);
// The Salmons playtest plays this very entry on a built runtime (`salmons-play.mjs --sheet`).
const TOOL_SHEET = fileURLToPath(
	new URL('../../../scripts/playtest/fixtures/salmons-tool-sheet.json', import.meta.url),
);
const toolSheet = { class: SHIP_CLASS, character: savedEntry };
if (process.argv.includes('--record-tool-sheet'))
	writeFileSync(TOOL_SHEET, `${JSON.stringify(toolSheet, null, '\t')}\n`);
check(
	'it is the sheet the Salmons playtest plays (re-record: --record-tool-sheet)',
	same(toolSheet, JSON.parse(readFileSync(TOOL_SHEET, 'utf8'))),
);

/** What a shipped bundle carries of the sheet: the config's entry and class, and the clips. */
const carries = (shipped: Shipped | null | undefined) => {
	const clips = new Set(shipped?.flipbooks?.map((clip) => clip.id));
	const sheets = new Set(shipped?.editorArt.sheets.map((s) => s.key));
	const read = onlineClassSheetOf(shipped?.config, SHIP_CLASS);
	const action = read?.sheet.actions?.find((a) => a.id === SHIP_ACTION);
	return {
		config: same(entryOf(shipped?.config), savedEntry) && classSheetOf(shipped?.config) === sheetId,
		look: !!shipped?.componentDefs?.[findClass(page, SHIP_CLASS)?.body ?? ''],
		named: clips.has(`${SHIP_PREFIX}_${SHIP_ACTION}_se`) && sheets.has(SHIP_NAMED),
		cell: clips.has('sandbank_flop') && sheets.has(SHIP_CELL),
		own: clips.has('salmon_pink_swim_se') && sheets.has(OWN_CLIP),
		other: clips.has('heron_walk_se') || sheets.has(SHIP_OTHER),
		resolved:
			read?.id === sheetId &&
			read.sheet.source?.prefix === SHIP_PREFIX &&
			same(action?.when, { event: 'grounded' }) &&
			action?.anim?.ne?.clip === 'sandbank_flop',
	};
};
/** The deploy files of a shipped clip and of its sheet, as a bundle names them. */
const shipFiles = (shipped: Shipped | null | undefined, clipId: string, sheetKey: string) => [
	`clips/${clipId}.json`,
	shipped?.editorArt.sheets.find((s) => s.key === sheetKey)?.json ?? `editor-art/missing/${clipId}`,
];

const published = await publishGame(SHIP_PROJECT, 'https://app.invisiblewall.org');
const snapshotId = published.snapshot.id;
const live = (await readSnapshotBundle(CLIENT, SHIP_PROJECT, snapshotId)) as Shipped | null;
const liveHas = carries(live);
const frozen = (rel: string) =>
	bucket.has(snapshotDeployKey(CLIENT, SHIP_PROJECT, snapshotId, rel));
check(
	'Publish makes the snapshot players boot',
	(await currentPointer(CLIENT, SHIP_PROJECT))?.current === snapshotId &&
		!!gameRows.get(SHIP_PROJECT)?.includes(`project=${SHIP_PROJECT}`),
);
check('… its config carries the sheet and the class’s `sheet` exactly as saved', liveHas.config);
check('… with the look the class and its sheet are drawn as, which no scene places', liveHas.look);
check('… the added action’s clip, found by name, is registered with its sheet', liveHas.named);
check('… and the clip only an anim cell names', liveHas.cell);
check('… beside the salmon’s own clip, and no clip of another name', liveHas.own && !liveHas.other);
check(
	'… the snapshot holds both clips’ files and their sheets’, not the other clip’s',
	[
		...shipFiles(live, `${SHIP_PREFIX}_${SHIP_ACTION}_se`, SHIP_NAMED),
		...shipFiles(live, 'sandbank_flop', SHIP_CELL),
	].every(frozen) && !frozen('clips/heron_walk_se.json'),
);
check(
	'… and the runtime’s reader gives the class its sheet with the added action',
	liveHas.resolved,
);

// A desktop build: the REAL `bake-editor-doc.mjs` and `pull-project-assets.mjs`, each its own
// process, against the real routes they call, which this process serves over HTTP. Run from
// `apps/lines`, as an engine app's build is, so both write only where `--dest` says. The bake's
// publish checks are lifted (`--publish-anyway`): their route takes a desktop launcher login.
type Route = Record<
	string,
	(event: { url: URL; params: Record<string, string> }) => Promise<Response>
>;
const routeOf = async (rel: string) => (await import(src(`routes/api/${rel}/+server.ts`))) as Route;
const ROUTES: Record<string, Route> = {
	'/api/editor/doc': await routeOf('editor/doc'),
	'/api/editor/export': await routeOf('editor/export/[asset]'),
	'/api/localization/strings': await routeOf('localization/strings'),
	'/api/win-text/doc': await routeOf('win-text/doc'),
	'/api/game-config/doc': await routeOf('game-config/doc'),
	'/api/deploy': await routeOf('deploy'),
};
const EXPORT_PATH = '/api/editor/export/';
const portal = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://portal');
	const asset = url.pathname.startsWith(EXPORT_PATH) ? url.pathname.slice(EXPORT_PATH.length) : '';
	const handler = ROUTES[asset ? '/api/editor/export' : url.pathname]?.[req.method ?? 'GET'];
	const answered = handler
		? handler({ url, params: asset ? { asset } : {} })
		: Promise.resolve(new Response('no such route', { status: 404 }));
	void answered
		.catch((e: unknown) =>
			isHttpError(e)
				? Response.json(e.body, { status: e.status })
				: new Response(String(e), { status: 501 }),
		)
		.then(async (answer) => {
			res.writeHead(answer.status, Object.fromEntries(answer.headers));
			res.end(Buffer.from(await answer.arrayBuffer()));
		});
});
await new Promise<void>((done) => portal.listen(0, '127.0.0.1', done));
const portalBase = `http://127.0.0.1:${(portal.address() as AddressInfo).port}`;
const buildDir = mkdtempSync(join(tmpdir(), 'art-scope-ship-'));
const bakedFile = join(buildDir, 'src', 'baked-editor-bundle.json');
const pulledDir = join(buildDir, 'static', 'assets');
const buildStep = (script: string, args: string[]) =>
	promisify(execFile)(
		process.execPath,
		[join(here, script), ...args, '--base', portalBase, '--token', SHIP_TOKEN],
		{ cwd: join(here, '../../lines') },
	).then(
		() => true,
		(e: { stderr?: string }) => {
			console.error(e.stderr ?? e);
			return false;
		},
	);
try {
	const builtOk =
		(await buildStep('bake-editor-doc.mjs', [
			'--project',
			SHIP_PROJECT,
			'--dest',
			bakedFile,
			'--publish-anyway',
		])) &&
		(await buildStep('pull-project-assets.mjs', [
			'--project',
			`${CLIENT}/${SHIP_PROJECT}`,
			'--dest',
			pulledDir,
		]));
	const baked = builtOk ? (JSON.parse(readFileSync(bakedFile, 'utf8')) as Shipped) : null;
	const bakedHas = carries(baked);
	const pulled = (rel: string) => existsSync(join(pulledDir, rel));
	check('the bake and the pull of a desktop build both finish', builtOk);
	check(
		'… the baked config carries the sheet and the class’s `sheet` exactly as saved',
		bakedHas.config,
	);
	check(
		'… the bake registers the added action’s clip, found by name, with its sheet',
		bakedHas.named,
	);
	check('… and the clip only an anim cell names', bakedHas.cell);
	check(
		'… beside the salmon’s own clip, and no clip of another name',
		bakedHas.own && !bakedHas.other,
	);
	check(
		'… the pull mirrors both clips’ files and their sheets’, not the other clip’s',
		[
			...shipFiles(baked, `${SHIP_PREFIX}_${SHIP_ACTION}_se`, SHIP_NAMED),
			...shipFiles(baked, 'sandbank_flop', SHIP_CELL),
		].every(pulled) && !pulled('clips/heron_walk_se.json'),
	);
	check(
		'… and the baked config read back gives the class its sheet with the added action',
		bakedHas.resolved,
	);
} finally {
	rmSync(buildDir, { recursive: true, force: true });
}

// The sheet is why they ship: the same project, the sheet cleared in the tool and saved, published
// again. The class is drawn by its block as before, whose clips still ship.
const reopened = await loadGameConfigDocWithEtag(CLIENT, SHIP_PROJECT);
const cleared = JSON.parse(JSON.stringify(reopened.doc)) as NonNullable<typeof reopened.doc>;
const clearRefused = clearSheet(cleared, sheetId);
await saveGameConfigDoc(CLIENT, SHIP_PROJECT, cleared, reopened.etag);
const republished = await publishGame(SHIP_PROJECT, 'https://app.invisiblewall.org');
const after = carries(
	(await readSnapshotBundle(CLIENT, SHIP_PROJECT, republished.snapshot.id)) as Shipped | null,
);
check(
	'with the sheet cleared, the next publish ships neither clip and still the salmon’s own',
	clearRefused === null && !after.named && !after.cell && !after.resolved && after.own,
);

console.log('15. a rig and a still image named only by a character sheet ship');
const C6_PROJECT = 'sheet_rig';
const sheetRig = (name: string) => {
	const folder = `${SUB.spines(CLIENT, C6_PROJECT)}/${name}`;
	put(`${folder}/${name}.atlas`, `${name}.webp\nsize: 8,8\nbone\n  bounds: 0,0,8,8\n`);
	put(`${folder}/${name}.json`, { skeleton: { spine: '4.2' } });
	put(`${folder}/${name}.webp`, 'x');
	return { folder: name, name, atlas_file: `${name}.atlas`, skeleton_file: `${name}.json` };
};
const SHEET_RIGS = ['otterRig', 'otterBack', 'otterTail', 'heronRig'];
put(`${SUB.spines(CLIENT, C6_PROJECT)}/skeletons.json`, { skeletons: SHEET_RIGS.map(sheetRig) });
const STILL_SHEET = salmonsSheet(C6_PROJECT, 'S_Crate', 'crate');
const OTHER_SHEET = salmonsSheet(C6_PROJECT, 'S_Barrel', 'barrel');
put(editorDocKey(CLIENT, C6_PROJECT), { scenes: [{ id: 'field', name: 'Field', nodes: [] }] });
const C6_CONFIG = (characters: object[]) => ({ ...ARCADE_CONFIG, arcade: { characters } });
const RIG_CHARACTER = {
	id: 'otter',
	component: 'otterLook',
	source: { kind: 'rig', rig: 'otterRig', rigs: { ne: 'otterBack' } },
	draw: { width: 64 },
	actions: [
		{ id: 'idle', when: { motion: 'still' } },
		{ id: 'wag', when: { event: 'caught' }, anim: { se: { anim: 'wag', rig: 'otterTail' } } },
	],
};
const STILL_CHARACTER = {
	id: 'crate',
	component: 'crateLook',
	source: { kind: 'stills' },
	draw: { width: 48 },
	actions: [
		{
			id: 'idle',
			when: { motion: 'still' },
			anim: { se: { still: { assetKey: STILL_SHEET, region: 'crate' } } },
		},
	],
};
put(gameConfigDocKey(CLIENT, C6_PROJECT), C6_CONFIG([RIG_CHARACTER, STILL_CHARACTER]));
const c6Index = await exportEditorArt(CLIENT, C6_PROJECT);
const c6Art = `${SUB.deploy(CLIENT, C6_PROJECT)}/editor-art/`;
check(
	'the sheet’s one rig, its rig of a facing and the rig a cell names ship under their names',
	['otterRig', 'otterBack', 'otterTail'].every((rig) => c6Index.spines.some((s) => s.key === rig)),
);
check(
	'… each skeleton copied under deploy/editor-art/',
	['otterRig', 'otterBack', 'otterTail'].every((rig) =>
		under(c6Art).some((o) => o.key.endsWith(`/${rig}.json`)),
	),
);
check('a rig no sheet names does not', !c6Index.spines.some((s) => s.key === 'heronRig'));
check(
	'the sheet a still cell names ships, with its frame counted as covered',
	c6Index.sheets.some((s) => s.key === STILL_SHEET) && !c6Index.missing.includes('crate'),
);
check('a sheet no still names does not', !c6Index.sheets.some((s) => s.key === OTHER_SHEET));
check(
	'the index lists them as the names the bundle carries, so the game’s boot keeps them loaded',
	JSON.stringify(c6Index.characterArt) ===
		JSON.stringify(['otterRig', 'otterBack', 'otterTail', `${STILL_SHEET}::crate`]),
);
const c6Played = await collectPlayedClipIds(CLIENT, C6_PROJECT);
check('a rig and a still name no clip: none is played', !!c6Played && !c6Played.size);
put(
	gameConfigDocKey(CLIENT, C6_PROJECT),
	C6_CONFIG([
		{ id: 'otter', component: 'otterLook' },
		{ id: 'crate', component: 'crateLook' },
	]),
);
const c6Bare = await exportEditorArt(CLIENT, C6_PROJECT);
check(
	'the same config with no sheet ships no rig and no sheet',
	!c6Bare.spines.length && !c6Bare.sheets.length && c6Bare.characterArt === undefined,
);

console.log('16. a rig and still images the tool chose ship: saved, published, baked and pulled');
const { addVariant, linkClassSheet, setDrawWidth } =
	await import('../src/lib/characters/characterSheetEdit.ts');
const { applyFill, fillFromNames } = await import('../src/lib/characters/characterSheetFill.ts');
const { setCellValue } = await import('../src/lib/characters/characterSheetPage.ts');
const { setFacingRig, setSourceKind } =
	await import('../src/lib/characters/characterSheetSources.ts');

type ToolShipped = Shipped & {
	characterArt?: string[];
	editorArt: { spines?: { key: string; atlas: string; skeleton: string }[] };
};
const TOOL_PROJECT = 'sheet_tool_ship';
// The artist's part, there before the tool is opened: three rigs the salmon's sheet will name
// and one it will not, a sheet of the bear's images named for their action and facing (and a
// frame that is not), and a sheet nothing will name.
const TOOL_RIGS = ['salmonRig', 'salmonBack', 'salmonTail'];
const TOOL_OTHER_RIG = 'heronRig';
put(`${SUB.spines(CLIENT, TOOL_PROJECT)}/skeletons.json`, {
	skeletons: [...TOOL_RIGS, TOOL_OTHER_RIG].map((name) => {
		const folder = `${SUB.spines(CLIENT, TOOL_PROJECT)}/${name}`;
		put(`${folder}/${name}.atlas`, `${name}.webp\nsize: 8,8\nbone\n  bounds: 0,0,8,8\n`);
		put(`${folder}/${name}.json`, { skeleton: { spine: '4.2' } });
		put(`${folder}/${name}.webp`, `page of ${name}`);
		return { folder: name, name, atlas_file: `${name}.atlas`, skeleton_file: `${name}.json` };
	}),
});
const TOOL_FRAMES = ['bear_idle_se', 'bear_walk_se', 'bear_swipe_se'];
const TOOL_STILLS = `${SUB.manifests(CLIENT, TOOL_PROJECT)}/atlas_manifest_S_BearStills.json`;
const TOOL_STILLS_REGIONS = [...TOOL_FRAMES, 'bear_logo'].map((name, i) => ({
	name,
	x: i * 8,
	y: 0,
	w: 8,
	h: 8,
}));
put(`${SUB.sheets(CLIENT, TOOL_PROJECT)}/S_BearStills/S_BearStills.webp`, 'page of the stills');
put(TOOL_STILLS, {
	atlas: {
		source_image_path: `${SUB.sheets(CLIENT, TOOL_PROJECT)}/S_BearStills/S_BearStills.webp`,
	},
	regions: TOOL_STILLS_REGIONS,
});
const TOOL_OTHER_SHEET = salmonsSheet(TOOL_PROJECT, 'S_Barrel', 'barrel');
const TOOL_ART = [...TOOL_RIGS, ...TOOL_FRAMES.map((frame) => `${TOOL_STILLS}::${frame}`)];
for (const look of SALMONS_CHARACTER_COMPONENTS)
	put(projectComponentKey(TOOL_PROJECT, look.id), look);
put(editorDocKey(CLIENT, TOOL_PROJECT), { scenes: [{ id: 'field', name: 'Field', nodes: [] }] });
await saveGameConfigDoc(CLIENT, TOOL_PROJECT, salmonsBeforeItsBotSalmon());

/** A published snapshot: its bundle, its deploy files by their path under `deploy/`, and a
 *  reader of one. */
const snapshotOf = async (id: string) => {
	const root = snapshotDeployKey(CLIENT, TOOL_PROJECT, id, '');
	return {
		bundle: (await readSnapshotBundle(CLIENT, TOOL_PROJECT, id)) as ToolShipped | null,
		files: under(root).map((o) => o.key.slice(root.length)),
		read: (rel: string) => bucket.get(`${root}${rel}`)?.text,
	};
};
// What the project ships before the tool touches it: the publish every later one is held against.
const untouched = await snapshotOf(
	(await publishGame(TOOL_PROJECT, 'https://app.invisiblewall.org')).snapshot.id,
);

// The page: the salmon's block made a sheet and its source changed to a rig (the block's prefix
// and variant go, so the change is confirmed), a rig of its own for one facing, another rig's
// animation in one cell, a skin variant; the bear's bot given still images, filled from the
// sheet's frame names, drawn as wide as its widest frame; and the bear class told to draw from it.
const toolOpened = await loadGameConfigDocWithEtag(CLIENT, TOOL_PROJECT);
const toolPage = JSON.parse(JSON.stringify(toolOpened.doc)) as NonNullable<typeof toolOpened.doc>;
const rigBlock = SALMONS_CHARACTER_COMPONENTS.find(
	(look) => look.id === findClass(toolPage, 'salmon')?.body,
)?.characterClips;
const rigMade = makeClassSheet(toolPage, 'salmon', rigBlock ?? { prefixes: { base: '' } });
const rigId = rigMade.characterId ?? '';
const stillsId =
	toolPage.arcade?.characters?.find((c) => c.component === findClass(toolPage, 'bear')?.body)?.id ??
	'';
const rigEdits = [
	rigMade.refused,
	setSourceKind(toolPage, rigId, 'rig', { rig: TOOL_RIGS[0], confirmLoss: true }).refused,
	setFacingRig(toolPage, rigId, 'ne', TOOL_RIGS[1]),
	setCellValue(toolPage, rigId, 'hop', 'se', { kind: 'rig', anim: 'hop', rig: TOOL_RIGS[2] }),
	addVariant(toolPage, rigId, 'marked', 'gold'),
];
const stillsStarted = setSourceKind(toolPage, stillsId, 'stills').refused;
const fillPlan = fillFromNames(sheetOf(toolPage, stillsId), {
	assetKey: TOOL_STILLS,
	regions: TOOL_STILLS_REGIONS.map((region) => region.name),
	sizes: Object.fromEntries(TOOL_STILLS_REGIONS.map(({ name, w, h }) => [name, { w, h }])),
});
const filled = applyFill(toolPage, stillsId, fillPlan, { overwrite: false, addActions: true });
const stillsEdits = [
	stillsStarted,
	filled.refused,
	setDrawWidth(toolPage, stillsId, String(fillPlan.width ?? 0)),
	linkClassSheet(toolPage, 'bear', stillsId),
];
check(
	'every edit of the rig sheet is accepted, on a new character for the salmon’s look',
	!!rigBlock && rigMade.created === true && rigEdits.every((refused) => refused === null),
);
check(
	'… and of the stills sheet, on the bear’s bot: three images filled by name, the fourth not placed',
	!!stillsId &&
		stillsEdits.every((refused) => refused === null) &&
		filled.filled === TOOL_FRAMES.length &&
		same(filled.addedActions, ['idle', 'walk', 'swipe']) &&
		same(fillPlan.unmatchedRegions, ['bear_logo']) &&
		fillPlan.width === 8,
);

const entryIn = (config: ShipConfig | null | undefined, id: string) =>
	config?.arcade?.characters?.find((c) => c.id === id);
const classSheetIn = (config: ShipConfig | null | undefined, classId: string) =>
	config?.arcade?.online?.characters?.find((c) => c.id === classId)?.sheet;
await saveGameConfigDoc(CLIENT, TOOL_PROJECT, toolPage, toolOpened.etag);
const toolStored = JSON.parse(
	bucket.get(gameConfigDocKey(CLIENT, TOOL_PROJECT))?.text ?? 'null',
) as ShipConfig | null;
const savedRig = entryIn(toolStored, rigId);
const savedStills = entryIn(toolStored, stillsId);
check(
	'the save stores both sheets as the page holds them, and each class names its own',
	same(savedRig, entryIn(toolPage, rigId)) &&
		same(savedStills, entryIn(toolPage, stillsId)) &&
		classSheetIn(toolStored, 'salmon') === rigId &&
		classSheetIn(toolStored, 'bear') === stillsId,
);

/**
 * What a shipped bundle carries of the two sheets, and the deploy files it names for them: each
 * rig's atlas, skeleton and the page its atlas names, the stills' spritesheet and the page that
 * names. `read` gives a deploy file's text where the bundle was shipped to.
 */
const toolCarries = (
	shipped: ToolShipped | null | undefined,
	read: (rel: string) => string | undefined,
) => {
	const spines = shipped?.editorArt.spines ?? [];
	const sheets = shipped?.editorArt.sheets ?? [];
	const rigRead = onlineClassSheetOf(shipped?.config, 'salmon');
	const stillsRead = onlineClassSheetOf(shipped?.config, 'bear');
	const rigSource = rigRead?.sheet.source;
	const beside = (rel: string, ref: string | undefined) =>
		ref ? posix.join(posix.dirname(rel), ref) : `${rel}: names no page`;
	const imageOf = (rel: string) => {
		const text = read(rel);
		return text ? (JSON.parse(text) as { meta?: { image?: string } }).meta?.image : undefined;
	};
	return {
		config:
			same(entryIn(shipped?.config, rigId), savedRig) &&
			same(entryIn(shipped?.config, stillsId), savedStills) &&
			classSheetIn(shipped?.config, 'salmon') === rigId &&
			classSheetIn(shipped?.config, 'bear') === stillsId,
		listed: shipped?.characterArt,
		sheetKeys: sheets.map((s) => s.key).sort(),
		rigKeys: spines.map((s) => s.key).sort(),
		clips: (shipped?.flipbooks ?? []).map((clip) => clip.id).sort(),
		resolved:
			rigRead?.id === rigId &&
			rigSource?.kind === 'rig' &&
			rigSource.rig === TOOL_RIGS[0] &&
			rigSource.rigs?.ne === TOOL_RIGS[1] &&
			rigSource.variants?.marked === 'gold' &&
			stillsRead?.id === stillsId &&
			stillsRead.sheet.source?.kind === 'stills',
		rigFiles: spines
			.filter((s) => TOOL_RIGS.includes(s.key))
			.flatMap((s) => [s.atlas, s.skeleton, beside(s.atlas, read(s.atlas)?.split('\n')[0])]),
		stillsFiles: sheets
			.filter((s) => s.key === TOOL_STILLS)
			.flatMap((s) => [s.json, beside(s.json, imageOf(s.json))]),
	};
};
const NO_SHEET_NAMES = /heronRig|S_Barrel/;
const before = toolCarries(untouched.bundle, untouched.read);
const toolLive = await snapshotOf(
	(await publishGame(TOOL_PROJECT, 'https://app.invisiblewall.org')).snapshot.id,
);
const liveTool = toolCarries(toolLive.bundle, toolLive.read);
const liveFiles = [...liveTool.rigFiles, ...liveTool.stillsFiles];
check(
	'Publish: the config carries both sheets and both classes’ `sheet` exactly as saved',
	liveTool.config,
);
check(
	'… the three rigs the sheet names ship, each atlas, skeleton and page in the snapshot',
	same(liveTool.rigKeys, [...TOOL_RIGS].sort()) &&
		liveTool.rigFiles.length === 3 * TOOL_RIGS.length &&
		liveTool.rigFiles.every((rel) => toolLive.files.includes(rel)),
);
check(
	'… and the sheet the still cells name, its spritesheet and its page',
	liveTool.sheetKeys.includes(TOOL_STILLS) &&
		liveTool.stillsFiles.length === 2 &&
		liveTool.stillsFiles.every((rel) => toolLive.files.includes(rel)),
);
check(
	'… `characterArt` lists exactly them: the rigs, and each image a cell holds',
	same(liveTool.listed, TOOL_ART),
);
check(
	'… the rig and the sheet no sheet names are not in it',
	!liveTool.rigKeys.includes(TOOL_OTHER_RIG) &&
		!liveTool.sheetKeys.includes(TOOL_OTHER_SHEET) &&
		!toolLive.files.some((rel) => NO_SHEET_NAMES.test(rel)),
);
// Each page ships beside a `.meta.json` of its size, which no bundle names.
const pageMeta = (rel: string) => rel.replace(/\.webp$/, '.meta.json');
check(
	'… next to the publish before the edits nothing else is new: no file, sheet, rig or clip',
	same(
		toolLive.files.filter((rel) => !untouched.files.includes(rel)).sort(),
		[...liveFiles, ...liveFiles.filter((rel) => rel.endsWith('.webp')).map(pageMeta)].sort(),
	) &&
		untouched.files.every((rel) => toolLive.files.includes(rel)) &&
		same(liveTool.sheetKeys, [...before.sheetKeys, TOOL_STILLS].sort()) &&
		same(before.rigKeys, []) &&
		same(liveTool.clips, before.clips) &&
		before.listed === undefined,
);
check(
	'… and the runtime’s reader gives each class its sheet: the rig’s, the stills’',
	liveTool.resolved,
);

// A desktop build, as §14's: the real bake and the real pull, each its own process.
const toolBuild = mkdtempSync(join(tmpdir(), 'art-scope-tool-'));
const toolBaked = join(toolBuild, 'src', 'baked-editor-bundle.json');
const toolPulled = join(toolBuild, 'static', 'assets');
try {
	const builtOk =
		(await buildStep('bake-editor-doc.mjs', [
			'--project',
			TOOL_PROJECT,
			'--dest',
			toolBaked,
			'--publish-anyway',
		])) &&
		(await buildStep('pull-project-assets.mjs', [
			'--project',
			`${CLIENT}/${TOOL_PROJECT}`,
			'--dest',
			toolPulled,
		]));
	const pulledText = (rel: string) =>
		existsSync(join(toolPulled, rel)) ? readFileSync(join(toolPulled, rel), 'utf8') : undefined;
	const baked = toolCarries(
		builtOk ? (JSON.parse(readFileSync(toolBaked, 'utf8')) as ToolShipped) : null,
		pulledText,
	);
	const pulledFiles = builtOk
		? readdirSync(toolPulled, { recursive: true, encoding: 'utf8' }).map((rel) =>
				rel.split(sep).join('/'),
			)
		: [];
	check('the bake and the pull of a desktop build both finish', builtOk);
	check(
		'… the baked config carries both sheets and both classes’ `sheet` exactly as saved',
		baked.config,
	);
	check(
		'… the bake lists the three rigs, and the pull mirrors each atlas, skeleton and page',
		same(baked.rigKeys, [...TOOL_RIGS].sort()) &&
			baked.rigFiles.length === 3 * TOOL_RIGS.length &&
			baked.rigFiles.every((rel) => pulledFiles.includes(rel)),
	);
	check(
		'… and the stills’ sheet, its spritesheet and its page',
		baked.sheetKeys.includes(TOOL_STILLS) &&
			baked.stillsFiles.length === 2 &&
			baked.stillsFiles.every((rel) => pulledFiles.includes(rel)),
	);
	check('… the baked `characterArt` lists exactly them', same(baked.listed, TOOL_ART));
	check(
		'… no other sheet, rig or clip is baked, and nothing of the unnamed rig or sheet is pulled',
		same(baked.sheetKeys, [...before.sheetKeys, TOOL_STILLS].sort()) &&
			same(baked.clips, before.clips) &&
			!pulledFiles.some((rel) => NO_SHEET_NAMES.test(rel)),
	);
	check('… and the baked config read back gives each class its sheet', baked.resolved);
} finally {
	portal.close();
	rmSync(toolBuild, { recursive: true, force: true });
}

// The sheets are why they ship: both cleared in the tool, saved, published again.
const toolReopened = await loadGameConfigDocWithEtag(CLIENT, TOOL_PROJECT);
const toolCleared = JSON.parse(JSON.stringify(toolReopened.doc)) as NonNullable<
	typeof toolReopened.doc
>;
const clearRefusals = [clearSheet(toolCleared, rigId), clearSheet(toolCleared, stillsId)];
await saveGameConfigDoc(CLIENT, TOOL_PROJECT, toolCleared, toolReopened.etag);
const toolAfter = await snapshotOf(
	(await publishGame(TOOL_PROJECT, 'https://app.invisiblewall.org')).snapshot.id,
);
const afterTool = toolCarries(toolAfter.bundle, toolAfter.read);
check(
	'with both sheets cleared, the next publish ships no rig, no stills sheet, no `characterArt`, no file of theirs',
	clearRefusals.every((refused) => refused === null) &&
		same(afterTool.rigKeys, []) &&
		same(afterTool.sheetKeys, before.sheetKeys) &&
		afterTool.listed === undefined &&
		!afterTool.resolved &&
		same(
			toolAfter.files.filter((rel) => !untouched.files.includes(rel)),
			[],
		),
);

console.log(failures === 0 ? '\nart scope: OK' : `\nart scope: ${failures} FAILED`);
if (failures > 0) process.exit(1);
