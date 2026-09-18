// Offline fixture for the Scene Editor doc BACKUP layer (apps/launcher-api/src/lib/server/
// editorDocBackups.ts + the ordering inside editorStorage.saveDoc).
//
//   node scripts/verify-editor-doc-backup.mjs
//
// WHY IT EXISTS. The editor autosaves the whole `scenes.json` blob 1.2 s after any panel edit.
// The ETag CAS stops author A clobbering author B; nothing stopped author A clobbering author A,
// and the bucket has no object versioning, so a bad edit / a scaffold load / an "overwrite with
// mine" was unrecoverable. This fixture drives the backup layer against a stubbed R2 and asserts
// the five properties the feature is worth nothing without.
//
// WHAT IT PROVES.
//
//   1. A save PRESERVES THE PREVIOUS BYTES, exactly — the backup object's body is string-identical
//      to what was stored before the PUT, and restoring it puts those same scenes back.
//
//   2. THE LANDMINE. `docs/design/multi-user-concurrency.md` records how the component library's
//      `<id>.v<N>.json` snapshots go wrong: `N` is RECOMPUTED on every save, so an orphan snapshot
//      left by a lost CAS is re-derived by every later save, collides, and 409s FOREVER,
//      unforceably. The backup key is stamp+ETag derived and its write carries no precondition, so
//      an orphan is inert. That is asserted DIRECTLY and repeatedly: after a failed CAS the stored
//      doc is untouched, and the next correct-ETag save succeeds — three failure/success cycles,
//      because "forever" is the claim under test and one round proves nothing about the second.
//
//   3. FAIL LOUD. A read failure on the doc must never be read as "there is nothing to back up".
//      With the HEAD throwing, `saveDoc` throws and the stored doc is untouched — the save does
//      NOT proceed to destroy bytes it could not prove existed (the `readComponent` swallow bug).
//
//   4. RETENTION prunes to the bound and keeps the NEWEST, ordered by the stamp in the KEY (not by
//      the copies' `LastModified`, which is the time of the copy, not of the authoring).
//
//   5. RESTORE takes a backup of what it replaces, so restoring the wrong version is itself
//      undoable — otherwise version history just moves the unrecoverable act one step along.
//
// WHAT IT CANNOT PROVE.
//   * R2 itself. The bucket here is a Map that implements `If-Match` / `If-None-Match: *` and
//     404-vs-throw the way `r2.ts` documents them; that R2 answers 412 for a stale `If-Match` is
//     the shipped `isPreconditionFailed` mapping, not something a fixture can check.
//   * The HTTP layer. `/api/editor/backups` is a SvelteKit route and cannot be imported from Node,
//     so the restore below re-executes the endpoint's steps — and then ASSERTS against the real
//     route source that those are still the steps it takes (gate, required baseEtag, `'always'`,
//     `json(...,409)` for a conflict). A rewrite of the handler fails here loudly.
//   * Anything about the browser: the History button, the coalescing as experienced by a real
//     1.2 s autosave burst, or the lease interaction.
//
// Everything under test is SLICED OUT OF THE SHIPPED SOURCE (the modules are TypeScript under
// `$lib/server` and cannot be imported from Node), so a rename, a reordering, or a signature
// change fails loudly here rather than leaving the fixture quietly asserting nothing.

import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSlice } from './lib/compile-slice.mjs';
import { lfReaderFrom } from './lib/read-lf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows; every slice marker below is written with `\n`.
const read = lfReaderFrom(ROOT);

let failures = 0;
let checks = 0;
const check = (label, actual, expected) => {
	checks += 1;
	if (!Object.is(actual, expected)) {
		failures += 1;
		console.log(
			`FAIL  ${label}\n      got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`,
		);
	}
};

// ---------------------------------------------------------------------------
// Slicing the real source.
// ---------------------------------------------------------------------------

/** Strip one TS parameter down to plain JS, keeping any default. */
const stripParam = (p) => {
	const t = p.trim();
	const colon = t.indexOf(':');
	if (colon < 0) return t;
	const name = t.slice(0, colon).replace(/\?$/, '').trim();
	const rest = t.slice(colon + 1);
	const eq = rest.indexOf('=');
	return eq < 0 ? name : `${name} =${rest.slice(eq + 1)}`;
};

/**
 * Lift one exported function out of a module as runnable JS: the real body verbatim, with the
 * signature's parameter/return annotations removed. Throws when the function (or its declared
 * return type, which every one of these has) can no longer be found — the fixture must fail
 * loudly on a refactor rather than silently test nothing.
 */
const takeFn = (src, name) => {
	const sig = new RegExp(`export (async )?function ${name}\\(`);
	const m = sig.exec(src);
	if (!m) throw new Error(`${name}: could not find an exported declaration`);
	// Walk the parameter list by paren depth — a default like `now = new Date()` puts parens
	// inside it, so a non-greedy `\)` would stop in the wrong place.
	let i = m.index + m[0].length;
	const paramStart = i;
	for (let depth = 1; depth > 0; i++) {
		if (i >= src.length) throw new Error(`${name}: unterminated parameter list`);
		if (src[i] === '(') depth++;
		else if (src[i] === ')') depth--;
	}
	const params = src
		.slice(paramStart, i - 1)
		.split(',')
		.map(stripParam)
		.filter((p) => p.length > 0);
	// Then the return annotation, which every one of these declares. It can itself contain `{`
	// (`Promise<{ doc: LayoutDoc; etag: string | null }>`), so the body's brace is the first one
	// at angle-bracket depth zero.
	const colon = src.indexOf(':', i);
	if (colon < 0 || colon > src.indexOf('{', i)) throw new Error(`${name}: no return annotation`);
	let angle = 0;
	let bodyStart = -1;
	for (let j = colon + 1; j < src.length; j++) {
		const c = src[j];
		if (c === '<') angle++;
		else if (c === '>') angle--;
		else if (c === '{' && angle === 0) {
			bodyStart = j + 1;
			break;
		}
	}
	if (bodyStart < 0) throw new Error(`${name}: could not find the body`);
	const bodyEnd = src.indexOf('\n}\n', bodyStart);
	if (bodyEnd < 0) throw new Error(`${name}: could not find the end of the body`);
	const head = `${m[1] ?? ''}function ${name}(${params.join(', ')}) {`;
	return `${head}${src.slice(bodyStart, bodyEnd)}\n}\n`;
};

/** Replace an exact marker, failing loudly when the source no longer contains it. */
const sub = (src, from, to, what) => {
	if (!src.includes(from))
		throw new Error(`${what}: source no longer contains ${JSON.stringify(from)}`);
	return src.split(from).join(to);
};

const pathsSrc = read('apps/launcher-api/src/lib/server/projectPaths.ts');
const backupsSrc = read('apps/launcher-api/src/lib/server/editorDocBackups.ts');
const storageSrc = read('apps/launcher-api/src/lib/server/editorStorage.ts');
const r2Src = read('apps/launcher-api/src/lib/server/r2.ts');
const routeSrc = read('apps/launcher-api/src/routes/api/editor/backups/+server.ts');

// The asset-type subfolder map, sliced whole so `SUB.editor` is the REAL one — the backups live
// beside `scenes.json` and a change to that layout has to reach this fixture.
const subMap = (() => {
	const start = pathsSrc.indexOf('export const SUB = {');
	const end = pathsSrc.indexOf('} as const;', start);
	if (start < 0 || end < 0) throw new Error('could not slice the SUB map out of projectPaths.ts');
	const out = pathsSrc
		.slice(start, end + '} as const;'.length)
		.replace('export const SUB = {', 'const SUB = {')
		.replace('} as const;', '};')
		.replace(/\(c: string, p: string\)/g, '(c, p)');
	if (/:\s*string/.test(out))
		throw new Error('the SUB map grew an annotation this fixture cannot strip');
	return out;
})();

const backupIdRe = (() => {
	const m = /export const EDITOR_DOC_BACKUP_ID_RE = (\/.*\/);/.exec(pathsSrc);
	if (!m) throw new Error('projectPaths.ts no longer exports EDITOR_DOC_BACKUP_ID_RE');
	return `const EDITOR_DOC_BACKUP_ID_RE = ${m[1]};`;
})();

const readNumberConst = (src, name) => {
	const m = new RegExp(`^const ${name} = ([^;]+);`, 'm').exec(src);
	if (!m) throw new Error(`editorDocBackups.ts no longer declares ${name}`);
	return `const ${name} = ${m[1]};`;
};

let backupsModule = [
	readNumberConst(backupsSrc, 'COALESCE_MS'),
	'const lastBackupAtMs = new Map();',
	readNumberConst(backupsSrc, 'BACKUP_KEEP'),
	takeFn(backupsSrc, 'backupBeforeOverwrite'),
	takeFn(backupsSrc, 'listBackups'),
	takeFn(backupsSrc, 'readBackup'),
	takeFn(backupsSrc, 'pruneBackups'),
].join('\n');
backupsModule = sub(
	backupsModule,
	'const backups: EditorDocBackup[] = [];',
	'const backups = [];',
	'listBackups',
);
if (!backupsSrc.includes('const lastBackupAtMs = new Map<string, number>();')) {
	throw new Error('editorDocBackups.ts no longer declares the lastBackupAtMs memo');
}

// STRUCTURAL guard on the two properties that make the landmine impossible, asserted against the
// source itself because they are absences and an absence cannot be driven: the backup key must not
// be derived from a COUNT of what already exists, and the copy must not carry a precondition.
const backupIdFn = takeFn(pathsSrc, 'editorDocBackupId');
if (/length|\+\s*1|list/i.test(backupIdFn)) {
	throw new Error(
		'editorDocBackupId now derives its key from existing state — that is the landmine',
	);
}
const copyCall = /await copyObject\(([\s\S]*?)\);/.exec(backupsSrc);
if (!copyCall) throw new Error('backupBeforeOverwrite no longer calls copyObject');
if (/cond|ifMatch|ifNoneMatch|precondition/.test(copyCall[1])) {
	throw new Error('the backup copy now carries a precondition — it can 409 and strand a project');
}

// `takeFn` above does this fixture's own type stripping, declaration by declaration, because it has
// to walk parameter lists and return annotations to find each body at all. What it cannot do is
// report a parse failure as anything but a bare SyntaxError from `<anonymous_script>` — eleven
// declarations are spliced together here, and the frame has to name which one drifted.
const build = compileSlice({
	what: 'verify-editor-doc-backup / editorDocPaths + editorDocBackups + editorStorage',
	names: [
		'headObject',
		'copyObject',
		'getObjectText',
		'listAllObjects',
		'deleteObjects',
		'putObjectText',
		'normalizeDoc',
	],
	body: `${takeFn(pathsSrc, 'r2Slug')}
${takeFn(pathsSrc, 'projectPrefix')}
${subMap}
${takeFn(pathsSrc, 'editorDocKey')}
${takeFn(pathsSrc, 'editorDocBackupsPrefix')}
${backupIdFn}
${backupIdRe}
${takeFn(pathsSrc, 'editorDocBackupKey')}
${takeFn(pathsSrc, 'editorDocBackupSavedAt')}
${takeFn(r2Src, 'precondition')}
${backupsModule}
${takeFn(storageSrc, 'saveDoc')}
return {
	editorDocKey,
	editorDocBackupId,
	editorDocBackupKey,
	editorDocBackupSavedAt,
	backupBeforeOverwrite,
	listBackups,
	readBackup,
	pruneBackups,
	saveDoc,
	forgetCoalescing: () => lastBackupAtMs.clear(),
};`,
});

// ---------------------------------------------------------------------------
// The stub R2 — the helper boundary named in `r2.ts`, not a real bucket.
// ---------------------------------------------------------------------------

class ConflictError extends Error {
	constructor(key) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}

/** R2's ETag for a single-part upload is the body's MD5, quoted — including that identical bytes
 *  get an identical ETag, which is why a repeated backup of the same prior state is idempotent. */
const etagOf = (text) => `"${createHash('md5').update(text).digest('hex')}"`;

const makeR2 = () => {
	const bucket = new Map();
	const state = { failReads: false, clock: 1 };
	const fail = () => {
		const e = new Error('R2 is unavailable');
		e.$metadata = { httpStatusCode: 500 };
		return e;
	};
	return {
		bucket,
		state,
		headObject: async (key) => {
			if (state.failReads) throw fail();
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.body.length, lastModified: o.lastModified } : null;
		},
		copyObject: async (src, dest) => {
			if (state.failReads) throw fail();
			const o = bucket.get(src);
			if (!o) return false;
			bucket.set(dest, { ...o, lastModified: state.clock++ });
			return true;
		},
		getObjectText: async (key) => {
			if (state.failReads) throw fail();
			return bucket.get(key)?.body ?? null;
		},
		listAllObjects: async (prefix) =>
			[...bucket.entries()]
				.filter(([k]) => k.startsWith(prefix))
				.map(([key, o]) => ({ key, size: o.body.length, lastModified: o.lastModified })),
		deleteObjects: async (keys) => {
			for (const k of keys) bucket.delete(k);
		},
		putObjectText: async (key, text, _contentType, cond) => {
			const existing = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && existing) throw new ConflictError(key);
			if (cond?.ifMatch && existing?.etag !== cond.ifMatch) throw new ConflictError(key);
			const etag = etagOf(text);
			bucket.set(key, { body: text, etag, lastModified: state.clock++ });
			return etag;
		},
	};
};

/** The normalizer, stubbed: `saveDoc`'s own re-stamping of `updatedAt` is what is under test, and
 *  `normalizeDoc`'s whitelist has its own coverage. Deep-clones so nothing aliases the caller. */
const normalizeDoc = (input, fallbackProjectKey = '') => {
	const obj = input && typeof input === 'object' ? structuredClone(input) : {};
	return { version: 2, projectKey: obj.projectKey || fallbackProjectKey, scenes: [], ...obj };
};

const CLIENT = 'Borut';
const PROJECT = 'book-of-borut';

const boot = () => {
	const r2 = makeR2();
	const api = build(
		r2.headObject,
		r2.copyObject,
		r2.getObjectText,
		r2.listAllObjects,
		r2.deleteObjects,
		r2.putObjectText,
		normalizeDoc,
	);
	api.forgetCoalescing();
	return { r2, api };
};

const docWith = (name) => ({ projectKey: PROJECT, scenes: [{ id: name, name, nodes: [] }] });
const storedBody = (r2, api) => r2.bucket.get(api.editorDocKey(CLIENT, PROJECT))?.body ?? null;
const storedEtag = (r2, api) => r2.bucket.get(api.editorDocKey(CLIENT, PROJECT))?.etag ?? null;

/**
 * Find the backup that preserved the object with this ETag. Looking it up BY THE ETAG TAG is the
 * point, not a convenience: it is the key scheme's own claim — a backup is addressed by the bytes
 * it holds, never by a position in a sequence — and the fixture would rather assert that than
 * assume `[0]` is the one it means. (Ids only tie-break by tag within the same millisecond, which
 * the 5-minute coalescing window makes unreachable in production but a tight loop hits every time.)
 */
const tagOf = (etag) =>
	etag
		.replace(/[^0-9a-fA-F]/g, '')
		.toLowerCase()
		.slice(0, 8);
const findByTag = (list, etag) => list.find((b) => b.id.endsWith(`-${tagOf(etag)}`));

/**
 * The restore endpoint's steps, re-executed here because a SvelteKit route cannot be imported.
 * Kept honest by `4` below, which asserts the real handler still does exactly these things.
 */
const restore = async (api, id, baseEtag) => {
	const raw = await api.readBackup(CLIENT, PROJECT, id);
	if (raw === null) return { ok: false, reason: 'gone' };
	const parsed = JSON.parse(raw);
	const restored = normalizeDoc(parsed, PROJECT);
	try {
		const { doc, etag } = await api.saveDoc(CLIENT, PROJECT, restored, baseEtag, 'always');
		return { ok: true, doc, etag };
	} catch (e) {
		if (e.name === 'ConflictError') return { ok: false, reason: 'conflict' };
		throw e;
	}
};

// ---------------------------------------------------------------------------
// 0 — the key scheme itself.
// ---------------------------------------------------------------------------
{
	const { api } = boot();
	const at = new Date('2026-08-21T13:14:15.123Z');
	const id = api.editorDocBackupId(at, '"a1b2c3d4e5f60718293a4b5c6d7e8f90"');
	check('the id is stamp + etag-derived', id, 'scenes-20260821T131415123Z-a1b2c3d4');
	check(
		'the id is a PURE function of (instant, etag) — nothing recomputes it',
		api.editorDocBackupId(at, '"a1b2c3d4e5f60718293a4b5c6d7e8f90"'),
		id,
	);
	check(
		'a different prior etag gives a different key at the same instant',
		api.editorDocBackupId(at, '"ffffffffffffffffffffffffffffffff"'),
		'scenes-20260821T131415123Z-ffffffff',
	);
	check(
		'an etag-less object still keys legally',
		api.editorDocBackupId(at, null).endsWith('-noetag'),
		true,
	);
	check(
		'the stamp round-trips to the instant it encodes',
		api.editorDocBackupSavedAt(id),
		at.toISOString(),
	);
	check(
		'a non-backup object name is not mistaken for one',
		api.editorDocBackupSavedAt('scenes'),
		null,
	);
	check(
		'lexicographic id order IS chronological order',
		api.editorDocBackupId(new Date('2026-08-21T13:14:15.124Z'), '"00"') > id,
		true,
	);
	check(
		'backups live under the project prefix, not beside scenes.json',
		api.editorDocBackupKey(CLIENT, PROJECT, id),
		'borut/book_of_borut/editor/backups/' + id + '.json',
	);
}

// ---------------------------------------------------------------------------
// 1 — a save preserves the PREVIOUS bytes, and a restore puts them back.
// ---------------------------------------------------------------------------
{
	const { r2, api } = boot();
	const created = await api.saveDoc(CLIENT, PROJECT, docWith('first'), null, 'always');
	check('the create wrote the doc', JSON.parse(storedBody(r2, api)).scenes[0].id, 'first');
	check(
		'a create backs up NOTHING — there were provably no previous bytes',
		(await api.listBackups(CLIENT, PROJECT)).length,
		0,
	);

	const firstBytes = storedBody(r2, api);
	const second = await api.saveDoc(CLIENT, PROJECT, docWith('second'), created.etag, 'always');
	const backups = await api.listBackups(CLIENT, PROJECT);
	check('the overwrite took exactly one backup', backups.length, 1);
	check(
		'the backup body is the PREVIOUS bytes, byte for byte',
		await api.readBackup(CLIENT, PROJECT, backups[0].id),
		firstBytes,
	);
	check('the live doc is the new one', JSON.parse(storedBody(r2, api)).scenes[0].id, 'second');

	const back = await restore(api, backups[0].id, second.etag);
	check('the restore landed', back.ok, true);
	check(
		'the restored doc is the backed-up doc',
		JSON.parse(storedBody(r2, api)).scenes[0].id,
		'first',
	);
	check(
		'the restore round-trips the preserved bytes exactly, but for the re-stamped updatedAt',
		JSON.stringify({ ...JSON.parse(storedBody(r2, api)), updatedAt: 0 }),
		JSON.stringify({ ...JSON.parse(firstBytes), updatedAt: 0 }),
	);
	check(
		'…and `updatedAt` IS re-stamped, so the doc says when it became live',
		JSON.parse(storedBody(r2, api)).updatedAt !== JSON.parse(firstBytes).updatedAt,
		true,
	);
}

// ---------------------------------------------------------------------------
// 2 — THE LANDMINE. A lost CAS leaves an orphan; the orphan must be inert.
// ---------------------------------------------------------------------------
{
	const { r2, api } = boot();
	let live = await api.saveDoc(CLIENT, PROJECT, docWith('v1'), null, 'always');
	live = await api.saveDoc(CLIENT, PROJECT, docWith('v2'), live.etag, 'always');

	const staleEtag = etagOf('a doc that was never here');
	for (let round = 1; round <= 3; round++) {
		const beforeBody = storedBody(r2, api);
		const beforeEtag = storedEtag(r2, api);
		const beforeBackups = (await api.listBackups(CLIENT, PROJECT)).length;

		let conflicted = false;
		try {
			await api.saveDoc(CLIENT, PROJECT, docWith(`clobber${round}`), staleEtag, 'always');
		} catch (e) {
			conflicted = e.name === 'ConflictError';
		}
		check(`round ${round}: a stale ETag still 409s — the CAS is not weakened`, conflicted, true);
		check(
			`round ${round}: the stored doc is UNTOUCHED by the lost CAS`,
			storedBody(r2, api),
			beforeBody,
		);
		const orphan = findByTag(await api.listBackups(CLIENT, PROJECT), beforeEtag);
		check(
			`round ${round}: the orphan backup holds the bytes that are still live`,
			await api.readBackup(CLIENT, PROJECT, orphan.id),
			beforeBody,
		);
		check(
			`round ${round}: the orphan is an ordinary extra backup, not a wedge`,
			(await api.listBackups(CLIENT, PROJECT)).length,
			beforeBackups + 1,
		);

		// THE assertion. Under the recomputed-`v<N>` scheme this is where a project dies: the next
		// save re-derives the orphan's key, collides, and 409s — forever, unforceably.
		let after = null;
		let threw = null;
		try {
			after = await api.saveDoc(CLIENT, PROJECT, docWith(`good${round}`), beforeEtag, 'always');
		} catch (e) {
			threw = e.name;
		}
		check(`round ${round}: the NEXT save does not inherit the orphan's 409`, threw, null);
		check(
			`round ${round}: …and it actually landed`,
			JSON.parse(storedBody(r2, api)).scenes[0].id,
			`good${round}`,
		);
		live = after;
	}

	// A repeat of the same prior state inside the same millisecond keys the SAME object with the
	// SAME bytes: an idempotent overwrite, which is why a repeat cannot fail either.
	const instant = new Date('2026-08-21T09:00:00.000Z');
	const a = await api.backupBeforeOverwrite(CLIENT, PROJECT, 'always', instant);
	const b = await api.backupBeforeOverwrite(CLIENT, PROJECT, 'always', instant);
	check('a same-instant, same-etag repeat re-uses the key', a, b);
	check(
		'…and the object still holds the live bytes (an idempotent overwrite, not a collision)',
		await api.readBackup(CLIENT, PROJECT, a),
		storedBody(r2, api),
	);
	check(
		'a save after the repeat still succeeds',
		(await api.saveDoc(CLIENT, PROJECT, docWith('after'), live.etag, 'always')) !== null,
		true,
	);
}

// ---------------------------------------------------------------------------
// 3 — FAIL LOUD. A read failure is not "there is nothing to back up".
// ---------------------------------------------------------------------------
{
	const { r2, api } = boot();
	const live = await api.saveDoc(CLIENT, PROJECT, docWith('precious'), null, 'always');
	const before = storedBody(r2, api);

	r2.state.failReads = true;
	let threw = null;
	try {
		await api.saveDoc(CLIENT, PROJECT, docWith('overwrite'), live.etag, 'always');
	} catch (e) {
		threw = e.message;
	}
	check('the save FAILS rather than proceeding unprovable', threw, 'R2 is unavailable');
	check('…and the precious bytes are still there', storedBody(r2, api), before);
	r2.state.failReads = false;
	check(
		'no backup was invented for a read that never answered',
		(await api.listBackups(CLIENT, PROJECT)).length,
		0,
	);

	// The counterpart: a read that answers "absent" IS trusted, because `headObject` returns null
	// only for a real 404. A create must not be blocked by having nothing to preserve.
	const { r2: r2b, api: apiB } = boot();
	const fresh = await apiB.saveDoc(CLIENT, PROJECT, docWith('brand-new'), null, 'always');
	check('a genuinely absent doc creates cleanly', fresh.doc.scenes[0].id, 'brand-new');
	check('…with no backup object', [...r2b.bucket.keys()].length, 1);
}

// ---------------------------------------------------------------------------
// 4 — RETENTION, and the coalescing that keeps autosave cheap.
// ---------------------------------------------------------------------------
{
	// Retention driven at REAL cadence: one backup per simulated 5-minute window, so the stamps in
	// the keys differ and "keeps the newest" is a claim about ordering rather than about whatever a
	// same-millisecond tie-break happened to do. The doc is advanced with the raw guarded PUT
	// between backups so this block exercises retention alone.
	const { r2, api } = boot();
	const key = api.editorDocKey(CLIENT, PROJECT);
	let etag = await r2.putObjectText(key, JSON.stringify(docWith('gen0')), 'application/json', {
		ifNoneMatch: '*',
	});
	const base = Date.parse('2026-08-21T08:00:00.000Z');
	for (let i = 1; i <= 25; i++) {
		await api.backupBeforeOverwrite(CLIENT, PROJECT, 'auto', new Date(base + i * 5 * 60_000));
		etag = await r2.putObjectText(key, JSON.stringify(docWith(`gen${i}`)), 'application/json', {
			ifMatch: etag,
		});
	}
	check(
		'25 windows produced 25 backups before any prune',
		(await api.listBackups(CLIENT, PROJECT)).length,
		25,
	);
	const pruned = await api.pruneBackups(CLIENT, PROJECT);
	check('the prune removed exactly the overflow', pruned.length, 5);
	const kept = await api.listBackups(CLIENT, PROJECT);
	check('retention pruned to the bound', kept.length, 20);
	check(
		'…keeping the NEWEST, which is the state just before the last write',
		JSON.parse(await api.readBackup(CLIENT, PROJECT, kept[0].id)).scenes[0].id,
		'gen24',
	);
	check(
		'…and the oldest survivor is exactly 20 generations back',
		JSON.parse(await api.readBackup(CLIENT, PROJECT, kept[19].id)).scenes[0].id,
		'gen5',
	);
	check('the listing is newest-first', kept[0].id > kept[19].id, true);
	check(
		'every entry carries a parseable timestamp',
		kept.every((b) => Boolean(b.savedAt)),
		true,
	);
	check(
		'the prune is idempotent — a second pass removes nothing',
		(await api.pruneBackups(CLIENT, PROJECT)).length,
		0,
	);
}
{
	// And the bound holds through `saveDoc` itself, which is where the prune actually runs.
	const { api } = boot();
	let live = await api.saveDoc(CLIENT, PROJECT, docWith('s0'), null, 'always');
	for (let i = 1; i <= 25; i++) {
		live = await api.saveDoc(CLIENT, PROJECT, docWith(`s${i}`), live.etag, 'always');
	}
	check(
		'saveDoc keeps the project inside the bound',
		(await api.listBackups(CLIENT, PROJECT)).length,
		20,
	);
}
{
	// Autosave coalescing: 1.2 s debounce means an active hour is ~1000 saves, so `'auto'` takes at
	// most one copy per window. `'always'` — a scaffold/kind/reference load being committed, or a
	// restore — ignores the window, because that is the write an author asks to undo.
	const { api } = boot();
	let live = await api.saveDoc(CLIENT, PROJECT, docWith('a'), null, 'auto');
	live = await api.saveDoc(CLIENT, PROJECT, docWith('b'), live.etag, 'auto');
	check('the first overwrite backs up', (await api.listBackups(CLIENT, PROJECT)).length, 1);
	for (let i = 0; i < 20; i++) {
		live = await api.saveDoc(CLIENT, PROJECT, docWith(`burst${i}`), live.etag, 'auto');
	}
	check(
		'a burst inside the window costs no further copies',
		(await api.listBackups(CLIENT, PROJECT)).length,
		1,
	);
	await api.saveDoc(CLIENT, PROJECT, docWith('destructive'), live.etag, 'always');
	check(
		'a destructive save is never coalesced away',
		(await api.listBackups(CLIENT, PROJECT)).length,
		2,
	);
}

// ---------------------------------------------------------------------------
// 5 — RESTORE takes a backup of what it replaces, and answers to the CAS.
// ---------------------------------------------------------------------------
{
	const { r2, api } = boot();
	let live = await api.saveDoc(CLIENT, PROJECT, docWith('old'), null, 'always');
	live = await api.saveDoc(CLIENT, PROJECT, docWith('current'), live.etag, 'always');
	const [oldBackup] = await api.listBackups(CLIENT, PROJECT);
	const currentBytes = storedBody(r2, api);

	const replacedEtag = live.etag;
	const done = await restore(api, oldBackup.id, live.etag);
	check('the restore landed', done.ok, true);
	const after = await api.listBackups(CLIENT, PROJECT);
	check('the restore itself took a backup', after.length, 2);
	check(
		'…of exactly what it replaced, so restoring the wrong version is undoable',
		await api.readBackup(CLIENT, PROJECT, findByTag(after, replacedEtag).id),
		currentBytes,
	);

	// A restore from a stale tab must LOSE, not quietly revert a concurrent author's work.
	const other = await api.saveDoc(CLIENT, PROJECT, docWith('theirs'), done.etag, 'auto');
	const stale = await restore(api, oldBackup.id, done.etag);
	check('a stale restore conflicts instead of clobbering', stale.reason, 'conflict');
	check('…and their work is untouched', JSON.parse(storedBody(r2, api)).scenes[0].id, 'theirs');
	check(
		'their etag still works afterwards',
		(await restore(api, oldBackup.id, other.etag)).ok,
		true,
	);

	const gone = await restore(api, 'scenes-20200101T000000000Z-deadbeef', storedEtag(r2, api));
	check('a pruned backup id is reported gone, not restored as empty', gone.reason, 'gone');
	check(
		'a malformed id never reaches R2',
		await api.readBackup(CLIENT, PROJECT, '../../etc/passwd'),
		null,
	);
}

// ---------------------------------------------------------------------------
// 6 — the shipped route still does what `restore()` above models.
// ---------------------------------------------------------------------------
{
	const has = (needle) => routeSrc.includes(needle);
	check(
		'the route uses the shared scope gate',
		has("from '$lib/server/toolScope'") && has('await gate('),
		true,
	);
	check('it gates on the editor tool', has("tool: 'editor'"), true);
	check('it REQUIRES the caller to state its precondition', has('writeBaseEtagJson(body)'), true);
	check(
		'it validates the id shape before touching R2',
		has('EDITOR_DOC_BACKUP_ID_RE.test(id)'),
		true,
	);
	check(
		"it restores through saveDoc with backup 'always'",
		/saveDoc\([\s\S]*?'always',?\s*\)/.test(routeSrc),
		true,
	);
	check(
		'a conflict answers json(...,409), never error()',
		/json\([\s\S]*?'conflict'[\s\S]*?status: 409/.test(routeSrc),
		true,
	);
	// The ordering claim, asserted against `saveDoc` itself: preserve, then PUT, then prune.
	const save = takeFn(storageSrc, 'saveDoc');
	const iBackup = save.indexOf('backupBeforeOverwrite');
	const iPut = save.indexOf('putObjectText');
	const iPrune = save.indexOf('pruneBackups');
	check('saveDoc preserves BEFORE it overwrites', iBackup >= 0 && iBackup < iPut, true);
	check('…and prunes only AFTER the write landed', iPrune > iPut, true);
	check('…and only when a backup was actually taken', save.includes('if (backupId) {'), true);
}

console.log('');
if (failures) {
	console.log(`${failures} FAILED of ${checks} checks`);
	process.exit(1);
}
console.log(
	`${checks} checks — a save preserves the bytes it replaces, a lost CAS leaves an INERT orphan and\n` +
		`the next save still lands (three cycles, no forever-409), a read failure fails loud instead of\n` +
		`reading as "nothing to back up", retention keeps the newest 20, and a restore backs up what it\n` +
		`replaces while still answering to the ETag CAS.`,
);
