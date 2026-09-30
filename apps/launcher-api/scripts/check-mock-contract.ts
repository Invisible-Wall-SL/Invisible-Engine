/**
 * Contract check for the MOCK CONTRACT's source — which Game Config the test server's mock deals:
 *   pnpm --filter launcher-api check:mock-contract
 *
 * Since published runtime snapshots (#841) a runtime game's PLAYERS boot the Game Config frozen at
 * its last Publish and its AUTHORING boots (`ie_authoring=1`) the live one. The mock followed the
 * live config for everyone, so an unpublished grid change had it dealing the NEW board into the
 * players' OLD client — the client/server split `/api/game-config/mock` exists to prevent.
 *
 * Runs the REAL `mockContract.ts`, `publishedRuntime.ts` (staged + committed through its own write
 * path) and `/api/game-config/mock` over an in-memory R2. Only I/O is stubbed: R2, the project
 * lookups, and the live config/symbols docs. What it pins:
 *  - `published` (the default) answers from the snapshot players boot, `live` from authoring data;
 *  - a rollback reaches the published answer; a game with no snapshot falls back to live, and says so;
 *  - the symbols half (stacked mode, multiplier art) is read from the SAME source as the config;
 *  - the copy Publish writes into the manifest is the published answer, not a live read;
 *  - an R2 failure on the published path is an error, never a silent live answer;
 *  - the launcher's authoring links move the RGS to the test server's authoring mock, and only there;
 *  - `/config`'s own reads of the server (Paylines preview, paytable import) ask that authoring mock.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { isHttpError } from '@sveltejs/kit';
import { normalizeGameConfigDoc, type GameConfigDoc } from 'game-config';

// ── In-memory R2 ─────────────────────────────────────────────────────────────
type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
let r2Down = false;
const put = (key: string, body: string) => R2.set(key, { body, etag: `"e${++etagSeq}"` });
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`conflict ${key}`);
	}
}

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (base: string | null | undefined) =>
			base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
		getObjectTextWithEtag: async (key: string) => {
			if (r2Down) throw new Error('R2 unreachable');
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
	},
});

const CLIENT = 'invisible_wall';
const PROJECTS: Record<string, { token: string; gameType: string }> = {
	remake: { token: 'TOK', gameType: 'lines' },
	scat: { token: 'SCT', gameType: 'scatter' },
	legacy: { token: 'LEG', gameType: 'lines' },
	hnw: { token: 'HNW', gameType: 'holdAndWin' },
};
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		DEFAULT_PROJECT_KEY: 'lines',
		projectAllowsRead: async (p: string, t: string) => PROJECTS[p]?.token === t,
		projectClientKey: async (p: string) => (PROJECTS[p] ? CLIENT : null),
		projectGameType: async (p: string) => PROJECTS[p]?.gameType ?? 'lines',
	},
});

const template = (name: string): GameConfigDoc =>
	normalizeGameConfigDoc(
		JSON.parse(
			readFileSync(new URL(`../src/lib/data/gameConfig/${name}.json`, import.meta.url), 'utf8'),
		),
	)!;
const resized = (doc: GameConfigDoc, reels: number, rows: number): GameConfigDoc => ({
	...doc,
	numReels: reels,
	numRows: Array(reels).fill(rows),
});

/** The LIVE authoring data, per project — what an authoring boot reads. */
const LIVE_CONFIG: Record<string, GameConfigDoc> = {
	remake: resized(template('lines'), 8, 4),
	scat: template('scatter'),
	legacy: resized(template('lines'), 6, 4),
	hnw: template('holdAndWin.classic'),
};
type LiveSymbols = {
	symbols: Record<string, { static?: unknown }>;
	stackedPictures?: { enabled: boolean; symbols: unknown[] };
};
const LIVE_SYMBOLS: Record<string, LiveSymbols> = {
	remake: { symbols: {}, stackedPictures: { enabled: true, symbols: [{ name: 'H1' }] } },
	scat: { symbols: {} },
	legacy: { symbols: {} },
	hnw: { symbols: {} },
};
mock.module(src('lib/server/gameConfigStorage.ts'), {
	namedExports: {
		loadGameConfigDoc: async (_c: string, p: string) => LIVE_CONFIG[p] ?? null,
	},
});
mock.module(src('lib/server/symbolsStorage.ts'), {
	namedExports: {
		loadSymbolsDoc: async (_c: string, p: string) => LIVE_SYMBOLS[p] ?? { symbols: {} },
	},
});
mock.module(src('lib/server/env.ts'), {
	namedExports: { ENV: { TEST_SERVER_URL: 'https://games.invisiblewall.org/' } },
});
mock.module(src('lib/server/games.ts'), {
	namedExports: { listGamesOwnedByProject: async () => [] },
});

const pub = await import(src('lib/server/publishedRuntime.ts'));
const { mockContractOfBundle } = await import(src('lib/server/mockContract.ts'));
const route = await import(src('routes/api/game-config/mock/+server.ts'));
const { asAuthoringLaunch } = await import(src('lib/gameLaunch.ts'));
const { fetchServerBootConfig } = await import(src('lib/server/rgsConfig.ts'));

// ── Harness ──────────────────────────────────────────────────────────────────
let failures = 0;
const check = async (label: string, fn: () => unknown) => {
	try {
		await fn();
		console.info(`  ✓ ${label}`);
	} catch (e) {
		failures += 1;
		console.error(`  ✗ ${label}\n      ${e instanceof Error ? e.message : e}`);
	}
};
const eq = (actual: unknown, expected: unknown, what: string) => {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
};

type Answer = {
	projectKey: string;
	source: string;
	snapshot?: string;
	protocol: string;
	cascade?: boolean;
	grid?: {
		reels: number;
		rows: number;
		stacked?: boolean;
		multiplier?: boolean;
		symbols?: unknown;
		betModes?: { mode: string }[];
		holdAndWin?: { block: { stickiness: string }; lineSymbols: string[] };
	};
};
/** GET the endpoint; resolves to the JSON answer, or `{ status }` for an HTTP error. */
const ask = async (query: string): Promise<Answer | { status: number }> => {
	const url = new URL(`https://app.invisiblewall.org/api/game-config/mock?${query}`);
	try {
		const res: Response = await route.GET({ url } as never);
		return (await res.json()) as Answer;
	} catch (e) {
		if (isHttpError(e)) return { status: e.status };
		throw e;
	}
};
const answer = async (query: string): Promise<Answer> => {
	const got = await ask(query);
	if ('status' in got && !('protocol' in got)) throw new Error(`HTTP ${got.status} for ${query}`);
	return got as Answer;
};
const board = (a: Answer) => `${a.grid?.reels}×${a.grid?.rows}`;

type Bundle = { config?: GameConfigDoc; symbols: Record<string, unknown> };
const publish = async (project: string, bundle: Bundle) => {
	const meta = await pub.stageSnapshot(CLIENT, project, bundle, {
		by: 'fixture',
		flow: 'absent',
		runtime: 'lines',
		engine: null,
	});
	await pub.commitSnapshot(CLIENT, project, meta);
	return meta.id as string;
};
/** Snapshot ids are minted from the clock; two publishes in one millisecond would collide. */
const tick = () => new Promise((r) => setTimeout(r, 5));

// What each project PUBLISHED: `remake` shipped a 5×3 board with no stacked pictures, and has
// since been edited live to 8×4 with them on. `scat` shipped multiplier art the live doc lacks.
const REMAKE_V1: Bundle = {
	config: resized(template('lines'), 5, 3),
	symbols: { map: {}, index: {} },
};
const REMAKE_V2: Bundle = {
	config: resized(template('lines'), 7, 3),
	symbols: { map: {}, index: {} },
};
const SCAT_SHIPPED: Bundle = {
	config: template('scatter'),
	symbols: { map: { M: { static: { assetKey: 'm' } } }, index: {} },
};
const v1 = await publish('remake', REMAKE_V1);
await tick();
const v2 = await publish('remake', REMAKE_V2);
await publish('scat', SCAT_SHIPPED);
// `hnw` shipped the Pots preset and has since been switched live to Classic (Grand).
await publish('hnw', { config: template('holdAndWin.pots'), symbols: { map: {}, index: {} } });

console.info('which config the mock deals');

await check('players get the PUBLISHED board, not the unpublished live edit', async () => {
	const a = await answer('project=remake&k=TOK&source=published');
	eq(board(a), '7×3', 'board');
	eq(a.source, 'snapshot', 'source');
	eq(a.snapshot, v2, 'snapshot id');
});

await check('published is the default — what an older test server asks for', async () => {
	const a = await answer('project=remake&k=TOK');
	eq([board(a), a.source], ['7×3', 'snapshot'], 'board + source');
});

await check('authoring boots get the LIVE board', async () => {
	const a = await answer('project=remake&k=TOK&source=live');
	eq([board(a), a.source, a.snapshot], ['8×4', 'live', undefined], 'board + source');
});

await check('a rollback reaches the published answer', async () => {
	await pub.rollbackSnapshot(CLIENT, 'remake', v1);
	const a = await answer('project=remake&k=TOK&source=published');
	eq([board(a), a.snapshot], ['5×3', v1], 'board + snapshot');
	await pub.rollbackSnapshot(CLIENT, 'remake', v2);
});

await check('a game with no snapshot follows live, and says it fell back', async () => {
	// Exactly what `/api/editor/runtime` serves that game's players (`live-fallback`).
	const a = await answer('project=legacy&k=LEG&source=published');
	eq([board(a), a.source], ['6×4', 'live-fallback'], 'board + source');
});

console.info('the symbols half follows the same source');

await check('stacked pictures: published = the snapshot, live = the doc', async () => {
	eq((await answer('project=remake&k=TOK&source=published')).grid?.stacked, undefined, 'published');
	eq((await answer('project=remake&k=TOK&source=live')).grid?.stacked, true, 'live');
});

await check('multiplier art: published = the snapshot, live = the doc', async () => {
	const published = await answer('project=scat&k=SCT&source=published');
	const live = await answer('project=scat&k=SCT&source=live');
	eq(published.grid?.multiplier, true, 'published deals the multiplier it can draw');
	eq(live.grid?.multiplier, undefined, 'live has no art, so none are dealt');
});

console.info('a Hold and Win game');

await check('players get the published holdAndWin block, authoring the live one', async () => {
	const published = await answer('project=hnw&k=HNW&source=published');
	const live = await answer('project=hnw&k=HNW&source=live');
	eq(published.protocol, 'holdAndWin', 'protocol');
	eq(published.grid?.holdAndWin?.block.stickiness, 'allCoins', 'published = Pots');
	eq(published.grid?.betModes, undefined, 'Pots sells nothing');
	eq(live.grid?.betModes?.map((m) => m.mode), ['base', 'buy', 'superBuy'], 'live = Grand buys');
	eq(
		live.grid?.holdAndWin?.lineSymbols,
		['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'W'],
		'line symbols in config names',
	);
	eq(live.grid?.symbols, undefined, 'no lines-mock server pool');
});

console.info('the publish-time copy');

await check("Publish's manifest copy is the published answer for the same bundle", async () => {
	const {
		projectKey: _p,
		source: _s,
		snapshot: _id,
		...served
	} = await answer('project=remake&k=TOK&source=published');
	eq(mockContractOfBundle('lines', REMAKE_V2, 'remake'), served, 'contract');
});

console.info('the gate');

await check('an unknown source is refused, not silently read as published', async () => {
	eq(await ask('project=remake&k=TOK&source=snapshot'), { status: 400 }, 'status');
});

await check('a wrong token is refused before anything is read', async () => {
	eq(await ask('project=remake&k=NOPE&source=live'), { status: 401 }, 'status');
});

await check('an R2 failure on the published path is an error, never a live answer', async () => {
	// Publishing drops the in-process pointer cache, so the next read goes to R2 — and fails there.
	await publish('legacy', { config: resized(template('lines'), 5, 3), symbols: { map: {} } });
	r2Down = true;
	try {
		eq(await ask('project=legacy&k=LEG&source=published'), { status: 502 }, 'status');
	} finally {
		r2Down = false;
	}
	eq(board(await answer('project=legacy&k=LEG&source=published')), '5×3', 'recovers');
});

console.info("the launcher's authoring links");

const PUBLISHED_URL =
	'https://games.invisiblewall.org/remake/?runtime=1&project=remake&k=TOK' +
	'&editorDocBase=https%3A%2F%2Fapp.invisiblewall.org' +
	'&rgs_url=games.invisiblewall.org/api/remake&sessionID=demo&lang=en&currency=USD';
const params = (url: string) => new URL(url, 'https://x.test').searchParams;

await check('a test-server game is pointed at its authoring mock', () => {
	const p = params(asAuthoringLaunch(PUBLISHED_URL));
	eq(p.get('ie_authoring'), '1', 'ie_authoring');
	eq(p.get('rgs_url'), 'games.invisiblewall.org/api/remake/authoring', 'rgs_url');
	eq([p.get('project'), p.get('k'), p.get('lang')], ['remake', 'TOK', 'en'], 'everything else');
});

await check('it is idempotent', () => {
	const once = asAuthoringLaunch(PUBLISHED_URL);
	eq(asAuthoringLaunch(once), once, 'second pass');
});

await check("another host's RGS is left alone", () => {
	const partner = PUBLISHED_URL.replace(
		'rgs_url=games.invisiblewall.org/api/remake',
		'rgs_url=rgs.partner.example/api/remake',
	);
	eq(params(asAuthoringLaunch(partner)).get('rgs_url'), 'rgs.partner.example/api/remake', 'rgs');
});

await check('an RGS for a different game key is left alone', () => {
	const other = PUBLISHED_URL.replace('/api/remake&', '/api/other&');
	eq(params(asAuthoringLaunch(other)).get('rgs_url'), 'games.invisiblewall.org/api/other', 'rgs');
});

await check('a URL with no rgs_url only gains the flag', () => {
	eq(
		asAuthoringLaunch('/api/partner-session?game=hot'),
		'/api/partner-session?game=hot&ie_authoring=1',
		'url',
	);
});

console.info("/config's reads of the server");

await check('the Paylines preview and paytable import ask the AUTHORING mock', async () => {
	// Both show the author "what the server deals" next to what they saved. The player mock deals
	// the last Publish, so asking it showed published paylines as the server's and offered to
	// import published prices over unpublished edits.
	const asked: string[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		asked.push(String(input));
		return new Response(JSON.stringify({ events: [{ event: 'config', context: { lines: 1 } }] }));
	}) as typeof fetch;
	try {
		const got = await fetchServerBootConfig('remake', 1000);
		eq(got.ok, true, 'read ok');
	} finally {
		globalThis.fetch = realFetch;
	}
	eq(asked.length, 1, 'one probe');
	eq(new URL(asked[0]).pathname, '/api/remake/authoring/rgs/engine', 'path');
});

if (failures) {
	console.error(`\n${failures} check(s) FAILED.`);
	process.exit(1);
}
console.info('\nAll mock-contract checks passed.');
