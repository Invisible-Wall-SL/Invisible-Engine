/**
 * Contract check for the rolling doc backups — `$lib/server/docBackups.ts`, the target + id helpers
 * in `projectPaths.ts`, the four whole-doc saves wired onto them (Scene Editor, Flow v2, Symbols,
 * Game Config) and their four history routes:
 *   pnpm --filter launcher-api check:doc-backups
 *
 * Runs the REAL modules and the REAL route handlers. Only the boundaries are replaced: `r2.ts`
 * becomes an in-memory bucket that honours `If-Match` / `If-None-Match` the way R2 does and records
 * every call — so the ORDER the feature rests on (HEAD, then COPY, then the guarded PUT, then the
 * prune) is observable, and so is its absence — and the session gates (`toolScope`,
 * `symbolsAccess`, `gameConfigAccess`) become a fixed signed-in caller, whose real behaviour is
 * `check-project-scope.ts` and `check-launcher-gates.ts`. If a module under test starts importing
 * another export from a stubbed module, the stub must provide it or this fails at import with
 * "does not provide an export named".
 *
 * What it cannot prove: R2 itself (that a stale `If-Match` is a 412 is `r2.ts`'s mapping), and
 * anything about the browser — the History modal, a real autosave burst, the lease.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { error, isHttpError } from '@sveltejs/kit';
import { freshDrivenSeedDoc } from 'engine-flow-v2';
import type { DocBackupStem, DocBackupTarget } from '../src/lib/server/projectPaths.ts';

interface Stored {
	text: string;
	etag: string | null;
}
interface Cond {
	ifMatch?: string;
	ifNoneMatch?: string;
}

const bucket = new Map<string, Stored>();
/** Every R2 call, in order: `<op> <key>`. */
const calls: string[] = [];
/** When set, the next HEAD throws it — a non-404 storage failure. */
let headFailure: Error | null = null;
/** When set, the next LIST throws it — a failing prune. */
let listFailure: Error | null = null;
/** Runs just before the next PUT is judged: another author's save landing mid-request. */
let beforePut: (() => void) | null = null;

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
/** R2's ETag for a single-part upload: the body's MD5, quoted. */
const etagOf = (text: string): string => `"${createHash('md5').update(text).digest('hex')}"`;

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (baseEtag: string | null | undefined): Cond | undefined => {
			if (baseEtag === undefined) return undefined;
			return baseEtag === null ? { ifNoneMatch: '*' } : { ifMatch: baseEtag };
		},
		jsonBaseEtag: (v: unknown) => (v === null ? null : typeof v === 'string' ? v : undefined),
		formBaseEtag: (v: unknown) => (typeof v !== 'string' ? undefined : v === '' ? null : v),
		headObject: async (key: string) => {
			calls.push(`head ${key}`);
			if (headFailure) {
				const e = headFailure;
				headFailure = null;
				throw e;
			}
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.text.length, lastModified: 0 } : null;
		},
		copyObject: async (src: string, dest: string) => {
			calls.push(`copy ${dest}`);
			const o = bucket.get(src);
			if (!o) return false;
			bucket.set(dest, { ...o });
			return true;
		},
		putObjectText: async (key: string, text: string, _type: string, cond?: Cond) => {
			const race = beforePut;
			beforePut = null;
			race?.();
			calls.push(`put ${key}`);
			const current = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && current) throw new ConflictError(key);
			if (cond?.ifMatch !== undefined && current?.etag !== cond.ifMatch) {
				throw new ConflictError(key);
			}
			const etag = etagOf(text);
			bucket.set(key, { text, etag });
			return etag;
		},
		getObjectText: async (key: string) => {
			calls.push(`get ${key}`);
			return bucket.get(key)?.text ?? null;
		},
		getObjectTextWithEtag: async (key: string) => {
			const o = bucket.get(key);
			return o ? { text: o.text, etag: o.etag } : null;
		},
		listAllObjects: async (prefix: string) => {
			calls.push(`list ${prefix}`);
			if (listFailure) {
				const e = listFailure;
				listFailure = null;
				throw e;
			}
			return [...bucket]
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, o]) => ({ key, size: o.text.length, lastModified: 0 }));
		},
		deleteObjects: async (keys: string[]) => {
			if (keys.length) calls.push(`delete ${keys.length}`);
			for (const key of keys) bucket.delete(key);
		},
		listAllKeys: async (prefix: string) =>
			[...bucket.keys()].filter((key) => key.startsWith(prefix)),
		listObjects: async () => ({ keys: [], prefixes: [] }),
		objectExists: async (key: string) => bucket.has(key),
	},
});

/** The fixed caller the gates hand back, and which tool each session gate was asked for. */
const SESSION = { clientKey: 'r', projectKey: 'route' };
const gatedTools: string[] = [];
const signedIn = async (locals: { user?: unknown }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	return locals.user;
};
mock.module(server('toolScope.ts'), {
	namedExports: {
		gate: async (locals: { user?: unknown }, _cookies: unknown, opts: { tool: string }) => {
			await signedIn(locals);
			gatedTools.push(opts.tool);
			return { ...SESSION, prefixes: [] };
		},
		requireProjectScope: async (_user: unknown, project: string | null) => ({
			clientKey: SESSION.clientKey,
			projectKey: project || 'default',
		}),
	},
});
mock.module(server('symbolsAccess.ts'), { namedExports: { requireSymbolsAccess: signedIn } });
mock.module(server('gameConfigAccess.ts'), { namedExports: { requireGameConfigAccess: signedIn } });
const invalidated: string[] = [];
mock.module(server('runtimeBundleCache.ts'), {
	namedExports: { invalidateRuntimeBundle: (projectKey: string) => invalidated.push(projectKey) },
});

const paths = await import('../src/lib/server/projectPaths.ts');
const { listBackups, putDocWithBackup, readBackup } = await import(
	'../src/lib/server/docBackups.ts'
);
const { normalizeDoc, saveDoc } = await import('../src/lib/server/editorStorage.ts');
const { saveFlowV2Doc } = await import('../src/lib/server/flowV2Storage.ts');
const { saveSymbolsDoc } = await import('../src/lib/server/symbolsStorage.ts');
const { saveGameConfigDoc } = await import('../src/lib/server/gameConfigStorage.ts');
const { planDuplicate } = await import('../src/lib/server/projectDuplicate.ts');
const editorBackupsRoute = await import('../src/routes/api/editor/backups/+server.ts');
const flowBackupsRoute = await import('../src/routes/api/flow-v2/backups/+server.ts');
const flowSaveRoute = await import('../src/routes/api/flow-v2/save/+server.ts');
const symbolsBackupsRoute = await import('../src/routes/api/editor/symbols/backups/+server.ts');
const configBackupsRoute = await import('../src/routes/api/game-config/backups/+server.ts');

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

const reset = (): void => {
	calls.length = 0;
};
/** The ops (without keys) R2 saw since the last reset. */
const ops = (): string[] => calls.map((c) => c.split(' ')[0]);
/** `'landed'`, or the name of what the write threw. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
		return 'landed';
	} catch (e) {
		return e instanceof Error ? e.name : String(e);
	}
}
const keysUnder = (prefix: string): string[] =>
	[...bucket.keys()].filter((k) => k.startsWith(prefix)).sort();
/** Seed a live doc directly, as if an earlier save had put it there. */
function seed(target: DocBackupTarget, text: string): string {
	const etag = etagOf(text);
	bucket.set(target.docKey, { text, etag });
	return etag;
}

const T0 = new Date('2026-09-29T12:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const HEX_ETAG = '"0123456789abcdef0123456789abcdef"';
const STEMS: DocBackupStem[] = ['scenes', 'flow-v2', 'symbols', 'config'];

// ── Ids: one shape per stem, and the shape is a path gate ─────────────────────
for (const stem of STEMS) {
	const id = paths.docBackupId(stem, T0, HEX_ETAG);
	check(
		`${stem}: id is <stem>-<stamp>-<8 hex of the etag>`,
		id,
		`${stem}-20260929T120000000Z-01234567`,
	);
	check(`${stem}: its own id validates`, paths.isDocBackupId(stem, id), true);
	check(`${stem}: the stamp parses back`, paths.docBackupSavedAt(stem, id), T0.toISOString());
	const bare = paths.docBackupId(stem, T0, null);
	check(
		`${stem}: no etag → noetag`,
		[bare, paths.isDocBackupId(stem, bare)],
		[`${stem}-20260929T120000000Z-noetag`, true],
	);
	for (const other of STEMS.filter((s) => s !== stem)) {
		const foreign = paths.docBackupId(other, T0, HEX_ETAG);
		check(
			`${stem}: an id minted for ${other} is refused`,
			[paths.isDocBackupId(stem, foreign), paths.docBackupSavedAt(stem, foreign)],
			[false, null],
		);
	}
}
const scenesId = paths.docBackupId('scenes', T0, HEX_ETAG);
for (const bad of [
	'',
	`../${scenesId}`,
	`${scenesId}/../../other/scenes`,
	`${scenesId}.json`,
	`${scenesId}\n`,
	`x${scenesId}`,
	'scenes-20260929T120000000Z-0123456',
	'scenes-20260929T120000000Z-ABCDEF01',
	'scenes-2026-09-29T12:00:00Z-01234567',
	'scenes-20260929T120000000Z-noetag-01234567',
]) {
	check(
		`a malformed id is refused: ${JSON.stringify(bad)}`,
		paths.isDocBackupId('scenes', bad),
		false,
	);
}
check(
	'an id taken before the generalisation still parses',
	paths.docBackupSavedAt('scenes', 'scenes-20260801T101500123Z-9f86d081'),
	'2026-08-01T10:15:00.123Z',
);
check(
	'lexicographic id order IS chronological order',
	paths.docBackupId('scenes', new Date(T0.getTime() + 1), '"00"') > scenesId,
	true,
);

// ── Targets: rebuilt from (client, project); scenes keeps its old folder ──────
const BORUT = ['Borut', 'book-of-borut'] as const;
check(
	'scenes target keeps the pre-existing editor/backups/ folder',
	paths.editorDocBackupTarget(...BORUT),
	{
		docKey: 'borut/book_of_borut/editor/scenes.json',
		prefix: 'borut/book_of_borut/editor/backups/',
		stem: 'scenes',
	},
);
check(
	'so a pre-existing backup key is exactly where it always was',
	paths.docBackupKey(paths.editorDocBackupTarget(...BORUT), 'scenes-20260801T101500123Z-9f86d081'),
	'borut/book_of_borut/editor/backups/scenes-20260801T101500123Z-9f86d081.json',
);
check('flow-v2 target', paths.flowV2DocBackupTarget(...BORUT), {
	docKey: paths.flowV2DocKey(...BORUT),
	prefix: 'borut/book_of_borut/editor/flow-v2-backups/',
	stem: 'flow-v2',
});
check('symbols target', paths.symbolsDocBackupTarget(...BORUT), {
	docKey: paths.symbolsDocKey(...BORUT),
	prefix: 'borut/book_of_borut/symbols/backups/',
	stem: 'symbols',
});
check('config target', paths.gameConfigDocBackupTarget(...BORUT), {
	docKey: paths.gameConfigDocKey(...BORUT),
	prefix: 'borut/book_of_borut/config/backups/',
	stem: 'config',
});

// ── putDocWithBackup: the write, its backup, its order ────────────────────────
const target = (project: string): DocBackupTarget => paths.flowV2DocBackupTarget('c', project);

{
	const t = target('create');
	reset();
	check(
		'a create (HEAD 404) takes no backup and needs no prune',
		[await outcome(() => putDocWithBackup(t, 'v1', null, 'auto', T0)), ops(), keysUnder(t.prefix)],
		['landed', ['head', 'put'], []],
	);
}

{
	const t = target('overwrite');
	const e1 = seed(t, 'v1');
	reset();
	const e2 = await putDocWithBackup(t, 'v2', e1, 'auto', T0);
	check('an overwrite copies the previous bytes BEFORE the PUT, then prunes', ops(), [
		'head',
		'copy',
		'put',
		'list',
	]);
	const backups = await listBackups(t);
	check(
		'the backup holds the bytes that were replaced, under an id tagged by their etag',
		[backups.length, bucket.get(paths.docBackupKey(t, backups[0].id))?.text, backups[0].id],
		[1, 'v1', paths.docBackupId('flow-v2', T0, e1)],
	);
	check('and the new bytes are live', bucket.get(t.docKey)?.text, 'v2');

	reset();
	const e3 = await putDocWithBackup(t, 'v3', e2, 'auto', at(1));
	check('an auto save inside the 5-minute window coalesces: no copy, no prune', ops(), [
		'head',
		'put',
	]);
	reset();
	const e4 = await putDocWithBackup(t, 'v4', e3, 'always', at(2));
	check('an always save inside the window is never coalesced', ops().slice(0, 3), [
		'head',
		'copy',
		'put',
	]);
	reset();
	await putDocWithBackup(t, 'v5', e4, 'auto', at(7));
	check('an auto save 5 minutes after the last backup copies again', ops().slice(0, 3), [
		'head',
		'copy',
		'put',
	]);
	reset();
	await putDocWithBackup(t, 'v6', undefined, 'auto', at(8));
	check(
		'a force save (baseEtag undefined) inside the window is never coalesced, even asked as auto',
		ops().slice(0, 3),
		['head', 'copy', 'put'],
	);
	check(
		'the history is newest first and holds what each copy replaced',
		(await listBackups(t)).map((b) => bucket.get(paths.docBackupKey(t, b.id))?.text),
		['v5', 'v4', 'v3', 'v1'],
	);
}

// ── A save that will 409 takes no backup ──────────────────────────────────────
{
	const t = target('stale');
	seed(t, 'theirs');
	reset();
	check(
		'a stale baseEtag is refused with ConflictError before any copy or PUT',
		[await outcome(() => putDocWithBackup(t, 'mine', etagOf('loaded'), 'always', T0)), ops()],
		['ConflictError', ['head']],
	);
	reset();
	check(
		'a create (baseEtag null) over an existing doc is refused the same way',
		[await outcome(() => putDocWithBackup(t, 'mine', null, 'always', T0)), ops()],
		['ConflictError', ['head']],
	);
	check(
		'neither left a backup or touched the doc',
		[keysUnder(t.prefix), bucket.get(t.docKey)?.text],
		[[], 'theirs'],
	);
	reset();
	check(
		'a force save (baseEtag undefined) still backs up what it overwrites',
		[await outcome(() => putDocWithBackup(t, 'mine', undefined, 'auto', T0)), ops().slice(0, 3)],
		['landed', ['head', 'copy', 'put']],
	);
}
{
	const t = target('spelling');
	const e1 = seed(t, 'v1');
	reset();
	await outcome(() => putDocWithBackup(t, 'v2', `W/${e1.slice(1, -1)}`, 'always', T0));
	check(
		'an unquoted/weak spelling of the SAME etag is not refused by the pre-check — the PUT decides',
		ops().slice(0, 3),
		['head', 'copy', 'put'],
	);
}
{
	const t = target('no-etag');
	bucket.set(t.docKey, { text: 'v1', etag: null });
	reset();
	await outcome(() => putDocWithBackup(t, 'v2', etagOf('anything'), 'always', T0));
	check(
		'a stored object with no etag proves nothing, so it is backed up',
		calls[1],
		`copy ${paths.docBackupKey(t, paths.docBackupId('flow-v2', T0, null))}`,
	);
}

// ── Fail loud: a HEAD that is not a 404 stops the save ────────────────────────
{
	const t = target('head-fails');
	const e1 = seed(t, 'v1');
	headFailure = Object.assign(new Error('R2 503'), { name: 'ServiceUnavailable' });
	reset();
	check(
		'a non-404 HEAD failure propagates and nothing is written',
		[
			await outcome(() => putDocWithBackup(t, 'v2', e1, 'always', T0)),
			ops(),
			bucket.get(t.docKey)?.text,
			keysUnder(t.prefix),
		],
		['ServiceUnavailable', ['head'], 'v1', []],
	);
}

// ── THE LANDMINE: a lost CAS leaves an INERT orphan, never a forever-409 ──────
// The component snapshots' `<id>.v<N>.json` re-derive the orphan's key on every later save and 409
// forever (`docs/design/multi-user-concurrency.md`). Asserted over three rounds, because "forever"
// is the claim under test and one round proves nothing about the second.
{
	const t = target('landmine');
	let etag = seed(t, 'v0');
	for (let round = 1; round <= 3; round++) {
		const live = bucket.get(t.docKey)!;
		const before = keysUnder(t.prefix).length;
		const theirs = `theirs${round}`;
		beforePut = () => seed(t, theirs);
		const lost = await outcome(() =>
			putDocWithBackup(t, `mine${round}`, etag, 'always', at(round * 10)),
		);
		const orphan = paths.docBackupKey(t, paths.docBackupId('flow-v2', at(round * 10), live.etag));
		check(
			`round ${round}: the save that lost its CAS after copying leaves their bytes live and one orphan`,
			[lost, bucket.get(t.docKey)?.text, bucket.get(orphan)?.text, keysUnder(t.prefix).length],
			['ConflictError', theirs, live.text, before + 1],
		);
		etag = etagOf(theirs);
		const next = await outcome(async () => {
			etag = (await putDocWithBackup(t, `good${round}`, etag, 'always', at(round * 10 + 1))) ?? '';
		});
		check(
			`round ${round}: the NEXT save does not inherit the orphan's 409`,
			[next, bucket.get(t.docKey)?.text],
			['landed', `good${round}`],
		);
	}
}
{
	// A repeat of the same prior bytes inside the same millisecond keys the SAME object with the
	// SAME bytes: an idempotent overwrite, which is why a repeated key cannot fail either.
	const t = target('repeat');
	const eA = seed(t, 'A');
	const instant = at(100);
	const eX = (await putDocWithBackup(t, 'X', eA, 'always', instant)) ?? '';
	const eA2 = (await putDocWithBackup(t, 'A', eX, 'always', instant)) ?? '';
	const repeatKey = paths.docBackupKey(t, paths.docBackupId('flow-v2', instant, eA));
	check(
		'a same-instant, same-etag repeat re-uses the key, holds the same bytes, and still lands',
		[
			await outcome(() => putDocWithBackup(t, 'X', eA2, 'always', instant)),
			keysUnder(t.prefix).length,
			bucket.get(repeatKey)?.text,
		],
		['landed', 2, 'A'],
	);
}

// ── Retention: 20 newest, pruned only after a PUT that landed ─────────────────
{
	const t = target('retention');
	let etag = seed(t, 'v0');
	const minted: string[] = [];
	for (let i = 1; i <= 25; i++) {
		minted.push(paths.docBackupId('flow-v2', at(i), etag));
		etag = (await putDocWithBackup(t, `v${i}`, etag, 'always', at(i))) ?? '';
	}
	check(
		'25 saves keep exactly the 20 newest backups',
		(await listBackups(t)).map((b) => b.id),
		minted.slice(5).reverse(),
	);
	check('and the 5 oldest objects are gone from the bucket', keysUnder(t.prefix).length, 20);

	beforePut = () => seed(t, 'theirs');
	reset();
	check(
		'a save that loses its CAS after copying answers ConflictError',
		await outcome(() => putDocWithBackup(t, 'mine', etag, 'always', at(30))),
		'ConflictError',
	);
	check('and never lists or deletes — the prune did not run for it', ops(), [
		'head',
		'copy',
		'put',
	]);
	check(
		'so its orphan is simply the 21st backup until the next landed save',
		keysUnder(t.prefix).length,
		21,
	);
	await putDocWithBackup(t, 'after', etagOf('theirs'), 'always', at(31));
	check('the next landed save prunes back to 20', (await listBackups(t)).length, 20);

	listFailure = new Error('list failed (expected by this check)');
	check(
		'a failing prune does not fail a save that already landed',
		await outcome(() => putDocWithBackup(t, 'later', etagOf('after'), 'always', at(32))),
		'landed',
	);
}

// ── Listing + reading stay inside the target ──────────────────────────────────
{
	const t = paths.editorDocBackupTarget('c', 'listing');
	const legacy = 'scenes-20260801T101500123Z-9f86d081';
	bucket.set(paths.docBackupKey(t, legacy), { text: '{"old":true}', etag: etagOf('old') });
	bucket.set(`${t.prefix}notes.txt`, { text: 'not a backup', etag: etagOf('n') });
	bucket.set(paths.docBackupKey(t, paths.docBackupId('flow-v2', T0, null)), {
		text: 'wrong stem',
		etag: etagOf('w'),
	});
	check("a listing reports only its own stem's ids", await listBackups(t), [
		{ id: legacy, savedAt: '2026-08-01T10:15:00.123Z', size: 12 },
	]);
	check('a legacy backup reads back', await readBackup(t, legacy), '{"old":true}');
	reset();
	check(
		'an id of another stem reads as absent without touching R2',
		[await readBackup(t, paths.docBackupId('flow-v2', T0, null)), calls],
		[null, []],
	);
	check(
		'a traversal id reads as absent without touching R2',
		[await readBackup(t, '../../x'), calls],
		[null, []],
	);
	check(
		'a pruned backup reads as absent',
		await readBackup(t, paths.docBackupId('scenes', T0, null)),
		null,
	);
}

// ── Each save is wired: backup under its own folder, before the PUT ───────────
/** Two saves of one doc; the second must back up the first's bytes under `prefix`. */
async function wired(
	label: string,
	t: DocBackupTarget,
	save: (baseEtag: string | null) => Promise<{ etag: string | null }>,
): Promise<void> {
	const first = await save(null);
	check(`${label}: the first save creates without a backup`, keysUnder(t.prefix), []);
	const firstBytes = bucket.get(t.docKey)?.text;
	reset();
	await save(first.etag);
	const copyAt = calls.findIndex((c) => c.startsWith(`copy ${t.prefix}`));
	const backups = keysUnder(t.prefix);
	check(
		`${label}: an overwrite backs the previous bytes up under its own folder, before the PUT`,
		[
			backups.length,
			bucket.get(backups[0] ?? '')?.text === firstBytes,
			copyAt >= 0 && copyAt < calls.indexOf(`put ${t.docKey}`),
		],
		[1, true, true],
	);
	reset();
	check(
		`${label}: a stale save is refused before any copy`,
		[await outcome(() => save(etagOf('stale'))), ops()],
		['ConflictError', ['head']],
	);
}

const flowSeed = freshDrivenSeedDoc('lines');
const linesConfig = JSON.parse(
	readFileSync(new URL('../src/lib/data/gameConfig/lines.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

await wired('scenes', paths.editorDocBackupTarget('w', 'p'), (baseEtag) =>
	saveDoc('w', 'p', normalizeDoc(undefined, 'p'), baseEtag),
);
await wired('flow-v2', paths.flowV2DocBackupTarget('w', 'p'), (baseEtag) =>
	saveFlowV2Doc('w', 'p', flowSeed, baseEtag),
);
await wired('symbols', paths.symbolsDocBackupTarget('w', 'p'), (baseEtag) =>
	saveSymbolsDoc('w', 'p', { version: 1, symbols: {} }, baseEtag),
);
await wired('config', paths.gameConfigDocBackupTarget('w', 'p'), (baseEtag) =>
	saveGameConfigDoc('w', 'p', linesConfig, baseEtag),
);

// ── The four history routes, driven through their real handlers ───────────────
type Handler = (event: never) => Response | Promise<Response>;
interface Answer {
	status: number;
	body: Record<string, unknown>;
}

async function call(handler: Handler, path: string, body?: unknown, user = true): Promise<Answer> {
	const url = new URL(`http://launcher.test${path}`);
	const init = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) };
	const event = {
		request: new Request(url, init),
		url,
		locals: { user: user ? { id: 'u', role: 'artist' } : null },
		cookies: { get: () => 'session-token' },
	};
	try {
		const res = await handler(event as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, body: { message: e.body.message } };
		throw e;
	}
}

interface RouteCase {
	name: string;
	target: DocBackupTarget;
	path: string;
	GET: Handler;
	POST: Handler;
	/** Extra body fields every restore sends (the session-scoped route's tab project). */
	extra: Record<string, unknown>;
	/** Write the live doc as version `tag` through the real save; returns its ETag. */
	save: (tag: string, baseEtag: string | null) => Promise<string | null>;
	/** Which version is live now. */
	liveTag: () => unknown;
	/** JSON that parses but is not a restorable doc of this kind (`null` = anything restores). */
	invalid: string | null;
}

const liveJson = (t: DocBackupTarget): Record<string, unknown> =>
	JSON.parse(bucket.get(t.docKey)?.text ?? 'null') as Record<string, unknown>;
const T_SCENES = paths.editorDocBackupTarget(SESSION.clientKey, SESSION.projectKey);
const T_FLOW = paths.flowV2DocBackupTarget(SESSION.clientKey, SESSION.projectKey);
const T_SYMBOLS = paths.symbolsDocBackupTarget(SESSION.clientKey, SESSION.projectKey);
const T_CONFIG = paths.gameConfigDocBackupTarget(SESSION.clientKey, SESSION.projectKey);

const ROUTES: RouteCase[] = [
	{
		name: 'api/editor/backups',
		target: T_SCENES,
		path: '/api/editor/backups',
		GET: editorBackupsRoute.GET,
		POST: editorBackupsRoute.POST,
		extra: {},
		save: async (tag, baseEtag) =>
			(await saveDoc('r', 'route', normalizeDoc({ gameType: tag }, 'route'), baseEtag)).etag,
		liveTag: () => liveJson(T_SCENES).gameType,
		invalid: null,
	},
	{
		name: 'api/flow-v2/backups',
		target: T_FLOW,
		path: '/api/flow-v2/backups?project=route',
		GET: flowBackupsRoute.GET,
		POST: flowBackupsRoute.POST,
		extra: { projectKey: SESSION.projectKey },
		save: async (tag, baseEtag) =>
			(await saveFlowV2Doc('r', 'route', { ...flowSeed, templateId: tag }, baseEtag)).etag,
		liveTag: () => liveJson(T_FLOW).templateId,
		invalid: '{"version":1,"graph":{}}',
	},
	{
		name: 'api/editor/symbols/backups',
		target: T_SYMBOLS,
		path: '/api/editor/symbols/backups?project=route',
		GET: symbolsBackupsRoute.GET,
		POST: symbolsBackupsRoute.POST,
		extra: {},
		save: async (tag, baseEtag) =>
			(
				await saveSymbolsDoc(
					'r',
					'route',
					{ version: 1, symbols: {}, names: { H1: { singular: tag } } },
					baseEtag,
				)
			).etag,
		liveTag: () => (liveJson(T_SYMBOLS).names as Record<string, { singular: string }>).H1.singular,
		invalid: '{"symbols":5}',
	},
	{
		name: 'api/game-config/backups',
		target: T_CONFIG,
		path: '/api/game-config/backups?project=route',
		GET: configBackupsRoute.GET,
		POST: configBackupsRoute.POST,
		extra: {},
		save: async (tag, baseEtag) =>
			(await saveGameConfigDoc('r', 'route', { ...linesConfig, gameName: tag }, baseEtag)).etag,
		liveTag: () => liveJson(T_CONFIG).gameName,
		invalid: '{}',
	},
];

for (const rc of ROUTES) {
	const n = rc.name;
	const eA = await rc.save('A', null);
	const eB = await rc.save('B', eA);

	const listed = await call(rc.GET, rc.path);
	const backups = listed.body.backups as { id: string; savedAt: string; size: number }[];
	check(
		`${n} GET: { ok, projectKey, backups: [{ id, savedAt, size }] }`,
		[
			listed.status,
			listed.body.ok,
			listed.body.projectKey,
			backups.length,
			Object.keys(backups[0]),
		],
		[200, true, SESSION.projectKey, 1, ['id', 'savedAt', 'size']],
	);
	const id = backups[0].id;
	const restore = (body: Record<string, unknown>) =>
		call(rc.POST, rc.path, { ...rc.extra, ...body });

	reset();
	const stale = await restore({ id, baseEtag: etagOf('a version this tab never saw') });
	check(
		`${n} POST: a stale restore is a json 409 conflict, copies nothing, and changes nothing`,
		[stale.status, stale.body.ok, stale.body.error, ops().includes('copy'), rc.liveTag()],
		[409, false, 'conflict', false, 'B'],
	);

	reset();
	const done = await restore({ id, baseEtag: eB });
	check(
		`${n} POST: a restore puts the backed-up version back and answers { ok, id, etag }`,
		[done.status, done.body.ok, done.body.id, done.body.etag, rc.liveTag()],
		[200, true, id, bucket.get(rc.target.docKey)?.etag, 'A'],
	);
	const after = await listBackups(rc.target);
	check(
		`${n} POST: the restore backed up what it replaced, even inside the coalescing window`,
		[after.length, after[0].id.endsWith(`-${(eB ?? '').slice(1, 9)}`)],
		[2, true],
	);

	const foreign = paths.docBackupId(rc.target.stem === 'scenes' ? 'symbols' : 'scenes', T0, null);
	for (const bad of ['../../x', foreign, '']) {
		check(
			`${n} POST: id ${JSON.stringify(bad)} is a 400`,
			(await restore({ id: bad, baseEtag: null })).status,
			400,
		);
	}
	check(
		`${n} POST: a restore that states no precondition is a 400`,
		(await restore({ id })).status,
		400,
	);
	check(
		`${n} POST: a pruned backup is a 404`,
		(await restore({ id: paths.docBackupId(rc.target.stem, T0, null), baseEtag: null })).status,
		404,
	);
	const corrupt = paths.docBackupId(rc.target.stem, at(-1), null);
	bucket.set(paths.docBackupKey(rc.target, corrupt), { text: '{not json', etag: etagOf('x') });
	check(
		`${n} POST: a corrupt backup is a 422`,
		(await restore({ id: corrupt, baseEtag: null })).status,
		422,
	);
	if (rc.invalid !== null) {
		const invalid = paths.docBackupId(rc.target.stem, at(-2), null);
		bucket.set(paths.docBackupKey(rc.target, invalid), { text: rc.invalid, etag: etagOf('y') });
		const refused = await restore({ id: invalid, baseEtag: done.body.etag });
		check(
			`${n} POST: a backup that is not a valid doc is a 422, and nothing is written`,
			[refused.status, rc.liveTag()],
			[422, 'A'],
		);
	}
	check(`${n}: no session is a 401`, (await call(rc.GET, rc.path, undefined, false)).status, 401);
}

check(
	'the session-scoped routes gate on their own tools',
	[...new Set(gatedTools)],
	['editor', 'flow'],
);
check('a config restore busts the runtime bundle for its project', invalidated, ['route']);
{
	reset();
	const res = await call(flowBackupsRoute.POST, '/api/flow-v2/backups', {
		id: paths.docBackupId('flow-v2', T0, null),
		force: true,
		projectKey: 'another-project',
	});
	check(
		'a flow restore from a tab on another project is a 409 scope-mismatch, even with force',
		[res.status, res.body.error, calls],
		[409, 'scope-mismatch', []],
	);
}
{
	const invalid = paths.docBackupId('config', at(-3), null);
	bucket.set(paths.docBackupKey(T_CONFIG, invalid), { text: '{}', etag: etagOf('z') });
	const res = await call(configBackupsRoute.POST, '/api/game-config/backups?project=route', {
		id: invalid,
		baseEtag: bucket.get(T_CONFIG.docKey)?.etag,
	});
	check(
		'a config backup the ship gate refuses carries its issue list',
		Array.isArray(res.body.issues) && res.body.issues.length > 0,
		true,
	);
}

// ── The save route's `backup` field ───────────────────────────────────────────
{
	const save = (body: Record<string, unknown>) =>
		call(flowSaveRoute.POST, '/api/flow-v2/save', { projectKey: SESSION.projectKey, ...body });
	reset();
	const auto = await save({
		doc: { ...flowSeed, templateId: 'C' },
		baseEtag: bucket.get(T_FLOW.docKey)?.etag,
	});
	check(
		'flow-v2 save: an autosave inside the window is coalesced',
		[auto.status, ops().includes('copy')],
		[200, false],
	);
	reset();
	const always = await save({
		doc: { ...flowSeed, templateId: 'D' },
		baseEtag: auto.body.etag,
		backup: 'always',
	});
	check(
		"flow-v2 save: backup: 'always' is never coalesced",
		[always.status, ops().includes('copy')],
		[200, true],
	);
	reset();
	const stale = await save({ doc: flowSeed, baseEtag: auto.body.etag, backup: 'always' });
	check(
		'flow-v2 save: a stale save is a json 409 and takes no backup',
		[stale.status, stale.body.error, ops()],
		[409, 'conflict', ['head']],
	);
}

// ── The flow history lists only the project the tab loaded ─────────────────────────────────
{
	const moved = await call(flowBackupsRoute.GET, '/api/flow-v2/backups?project=elsewhere');
	check(
		'flow-v2 GET: a tab whose project is no longer the session one gets a json 409',
		[moved.status, moved.body.error, moved.body.backups],
		[409, 'scope-mismatch', undefined],
	);
}

// ── A duplicated project starts its own history ──────────────────────────────────────────────
{
	const src = ['dup', 'source'] as const;
	const docs = [
		paths.editorDocKey(...src),
		paths.flowV2DocKey(...src),
		paths.symbolsDocKey(...src),
		paths.gameConfigDocKey(...src),
	];
	for (const key of docs) bucket.set(key, { text: '{}', etag: etagOf(key) });
	for (const build of [
		paths.editorDocBackupTarget,
		paths.flowV2DocBackupTarget,
		paths.symbolsDocBackupTarget,
		paths.gameConfigDocBackupTarget,
	]) {
		const t = build(...src);
		bucket.set(`${t.prefix}${paths.docBackupId(t.stem, T0, 'abc')}.json`, {
			text: '{}',
			etag: 'x',
		});
	}
	for (const scope of ['setup', 'full'] as const) {
		const plan = await planDuplicate(
			{ clientKey: src[0], projectKey: src[1] },
			{ clientKey: 'dup', projectKey: 'copy' },
			scope,
		);
		check(
			`duplicate (${scope}): copies the four docs and none of their backups`,
			docs.every((key) => plan.some((e) => e.from === key)) &&
				!plan.some((e) => /backups\//.test(e.from)),
			true,
		);
	}
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} doc-backup checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} doc-backup checks pass`);
