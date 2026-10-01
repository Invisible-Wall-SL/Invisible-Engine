/**
 * Contract check for "a save keeps the top-level blocks it does not know"
 * (`docs/conventions/doc-readers.md`, "Round-tripping"):
 *   pnpm --filter launcher-api check:save-keeps-unknown-blocks
 *
 * The gap it closes: an OLDER launcher (a rollback, a rolling deploy) loads a doc a newer one
 * wrote, its reader drops the block it does not know, and the author's next `If-Match` save
 * deleted that block from R2. Symbols could recover it from a backup; win text had no backup.
 *
 * Runs the REAL `saveSymbolsDoc` / `saveWinTextDoc` / `storedUnknownBlocks`. Only `r2.ts` is
 * replaced, by an in-memory bucket that honours `If-Match` / `If-None-Match` and records every
 * GET, so "no read was made" is observable. A newer launcher is played by seeding R2 with a doc
 * carrying blocks this build's schemas do not declare.
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';

interface Stored {
	text: string;
	etag: string | null;
}
interface Cond {
	ifMatch?: string;
	ifNoneMatch?: string;
}

const bucket = new Map<string, Stored>();
const gets: string[] = [];
/** Runs just after the next GET answers: another author's save landing mid-request. */
let afterGet: (() => void) | null = null;

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
const etagOf = (text: string): string => `"${createHash('md5').update(text).digest('hex')}"`;

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (baseEtag: string | null | undefined): Cond | undefined => {
			if (baseEtag === undefined) return undefined;
			return baseEtag === null ? { ifNoneMatch: '*' } : { ifMatch: baseEtag };
		},
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.text.length, lastModified: 0 } : null;
		},
		copyObject: async (src: string, dest: string) => {
			const o = bucket.get(src);
			if (!o) return false;
			bucket.set(dest, { ...o });
			return true;
		},
		putObjectText: async (key: string, text: string, _type: string, cond?: Cond) => {
			const current = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && current) throw new ConflictError(key);
			if (cond?.ifMatch !== undefined && current?.etag !== cond.ifMatch) {
				throw new ConflictError(key);
			}
			const etag = etagOf(text);
			bucket.set(key, { text, etag });
			return etag;
		},
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		getObjectTextWithEtag: async (key: string) => {
			gets.push(key);
			const o = bucket.get(key);
			const race = afterGet;
			afterGet = null;
			race?.();
			return o ? { text: o.text, etag: o.etag } : null;
		},
		listAllObjects: async (prefix: string) =>
			[...bucket]
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, o]) => ({ key, size: o.text.length, lastModified: 0 })),
		deleteObjects: async (keys: string[]) => {
			for (const key of keys) bucket.delete(key);
		},
		listAllKeys: async (prefix: string) =>
			[...bucket.keys()].filter((key) => key.startsWith(prefix)),
		listObjects: async () => ({ keys: [], prefixes: [] }),
		objectExists: async (key: string) => bucket.has(key),
	},
});

const { symbolsDocKey, winTextDocKey } = await import('../src/lib/server/projectPaths.ts');
const { normalizeSymbolsDoc, saveSymbolsDoc, symbolsDocSchema } =
	await import('../src/lib/server/symbolsStorage.ts');
const { normalizeWinTextDoc, saveWinTextDoc, winTextDocSchema } =
	await import('../src/lib/server/winTextStorage.ts');
const { storedUnknownBlocks, unknownTopLevelBlocks } =
	await import('../src/lib/server/unknownBlocks.ts');

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}
async function outcome(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
		return 'landed';
	} catch (e) {
		return e instanceof Error ? e.name : String(e);
	}
}

const seed = (key: string, doc: unknown): string => {
	const text = JSON.stringify(doc, null, 2);
	const etag = etagOf(text);
	bucket.set(key, { text, etag });
	return etag;
};
const stored = (key: string): Record<string, unknown> =>
	JSON.parse(bucket.get(key)?.text ?? 'null') as Record<string, unknown>;
/** What the save wrote, minus its clock. */
const withoutStamp = (doc: Record<string, unknown>): Record<string, unknown> => {
	const { updatedAt: _updatedAt, ...rest } = doc;
	return rest;
};
/** The bytes a save of `known` wrote before the graft existed: the normalized doc, then the stamp. */
const legacyBytes = (known: unknown, updatedAt: string): string =>
	JSON.stringify({ ...(known as object), updatedAt }, null, 2);

const FUTURE = {
	futureBlock: { mode: 'swirl', layers: [{ id: 'a', alpha: 0.5 }] },
	futureFlag: true,
};

const WIN_TEXT = {
	version: 1,
	lineMessage: { default: '{count} {symbolName}' },
	toast: { full: 'You win {amount}' },
	amountFormat: '{amount}',
};
const winTextKey = winTextDocKey('c', 'p');

// ── Symbols ─────────────────────────────────────────────────────────────────────────────────
const SYMBOLS = {
	version: 1,
	symbols: {
		H1: {
			static: { type: 'sprite', assetKey: 'symbols', sizeRatios: { width: 1, height: 1 } },
			win: { type: 'spine', assetKey: 'symbols/h1', animationName: 'win', loop: false },
		},
	},
	names: { H1: { singular: 'Banana', plural: 'Bananas' } },
	winExplode: { enabled: true },
};
const symbolsKey = symbolsDocKey('c', 'p');
const edited = { ...SYMBOLS, names: { H1: { singular: 'Apple', plural: 'Apples' } } };

{
	const etag = seed(symbolsKey, {
		...SYMBOLS,
		...FUTURE,
		winLine: { enabled: true, futureNested: 1 },
		updatedAt: 'then',
	});
	// The older launcher's author loaded the doc without the blocks, then edited a name.
	const loaded = normalizeSymbolsDoc(stored(symbolsKey));
	check('symbols: the load drops the unknown blocks', 'futureBlock' in loaded, false);
	const { winLine: _winLine, ...withoutLine } = loaded;
	const result = await saveSymbolsDoc('c', 'p', { ...withoutLine, names: edited.names }, etag);
	const after = stored(symbolsKey);
	check(
		'symbols: If-Match save keeps each unknown top-level block',
		{
			futureBlock: after.futureBlock,
			futureFlag: after.futureFlag,
		},
		FUTURE,
	);
	check('symbols: the author’s edit lands', after.names, edited.names);
	check('symbols: a known block the author deleted is not resurrected', 'winLine' in after, false);
	check(
		'symbols: updatedAt is the new stamp, written last',
		[after.updatedAt === result.doc.updatedAt, Object.keys(after).at(-1)],
		[true, 'updatedAt'],
	);
	check('symbols: the returned doc omits the kept blocks', 'futureBlock' in result.doc, false);
	check('symbols: the returned ETag is the stored one', result.etag, bucket.get(symbolsKey)?.etag);

	// A second save from the same older launcher keeps them again (the chain holds).
	await saveSymbolsDoc('c', 'p', SYMBOLS, result.etag);
	check(
		'symbols: a following save keeps them too',
		{
			futureBlock: stored(symbolsKey).futureBlock,
			futureFlag: stored(symbolsKey).futureFlag,
		},
		FUTURE,
	);
}

{
	// Nested unknowns are NOT grafted: only whole top-level blocks.
	const etag = seed(symbolsKey, { ...SYMBOLS, winExplode: { enabled: true, delayMs: 120 } });
	await saveSymbolsDoc('c', 'p', SYMBOLS, etag);
	check('symbols: a nested unknown key is not grafted', stored(symbolsKey).winExplode, {
		enabled: true,
	});
}

{
	// Force (no precondition): the author chose to overwrite bytes they never loaded — no read, no graft.
	seed(symbolsKey, { ...SYMBOLS, ...FUTURE });
	gets.length = 0;
	await saveSymbolsDoc('c', 'p', SYMBOLS, undefined);
	check('symbols: a forced save reads nothing', gets, []);
	check('symbols: a forced save keeps nothing', 'futureBlock' in stored(symbolsKey), false);
}

{
	// Create (If-None-Match): nothing stored to keep, and nothing is read.
	bucket.delete(symbolsKey);
	gets.length = 0;
	await saveSymbolsDoc('c', 'p', SYMBOLS, null);
	check('symbols: a create reads nothing', gets, []);
}

{
	// A stale tab: the stored ETag is not the save's. The graft is skipped and the save 409s.
	seed(symbolsKey, { ...SYMBOLS, ...FUTURE });
	check(
		'symbols: a stale If-Match save still conflicts',
		await outcome(() => saveSymbolsDoc('c', 'p', SYMBOLS, '"stale"')),
		'ConflictError',
	);
	check(
		'storedUnknownBlocks: nothing when the stored ETag is not baseEtag',
		await storedUnknownBlocks(symbolsKey, symbolsDocSchema, '"stale"'),
		{},
	);
	check(
		'storedUnknownBlocks: the blocks when it is',
		await storedUnknownBlocks(symbolsKey, symbolsDocSchema, bucket.get(symbolsKey)?.etag),
		FUTURE,
	);
	check(
		'storedUnknownBlocks: nothing for a create',
		await storedUnknownBlocks(symbolsKey, symbolsDocSchema, null),
		{},
	);
	check(
		'storedUnknownBlocks: nothing for a forced save',
		await storedUnknownBlocks(symbolsKey, symbolsDocSchema, undefined),
		{},
	);
	bucket.set(symbolsKey, { text: '{"futureBlock":', etag: '"corrupt"' });
	check(
		'storedUnknownBlocks: nothing from unparseable bytes',
		await storedUnknownBlocks(symbolsKey, symbolsDocSchema, '"corrupt"'),
		{},
	);
	check(
		'symbols: an If-Match save over unparseable bytes still lands',
		await outcome(() => saveSymbolsDoc('c', 'p', SYMBOLS, '"corrupt"')),
		'landed',
	);
	bucket.set(symbolsKey, { text: JSON.stringify({ ...SYMBOLS, ...FUTURE }), etag: null });
	check(
		'storedUnknownBlocks: nothing when the stored ETag is unknown',
		await storedUnknownBlocks(symbolsKey, symbolsDocSchema, '"x"'),
		{},
	);
}

{
	// Another author saves between the graft's read and the PUT: the PUT's If-Match refuses it.
	const etag = seed(symbolsKey, { ...SYMBOLS, ...FUTURE });
	afterGet = () => void seed(symbolsKey, { ...SYMBOLS, theirs: 1 });
	check(
		'symbols: a save landing after the graft read still conflicts',
		await outcome(() => saveSymbolsDoc('c', 'p', SYMBOLS, etag)),
		'ConflictError',
	);
	check('symbols: …and the other author’s doc stands', stored(symbolsKey).theirs, 1);
	const wtEtag = seed(winTextKey, { ...WIN_TEXT, ...FUTURE });
	afterGet = () => void seed(winTextKey, { ...WIN_TEXT, theirs: 1 });
	check(
		'win text: a save landing after the graft read still conflicts',
		await outcome(() => saveWinTextDoc('c', 'p', WIN_TEXT, wtEtag)),
		'ConflictError',
	);
	check('win text: …and the other author’s doc stands', stored(winTextKey).theirs, 1);
}

{
	// Byte-identical for a known-only doc: exactly the bytes a save wrote before the graft existed.
	const etag = seed(symbolsKey, { ...SYMBOLS, updatedAt: 'then' });
	const result = await saveSymbolsDoc('c', 'p', edited, etag);
	check(
		'symbols: a known-only doc saves byte-identically',
		bucket.get(symbolsKey)?.text,
		legacyBytes(normalizeSymbolsDoc(edited), result.doc.updatedAt ?? ''),
	);
}

{
	// A key named like an Object.prototype member is kept as an own key, not set on the prototype.
	const text = JSON.stringify({ ...SYMBOLS, __proto__x: 1 }).replace('"__proto__x"', '"__proto__"');
	bucket.set(symbolsKey, { text, etag: etagOf(text) });
	await saveSymbolsDoc('c', 'p', SYMBOLS, etagOf(text));
	check(
		'symbols: a stored "__proto__" block is kept as an own key',
		Object.hasOwn(stored(symbolsKey), '__proto__'),
		true,
	);
}

{
	// Restore: the RESTORED bytes' unknown blocks are kept, not the live doc's.
	const etag = seed(symbolsKey, { ...SYMBOLS, liveOnly: 1 });
	gets.length = 0;
	await saveSymbolsDoc('c', 'p', { ...SYMBOLS, ...FUTURE }, etag, 'always', { unknownFrom: 'doc' });
	const after = stored(symbolsKey);
	check(
		'symbols restore: keeps the backup’s unknown blocks',
		{
			futureBlock: after.futureBlock,
			futureFlag: after.futureFlag,
		},
		FUTURE,
	);
	check('symbols restore: drops the live doc’s', 'liveOnly' in after, false);
	check('symbols restore: reads nothing to graft', gets, []);
}

check(
	'unknownTopLevelBlocks: declared keys (incl. updatedAt) are never "unknown"',
	unknownTopLevelBlocks(symbolsDocSchema, { ...SYMBOLS, updatedAt: 'x', ...FUTURE }),
	FUTURE,
);
check(
	'unknownTopLevelBlocks: a non-object yields nothing',
	[unknownTopLevelBlocks(symbolsDocSchema, null), unknownTopLevelBlocks(symbolsDocSchema, [1])],
	[{}, {}],
);

// ── Win text (no backups: a dropped block was gone for good) ─────────────────────────────────

{
	const etag = seed(winTextKey, { ...WIN_TEXT, ...FUTURE, updatedAt: 'then' });
	const loaded = normalizeWinTextDoc(stored(winTextKey));
	const { amountFormat: _amountFormat, ...withoutFormat } = loaded;
	const result = await saveWinTextDoc('c', 'p', { ...withoutFormat, toast: { full: 'WIN' } }, etag);
	const after = stored(winTextKey);
	check(
		'win text: If-Match save keeps each unknown top-level block',
		{
			futureBlock: after.futureBlock,
			futureFlag: after.futureFlag,
		},
		FUTURE,
	);
	check('win text: the author’s edit lands', after.toast, { full: 'WIN' });
	check(
		'win text: a known field the author cleared is not resurrected',
		'amountFormat' in after,
		false,
	);
	check('win text: the returned doc omits the kept blocks', 'futureBlock' in result.doc, false);
	check('win text: updatedAt is written last', Object.keys(after).at(-1), 'updatedAt');
}

{
	seed(winTextKey, { ...WIN_TEXT, ...FUTURE });
	gets.length = 0;
	await saveWinTextDoc('c', 'p', WIN_TEXT, undefined);
	check('win text: a forced save reads nothing', gets, []);
	check('win text: a forced save keeps nothing', 'futureBlock' in stored(winTextKey), false);
	bucket.delete(winTextKey);
	gets.length = 0;
	await saveWinTextDoc('c', 'p', WIN_TEXT, null);
	check('win text: a create reads nothing', gets, []);
}

{
	seed(winTextKey, { ...WIN_TEXT, ...FUTURE });
	check(
		'win text: a stale If-Match save still conflicts',
		await outcome(() => saveWinTextDoc('c', 'p', WIN_TEXT, '"stale"')),
		'ConflictError',
	);
	check(
		'win text: …and leaves the stored blocks alone',
		stored(winTextKey).futureBlock,
		FUTURE.futureBlock,
	);
	check(
		'storedUnknownBlocks (win text): nothing when the stored ETag is not baseEtag',
		await storedUnknownBlocks(winTextKey, winTextDocSchema, '"stale"'),
		{},
	);
}

{
	const etag = seed(winTextKey, { ...WIN_TEXT, updatedAt: 'then' });
	const result = await saveWinTextDoc('c', 'p', WIN_TEXT, etag);
	check(
		'win text: a known-only doc saves byte-identically',
		bucket.get(winTextKey)?.text,
		legacyBytes(normalizeWinTextDoc(WIN_TEXT), result.doc.updatedAt),
	);
	check(
		'win text: the saved doc is the normalized one',
		withoutStamp(stored(winTextKey)),
		normalizeWinTextDoc(WIN_TEXT),
	);
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} save-keeps-unknown-blocks checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} save-keeps-unknown-blocks checks pass`);
