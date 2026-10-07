/**
 * Contract check for `createProject` (`projects.ts`), and `assignProjectToClient` below — the one insert behind Game Maker's create,
 * Admin › Projects, the desktop launcher's project sync and the duplicate (Game Maker's and the
 * Director's) — on the folder rule of OPEN_QUESTIONS 17:
 *   pnpm --filter launcher-api check:project-create
 *
 * A project's R2 folder is `r2Slug(key)` under `r2Slug(client)`, so `my_game` next to `my-game`
 * would read and write the same tree. `createProject` refuses a key whose folder already holds a
 * project under that client, live or soft-deleted, with `ProjectFolderTakenError` naming it; it
 * checks under the per-folder advisory lock (`withProjectKeyLock`), on the lock's transaction, so
 * of two racing aliases exactly one lands. `assignProjectToClient` (Admin's re-assign, the desktop
 * sync's client change) holds the same lock and refuses moving a project into such a folder.
 *
 * Runs the REAL `projects.ts` and `projectKeyLock.ts` and the SQL they build. Only the database is
 * replaced: `getDb()` is a drizzle `pg-proxy` client over an in-memory `projects` table that takes
 * the advisory lock for real (a per-key queue held until the transaction ends), stages a
 * transaction's inserts until it commits, and answers the statements `createProject` sends —
 * anything else fails loudly. Every statement yields first, so two creates interleave as they
 * would on two connections; a control run with the lock switched off shows the race this closes.
 * How each caller answers the refusal is pinned in `check-director-adapters.ts`.
 */
import { mock } from 'node:test';
import { setImmediate } from 'node:timers';
import { drizzle } from 'drizzle-orm/pg-proxy';

type Row = { key: string; clientKey: string | null; deletedAt: Date | null };
const TABLE = new Map<string, Row>();
const seed = (key: string, clientKey: string | null, deleted = false) =>
	TABLE.set(key, { key, clientKey, deletedAt: deleted ? new Date() : null });

/** `r2Slug` without its empty-name fallback, as `r2SlugSql` computes it. */
const slugSql = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60);

const FOLDER_SELECT =
	'select "key" from "projects" where (left(regexp_replace(lower("projects"."key"), \'[^a-z0-9]\', \'_\', \'g\'), 60) = $1 and left(regexp_replace(lower(coalesce("projects"."client_key", $2)), \'[^a-z0-9]\', \'_\', \'g\'), 60) = $3) order by "projects"."key" limit $4';
const LOCK = 'SELECT pg_advisory_xact_lock($1::int, hashtext($2))';
const INSERT = /^insert into "projects" \("key", "name", "client_key", "game_type",/;
const MOVE = 'update "projects" set "client_key" = $1 where "projects"."key" = $2';

/** Advisory locks: key → the tail of its wait queue. Off for the control run only. */
const lockQueue = new Map<string, Promise<void>>();
let locking = true;
/** Every advisory-lock key taken, in order. */
const lockKeys: string[] = [];
/** Statements that ran on the pool while some transaction held a lock, or on another one's tx. */
const misuse: string[] = [];
let holders = 0;
const unknown: string[] = [];

let txSeq = 0;
type Tx = {
	id: number;
	staged: Row[];
	moves: [string, string | null][];
	release: (() => void)[];
};
function connection(tx: Tx | null) {
	return drizzle(async (text, params) => {
		await new Promise((r) => setImmediate(r));
		if (text.startsWith('SET LOCAL lock_timeout')) return { rows: [] };
		if (text === LOCK) {
			if (!tx) throw new Error('fixture: an advisory xact lock outside a transaction');
			const key = String(params[1]);
			lockKeys.push(key);
			if (!locking) return { rows: [] };
			const before = lockQueue.get(key) ?? Promise.resolve();
			let release!: () => void;
			const mine = new Promise<void>((r) => (release = r));
			lockQueue.set(
				key,
				before.then(() => mine),
			);
			await before;
			holders++;
			tx.release.push(() => {
				holders--;
				release();
			});
			return { rows: [] };
		}
		if (!tx && holders > 0) misuse.push(`on the pool while a lock is held: ${text.slice(0, 40)}`);
		if (text === FOLDER_SELECT) {
			const [folder, unassigned, client, limit] = params as [string, string, string, number];
			const moved = new Map(tx?.moves ?? []);
			const visible = [...TABLE.values(), ...(tx?.staged ?? [])].map((r) =>
				moved.has(r.key) ? { ...r, clientKey: moved.get(r.key)! } : r,
			);
			const keys = visible
				.filter((r) => slugSql(r.key) === folder)
				.filter((r) => slugSql(r.clientKey ?? unassigned) === client)
				.map((r) => r.key)
				.sort()
				.slice(0, limit);
			return { rows: keys.map((key) => [key]) };
		}
		if (INSERT.test(text)) {
			if (!tx) throw new Error('fixture: createProject inserted outside its transaction');
			const [key, , clientKey] = params as [string, string, string | null];
			if (TABLE.has(key) || tx.staged.some((r) => r.key === key)) {
				throw new Error(`duplicate key value violates unique constraint "projects_pkey"`);
			}
			tx.staged.push({ key, clientKey, deletedAt: null });
			return { rows: [] };
		}
		if (text === MOVE) {
			if (!tx) throw new Error('fixture: assignProjectToClient moved outside its transaction');
			const [clientKey, key] = params as [string | null, string];
			tx.moves.push([key, clientKey]);
			return { rows: [] };
		}
		unknown.push(text);
		throw new Error(`fixture: unexpected statement ${text}`);
	});
}

const pool = Object.assign(connection(null), {
	transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
		const state: Tx = { id: ++txSeq, staged: [], moves: [], release: [] };
		try {
			const out = await fn(connection(state));
			for (const row of state.staged) TABLE.set(row.key, row);
			for (const [key, clientKey] of state.moves) {
				const row = TABLE.get(key);
				if (row) row.clientKey = clientKey;
			}
			return out;
		} finally {
			for (const release of state.release) release();
		}
	},
});
mock.module(new URL('../src/lib/server/db/index.ts', import.meta.url).href, {
	namedExports: { getDb: () => pool, schema: {} },
});

const { createProject } = await import('../src/lib/server/projects.ts');
const { assignProjectToClient } = await import('../src/lib/server/clients.ts');
const { ProjectFolderTakenError } = await import('../src/lib/server/projectPaths.ts');

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

/** `'created'`, or the project named by the refusal and whether its message names it. */
async function create(key: string, client: string | null): Promise<unknown> {
	try {
		await createProject(key, `Project ${key}`, client);
		return 'created';
	} catch (e) {
		if (!(e instanceof ProjectFolderTakenError)) throw e;
		return { refused: e.existing, named: e.message.includes(`"${e.existing}"`) };
	}
}
const keysInFolder = (key: string, client: string | null) =>
	[...TABLE.values()]
		.filter((r) => slugSql(r.key) === slugSql(key))
		.filter((r) => slugSql(r.clientKey ?? 'unassigned') === slugSql(client ?? 'unassigned'))
		.map((r) => r.key)
		.sort();

seed('sunken-temple', 'acme');
seed('old-game', 'acme', true);
seed('loose-game', null);
seed('my-x', 'acme-co');

console.log('folder rule');
check('a free key in a free folder is created', await create('new-game', 'acme'), 'created');
check(
	"a key whose folder is a live project's under the client is refused, naming it",
	await create('sunken_temple', 'acme'),
	{ refused: 'sunken-temple', named: true },
);
check('…and no row lands', TABLE.has('sunken_temple'), false);
check(
	"a key whose folder is a SOFT-DELETED project's is refused too",
	await create('old_game', 'acme'),
	{ refused: 'old-game', named: true },
);
check('the unassigned folder is a client folder like any other', await create('loose_game', null), {
	refused: 'loose-game',
	named: true,
});
check(
	'client keys alias the same way: acme_co is acme-co’s folder',
	await create('my_x', 'acme_co'),
	{ refused: 'my-x', named: true },
);
check(
	'the same slug under ANOTHER client is another folder, and is created',
	[await create('sunken_temple', 'other'), await create('loose_game', 'acme')],
	['created', 'created'],
);
{
	let message = '';
	try {
		await createProject('sunken-temple', 'Again', 'acme');
	} catch (e) {
		message = e instanceof ProjectFolderTakenError ? e.message : String(e);
	}
	check(
		'the same key again is refused in Game Maker’s words, not a primary-key 500',
		message,
		'A project with the key "sunken-temple" exists.',
	);
}
check('every create locked its key’s folder', lockKeys, [
	'new_game',
	'sunken_temple',
	'old_game',
	'loose_game',
	'my_x',
	'sunken_temple',
	'loose_game',
	'sunken_temple',
]);
check('every in-lock statement ran on the lock’s transaction', misuse, []);

console.log('race');
{
	const [a, b] = await Promise.all([create('race-game', 'acme'), create('race_game', 'acme')]);
	check(
		'two aliases racing: exactly one lands, the other is refused naming it',
		[a, b],
		['created', { refused: 'race-game', named: true }],
	);
	check('…so the folder holds one project', keysInFolder('race-game', 'acme'), ['race-game']);

	const [c, d] = await Promise.all([create('twin-game', 'acme'), create('twin_game', 'other')]);
	check(
		'two creates sharing a lock but not a client folder both land (serialized, not refused)',
		[c, d],
		['created', 'created'],
	);

	// Control: without the lock both creates read "free" before either inserts. This is the race
	// the lock closes; if it stops reproducing here, the check above proves nothing.
	locking = false;
	const [e, f] = await Promise.all([create('loose-race', 'acme'), create('loose_race', 'acme')]);
	locking = true;
	check(
		'control: with the lock off, both aliases land',
		[e, f, keysInFolder('loose-race', 'acme')],
		['created', 'created', ['loose-race', 'loose_race']],
	);
}
console.log('re-homing (assignProjectToClient)');
{
	const move = async (key: string, client: string | null) => {
		try {
			await assignProjectToClient(key, client);
			return 'moved';
		} catch (e) {
			if (!(e instanceof ProjectFolderTakenError)) throw e;
			return { refused: e.existing, named: e.message.includes(`"${e.existing}"`) };
		}
	};
	const clientOf = (key: string) => TABLE.get(key)?.clientKey;
	lockKeys.length = 0;
	check(
		'moving a project into a client folder a live project holds is refused, naming it',
		[await move('sunken_temple', 'acme'), clientOf('sunken_temple')],
		[{ refused: 'sunken-temple', named: true }, 'other'],
	);
	await create('old_game', 'other');
	check(
		'…and one a soft-deleted project holds',
		[await move('old_game', 'acme'), clientOf('old_game')],
		[{ refused: 'old-game', named: true }, 'other'],
	);
	check(
		'…and the unassigned folder (a client cleared to null)',
		[await move('loose_game', null), clientOf('loose_game')],
		[{ refused: 'loose-game', named: true }, 'acme'],
	);
	check(
		'a move into a free folder lands, and a move to its own client is a no-op that lands',
		[
			await move('sunken_temple', 'third'),
			clientOf('sunken_temple'),
			await move('sunken-temple', 'acme'),
		],
		['moved', 'third', 'moved'],
	);
	check('every move locked its key’s folder (the create between them too)', lockKeys, [
		'sunken_temple',
		'old_game',
		'old_game',
		'loose_game',
		'sunken_temple',
		'sunken_temple',
	]);

	await create('drift_game', 'other');
	const [g, h] = await Promise.all([move('drift_game', 'acme'), create('drift-game', 'acme')]);
	check(
		'a move racing a create of its alias: exactly one lands',
		[
			[g, h].filter((x) => x === 'moved' || x === 'created').length,
			keysInFolder('drift-game', 'acme').length,
		],
		[1, 1],
	);
}
check('every in-lock statement ran on the lock’s transaction (moves too)', misuse, []);
check('no statement the fixture does not know was sent', unknown, []);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} project-create checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} project-create checks pass`);
