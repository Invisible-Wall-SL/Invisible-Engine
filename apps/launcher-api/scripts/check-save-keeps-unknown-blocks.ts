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
 * `storedUnknownBlocks`. `r2.ts` is replaced by an in-memory bucket that honours `If-Match` /
 * `If-None-Match` and records every GET, so "no read was made" is observable (`rig.ts` and
 * `projects.ts` are stubbed, unreached by these fixtures). A newer launcher is played by seeding
 * R2 with a doc carrying blocks this build's schemas do not declare.
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
		// Copies of `r2.ts`'s pure precondition readers (the route's `writeGuard` imports them).
		jsonBaseEtag: (v: unknown) => (v === null ? null : typeof v === 'string' ? v : undefined),
		formBaseEtag: (v: unknown) => (typeof v !== 'string' ? undefined : v === '' ? null : v),
		objectExists: async (key: string) => bucket.has(key),
	},
});

// `componentStorage` reaches these only for a cross-project rig ref, which no fixture here has.
mock.module(server('rig.ts'), { namedExports: { loadSharedSkeletonIndex: async () => [] } });
mock.module(server('projects.ts'), { namedExports: { projectClientKey: async () => null } });
// The routes' gates: an admin with no overrides, and a project key taken as given.
mock.module(server('roleToolAccess.ts'), { namedExports: { getRoleOverrides: async () => ({}) } });
mock.module(server('userToolAccess.ts'), { namedExports: { getToolOverrides: async () => ({}) } });
mock.module(server('toolScope.ts'), {
	namedExports: {
		requireOptionalProjectKey: async (_user: unknown, project: string | null | undefined) =>
			project?.trim() ? project : undefined,
	},
});

const { symbolsDocKey, winTextDocKey } = await import('../src/lib/server/projectPaths.ts');
const { normalizeSymbolsDoc, saveSymbolsDoc, symbolsDocSchema } =
	await import('../src/lib/server/symbolsStorage.ts');
const { normalizeWinTextDoc, saveWinTextDoc, winTextDocSchema } =
	await import('../src/lib/server/winTextStorage.ts');
const { storedUnknownBlocks, unknownTopLevelBlocks } =
	await import('../src/lib/server/unknownBlocks.ts');
const {
	editorComponentKey,
	editorComponentVersionKey,
	projectComponentDefaultsKey,
	projectComponentKey,
	projectComponentVersionKey,
} = await import('../src/lib/server/projectPaths.ts');
const { normalizeComponent, saveComponent } = await import('../src/lib/server/componentStorage.ts');
const { saveComponentDefaults } = await import('../src/lib/server/componentDefaultsStorage.ts');
const { BUILTIN_COMPONENTS } = await import('engine-layout');
const componentRoute = await import('../src/routes/api/editor/component/+server.ts');
const defaultsBackupsRoute =
	await import('../src/routes/api/editor/component-defaults/backups/+server.ts');
const { listBackups } = await import('../src/lib/server/docBackups.ts');
const { componentDefaultsBackupTarget } = await import('../src/lib/server/projectPaths.ts');

type RouteEvent = Parameters<typeof componentRoute.POST>[0];
/** POST `body` through a real route handler as an admin. */
const post = async (
	handler: (event: RouteEvent) => Response | Promise<Response>,
	body: unknown,
	query = '',
): Promise<{ status: number; body: Record<string, unknown> }> => {
	const url = new URL(`http://launcher.test/api${query}`);
	const request = new Request(url, { method: 'POST', body: JSON.stringify(body) });
	const event = { request, url, locals: { user: { id: 'u', role: 'admin' } } };
	const res = await handler(event as unknown as RouteEvent);
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

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
const LISTENER = { gesture: [{ event: 'tap', fire: 'spin' }] };
/** What a newer launcher wrote: a top-level block, and a field in a node, the root and each row. */
const newerComponent = (): Record<string, unknown> => {
	const doc = JSON.parse(JSON.stringify(COMPONENT)) as StoredDef;
	doc.gestures = [{ id: 'e_tap', name: 'tap' }];
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
	delete out.root.children[0].gesture;
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
	gestures?: { id: string }[];
	[key: string]: unknown;
}
const nodeById = (root: unknown, id: string): StoredNode | undefined => {
	const walk = (n: StoredNode): StoredNode | undefined =>
		n.id === id ? n : (n.children ?? []).map(walk).find(Boolean);
	return walk(root as StoredNode);
};

{
	resetComponents();
	const etag = seed(componentKey, newerComponent());
	const loaded = olderView();
	check(
		'components: the read drops the unknown top-level, root and row fields',
		['gestures' in loaded, 'gesture' in loaded.root, 'tooltip' in loaded.params![0]],
		[false, false, false],
	);
	check(
		'components: …and passes a child node’s through',
		'gesture' in (nodeById(loaded.root, 'n_b') ?? {}),
		true,
	);
	const result = await saveComponent(withoutChildListener(loaded), 'p', etag);
	const after = stored(componentKey) as StoredDef;
	check('components: a no-op save from the older view keeps the version', result.version, 3);
	check('components: …and keeps the unknown top-level block', after.gestures, [
		{ id: 'e_tap', name: 'tap' },
	]);
	check('components: …the root’s unknown field', after.root.gesture, LISTENER.gesture);
	check(
		'components: …a surviving node’s unknown field the tab lost',
		nodeById(after.root, 'n_a')?.gesture,
		LISTENER.gesture,
	);
	check('components: …a nested node’s', nodeById(after.root, 'n_b')?.gesture, LISTENER.gesture);
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
	edited.root.children = edited.root.children.filter((n: StoredNode) => n.id !== 'n_box');
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
	check('components: the top-level block still is kept', after.gestures?.length, 1);
	check(
		'components: the snapshot of the bumped version is the merged doc',
		bucket.get(projectComponentVersionKey('p', COMPONENT.id, 4))?.text,
		bucket.get(componentKey)?.text,
	);
}

{
	// A row the READ dropped (a param of a kind this build does not know) is not the author's change:
	// a no-op save keeps the version, with or without unknown fields on that row. So does a stored
	// duplicate id (first wins, on both sides of the compare).
	for (const extra of [{}, { tooltip: 'x' }]) {
		resetComponents();
		const doc = newerComponent() as StoredDef;
		doc.params.push({ key: 'clip', kind: 'video', ...extra });
		doc.signals.push({ key: 'onSpin', payload: 'other' });
		const etag = seed(componentKey, doc);
		const result = await saveComponent(olderView(), 'p', etag);
		check(
			`components: a no-op save over a dropped row${'tooltip' in extra ? ' with extras' : ''} keeps the version`,
			result.version,
			3,
		);
	}
}

{
	// The graft matches by id, so an editor must NEVER reuse a stored id for a different entity: a
	// node created under a deleted node's id takes that node's unknown fields.
	resetComponents();
	const etag = seed(componentKey, newerComponent());
	const edited = structuredClone(olderView()) as StoredDef;
	edited.root.children[0] = { id: 'n_a', kind: 'text', x: 0, y: 0, text: 'new', children: [] };
	await saveComponent(edited as unknown as Def, 'p', etag);
	check(
		'components: an id reused for a new entity inherits the stored fields (editors must not)',
		nodeById(stored(componentKey).root, 'n_a')?.gesture,
		LISTENER.gesture,
	);
}

{
	resetComponents();
	// A node that MOVED keeps its fields: entities match by id anywhere under the root.
	const etag = seed(componentKey, newerComponent());
	const edited = structuredClone(olderView()) as StoredDef;
	const moved = edited.root.children[1].children.pop();
	delete moved.gesture;
	edited.root.children.push(moved);
	await saveComponent(edited as Def, 'p', etag);
	check(
		'components: a node moved to another parent keeps its unknown field',
		nodeById(stored(componentKey).root, 'n_b')?.gesture,
		LISTENER.gesture,
	);
}

{
	resetComponents();
	// A NEWER tab posting values this build does not know: the stored copy wins where the normalizer
	// drops the posted value; a child node passes through, so its posted value stands.
	const etag = seed(componentKey, newerComponent());
	const posted = newerComponent() as StoredDef;
	posted.gestures = [{ id: 'e_new', name: 'hold' }];
	posted.params[0].tooltip = 'Theirs';
	posted.root.children[0].gesture = [{ event: 'hover', fire: 'glow' }];
	await saveComponent(posted as unknown as Def, 'p', etag);
	const after = stored(componentKey) as StoredDef;
	check(
		'components: a posted unknown top-level / row field loses to the stored copy',
		[after.gestures?.[0]?.id, after.params[0].tooltip],
		['e_tap', 'Button text'],
	);
	check('components: a posted child node field stands', nodeById(after.root, 'n_a')?.gesture, [
		{ event: 'hover', fire: 'glow' },
	]);
}

{
	resetComponents();
	// Force ("Save on top" from a stale tab) CASes on the same read, so it grafts too. Create: nothing.
	seed(componentKey, newerComponent());
	await saveComponent(withoutChildListener(olderView()), 'p', undefined);
	const after = stored(componentKey) as StoredDef;
	check(
		'components: a forced save from a tab lacking the fields keeps them',
		[after.gestures?.length, after.root.gesture, nodeById(after.root, 'n_a')?.gesture],
		[1, LISTENER.gesture, LISTENER.gesture],
	);
	resetComponents();
	await saveComponent(COMPONENT as unknown as Def, 'p', null);
	check('components: a create writes the normalized def', stored(componentKey), {
		...normalizeComponent(structuredClone(COMPONENT) as unknown as Def),
	});
}

{
	// Snapshots are immutable: an older launcher's no-op save over a row its read DROPPED (a param of
	// a newer kind) keeps the version, and the latest copy loses the row, but `<id>.v3.json` keeps it.
	resetComponents();
	const doc = newerComponent() as StoredDef;
	doc.params.push({ key: 'clip', kind: 'video' });
	const etag = seed(componentKey, doc);
	const v3 = projectComponentVersionKey('p', COMPONENT.id, 3);
	const v3Bytes = bucket.get(componentKey)?.text ?? '';
	bucket.set(v3, { text: v3Bytes, etag: etagOf(v3Bytes) });
	const result = await saveComponent(olderView(), 'p', etag);
	check(
		'components: a no-op save over a dropped row leaves the v3 snapshot unchanged',
		[
			result.version,
			bucket.get(v3)?.text === v3Bytes,
			(stored(componentKey) as StoredDef).params.length,
		],
		[3, true, 1],
	);
}

{
	// A name-keyed row re-added under the same key takes the stored fields only while its kind is the
	// same: a `label` re-added as an image param is a different param.
	resetComponents();
	let etag = seed(componentKey, newerComponent());
	const asImage = structuredClone(olderView()) as unknown as StoredDef;
	asImage.params = [{ key: 'label', kind: 'image' }];
	await saveComponent(asImage as unknown as Def, 'p', etag);
	check(
		'components: a row re-added with another kind inherits nothing',
		(stored(componentKey) as StoredDef).params,
		[{ key: 'label', kind: 'image' }],
	);
	resetComponents();
	etag = seed(componentKey, newerComponent());
	const asString = structuredClone(olderView()) as unknown as StoredDef;
	asString.params = [{ key: 'label', kind: 'string' }];
	await saveComponent(asString as unknown as Def, 'p', etag);
	check(
		'components: …and with the same kind it is the same param, and keeps them',
		(stored(componentKey) as StoredDef).params[0].tooltip,
		'Button text',
	);
}

{
	// A grafted field goes back in its stored position, so a no-op save keeps the version and bytes.
	resetComponents();
	const doc = newerComponent() as StoredDef;
	const { id, ...rest } = doc.root.children[0];
	doc.root.children[0] = { id, ...LISTENER, ...rest, gesture: LISTENER.gesture };
	const bytes = JSON.stringify(doc, null, 2);
	bucket.set(componentKey, { text: bytes, etag: etagOf(bytes) });
	const result = await saveComponent(withoutChildListener(olderView()), 'p', etagOf(bytes));
	check(
		'components: an unknown field in the middle of a node goes back in place, no bump',
		[result.version, Object.keys(nodeById(stored(componentKey).root, 'n_a') ?? {})],
		[3, Object.keys(doc.root.children[0])],
	);
}

{
	// A legacy doc with a duplicated node id: no single twin, so neither copy takes the other's fields.
	resetComponents();
	const doc = newerComponent() as StoredDef;
	doc.root.children.push({
		id: 'n_a',
		kind: 'sprite',
		x: 0,
		y: 0,
		gesture: 'second',
		children: [],
	});
	const etag = seed(componentKey, doc);
	const posted = structuredClone(olderView()) as unknown as StoredDef;
	for (const node of posted.root.children) if (node.id === 'n_a') delete node.gesture;
	await saveComponent(posted as unknown as Def, 'p', etag);
	check(
		'components: duplicated node ids are not grafted',
		(stored(componentKey) as StoredDef).root.children
			.filter((n) => n.id === 'n_a')
			.map((n) => 'gesture' in n),
		[false, false],
	);
	// …nor compared: a no-op save over them (the read passes both through) keeps the version.
	resetComponents();
	const noOpEtag = seed(componentKey, doc);
	const noOp = await saveComponent(olderView(), 'p', noOpEtag);
	check('components: a no-op save over duplicated node ids keeps the version', noOp.version, 3);
}

{
	// Another author saves between the save's read and its PUT: the PUT's If-Match refuses it.
	resetComponents();
	const etag = seed(componentKey, newerComponent());
	afterGet = () => void seed(componentKey, { ...COMPONENT, theirs: 1 });
	check(
		'components: a save landing after the graft read still conflicts',
		await outcome(() => saveComponent(olderView(), 'p', etag)),
		'ConflictError',
	);
	check('components: …and the other author’s def stands', stored(componentKey).theirs, 1);
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
				after.gestures?.length,
				after.root.gesture,
				nodeById(after.root, 'n_a')?.gesture,
				after.params[0].tooltip,
			],
			[1, LISTENER.gesture, LISTENER.gesture, 'Button text'],
		);
		check(
			`components promote${force ? ' (force)' : ''}: drops the shared copy’s`,
			'sharedOnly' in after,
			false,
		);
	}
	{
		// Same known content, different unknown fields: the promote bumps rather than rewriting the
		// shared copy's immutable snapshot of its current version.
		const sharedDoc = { ...newerComponent(), scope: 'shared', gestures: [{ id: 'e_other' }] };
		const etag = seedShared(sharedDoc);
		const v3 = editorComponentVersionKey(COMPONENT.id, 3);
		const v3Bytes = JSON.stringify(sharedDoc, null, 2);
		bucket.set(v3, { text: v3Bytes, etag: etagOf(v3Bytes) });
		const result = await saveComponent(draft, undefined, etag, {
			promotedFrom: { projectKey: 'p', baseEtag: projectEtag },
		});
		check('components promote: changing only unknown fields bumps the version', result.version, 4);
		check('components promote: …and leaves the v3 snapshot alone', bucket.get(v3)?.text, v3Bytes);
	}
	const sharedEtag = seedShared({ ...COMPONENT, scope: 'shared' });
	const sharedBefore = bucket.get(sharedComponentKey)?.text;
	check(
		'components promote: a project def saved since the draft loaded refuses the promote',
		await outcome(() =>
			saveComponent(draft, undefined, sharedEtag, {
				promotedFrom: { projectKey: 'p', baseEtag: '"stale"' },
			}),
		),
		'PromoteSourceConflictError',
	);
	check('components promote: …writing nothing', bucket.get(sharedComponentKey)?.text, sharedBefore);
	const plainEtag = seedShared(newerComponent());
	await saveComponent(
		{ ...normalizeComponent(stored(sharedComponentKey) as unknown as Def), scope: 'shared' },
		undefined,
		plainEtag,
	);
	check(
		'components: a plain shared save keeps the shared copy’s own unknown fields',
		stored(sharedComponentKey).gestures,
		[{ id: 'e_tap', name: 'tap' }],
	);
}

// ── Components: inputs and the state machine (Rive plan Phase 5a) ─────────────────────────────

const SM_COMPONENT = {
	...COMPONENT,
	inputs: [
		{ id: 'hover', kind: 'bool', default: false },
		{ id: 'tap', kind: 'trigger' },
	],
	stateMachine: {
		layers: [
			{
				id: 'L',
				entry: 's_idle',
				states: [
					{ id: 's_idle', timeline: 'idle' },
					{ id: 's_win', timeline: 'win' },
				],
				transitions: [
					{
						id: 't_a',
						from: 's_idle',
						to: 's_win',
						conditions: [{ input: 'hover', op: '==', value: true }],
					},
					{ id: 't_b', from: 's_win', to: 's_idle', conditions: [{ input: 'tap', op: 'fired' }] },
				],
			},
			{ id: 'M', entry: 's_idle', states: [{ id: 's_idle', timeline: 'idle' }], transitions: [] },
		],
	},
};
const MARK = { mark: 'newer' };
/** A newer launcher's state machine: a field on the block, each layer / state / transition / input,
 *  a condition, an input of a kind no build knows (`vec2` — the stand-in for a kind a NEWER build
 *  added; `text` is known since Phase 7), and a namesake state in layer M without one. */
const newerMachine = (): StoredDef => {
	const doc = structuredClone(SM_COMPONENT) as unknown as Required<SmDoc>;
	Object.assign(doc.inputs[0], MARK);
	doc.inputs.splice(1, 0, { id: 'label', kind: 'vec2', default: 'SPIN', ...MARK });
	Object.assign(doc.stateMachine, { blend: 'smooth' });
	const [layer] = doc.stateMachine.layers;
	Object.assign(layer, MARK);
	Object.assign(layer.states[1], MARK);
	Object.assign(layer.transitions[0], MARK);
	Object.assign(layer.transitions[0].conditions[0], MARK);
	return doc as unknown as StoredDef;
};
/** The 5a blocks as the cases poke at them; `mark` is the newer field. */
interface SmRow {
	id: string;
	mark?: string;
	conditions?: unknown;
	[key: string]: unknown;
}
interface SmLayerRow extends SmRow {
	states: SmRow[];
	transitions: SmRow[];
}
interface Machine {
	layers: SmLayerRow[];
	blend?: string;
	[key: string]: unknown;
}
interface SmDoc {
	inputs: SmRow[];
	stateMachine?: Machine;
	[key: string]: unknown;
}
const machineOf = (doc: unknown): Machine => (doc as { stateMachine: Machine }).stateMachine;
const inputsOf = (doc: unknown): SmRow[] => (doc as SmDoc).inputs;

{
	resetComponents();
	const etag = seed(componentKey, newerMachine());
	const loaded = olderView();
	check(
		'components 5a: the read drops the unknown fields and the vec2 input',
		[
			inputsOf(loaded).map((i) => i.id),
			'blend' in machineOf(loaded),
			'mark' in machineOf(loaded).layers[0],
		],
		[['hover', 'tap'], false, false],
	);
	const result = await saveComponent(loaded, 'p', etag);
	const after = stored(componentKey);
	const machine = machineOf(after);
	const [L, M] = machine.layers;
	check('components 5a: a no-op save keeps the version', result.version, 3);
	check('components 5a: the state machine’s own unknown field is kept', machine.blend, 'smooth');
	check(
		'components 5a: …each layer’s, state’s and transition’s, matched by id',
		[L.mark, L.states[1].mark, L.transitions[0].mark],
		['newer', 'newer', 'newer'],
	);
	check('components 5a: …each input’s', inputsOf(after)[0].mark, 'newer');
	check('components 5a: a state matches within its layer only', 'mark' in M.states[0], false);
	check(
		'components 5a: a condition is its transition’s data, not grafted on its own',
		L.transitions[0].conditions,
		[{ input: 'hover', op: '==', value: true }],
	);
	check(
		'components 5a: an input of a kind this build does not know is kept, in place',
		inputsOf(after).map((i) => i.id),
		['hover', 'label', 'tap'],
	);
	check('components 5a: …unchanged', inputsOf(after)[1], {
		id: 'label',
		kind: 'vec2',
		default: 'SPIN',
		...MARK,
	});
}

{
	// The author deleted a state, a transition and an input: none comes back with its fields.
	resetComponents();
	const etag = seed(componentKey, newerMachine());
	const edited = structuredClone(olderView()) as unknown as SmDoc;
	const layer = edited.stateMachine!.layers[0];
	layer.states = layer.states.filter((s: SmRow) => s.id !== 's_win');
	layer.transitions = [];
	edited.inputs = edited.inputs.filter((i: SmRow) => i.id !== 'hover');
	const result = await saveComponent(edited as unknown as Def, 'p', etag);
	const after = stored(componentKey);
	const L = machineOf(after).layers[0];
	check('components 5a: an edit bumps the version', result.version, 4);
	check(
		'components 5a: deleted states / transitions / inputs are not resurrected',
		[L.states.map((s) => s.id), L.transitions, inputsOf(after).map((i) => i.id)],
		[['s_idle'], [], ['label', 'tap']],
	);
	check('components 5a: the surviving layer keeps its field', L.mark, 'newer');
}

{
	// The author removed the whole state machine: its layers go, its namespace field stays.
	resetComponents();
	const etag = seed(componentKey, newerMachine());
	const edited = structuredClone(olderView()) as unknown as SmDoc;
	delete edited.stateMachine;
	await saveComponent(edited as unknown as Def, 'p', etag);
	check(
		'components 5a: clearing the state machine keeps only its namespace field',
		machineOf(stored(componentKey)),
		{ layers: [], blend: 'smooth' },
	);
}

{
	// Force grafts like an If-Match save: the namespace field and the vec2 input stay.
	resetComponents();
	seed(componentKey, newerMachine());
	await saveComponent(olderView(), 'p', undefined);
	const after = stored(componentKey);
	check(
		'components 5a: a forced save keeps them too',
		['blend' in machineOf(after), inputsOf(after).map((i) => i.id)],
		[true, ['hover', 'label', 'tap']],
	);
}

{
	resetComponents();
	const etag = seed(
		componentKey,
		normalizeComponent(structuredClone(SM_COMPONENT) as unknown as Def),
	);
	const before = bucket.get(componentKey)?.text;
	await saveComponent(
		normalizeComponent(structuredClone(SM_COMPONENT) as unknown as Def),
		'p',
		etag,
	);
	check(
		'components 5a: a known-only state machine saves byte-identically',
		bucket.get(componentKey)?.text,
		before,
	);
}

{
	// 5b's `pos` / `pseudoPos` are KNOWN here: a cleared `pos` stays cleared. A state field this
	// build does not know (`thumb`) survives, as `pos` did through a 5a-only build's save.
	resetComponents();
	const doc = newerMachine() as unknown as Required<SmDoc>;
	const [layer] = doc.stateMachine.layers;
	Object.assign(layer, { pseudoPos: { entry: { x: 1, y: 2 } } });
	Object.assign(layer.states[0], { pos: { x: 10, y: 20 }, thumb: 'idle.png' });
	const etag = seed(componentKey, doc);
	const loaded = structuredClone(olderView()) as unknown as SmDoc;
	check(
		'components 5b: pos / pseudoPos are read as known',
		[!!loaded.stateMachine?.layers[0].states[0].pos, !!loaded.stateMachine?.layers[0].pseudoPos],
		[true, true],
	);
	delete loaded.stateMachine!.layers[0].states[0].pos;
	await saveComponent(loaded as unknown as Def, 'p', etag);
	const state = machineOf(stored(componentKey)).layers[0].states[0];
	check(
		'components 5b: a cleared pos is not resurrected; an unknown state field is kept',
		['pos' in state, state.thumb],
		[false, 'idle.png'],
	);
}

{
	// The vec2 input is the ONLY difference: the save still bumps, never rewriting the v3 snapshot.
	const onlyText = (label: SmRow | null): StoredDef => {
		const doc = structuredClone(SM_COMPONENT) as unknown as Required<SmDoc>;
		if (label) doc.inputs.push(label);
		return doc as unknown as StoredDef;
	};
	const pin = (key: string): string => {
		const bytes = bucket.get(key)?.text ?? '';
		bucket.set(key.replace(/\.json$/, '.v3.json'), { text: bytes, etag: etagOf(bytes) });
		return bytes;
	};
	resetComponents();
	seed(componentKey, onlyText({ id: 'label', kind: 'vec2', default: 'SPIN' }));
	const v3 = pin(componentKey);
	const forced = await saveComponent(olderView(), 'p', undefined);
	check(
		'components 5a: a forced save keeps a vec2 input, at the same version and v3',
		[
			forced.version,
			bucket.get(projectComponentVersionKey('p', COMPONENT.id, 3))?.text === v3,
			inputsOf(stored(componentKey)).some((i) => i.id === 'label'),
		],
		[3, true, true],
	);
	resetComponents();
	const projectEtag = seed(componentKey, onlyText({ id: 'label', kind: 'vec2', default: 'B' }));
	const sharedEtag = seed(sharedComponentKey, {
		...(onlyText({ id: 'label', kind: 'vec2', default: 'SPIN' }) as object),
		scope: 'shared',
	});
	const sharedV3 = pin(sharedComponentKey);
	const promoted = await saveComponent(
		{ ...olderView(), scope: 'shared' as const },
		undefined,
		sharedEtag,
		{ promotedFrom: { projectKey: 'p', baseEtag: projectEtag } },
	);
	check(
		'components 5a: a promote changing only a vec2 input bumps, leaving v3 alone',
		[promoted.version, bucket.get(editorComponentVersionKey(COMPONENT.id, 3))?.text === sharedV3],
		[4, true],
	);
}

{
	// `text` is a KNOWN kind since Phase 7: a stored text input is read, shown and saved back as is —
	// a no-op save rewrites the very same bytes and keeps the version.
	resetComponents();
	const doc = structuredClone(SM_COMPONENT) as unknown as Required<SmDoc>;
	doc.inputs.splice(1, 0, { id: 'label', kind: 'text', default: 'SPIN' });
	// The seed's bytes are hand-written; the first save writes the canonical form, which the second
	// (a no-op) must rewrite byte for byte.
	const seeded = seed(componentKey, doc);
	const first = await saveComponent(olderView(), 'p', seeded);
	const before = bucket.get(componentKey)?.text;
	const etag = etagOf(before ?? '');
	const loaded = olderView();
	check(
		'components 7a: a text input reads as known',
		inputsOf(loaded).map((i) => [i.id, i.kind]),
		[
			['hover', 'bool'],
			['label', 'text'],
			['tap', 'trigger'],
		],
	);
	const result = await saveComponent(loaded, 'p', etag);
	check(
		'components 7a: …and a no-op save round-trips it byte-identically',
		[first.version, result.version, bucket.get(componentKey)?.text === before],
		[3, 3, true],
	);
}

{
	// A twin is the row the author SAW: with a duplicated id, the readable row, not an unreadable one.
	resetComponents();
	const doc = structuredClone(SM_COMPONENT) as unknown as Required<SmDoc>;
	doc.inputs = [
		{ id: 'x', kind: 'vec2', foo: 1 },
		{ id: 'x', kind: 'bool', bar: 2 },
	];
	const etag = seed(componentKey, doc);
	await saveComponent(olderView(), 'p', etag);
	check(
		'components 5a: a duplicated id grafts from the row the read kept',
		inputsOf(stored(componentKey)).find((i) => i.kind === 'bool'),
		{ id: 'x', kind: 'bool', bar: 2 },
	);
}

{
	// The author now uses a dropped vec2 input's id: their entity wins, and inherits nothing.
	resetComponents();
	const doc = structuredClone(SM_COMPONENT) as unknown as Required<SmDoc>;
	doc.inputs.push({ id: 'label', kind: 'vec2', maxLen: 8 });
	let etag = seed(componentKey, doc);
	const asInput = structuredClone(olderView()) as unknown as SmDoc;
	asInput.inputs.push({ id: 'label', kind: 'bool' });
	await saveComponent(asInput as unknown as Def, 'p', etag);
	check(
		'components 5a: a new input on a dropped row’s id wins and inherits nothing',
		inputsOf(stored(componentKey)).filter((i) => i.id === 'label'),
		[{ id: 'label', kind: 'bool' }],
	);
	resetComponents();
	etag = seed(componentKey, doc);
	const asSignal = structuredClone(olderView()) as unknown as SmDoc & {
		signals: { key: string }[];
	};
	asSignal.signals.push({ key: 'label' });
	await saveComponent(asSignal as unknown as Def, 'p', etag);
	check(
		'components 5a: …and so does a new signal (signals share the input ids)',
		inputsOf(stored(componentKey)).some((i) => i.id === 'label'),
		false,
	);
	resetComponents();
	const junk = structuredClone(SM_COMPONENT) as unknown as Required<SmDoc>;
	junk.inputs.push({ id: '', kind: 'vec2' }, { id: 'y', kind: '' });
	etag = seed(componentKey, junk);
	await saveComponent(olderView(), 'p', etag);
	check(
		'components 5a: a malformed input row is not kept as "a newer kind"',
		inputsOf(stored(componentKey)).map((i) => i.id),
		['hover', 'tap'],
	);
}

{
	// Through the real route: `promotedFrom` + `sourceEtag` reach `saveComponent`, and a stale
	// source answers a 409 the client must not offer "Promote on top" for.
	resetComponents();
	const projectEtag = seed(componentKey, newerComponent());
	const sharedEtag = seed(sharedComponentKey, { ...COMPONENT, scope: 'shared' });
	const draft = { ...olderView(), scope: 'shared' };
	const promoted = await post(componentRoute.POST, {
		...draft,
		promotedFrom: 'p',
		sourceEtag: projectEtag,
		baseEtag: sharedEtag,
	});
	check(
		'component route: a promote carries the project def’s unknown fields',
		[promoted.status, (stored(sharedComponentKey) as StoredDef).gestures?.length],
		[200, 1],
	);
	const stale = await post(componentRoute.POST, {
		...draft,
		promotedFrom: 'p',
		sourceEtag: '"stale"',
		baseEtag: bucket.get(sharedComponentKey)?.etag,
	});
	check(
		'component route: a stale promote source is a source-conflict 409',
		[stale.status, stale.body.error],
		[409, 'source-conflict'],
	);
}

{
	// A newer build's top-level and `stateMachine` fields sit mid-object: an older launcher's no-op
	// save keeps them in place, so the bytes (and the ETag every other tab holds) do not change.
	resetComponents();
	const { id, name, ...rest } = structuredClone(SM_COMPONENT) as unknown as Required<SmDoc>;
	const machine = rest.stateMachine as Machine;
	const doc = {
		id,
		name,
		gestures: [{ id: 'e_tap' }],
		...rest,
		stateMachine: { blend: 'smooth', ...machine },
	};
	const bytes = JSON.stringify(normalizeComponent(structuredClone(doc) as unknown as Def), null, 2);
	const stored0 = JSON.parse(bytes) as Record<string, unknown>;
	const withExtras = JSON.stringify(
		{
			id: stored0.id,
			name: stored0.name,
			gestures: doc.gestures,
			...Object.fromEntries(Object.entries(stored0).filter(([k]) => k !== 'id' && k !== 'name')),
			stateMachine: { blend: 'smooth', ...(stored0.stateMachine as object) },
		},
		null,
		2,
	);
	bucket.set(componentKey, { text: withExtras, etag: etagOf(withExtras) });
	const result = await saveComponent(olderView(), 'p', etagOf(withExtras));
	check(
		'components: a no-op save keeps mid-object top-level and stateMachine fields byte-identical',
		[result.version, bucket.get(componentKey)?.text === withExtras],
		[3, true],
	);
}

{
	// A forced save racing another author's write: its CAS on the same read refuses it.
	resetComponents();
	seed(componentKey, newerComponent());
	afterGet = () => void seed(componentKey, { ...COMPONENT, theirs: 1 });
	check(
		'components: a forced save landing after the graft read still conflicts',
		await outcome(() => saveComponent(olderView(), 'p', undefined)),
		'ConflictError',
	);
	check('components: …and the other author’s def stands', stored(componentKey).theirs, 1);
}

// ── Components: events, listeners and onEnter (Rive plan Phase 6a) ─────────────────────────────

const P6_COMPONENT = {
	...SM_COMPONENT,
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'n_a',
				kind: 'sprite',
				x: 0,
				y: 0,
				on: [{ id: 'l1', event: 'click', action: { kind: 'raise', event: 'pressed' } }],
			},
		],
	},
	events: [{ id: 'pressed' }, { id: 'shown' }],
	stateMachine: {
		layers: [
			{
				id: 'L',
				entry: 's_idle',
				states: [
					{
						id: 's_idle',
						timeline: 'idle',
						onEnter: [{ id: 'x1', kind: 'raise', event: 'shown' }],
					},
				],
				transitions: [],
			},
		],
	},
};
interface P6Doc {
	events?: (SmRow & { payload?: SmRow[] })[];
	root: { children: { on?: SmRow[] }[] };
	stateMachine: { layers: { states: { onEnter?: SmRow[] }[] }[] };
}
/** A newer launcher's Phase 6 rows: what this build cannot read, and newer fields on what it can. */
const newerP6 = (): P6Doc => {
	const doc = structuredClone(P6_COMPONENT) as unknown as P6Doc;
	const node = doc.root.children[0];
	const state = doc.stateMachine.layers[0].states[0];
	Object.assign(node.on![0], { delay: 2 });
	node.on!.push(
		{ id: 'l_goto', event: 'click', action: { kind: 'goto', state: 's_idle' } },
		{ id: 'l_swipe', event: 'swipe', action: { kind: 'fire', input: 'tap' } },
	);
	doc.events![0].payload = [
		{ name: 'n', type: { t: 'int' }, unit: 'coins' },
		{ name: 'symbol', type: { t: 'enum', name: 'SymbolName' } },
	];
	Object.assign(state.onEnter![0], { once: true });
	state.onEnter!.push({ id: 'x_goto', kind: 'goto', state: 's_idle' });
	return doc;
};
{
	// A newer launcher's field on an event row comes back on a no-op save, matched by id.
	resetComponents();
	const doc = structuredClone(P6_COMPONENT) as unknown as P6Doc;
	Object.assign(doc.events![0], MARK);
	const etag = seed(componentKey, doc);
	await saveComponent(olderView(), 'p', etag);
	const after = stored(componentKey) as unknown as P6Doc;
	check(
		'components 6a: an event row’s unknown field is kept, by id',
		after.events?.[0].mark,
		'newer',
	);
	check(
		'components 6a: the listeners and onEnter are known and saved as they were',
		[after.root.children[0].on, after.stateMachine.layers[0].states[0].onEnter],
		[P6_COMPONENT.root.children[0].on, P6_COMPONENT.stateMachine.layers[0].states[0].onEnter],
	);
}
{
	// An older build's no-op save of a newer build's rows loses none of them.
	resetComponents();
	const etag = seed(componentKey, newerP6());
	const loaded = olderView() as unknown as P6Doc;
	check(
		'components 6a: the read drops what it cannot read (an onEnter row IS its action, so a newer key on it makes it unreadable too)',
		[
			loaded.root.children[0].on?.map((l) => l.id),
			loaded.events?.[0].payload?.map((f) => f.name),
			loaded.stateMachine.layers[0].states[0].onEnter?.map((a) => a.id) ?? null,
		],
		[['l1'], ['n'], null],
	);
	await saveComponent(loaded as unknown as Def, 'p', etag);
	const after = stored(componentKey) as unknown as P6Doc;
	const before = newerP6();
	check(
		'components 6a: listeners of an unknown kind or pointer event are kept, in place, with a newer listener field',
		after.root.children[0].on,
		before.root.children[0].on,
	);
	check(
		'components 6a: a payload field of a type this build cannot carry is kept, in place, with a newer field',
		after.events?.[0].payload,
		before.events![0].payload,
	);
	check(
		'components 6a: an onEnter row of an unknown kind is kept, in place, with a newer field',
		after.stateMachine.layers[0].states[0].onEnter,
		before.stateMachine.layers[0].states[0].onEnter,
	);
}
{
	// The author deleted the readable listener: the unreadable ones stay, the deleted one does not.
	resetComponents();
	const etag = seed(componentKey, newerP6());
	const edited = structuredClone(olderView()) as unknown as P6Doc;
	delete edited.root.children[0].on;
	await saveComponent(edited as unknown as Def, 'p', etag);
	check(
		'components 6a: a deleted listener is not resurrected; the ones the author never saw stay',
		(stored(componentKey) as unknown as P6Doc).root.children[0].on?.map((l) => l.id),
		['l_goto', 'l_swipe'],
	);
}
{
	// The author cleared the listeners, the onEnter and an event: none is grafted back.
	resetComponents();
	const doc = structuredClone(P6_COMPONENT) as unknown as P6Doc;
	Object.assign(doc.events![0], MARK);
	const etag = seed(componentKey, doc);
	const edited = structuredClone(olderView()) as unknown as P6Doc;
	delete edited.root.children[0].on;
	delete edited.stateMachine.layers[0].states[0].onEnter;
	edited.events = edited.events!.filter((e) => e.id !== 'pressed');
	await saveComponent(edited as unknown as Def, 'p', etag);
	const after = stored(componentKey) as unknown as P6Doc;
	check(
		'components 6a: cleared listeners, onEnter and a deleted event are not resurrected',
		[
			'on' in after.root.children[0],
			'onEnter' in after.stateMachine.layers[0].states[0],
			after.events?.map((e) => e.id),
		],
		[false, false, ['shown']],
	);
}

{
	// A newer key ONE LEVEL DOWN — inside an action, a payload value, a payload field's type — makes
	// the row unreadable here, so an older build's no-op save keeps it whole, at the same version.
	resetComponents();
	const doc = structuredClone(P6_COMPONENT) as unknown as P6Doc;
	const node = doc.root.children[0];
	node.on = [
		{ id: 'l_times', event: 'click', action: { kind: 'fire', input: 'tap', times: 2 } },
		{
			id: 'l_ns',
			event: 'up',
			action: {
				kind: 'raise',
				event: 'pressed',
				payload: { label: { key: 'Hi', ns: 'ui' }, n: { input: 'hover', scale: 2 } },
			},
		},
	];
	doc.events![0].payload = [{ name: 'n', type: { t: 'int', min: 0 } }];
	doc.stateMachine.layers[0].states[0].onEnter = [
		{ id: 'x_ns', kind: 'raise', event: 'shown', payload: { t: { key: 'Hi', ns: 'ui' } } },
	];
	const before = structuredClone(doc);
	const etag = seed(componentKey, doc);
	const loaded = olderView() as unknown as P6Doc;
	check(
		'components 6a: a newer key inside an action, a payload value or a type is not read (never rebuilt without it)',
		[
			loaded.root.children[0].on ?? null,
			loaded.events?.[0].payload ?? null,
			loaded.stateMachine.layers[0].states[0].onEnter ?? null,
		],
		[null, null, null],
	);
	const result = await saveComponent(loaded as unknown as Def, 'p', etag);
	const after = stored(componentKey) as unknown as P6Doc;
	check(
		'components 6a: …and an older no-op save keeps each row whole, at the same version',
		[
			result.version,
			after.root.children[0].on,
			after.events?.[0].payload,
			after.stateMachine.layers[0].states[0].onEnter,
		],
		[
			3,
			before.root.children[0].on,
			before.events![0].payload,
			before.stateMachine.layers[0].states[0].onEnter,
		],
	);
}
{
	// A promote whose listeners differ only in what this build cannot read still bumps.
	resetComponents();
	const project = structuredClone(P6_COMPONENT) as unknown as P6Doc;
	project.root.children[0].on!.push({
		id: 'l_goto',
		event: 'click',
		action: { kind: 'goto', state: 's_idle' },
	});
	const shared = { ...structuredClone(P6_COMPONENT), scope: 'shared' };
	const projectEtag = seed(componentKey, project);
	const sharedEtag = seed(sharedComponentKey, shared);
	const sharedBytes = bucket.get(sharedComponentKey)?.text ?? '';
	const sharedV3Key = editorComponentVersionKey(COMPONENT.id, 3);
	bucket.set(sharedV3Key, { text: sharedBytes, etag: etagOf(sharedBytes) });
	const promoted = await saveComponent(
		{ ...olderView(), scope: 'shared' as const },
		undefined,
		sharedEtag,
		{ promotedFrom: { projectKey: 'p', baseEtag: projectEtag } },
	);
	check(
		'components 6a: a promote changing only unreadable listener / onEnter / payload rows bumps, leaving v3 alone',
		[
			promoted.version,
			bucket.get(sharedV3Key)?.text === sharedBytes,
			(stored(sharedComponentKey) as unknown as P6Doc).root.children[0].on?.map((l) => l.id),
		],
		[4, true, ['l1', 'l_goto']],
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
	// Through the real restore route: the backup's unknown fields come back, not the live sidecar's.
	const target = componentDefaultsBackupTarget('p', COMPONENT.id);
	for (const key of [...bucket.keys()]) if (key.startsWith(target.prefix)) bucket.delete(key);
	const backedUp = seed(defaultsKey, {
		id: COMPONENT.id,
		params: { label: 'OLD' },
		inputs: { on: 3 },
	});
	const { etag: liveRouteEtag } = await saveComponentDefaults(
		'p',
		COMPONENT.id,
		{ label: 'NEW' },
		backedUp,
		'always',
		{ unknownFrom: { liveOnly: 1 } },
	);
	const [newest] = await listBackups(target);
	const restored = await post(
		defaultsBackupsRoute.POST,
		{ id: newest?.id, baseEtag: liveRouteEtag },
		`?project=p&component=${COMPONENT.id}`,
	);
	check(
		'component defaults restore route: keeps the backup’s unknown fields',
		[restored.status, stored(defaultsKey)],
		[200, { id: COMPONENT.id, params: { label: 'OLD' }, inputs: { on: 3 } }],
	);
	// Another author saves between the graft's read and the write: the write's If-Match refuses it.
	const raceEtag = seed(defaultsKey, { id: COMPONENT.id, params: {}, inputs: { on: 1 } });
	afterGet = () => void seed(defaultsKey, { id: COMPONENT.id, params: { theirs: 1 } });
	check(
		'component defaults: a save landing after the graft read still conflicts',
		await outcome(() => saveComponentDefaults('p', COMPONENT.id, {}, raceEtag)),
		'ConflictError',
	);
	check('component defaults: …and the other author’s stands', stored(defaultsKey).params, {
		theirs: 1,
	});
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
