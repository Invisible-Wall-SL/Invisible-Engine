/**
 * Contract check for Invisible Director's mockup storage and adapters (ADR-0005; PLAN 3.6):
 *   pnpm --filter launcher-api check:director-mockups
 *
 * Runs the REAL `director/mockups.ts`, `mockupPixels.ts` (sharp), `ops/mockups.ts`,
 * `mockupCleanup.ts`, the route `POST /api/director/mockups`, `requireProjectScope`, the refusals,
 * and `planDuplicate`. Replaced at their boundaries: R2 (an in-memory bucket that records each
 * write's precondition) and the Postgres-backed modules (projects, overrides, the Director store,
 * sessions, the project-key lock — the real advisory-lock SQL needs a database and is not run here).
 *
 * Pinned:
 *  - PNG and JPG are accepted by their bytes; anything else is 415; an empty file 400; a file over
 *    20 MB 413; a 13th file 409 — and a refused upload leaves no object behind;
 *  - each original is written create-only (`If-None-Match: *`); the doc is created once and then
 *    CAS-saved, and a lost CAS re-reads and re-applies rather than failing or overwriting;
 *  - the ownership check is recorded once with who and when; `ownershipRefusal` refuses a run with
 *    mockups and no check, and nothing else;
 *  - the route is gated on the `director` tool and the project named in the request; a free key
 *    whose R2 folder is a project's under the same client (live or deleted) is a 409 (naming no project), on
 *    the doc, upload and image routes, and writes nothing — another client's folder is free;
 *  - the model copy is at most 1568 px on the long edge with the scale reported; a crop is cut from
 *    the ORIGINAL at the unscaled box; the dominant colours of the reference set equal the committed
 *    ones (the k-means is deterministic);
 *  - the adapters: `list`, `get_image`, `save_crops` (under `director/crops/<runId>/`, a key the
 *    write guard allows), `get_crop`;
 *  - the `director/` subtree is outside every shipped prefix and the duplicate path skips it;
 *  - the pending-key cleanup (`mockupCleanup.ts`): emptying a pending key clears its doc, originals
 *    and crops but keeps a stray younger than the grace; emptying a REAL project — or a pending
 *    alias whose R2 folder is a real project's (`sunken_temple` vs `sunken-temple`) — removes only
 *    the images; the age sweep clears old pending folders and keeps a fresh one, one a run names,
 *    a deleted project's and an existing project's; a project or run that commits while the
 *    cleanup waits for the lock is seen under it; an upload landing after the listing or just
 *    before the seal keeps the key; a seal refuses writers (409 `clearing`) until it lapses.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isHttpError, type Cookies } from '@sveltejs/kit';
import type { DirectorRun } from '../src/lib/server/db/schema.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const srcPath = (rel: string) => fileURLToPath(src(rel));
const EVAL = fileURLToPath(new URL('../../../docs/director/eval/mockups/', import.meta.url));

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

function exportNames(rel: string): string[] {
	const text = readFileSync(srcPath(rel), 'utf8');
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

// ── In-memory R2, bytes-capable, recording each write's precondition ──────────
type Obj = { body: Uint8Array; etag: string; contentType: string; mtime: number };
type Cond = { ifMatch?: string; ifNoneMatch?: string } | undefined;
const R2 = new Map<string, Obj>();
const writes: { key: string; cond: Cond }[] = [];
let etagSeq = 0;
let failNextDocPut = false;
class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
const text = (s: string) => new TextEncoder().encode(s);
function put(key: string, body: Uint8Array, contentType: string, cond: Cond): string {
	writes.push({ key, cond });
	const cur = R2.get(key);
	if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
	if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
	if (failNextDocPut && key.endsWith('mockups.json')) {
		failNextDocPut = false;
		// Someone else saved in between: the stored doc moves on and this write loses.
		R2.set(key, {
			body: cur?.body ?? body,
			etag: `"e${++etagSeq}"`,
			contentType,
			mtime: Date.now(),
		});
		throw new ConflictError(key);
	}
	const next = { body, etag: `"e${++etagSeq}"`, contentType, mtime: Date.now() };
	R2.set(key, next);
	return next.etag;
}
const keysUnder = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
/** Runs once right after the next recursive listing: something landing between it and the seal. */
let afterNextList: (() => Promise<void>) | null = null;
fake('lib/server/r2.ts', {
	ConflictError,
	precondition: (base: string | null | undefined) =>
		base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
	getObjectBytes: async (key: string) => {
		const o = R2.get(key);
		return o ? { body: o.body, etag: o.etag, contentType: o.contentType } : null;
	},
	getObjectText: async (key: string) => {
		const o = R2.get(key);
		return o ? new TextDecoder().decode(o.body) : null;
	},
	getObjectTextWithEtag: async (key: string) => {
		const o = R2.get(key);
		return o ? { text: new TextDecoder().decode(o.body), etag: o.etag } : null;
	},
	putObjectText: async (key: string, s: string, type: string, cond?: Cond) =>
		put(key, text(s), type, cond),
	putObjectBytes: async (key: string, body: Uint8Array, type: string, cond?: Cond) =>
		put(key, body, type, cond),
	deleteObject: async (key: string) => void R2.delete(key),
	deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
	objectExists: async (key: string) => R2.has(key),
	listAllKeys: async (prefix: string) => keysUnder(prefix),
	listObjects: async (prefix: string) => ({ keys: keysUnder(prefix), prefixes: [] }),
	listAllObjects: async (prefix: string) => {
		const listed = keysUnder(prefix).map((key) => {
			const o = R2.get(key)!;
			return { key, size: o.body.length, lastModified: o.mtime, etag: o.etag.replace(/"/g, '') };
		});
		const hook = afterNextList;
		afterNextList = null;
		await hook?.();
		return listed;
	},
	listFolder: async (prefix: string) => ({
		files: [],
		folders: [...new Set(keysUnder(prefix).map((k) => k.slice(prefix.length).split('/')[0]))].map(
			(seg) => `${prefix}${seg}/`,
		),
	}),
	copyObject: async (from: string, to: string) => {
		const o = R2.get(from);
		if (!o) return false;
		R2.set(to, { ...o });
		return true;
	},
});

// ── Postgres-backed modules ───────────────────────────────────────────────────
const PROJECTS = new Map<string, string | null>([
	['cloud', null],
	['sunken-temple', 'acme'],
	['other-game', 'other'],
]);
/** Soft-deleted projects → their client. */
const DELETED = new Map<string, string | null>([['deleted-game', 'acme']]);
/** userId → client keys granted (admins reach everything). */
const GRANTS = new Map<string, Set<string>>([['art', new Set(['acme'])]]);
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	listProjects: async () => (
		poolRead('listProjects'),
		[...PROJECTS.keys()].map((key) => ({ key }))
	),
	listDeletedProjects: async () => (
		poolRead('listDeletedProjects'),
		[...DELETED.keys()].map((key) => ({ key }))
	),
	projectInFolder: async (
		folder: string,
		{ client, db }: { client?: string; db?: unknown } = {},
	) => {
		folderReads.push({ folder, client });
		txRead('projectInFolder', db);
		const holders = [...PROJECTS, ...DELETED]
			.filter(([key]) => slug(key) === folder)
			.filter(([, owner]) => client === undefined || slug(owner ?? 'unassigned') === slug(client))
			.map(([key]) => key)
			.sort();
		return holders[0] ?? null;
	},
	canAccessProject: async (userId: string, role: string, key: string) => {
		if (!PROJECTS.has(key)) return false;
		if (role === 'admin') return true;
		const client = PROJECTS.get(key);
		return client !== null && (GRANTS.get(userId)?.has(client!) ?? false);
	},
	projectClientKey: async (key: string) => PROJECTS.get(key) ?? null,
	projectExists: async (key: string) => PROJECTS.has(key),
	projectKeyTaken: async (key: string) => PROJECTS.has(key) || DELETED.has(key),
	isValidProjectKey: (value: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),
});
fake('lib/server/clients.ts', {
	listClients: async () => [{ key: 'acme' }, { key: 'other' }],
	clientExists: async (key: string) => ['acme', 'other'].includes(key),
	mayCreateUnderClient: async (userId: string, role: string, client: string | null) =>
		role === 'admin' || client === null || (GRANTS.get(userId)?.has(client) ?? false),
});
fake('lib/server/roleToolAccess.ts', { getRoleOverrides: async () => ({}) });
fake('lib/server/userToolAccess.ts', { getToolOverrides: async () => ({}) });
fake('lib/server/auth.ts', { SESSION_COOKIE: 'iw_session' });
const RUN: DirectorRun = {
	id: 'run-1',
	projectKey: 'sunken-temple',
	clientKey: 'acme',
	templateProjectKey: 'hw-3pots-sample',
	ownerUserId: 'owner',
	startingPointJson: {},
	checkpointsJson: {},
	status: 'running',
	step: 'breakdown',
	waitingOn: null,
	budgetCapUsd: null,
	leaseHolder: null,
	leaseUntil: null,
	projectCreateStartedAt: null,
	templateConfigEtag: null,
	projectConfigEtag: null,
	createdAt: new Date('2026-10-05T00:00:00Z'),
	updatedAt: new Date('2026-10-05T00:00:00Z'),
};
/** Project keys a Director run names. */
const RUN_KEYS = new Set<string>([RUN.projectKey]);
fake('lib/server/director/store.ts', {
	getRun: async (id: string) => (id === RUN.id ? RUN : null),
	listRunProjectKeys: async () => (poolRead('listRunProjectKeys'), [...RUN_KEYS]),
	runInFolder: async (folder: string, db: unknown) => (
		txRead('runInFolder', db),
		[...RUN_KEYS].some((key) => slug(key) === folder)
	),
});
/** Every `projectInFolder` question: the folder and the client it was limited to. */
const folderReads: { folder: string; client: string | undefined }[] = [];
/** `r2Slug`, which the real lock keys on (the fakes load before `projectPaths.ts` may). */
const slug = (key: string) =>
	key
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60);
/** Folders whose lock is held now; `onLock` runs as it is granted (what committed meanwhile). */
const LOCKED = new Set<string>();
let onLock: ((folder: string) => void) | null = null;
/** Every folder locked, in order. */
const lockCalls: string[] = [];
/** The transaction the held lock hands its callback; queries inside the lock must run on it. */
const TX = { lockTx: true };
/** Queries that took a second pool connection while a lock was held, or ran on the wrong handle. */
const dbMisuse: string[] = [];
function poolRead(name: string): void {
	if (LOCKED.size > 0) dbMisuse.push(`${name} on the pool inside the lock`);
}
function txRead(name: string, db: unknown): void {
	if (LOCKED.size > 0 && db !== TX) dbMisuse.push(`${name} not on the lock's tx`);
}
fake('lib/server/projectKeyLock.ts', {
	withProjectKeyLock: async <T>(
		projectKey: string,
		fn: (tx: unknown) => Promise<T>,
	): Promise<T> => {
		const key = slug(projectKey);
		if (LOCKED.has(key)) throw new Error(`fixture: ${key} is already locked`);
		LOCKED.add(key);
		lockCalls.push(key);
		onLock?.(key);
		try {
			return await fn(TX);
		} finally {
			LOCKED.delete(key);
		}
	},
});

const sharp = (await import('sharp')).default;
const mockups = await import(src('lib/server/director/mockups.ts'));
const pixels = await import(src('lib/server/director/mockupPixels.ts'));
const ops = await import(src('lib/server/director/ops/mockups.ts'));
const { refusedWriteTarget } = await import(src('lib/server/director/refusals.ts'));
const { allowedPrefixes, isKeyAllowed } = await import(src('lib/server/toolScope.ts'));
const { FOLDER_TAKEN_WORDS, SUB } = await import(src('lib/server/projectPaths.ts'));
const { planDuplicate } = await import(src('lib/server/projectDuplicate.ts'));
const route = await import(src('routes/api/director/mockups/+server.ts'));
const imageRoute = await import(src('routes/api/director/mockups/image/+server.ts'));

const C = 'acme';
const P = 'sunken-temple';
const by = { uid: 'owner', name: 'Owner' };
const basePng = new Uint8Array(readFileSync(`${EVAL}base-game.png`));
const styleJpg = new Uint8Array(readFileSync(`${EVAL}style-reference.jpg`));
const status = (e: unknown) =>
	e instanceof mockups.MockupError ? e.status : isHttpError(e) ? e.status : e;
async function refused(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
		return 'no refusal';
	} catch (e) {
		return status(e);
	}
}
const add = (bytes: Uint8Array, tag: unknown = 'Base game', styleOnly = false) =>
	mockups.addMockup({ client: C, project: P, bytes, tag, styleOnly, by });

// ── Limits and types ──────────────────────────────────────────────────────────
console.log('limits');
check('sniff: PNG', mockups.sniffImage(basePng), 'png');
check('sniff: JPG', mockups.sniffImage(styleJpg), 'jpg');
check('sniff: GIF is not accepted', mockups.sniffImage(text('GIF89a....')), null);
check('sniff: text is not accepted', mockups.sniffImage(text('<svg/>')), null);
check(
	'sniff: WebP is not accepted as a mockup, though the run image route serves it',
	[
		mockups.sniffImage(text('RIFF\0\0\0\0WEBPVP8 ')),
		mockups.sniffServedImage(text('RIFF\0\0\0\0WEBPVP8 ')),
	],
	[null, 'webp'],
);
check('a GIF upload is 415', await refused(() => add(text('GIF89a........'))), 415);
check('a WebP upload is 415', await refused(() => add(text('RIFF\0\0\0\0WEBPVP8 '))), 415);
check('an empty file is 400', await refused(() => add(new Uint8Array())), 400);
check('a missing tag is 400', await refused(() => add(basePng, '')), 400);
check('a 61-character tag is 400', await refused(() => add(basePng, 'x'.repeat(61))), 400);
{
	const big = new Uint8Array(mockups.MAX_MOCKUP_BYTES + 1);
	big.set(basePng.subarray(0, 8));
	check('a file over 20 MB is 413', await refused(() => add(big)), 413);
	check('…and 20 MB exactly is not refused for size', mockups.MAX_MOCKUP_BYTES, 20 * 1024 * 1024);
}
check('nothing was written by refused uploads', keysUnder(`${SUB.director(C, P)}/`), []);

// ── Storage: create-only originals, CAS doc ───────────────────────────────────
console.log('storage');
writes.length = 0;
const first = await add(basePng);
check('the first upload is recorded', first.doc.images.length, 1);
const img = first.doc.images[0];
check(
	'the image is measured',
	[img.w, img.h, img.mediaType, img.bytes],
	[1280, 800, 'image/png', basePng.length],
);
check('the id is 16 hex chars', mockups.isUploadId(img.id), true);
check('the file is <id>.<ext>', img.file, `${img.id}.png`);
check(
	'tag, styleOnly and the stamp are kept',
	[img.tag, img.styleOnly, img.uploadedBy],
	['Base game', false, by],
);
check(
	'the original is written create-only',
	writes.find((w) => w.key === mockups.mockupImageKey(C, P, img.file))?.cond,
	{ ifNoneMatch: '*' },
);
check(
	'the doc is created with If-None-Match',
	writes.find((w) => w.key.endsWith('mockups.json'))?.cond,
	{
		ifNoneMatch: '*',
	},
);
writes.length = 0;
const docEtagAfterFirst = R2.get(mockups.mockupsDocKey(C, P))!.etag;
const second = await add(styleJpg, 'ignored', true);
check('a style reference is tagged `style`', second.doc.images[1].tag, 'style');
check(
	'the second save is a CAS on the doc etag',
	writes.find((w) => w.key.endsWith('mockups.json'))?.cond,
	{
		ifMatch: docEtagAfterFirst,
	},
);
{
	// A lost CAS re-reads and re-applies: the second author's image survives alongside ours.
	failNextDocPut = true;
	const before = (await mockups.loadMockupsDoc(C, P)).doc.images.length;
	const { doc } = await add(basePng, 'Paytable');
	check('a lost CAS is retried and the upload lands', doc.images.length, before + 1);
	check(
		'…with every earlier image still listed',
		doc.images.map((i) => i.tag),
		['Base game', 'style', 'Paytable'],
	);
}
{
	let doc = (await mockups.loadMockupsDoc(C, P)).doc;
	while (doc.images.length < mockups.MAX_MOCKUPS)
		doc = (await add(basePng, `Screen ${doc.images.length}`)).doc;
	check('12 mockups are accepted', doc.images.length, 12);
	check('the 13th is 409', await refused(() => add(basePng, 'Thirteen')), 409);
	check('…and leaves no orphan object', keysUnder(`${SUB.director(C, P)}/mockups/`).length, 12);
	const removed = await mockups.removeMockup(C, P, doc.images[11].id);
	check('remove drops the entry', removed.images.length, 11);
	check('…and the object', R2.has(mockups.mockupImageKey(C, P, doc.images[11].file)), false);
	check(
		'removing an unknown id is 404',
		await refused(() => mockups.removeMockup(C, P, 'ffffffffffffffff')),
		404,
	);
}

// ── Ownership ─────────────────────────────────────────────────────────────────
console.log('ownership');
{
	const { doc } = await mockups.loadMockupsDoc(C, P);
	check('mockups without the check refuse a start', typeof mockups.ownershipRefusal(doc), 'string');
	check('no mockups need no check', mockups.ownershipRefusal(mockups.emptyMockupsDoc()), null);
	check('no doc needs no check', mockups.ownershipRefusal(null), null);
	const confirmed = await mockups.confirmOwnership(C, P, by);
	check('the check records who', confirmed.ownershipConfirmed?.by, by);
	check('…and when', typeof confirmed.ownershipConfirmed?.at, 'string');
	check('a checked doc may start', mockups.ownershipRefusal(confirmed), null);
	const retagged = await mockups.setMockupTag(C, P, doc.images[0].id, 'Hold and Win bonus', false);
	check(
		'a retag changes the tag and keeps the check',
		[retagged.images[0].tag, retagged.images[0].styleOnly, retagged.ownershipConfirmed?.by],
		['Hold and Win bonus', false, by],
	);
	const asStyle = await mockups.setMockupTag(C, P, doc.images[0].id, 'ignored', true);
	check('a retag to style-only is tagged `style`', asStyle.images[0].tag, 'style');
	await mockups.setMockupTag(C, P, doc.images[0].id, 'Base game', false);
	check(
		'a retag with a blank tag is 400',
		await refused(() => mockups.setMockupTag(C, P, doc.images[0].id, '', false)),
		400,
	);
	check(
		'a retag of an unknown id is 404',
		await refused(() => mockups.setMockupTag(C, P, 'ffffffffffffffff', 'Base game', false)),
		404,
	);
	const afterUpload = await add(basePng, 'Added later');
	check('a new upload clears the check', afterUpload.doc.ownershipConfirmed, null);
	check(
		'…so the run cannot start again',
		typeof mockups.ownershipRefusal(afterUpload.doc),
		'string',
	);
	await mockups.removeMockup(C, P, afterUpload.id);
	check(
		'a confirm on a doc with no images is 400',
		await refused(() => mockups.confirmOwnership(C, 'empty-key', by)),
		400,
	);
	check(
		'…and leaves no doc behind to hold the key',
		R2.has(mockups.mockupsDocKey(C, 'empty-key')),
		false,
	);
	{
		// The check goes with the last image: confirm, remove everything, and the key is anyone's.
		const { doc: lone } = await mockups.addMockup({
			client: C,
			project: 'lone-key',
			bytes: basePng,
			tag: 'Base game',
			styleOnly: false,
			by,
		});
		const held = await mockups.confirmOwnership(C, 'lone-key', by);
		check(
			'the check holds the key for its uploader',
			mockups.pendingDocOwnedBy(held, 'other'),
			false,
		);
		const freed = await mockups.removeMockup(C, 'lone-key', lone.images[0].id);
		check(
			'removing the last image clears the check and frees the key',
			[freed.ownershipConfirmed, mockups.pendingDocOwnedBy(freed, 'other')],
			[null, true],
		);
	}
	const reconfirmed = await mockups.confirmOwnership(C, P, by);
	const again = await mockups.confirmOwnership(C, P, { uid: 'later', name: 'Later' });
	check(
		'a second confirmation keeps the first',
		again.ownershipConfirmed,
		reconfirmed.ownershipConfirmed,
	);
	check('a bad fidelity is 400', await refused(() => mockups.setFidelity(C, P, 'loose')), 400);
	check('fidelity is stored', (await mockups.setFidelity(C, P, 'start')).fidelity, 'start');
}

// ── Pixels ────────────────────────────────────────────────────────────────────
console.log('pixels');
{
	const wide = new Uint8Array(
		await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#3FB68B' } })
			.png()
			.toBuffer(),
	);
	const model = await pixels.downscaleForModel(wide, 'image/png');
	check('a 3000 px image is downscaled to 1568 on the long edge', [model.w, model.h], [1568, 523]);
	check(
		'…with the scale reported',
		Math.round(model.scale * 10000) / 10000,
		Math.round((1568 / 3000) * 10000) / 10000,
	);
	check('…as the same media type', model.mediaType, 'image/png');
	const small = await pixels.downscaleForModel(basePng, 'image/png');
	check('an image that fits is passed through', [small.scale, small.bytes === basePng], [1, true]);
	check(
		'unscaleBox maps model pixels back',
		pixels.unscaleBox({ x: 784, y: 0, w: 100, h: 50 }, 1568 / 3000),
		{
			x: 1500,
			y: 0,
			w: 191,
			h: 96,
		},
	);
	check(
		'clampBox keeps the inside part',
		pixels.clampBox({ x: -10, y: 790, w: 50, h: 50 }, 1280, 800),
		{
			x: 0,
			y: 790,
			w: 40,
			h: 10,
		},
	);
	check(
		'clampBox refuses a box outside',
		pixels.clampBox({ x: 2000, y: 0, w: 5, h: 5 }, 1280, 800),
		null,
	);
	const crop = (await pixels.cropImage(basePng, { x: 440, y: 24, w: 400, h: 110 }))!;
	const meta = await sharp(crop).metadata();
	check('a crop is a PNG of the box', [meta.format, meta.width, meta.height], ['png', 400, 110]);
	const reference = JSON.parse(readFileSync(`${EVAL}reference.json`, 'utf8')) as {
		images: { file: string; dominantColors: unknown }[];
	};
	for (const ref of reference.images) {
		const bytes = new Uint8Array(readFileSync(`${EVAL}${ref.file}`));
		check(
			`dominant colours of ${ref.file} match reference.json`,
			await pixels.dominantColors(bytes),
			ref.dominantColors,
		);
	}
	check(
		'kmeans is deterministic',
		pixels.kmeans(
			[
				[0, 0, 0],
				[255, 255, 255],
				[250, 250, 250],
			],
			2,
		),
		[
			{ center: [253, 253, 253], share: 2 / 3 },
			{ center: [0, 0, 0], share: 1 / 3 },
		],
	);
}

// ── Adapters ──────────────────────────────────────────────────────────────────
console.log('adapters');
{
	const ctx = {
		run: RUN,
		owner: { id: 'owner', email: 'o@x', name: 'Owner', role: 'admin' as const },
		agent: 'worker' as const,
		scope: { clientKey: C, projectKey: P },
		savedBy: {
			uid: 'owner',
			name: 'Owner',
			tool: 'director' as const,
			agent: 'worker' as const,
			runId: RUN.id,
			at: '',
			rev: 'r',
		},
	};
	const listing = (await ops.listMockups.handler(ctx, {})) as {
		images: { id: string; styleOnly: boolean }[];
		ownershipConfirmed: unknown;
		modelLongEdge: number;
	};
	check(
		'list: every image, the check and the model edge',
		[listing.images.length, Boolean(listing.ownershipConfirmed), listing.modelLongEdge],
		[11, true, 1568],
	);
	const first = listing.images[0];
	const got = (await ops.getMockupImage.handler(ctx, { id: first.id })) as {
		base64: string;
		w: number;
		h: number;
		scale: number;
		dominantColors: { hex: string }[];
	};
	check(
		'get_image: the model copy with its scale and colours',
		[got.w, got.h, got.scale, got.dominantColors.length > 0],
		[1280, 800, 1, true],
	);
	check(
		'get_image: the bytes are the image',
		Buffer.from(got.base64, 'base64').length,
		basePng.length,
	);
	check(
		'get_image: unknown id is 404',
		await refused(() => ops.getMockupImage.handler(ctx, { id: 'ffffffffffffffff' })).then(
			(s) => (s as { status?: number }).status ?? s,
		),
		404,
	);

	const save = ops.saveCrops as {
		writes: (i: unknown, s: { clientKey: string; projectKey: string }) => string[];
		handler: typeof ops.saveCrops.handler;
	};
	const declared = save.writes({}, ctx.scope);
	check('save_crops declares the crops prefix', declared, [`${SUB.director(C, P)}/crops/`]);
	check(
		'…which the write guard allows',
		declared.map((k) => refusedWriteTarget(k)),
		[null],
	);
	check(
		'…inside the project',
		declared.every((k) => isKeyAllowed(k, allowedPrefixes(C, P))),
		true,
	);
	const result = (await save.handler(ctx, {
		crops: [
			{ imageId: first.id, region: 'Logo', box: { x: 440, y: 24, w: 400, h: 110 } },
			{ imageId: first.id, region: 'Nowhere', box: { x: 5000, y: 5000, w: 10, h: 10 } },
			{ imageId: 'ffffffffffffffff', region: 'Frame', box: { x: 0, y: 0, w: 10, h: 10 } },
		],
	})) as {
		saved: { region: string; key: string }[];
		skipped: { region: string; reason: string }[];
	};
	check(
		'save_crops: the inside box is saved',
		result.saved.map((s) => s.key),
		[mockups.cropKey(C, P, RUN.id, 'Logo')],
	);
	check(
		'save_crops: the others are skipped with a reason',
		result.skipped.map((s) => s.region),
		['Nowhere', 'Frame'],
	);
	const cropMeta = await sharp(R2.get(mockups.cropKey(C, P, RUN.id, 'Logo'))!.body).metadata();
	check(
		'the stored crop is the box from the original',
		[cropMeta.width, cropMeta.height],
		[400, 110],
	);
	const back = (await ops.getCrop.handler(ctx, { region: 'Logo' })) as {
		mediaType: string;
		base64: string;
	};
	check(
		'get_crop returns it',
		[back.mediaType, Buffer.from(back.base64, 'base64').length > 0],
		['image/png', true],
	);
	check(
		'get_crop: no crop is 404',
		await refused(() => ops.getCrop.handler(ctx, { region: 'Frame' })).then(
			(s) => (s as { status?: number }).status ?? s,
		),
		404,
	);
}

// ── Not shipped ───────────────────────────────────────────────────────────────
console.log('not shipped');
{
	const dir = `${SUB.director(C, P)}/`;
	check('director/ is not under deploy/', dir.startsWith(`${SUB.deploy(C, P)}/`), false);
	check('director/ is not under published/', dir.startsWith(`${SUB.published(C, P)}/`), false);
	check(
		'the mockups doc is not a forbidden write target',
		refusedWriteTarget(mockups.mockupsDocKey(C, P)),
		null,
	);
	const plan = await planDuplicate(
		{ clientKey: C, projectKey: P },
		{ clientKey: C, projectKey: 'copy' },
		'full',
	);
	check(
		'a full duplicate copies nothing under director/',
		plan.filter((e) => e.from.startsWith(dir)),
		[],
	);
	check('…while the bucket holds director/ objects', keysUnder(dir).length > 0, true);
}

// ── Route ─────────────────────────────────────────────────────────────────────
console.log('route');
{
	const cookies = { get: () => undefined } as unknown as Cookies;
	const call = async (
		method: 'GET' | 'POST',
		user: App.Locals['user'],
		project: string,
		form?: FormData,
	) => {
		const url = new URL(`http://x/api/director/mockups?project=${project}`);
		const request = new Request(url, { method, body: form });
		const handler = method === 'GET' ? route.GET : route.POST;
		try {
			const res = await handler({ request, url, locals: { user }, cookies, params: {} } as never);
			return { status: res.status, body: (await res.json()) as Record<string, unknown> };
		} catch (e) {
			return {
				status: status(e),
				body: isHttpError(e) ? ({ ...e.body } as Record<string, unknown>) : null,
			};
		}
	};
	const admin = { id: 'adm', email: 'a@x', name: 'Admin', role: 'admin' as const };
	const dev = { id: 'dev', email: 'd@x', name: 'Dev', role: 'developer' as const };
	check('GET without a session is 401', (await call('GET', null, P)).status, 401);
	check('GET without the director tool is 403', (await call('GET', dev, P)).status, 403);
	check(
		'GET on an inaccessible project is 403',
		(await call('GET', { ...admin, role: 'artist' as const }, P)).status,
		403,
	);
	// An unknown key is a PENDING project (the game the New-game form is about to create) when the
	// caller could create it; `project` is spliced into the query, so `&client=` rides along.
	const pending = await call('GET', admin, 'nope&client=acme');
	check(
		'GET on a creatable key is a pending project with an empty doc',
		[pending.status, pending.body!.pending, (pending.body!.doc as { images: unknown[] }).images],
		[200, true, []],
	);
	check(
		'GET on a key under a client the caller may not create under is 403',
		(await call('GET', { ...admin, role: 'artist' as const }, 'nope&client=acme')).status,
		403,
	);
	check('GET on a deleted key is 403', (await call('GET', admin, 'deleted-game')).status, 403);

	// OPEN_QUESTIONS 17: a free key whose R2 folder is a project's under the same client would read
	// and write that project's `director/` tree. It is a 409 that names the project, live or deleted.
	const aliasWrites = writes.length;
	const aliasGet = await call('GET', admin, 'sunken_temple&client=acme');
	check(
		'GET on a key whose folder is a live project’s is 409, not naming it',
		[aliasGet.status, aliasGet.body?.message],
		[409, FOLDER_TAKEN_WORDS],
	);
	check('…asked about that folder under the request’s client', folderReads.at(-1), {
		folder: 'sunken_temple',
		client: 'acme',
	});
	const aliasForm = new FormData();
	aliasForm.set('action', 'upload');
	aliasForm.set('tag', 'Base game');
	aliasForm.set('file', new File([basePng], 'alias.png', { type: 'image/png' }));
	const aliasPost = await call('POST', admin, 'sunken_temple&client=acme', aliasForm);
	check(
		'POST upload under the alias is 409',
		[aliasPost.status, aliasPost.body?.message],
		[409, FOLDER_TAKEN_WORDS],
	);
	check('…and writes nothing', writes.length, aliasWrites);
	const deletedAlias = await call('GET', admin, 'deleted_game&client=acme');
	check(
		'a key whose folder is a DELETED project’s is 409 too',
		[deletedAlias.status, deletedAlias.body?.message],
		[409, FOLDER_TAKEN_WORDS],
	);
	check(
		'the same slug under ANOTHER client is another folder: a pending key',
		[
			(await call('GET', admin, 'sunken_temple&client=other')).body?.pending,
			(await call('GET', admin, 'sunken_temple')).body?.pending,
		],
		[true, true],
	);
	check(
		'a key that is free and aliases nothing is still pending',
		(await call('GET', admin, 'sunken-temple-2&client=acme')).body?.pending,
		true,
	);
	check(
		'a client the caller may not create under stays the silent 403, before any folder check',
		(
			await call(
				'GET',
				{ id: 'art', email: 'r@x', name: 'Art', role: 'artist' as const },
				'other_game&client=other',
			)
		).status,
		403,
	);
	check('GET on a malformed key is 403', (await call('GET', admin, 'No%20Pe')).status, 403);
	const ok = await call('GET', admin, P);
	check(
		'GET answers the doc, the limits and no start refusal',
		[ok.status, (ok.body!.limits as { maxFiles: number }).maxFiles, ok.body!.startRefusal],
		[200, 12, null],
	);

	const form = new FormData();
	form.set('action', 'upload');
	form.set('tag', 'Bonus');
	form.set('file', new File([basePng], 'mockup.png', { type: 'image/png' }));
	const up = await call('POST', admin, 'other-game', form);
	check(
		'POST upload stores under the named project',
		[
			up.status,
			(up.body!.doc as { images: unknown[] }).images.length,
			typeof up.body!.startRefusal,
		],
		[200, 1, 'string'],
	);
	check(
		'…at the project’s own prefix',
		keysUnder(`${SUB.director('other', 'other-game')}/mockups/`).length,
		1,
	);
	const gif = new FormData();
	gif.set('action', 'upload');
	gif.set('tag', 'Bonus');
	gif.set('file', new File([text('GIF89a........')], 'x.gif', { type: 'image/png' }));
	const refusedGif = await call('POST', admin, 'other-game', gif);
	check(
		'POST upload of a GIF is 415 with the code',
		[refusedGif.status, refusedGif.body!.error],
		[415, 'not_an_image'],
	);
	const confirm = new FormData();
	confirm.set('action', 'confirm_ownership');
	const confirmed = await call('POST', admin, 'other-game', confirm);
	check(
		'POST confirm_ownership records the session user',
		[
			(confirmed.body!.doc as { ownershipConfirmed: { by: { uid: string } } }).ownershipConfirmed.by
				.uid,
			confirmed.body!.startRefusal,
		],
		['adm', null],
	);
	const retag = new FormData();
	retag.set('action', 'retag');
	retag.set('id', (up.body!.doc as { images: { id: string }[] }).images[0].id);
	retag.set('tag', 'Big win');
	const retagged = await call('POST', admin, 'other-game', retag);
	check(
		'POST retag changes the tag and leaves the check as it was',
		[
			retagged.status,
			(retagged.body!.doc as { images: { tag: string }[] }).images[0].tag,
			retagged.body!.startRefusal,
		],
		[200, 'Big win', null],
	);
	const bad = new FormData();
	bad.set('action', 'fidelity');
	bad.set('fidelity', 'loose');
	check(
		'POST a bad fidelity is 400 JSON',
		(await call('POST', admin, 'other-game', bad)).status,
		400,
	);
	const unknown = new FormData();
	unknown.set('action', 'explode');
	check(
		'POST an unknown action is 400',
		(await call('POST', admin, 'other-game', unknown)).status,
		400,
	);
	check(
		'POST without the tool is 403',
		(await call('POST', dev, 'other-game', confirm)).status,
		403,
	);

	// The image route: the same gate as the doc, the original bytes back.
	const image = async (user: App.Locals['user'], project: string, id: string) => {
		const url = new URL(`http://x/api/director/mockups/image?project=${project}&id=${id}`);
		try {
			const res = await imageRoute.GET({
				request: new Request(url),
				url,
				locals: { user },
				cookies,
				params: {},
			} as never);
			return {
				status: res.status,
				type: res.headers.get('content-type'),
				bytes: new Uint8Array(await res.arrayBuffer()),
			};
		} catch (e) {
			return { status: status(e), type: null, bytes: null };
		}
	};
	const uploaded = (up.body!.doc as { images: { id: string }[] }).images[0].id;
	check('image without a session is 401', (await image(null, 'other-game', uploaded)).status, 401);
	check(
		'image under a key aliasing a project’s folder is 409',
		(await image(admin, 'other_game&client=other', uploaded)).status,
		409,
	);
	check('image without the tool is 403', (await image(dev, 'other-game', uploaded)).status, 403);
	check(
		'image on an inaccessible project is 403',
		(await image({ ...admin, role: 'artist' as const }, 'other-game', uploaded)).status,
		403,
	);
	const got = await image(admin, 'other-game', uploaded);
	check(
		'image answers the original bytes with their type',
		[got.status, got.type, got.bytes!.length, got.bytes![0]],
		[200, 'image/png', basePng.length, basePng[0]],
	);
	check(
		'an id the doc does not list is 404',
		(await image(admin, 'other-game', 'ffffffffffffffff')).status,
		404,
	);
	check('a malformed id is 404', (await image(admin, 'other-game', '../x')).status, 404);
	check(
		'a pending project has no images, so any id is 404',
		(await image(admin, 'nope&client=acme', uploaded)).status,
		404,
	);
	R2.delete(mockups.mockupImageKey('other', 'other-game', `${uploaded}.png`));
	check(
		'a listed image whose object is gone is 404',
		(await image(admin, 'other-game', uploaded)).status,
		404,
	);

	// A pending key is whoever uploaded under it first: another user — even another admin, who
	// could create under the client — gets the inaccessible-project 403 on the doc, on every
	// action and on the image, until the images are gone.
	const other = { id: 'adm2', email: 'b@x', name: 'Other admin', role: 'admin' as const };
	const mine = new FormData();
	mine.set('action', 'upload');
	mine.set('tag', 'Base game');
	mine.set('file', new File([basePng], 'mine.png', { type: 'image/png' }));
	const staked = await call('POST', admin, 'pending-key&client=acme', mine);
	check('A uploads under a pending key', staked.status, 200);
	const stakedId = (staked.body!.doc as { images: { id: string }[] }).images[0].id;
	check(
		'B reading A’s pending key is 403',
		(await call('GET', other, 'pending-key&client=acme')).status,
		403,
	);
	for (const [label, form] of [
		['confirm_ownership', confirm],
		['upload', mine],
		['retag', retag],
		[
			'remove',
			(() => {
				const f = new FormData();
				f.set('action', 'remove');
				f.set('id', stakedId);
				return f;
			})(),
		],
	] as const) {
		check(
			`B’s ${label} on A’s pending key is 403`,
			(await call('POST', other, 'pending-key&client=acme', form)).status,
			403,
		);
	}
	check(
		'B reading A’s image is 403',
		(await image(other, 'pending-key&client=acme', stakedId)).status,
		403,
	);
	check('A still reads it', (await image(admin, 'pending-key&client=acme', stakedId)).status, 200);
	// Two first uploads that both passed the gate on the empty doc: the mutator re-checks on the
	// doc the CAS writes, so B's lands nowhere — not in the doc, not in R2 — and B's confirm, retag
	// and remove through the module are refused the same way.
	const objectsBefore = keysUnder(`${SUB.director('acme', 'pending-key')}/mockups/`).length;
	check(
		'B’s upload that raced A’s is 403 inside the write',
		await refused(() =>
			mockups.addMockup({
				client: 'acme',
				project: 'pending-key',
				bytes: basePng,
				tag: 'Base game',
				styleOnly: false,
				by: { uid: 'adm2', name: 'Other admin' },
				owner: 'adm2',
			}),
		),
		403,
	);
	check(
		'…and its image is neither listed nor left in R2',
		[
			(await mockups.loadMockupsDoc('acme', 'pending-key')).doc.images.length,
			keysUnder(`${SUB.director('acme', 'pending-key')}/mockups/`).length,
		],
		[1, objectsBefore],
	);
	check(
		'B’s confirm that raced A’s upload is 403 inside the write',
		await refused(() =>
			mockups.confirmOwnership('acme', 'pending-key', { uid: 'adm2', name: 'B' }, 'adm2'),
		),
		403,
	);
	check(
		'…the same for a retag and a remove',
		[
			await refused(() =>
				mockups.setMockupTag('acme', 'pending-key', stakedId, 'Big win', false, 'adm2'),
			),
			await refused(() => mockups.removeMockup('acme', 'pending-key', stakedId, 'adm2')),
		],
		[403, 403],
	);
	const confirmedByA = await call('POST', admin, 'pending-key&client=acme', confirm);
	check('A confirms the key', confirmedByA.body!.startRefusal, null);
	check(
		'B is still 403 after A’s confirm',
		(await call('GET', other, 'pending-key&client=acme')).status,
		403,
	);
	check(
		'…and A’s image is still there, untouched by B',
		(await call('GET', admin, 'pending-key&client=acme')).body!.doc.images,
		staked.body!.doc.images,
	);
	const gone = new FormData();
	gone.set('action', 'remove');
	gone.set('id', stakedId);
	await call('POST', admin, 'pending-key&client=acme', gone);
	const freedDoc = await call('GET', other, 'pending-key&client=acme');
	check(
		'once the images are gone the key is anyone’s again, confirm and all',
		[freedDoc.status, (freedDoc.body!.doc as { ownershipConfirmed: unknown }).ownershipConfirmed],
		[200, null],
	);
}

// ── Pending-key cleanup ───────────────────────────────────────────────────────
console.log('cleanup');
{
	const DAY = 24 * 60 * 60_000;
	const UNASSIGNED = 'unassigned';
	const now = Date.now();
	const cleanup = await import(src('lib/server/director/mockupCleanup.ts'));
	const admin = { id: 'adm', email: 'a@x', name: 'Admin', role: 'admin' as const };
	const cookies = { get: () => undefined } as unknown as Cookies;
	const post = async (project: string, form: FormData) => {
		const url = new URL(`http://x/api/director/mockups?project=${project}`);
		const request = new Request(url, { method: 'POST', body: form });
		const res = await route.POST({
			request,
			url,
			locals: { user: admin },
			cookies,
			params: {},
		} as never);
		return {
			status: res.status,
			body: (await res.json()) as { doc: { images: { id: string }[] } },
		};
	};
	const upload = (project: string) => {
		const f = new FormData();
		f.set('action', 'upload');
		f.set('tag', 'Base game');
		f.set('file', new File([basePng], 'base.png', { type: 'image/png' }));
		return post(project, f);
	};
	const remove = (project: string, id: string) => {
		const f = new FormData();
		f.set('action', 'remove');
		f.set('id', id);
		return post(project, f);
	};
	/** Back-date everything under a prefix, as if it was written `ageMs` ago. */
	const age = (prefix: string, ageMs: number) => {
		for (const k of keysUnder(prefix)) R2.get(k)!.mtime = now - ageMs;
	};
	const plant = (key: string, ageMs: number) => {
		put(key, basePng, 'image/png', undefined);
		R2.get(key)!.mtime = now - ageMs;
	};
	/** A pending key with two images, a crop and a stray original, all written `ageMs` ago. */
	const seed = async (client: string, project: string, ageMs: number) => {
		const one = await mockups.addMockup({
			client,
			project,
			bytes: basePng,
			tag: 'Base',
			styleOnly: false,
			by,
		});
		await mockups.addMockup({ client, project, bytes: styleJpg, tag: 'x', styleOnly: true, by });
		plant(mockups.cropKey(client, project, 'run-x', 'logo'), ageMs);
		plant(mockups.mockupImageKey(client, project, 'abcdefabcdefabcd.png'), ageMs);
		age(`${SUB.director(client, project)}/`, ageMs);
		return one.id;
	};
	const dir = (client: string, project: string) => `${SUB.director(client, project)}/`;

	// (a) The uploader removes the last image of a pending key: doc, originals, crops and old
	// strays go; a stray younger than the grace (an upload between its original and its CAS) stays.
	const k = 'emptied-key';
	const first = await upload(`${k}&client=acme`);
	const second = await upload(`${k}&client=acme`);
	plant(mockups.cropKey(C, k, 'run-old', 'logo'), 0);
	plant(mockups.mockupImageKey(C, k, '0123456789abcdef.png'), cleanup.STRAY_GRACE_MS + 1000);
	const inFlight = mockups.mockupImageKey(C, k, 'fedcba9876543210.png');
	plant(inFlight, 0);
	check('a pending key holds its doc, originals and a crop', keysUnder(dir(C, k)).length, 6);
	const firstId = first.body.doc.images[0].id;
	await remove(`${k}&client=acme`, firstId);
	check('removing one of two images clears nothing else', keysUnder(dir(C, k)).length, 5);
	await remove(`${k}&client=acme`, second.body.doc.images[1].id);
	check(
		'removing the last image of a pending key clears its doc, originals and crops',
		keysUnder(dir(C, k)),
		[inFlight],
	);
	check('…keeping only a stray younger than the grace', R2.has(inFlight), true);

	// The same on a REAL project removes the images and nothing else.
	const realCrop = mockups.cropKey(C, P, 'run-1', 'reel');
	plant(realCrop, 30 * DAY);
	plant(mockups.mockupImageKey(C, P, '00000000deadbeef.png'), 30 * DAY);
	const { doc: realDoc } = await mockups.loadMockupsDoc(C, P);
	const realOriginals = new Set(
		realDoc.images.map((img) => mockups.mockupImageKey(C, P, img.file)),
	);
	const realExpected = keysUnder(dir(C, P)).filter((key) => !realOriginals.has(key));
	for (const img of realDoc.images) await remove(P, img.id);
	check(
		'emptying a REAL project removes its originals and nothing more (doc, crop, stray stay)',
		[realDoc.images.length > 0, keysUnder(dir(C, P))],
		[true, realExpected],
	);
	check(
		'…and a direct clear of it refuses',
		await cleanup.clearPendingMockups(C, P, { olderThan: now }),
		{ cleared: false, reason: 'project_exists' },
	);
	// R2 folders are slugs: `sunken_temple` is not a project key, but it is the real project's
	// folder. The route refuses it now (above); an image one landed before that, and a direct clear
	// of the alias, must still clear nothing of the project's.
	const alias = 'sunken_temple';
	check('the alias shares the real project’s folder', dir(C, alias), dir(C, P));
	check(
		'the route refuses the alias',
		await post(`${alias}&client=acme`, new FormData()).catch(status),
		409,
	);
	await mockups.addMockup({
		client: C,
		project: alias,
		bytes: basePng,
		tag: 'x',
		styleOnly: false,
		by,
	});
	const aliasKeys = keysUnder(dir(C, P));
	check(
		'…and a direct clear of the alias refuses, removing nothing',
		[await cleanup.clearPendingMockups(C, alias, { olderThan: now }), keysUnder(dir(C, P))],
		[{ cleared: false, reason: 'project_exists' }, aliasKeys],
	);
	await seed(C, 'slug_run', 20 * DAY);
	RUN_KEYS.add('slug-run');
	const slugRunBefore = keysUnder(dir(C, 'slug_run'));
	check(
		'a run whose key slugs to the folder holds it too',
		[
			await cleanup.clearPendingMockups(C, 'slug_run', { olderThan: now - 14 * DAY, now }),
			keysUnder(dir(C, 'slug_run')),
		],
		[{ cleared: false, reason: 'run_exists' }, slugRunBefore],
	);

	// (b) The age sweep.
	await seed(C, 'old-pending', 20 * DAY);
	await seed(UNASSIGNED, 'loose-key', 20 * DAY);
	await seed(C, 'fresh-pending', 2 * DAY);
	await seed(C, 'old-with-run', 20 * DAY);
	RUN_KEYS.add('old-with-run');
	await seed(C, 'deleted-game', 20 * DAY);
	await seed(C, 'racing-key', 20 * DAY);
	await seed(C, 'run-racing-key', 20 * DAY);
	age(dir(C, P), 20 * DAY);
	const realKeys = keysUnder(dir(C, P));
	const kept = (project: string) => keysUnder(dir(C, project)).length;
	const keptBefore = Object.fromEntries(
		['fresh-pending', 'old-with-run', 'deleted-game', 'racing-key', 'run-racing-key'].map((p) => [
			p,
			kept(p),
		]),
	);
	// A project (or a run) that commits while the sweep waits for the key's lock is seen under it.
	onLock = (folder) => {
		if (folder === 'racing_key') PROJECTS.set('racing-key', 'acme');
		if (folder === 'run_racing_key') RUN_KEYS.add('run-racing-key');
	};
	// An object the listing gives no LastModified (0) is of unknown age: kept, so its folder is.
	await seed(C, 'unknown-age', 20 * DAY);
	R2.get(mockups.mockupImageKey(C, 'unknown-age', 'abcdefabcdefabcd.png'))!.mtime = 0;
	keptBefore['unknown-age'] = kept('unknown-age');
	lockCalls.length = 0;
	const report = await cleanup.sweepPendingMockups(14, now);
	onLock = null;
	check(
		'the sweep pre-filters outside the lock: only the old, run-less, project-less folders lock',
		[...lockCalls].sort(),
		['loose_key', 'old_pending', 'racing_key', 'run_racing_key'],
	);
	const where = (r: { client: string; project: string }) => `${r.client}/${r.project}`;
	// Keys other sections left behind are fresh; only the ones seeded here are asserted.
	const seeded = new Set(Object.keys(keptBefore).map(slug));
	check(
		'the sweep clears the old pending keys (doc, 2 originals, a crop, a stray each)',
		report.cleared.map((r: { client: string; project: string; deleted: number }) => [
			where(r),
			r.deleted,
		]),
		[
			[`${UNASSIGNED}/loose_key`, 5],
			[`${C}/old_pending`, 5],
		],
	);
	check(
		'…leaving nothing under them',
		[kept('old-pending'), keysUnder(dir(UNASSIGNED, 'loose-key')).length],
		[0, 0],
	);
	check(
		'…and reports what it kept and why',
		report.kept
			.filter((r: { project: string }) => seeded.has(r.project))
			.map((r: { client: string; project: string; reason: string }) => [where(r), r.reason]),
		[
			[`${C}/fresh_pending`, 'fresh'],
			[`${C}/old_with_run`, 'run_exists'],
			[`${C}/racing_key`, 'project_exists'],
			[`${C}/run_racing_key`, 'run_exists'],
			[`${C}/unknown_age`, 'fresh'],
		],
	);
	check(
		'fresh, with a run, deleted, or became a project or run under the lock: every object kept',
		Object.fromEntries(Object.keys(keptBefore).map((p) => [p, kept(p)])),
		keptBefore,
	);
	check(
		'an existing project’s old doc and objects are never touched',
		keysUnder(dir(C, P)),
		realKeys,
	);
	PROJECTS.delete('racing-key');

	// An upload landing between the listing and the seal: the doc names an original the listing
	// did not see, so the key is left whole.
	await seed(C, 'landing-key', 20 * DAY);
	afterNextList = async () => {
		await mockups.addMockup({
			client: C,
			project: 'landing-key',
			bytes: basePng,
			tag: 'Big win',
			styleOnly: false,
			by,
		});
	};
	const landingBefore = kept('landing-key') + 1;
	check(
		'an upload landing after the listing keeps the key',
		[
			await cleanup.clearPendingMockups(C, 'landing-key', { olderThan: now - 14 * DAY, now }),
			kept('landing-key'),
		],
		[{ cleared: false, reason: 'changed' }, landingBefore],
	);
	// …and one whose CAS lands just before the seal's: the seal loses, nothing is deleted.
	await seed(C, 'cas-key', 20 * DAY);
	const casBefore = kept('cas-key');
	failNextDocPut = true;
	check(
		'a doc saved just before the seal keeps the key',
		[
			await cleanup.clearPendingMockups(C, 'cas-key', { olderThan: now - 14 * DAY, now }),
			kept('cas-key'),
		],
		[{ cleared: false, reason: 'changed' }, casBefore],
	);
	// The emptied path refuses a doc that lists an image again.
	await seed(C, 'refilled-key', 0);
	const unknownStray = mockups.mockupImageKey(C, 'unknown-age', 'abcdefabcdefabcd.png');
	await mockups.removeMockup(
		C,
		'unknown-age',
		(await mockups.loadMockupsDoc(C, 'unknown-age')).doc.images[0].id,
	);
	await mockups.removeMockup(
		C,
		'unknown-age',
		(await mockups.loadMockupsDoc(C, 'unknown-age')).doc.images[0].id,
	);
	check(
		'the emptied-doc clear keeps a stray of unknown age, clearing the rest',
		[await cleanup.clearPendingMockups(C, 'unknown-age'), keysUnder(dir(C, 'unknown-age'))],
		[{ cleared: true, deleted: 2 }, [unknownStray]],
	);
	check(
		'every kept reason has words for the Admin banner',
		report.kept.every(
			(r: { reason: string }) => typeof cleanup.KEPT_REASON_WORDS[r.reason] === 'string',
		),
		true,
	);
	check(
		'the emptied-doc clear refuses a doc with images',
		await cleanup.clearPendingMockups(C, 'refilled-key'),
		{ cleared: false, reason: 'in_use' },
	);

	// A seal holds the doc against writers until the delete, then lapses.
	const sealedKey = 'sealed-key';
	await mockups.addMockup({
		client: C,
		project: sealedKey,
		bytes: basePng,
		tag: 'Base',
		styleOnly: false,
		by,
	});
	const { etag: sealEtag } = await mockups.loadMockupsDoc(C, sealedKey);
	check(
		'the seal is a CAS on the doc',
		await mockups.sealMockupsDoc(C, sealedKey, sealEtag!),
		true,
	);
	check('a stale ETag cannot seal', await mockups.sealMockupsDoc(C, sealedKey, '"stale"'), false);
	const sealedObjects = kept(sealedKey);
	check(
		'an upload onto a fresh seal is refused 409 clearing and leaves no object',
		[
			await mockups
				.addMockup({
					client: C,
					project: sealedKey,
					bytes: basePng,
					tag: 'Base',
					styleOnly: false,
					by,
				})
				.then(
					() => 'stored',
					(e: unknown) => (e instanceof mockups.MockupError ? [e.status, e.code] : String(e)),
				),
			kept(sealedKey),
		],
		[[409, 'clearing'], sealedObjects],
	);
	const docKey = mockups.mockupsDocKey(C, sealedKey);
	const lapsed = JSON.parse(new TextDecoder().decode(R2.get(docKey)!.body)) as Record<
		string,
		unknown
	>;
	lapsed.sealedAt = new Date(now - mockups.SEAL_HOLD_MS - 1000).toISOString();
	put(docKey, text(JSON.stringify(lapsed)), 'application/json', undefined);
	const relisted = await mockups.addMockup({
		client: C,
		project: sealedKey,
		bytes: basePng,
		tag: 'Base',
		styleOnly: false,
		by,
	});
	check(
		'a lapsed seal (a cleanup that died) is an ordinary empty doc again',
		relisted.doc.images.length,
		1,
	);
}

check(
	'inside the lock every query ran on its tx — never a second pool connection',
	[lockCalls.length > 0, dbMisuse],
	[true, []],
);

console.log(`director-mockups: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
