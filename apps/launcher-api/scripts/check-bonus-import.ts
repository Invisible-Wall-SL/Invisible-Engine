/**
 * Contract check for the Game Maker's BONUS IMPORT (docs/design/pots-overlay.md §5 A, Phase 7):
 *   pnpm --filter launcher-api check:bonus-import
 *
 * Runs the REAL `projectBonusImport.ts`, the scaffold, the pots overlay add-on and the doc stores
 * over an in-memory R2; only R2, the project lookup, leases and the bundle cache are stubbed. The
 * source is `hw-classic-sample` as the Game Maker creates it (Classic sticky preset), with a spine
 * bound in `/symbols`, a Flow section and Win Text authored. What it pins:
 *  - an import into a 3 Pots Book-of host replaces the host's Hold and Win bonus only when asked,
 *    and copies the config, the `/symbols` bindings, the mode's screens, its Flow section and its
 *    Win Text lines, leaving every other part of every doc byte-identical;
 *  - a spine under the source's prefix is promoted to `_shared/spines/imported/…` (files and index
 *    entry) and the reference rewritten, so it exports;
 *  - the SOURCE is never written;
 *  - a re-sync picks up an edit made in the source and moves nothing else;
 *  - another session's lease refuses with nothing written, and a part that loses its race is
 *    reported and filled by a re-sync.
 */
import { mock } from 'node:test';
import type { LiveLease } from '../src/lib/server/lease.ts';
import type { FlowDocV2 } from 'engine-flow-v2';
import type { LayoutDoc, Scene, WinTextDoc } from 'engine-layout';
import type { GameConfigDoc } from 'game-config';

type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
/** Keys a "concurrent author" saves between the import's read and its write. */
const RACE = new Map<string, string>();

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
			const raced = RACE.get(key);
			if (raced !== undefined) {
				RACE.delete(key);
				put(key, raced);
			}
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
		// Never reached by an import; the spine module's graph imports them.
		getObjectBytes: async (key: string) =>
			R2.has(key) ? { bytes: Buffer.from(R2.get(key)!.body), etag: R2.get(key)!.etag } : null,
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

const SOURCE = 'hw-classic-sample';
const HOST = 'borut-pots-sample';
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		projectGameType: async (p: string) => (p === SOURCE ? 'holdAndWin' : 'bookOf'),
	},
});

/** The edit leases "held" right now, by any session; the import reads them, never writes them. */
const LEASES: (LiveLease & { projectKey: string })[] = [];
mock.module(src('lib/server/lease.ts'), {
	namedExports: {
		liveLeases: async (keys: { toolId: string; docKey: string; projectKey: string }[]) =>
			LEASES.filter((l) =>
				keys.some(
					(k) => k.toolId === l.toolId && k.docKey === l.docKey && k.projectKey === l.projectKey,
				),
			),
	},
});
const INVALIDATED: string[] = [];
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: { invalidateRuntimeBundle: (project: string) => INVALIDATED.push(project) },
});
const ME = 'session-me';

const { applyBonusImport, rewriteSourceSpines, mergeImportedWinText, importedSpineBundle } =
	await import('../src/lib/server/projectBonusImport.ts');
const { applyPotsOverlayAddOn } = await import('../src/lib/server/projectAddOn.ts');
const { scaffoldProject } = await import('../src/lib/server/projectScaffold.ts');
const { editorDocKey, flowV2DocKey, gameConfigDocKey, symbolsDocKey, winTextDocKey, SUB } =
	await import('../src/lib/server/projectPaths.ts');

const CLIENT = 'invisible_wall';
let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
	try {
		await fn();
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures++;
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
const stored = (key: string) => R2.get(key)?.body;
const storedJson = <T>(key: string): T => JSON.parse(stored(key) ?? 'null') as T;
const under = (prefix: string) =>
	JSON.stringify(sortedKeys(prefix).map((k) => [k, R2.get(k)!.body]));
const modeScreens = (layout: LayoutDoc) =>
	layout.scenes.filter((s: Scene) => s.role === 'mode' && s.modeId === 'holdAndWin');

// ─── the two projects ─────────────────────────────────────────────────────────────────────────

const SPINE_ROOT = SUB.spines(CLIENT, SOURCE);
const COIN_SPINE = `${SPINE_ROOT}/coin`;
const SHARED_COIN = `_shared/spines/${importedSpineBundle(SOURCE, 'coin')}`;

/** `hw-classic-sample` as created in the Game Maker, then authored: a spine on BONUS, a Flow
 *  section for the feature, its own jackpot and feature copy. */
async function makeSource() {
	await scaffoldProject(CLIENT, SOURCE, { holdAndWinPreset: 'classic' });
	put(`${SPINE_ROOT}/skeletons.json`, {
		skeletons: [
			{
				name: 'coin',
				folder: 'coin',
				skeleton_file: 'coin.json',
				atlas_file: 'coin.atlas',
				format: 'json',
				runtime: '4.2',
				dir_b64: 'Y29pbg',
			},
		],
	});
	put(`${COIN_SPINE}/coin.json`, '{"skeleton":{}}');
	put(`${COIN_SPINE}/coin.atlas`, 'coin.png');
	put(`${COIN_SPINE}/coin.png`, 'PNG');
	const symbols = storedJson<{ version: 1; symbols: Record<string, unknown> }>(
		symbolsDocKey(CLIENT, SOURCE),
	) ?? { version: 1, symbols: {} };
	symbols.symbols.BONUS = {
		static: { type: 'spine', assetKey: `${COIN_SPINE}/`, animationName: 'idle' },
	};
	(symbols as Record<string, unknown>).names = { BONUS: { singular: 'Gold coin' } };
	put(symbolsDocKey(CLIENT, SOURCE), symbols);
	const flow = storedJson<FlowDocV2 | null>(flowV2DocKey(CLIENT, SOURCE));
	assert(flow, 'the scaffold seeded no flow for the source');
	put(flowV2DocKey(CLIENT, SOURCE), {
		...flow,
		modes: { holdAndWin: { graph: { nodes: [{ id: 'classic-intro' }], edges: [] } } },
	});
	put(winTextDocKey(CLIENT, SOURCE), {
		version: 1,
		jackpots: { award: '{jackpot} — GRAND STYLE' },
		feature: { intro: 'Classic respins!', potLabel: 'source pot (never copied)' },
	});
}

/** `borut-pots-sample`: a Book-of project with the 3 Pots overlay and its graft, then authored. */
async function makeHost() {
	await scaffoldProject(CLIENT, HOST);
	const out = await applyPotsOverlayAddOn(CLIENT, HOST, {
		sessionId: ME,
		preset: 'threePots',
		flow: true,
	});
	assert(out.ok, `the add-on refused: ${out.ok ? '' : out.error}`);
	put(winTextDocKey(CLIENT, HOST), {
		version: 1,
		jackpots: { award: 'host jackpot line' },
		feature: { intro: 'host intro', potLabel: '{pot} pot' },
		lineMessage: { default: 'host line message' },
	});
}

await makeSource();
await makeHost();
const sourceBytes = under(`${CLIENT}/${SOURCE.replace(/-/g, '_')}`);
assert(sourceBytes.length > 10, 'the source prefix holds nothing');
const hostBefore = {
	config: storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, HOST)),
	layout: storedJson<LayoutDoc>(editorDocKey(CLIENT, HOST)),
	flow: storedJson<FlowDocV2>(flowV2DocKey(CLIENT, HOST)),
	symbols: storedJson<{ symbols: Record<string, unknown> }>(symbolsDocKey(CLIENT, HOST)),
};
const AT = '2026-10-03T08:00:00.000Z';
const run = (opts: Partial<Parameters<typeof applyBonusImport>[2]> = {}) =>
	applyBonusImport(CLIENT, HOST, {
		source: SOURCE,
		mode: 'holdAndWin',
		sessionId: ME,
		at: AT,
		...opts,
	});

console.log('\n1. pure helpers');

await check('a spine under the source prefix is rewritten to its imported shared bundle', () => {
	const out = rewriteSourceSpines(
		{ a: `${COIN_SPINE}/`, b: [`${COIN_SPINE}`], c: `${SUB.spines(CLIENT, HOST)}/own/`, d: 3 },
		CLIENT,
		SOURCE,
	);
	same(
		out,
		{
			value: {
				a: `${SHARED_COIN}/`,
				b: [SHARED_COIN],
				c: `${SUB.spines(CLIENT, HOST)}/own/`,
				d: 3,
			},
			bundles: ['coin'],
		},
		'rewrite',
	);
});

await check("win text: the source's Hold and Win lines, the host's pot lines", () => {
	const out = mergeImportedWinText(
		{
			version: 1,
			jackpots: { award: 'a' },
			feature: { intro: 'host', potLabel: 'host pot', potNames: { red: 'Ruby' } },
			lineMessage: { default: 'x' },
		} as WinTextDoc,
		{
			version: 1,
			feature: { intro: 'src', potLabel: 'src pot' },
			respins: { counter: 'r' },
		} as WinTextDoc,
	);
	same(
		out.doc,
		{
			version: 1,
			feature: { intro: 'src', potLabel: 'host pot', potNames: { red: 'Ruby' } },
			lineMessage: { default: 'x' },
			respins: { counter: 'r' },
		},
		'merged',
	);
	same(out.added, ['jackpots', 'respins', 'feature'], 'families');
});

console.log('\n2. import');

await check("the host's own Hold and Win bonus, unasked: refused, nothing written", async () => {
	const before = under('');
	const out = await run();
	assert(!out.ok && out.status === 409, 'not refused');
	same(
		out.error,
		'This project already has a Hold and Win bonus. Replace it to import this one.',
		'why',
	);
	same(under(''), before, 'R2');
});

await check("another session's lease: refused, nothing written", async () => {
	LEASES.push({
		toolId: 'winText',
		docKey: 'winText',
		projectKey: HOST,
		holderSessionId: 'someone-else',
		holderName: 'Ana',
	} as LiveLease & { projectKey: string });
	const before = under('');
	const out = await run({ replace: true });
	LEASES.length = 0;
	assert(!out.ok && out.status === 409, 'not refused');
	same(
		out.error,
		'Ana is editing /win-text for this project. Try again once they close it.',
		'why',
	);
	same(under(''), before, 'R2');
});

await check(
	'replace: every part copied, everything else byte-identical, the source untouched',
	async () => {
		const winTextBefore = storedJson<WinTextDoc>(winTextDocKey(CLIENT, HOST));
		INVALIDATED.length = 0;
		const out = await run({ replace: true });
		assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
		same(INVALIDATED, [HOST], 'the runtime bundle invalidated');
		same(
			Object.fromEntries(Object.entries(out.parts).map(([k, p]) => [k, p.status])),
			{ symbols: 'added', layout: 'added', flow: 'added', winText: 'added', spines: 'added' },
			'parts',
		);
		assert(out.replaced && !out.resynced, 'not a replace');
		same(out.droppedActivates, ['red', 'blue'], 'the specials Classic lacks');

		const config = storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, HOST));
		same(
			config.imports?.[0]?.importedFrom,
			{ project: SOURCE, mode: 'holdAndWin', at: AT },
			'provenance',
		);
		same(
			config.holdAndWin?.boardEnd,
			{ type: 'columnLetters', letters: 'GRAND', jackpot: 'GRAND', clearOnComplete: true },
			'the GRAND board end',
		);
		same(config.paddingReels.basegame, hostBefore.config.paddingReels.basegame, 'the base strips');

		const symbols = storedJson<{
			symbols: Record<string, { static?: { assetKey: string } }>;
			names?: Record<string, unknown>;
		}>(symbolsDocKey(CLIENT, HOST));
		same(
			symbols.symbols.BONUS?.static?.assetKey,
			`${SHARED_COIN}/`,
			'BONUS names the promoted spine',
		);
		same(symbols.names?.BONUS, { singular: 'Gold coin' }, 'its display name came too');
		same(symbols.symbols.POT_RED, hostBefore.symbols.symbols.POT_RED, 'a token binding is kept');
		assert(
			R2.has(`${SHARED_COIN}/coin.json`) && R2.has(`${SHARED_COIN}/coin.png`),
			'the bundle was not promoted',
		);
		const index = storedJson<{ skeletons: { folder: string }[] }>('_shared/spines/skeletons.json');
		same(
			index.skeletons.map((e) => e.folder),
			[importedSpineBundle(SOURCE, 'coin')],
			'the shared index',
		);

		const layout = storedJson<LayoutDoc>(editorDocKey(CLIENT, HOST));
		const sourceLayout = storedJson<LayoutDoc>(editorDocKey(CLIENT, SOURCE));
		same(
			modeScreens(layout).map((s) => s.id),
			modeScreens(sourceLayout).map((s) => s.id),
			'the mode screens are the source ones',
		);
		same(
			layout.scenes.filter((s) => !modeScreens(layout).includes(s)),
			hostBefore.layout.scenes.filter((s) => !modeScreens(hostBefore.layout).includes(s)),
			'every other screen is byte-identical',
		);

		const flow = storedJson<FlowDocV2>(flowV2DocKey(CLIENT, HOST));
		same(
			flow.modes?.holdAndWin,
			{ graph: { nodes: [{ id: 'classic-intro' }], edges: [] } },
			'the Flow section',
		);
		same(flow.graph, hostBefore.flow.graph, 'the base graph');

		const winText = storedJson<WinTextDoc>(winTextDocKey(CLIENT, HOST));
		same(winText.jackpots, { award: '{jackpot} — GRAND STYLE' }, 'the jackpot line');
		same(
			winText.feature,
			{ intro: 'Classic respins!', potLabel: '{pot} pot' },
			'the feature lines, the pot label kept',
		);
		same(winText.lineMessage, winTextBefore.lineMessage, 'other copy kept');

		same(
			under(`${CLIENT}/${SOURCE.replace(/-/g, '_')}`),
			sourceBytes,
			'the source is never written',
		);
	},
);

await check(
	'a second import of the same feature without replace: refused, says re-sync',
	async () => {
		const out = await run();
		assert(!out.ok, 'not refused');
		same(
			out.error,
			`This project's Hold and Win was imported from "${SOURCE}". Re-sync it, or replace it.`,
			'why',
		);
	},
);

console.log('\n3. re-sync');

await check('a re-sync picks up a source edit and moves nothing else', async () => {
	const sourceConfig = storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, SOURCE));
	sourceConfig.holdAndWin!.respins.start = 5;
	put(gameConfigDocKey(CLIENT, SOURCE), sourceConfig);
	put(winTextDocKey(CLIENT, SOURCE), {
		version: 1,
		jackpots: { award: '{jackpot}!!' },
		feature: { intro: 'Classic respins!' },
	});
	const configBefore = storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, HOST));
	const layoutBefore = stored(editorDocKey(CLIENT, HOST));
	const flowBefore = stored(flowV2DocKey(CLIENT, HOST));
	const symbolsBefore = stored(symbolsDocKey(CLIENT, HOST));
	const sourceNow = under(`${CLIENT}/${SOURCE.replace(/-/g, '_')}`);

	const out = await applyBonusImport(CLIENT, HOST, {
		mode: 'holdAndWin',
		resync: true,
		sessionId: ME,
		at: '2026-10-04T09:00:00.000Z',
	});
	assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
	assert(out.resynced && !out.replaced, 'not a re-sync');
	same(
		Object.fromEntries(Object.entries(out.parts).map(([k, p]) => [k, p.status])),
		{ symbols: 'present', layout: 'present', flow: 'present', winText: 'added', spines: 'present' },
		'parts',
	);
	const config = storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, HOST));
	same(config.holdAndWin?.respins.start, 5, 'the edit arrived');
	same(config.imports?.[0]?.importedFrom.at, '2026-10-04T09:00:00.000Z', 'the re-sync time');
	same(config.imports?.[0]?.symbols, configBefore.imports?.[0]?.symbols, 'the same names');
	same(config.potsOverlay, configBefore.potsOverlay, 'the pots and their routes');
	same(stored(editorDocKey(CLIENT, HOST)), layoutBefore, 'the layout bytes');
	same(stored(flowV2DocKey(CLIENT, HOST)), flowBefore, 'the flow bytes');
	same(stored(symbolsDocKey(CLIENT, HOST)), symbolsBefore, 'the symbols bytes');
	same(
		storedJson<WinTextDoc>(winTextDocKey(CLIENT, HOST)).jackpots,
		{ award: '{jackpot}!!' },
		'the copy edit',
	);
	same(under(`${CLIENT}/${SOURCE.replace(/-/g, '_')}`), sourceNow, 'the source is never written');
});

await check('a part that loses its race is reported, and a re-sync fills it in', async () => {
	const sourceFlow = storedJson<FlowDocV2>(flowV2DocKey(CLIENT, SOURCE));
	put(flowV2DocKey(CLIENT, SOURCE), {
		...sourceFlow,
		modes: { holdAndWin: { graph: { nodes: [{ id: 'classic-intro-v2' }], edges: [] } } },
	});
	const hostFlow = storedJson<FlowDocV2>(flowV2DocKey(CLIENT, HOST));
	const theirs = JSON.stringify({ ...hostFlow, comments: [{ id: 'c', text: 'mine' }] });
	RACE.set(flowV2DocKey(CLIENT, HOST), theirs);
	const out = await applyBonusImport(CLIENT, HOST, {
		mode: 'holdAndWin',
		resync: true,
		sessionId: ME,
	});
	assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
	same(out.parts.flow.status, 'conflict', 'the flow lost its race');
	same(stored(flowV2DocKey(CLIENT, HOST)), theirs, 'the concurrent save stands');
	const again = await applyBonusImport(CLIENT, HOST, {
		mode: 'holdAndWin',
		resync: true,
		sessionId: ME,
	});
	assert(again.ok, 'the re-run refused');
	same(again.parts.flow.status, 'added', 'the re-run');
	const flow = storedJson<FlowDocV2 & { comments?: unknown }>(flowV2DocKey(CLIENT, HOST));
	same(
		flow.modes?.holdAndWin,
		{ graph: { nodes: [{ id: 'classic-intro-v2' }], edges: [] } },
		'filled in',
	);
	same(flow.comments, [{ id: 'c', text: 'mine' }], 'their save kept');
});

await check('a re-sync of a mode that was not imported is refused', async () => {
	const out = await applyBonusImport(CLIENT, HOST, {
		mode: 'freeSpins',
		resync: true,
		sessionId: ME,
	});
	assert(!out.ok && out.status === 400, 'not refused');
});

await check('a reels feature is refused with its reason, nothing written', async () => {
	const before = under('');
	const out = await run({ mode: 'freeSpins', replace: true });
	assert(!out.ok && out.error.startsWith('A reels bonus'), out.ok ? 'accepted' : out.error);
	same(under(''), before, 'R2');
});

if (failures) {
	console.error(`\ncheck:bonus-import — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:bonus-import — all passed');
