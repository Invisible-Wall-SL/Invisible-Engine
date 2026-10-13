/**
 * Contract check for "a save keeps the top-level blocks it does not know"
 * (`docs/conventions/doc-readers.md`, "Round-tripping"):
 *   pnpm --filter launcher-api check:save-keeps-unknown-blocks
 *
 * The gap it closes: an OLDER launcher (a rollback, a rolling deploy) loads a doc a newer one
 * wrote, its reader drops the block it does not know, and the author's next `If-Match` save
 * deleted that block from R2. Symbols could recover it from a backup; win text had no backup.
 * Win text also keeps a field a newer launcher wrote one level down, inside a family (`toast`,
 * `jackpots`, …). Components keep their unknown top-level fields and, matched by id, the unknown
 * fields of every node, param, signal and slot the author kept, across the save, the project
 * defaults sidecar, promote-to-shared and a defaults restore.
 *
 * Runs the REAL `saveSymbolsDoc` / `saveWinTextDoc` / `saveComponent` / `saveComponentDefaults` /
 * `storedUnknownBlocks`. Only `r2.ts` is
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
		deleteObject: async (key: string) => void bucket.delete(key),
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

// `componentStorage` reaches these only for a cross-project rig ref, which no fixture here has.
mock.module(server('rig.ts'), { namedExports: { loadSharedSkeletonIndex: async () => [] } });
mock.module(server('projects.ts'), { namedExports: { projectClientKey: async () => null } });

const { symbolsDocKey, winTextDocKey } = await import('../src/lib/server/projectPaths.ts');
const { normalizeSymbolsDoc, saveSymbolsDoc, symbolsDocSchema } =
	await import('../src/lib/server/symbolsStorage.ts');
const { normalizeWinTextDoc, saveWinTextDoc, winTextDocSchema } =
	await import('../src/lib/server/winTextStorage.ts');
const { storedUnknownBlocks, unknownTopLevelBlocks } =
	await import('../src/lib/server/unknownBlocks.ts');
const {
	editorComponentKey,
	projectComponentDefaultsKey,
	projectComponentKey,
	projectComponentVersionKey,
} = await import('../src/lib/server/projectPaths.ts');
const { normalizeComponent, saveComponent } = await import('../src/lib/server/componentStorage.ts');
const { saveComponentDefaults } = await import('../src/lib/server/componentDefaultsStorage.ts');
const { BUILTIN_COMPONENTS } = await import('engine-layout');

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
	// A KNOWN block the read dropped over a newer enum value is not kept: it is not an unknown key,
	// and keeping it would look exactly like a block the author cleared.
	const etag = seed(symbolsKey, { ...SYMBOLS, tumblePattern: { pattern: 'spiral', stepMs: 40 } });
	const loaded = normalizeSymbolsDoc(stored(symbolsKey));
	check(
		'symbols: an If-Match save after a read dropped a known block lands',
		await outcome(() => saveSymbolsDoc('c', 'p', loaded, etag)),
		'landed',
	);
	check(
		'symbols: …and does not keep that known block',
		'tumblePattern' in stored(symbolsKey),
		false,
	);
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

// ── Win text families: a field a newer launcher wrote INSIDE `toast`, `jackpots`, … ──────────

const NESTED = { futureField: { mode: 'swirl' }, futureFlag: true };

{
	const etag = seed(winTextKey, {
		...WIN_TEXT,
		toast: { ...WIN_TEXT.toast, ...NESTED },
		lineMessage: { ...WIN_TEXT.lineMessage, ...NESTED },
		wheel: NESTED,
		updatedAt: 'then',
	});
	const loaded = normalizeWinTextDoc(stored(winTextKey));
	check(
		'win text families: the load drops the unknown fields',
		'futureFlag' in loaded.toast!,
		false,
	);
	const result = await saveWinTextDoc('c', 'p', { ...loaded, toast: { full: 'WIN' } }, etag);
	const after = stored(winTextKey);
	check(
		'win text families: a family the author edited keeps its unknown fields after the edit',
		after.toast,
		{ full: 'WIN', ...NESTED },
	);
	check('win text families: a family the author left alone keeps them', after.lineMessage, {
		...WIN_TEXT.lineMessage,
		...NESTED,
	});
	check('win text families: a family holding only unknown fields is kept', after.wheel, NESTED);
	check(
		'win text families: the returned doc omits the kept fields',
		[result.doc.toast, 'wheel' in result.doc],
		[{ full: 'WIN' }, false],
	);
	check('win text families: updatedAt is written last', Object.keys(after).at(-1), 'updatedAt');
}

{
	// The author emptied a family's known fields (dropped, or blanked and pruned): they could not see
	// its unknown fields, so those are not theirs to delete and come back on their own.
	const etag = seed(winTextKey, { ...WIN_TEXT, toast: { ...WIN_TEXT.toast, ...NESTED } });
	const { toast: _toast, ...withoutToast } = normalizeWinTextDoc(stored(winTextKey));
	await saveWinTextDoc('c', 'p', withoutToast, etag);
	check(
		'win text families: emptying a family keeps its unknown fields',
		stored(winTextKey).toast,
		NESTED,
	);
	const reseeded = seed(winTextKey, { ...WIN_TEXT, toast: { ...WIN_TEXT.toast, ...NESTED } });
	await saveWinTextDoc('c', 'p', { ...withoutToast, toast: { full: '  ' } }, reseeded);
	check(
		'win text families: …and so does blanking it until it is pruned',
		stored(winTextKey).toast,
		NESTED,
	);
}

{
	const nested = { ...WIN_TEXT, toast: { ...WIN_TEXT.toast, ...NESTED } };
	seed(winTextKey, nested);
	await saveWinTextDoc('c', 'p', WIN_TEXT, undefined);
	check('win text families: a forced save keeps nothing', stored(winTextKey).toast, WIN_TEXT.toast);
	seed(winTextKey, nested);
	check(
		'win text families: a stale If-Match save still conflicts',
		await outcome(() => saveWinTextDoc('c', 'p', WIN_TEXT, '"stale"')),
		'ConflictError',
	);
	check(
		'win text families: …and leaves the stored fields alone',
		stored(winTextKey).toast,
		nested.toast,
	);
}

{
	// A newer TAB posting a family field this build does not know: the stored copy wins.
	const etag = seed(winTextKey, { ...WIN_TEXT, toast: { ...WIN_TEXT.toast, futureFlag: true } });
	await saveWinTextDoc(
		'c',
		'p',
		{ ...WIN_TEXT, toast: { ...WIN_TEXT.toast, futureFlag: false } },
		etag,
	);
	check('win text families: the stored value is kept over a posted one', stored(winTextKey).toast, {
		...WIN_TEXT.toast,
		futureFlag: true,
	});
}

// ── Components: top-level fields, and the fields of every entity the author kept (by id) ─────

type Def = import('engine-layout').ComponentDef;
const COMPONENT = {
	id: 'c_spin',
	name: 'Spin button',
	version: 3,
	scope: 'project',
	category: 'ui',
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{ id: 'n_a', kind: 'sprite', x: 10, y: 0, rotation: 0.5 },
			{
				id: 'n_box',
				kind: 'container',
				x: 0,
				y: 0,
				children: [{ id: 'n_b', kind: 'text', x: 0, y: 0, text: 'SPIN' }],
			},
		],
	},
	params: [{ key: 'label', kind: 'string', default: 'SPIN' }],
	signals: [{ key: 'onSpin' }],
	slots: [{ slotId: 's_icon', name: 'Icon', kind: 'sprite' }],
	standsFor: 'SpinButton',
} as const;
const componentKey = projectComponentKey('p', COMPONENT.id);
const sharedComponentKey = editorComponentKey(COMPONENT.id);
const LISTENER = { on: [{ event: 'tap', fire: 'spin' }] };
/** What a newer launcher wrote: a top-level block, and a field in a node, the root and each row. */
const newerComponent = (): Record<string, unknown> => {
	const doc = JSON.parse(JSON.stringify(COMPONENT)) as StoredDef;
	doc.events = [{ id: 'e_tap', name: 'tap' }];
	Object.assign(doc.root, LISTENER);
	Object.assign(doc.root.children[0], LISTENER);
	Object.assign(doc.root.children[1].children[0], LISTENER);
	Object.assign(doc.params[0], { tooltip: 'Button text' });
	Object.assign(doc.signals[0], { payload: 'none' });
	Object.assign(doc.slots[0], { aspect: 'square' });
	return doc;
};
/** The older launcher's view: the read drops what it does not know, except on child nodes (pass-through). */
const olderView = (): Def => normalizeComponent(stored(componentKey) as unknown as Def);
/** A tab that also lost a field on a child node (a client-side rebuild). */
const withoutChildListener = (def: Def): Def => {
	const out = structuredClone(def) as StoredDef;
	delete out.root.children[0].on;
	return out as Def;
};
/** Each case starts from no stored defs and no version snapshots (snapshots are immutable). */
const resetComponents = (): void => {
	for (const key of [...bucket.keys()]) {
		if (key.startsWith('editor/p/components/') || key.startsWith('_shared/editor-components/')) {
			bucket.delete(key);
		}
	}
};
type Tree = { id: string; children?: Tree[]; [k: string]: unknown };
/** A stored def as the cases poke at it: loose, since half of what it holds this build does not know. */
interface StoredNode {
	id: string;
	children: StoredNode[];
	[key: string]: unknown;
}
interface StoredDef {
	root: StoredNode;
	params: Record<string, unknown>[];
	signals: Record<string, unknown>[];
	slots: Record<string, unknown>[];
	events?: { id: string }[];
	[key: string]: unknown;
}
const nodeById = (root: unknown, id: string): Tree | undefined => {
	const walk = (n: Tree): Tree | undefined =>
		n.id === id ? n : (n.children ?? []).map(walk).find(Boolean);
	return walk(root as Tree);
};

{
	resetComponents();
	const etag = seed(componentKey, newerComponent());
	const loaded = olderView();
	check(
		'components: the read drops the unknown top-level, root and row fields',
		['events' in loaded, 'on' in loaded.root, 'tooltip' in loaded.params![0]],
		[false, false, false],
	);
	check(
		'components: …and passes a child node’s through',
		'on' in (nodeById(loaded.root, 'n_b') ?? {}),
		true,
	);
	const result = await saveComponent(withoutChildListener(loaded), 'p', etag);
	const after = stored(componentKey) as StoredDef;
	check('components: a no-op save from the older view keeps the version', result.version, 3);
	check('components: …and keeps the unknown top-level block', after.events, [
		{ id: 'e_tap', name: 'tap' },
	]);
	check('components: …the root’s unknown field', after.root.on, LISTENER.on);
	check(
		'components: …a surviving node’s unknown field the tab lost',
		nodeById(after.root, 'n_a')?.on,
		LISTENER.on,
	);
	check('components: …a nested node’s', nodeById(after.root, 'n_b')?.on, LISTENER.on);
	check(
		'components: …and each row’s, matched by id',
		[after.params[0].tooltip, after.signals[0].payload, after.slots[0].aspect],
		['Button text', 'none', 'square'],
	);
	check(
		'components: the version snapshot is the merged doc',
		bucket.get(projectComponentVersionKey('p', COMPONENT.id, 3))?.text,
		bucket.get(componentKey)?.text,
	);
	check(
		'components: the returned ETag is the stored one',
		result.etag,
		bucket.get(componentKey)?.etag,
	);
}

{
	resetComponents();
	// The author deleted a node, a param and a slot, and cleared known fields.
	const etag = seed(componentKey, newerComponent());
	const edited = structuredClone(olderView()) as StoredDef;
	edited.root.children = edited.root.children.filter((n: Tree) => n.id !== 'n_box');
	delete edited.root.children[0].rotation;
	edited.params = [{ key: 'title', kind: 'string' }];
	delete edited.slots;
	delete edited.standsFor;
	const result = await saveComponent(edited as Def, 'p', etag);
	const after = stored(componentKey) as StoredDef;
	check('components: an edit bumps the version', result.version, 4);
	check('components: a deleted node is not resurrected', nodeById(after.root, 'n_b'), undefined);
	check('components: …nor its parent', nodeById(after.root, 'n_box'), undefined);
	check(
		'components: a known node field the author cleared is not resurrected',
		'rotation' in (nodeById(after.root, 'n_a') ?? {}),
		false,
	);
	check('components: a deleted row is not resurrected, nor grafted onto a new row', after.params, [
		{ key: 'title', kind: 'string' },
	]);
	check(
		'components: a cleared known block / field is not resurrected',
		['slots' in after, 'standsFor' in after],
		[false, false],
	);
	check('components: the top-level block still is kept', after.events?.length, 1);
	check(
		'components: the snapshot of the bumped version is the merged doc',
		bucket.get(projectComponentVersionKey('p', COMPONENT.id, 4))?.text,
		bucket.get(componentKey)?.text,
	);
}

{
	resetComponents();
	// A node that MOVED keeps its fields: entities match by id anywhere under the root.
	const etag = seed(componentKey, newerComponent());
	const edited = structuredClone(olderView()) as StoredDef;
	const moved = edited.root.children[1].children.pop();
	delete moved.on;
	edited.root.children.push(moved);
	await saveComponent(edited as Def, 'p', etag);
	check(
		'components: a node moved to another parent keeps its unknown field',
		nodeById(stored(componentKey).root, 'n_b')?.on,
		LISTENER.on,
	);
}

{
	resetComponents();
	// A NEWER tab posting values this build does not know: the stored copy wins where the normalizer
	// drops the posted value; a child node passes through, so its posted value stands.
	const etag = seed(componentKey, newerComponent());
	const posted = newerComponent() as StoredDef;
	posted.events = [{ id: 'e_new', name: 'hold' }];
	posted.params[0].tooltip = 'Theirs';
	posted.root.children[0].on = [{ event: 'hover', fire: 'glow' }];
	await saveComponent(posted as unknown as Def, 'p', etag);
	const after = stored(componentKey) as StoredDef;
	check(
		'components: a posted unknown top-level / row field loses to the stored copy',
		[after.events?.[0]?.id, after.params[0].tooltip],
		['e_tap', 'Button text'],
	);
	check('components: a posted child node field stands', nodeById(after.root, 'n_a')?.on, [
		{ event: 'hover', fire: 'glow' },
	]);
}

{
	resetComponents();
	// Force: the author overwrites bytes they never loaded. Create: nothing stored.
	seed(componentKey, newerComponent());
	await saveComponent(withoutChildListener(olderView()), 'p', undefined);
	const after = stored(componentKey) as StoredDef;
	check(
		'components: a forced save keeps nothing',
		['events' in after, 'on' in after.root, 'on' in (nodeById(after.root, 'n_a') ?? {})],
		[false, false, false],
	);
	bucket.delete(componentKey);
	await saveComponent(COMPONENT as unknown as Def, 'p', null);
	check('components: a create writes the normalized def', stored(componentKey), {
		...normalizeComponent(structuredClone(COMPONENT) as unknown as Def),
	});
}

{
	resetComponents();
	seed(componentKey, newerComponent());
	const before = bucket.get(componentKey)?.text;
	check(
		'components: a stale If-Match save still conflicts',
		await outcome(() => saveComponent(olderView(), 'p', '"stale"')),
		'ConflictError',
	);
	check('components: …and writes nothing', bucket.get(componentKey)?.text, before);
}

{
	resetComponents();
	// Byte-identical for known-only defs: the bytes a save wrote before the graft existed.
	const etag = seed(componentKey, normalizeComponent(structuredClone(COMPONENT) as unknown as Def));
	const edited = { ...structuredClone(COMPONENT), name: 'Spin' } as unknown as Def;
	await saveComponent(edited, 'p', etag);
	check(
		'components: a known-only def saves byte-identically',
		bucket.get(componentKey)?.text,
		JSON.stringify({ ...normalizeComponent(structuredClone(edited)), version: 4 }, null, 2),
	);
	// Every built-in, stored as a fork and saved unchanged, round-trips to the same bytes.
	const drift: string[] = [];
	for (const builtin of BUILTIN_COMPONENTS) {
		const def = normalizeComponent(structuredClone({ ...builtin, scope: 'project' }) as Def);
		const key = projectComponentKey('p', def.id);
		const bytes = JSON.stringify(def, null, 2);
		const builtinEtag = seed(key, def);
		await saveComponent(normalizeComponent(JSON.parse(bytes) as Def), 'p', builtinEtag);
		if (bucket.get(key)?.text !== bytes) drift.push(def.id);
	}
	check('components: every built-in round-trips byte-identically', drift, []);
}

{
	resetComponents();
	// Promote-to-shared keeps the PROMOTED project def's unknown fields, not the replaced shared
	// copy's, also when the author promotes on top of theirs (`force`).
	const projectEtag = seed(componentKey, newerComponent());
	const seedShared = (doc: unknown): string => {
		for (const key of [...bucket.keys()]) {
			if (key.startsWith('_shared/editor-components/')) bucket.delete(key);
		}
		return seed(sharedComponentKey, doc);
	};
	const draft = { ...withoutChildListener(olderView()), scope: 'shared' as const };
	for (const force of [false, true]) {
		const sharedEtag = seedShared({
			...COMPONENT,
			scope: 'shared',
			sharedOnly: 1,
		});
		await saveComponent(draft, undefined, force ? undefined : sharedEtag, {
			promotedFrom: { projectKey: 'p', baseEtag: projectEtag },
		});
		const after = stored(sharedComponentKey) as StoredDef;
		check(
			`components promote${force ? ' (force)' : ''}: keeps the project def’s unknown fields`,
			[
				after.events?.length,
				after.root.on,
				nodeById(after.root, 'n_a')?.on,
				after.params[0].tooltip,
			],
			[1, LISTENER.on, LISTENER.on, 'Button text'],
		);
		check(
			`components promote${force ? ' (force)' : ''}: drops the shared copy’s`,
			'sharedOnly' in after,
			false,
		);
	}
	const sharedEtag = seedShared({ ...COMPONENT, scope: 'shared' });
	await saveComponent(draft, undefined, sharedEtag, {
		promotedFrom: { projectKey: 'p', baseEtag: '"stale"' },
	});
	check(
		'components promote: a project def saved since the draft loaded is not grafted from',
		'events' in stored(sharedComponentKey),
		false,
	);
	const plainEtag = seedShared(newerComponent());
	await saveComponent(
		{ ...normalizeComponent(stored(sharedComponentKey) as unknown as Def), scope: 'shared' },
		undefined,
		plainEtag,
	);
	check(
		'components: a plain shared save keeps the shared copy’s own unknown fields',
		stored(sharedComponentKey).events,
		[{ id: 'e_tap', name: 'tap' }],
	);
}

// ── Component defaults ("This game's defaults"): `{ id, params }` plus a newer build's fields ─

{
	const defaultsKey = projectComponentDefaultsKey('p', COMPONENT.id);
	const etag = seed(defaultsKey, { id: COMPONENT.id, params: { label: 'GO' }, inputs: { on: 1 } });
	await saveComponentDefaults('p', COMPONENT.id, { label: 'SPIN' }, etag);
	check('component defaults: an If-Match save keeps the unknown field', stored(defaultsKey), {
		id: COMPONENT.id,
		params: { label: 'SPIN' },
		inputs: { on: 1 },
	});
	seed(defaultsKey, { id: COMPONENT.id, params: {}, inputs: { on: 1 } });
	await saveComponentDefaults('p', COMPONENT.id, { label: 'SPIN' }, undefined);
	check('component defaults: a forced save keeps nothing', 'inputs' in stored(defaultsKey), false);
	seed(defaultsKey, { id: COMPONENT.id, params: {}, inputs: { on: 1 } });
	check(
		'component defaults: a stale If-Match save still conflicts',
		await outcome(() => saveComponentDefaults('p', COMPONENT.id, {}, '"stale"')),
		'ConflictError',
	);
	const liveEtag = seed(defaultsKey, { id: COMPONENT.id, params: {}, liveOnly: 1 });
	const backup = { id: COMPONENT.id, params: { label: 'OLD' }, inputs: { on: 2 } };
	await saveComponentDefaults('p', COMPONENT.id, backup.params, liveEtag, 'always', {
		unknownFrom: backup,
	});
	check(
		'component defaults restore: keeps the backup’s unknown fields, not the live doc’s',
		stored(defaultsKey),
		backup,
	);
	const knownEtag = seed(defaultsKey, { id: COMPONENT.id, params: { label: 'GO' } });
	await saveComponentDefaults('p', COMPONENT.id, { label: 'SPIN' }, knownEtag);
	check(
		'component defaults: a known-only sidecar saves byte-identically',
		bucket.get(defaultsKey)?.text,
		JSON.stringify({ id: COMPONENT.id, params: { label: 'SPIN' } }, null, 2),
	);
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} save-keeps-unknown-blocks checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} save-keeps-unknown-blocks checks pass`);
