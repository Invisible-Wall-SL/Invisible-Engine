/**
 * Contract check for the per-symbol ELEMENT FX in Invisible Symbols — `symbolFx`: symbol → state →
 * the Element FX entries that symbol plays in that state (a shake as it lands, a glow while it wins,
 * a melt as it explodes). The game reads `bundle.symbols.symbolFx[symbol][state]` through
 * `readElementFxEntries` (`check:element-fx` pins how `Symbol.svelte` plays it), so this pins
 * everything up to that bundle field and the reader that takes it:
 *
 *   1. THE DOC — the section survives `normalizeSymbolsDoc` AND the real `saveSymbolsDoc` (the stored
 *      bytes): entries VERBATIM, one this build cannot read included; an unknown state key (with a
 *      warning), a list that is not an array, an entry or a symbol that is not an object are dropped;
 *      at most `SYMBOL_FX_MAX` per state; an emptied list and an emptied symbol are pruned, the last
 *      one taking the section. The strict cell schema is untouched.
 *   2. THE CLIENT — `setSymbolFx` and `docSignature` agree with the server: an edit marks the page
 *      dirty, undoing it marks it clean, and the doc a save hands back signs as the draft did.
 *   3. THE SHIP — the real exporter carries it, absent when empty; the real export endpoint forwards
 *      it (the bake reads that response); the bake's rebuild (`lib/bakeSymbolFx.mjs`, RUN here) keeps
 *      it, absent when empty, and `bake-editor-doc.mjs` puts it on `symbols`; the runtime bundle
 *      carries the export result whole; the game's `bakedSymbolFx` reads it off both.
 *   4. THE OTHER WRITERS — Invisible Director's `symbols.set_state` rewrites the doc and keeps it; a
 *      bonus import carries an imported symbol's FX with its bindings.
 *
 * `r2.ts` is an in-memory bucket honouring `If-Match` / `If-None-Match`; the export endpoint's deploy
 * token, project lookup and deploy lock are stubbed. Run:
 *
 *   pnpm --filter launcher-api check:symbol-fx
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ElementFxEntry } from 'constants-shared/elementFx';
import { SYMBOL_STATES } from 'engine-layout';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { bakeSymbolFx } from './lib/bakeSymbolFx.mjs';

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	if (json(actual) === json(expected)) return;
	failures += 1;
	console.log(
		`FAIL  ${label}\n        expected ${json(expected)}\n        actual   ${json(actual)}`,
	);
};

const src = (rel: string): string => new URL(`../src/${rel}`, import.meta.url).href;

/** Every runtime export a module declares, so a fake can stand in for all of them. */
function exportNames(rel: string): string[] {
	const text = readFileSync(fileURLToPath(src(rel)), 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	for (const m of text.matchAll(/^export \{([^}]+)\}/gm)) {
		for (const part of m[1].split(',')) {
			const name = part
				.trim()
				.split(/\s+as\s+/)
				.pop();
			if (name && !name.startsWith('type ')) names.add(name);
		}
	}
	return [...names];
}

/** Fake a module: the given implementations, and a loud failure for every other export. */
function fake(rel: string, impl: Record<string, unknown>): void {
	const namedExports: Record<string, unknown> = {};
	for (const name of exportNames(rel)) {
		namedExports[name] =
			name in impl
				? impl[name]
				: () => {
						throw new Error(`fixture: ${rel} ${name} is not faked`);
					};
	}
	for (const name of Object.keys(impl)) {
		if (!(name in namedExports)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports });
}

// ── In-memory R2 ───────────────────────────────────────────────────────────────────────────────
type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
const keysUnder = (prefix: string): string[] =>
	[...R2.keys()].filter((key) => key.startsWith(prefix)).sort();

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
type Cond = { ifMatch?: string; ifNoneMatch?: string };
function put(key: string, body: string, cond?: Cond): string {
	const current = R2.get(key);
	if (cond?.ifNoneMatch && current) throw new ConflictError(key);
	if (cond?.ifMatch && current?.etag !== cond.ifMatch) throw new ConflictError(key);
	const etag = `"e${++etagSeq}"`;
	R2.set(key, { body, etag });
	return etag;
}
fake('lib/server/r2.ts', {
	ConflictError,
	precondition: (base: string | null | undefined) =>
		base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
	objectExists: async (key: string) => R2.has(key),
	headObject: async (key: string) =>
		R2.has(key) ? { etag: R2.get(key)!.etag, size: R2.get(key)!.body.length } : null,
	getObjectText: async (key: string) => R2.get(key)?.body ?? null,
	getObjectTextWithEtag: async (key: string) => {
		const o = R2.get(key);
		return o ? { text: o.body, etag: o.etag } : null;
	},
	putObjectText: async (key: string, text: string, _type: string, cond?: Cond) =>
		put(key, text, cond),
	copyObject: async (from: string, to: string) => {
		const o = R2.get(from);
		if (!o) return false;
		R2.set(to, { ...o });
		return true;
	},
	deleteObject: async (key: string) => void R2.delete(key),
	deleteObjects: async (keys: string[]) => keys.forEach((key) => R2.delete(key)),
	listAllKeys: async (prefix: string) => keysUnder(prefix),
	listAllObjects: async (prefix: string) =>
		keysUnder(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
	listObjects: async () => ({ keys: [], prefixes: [] }),
});

const CLIENT = 'acme';
const PROJECT = 'fxgame';
const TOKEN = 'deploy-token';
fake('lib/server/appSettings.ts', { getDeployToken: async () => TOKEN });
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	projectClientKey: async () => CLIENT,
});
fake('lib/server/runtimeBundleCache.ts', {
	withDeployWrite: async <T>(_project: string, run: () => Promise<T>) => run(),
});

const { normalizeSymbolsDoc, saveSymbolsDoc } = await import('../src/lib/server/symbolsStorage.ts');
const { symbolsDocKey } = await import('../src/lib/server/projectPaths.ts');
const { exportEditorSymbols } = await import('../src/lib/server/symbolExport.ts');
const exportRoute = await import('../src/routes/api/editor/export-symbols/+server.ts');
const { setState } = await import('../src/lib/server/director/ops/symbols.ts');
const { pruneSymbolFx, SYMBOL_FX_MAX, SYMBOL_FX_TRIGGERS } = await import('../src/lib/symbolFx.ts');
const client = await import('../src/routes/(app)/symbols/symbols.client.ts');
type SymbolsDoc = import('../src/routes/(app)/symbols/symbols.client.ts').SymbolsDoc;
type AdapterContext = import('../src/lib/server/director/adapter.ts').AdapterContext;

/** Run `fn`, capturing every `console.warn` it makes. */
function warned<T>(fn: () => T): { out: T; warnings: string[] } {
	const warnings: string[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
	try {
		return { out: fn(), warnings };
	} finally {
		console.warn = warn;
	}
}

const SHAKE: ElementFxEntry = {
	id: 'efx1',
	kind: 'shake',
	trigger: 'enter',
	params: { axis: 'x' },
};
const GLOW: ElementFxEntry = { id: 'efx1', kind: 'glow', trigger: 'always', intensity: 1.5 };
const MELT: ElementFxEntry = { id: 'efx1', kind: 'melt', trigger: 'enter', durationMs: 1800 };
/** A kind (and a field) a newer build wrote: unreadable here, and kept as it is. */
const FUTURE = {
	id: 'efx2',
	kind: 'hologram',
	trigger: 'always',
	flicker: 0.4,
} as unknown as ElementFxEntry;
const AUTHORED = {
	H1: { land: [SHAKE], win: [GLOW, FUTURE], explosion: [MELT] },
	W: { win: [GLOW] },
};

console.log('\n1. the doc keeps the section, verbatim, and prunes it at both levels');
{
	const base = { version: 1, symbols: {} };
	check('an un-authored doc carries no key', 'symbolFx' in normalizeSymbolsDoc(base), false);
	check(
		'an authored section round-trips through the normalizer, entries verbatim',
		normalizeSymbolsDoc({ ...base, symbolFx: AUTHORED }).symbolFx,
		AUTHORED,
	);
	const junk = warned(() =>
		normalizeSymbolsDoc({
			...base,
			symbolFx: {
				H1: {
					land: [SHAKE, 'shake', 7, null, ['nested']],
					notAState: [GLOW],
					win: { 0: GLOW },
					spin: [],
				},
				L1: 'glow',
				L2: { land: 'shake' },
				'  ': { land: [SHAKE] },
			},
		}),
	);
	check(
		'an unknown state, a non-array, a non-object entry or symbol and an empty list are dropped',
		junk.out.symbolFx,
		{ H1: { land: [SHAKE] } },
	);
	check(
		'…the unknown state with a warning naming it',
		junk.warnings.filter((w) => w.includes('"symbolFx.H1.notAState"')).length,
		1,
	);
	check(
		'every state the engine renders is a legal key',
		SYMBOL_STATES.filter(
			(state) => !normalizeSymbolsDoc({ ...base, symbolFx: { H1: { [state]: [SHAKE] } } }).symbolFx,
		),
		[],
	);
	const many = Array.from({ length: SYMBOL_FX_MAX + 3 }, (_, i) => ({ ...SHAKE, id: `efx${i}` }));
	check(
		`a state keeps its first ${SYMBOL_FX_MAX} entries`,
		normalizeSymbolsDoc({ ...base, symbolFx: { H1: { land: many } } }).symbolFx?.H1?.land,
		many.slice(0, SYMBOL_FX_MAX),
	);
	check(
		'a section that is not an object is dropped, not the doc',
		normalizeSymbolsDoc({ ...base, names: { H1: { singular: 'Bell' } }, symbolFx: 'glow' }),
		{ version: 1, symbols: {}, names: { H1: { singular: 'Bell' } } },
	);
	check(
		'a save (`reject`) keeps it too',
		normalizeSymbolsDoc({ ...base, symbolFx: AUTHORED }, 'reject').symbolFx,
		AUTHORED,
	);
	const onCell = warned(() =>
		normalizeSymbolsDoc({
			symbols: { H1: { land: { type: 'sprite', assetKey: 'h1', elementFx: [SHAKE] } } },
		}),
	);
	check(
		'the strict cell schema is untouched: FX on a CELL is an unknown field, never stored there',
		[
			onCell.out.symbols.H1?.land,
			onCell.warnings.some((w) => w.includes('"symbols.H1.land.elementFx"')),
		],
		[{ type: 'sprite', assetKey: 'h1' }, true],
	);
	check(
		'pruneSymbolFx answers undefined for nothing left',
		[pruneSymbolFx(undefined), pruneSymbolFx({}), pruneSymbolFx({ H1: { land: [] } })],
		[undefined, undefined, undefined],
	);
	check('the two triggers offered are enter and always', SYMBOL_FX_TRIGGERS, ['enter', 'always']);

	const key = symbolsDocKey(CLIENT, PROJECT);
	const saved = await saveSymbolsDoc(CLIENT, PROJECT, { ...base, symbolFx: AUTHORED }, null);
	const stored = JSON.parse(R2.get(key)!.body) as Record<string, unknown>;
	check('the real save stores it, entries verbatim', stored.symbolFx, AUTHORED);
	check('…and hands it back', saved.doc.symbolFx, AUTHORED);
	const emptied = await saveSymbolsDoc(
		CLIENT,
		PROJECT,
		{ ...base, symbolFx: { H1: { land: [], win: [GLOW] }, W: {} } },
		saved.etag,
	);
	check(
		'an emptied list and an emptied symbol are pruned from the stored doc',
		JSON.parse(R2.get(key)!.body).symbolFx,
		{ H1: { win: [GLOW] } },
	);
	await saveSymbolsDoc(CLIENT, PROJECT, { ...base, symbolFx: { H1: { win: [] } } }, emptied.etag);
	check('the last one takes the section', 'symbolFx' in JSON.parse(R2.get(key)!.body), false);
}

console.log('\n2. the client setter and dirty signature agree with the server');
{
	const { docSignature, setSymbolFx, symbolFxOf } = client;
	const empty: SymbolsDoc = { version: 1, symbols: {} };
	const one = setSymbolFx(empty, 'H1', 'land', [SHAKE]);
	check('the setter writes one state', one.symbolFx, { H1: { land: [SHAKE] } });
	check('…and the getter reads it', symbolFxOf(one, 'H1', 'land'), [SHAKE]);
	check('an edit marks the page dirty', docSignature(one) !== docSignature(empty), true);
	const two = setSymbolFx(one, 'H1', 'win', [GLOW, FUTURE]);
	check('a second state sits beside the first', two.symbolFx, {
		H1: { land: [SHAKE], win: [GLOW, FUTURE] },
	});
	const cleared = setSymbolFx(setSymbolFx(two, 'H1', 'land', undefined), 'H1', 'win', []);
	check('clearing every state drops the section', 'symbolFx' in cleared, false);
	check('…and signs as clean again', docSignature(cleared), docSignature(empty));
	const brighter = setSymbolFx(two, 'H1', 'win', [{ ...GLOW, intensity: 2 }, FUTURE]);
	check(
		'a change to one entry moves the signature',
		docSignature(brighter) !== docSignature(two),
		true,
	);
	const reordered: ElementFxEntry = {
		params: { axis: 'x' },
		trigger: 'enter',
		kind: 'shake',
		id: 'efx1',
	};
	check(
		'…key order inside an entry does not',
		docSignature(setSymbolFx(one, 'H1', 'land', [reordered])),
		docSignature(one),
	);
	check(
		'the doc a save hands back signs as the draft did',
		docSignature({ ...empty, symbolFx: normalizeSymbolsDoc(two).symbolFx }),
		docSignature(two),
	);
	const many = Array.from({ length: SYMBOL_FX_MAX + 1 }, (_, i) => ({ ...SHAKE, id: `e${i}` }));
	check(
		'the setter caps a state like the server',
		setSymbolFx(empty, 'H1', 'land', many).symbolFx?.H1?.land?.length,
		SYMBOL_FX_MAX,
	);
}

console.log('\n3. it reaches both bundle paths');
{
	const base = { version: 1, symbols: {} };
	/** The export endpoint's JSON response, as the bake fetches it. */
	const endpoint = async (): Promise<Record<string, unknown>> => {
		const event = {
			url: new URL(`http://launcher/api/editor/export-symbols?project=${PROJECT}&k=${TOKEN}`),
		} as Parameters<typeof exportRoute.POST>[0];
		return (await (await exportRoute.POST(event)).json()) as Record<string, unknown>;
	};
	await saveSymbolsDoc(CLIENT, PROJECT, { ...base, symbolFx: AUTHORED });
	const exported = await exportEditorSymbols(CLIENT, PROJECT);
	check('the exporter carries it', exported.symbolFx, AUTHORED);
	const body = await endpoint();
	check('the export ENDPOINT forwards it (the bake reads this response)', body.symbolFx, AUTHORED);
	check('the bake rebuild keeps it, entries verbatim', bakeSymbolFx(body.symbolFx), AUTHORED);
	check(
		'…by shape: a non-object symbol, a non-array list and a non-object entry go',
		bakeSymbolFx({ H1: { land: [SHAKE, 3, 'x'], win: 'glow' }, L1: [GLOW], W: { win: [] } }),
		{ H1: { land: [SHAKE] } },
	);
	check(
		'…and nothing authored bakes no key',
		[bakeSymbolFx(undefined), bakeSymbolFx({}), bakeSymbolFx({ H1: {} })],
		[undefined, undefined, undefined],
	);

	await saveSymbolsDoc(CLIENT, PROJECT, base);
	check(
		'an un-authored export has no key',
		'symbolFx' in (await exportEditorSymbols(CLIENT, PROJECT)),
		false,
	);
	const bareBody = await endpoint();
	check('…nor the endpoint response', 'symbolFx' in bareBody, false);
	check('…nor the bake', bakeSymbolFx(bareBody.symbolFx), undefined);

	const here = fileURLToPath(new URL('.', import.meta.url));
	const bake = readLF(`${here}bake-editor-doc.mjs`);
	check(
		'bake-editor-doc.mjs rebuilds it onto `symbols`',
		/\n\t{4,}symbolFx: bakeSymbolFx\(s\?\.symbolFx\),\n/.test(bake),
		true,
	);
	const runtime = readLF(`${here}../src/lib/server/runtimeBundle.ts`);
	check(
		'the runtime bundle carries the export result whole',
		/\n\t{2}symbols,\n/.test(runtime) && runtime.includes('symbols: SymbolExportResult;'),
		true,
	);
	const scenes = readLF(`${here}../../lines/src/editor-scenes.ts`);
	check(
		'the game reads `symbols.symbolFx` off both bundles (runtime, then baked)',
		['runtimeBundle!.symbols?.symbolFx', 'bakedBundle.symbols?.symbolFx'].map((read) =>
			scenes.includes(read),
		),
		[true, true],
	);
}

console.log('\n4. the other writers keep it');
{
	const key = symbolsDocKey(CLIENT, PROJECT);
	const seeded = await saveSymbolsDoc(CLIENT, PROJECT, {
		version: 1,
		symbols: {},
		symbolFx: AUTHORED,
	});
	const ctx = {
		scope: { clientKey: CLIENT, projectKey: PROJECT },
		savedBy: {
			uid: 'u1',
			name: 'Director',
			tool: 'director',
			agent: 'animator',
			runId: 'run1',
			at: '2026-10-21T00:00:00.000Z',
			rev: 'r1',
		},
	} as unknown as AdapterContext;
	await setState.handler(ctx, {
		symbol: 'H1',
		state: 'land',
		binding: { type: 'sprite', assetKey: 'symbols::h1_land' },
		baseEtag: seeded.etag!,
	});
	const after = JSON.parse(R2.get(key)!.body) as Record<string, unknown> & {
		symbols: Record<string, Record<string, unknown>>;
	};
	check('Director set_state wrote its binding', after.symbols.H1?.land, {
		type: 'sprite',
		assetKey: 'symbols::h1_land',
	});
	check('…and kept every symbol FX', after.symbolFx, AUTHORED);

	const bonusImport = readLF(fileURLToPath(src('lib/server/projectBonusImport.ts')));
	check(
		'a bonus import carries the imported symbols’ FX with their bindings',
		/const SYMBOL_BLOCKS = \[[^\]]*'symbolFx'[^\]]*\] as const;/.test(bonusImport),
		true,
	);
}

console.log(
	failures === 0
		? `\nsymbol Element FX: OK (${checks} checks)`
		: `\nsymbol Element FX: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
