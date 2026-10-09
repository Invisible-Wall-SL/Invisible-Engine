/**
 * BONUS GAMES Phase 8b — authoring a spins mode, importing a base game as one, and coin overlay
 * presets that bring what their pots start (`docs/design/bonus-games.md` §0):
 *
 *   pnpm --filter launcher-api check:bonus-authoring
 *
 * Runs the REAL writers over an in-memory R2: `/config`'s page shaping (`pageDoc.ts`) around the real
 * `gameConfigStorage.ts` save and the `game-config` spins-mode writers its Bonus modes section calls,
 * the Game Maker's `applyBonusImport` and `applyPotsOverlayAddOn`. Every deal goes through the
 * launcher's `mockContractOfBundle` and the test server's own `validGrid` + `makeMock`. Only R2, the
 * project lookup, leases and the bundle cache are stubbed.
 *
 * Pins:
 *  1. `/config`: every committed default (no spins mode) opens, saves and reloads byte-identically,
 *     with no strip set measured off the base grid. A lines project authors a CLUSTER spins mode on a
 *     7×7 grid of its own with its own pays and a buy route; its strips follow ITS grid; it saves,
 *     reloads and a bought round plays 4 cluster spins on 7×7. A Hold and Win or Book-of kind refuses
 *     a spins mode; the coin count may not start one. Removing it gives the doc back.
 *  2. Game Maker "Add a bonus mode…": project A's lines BASE game into a ways project B, as a spins
 *     mode bought on B's buy tier. Its win model, grid, paylines and every pay are copied explicitly;
 *     clashing symbols take `_2`; a bought round on B plays 10 lines spins on A's 5×3 board, paid on
 *     A's lines. A re-sync after editing A picks up A's new pays and lines, keeping the route, the id
 *     and the names. A Hold and Win host and a coin-count route are refused.
 *  3. "＋ Coin overlay…": 3 Pots and Collector add cleanly to the plain Hold and Win template and to
 *     the plain lines template, and each full pot deals its Hold and Win with its special active and
 *     that special's symbol on its respin strips (on the Hold and Win game, brought by the preset).
 *  4. Parity: every add-on result that was clean on main (each host × preset × pot count) is
 *     byte-identical to main's.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { mock } from 'node:test';
import type { GameConfigDoc } from 'game-config';

type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`conflict ${key}`);
	}
}
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const put = (key: string, body: unknown) =>
	R2.set(key, {
		body: typeof body === 'string' ? body : JSON.stringify(body),
		etag: `"e${++etagSeq}"`,
	});

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (base: string | null | undefined) =>
			base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
		objectExists: async (key: string) => R2.has(key),
		headObject: async (key: string) => (R2.has(key) ? { etag: R2.get(key)!.etag } : null),
		getObjectText: async (key: string) => R2.get(key)?.body ?? null,
		getObjectTextWithEtag: async (key: string) => {
			const o = R2.get(key);
			return o ? { text: o.body, etag: o.etag } : null;
		},
		putObjectText: async (
			key: string,
			text: string,
			_type: string,
			cond?: { ifMatch?: string; ifNoneMatch?: string },
		) => {
			const cur = R2.get(key);
			if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
			if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
			put(key, text);
			return R2.get(key)!.etag;
		},
		copyObject: async (from: string, to: string) => {
			const o = R2.get(from);
			if (!o) return false;
			put(to, o.body);
			return true;
		},
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
		listObjects: async () => ({ keys: [], prefixes: [] }),
		getObjectBytes: async () => null,
		putObjectBytes: async () => {
			throw new Error('unexpected putObjectBytes');
		},
		getObjectStream: async () => null,
		presignGet: async () => '',
		presignPut: async () => '',
		presignManifestEntries: async <T>(entries: T) => entries,
		jsonBaseEtag: () => undefined,
		formBaseEtag: () => undefined,
		deleteObject: async (key: string) => void R2.delete(key),
		listFolder: async () => ({ folders: [], files: [] }),
	},
});

const CLIENT = 'invisible_wall';
const KINDS: Record<string, string> = {
	cfg: 'lines',
	srcLines: 'lines',
	hostWays: 'ways',
	hostHw: 'holdAndWin',
	plainHw: 'holdAndWin',
	plainLines: 'lines',
};
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		projectGameType: async (p: string) => KINDS[p] ?? 'lines',
		projectClientKey: async () => CLIENT,
	},
});
mock.module(src('lib/server/lease.ts'), { namedExports: { liveLeases: async () => [] } });
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: { invalidateRuntimeBundle: () => undefined },
});
const ME = 'session-me';

const { loadGameConfigDocWithEtag, saveGameConfigDoc } =
	await import('../src/lib/server/gameConfigStorage.ts');
const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
const { adoptSaved, baseWidthGameTypes, bodyFor, gridMismatch, openDoc } =
	await import('../src/routes/(app)/config/pageDoc.ts');
const { applyBonusImport } = await import('../src/lib/server/projectBonusImport.ts');
const { applyPotsOverlayAddOn, cleanOverlayPresets } =
	await import('../src/lib/server/projectAddOn.ts');
const { scaffoldProject } = await import('../src/lib/server/projectScaffold.ts');
const { mockContractOfBundle } = await import('../src/lib/server/mockContract.ts');
const { protocolFor } = await import('../src/lib/server/mockProtocol.ts');
const { makeMock, validGrid } = await import('../../../services/test-server/makeMock.mjs');
const {
	POTS_OVERLAY_PRESET_IDS,
	addPotsOverlay,
	addSpinsMode,
	gameConfigErrors,
	normalizeGameConfigDoc,
	removeSpinsMode,
	setSpinsGrid,
	spinsGamesRefusal,
	spinsModeKindIssues,
	spinsWinModelFor,
	validateGameConfigDoc,
} = await import('game-config');

let failures = 0;
let passes = 0;
async function check(name: string, fn: () => void | Promise<void>) {
	try {
		await fn();
		passes += 1;
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures += 1;
		console.error(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
	}
}
function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}
const same = (a: unknown, b: unknown, msg: string) =>
	assert(
		JSON.stringify(a) === JSON.stringify(b),
		`${msg}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`,
	);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(clone(raw));
	assert(doc, 'config did not normalize');
	return doc;
};
const content = (doc: GameConfigDoc | null): string => {
	const { updatedAt: _at, ...rest } = doc ?? ({} as GameConfigDoc);
	return JSON.stringify(rest);
};
const docOf = (result: { ok: true; doc: GameConfigDoc } | { ok: false; reason: string }) => {
	if (!result.ok) throw new Error(result.reason);
	return result.doc;
};
const errorsOf = (doc: GameConfigDoc) =>
	validateGameConfigDoc(doc).filter((i) => i.severity === 'error');
const storedConfig = (project: string): GameConfigDoc =>
	JSON.parse(R2.get(gameConfigDocKey(CLIENT, project))!.body) as GameConfigDoc;

const DATA = new URL('../src/lib/data/gameConfig/', import.meta.url);
const TEMPLATES = readdirSync(DATA)
	.filter((f) => f.endsWith('.json'))
	.sort();
const template = (name: string): GameConfigDoc =>
	normalize(JSON.parse(readFileSync(new URL(`${name}.json`, DATA), 'utf8')));

// ─── playing a doc through the test server ────────────────────────────────────────────────────

type Event = { event: string; context?: unknown };
type Response = {
	events?: Event[];
	platform?: { gameRound?: { id?: string }; balance?: number };
};
type Mock = { handle: (req: unknown, res: unknown, url: URL) => Promise<void> };
const SEED = 'bonus-authoring';

/** One round of `doc` (a project of kind `kind`) as the client plays it, on the test server's own
 *  mock for the launcher's contract: bet option `option`, first play context `context`. */
async function playRound(
	kind: string,
	doc: GameConfigDoc,
	context: string | null,
	option = 0,
): Promise<Event[]> {
	const contract = mockContractOfBundle(
		protocolFor(kind),
		{ config: doc, symbols: { map: {}, index: {} } } as Parameters<typeof mockContractOfBundle>[1],
		SEED,
		kind,
	);
	process.env.SEED = SEED;
	const mock = makeMock(
		contract.protocol,
		SEED,
		validGrid(contract.grid),
		SEED,
		contract.cascade,
		true,
		true,
		false,
	) as Mock;
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')),
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	const post = (path: string, body: unknown): Promise<Response> =>
		new Promise((resolve, reject) => {
			const payload = JSON.stringify(body);
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path,
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(payload),
						connection: 'close',
					},
				},
				(res) => {
					let text = '';
					res.setEncoding('utf8');
					res.on('data', (chunk) => (text += chunk));
					res.on('end', () => resolve(JSON.parse(text) as Response));
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	const log = console.log;
	console.log = () => {};
	const events: Event[] = [];
	try {
		const sid = `${SEED}-${kind}-${context}-${option}`;
		const first = await post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
		const config = first.events?.find((e) => e.event === 'config')?.context as
			{ betOptions?: unknown[]; paylines?: unknown[]; availablePayLines?: unknown[] } | undefined;
		const lines = (config?.paylines ?? config?.availablePayLines ?? []).length;
		let seq = 0;
		let resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}`, [
			{ action: 'bet', context: [config?.betOptions?.length ? option : lines, 1] },
			{ action: 'play', context },
		]);
		seq += 2;
		events.push(...(resp.events ?? []));
		const gid = resp.platform?.gameRound?.id;
		const ended = () => events.some((e) => e.event === 'gameEnd');
		for (let guard = 0; gid && !ended() && guard < 300; guard++) {
			resp = await post(`/rgs/engine?sid=${sid}&seq=${seq++}&gid=${gid}`, [{ action: 'play' }]);
			events.push(...(resp.events ?? []));
		}
	} finally {
		console.log = log;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	return events;
}

/** What a spins round played after it entered its bonus: the trigger's bonus, each spin's board as
 *  `reels×rows`, and the win models it paid by. */
function spinsPlayed(events: Event[]) {
	const trigger = events.find((e) => e.event === 'spinTrigger')?.context as
		{ bonus?: string; spins?: { spins: number }[] } | undefined;
	const at = events.findIndex((e) => e.event === 'enterBonus');
	const boards = events
		.slice(at)
		.filter((e) => e.event === 'playedSpin')
		.map((e) => e.context as string[][])
		.map((b) => `${b.length}×${b[0]?.length}`);
	const wins = events
		.slice(at)
		.filter((e) => e.event === 'spinWin')
		.map((e) => e.context as { mode: string; what: string; context?: { paylineId?: number } })
		.filter((w) => w.what !== 'SCAT');
	return { bonus: trigger?.bonus, entered: at >= 0, boards, wins };
}

/** Each add-on result `addPotsOverlay(template, preset, pots)` gave on main 56f5342 that came out
 *  clean (no validator error), as `sha256(normalized doc, renames, notes)`; measured on main. */
const MAIN_ADD_ON_DIGESTS: Record<string, string> = {
	'holdAndWin.classic.json|coinsOnly|1': '826ba36f59cdbbd4',
	'holdAndWin.classic.json|coinsOnly|2': 'dd6179e47578d611',
	'holdAndWin.classic.json|coinsOnly|3': 'a52bf6059e8b932a',
	'holdAndWin.classic.json|coinsOnly|4': '318f20c434e530c8',
	'holdAndWin.classic.json|potsToFreeSpins|-': '2c4b6db883d2771f',
	'holdAndWin.classic.json|potsToFreeSpins|1': '2c4b6db883d2771f',
	'holdAndWin.classic.json|potsToFreeSpins|2': 'd8f397ca0d8a6ec1',
	'holdAndWin.classic.json|potsToFreeSpins|3': 'b8ddf5623a7b307a',
	'holdAndWin.classic.json|potsToFreeSpins|4': 'd37d126b915917d0',
	'holdAndWin.collector.json|coinsOnly|1': '7be1c55eeb758e06',
	'holdAndWin.collector.json|coinsOnly|2': '1a8db655e96bc39c',
	'holdAndWin.collector.json|coinsOnly|3': '963f4512a82a851d',
	'holdAndWin.collector.json|coinsOnly|4': 'f5bd7d707c18af51',
	'holdAndWin.collector.json|potsToFreeSpins|-': '750ad1c9983eca4c',
	'holdAndWin.collector.json|potsToFreeSpins|1': '750ad1c9983eca4c',
	'holdAndWin.collector.json|potsToFreeSpins|2': '27c9fc1a8fb40e61',
	'holdAndWin.collector.json|potsToFreeSpins|3': 'c6481da9c8cb2669',
	'holdAndWin.collector.json|potsToFreeSpins|4': 'c5898ebbb4b341a1',
	'holdAndWin.plain.json|coinsOnly|1': '4cb3d4cd66163fba',
	'holdAndWin.plain.json|coinsOnly|2': '2176da11dd0b5785',
	'holdAndWin.plain.json|coinsOnly|3': 'c467b0b8b3c50e14',
	'holdAndWin.plain.json|coinsOnly|4': 'facfb10599e85ef6',
	'holdAndWin.plain.json|potsToFreeSpins|-': 'e9a475c6c1f46fd7',
	'holdAndWin.plain.json|potsToFreeSpins|1': 'e9a475c6c1f46fd7',
	'holdAndWin.plain.json|potsToFreeSpins|2': 'a940cb39cd113d00',
	'holdAndWin.plain.json|potsToFreeSpins|3': '10dd34c5584bc3f1',
	'holdAndWin.plain.json|potsToFreeSpins|4': '4b781ebfc3aa99b8',
	'holdAndWin.plainNoJackpots.json|coinsOnly|1': 'cabac2b536aefb7a',
	'holdAndWin.plainNoJackpots.json|coinsOnly|2': 'd94a55764dff630a',
	'holdAndWin.plainNoJackpots.json|coinsOnly|3': '252f3f0a694c930b',
	'holdAndWin.plainNoJackpots.json|coinsOnly|4': 'e9d445eef4c1577c',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|-': 'dc1f572c5bf9b868',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|1': 'dc1f572c5bf9b868',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|2': '6f0ba5508e325164',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|3': '1286ac0aeccbcc5a',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|4': 'fdd5dbf1b0e93f50',
	'holdAndWin.pots.json|coinsOnly|1': '2fc328046bc4ef7b',
	'holdAndWin.pots.json|coinsOnly|2': 'a8ff24712df42e3f',
	'holdAndWin.pots.json|coinsOnly|3': 'd461c649a715d362',
	'holdAndWin.pots.json|coinsOnly|4': '94018888f75d88a1',
	'holdAndWin.pots.json|potsToFreeSpins|-': '396e06735d8afdcd',
	'holdAndWin.pots.json|potsToFreeSpins|1': '396e06735d8afdcd',
	'holdAndWin.pots.json|potsToFreeSpins|2': '0fee59587aa47189',
	'holdAndWin.pots.json|potsToFreeSpins|3': '943cb03e84af6183',
	'holdAndWin.pots.json|potsToFreeSpins|4': '0c5a327925c855d9',
	'holdAndWin.pots.json|threePots|-': '3b94f77832d7683f',
	'holdAndWin.pots.json|threePots|1': 'f34915f89bd77db7',
	'holdAndWin.pots.json|threePots|2': 'b9ae12397b18512b',
	'holdAndWin.pots.json|threePots|3': '3b94f77832d7683f',
	'holdAndWin.pots.json|threePots|4': 'd7b7794bdd9244c8',
	'lines.bookOfThermopylae.json|coinsOnly|-': 'b8bbb92ffa0f318e',
	'lines.bookOfThermopylae.json|coinsOnly|0': 'b8bbb92ffa0f318e',
	'lines.bookOfThermopylae.json|coinsOnly|1': 'd99e360254b2a060',
	'lines.bookOfThermopylae.json|coinsOnly|2': 'c8ed3e1f0ba5efde',
	'lines.bookOfThermopylae.json|coinsOnly|3': '8b0779ad3eaef055',
	'lines.bookOfThermopylae.json|coinsOnly|4': '7b4c4ef1803b1d85',
	'lines.bookOfThermopylae.json|potsToFreeSpins|-': '452b1bacf5963bf6',
	'lines.bookOfThermopylae.json|potsToFreeSpins|1': '452b1bacf5963bf6',
	'lines.bookOfThermopylae.json|potsToFreeSpins|2': 'bf5b52f0847d44ca',
	'lines.bookOfThermopylae.json|potsToFreeSpins|3': 'c7d69001003ff384',
	'lines.bookOfThermopylae.json|potsToFreeSpins|4': '4b53543e9ec469b2',
	'lines.bookOfThermopylae.json|threePots|-': '1da3c69c2aaf58da',
	'lines.bookOfThermopylae.json|threePots|0': '2219485b1d8a5533',
	'lines.bookOfThermopylae.json|threePots|1': 'bc187d4969b891dc',
	'lines.bookOfThermopylae.json|threePots|2': '473de9f0ee845eb4',
	'lines.bookOfThermopylae.json|threePots|3': '1da3c69c2aaf58da',
	'lines.bookOfThermopylae.json|threePots|4': '35972b5d34fb220f',
	'lines.json|coinsOnly|-': '28be965de6a1572f',
	'lines.json|coinsOnly|0': '28be965de6a1572f',
	'lines.json|coinsOnly|1': '6ec3ca8bea3acb88',
	'lines.json|coinsOnly|2': 'a6f32ffc559a032f',
	'lines.json|coinsOnly|3': 'e517d19a0c18b95e',
	'lines.json|coinsOnly|4': '86574315db7ffe7c',
	'lines.json|potsToFreeSpins|-': 'cfabf186ea17da2f',
	'lines.json|potsToFreeSpins|1': 'cfabf186ea17da2f',
	'lines.json|potsToFreeSpins|2': '8ce2376865f7636a',
	'lines.json|potsToFreeSpins|3': '6e972d85ae85deeb',
	'lines.json|potsToFreeSpins|4': '3bcf81ea73e08648',
	'lines.json|threePots|-': 'ca928285c8316318',
	'lines.json|threePots|0': '4897723a4d085800',
	'lines.json|threePots|1': '10b4d5da440a3100',
	'lines.json|threePots|2': '0d06142b7ceda65b',
	'lines.json|threePots|3': 'ca928285c8316318',
	'lines.json|threePots|4': '958716a9bbb6d53c',
	'scatter.json|potsToFreeSpins|-': '37fc4a03439f0e58',
	'scatter.json|potsToFreeSpins|1': '37fc4a03439f0e58',
	'scatter.json|potsToFreeSpins|2': 'fab5bc31d7d01d31',
	'scatter.json|potsToFreeSpins|3': '00354568f1aa99de',
	'scatter.json|potsToFreeSpins|4': '6587284f80b5ec85',
	'scatter.json|threePots|-': '98be92eb00626ba3',
	'scatter.json|threePots|0': '0ab1dd710208e82f',
	'scatter.json|threePots|1': '9e9c03c5444c0bf9',
	'scatter.json|threePots|2': '54c76041c7f47fc9',
	'scatter.json|threePots|3': '98be92eb00626ba3',
	'scatter.json|threePots|4': '61014dadcd32f1ce',
	'ways.json|coinsOnly|-': '6424020d9d1a197e',
	'ways.json|coinsOnly|0': '6424020d9d1a197e',
	'ways.json|coinsOnly|1': '2a9d2a50d0132bc1',
	'ways.json|coinsOnly|2': '8af6ba2941ffa464',
	'ways.json|coinsOnly|3': 'e05244cfffd57b18',
	'ways.json|coinsOnly|4': 'e336b868595a8ad3',
	'ways.json|potsToFreeSpins|-': 'a5c9c0aa41968b4d',
	'ways.json|potsToFreeSpins|1': 'a5c9c0aa41968b4d',
	'ways.json|potsToFreeSpins|2': '610fa2717b4890f6',
	'ways.json|potsToFreeSpins|3': 'd058221400b8cd68',
	'ways.json|potsToFreeSpins|4': 'd40f764bee5841e0',
	'ways.json|threePots|-': 'fe3347dea17256db',
	'ways.json|threePots|0': '5978d45d92a25027',
	'ways.json|threePots|1': 'ebe8812a4587413c',
	'ways.json|threePots|2': '45e489de2150a086',
	'ways.json|threePots|3': 'fe3347dea17256db',
	'ways.json|threePots|4': '9eb10ba7e7d1f4f8',
};

// ─── 1. /config: author a spins mode ──────────────────────────────────────────────────────────

console.log('\n1. /config: author a spins mode');

/** What `/config` does: open the stored doc in the split form. */
async function open(project: string) {
	const { doc, etag } = await loadGameConfigDocWithEtag(CLIENT, project);
	assert(doc, `${project}: nothing stored`);
	return { live: openDoc(doc), etag };
}
/** Save (the PUT body is the live doc, whole) and re-open what the save returned. */
async function save(project: string, live: GameConfigDoc, etag: string | null) {
	const saved = await saveGameConfigDoc(CLIENT, project, bodyFor(clone(live)), etag);
	return adoptSaved(saved.doc);
}
/** Main's strip-width readout: every strip set against the base grid. */
const mainMismatch = (doc: GameConfigDoc) =>
	Object.keys(doc.paddingReels).some((g) => doc.paddingReels[g].length !== doc.numReels) ||
	Object.keys(doc.paylines).some((id) => doc.paylines[id].length !== doc.numReels);

await check('every committed default opens, saves and reloads byte-identically', async () => {
	for (const file of TEMPLATES) {
		const key = `tpl-${file}`;
		put(gameConfigDocKey(CLIENT, key), template(file.replace(/\.json$/, '')));
		const before = content(storedConfig(key));
		const { live, etag } = await open(key);
		same(gridMismatch(live), mainMismatch(live), `${file}: the strip-width readout`);
		same(baseWidthGameTypes(live), Object.keys(live.paddingReels), `${file}: base-width strips`);
		await save(key, live, etag);
		same(content(storedConfig(key)), before, `${file}: the stored doc`);
	}
});

const LINES = template('lines');
put(gameConfigDocKey(CLIENT, 'cfg'), LINES);
const SPINS = 'clusterBonus';
const OWN_PAYS = { H1: [{ '5': 2 }, { '8': 10 }, { '12': 50 }] };
let authored: GameConfigDoc | undefined;

await check('a cluster spins mode on a 7×7 grid of its own, its strips on ITS grid', async () => {
	const { live: opened, etag } = await open('cfg');
	const live = docOf(addSpinsMode(opened, SPINS, 'Cluster bonus'));
	const mode = live.modes!.find((m) => m.id === SPINS)!;
	same(
		[mode.board, mode.gameType, mode.spins, live.paddingReels[SPINS].length],
		['reels', SPINS, { spins: 10 }, LINES.numReels],
		'a new spins mode plays the base game on the base strips',
	);
	mode.spins!.spins = 4;
	// As Bonus modes does: pick the game, then its threshold.
	const cluster = spinsWinModelFor('cluster');
	if (cluster.type === 'cluster') cluster.minCluster = 4;
	mode.spins!.winModel = cluster;
	setSpinsGrid(live, mode.spins!, SPINS, 7, [7, 7, 7, 7, 7, 7, 7]);
	mode.spins!.paytable = clone(OWN_PAYS);
	live.coinOverlay = {
		style: 'classic',
		trigger: { buy: [{ betMode: 'bonus', mode: SPINS, guaranteed: [], boostedSpecials: false }] },
	};
	same(live.paddingReels[SPINS].length, 7, 'its strips follow its grid');
	same(live.paddingReels.basegame, LINES.paddingReels.basegame, 'the base strips are untouched');
	same(gridMismatch(live), false, 'no strip set reads as off its grid');
	same(baseWidthGameTypes(live).includes(SPINS), false, 'its strips are not base-width');
	same(mainMismatch(live), true, "main's readout would have measured it on the base grid");
	same(errorsOf(normalize(live)), [], 'it validates');
	same(spinsModeKindIssues(live, 'lines'), [], 'a lines game plays it');
	authored = await save('cfg', live, etag);
	same(
		authored.modes!.find((m) => m.id === SPINS)?.spins,
		{
			spins: 4,
			winModel: { type: 'cluster', minCluster: 4, adjacency: 'orthogonal' },
			numReels: 7,
			numRows: [7, 7, 7, 7, 7, 7, 7],
			paytable: OWN_PAYS,
		},
		'it saves sparse: no paylines, every other field its own',
	);
});

await check('a bought round plays 4 cluster spins on its 7×7 grid', async () => {
	assert(authored, 'nothing authored');
	const played = spinsPlayed(await playRound('lines', storedConfig('cfg'), null, 1));
	same(played.bonus, SPINS, 'the buy starts it');
	same(played.boards, ['7×7', '7×7', '7×7', '7×7'], 'its boards');
	same(
		played.wins.length > 0 && played.wins.every((w) => w.mode === 'cluster'),
		true,
		'paid by clusters only',
	);
});

await check('a Hold and Win or Book-of game refuses it; the coin count may not start it', () => {
	assert(authored, 'nothing authored');
	for (const kind of ['holdAndWin', 'bookOf']) {
		same(
			spinsModeKindIssues(authored, kind).map((i) => [i.path, i.severity]),
			[[`modes.${SPINS}.spins`, 'error']],
			kind,
		);
		assert(spinsGamesRefusal(kind), `${kind}: no refusal for the Add button`);
	}
	same(spinsGamesRefusal('lines'), undefined, 'lines adds one');
	const counted = clone(authored);
	counted.coinOverlay!.trigger!.count = { min: 6, roles: ['coin'], mode: SPINS };
	assert(
		errorsOf(normalize(counted)).some((i) => i.path.startsWith('coinOverlay.trigger.count')),
		'a coin count route to a spins mode saves',
	);
});

await check('removing it gives back the doc it was added to', () => {
	assert(authored, 'nothing authored');
	same(
		content(normalize(docOf(removeSpinsMode(authored, SPINS)))),
		content(normalize(LINES)),
		'the doc',
	);
});

// ─── 2. Game Maker: a base game as a spins mode ───────────────────────────────────────────────

console.log('\n2. Game Maker: "Add a bonus mode…" from another project\'s base game');

const SOURCE = 'srcLines';
const HOST = 'hostWays';
const WAYS = template('ways');
put(gameConfigDocKey(CLIENT, SOURCE), LINES);
put(gameConfigDocKey(CLIENT, HOST), WAYS);
const BUY = [{ kind: 'buy' as const, betMode: 'bonus' }];
let imported = '';
let names: Record<string, string> = {};

await check('the lines base game arrives as a self-contained spins mode', async () => {
	const out = await applyBonusImport(CLIENT, HOST, {
		source: SOURCE,
		mode: 'basegame',
		asMode: true,
		routes: BUY,
		sessionId: ME,
		at: '2026-10-09T00:00:00.000Z',
	});
	assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
	imported = out.mode;
	const host = storedConfig(HOST);
	const mode = host.modes!.find((m) => m.id === imported)!;
	names = host.imports!.find((i) => i.mode === imported)!.symbols;
	same(
		[mode.board, mode.gameType, mode.label],
		['reels', imported, `Base game (${SOURCE})`],
		'a reels mode of its own',
	);
	same(
		[mode.spins?.winModel, mode.spins?.numReels, mode.spins?.numRows, mode.spins?.paylines],
		[{ type: 'lines' }, LINES.numReels, LINES.numRows, LINES.paylines],
		'its win model, grid and paylines, explicit',
	);
	same(
		mode.spins?.paytable,
		Object.fromEntries(
			Object.entries(names).flatMap(([from, to]) =>
				LINES.symbols[from]?.paytable?.length ? [[to, LINES.symbols[from].paytable]] : [],
			),
		),
		'every pay of every symbol it deals, explicit',
	);
	assert(Object.keys(out.renamed.symbols).length > 0, 'nothing clashed');
	same(
		Object.entries(out.renamed.symbols).every(([from, to]) => to === `${from}_2`),
		true,
		'a clashing symbol takes _2',
	);
	same(
		host.paddingReels[imported],
		LINES.paddingReels.basegame.map((strip) => strip.map((c) => ({ name: names[c.name] }))),
		'its strips, renamed',
	);
	same(
		[host.winModel, host.paddingReels.basegame, host.paylines],
		[WAYS.winModel, WAYS.paddingReels.basegame, WAYS.paylines],
		"the host's own game is untouched",
	);
	same(errorsOf(host), [], 'the host validates');
	same(
		host.coinOverlay?.trigger?.buy?.map((t) => [t.betMode, t.mode]),
		[['bonus', imported]],
		'the buy starts it',
	);
});

await check("a bought round on the ways host plays the source's lines game", async () => {
	const played = spinsPlayed(await playRound('ways', storedConfig(HOST), null, 1));
	same(played.bonus, imported, 'the buy starts it');
	same(played.boards, Array(10).fill('5×3'), "10 spins on the source's 5×3 board");
	const lineIds = Object.keys(LINES.paylines).map(Number);
	same(
		played.wins.length > 0 &&
			played.wins.every((w) => w.mode === 'line' && lineIds.includes(w.context?.paylineId ?? 0)),
		true,
		"paid on the source's lines only",
	);
});

await check(
	'a re-sync picks up the source edit, keeping the route, id, names and count',
	async () => {
		const edited = clone(LINES);
		edited.symbols.H1.paytable = [{ '3': 7 }, { '4': 70 }, { '5': 700 }];
		edited.paylines['1'] = [0, 1, 0, 1, 0];
		put(gameConfigDocKey(CLIENT, SOURCE), normalize(edited));
		const host = storedConfig(HOST);
		host.modes!.find((m) => m.id === imported)!.spins!.spins = 6;
		put(gameConfigDocKey(CLIENT, HOST), host);
		const out = await applyBonusImport(CLIENT, HOST, {
			mode: imported,
			resync: true,
			sessionId: ME,
			at: '2026-10-09T01:00:00.000Z',
		});
		assert(out.ok && out.resynced, `refused: ${out.ok ? '' : out.error}`);
		const synced = storedConfig(HOST);
		const mode = synced.modes!.find((m) => m.id === imported)!;
		same(mode.spins?.paytable?.[names.H1], edited.symbols.H1.paytable, "the source's new pays");
		same(mode.spins?.paylines?.['1'], [0, 1, 0, 1, 0], "the source's new line");
		same(mode.spins?.spins, 6, 'the spin count set here');
		same(synced.imports!.find((i) => i.mode === imported)!.symbols, names, 'the same names');
		same(
			synced.coinOverlay?.trigger?.buy?.map((t) => [t.betMode, t.mode]),
			[['bonus', imported]],
			'the route',
		);
		same(errorsOf(synced), [], 'it validates');
	},
);

await check('a Hold and Win host and a coin-count route are refused', async () => {
	put(gameConfigDocKey(CLIENT, 'hostHw'), template('holdAndWin.plain'));
	const hw = await applyBonusImport(CLIENT, 'hostHw', {
		source: SOURCE,
		mode: 'basegame',
		asMode: true,
		sessionId: ME,
	});
	same(hw.ok ? 'added' : [hw.status, hw.error], [409, spinsGamesRefusal('holdAndWin')], 'kind');
	put(gameConfigDocKey(CLIENT, 'cfg-count'), LINES);
	const counted = await applyBonusImport(CLIENT, 'cfg-count', {
		source: SOURCE,
		mode: 'basegame',
		asMode: true,
		routes: [{ kind: 'count' }],
		sessionId: ME,
	});
	same(
		counted.ok ? 'added' : counted.error,
		'A spins mode is started by a pot, a buy, Lucky Spin or the random metre.',
		'route',
	);
});

// ─── 3. ＋ Coin overlay: presets that bring what their pots start ─────────────────────────────

console.log('\n3. "＋ Coin overlay…" on a plain Hold and Win and a plain lines game');

const ROLE_OF = { payer: 'payer', collector: 'collector', multiplier: 'coinMultiplier' } as const;

for (const [host, kind] of [
	['plainHw', 'holdAndWin'],
	['plainLines', 'lines'],
] as const) {
	for (const preset of ['threePots', 'collector'] as const) {
		const project = `${host}-${preset}`;
		KINDS[project] = kind;
		await check(
			`${preset} on the ${host}: added clean, each full pot deals its bonus`,
			async () => {
				await scaffoldProject(
					CLIENT,
					project,
					kind === 'holdAndWin' ? { holdAndWinJackpots: 'on' } : {},
				);
				// A lines project plays its kind's template until its config is first saved.
				const before = R2.has(gameConfigDocKey(CLIENT, project))
					? storedConfig(project)
					: template(kind === 'lines' ? 'lines' : 'holdAndWin.plain');
				assert(cleanOverlayPresets(before).includes(preset), `${preset} is not offered`);
				const out = await applyPotsOverlayAddOn(CLIENT, project, { sessionId: ME, preset });
				assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
				const config = storedConfig(project);
				same(gameConfigErrors(normalize(config)), [], 'it validates');
				same(config.coinOverlay?.style, preset === 'threePots' ? 'pots' : 'collector', 'its style');
				const rules = config.modes!.find((m) => m.id === 'holdAndWin')!.holdAndWin!;
				const pots = config.coinOverlay!.pots!;
				for (const pot of pots) {
					const special = pot.bonus.activates!;
					assert(rules.specials[special], `the ${special} ${pot.id} starts is not configured`);
					const role = ROLE_OF[special as keyof typeof ROLE_OF];
					const landing = Object.keys(config.symbols).filter((n) =>
						config.symbols[n].special_properties?.includes(role),
					);
					assert(
						config.paddingReels[
							config.modes!.find((m) => m.id === 'holdAndWin')!.gameType ?? 'respin'
						].some((strip) => strip.some((c) => landing.includes(c.name))),
						`no ${role} symbol on its respin strips`,
					);
					const events = await playRound(kind, config, `force:pot:${pot.id}`);
					const trigger = events.find((e) => e.event === 'holdAndWinTrigger')?.context as
						{ cause?: string; meters?: string[]; activeModifiers?: string[] } | undefined;
					same(
						[trigger?.cause, trigger?.meters, trigger?.activeModifiers?.includes(special)],
						['meter', [pot.id], true],
						`pot ${pot.id} starts the Hold and Win with its ${special}`,
					);
					assert(
						events.some((e) => e.event === 'holdAndWinEnd'),
						`pot ${pot.id}'s bonus never ended`,
					);
				}
			},
		);
	}
}

// ─── 4. parity: every add-on main dealt cleanly ───────────────────────────────────────────────

console.log('\n4. add-on parity with main');

await check('every add-on result clean on main is byte-identical', () => {
	const moved: string[] = [];
	for (const file of TEMPLATES) {
		const doc = template(file.replace(/\.json$/, ''));
		for (const preset of POTS_OVERLAY_PRESET_IDS) {
			for (const pots of [undefined, 0, 1, 2, 3, 4]) {
				const key = `${file}|${preset}|${pots ?? '-'}`;
				if (!(key in MAIN_ADD_ON_DIGESTS)) continue;
				const result = addPotsOverlay(doc, preset, pots);
				const digest = createHash('sha256')
					.update(
						JSON.stringify(
							result.ok
								? {
										doc: normalizeGameConfigDoc(result.doc),
										renamed: result.renamed,
										notes: result.notes,
									}
								: result,
						),
					)
					.digest('hex')
					.slice(0, 16);
				if (digest !== MAIN_ADD_ON_DIGESTS[key]) moved.push(key);
			}
		}
	}
	same(moved, [], 'moved');
	same(Object.keys(MAIN_ADD_ON_DIGESTS).length, 112, 'cases');
});

console.log(
	failures
		? `\ncheck:bonus-authoring — ${failures} FAILED, ${passes} passed`
		: `\ncheck:bonus-authoring — all ${passes} passed`,
);
process.exit(failures ? 1 : 0);
