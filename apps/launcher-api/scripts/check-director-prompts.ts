/**
 * Contract check for Invisible Director's saved prompts (the New game screen's Notes library):
 *   pnpm --filter launcher-api check:director-prompts
 *
 * Runs the REAL `director/prompts.ts` through the same scenarios twice: over an in-memory store that
 * evaluates the store contract (case-insensitive unique name per client, conditional on version),
 * and — when `DATABASE_URL` points at a throwaway Postgres — over the shipped Drizzle store, after
 * applying the committed migrations. CI's Lint job has no database, so it runs the memory pass only;
 * run the other one locally (`DATABASE_URL=postgres://… pnpm --filter launcher-api check:director-prompts`).
 * Only `db/index.ts` is replaced (to point Drizzle at that database).
 *
 * Pinned:
 *  - a caller sees, creates, edits and deletes prompts only for clients they may target
 *    (`mayTargetClient`): a hidden client's prompts are never listed, and read, change and delete
 *    answer the same 404 as an unknown id, writing nothing;
 *  - the name is trimmed, required and at most 80 characters; the body is required and capped at
 *    `MAX_NOTES_LENGTH`, the length a run's notes accept (imported by `runs.ts` from the same module);
 *  - a duplicate name for a client (ignoring case) is 409 `name_taken`, on create and on rename or
 *    move, and the same name under another client is fine;
 *  - a stale version on update or delete is 409 `conflict` and writes nothing; a good one bumps it;
 *  - a client change on update is access-checked for the NEW client (403, nothing written) and must
 *    exist (400);
 *  - the three route files are session-gated on `director` and `api.ts` maps `PromptError`.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema.ts';
import type { DirectorPrompt } from '../src/lib/server/db/schema.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const srcText = (rel: string) => readFileSync(fileURLToPath(src(rel)), 'utf8');

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

const DATABASE_URL = process.env.DATABASE_URL;
const sql = DATABASE_URL ? postgres(DATABASE_URL, { max: 1, onnotice: () => {} }) : null;
const pgDb = sql ? drizzle(sql, { schema }) : null;
mock.module(src('lib/server/db/index.ts'), {
	namedExports: {
		schema,
		getDb: () => {
			if (!pgDb) throw new Error('fixture: no database in the memory pass');
			return pgDb;
		},
	},
});

const { MAX_NOTES_LENGTH } = await import(src('lib/server/director/notesLimit.ts'));
const prompts = await import(src('lib/server/director/prompts.ts'));
const { PromptError } = prompts;
type PromptStore = import('../src/lib/server/director/prompts.ts').PromptStore;
type PromptCaller = import('../src/lib/server/director/prompts.ts').PromptCaller;

// ── The memory store ──────────────────────────────────────────────────────────
function memoryStore(): PromptStore {
	const rows = new Map<string, DirectorPrompt>();
	let seq = 0;
	const taken = (client: string, name: string, except?: string) =>
		[...rows.values()].some(
			(r) =>
				r.id !== except && r.clientKey === client && r.name.toLowerCase() === name.toLowerCase(),
		);
	return {
		list: async () => [...rows.values()].map((r) => ({ ...r })),
		get: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
		insert: async (row) => {
			if (taken(row.clientKey, row.name)) return 'name_taken';
			const made: DirectorPrompt = {
				...row,
				id: `p${++seq}`,
				createdAt: new Date(),
				updatedAt: new Date(),
				version: 1,
			};
			rows.set(made.id, made);
			return { ...made };
		},
		update: async (id, version, patch, userId) => {
			const cur = rows.get(id);
			if (!cur || cur.version !== version) return 'stale';
			const next = { ...cur, ...patch };
			if (taken(next.clientKey, next.name, id)) return 'name_taken';
			const saved = {
				...next,
				updatedByUserId: userId,
				updatedAt: new Date(),
				version: cur.version + 1,
			};
			rows.set(id, saved);
			return { ...saved };
		},
		remove: async (id, version) => {
			if (rows.get(id)?.version !== version) return false;
			return rows.delete(id);
		},
	};
}

async function asRefusal(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
		return 'ok';
	} catch (e) {
		if (e instanceof PromptError) return `${e.status} ${e.code}`;
		throw e;
	}
}

const admin: PromptCaller = {
	id: 'u-admin',
	role: 'admin',
	grants: [],
	clientKeys: ['acme', 'other'],
};
const artist: PromptCaller = {
	id: 'u-artist',
	role: 'artist',
	grants: ['acme'],
	clientKeys: ['acme', 'other'],
};
const outsider: PromptCaller = {
	id: 'u-out',
	role: 'artist',
	grants: [],
	clientKeys: ['acme', 'other'],
};

async function scenarios(pass: string, store: PromptStore): Promise<void> {
	const L = (s: string) => `${pass}: ${s}`;
	const snapshot = async () => JSON.stringify(await store.list());

	// Validation and caps.
	const base = { clientKey: 'acme', name: 'Ocean', body: 'Cartoon sea' };
	const create = (caller: PromptCaller, over: Record<string, unknown>) =>
		asRefusal(() => prompts.createPrompt(caller, { ...base, ...over }, store));
	check(L('empty name'), await create(artist, { name: '   ' }), '400 name_required');
	check(L('non-string name'), await create(artist, { name: 5 }), '400 name_required');
	check(L('name at 81'), await create(artist, { name: 'x'.repeat(81) }), '400 name_too_long');
	check(L('empty body'), await create(artist, { body: ' ' }), '400 body_required');
	check(
		L('body over the notes cap'),
		await create(artist, { body: 'x'.repeat(MAX_NOTES_LENGTH + 1) }),
		'400 body_too_long',
	);
	check(L('no client'), await create(artist, { clientKey: undefined }), '400 client_required');
	check(L('unknown client'), await create(admin, { clientKey: 'nope' }), '400 unknown_client');
	check(L('ungranted client'), await create(outsider, {}), '403 client_forbidden');
	check(L('nothing written by refusals'), await snapshot(), '[]');
	check(L('body cap is the run notes cap'), prompts.MAX_PROMPT_BODY_LENGTH, MAX_NOTES_LENGTH);

	const ocean = await prompts.createPrompt(
		artist,
		{ ...base, name: '  Ocean  ', body: 'x'.repeat(MAX_NOTES_LENGTH) },
		store,
	);
	check(
		L('name trimmed, version 1, body at the cap kept'),
		[ocean.name, ocean.version, ocean.body.length],
		['Ocean', 1, MAX_NOTES_LENGTH],
	);
	check(L('name at 80 accepted'), await create(artist, { name: 'y'.repeat(80) }), 'ok');
	check(
		L('unassigned is open to all'),
		await create(outsider, { clientKey: 'unassigned', name: 'U' }),
		'ok',
	);

	// Duplicate names, per client and ignoring case.
	check(L('same name, other case'), await create(artist, { name: 'OCEAN' }), '409 name_taken');
	check(
		L('same name, other client'),
		await create(admin, { clientKey: 'other', name: 'ocean' }),
		'ok',
	);

	// Access: the hidden client's prompts are never returned or touched.
	const hidden = (await prompts.listPrompts(admin, store)).find(
		(p: { clientKey: string }) => p.clientKey === 'other',
	)!;
	const names = async (c: PromptCaller) =>
		(await prompts.listPrompts(c, store)).map(
			(p: { clientKey: string; name: string }) => `${p.clientKey}/${p.name}`,
		);
	check(
		L('admin sees every client'),
		(await names(admin)).sort(),
		['acme/Ocean', `acme/${'y'.repeat(80)}`, 'other/ocean', 'unassigned/U'].sort(),
	);
	check(
		L('granted user: no hidden client'),
		(await names(artist)).sort(),
		['acme/Ocean', `acme/${'y'.repeat(80)}`, 'unassigned/U'].sort(),
	);
	check(L('user with no grants: unassigned only'), await names(outsider), ['unassigned/U']);
	const before = await snapshot();
	check(
		L('patch a hidden prompt is a 404'),
		await asRefusal(() =>
			prompts.updatePrompt(artist, hidden.id, { body: 'x', version: hidden.version }, store),
		),
		'404 not_found',
	);
	check(
		L('delete a hidden prompt is a 404'),
		await asRefusal(() => prompts.deletePrompt(artist, hidden.id, hidden.version, store)),
		'404 not_found',
	);
	check(
		L('unknown id is the same 404'),
		await asRefusal(() => prompts.deletePrompt(artist, 'missing', 1, store)),
		'404 not_found',
	);
	check(L('hidden prompt untouched'), await snapshot(), before);

	// Update: versions and client changes.
	const patch = (caller: PromptCaller, id: string, over: Record<string, unknown>) =>
		asRefusal(() => prompts.updatePrompt(caller, id, over as { version: unknown }, store));
	check(L('no version'), await patch(artist, ocean.id, { body: 'x' }), '400 version_required');
	check(
		L('nothing to change'),
		await patch(artist, ocean.id, { version: 1 }),
		'400 nothing_to_change',
	);
	check(
		L('empty body on patch'),
		await patch(artist, ocean.id, { body: '', version: 1 }),
		'400 body_required',
	);
	const edited = await prompts.updatePrompt(
		artist,
		ocean.id,
		{ body: 'Calmer sea', version: 1 },
		store,
	);
	check(
		L('good update bumps the version'),
		[edited.body, edited.version, edited.name],
		['Calmer sea', 2, 'Ocean'],
	);
	const stale = await snapshot();
	check(
		L('stale version is a 409 conflict'),
		await patch(artist, ocean.id, { body: 'Lost write', version: 1 }),
		'409 conflict',
	);
	check(L('stale version wrote nothing'), await snapshot(), stale);
	check(
		L('move to a client the caller cannot target'),
		await patch(artist, ocean.id, { clientKey: 'other', version: 2 }),
		'403 client_forbidden',
	);
	check(
		L('move to an unknown client'),
		await patch(admin, ocean.id, { clientKey: 'nope', version: 2 }),
		'400 unknown_client',
	);
	check(L('refused moves wrote nothing'), await snapshot(), stale);
	check(
		L('move into a client that has the name'),
		await patch(admin, ocean.id, { clientKey: 'other', version: 2 }),
		'409 name_taken',
	);
	check(
		L('rename onto another, ignoring case'),
		await patch(artist, ocean.id, { name: `${'Y'.repeat(80)}`, version: 2 }),
		'409 name_taken',
	);
	check(L('failed renames wrote nothing'), await snapshot(), stale);
	const moved = await prompts.updatePrompt(
		artist,
		ocean.id,
		{ clientKey: 'unassigned', name: 'Ocean reused', version: 2 },
		store,
	);
	check(
		L('move and rename'),
		[moved.clientKey, moved.name, moved.version],
		['unassigned', 'Ocean reused', 3],
	);
	check(
		L('moved prompt is visible to the outsider'),
		(await names(outsider)).includes('unassigned/Ocean reused'),
		true,
	);

	// Delete.
	check(
		L('delete without a version'),
		await asRefusal(() => prompts.deletePrompt(artist, moved.id, null, store)),
		'400 version_required',
	);
	check(
		L('delete with a junk version'),
		await asRefusal(() => prompts.deletePrompt(artist, moved.id, 'abc', store)),
		'400 version_required',
	);
	const beforeDelete = await snapshot();
	check(
		L('stale delete is a 409 conflict'),
		await asRefusal(() => prompts.deletePrompt(artist, moved.id, '2', store)),
		'409 conflict',
	);
	check(L('stale delete wrote nothing'), await snapshot(), beforeDelete);
	check(
		L('delete'),
		await asRefusal(() => prompts.deletePrompt(artist, moved.id, '3', store)),
		'ok',
	);
	check(L('deleted is gone'), (await names(artist)).includes('unassigned/Ocean reused'), false);
	check(
		L('deleting again is a 404'),
		await asRefusal(() => prompts.deletePrompt(artist, moved.id, '3', store)),
		'404 not_found',
	);
}

await scenarios('memory', memoryStore());

if (sql) {
	await migrate(pgDb!, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
	await sql`delete from director_prompts`;
	for (const id of ['u-admin', 'u-artist', 'u-out']) {
		await sql`insert into users (id, email) values (${id}, ${`${id}@test.invalid`}) on conflict do nothing`;
	}
	await scenarios('postgres', prompts.pgPromptStore);
	const made = await prompts.createPrompt(
		artist,
		{ clientKey: 'acme', name: 'Audit', body: 'a' },
		prompts.pgPromptStore,
	);
	await prompts.updatePrompt(admin, made.id, { body: 'b', version: 1 }, prompts.pgPromptStore);
	const [audit] =
		await sql`select created_by_user_id as c, updated_by_user_id as u, version as v from director_prompts where id = ${made.id}`;
	check(
		'postgres: created by one user, last edited by another',
		[audit.c, audit.u, audit.v],
		['u-artist', 'u-admin', 2],
	);
	await sql`delete from director_prompts`;
	await sql.end();
} else {
	console.log('check:director-prompts — DATABASE_URL not set: the Postgres pass was skipped');
}

// ── Source pins ───────────────────────────────────────────────────────────────
check(
	'runs.ts takes its notes cap from notesLimit',
	/from '\.\/notesLimit'/.test(srcText('lib/server/director/runs.ts')),
	true,
);
check(
	'runs.ts does not redefine the cap',
	/MAX_NOTES_LENGTH = /.test(srcText('lib/server/director/runs.ts')),
	false,
);
for (const route of [
	'routes/api/director/prompts/+server.ts',
	'routes/api/director/prompts/[id]/+server.ts',
]) {
	const text = srcText(route);
	const handlers = [...text.matchAll(/^export const (GET|POST|PATCH|DELETE)\b/gm)].length;
	const gates = [...text.matchAll(/await requireDirectorAccess\(locals\)/g)].length;
	check(`${route}: every handler is session-gated`, [handlers > 0, gates], [true, handlers]);
}
check(
	'api.ts answers a PromptError',
	/e instanceof PromptError/.test(srcText('lib/server/director/api.ts')),
	true,
);

console.log(`check:director-prompts — ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
