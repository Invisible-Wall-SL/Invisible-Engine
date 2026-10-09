/**
 * THE LEGACY MIRROR IS GONE (`docs/design/bonus-games.md` §2.1, bonus-games Phase 7b). A normalized
 * Game Config carries its bonuses in the split form only — `coinOverlay` and the declared modes — and
 * the legacy `holdAndWin` / `potsOverlay` keys are read by `normalizeGameConfigDoc`'s legacy reader
 * alone, which still accepts every stored project, preset, sample and old baked bundle that has them.
 *
 *   pnpm check:bonus-migration
 *   pnpm check:bonus-migration --measure     # print the corpus digests (run on main to re-pin)
 *
 *  1. THE CORPUS NORMALIZES TO THE SPLIT FORM. Every committed preset, template, sample-shaped test
 *     fixture, add-on result and a legacy-only doc normalizes with NO top-level legacy key.
 *  2. NOTHING IS LOST. For each, the split form is byte for byte what main's mirror-bearing normalize
 *     stored minus the two keys, and the views the readers now use (`primaryHoldAndWin`,
 *     `potsOverlayOf`) are byte for byte the mirror main stored (`MAIN`, measured on main 65d47c1
 *     with `--measure`, the mirror keys split off).
 *  3. A FIXED POINT. Normalizing a normalized doc changes nothing.
 *  4. AN OLD BAKED CONFIG BOOTS IDENTICALLY. A bundle baked on main (the split form AND the mirror)
 *     and one baked before the split (the legacy keys alone) resolve through the runtime's own config
 *     accessor (`createGameConfig`) to the migrated doc; the Hold and Win mock booted from either
 *     declares the same boot `config`, and the facade reads the same respin modes from it.
 *  5. NO READER OF THE LEGACY KEYS. No source outside the legacy reader reads a doc's top-level
 *     `holdAndWin` / `potsOverlay` or calls a removed mirror helper.
 *  6. MUTATIONS. Each of 1–5 is shown to fail on the defect it guards against.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as gc from '../packages/game-config/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEASURE = process.argv.includes('--measure');

type Doc = Record<string, unknown>;
const api = gc as unknown as Record<string, (...args: unknown[]) => unknown>;

let passes = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) passes += 1;
	else failures.push(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

const digest = (value: unknown): string =>
	createHash('sha256')
		.update(JSON.stringify(value ?? null))
		.digest('hex')
		.slice(0, 16);

const normalize = (raw: unknown): Doc => {
	const doc = api.normalizeGameConfigDoc(structuredClone(raw)) as Doc | undefined;
	if (!doc) throw new Error('the corpus holds a doc that does not normalize');
	return doc;
};

/** The doc without the two legacy keys. */
const splitOf = (doc: Doc): Doc => {
	const { holdAndWin: _hw, potsOverlay: _pots, ...rest } = doc;
	return rest;
};

/** What a normalized doc says of its bonuses: the split form, and the two legacy-shaped views — on
 *  main the stored mirror, here what the readers derive from the split form. */
const viewsOf = (doc: Doc) =>
	MEASURE
		? { split: splitOf(doc), holdAndWin: doc.holdAndWin, potsOverlay: doc.potsOverlay }
		: {
				split: doc,
				holdAndWin: api.primaryHoldAndWin(doc),
				potsOverlay: api.potsOverlayOf(doc),
			};

// ─── the corpus ───────────────────────────────────────────────────────────────────────────────

const TEMPLATES = join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig');
const templates: Record<string, Doc> = Object.fromEntries(
	readdirSync(TEMPLATES)
		.filter((f) => f.endsWith('.json'))
		.sort()
		.map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(TEMPLATES, f), 'utf8'))]),
);
const HW_PRESETS = gc.HOLD_AND_WIN_PRESETS as Record<string, Doc>;
const HW_FIXTURES = gc.HOLD_AND_WIN_TEST_FIXTURES as Record<string, Doc>;
const OVERLAY_PRESETS = gc.POTS_OVERLAY_PRESET_IDS as readonly string[];

/** Every raw doc of the corpus, by name: what normalize is handed. */
function corpus(): Record<string, unknown> {
	const raws: Record<string, unknown> = {};
	for (const [name, doc] of Object.entries(templates)) raws[`template:${name}`] = doc;
	for (const [name, doc] of Object.entries(HW_PRESETS)) raws[`preset:${name}`] = doc;
	for (const [name, doc] of Object.entries(HW_FIXTURES)) raws[`fixture:${name}`] = doc;
	raws['preset:bookOfThermopylae'] = gc.bookOfThermopylaePreset();
	// A doc stored before the split: a lines game with the legacy pair alone.
	raws['legacy:lines+pots'] = {
		...templates.lines,
		holdAndWin: HW_PRESETS.pots.holdAndWin,
		potsOverlay: (api.potsOverlayPreset('threePots') as { potsOverlay: unknown }).potsOverlay,
	};
	// …and one with a legacy pots overlay alone (its pots start free spins).
	raws['legacy:lines+potsToFreeSpins'] = {
		...templates.lines,
		potsOverlay: (api.potsOverlayPreset('potsToFreeSpins') as { potsOverlay: unknown }).potsOverlay,
	};
	// The samples' shapes: every overlay preset on every template, and a Hold and Win bonus on every
	// base game that is not one, before and after an overlay.
	for (const [name, doc] of Object.entries(templates)) {
		const host = normalize(doc);
		for (const preset of OVERLAY_PRESETS) {
			const added = api.addPotsOverlay(host, preset) as { ok: boolean; doc?: Doc };
			if (added.ok) raws[`addOn:${name}|${preset}`] = added.doc;
		}
		if (name.startsWith('holdAndWin')) continue;
		for (const id of Object.keys(HW_PRESETS)) {
			const bonus = api.addHoldAndWinBonus(host, id) as { ok: boolean; doc?: Doc };
			if (!bonus.ok) continue;
			raws[`bonus:${name}|${id}`] = bonus.doc;
			const overlaid = api.addPotsOverlay(normalize(bonus.doc), 'threePots') as {
				ok: boolean;
				doc?: Doc;
			};
			if (overlaid.ok) raws[`bonus:${name}|${id}|threePots`] = overlaid.doc;
		}
	}
	return raws;
}

/**
 * `--measure` on main 65d47c1: `[split, mirror holdAndWin, mirror potsOverlay]` digests of each
 * corpus doc's normalized form. The template entries are measured from main's own template files,
 * which carried the mirror; this branch regenerated them without it.
 */
const MAIN: Record<string, [string, string, string]> = {
	'template:holdAndWin.classic': ['8b3074515c6677c7', '95b017f06291f0b6', '74234e98afe7498f'],
	'template:holdAndWin.collector': ['811b86115250ae64', 'f06e32a479ed01ea', '74234e98afe7498f'],
	'template:holdAndWin.plain': ['928c8c566637c3fd', 'f4e4b0ae9dea1eba', '74234e98afe7498f'],
	'template:holdAndWin.plainNoJackpots': [
		'e602baa3a5033985',
		'6907be2edee39459',
		'74234e98afe7498f',
	],
	'template:holdAndWin.pots': ['d8b1d5a856b51bed', '170903f7b6f6ae80', '74234e98afe7498f'],
	'template:lines.bookOfThermopylae': ['91ab38b033639921', '74234e98afe7498f', '74234e98afe7498f'],
	'template:lines': ['4e6d5bb1764ee30c', '74234e98afe7498f', '74234e98afe7498f'],
	'template:scatter': ['7e9591cdf9382419', '74234e98afe7498f', '74234e98afe7498f'],
	'template:ways': ['81f7df3cd9bd192c', '74234e98afe7498f', '74234e98afe7498f'],
	'preset:pots': ['d8b1d5a856b51bed', '170903f7b6f6ae80', '74234e98afe7498f'],
	'preset:classic': ['8b3074515c6677c7', '95b017f06291f0b6', '74234e98afe7498f'],
	'preset:collector': ['811b86115250ae64', 'f06e32a479ed01ea', '74234e98afe7498f'],
	'fixture:pots-progressive': ['f0b39de18e47999c', '31867984b6ba7312', '74234e98afe7498f'],
	'fixture:pots-extra': ['62846318290b3d27', 'a6d71f72201b977b', '74234e98afe7498f'],
	'fixture:pots-expansion-fullrow': ['c64db27beddb9d83', '8ba2771a1b91a48d', '74234e98afe7498f'],
	'fixture:pots-expansion-unlock': ['6ddae6c82db97d75', '11e1cff373567855', '74234e98afe7498f'],
	'fixture:pots-expansion-count': ['da8b5e147d68c08d', '3c2cf9527f42bc22', '74234e98afe7498f'],
	'preset:bookOfThermopylae': ['64e7b973d5b7bd89', '74234e98afe7498f', '74234e98afe7498f'],
	'legacy:lines+pots': ['19b640bca82f413a', '170903f7b6f6ae80', '92f98d466ba6fcb1'],
	'legacy:lines+potsToFreeSpins': ['258381d6f36bda01', '74234e98afe7498f', 'cf17de29dcd9e342'],
	'addOn:holdAndWin.classic|threePots': [
		'5fbab7a68e976ee3',
		'98f0a1bdcd48eed1',
		'692fbda52c290c89',
	],
	'addOn:holdAndWin.classic|potsToFreeSpins': [
		'dbd050e3dfac30b5',
		'95b017f06291f0b6',
		'cf17de29dcd9e342',
	],
	'addOn:holdAndWin.classic|collector': [
		'38565f8aa827c0a7',
		'7a774402df92985d',
		'3533aea1a74fc049',
	],
	'addOn:holdAndWin.collector|threePots': [
		'f6047c13fa52592d',
		'9610f6cf467c3e98',
		'692fbda52c290c89',
	],
	'addOn:holdAndWin.collector|potsToFreeSpins': [
		'5061bd781249fe48',
		'f06e32a479ed01ea',
		'cf17de29dcd9e342',
	],
	'addOn:holdAndWin.collector|collector': [
		'c71e0fb721d70d6c',
		'f06e32a479ed01ea',
		'3533aea1a74fc049',
	],
	'addOn:holdAndWin.plain|threePots': ['da18fb56ef4434fb', 'ed97000de9d9b8ab', '692fbda52c290c89'],
	'addOn:holdAndWin.plain|potsToFreeSpins': [
		'24ff11e56c01e8c0',
		'f4e4b0ae9dea1eba',
		'cf17de29dcd9e342',
	],
	'addOn:holdAndWin.plain|collector': ['dfd2fbfeff8c5cc3', '52b4215f58fe7bb2', '3533aea1a74fc049'],
	'addOn:holdAndWin.plainNoJackpots|threePots': [
		'7618ea6ec3998a81',
		'68caf3a414713697',
		'692fbda52c290c89',
	],
	'addOn:holdAndWin.plainNoJackpots|potsToFreeSpins': [
		'785248d5fb6fa331',
		'6907be2edee39459',
		'cf17de29dcd9e342',
	],
	'addOn:holdAndWin.plainNoJackpots|collector': [
		'c383ee26425cd365',
		'd715b9ea39dcf731',
		'3533aea1a74fc049',
	],
	'addOn:holdAndWin.pots|threePots': ['6fd0c7a47739c191', '170903f7b6f6ae80', '94fe8101057ee5e0'],
	'addOn:holdAndWin.pots|potsToFreeSpins': [
		'68c3b0decec432c1',
		'170903f7b6f6ae80',
		'cf17de29dcd9e342',
	],
	'addOn:holdAndWin.pots|collector': ['bc54d924e1f1800b', '170903f7b6f6ae80', '4e8b97347792a71e'],
	'addOn:lines.bookOfThermopylae|threePots': [
		'1103b4de16de9959',
		'3056c098fad8c833',
		'92f98d466ba6fcb1',
	],
	'addOn:lines.bookOfThermopylae|potsToFreeSpins': [
		'8ffa455631bf317b',
		'74234e98afe7498f',
		'cf17de29dcd9e342',
	],
	'addOn:lines.bookOfThermopylae|coinsOnly': [
		'4a0be600800ac65e',
		'66249e421e39b9ed',
		'8e360b6c17428afc',
	],
	'addOn:lines.bookOfThermopylae|collector': [
		'15d3e71c4c827e31',
		'0476542e9eb660e8',
		'3533aea1a74fc049',
	],
	'bonus:lines.bookOfThermopylae|pots': [
		'8313ce1b7c939956',
		'3056c098fad8c833',
		'74234e98afe7498f',
	],
	'bonus:lines.bookOfThermopylae|pots|threePots': [
		'a74a60422c56e43d',
		'3056c098fad8c833',
		'92f98d466ba6fcb1',
	],
	'bonus:lines.bookOfThermopylae|classic': [
		'd75da81c269bffe6',
		'66249e421e39b9ed',
		'74234e98afe7498f',
	],
	'bonus:lines.bookOfThermopylae|classic|threePots': [
		'07b559f69948c34b',
		'501d6d010348e3db',
		'92f98d466ba6fcb1',
	],
	'bonus:lines.bookOfThermopylae|collector': [
		'44167a6785263a73',
		'0476542e9eb660e8',
		'74234e98afe7498f',
	],
	'bonus:lines.bookOfThermopylae|collector|threePots': [
		'a1dd73f2e0c8cd73',
		'4a5d1cd67cfe5d61',
		'92f98d466ba6fcb1',
	],
	'addOn:lines|threePots': ['2b0d3ff16fe188ca', '3056c098fad8c833', '92f98d466ba6fcb1'],
	'addOn:lines|potsToFreeSpins': ['362d9107a0f254d3', '74234e98afe7498f', 'cf17de29dcd9e342'],
	'addOn:lines|coinsOnly': ['a744dadd222be66e', '66249e421e39b9ed', '8e360b6c17428afc'],
	'addOn:lines|collector': ['19723b58bc715789', '0476542e9eb660e8', '3533aea1a74fc049'],
	'bonus:lines|pots': ['1d32bcd87019714b', '3056c098fad8c833', '74234e98afe7498f'],
	'bonus:lines|pots|threePots': ['ffbd20dff33afaa8', '3056c098fad8c833', '92f98d466ba6fcb1'],
	'bonus:lines|classic': ['57a970a80c09dc49', '66249e421e39b9ed', '74234e98afe7498f'],
	'bonus:lines|classic|threePots': ['127e2a0cbb7d9c97', '501d6d010348e3db', '92f98d466ba6fcb1'],
	'bonus:lines|collector': ['6adad8e7966941c9', '0476542e9eb660e8', '74234e98afe7498f'],
	'bonus:lines|collector|threePots': ['b0ff651aa5c620ec', '4a5d1cd67cfe5d61', '92f98d466ba6fcb1'],
	'addOn:scatter|threePots': ['ca8847689f533915', '3056c098fad8c833', '92f98d466ba6fcb1'],
	'addOn:scatter|potsToFreeSpins': ['e58c839bb6136f23', '74234e98afe7498f', 'cf17de29dcd9e342'],
	'addOn:scatter|coinsOnly': ['484b6e4790a00e29', '66249e421e39b9ed', '8e360b6c17428afc'],
	'addOn:scatter|collector': ['3d5547992fc9a589', '0476542e9eb660e8', '3533aea1a74fc049'],
	'bonus:scatter|pots': ['f480f19949c72fe9', '3056c098fad8c833', '74234e98afe7498f'],
	'bonus:scatter|pots|threePots': ['86cf0d734653c972', '3056c098fad8c833', '92f98d466ba6fcb1'],
	'bonus:scatter|classic': ['ad38cb75366a85c0', '66249e421e39b9ed', '74234e98afe7498f'],
	'bonus:scatter|classic|threePots': ['a5725e6f2c73d22e', '501d6d010348e3db', '92f98d466ba6fcb1'],
	'bonus:scatter|collector': ['9ffd10d0d3ba3f4f', '0476542e9eb660e8', '74234e98afe7498f'],
	'bonus:scatter|collector|threePots': ['f575adea37ed6534', '4a5d1cd67cfe5d61', '92f98d466ba6fcb1'],
	'addOn:ways|threePots': ['7fa1ca9a9a2c0c64', '3056c098fad8c833', '92f98d466ba6fcb1'],
	'addOn:ways|potsToFreeSpins': ['ae9efb1330ff942c', '74234e98afe7498f', 'cf17de29dcd9e342'],
	'addOn:ways|coinsOnly': ['3d62ab1c137ca38d', '66249e421e39b9ed', '8e360b6c17428afc'],
	'addOn:ways|collector': ['bc822b8225c8a111', '0476542e9eb660e8', '3533aea1a74fc049'],
	'bonus:ways|pots': ['c7d09fcc2b154ffa', '3056c098fad8c833', '74234e98afe7498f'],
	'bonus:ways|pots|threePots': ['b30da6b5469db579', '3056c098fad8c833', '92f98d466ba6fcb1'],
	'bonus:ways|classic': ['db05827ff3e760dd', '66249e421e39b9ed', '74234e98afe7498f'],
	'bonus:ways|classic|threePots': ['b927f8984efbc127', '501d6d010348e3db', '92f98d466ba6fcb1'],
	'bonus:ways|collector': ['386b0cf6a3743a1b', '0476542e9eb660e8', '74234e98afe7498f'],
	'bonus:ways|collector|threePots': ['2c3099150f6e7af4', '4a5d1cd67cfe5d61', '92f98d466ba6fcb1'],
};

// ─── 1–3: the corpus ──────────────────────────────────────────────────────────────────────────

const LEGACY_KEYS = ['holdAndWin', 'potsOverlay'];
const carriesLegacy = (doc: Doc): boolean => LEGACY_KEYS.some((key) => key in doc);

const docs: Record<string, Doc> = {};
const measured: Record<string, [string, string, string]> = {};
for (const [name, raw] of Object.entries(corpus())) {
	const doc = normalize(raw);
	docs[name] = doc;
	const views = viewsOf(doc);
	measured[name] = [digest(views.split), digest(views.holdAndWin), digest(views.potsOverlay)];
}

if (MEASURE) {
	for (const [name, row] of Object.entries(measured)) {
		console.log(`\t'${name}': ['${row.join("', '")}'],`);
	}
	process.exit(0);
}

for (const [name, doc] of Object.entries(docs)) {
	check(`1 ${name}: no legacy key`, !carriesLegacy(doc));
	const main = MAIN[name];
	check(`2 ${name}: measured on main`, Boolean(main));
	if (main) {
		const [split, holdAndWin, pots] = measured[name];
		check(`2 ${name}: the split form is main's`, split === main[0], `${split} ≠ ${main[0]}`);
		check(`2 ${name}: primaryHoldAndWin is main's mirror`, holdAndWin === main[1]);
		check(`2 ${name}: potsOverlayOf is main's mirror`, pots === main[2]);
	}
	check(`3 ${name}: a fixed point`, JSON.stringify(normalize(doc)) === JSON.stringify(doc));
}
check(
	'2 every pinned case is in the corpus',
	Object.keys(MAIN).every((name) => name in docs),
);
check(
	'1 the corpus has bonuses to migrate',
	Object.values(docs).filter((doc) => api.primaryHoldAndWin(doc)).length >= 20,
);

// ─── 4: an old baked config boots identically ─────────────────────────────────────────────────

const { createGameConfig } = await import('../packages/engine-game/src/game/gameConfig.ts');
const { createMockRgs } = await import('./mock-rgs-server-holdandwin.mjs');
const { readHoldAndWinModes } =
	await import('../packages/rgs-translator-eagaming/src/holdAndWin.ts');

/** The doc the runtime plays when `baked` is the bundle's config. */
const runtimeConfigOf = (baked: Doc, compiled: Doc): Doc =>
	createGameConfig({
		bakedConfig: () => baked as never,
		compiledConfig: compiled,
	}).getActiveGameConfig() as unknown as Doc;

/** A bundle baked on main: the split form and the mirror it carried beside it. */
const bakedOnMain = (doc: Doc): Doc => {
	const holdAndWin = api.primaryHoldAndWin(doc);
	const potsOverlay = api.potsOverlayOf(doc);
	return { ...doc, ...(holdAndWin ? { holdAndWin } : {}), ...(potsOverlay ? { potsOverlay } : {}) };
};

const quiet = async <T,>(run: () => Promise<T>): Promise<T> => {
	const log = console.log;
	console.log = () => {};
	try {
		return await run();
	} finally {
		console.log = log;
	}
};

/** The boot `config` event the Hold and Win mock declares for `doc`. */
async function bootConfigOf(doc: Doc): Promise<Record<string, unknown> | undefined> {
	const inputs = api.holdAndWinMockInputs(doc);
	if (!inputs) return undefined;
	const mock = createMockRgs({
		label: 'migration',
		quiet: true,
		seed: 'migration',
		reels: doc.numReels,
		rows: Math.max(...(doc.numRows as number[])),
		paylines: Object.values(doc.paylines as object),
		holdAndWin: inputs,
	});
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const { port } = server.address() as AddressInfo;
	try {
		const res = await fetch(`http://127.0.0.1:${port}/rgs/engine?sid=boot&seq=0`, {
			method: 'POST',
			body: JSON.stringify([{ action: 'config' }]),
		});
		const answer = (await res.json()) as { events?: { event: string; context?: object }[] };
		return answer.events?.find((e) => e.event === 'config')?.context as Record<string, unknown>;
	} finally {
		await new Promise<void>((done) => server.close(() => done()));
	}
}

/** What the runtime and the facade make of a baked config: its doc, and the boot it is dealt. */
async function bootOf(baked: Doc, compiled: Doc) {
	const config = runtimeConfigOf(baked, compiled);
	const boot = await quiet(() => bootConfigOf(config));
	return {
		config: JSON.stringify(config),
		boot: JSON.stringify(boot ?? null),
		modes: JSON.stringify(boot ? readHoldAndWinModes(boot) : null),
	};
}

const sameBoot = (a: Awaited<ReturnType<typeof bootOf>>, b: Awaited<ReturnType<typeof bootOf>>) =>
	a.config === b.config && a.boot === b.boot && a.modes === b.modes;

const BOOTED = Object.keys(docs).filter(
	(name) => name.startsWith('preset:') || name.startsWith('template:holdAndWin'),
);
for (const name of BOOTED) {
	const doc = docs[name];
	const now = await bootOf(doc, doc);
	check(`4 ${name}: the runtime reads the doc as stored`, now.config === JSON.stringify(doc));
	check(`4 ${name}: baked on main`, sameBoot(await bootOf(bakedOnMain(doc), doc), now));
	if (name.startsWith('preset:')) {
		// A preset IS a doc from before the split: the legacy keys alone.
		const raw = (HW_PRESETS[name.slice('preset:'.length)] ?? gc.bookOfThermopylaePreset()) as Doc;
		check(`4 ${name}: baked before the split`, sameBoot(await bootOf(raw, doc), now));
	}
}
check(
	'4 a respin game booted',
	BOOTED.some((name) => (api.primaryHoldAndWin(docs[name]) as unknown) !== undefined),
);

// ─── 5: no reader of the legacy keys ──────────────────────────────────────────────────────────

/** The removed mirror helpers. */
const REMOVED =
	/\b(withLegacyPair|syncBonusSplit|splitFormOf|bonusSplitOf|legacyHoldAndWin|legacyPotsOverlay(Of)?)\b/;
/** A doc's top-level legacy key read: `doc.holdAndWin`, `config?.potsOverlay`,
 *  `getActiveGameConfig().holdAndWin`, `HOLD_AND_WIN_PRESETS.pots.holdAndWin`, … Wire objects (the
 *  boot `cfg`, the mock's `opts` / `inputs` / `grid`), capability flags and a mode's own rules
 *  (`mode.holdAndWin`, `decl.holdAndWin`) are named otherwise. */
const READ =
	/(\b(doc|docs\[[^\]]+\]|next|target|source|host|snapshot|stored|saved|kept|raw)|\.(config|doc)|\bgetActiveGameConfig\(\)|\bHOLD_AND_WIN_(PRESETS|TEST_FIXTURES)(\.\w+|\[[^\]]+\]))\??\.(holdAndWin|potsOverlay)\b/;

/** Sources that run in the product: every package and app source, the mocks and the test server. */
const SOURCES =
	/^(packages\/[^/]+\/src\/|apps\/[^/]+\/src\/|services\/[^/]+\/[^/]+\.m?js$|scripts\/mock-)/;
/** The legacy reader itself. */
const READER = new Set([
	'packages/game-config/src/bonusGames.ts',
	'packages/game-config/src/normalize.ts',
]);

function legacyReads(files: Record<string, string>): string[] {
	const found: string[] = [];
	for (const [file, text] of Object.entries(files)) {
		if (READER.has(file) || /\.(fixture|stories)\./.test(file)) continue;
		text.split('\n').forEach((line, i) => {
			const code = line
				.replace(/\/\*.*?(\*\/|$)/g, '')
				.replace(/\/\/.*$/, '')
				.replace(/^\s*\*.*$/, '');
			if (REMOVED.test(code) || READ.test(code)) found.push(`${file}:${i + 1}: ${line.trim()}`);
		});
	}
	return found;
}

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
	.split('\n')
	.filter((file) => SOURCES.test(file) && /\.(ts|mts|js|mjs|svelte)$/.test(file));
const sources = Object.fromEntries(
	tracked.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]),
);
const reads = legacyReads(sources);
check('5 no source reads a legacy key', reads.length === 0, reads.join('\n        '));
check(
	'5 the scan sees the sources',
	tracked.length > 500 && 'apps/lines/src/components/Game.svelte' in sources,
);

// ─── 6: mutations ─────────────────────────────────────────────────────────────────────────────

const mutantFails = (label: string, failed: boolean): void =>
	check(`6 mutant caught: ${label}`, failed);

// 1: a normalize that kept the mirror.
mutantFails(
	'normalize keeps the mirror',
	Object.values(docs).some((doc) => carriesLegacy(bakedOnMain(doc))),
);
// 2: a split form missing a piece of main's (a lost route).
{
	const doc = structuredClone(docs['legacy:lines+pots']);
	(doc.coinOverlay as { trigger?: unknown }).trigger = undefined;
	mutantFails('a lost route', digest(viewsOf(doc).split) !== MAIN['legacy:lines+pots']?.[0]);
	mutantFails(
		'a lost route in the derived block',
		digest(viewsOf(doc).holdAndWin) !== MAIN['legacy:lines+pots']?.[1],
	);
}
// 3: a doc that normalize would still change: one with a legacy key left on.
{
	const doc = docs['preset:pots'];
	const stale = { ...doc, holdAndWin: api.primaryHoldAndWin(doc) };
	mutantFails('not a fixed point', JSON.stringify(normalize(stale)) !== JSON.stringify(stale));
}
// 4: a runtime that read the baked config raw (as before 7b): a pre-split bundle has no respin mode.
{
	const raw = HW_PRESETS.pots;
	mutantFails(
		'a runtime reading the baked config raw',
		!api.primaryHoldAndWin(raw) && Boolean(api.primaryHoldAndWin(runtimeConfigOf(raw, raw))),
	);
}
// 5: a reader put back, each way.
for (const line of [
	'const block = doc.holdAndWin;',
	'if (getActiveGameConfig().potsOverlay?.timing) arm();',
	'const meters = HOLD_AND_WIN_PRESETS.pots.holdAndWin?.meters;',
	'const next = withLegacyPair(structuredClone(target));',
	'const missing = !bundle.config?.holdAndWin;',
]) {
	mutantFails(
		`a reader: ${line}`,
		legacyReads({ 'apps/lines/src/game/x.ts': `${line}\n` }).length === 1,
	);
}
mutantFails(
	'the legacy reader outside its allowance',
	legacyReads({
		'packages/game-config/src/x.ts': sources['packages/game-config/src/bonusGames.ts'],
	}).length > 0,
);
// …and none of the names that are not a doc's legacy key.
check(
	'5 wire, mock inputs, flags and a mode’s rules are not reads',
	legacyReads({
		'apps/lines/src/game/x.ts': [
			'const block = (cfg as { holdAndWin?: unknown }).holdAndWin;',
			'const inputs = opts.holdAndWin;',
			'if (grid.potsOverlay) start();',
			'if (caps.holdAndWin) show();',
			'const holdAndWin = kind || !!config.holdAndWin;',
			'if (preset.holdAndWin) merge(preset.potsOverlay);',
			'const rules = mode.holdAndWin;',
		].join('\n'),
	}).length === 0,
);

if (failures.length) {
	console.log(failures.join('\n'));
	console.log(`\n${failures.length} FAILED, ${passes} passed.`);
	process.exit(1);
}
console.log(`All bonus migration assertions passed (${passes}, ${Object.keys(docs).length} docs).`);
