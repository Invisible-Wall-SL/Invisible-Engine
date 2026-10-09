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
 *     A's lines; its symbols carry no pays of their own, so B's paytable lists none. A re-sync after
 *     editing A picks up A's new pays and lines, keeping the route, the id, the names and the rest of
 *     the mode as B set it. A Hold and Win host, a Hold and Win or Book-of source and a coin-count
 *     route are refused.
 *  3. "＋ Coin overlay…": 3 Pots and Collector add cleanly to the plain Hold and Win template and to
 *     the plain lines template, and each full pot deals its Hold and Win with its special active and
 *     that special's symbol on its respin strips (on the Hold and Win game, brought by the preset).
 *  4. Parity: every add-on result that was clean on main is byte-identical to main's: each template
 *     × preset × pot count, and each lines / Book-of / ways host with a Hold and Win bonus added
 *     before or after the overlay. 3 Pots keeping one pot brings only that pot's special.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { mock } from 'node:test';
import type { GameConfigDoc } from 'game-config';
import { withoutMirror } from './lib/withoutMirror.ts';

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
	HOLD_AND_WIN_PRESET_IDS,
	POTS_OVERLAY_PRESET_IDS,
	addHoldAndWinBonus,
	addPotsOverlay,
	addSpinsMode,
	gameConfigErrors,
	normalizeGameConfigDoc,
	removeSpinsMode,
	setSpinsGrid,
	importableFeatures,
	spinsGamesRefusal,
	spinsModeKindIssues,
	spinsSourceRefusal,
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
 *  clean (no validator error), as `sha256(normalized doc, renames, notes)`; re-measured on main
 *  65d47c1 with the doc's legacy mirror keys taken off (`withoutMirror`, bonus-games Phase 7b). */
const MAIN_ADD_ON_DIGESTS: Record<string, string> = {
	'holdAndWin.classic.json|coinsOnly|1': '3da5bf460c677342',
	'holdAndWin.classic.json|coinsOnly|2': '70f79ff29c11b3b8',
	'holdAndWin.classic.json|coinsOnly|3': '2143d670b389ffcc',
	'holdAndWin.classic.json|coinsOnly|4': 'd2c08fdce6fe23a8',
	'holdAndWin.classic.json|potsToFreeSpins|-': '08dc1a52415014d3',
	'holdAndWin.classic.json|potsToFreeSpins|1': '08dc1a52415014d3',
	'holdAndWin.classic.json|potsToFreeSpins|2': 'd891c88589587df8',
	'holdAndWin.classic.json|potsToFreeSpins|3': 'd10574552f2b7874',
	'holdAndWin.classic.json|potsToFreeSpins|4': 'ce1eabcbd0b81028',
	'holdAndWin.collector.json|coinsOnly|1': 'd53ae0245569fb04',
	'holdAndWin.collector.json|coinsOnly|2': '039f2cc8f1d85650',
	'holdAndWin.collector.json|coinsOnly|3': '9e136315100f5415',
	'holdAndWin.collector.json|coinsOnly|4': 'e37c31e022e03337',
	'holdAndWin.collector.json|potsToFreeSpins|-': 'cf12e06e1e1b7a86',
	'holdAndWin.collector.json|potsToFreeSpins|1': 'cf12e06e1e1b7a86',
	'holdAndWin.collector.json|potsToFreeSpins|2': '0faab1d4088c8d35',
	'holdAndWin.collector.json|potsToFreeSpins|3': '299186da78ffbc73',
	'holdAndWin.collector.json|potsToFreeSpins|4': 'e24e55df180e5524',
	'holdAndWin.plain.json|coinsOnly|1': '779357d482d3b7c6',
	'holdAndWin.plain.json|coinsOnly|2': '0fdcf6c0dbf17be3',
	'holdAndWin.plain.json|coinsOnly|3': 'dc54a46124581947',
	'holdAndWin.plain.json|coinsOnly|4': '63a8cf3b2c7306e1',
	'holdAndWin.plain.json|potsToFreeSpins|-': '30b4923312bc29d4',
	'holdAndWin.plain.json|potsToFreeSpins|1': '30b4923312bc29d4',
	'holdAndWin.plain.json|potsToFreeSpins|2': '30cf1f24d8a2ed67',
	'holdAndWin.plain.json|potsToFreeSpins|3': '1f6a210505a6a6d2',
	'holdAndWin.plain.json|potsToFreeSpins|4': '2df7c166afaabd81',
	'holdAndWin.plainNoJackpots.json|coinsOnly|1': 'e092bb91ff769d67',
	'holdAndWin.plainNoJackpots.json|coinsOnly|2': '21b139a680fee6f9',
	'holdAndWin.plainNoJackpots.json|coinsOnly|3': '80cd2a2831e10f30',
	'holdAndWin.plainNoJackpots.json|coinsOnly|4': '873bc4cefb6740ba',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|-': '8ba68f2a74cff230',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|1': '8ba68f2a74cff230',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|2': 'a6bba0c022fae701',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|3': 'dcc1bc82e31d68b0',
	'holdAndWin.plainNoJackpots.json|potsToFreeSpins|4': '3ef552f698af5a00',
	'holdAndWin.pots.json|coinsOnly|1': 'e8fbc88c042f56a8',
	'holdAndWin.pots.json|coinsOnly|2': '7aa1c2936c95f8cb',
	'holdAndWin.pots.json|coinsOnly|3': 'c9ebec4387e647e9',
	'holdAndWin.pots.json|coinsOnly|4': '8c4ee5100ac3ac8b',
	'holdAndWin.pots.json|potsToFreeSpins|-': '3a99982094e42fd9',
	'holdAndWin.pots.json|potsToFreeSpins|1': '3a99982094e42fd9',
	'holdAndWin.pots.json|potsToFreeSpins|2': '1c00f7b20b96f887',
	'holdAndWin.pots.json|potsToFreeSpins|3': '9f91cb99648f12af',
	'holdAndWin.pots.json|potsToFreeSpins|4': 'ddf6d118d6d2cfb8',
	'holdAndWin.pots.json|threePots|-': 'b094eb645f1a3847',
	'holdAndWin.pots.json|threePots|1': '7acf42b00c048324',
	'holdAndWin.pots.json|threePots|2': '7e741a1fe4289deb',
	'holdAndWin.pots.json|threePots|3': 'b094eb645f1a3847',
	'holdAndWin.pots.json|threePots|4': '29b41009c3d34bc5',
	'lines.bookOfThermopylae.json|coinsOnly|-': '71b151ac67caf6a6',
	'lines.bookOfThermopylae.json|coinsOnly|0': '71b151ac67caf6a6',
	'lines.bookOfThermopylae.json|coinsOnly|1': 'f00d22dda9677734',
	'lines.bookOfThermopylae.json|coinsOnly|2': 'c92b768158984c5c',
	'lines.bookOfThermopylae.json|coinsOnly|3': 'a6693986cce3f7b2',
	'lines.bookOfThermopylae.json|coinsOnly|4': '85942ea0c17969ce',
	'lines.bookOfThermopylae.json|potsToFreeSpins|-': 'ee269c06ad960962',
	'lines.bookOfThermopylae.json|potsToFreeSpins|1': 'ee269c06ad960962',
	'lines.bookOfThermopylae.json|potsToFreeSpins|2': 'f7ad03c448cd152c',
	'lines.bookOfThermopylae.json|potsToFreeSpins|3': '7a339fb4157f6aeb',
	'lines.bookOfThermopylae.json|potsToFreeSpins|4': '702fc3913b0e6312',
	'lines.bookOfThermopylae.json|threePots|-': '1ddfabf3b5f1e76b',
	'lines.bookOfThermopylae.json|threePots|0': 'afff064c00ab3889',
	'lines.bookOfThermopylae.json|threePots|1': '4b776cece9f044d8',
	'lines.bookOfThermopylae.json|threePots|2': 'bbeb646fcb1b55f5',
	'lines.bookOfThermopylae.json|threePots|3': '1ddfabf3b5f1e76b',
	'lines.bookOfThermopylae.json|threePots|4': 'e822f38d4ebe3a05',
	'lines.json|coinsOnly|-': '766d41bed8dc3cfd',
	'lines.json|coinsOnly|0': '766d41bed8dc3cfd',
	'lines.json|coinsOnly|1': '256acda48a84e80e',
	'lines.json|coinsOnly|2': 'b00fb53f68ad04c6',
	'lines.json|coinsOnly|3': '1c8819b68549cab7',
	'lines.json|coinsOnly|4': 'f75c5010633df9f0',
	'lines.json|potsToFreeSpins|-': '2b231cb220fe7f73',
	'lines.json|potsToFreeSpins|1': '2b231cb220fe7f73',
	'lines.json|potsToFreeSpins|2': '40aa554d1cc8e90e',
	'lines.json|potsToFreeSpins|3': 'f7b2448132c0211f',
	'lines.json|potsToFreeSpins|4': '34fdfdb9b7c6fe71',
	'lines.json|threePots|-': '1d2bbf48878eb5b3',
	'lines.json|threePots|0': 'eb4cc726319ca0de',
	'lines.json|threePots|1': '228bf922e8950e63',
	'lines.json|threePots|2': 'cfe2313f9daa13c8',
	'lines.json|threePots|3': '1d2bbf48878eb5b3',
	'lines.json|threePots|4': '816eff9c637ecfee',
	'scatter.json|potsToFreeSpins|-': '34522fde54453fee',
	'scatter.json|potsToFreeSpins|1': '34522fde54453fee',
	'scatter.json|potsToFreeSpins|2': '98d31f3c081343ab',
	'scatter.json|potsToFreeSpins|3': '3b1eb4670adc7e8a',
	'scatter.json|potsToFreeSpins|4': '88612db77342803e',
	'scatter.json|threePots|-': 'b0c656560ac1a287',
	'scatter.json|threePots|0': 'c0f7c37c09d30320',
	'scatter.json|threePots|1': '175305004e015614',
	'scatter.json|threePots|2': '4eabfac7558ccbc5',
	'scatter.json|threePots|3': 'b0c656560ac1a287',
	'scatter.json|threePots|4': 'eda6626e9e201cfb',
	'ways.json|coinsOnly|-': 'fa4e677d30ce5638',
	'ways.json|coinsOnly|0': 'fa4e677d30ce5638',
	'ways.json|coinsOnly|1': '061a0d998bb3420f',
	'ways.json|coinsOnly|2': '583ee51fcb872444',
	'ways.json|coinsOnly|3': 'a248038bf7b801af',
	'ways.json|coinsOnly|4': 'cfe8092559f49ab3',
	'ways.json|potsToFreeSpins|-': '57531be9342d51aa',
	'ways.json|potsToFreeSpins|1': '57531be9342d51aa',
	'ways.json|potsToFreeSpins|2': '8294bce9311815b2',
	'ways.json|potsToFreeSpins|3': '0336f51866ca1b4c',
	'ways.json|potsToFreeSpins|4': '00710a6dd0d26e7a',
	'ways.json|threePots|-': 'ddeafabf3336d36d',
	'ways.json|threePots|0': 'd07530702bbc9082',
	'ways.json|threePots|1': '3393c4d01cbc865e',
	'ways.json|threePots|2': 'c2233eda4a67af9d',
	'ways.json|threePots|3': 'ddeafabf3336d36d',
	'ways.json|threePots|4': '0d08bf0b91a9b905',
};

/** The add-on over a host that already has a Hold and Win bonus (`addHoldAndWinBonus`), and the bonus
 *  added after the overlay, on lines, Book-of and ways: every case clean on main 4067dfb, digested as
 *  above (re-measured on main 65d47c1). */
const MAIN_BONUS_HOST_DIGESTS: Record<string, string> = {
	'lines+classic|coinsOnly|-': '766d41bed8dc3cfd',
	'lines+classic|coinsOnly|0': '766d41bed8dc3cfd',
	'lines+classic|coinsOnly|1': '256acda48a84e80e',
	'lines+classic|coinsOnly|2': 'b00fb53f68ad04c6',
	'lines+classic|coinsOnly|3': '1c8819b68549cab7',
	'lines+classic|coinsOnly|4': 'f75c5010633df9f0',
	'lines+classic|potsToFreeSpins|0': 'c03d548f706e4c22',
	'lines+classic|threePots|0': 'ec0da22d1d3c31fd',
	'lines+collector|coinsOnly|1': '3d90d68e42788261',
	'lines+collector|coinsOnly|2': '852f74bc53873a6d',
	'lines+collector|coinsOnly|3': '04721eb8196cf5c8',
	'lines+collector|coinsOnly|4': 'f9dd001d71e5523e',
	'lines+pots|coinsOnly|-': '6003ca08abf87da5',
	'lines+pots|coinsOnly|0': '6003ca08abf87da5',
	'lines+pots|coinsOnly|1': '35f64b13d62cf2e6',
	'lines+pots|coinsOnly|2': 'c9456f35ca3d0624',
	'lines+pots|coinsOnly|3': '4a46e784e1259387',
	'lines+pots|coinsOnly|4': '1e49d0405cfe40f5',
	'lines+pots|potsToFreeSpins|0': 'bc7fd0d0062ca6c8',
	'lines+pots|threePots|-': '1284ce38f39afe95',
	'lines+pots|threePots|0': 'b99798b8d07c7cea',
	'lines+pots|threePots|1': '70562f685ed1403f',
	'lines+pots|threePots|2': '9d49d3f6c53837c8',
	'lines+pots|threePots|3': '1284ce38f39afe95',
	'lines+pots|threePots|4': 'b35218ddb13652d0',
	'lines.bookOfThermopylae+classic|coinsOnly|-': '71b151ac67caf6a6',
	'lines.bookOfThermopylae+classic|coinsOnly|0': '71b151ac67caf6a6',
	'lines.bookOfThermopylae+classic|coinsOnly|1': 'f00d22dda9677734',
	'lines.bookOfThermopylae+classic|coinsOnly|2': 'c92b768158984c5c',
	'lines.bookOfThermopylae+classic|coinsOnly|3': 'a6693986cce3f7b2',
	'lines.bookOfThermopylae+classic|coinsOnly|4': '85942ea0c17969ce',
	'lines.bookOfThermopylae+classic|potsToFreeSpins|0': 'fa5880c87c371133',
	'lines.bookOfThermopylae+classic|threePots|0': 'edc5ba35bc0eb57a',
	'lines.bookOfThermopylae+collector|coinsOnly|1': '5d5efd71ef80bf10',
	'lines.bookOfThermopylae+collector|coinsOnly|2': 'bfce4a054f5d3f69',
	'lines.bookOfThermopylae+collector|coinsOnly|3': '9517c01d3438a38e',
	'lines.bookOfThermopylae+collector|coinsOnly|4': '2d4078f2d532569b',
	'lines.bookOfThermopylae+pots|coinsOnly|-': 'c78670687be44452',
	'lines.bookOfThermopylae+pots|coinsOnly|0': 'c78670687be44452',
	'lines.bookOfThermopylae+pots|coinsOnly|1': '38a420be15d6e7ba',
	'lines.bookOfThermopylae+pots|coinsOnly|2': 'd1437e3eaf769576',
	'lines.bookOfThermopylae+pots|coinsOnly|3': '2fd87a5073e7b690',
	'lines.bookOfThermopylae+pots|coinsOnly|4': '376367fe2a953a7a',
	'lines.bookOfThermopylae+pots|potsToFreeSpins|0': '61f5ad735019e256',
	'lines.bookOfThermopylae+pots|threePots|-': 'eed396b636de1987',
	'lines.bookOfThermopylae+pots|threePots|0': '3e2fe23e31b1bfa6',
	'lines.bookOfThermopylae+pots|threePots|1': 'd7d3afecbc5c8db9',
	'lines.bookOfThermopylae+pots|threePots|2': '377f7185df8f5f70',
	'lines.bookOfThermopylae+pots|threePots|3': 'eed396b636de1987',
	'lines.bookOfThermopylae+pots|threePots|4': '344cc407ec985072',
	'ways+classic|coinsOnly|-': 'fa4e677d30ce5638',
	'ways+classic|coinsOnly|0': 'fa4e677d30ce5638',
	'ways+classic|coinsOnly|1': '061a0d998bb3420f',
	'ways+classic|coinsOnly|2': '583ee51fcb872444',
	'ways+classic|coinsOnly|3': 'a248038bf7b801af',
	'ways+classic|coinsOnly|4': 'cfe8092559f49ab3',
	'ways+classic|potsToFreeSpins|0': '4cc8ae3eb426e9ab',
	'ways+classic|threePots|0': '1328fc5fa0e38f3c',
	'ways+collector|coinsOnly|1': '4f613ffe39b6bb44',
	'ways+collector|coinsOnly|2': '9a4a7c9f9d06b99a',
	'ways+collector|coinsOnly|3': 'd8514f33ad425e3c',
	'ways+collector|coinsOnly|4': '712d5be1993f2f31',
	'ways+pots|coinsOnly|-': '314115de08c55445',
	'ways+pots|coinsOnly|0': '314115de08c55445',
	'ways+pots|coinsOnly|1': 'd355300d5d70a6e1',
	'ways+pots|coinsOnly|2': 'e8b25e124297567b',
	'ways+pots|coinsOnly|3': 'eff0ba82bd4e3dc8',
	'ways+pots|coinsOnly|4': 'f4084adfab43a0ec',
	'ways+pots|potsToFreeSpins|0': '2b56b2a7ab04b655',
	'ways+pots|threePots|-': '186e48055a9f3740',
	'ways+pots|threePots|0': '449021516eb3a43d',
	'ways+pots|threePots|1': 'd1f002559e38ce74',
	'ways+pots|threePots|2': '797a0553d411a2e6',
	'ways+pots|threePots|3': '186e48055a9f3740',
	'ways+pots|threePots|4': 'c2cf9d3495cc01de',
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
	same(
		Object.values(names).filter((name) => host.symbols[name]?.paytable),
		[],
		"its symbols carry no pays of their own (they are the mode's), so the host's paytable lists none",
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
		const own = host.modes!.find((m) => m.id === imported)!;
		own.spins!.spins = 6;
		own.music = 'bonusTheme';
		own.values = ['total'];
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
		same(
			[mode.music, mode.values, mode.counter, mode.label],
			['bonusTheme', ['total'], 'freeSpins', `Base game (${SOURCE})`],
			'the rest of the mode as set here',
		);
		same(synced.imports!.find((i) => i.mode === imported)!.symbols, names, 'the same names');
		same(
			synced.coinOverlay?.trigger?.buy?.map((t) => [t.betMode, t.mode]),
			[['bonus', imported]],
			'the route',
		);
		same(errorsOf(synced), [], 'it validates');
	},
);

await check("a Hold and Win or Book-of source's base game is not offered, nor added", async () => {
	const plain = template('holdAndWin.plain');
	for (const kind of ['holdAndWin', 'bookOf']) {
		same(
			importableFeatures(plain, kind)[0],
			{
				mode: 'basegame',
				label: 'Base game (lines), as N spins',
				board: 'reels',
				spins: true,
				refused: spinsSourceRefusal(kind),
			},
			kind,
		);
	}
	same(importableFeatures(LINES, 'lines')[0].refused, undefined, 'a lines source');
	KINDS.srcHw = 'holdAndWin';
	put(gameConfigDocKey(CLIENT, 'srcHw'), plain);
	put(gameConfigDocKey(CLIENT, 'cfg-hw-source'), LINES);
	const out = await applyBonusImport(CLIENT, 'cfg-hw-source', {
		source: 'srcHw',
		mode: 'basegame',
		asMode: true,
		sessionId: ME,
	});
	same(out.ok ? 'added' : out.error, spinsSourceRefusal('holdAndWin'), 'refused');
});

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

const addOnDigest = (result: ReturnType<typeof addPotsOverlay>) =>
	createHash('sha256')
		.update(
			JSON.stringify(
				result.ok
					? {
							doc: withoutMirror(normalizeGameConfigDoc(result.doc)),
							renamed: result.renamed,
							notes: result.notes,
						}
					: result,
			),
		)
		.digest('hex')
		.slice(0, 16);
const POT_COUNTS = [undefined, 0, 1, 2, 3, 4];

await check('every add-on result clean on main is byte-identical', () => {
	const moved: string[] = [];
	for (const file of TEMPLATES) {
		const doc = template(file.replace(/\.json$/, ''));
		for (const preset of POTS_OVERLAY_PRESET_IDS) {
			for (const pots of POT_COUNTS) {
				const key = `${file}|${preset}|${pots ?? '-'}`;
				if (!(key in MAIN_ADD_ON_DIGESTS)) continue;
				if (addOnDigest(addPotsOverlay(doc, preset, pots)) !== MAIN_ADD_ON_DIGESTS[key]) {
					moved.push(key);
				}
			}
		}
	}
	same(moved, [], 'moved');
	same(Object.keys(MAIN_ADD_ON_DIGESTS).length, 112, 'cases');
});

await check('...and over a Hold and Win bonus already added, either way round', () => {
	const moved: string[] = [];
	const seen = new Set<string>();
	const settled = (result: ReturnType<typeof addPotsOverlay>) =>
		result.ok ? normalize(result.doc) : undefined;
	for (const host of ['lines', 'lines.bookOfThermopylae', 'ways']) {
		const base = template(host);
		for (const hw of HOLD_AND_WIN_PRESET_IDS) {
			const withHw = settled(addHoldAndWinBonus(base, hw));
			for (const preset of POTS_OVERLAY_PRESET_IDS) {
				for (const pots of POT_COUNTS) {
					const key = `${host}+${hw}|${preset}|${pots ?? '-'}`;
					if (!withHw || !(key in MAIN_BONUS_HOST_DIGESTS)) continue;
					seen.add(key);
					if (addOnDigest(addPotsOverlay(withHw, preset, pots)) !== MAIN_BONUS_HOST_DIGESTS[key]) {
						moved.push(key);
					}
				}
			}
		}
		for (const preset of POTS_OVERLAY_PRESET_IDS) {
			const withOverlay = settled(addPotsOverlay(base, preset));
			for (const hw of HOLD_AND_WIN_PRESET_IDS) {
				const key = `${host}+${preset}|then ${hw}`;
				if (!withOverlay || !(key in MAIN_BONUS_HOST_DIGESTS)) continue;
				seen.add(key);
				if (addOnDigest(addHoldAndWinBonus(withOverlay, hw)) !== MAIN_BONUS_HOST_DIGESTS[key]) {
					moved.push(key);
				}
			}
		}
	}
	same(moved, [], 'moved');
	same(seen.size, Object.keys(MAIN_BONUS_HOST_DIGESTS).length, 'every case reached');
	same(seen.size, 75, 'cases');
});

await check('3 Pots keeping one pot brings only the special that pot starts', () => {
	const classic = template('holdAndWin.classic');
	const one = normalize(docOf(addPotsOverlay(classic, 'threePots', 1)));
	same(
		Object.keys(one.modes!.find((m) => m.id === 'holdAndWin')!.holdAndWin!.specials).sort(),
		['multiplier', 'payer'],
		'specials',
	);
});

console.log(
	failures
		? `\ncheck:bonus-authoring — ${failures} FAILED, ${passes} passed`
		: `\ncheck:bonus-authoring — all ${passes} passed`,
);
process.exit(failures ? 1 : 0);
