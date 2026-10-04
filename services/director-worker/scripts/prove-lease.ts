/**
 * Proof that two workers never drive one run (PLAN 3.3), against a REAL Postgres — `SKIP LOCKED` and
 * lease expiry are database behaviour, so an in-memory fake would prove nothing.
 *
 *   createdb director_lease_proof
 *   DATABASE_URL=postgres://…/director_lease_proof pnpm --filter launcher-api db:migrate
 *   DATABASE_URL=postgres://…/director_lease_proof pnpm --filter director-worker prove:lease
 *
 * SCRATCH DATABASE ONLY: it refuses to run when `director_runs` holds any row, and it installs a
 * logging trigger on `director_runs` for its duration.
 *
 * WORKERS separate connections race over RUNS runs (fewer runs than workers, so most claims
 * contend) for DURATION_MS. Each claims with the real `claimRun`, then makes a few guarded writes
 * with the real `writeState` / `renewLease`, sometimes stalling past its lease first, and releases.
 * A trigger logs every change to a run's lease or state in the SAME transaction, under the row lock,
 * so the log's order per run is the order the writes really happened in. The proof replays it:
 *
 *  1. a claim takes a run only when its lease was free or expired at that moment;
 *  2. every write after a claim is by the worker that claimed it, inside its lease — once another
 *     worker has claimed the run, the old holder never writes to it again;
 *  3. the contention and the stalls really happened (claims were refused, leases were stolen,
 *     stale writes were refused), so the run exercised the paths it claims to prove.
 */
import postgres from 'postgres';
import { claimRun, releaseLease, renewLease, writeState } from '../src/lease.ts';
import { checkpointSettings, type RunState } from '../src/runState.ts';

const WORKERS = 8;
const RUNS = 3;
const DURATION_MS = 8_000;
const LEASE_MS = 150;

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required (a scratch database with the launcher migrations).');
	process.exit(2);
}

const admin = postgres(url, { max: 1, onnotice: () => {} });
const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from director_runs`;
if (n > 0) {
	console.error(`director_runs holds ${n} rows: this is not a scratch database. Refusing.`);
	await admin.end();
	process.exit(2);
}

const tag = `lease-proof-${Date.now()}`;
const userId = `${tag}-owner`;
const runIds = Array.from({ length: RUNS }, (_, i) => `${tag}-run-${i}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stats = { claims: 0, emptyClaims: 0, writes: 0, refusedWrites: 0, stalls: 0, releases: 0 };
const running: RunState = {
	status: 'running',
	step: 'regions',
	waitingOn: null,
	checkpoints: checkpointSettings({}),
};

/** One worker: claim, drive a few guarded steps (sometimes stalling past the lease), release. */
async function worker(index: number, deadline: number) {
	const sql = postgres(url!, { max: 1, onnotice: () => {} });
	const holder = `worker-${index}`;
	try {
		while (Date.now() < deadline) {
			const claimed = await claimRun(sql, holder, { leaseMs: LEASE_MS });
			if (!claimed) {
				stats.emptyClaims++;
				await sleep(Math.random() * 10);
				continue;
			}
			stats.claims++;
			const steps = 1 + Math.floor(Math.random() * 4);
			let held = true;
			for (let i = 0; i < steps && held; i++) {
				if (Math.random() < 0.15) {
					stats.stalls++;
					await sleep(LEASE_MS + 40 + Math.random() * 60);
				} else {
					await sleep(Math.random() * 20);
				}
				// A same-state write still bumps updated_at under the guard: a "drive" step.
				held =
					i % 2 === 0
						? await writeState(sql, claimed.id, holder, running, running, 'lease proof')
						: await renewLease(sql, claimed.id, holder, LEASE_MS);
				if (held) stats.writes++;
				else stats.refusedWrites++;
			}
			if (held && (await releaseLease(sql, claimed.id, holder))) stats.releases++;
		}
	} finally {
		await sql.end();
	}
}

interface LogRow {
	id: number;
	run_id: string;
	old_holder: string | null;
	new_holder: string | null;
	/** The old lease against the writing transaction's `now()` — the clock its guard compared
	 *  against — exactly as each guard does. Compared in SQL: a JS Date drops the microseconds. */
	claimable: boolean;
	writable: boolean;
}

/** Replay each run's log in order; every way the history could break the claim is a violation. */
function replay(log: LogRow[]) {
	const violations: string[] = [];
	let steals = 0;
	const current = new Map<string, string | null>();
	for (const row of log) {
		const holder = current.get(row.run_id) ?? null;
		const isClaim = row.new_holder !== null && row.new_holder !== row.old_holder;
		const isRelease = row.new_holder === null && row.old_holder !== null;
		if (isClaim) {
			const free = row.old_holder === null || row.claimable;
			if (!free) {
				violations.push(
					`#${row.id} ${row.new_holder} claimed ${row.run_id} under a live lease of ${row.old_holder}`,
				);
			}
			if (row.old_holder !== null) steals++;
			current.set(row.run_id, row.new_holder);
		} else if (isRelease) {
			if (row.old_holder !== holder) {
				violations.push(`#${row.id} ${row.old_holder} released ${row.run_id} held by ${holder}`);
			}
			current.set(row.run_id, null);
		} else if (row.new_holder !== holder) {
			violations.push(`#${row.id} ${row.new_holder} wrote ${row.run_id} while ${holder} held it`);
		} else if (!row.writable) {
			violations.push(`#${row.id} ${row.new_holder} wrote ${row.run_id} after its lease expired`);
		}
	}
	return { violations, steals };
}

let log: LogRow[] = [];
try {
	await admin`create table director_lease_proof_log (
		id bigserial primary key,
		run_id text not null,
		old_holder text,
		new_holder text,
		old_lease_until timestamptz,
		at timestamptz not null
	)`;
	await admin`create function director_lease_proof_log_fn() returns trigger as $$
		begin
			insert into director_lease_proof_log (run_id, old_holder, new_holder, old_lease_until, at)
			values (new.id, old.lease_holder, new.lease_holder, old.lease_until, now());
			return new;
		end $$ language plpgsql`;
	await admin`create trigger director_lease_proof_log_trg after update on director_runs
		for each row execute function director_lease_proof_log_fn()`;

	await admin`insert into users (id, email, name)
		values (${userId}, ${`${tag}@example.invalid`}, 'lease proof')`;
	for (const id of runIds) {
		await admin`insert into director_runs (id, project_key, template_project_key, owner_user_id, status, step)
			values (${id}, ${`${id}-p`}, 'template', ${userId}, 'running', 'regions')`;
	}

	const deadline = Date.now() + DURATION_MS;
	await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i, deadline)));

	log = await admin<LogRow[]>`select id, run_id, old_holder, new_holder,
			coalesce(old_lease_until < at, true) as claimable,
			coalesce(old_lease_until > at, false) as writable
		from director_lease_proof_log order by run_id, id`;
} finally {
	await admin`drop trigger if exists director_lease_proof_log_trg on director_runs`;
	await admin`drop function if exists director_lease_proof_log_fn()`;
	await admin`drop table if exists director_lease_proof_log`;
	await admin`delete from director_runs where id = any(${runIds}::text[])`;
	await admin`delete from users where id = ${userId}`;
	await admin.end();
}

const { violations, steals } = replay(log);
const checks: [boolean, string][] = [
	[violations.length === 0, `no two workers drove one run (${log.length} logged changes replayed)`],
	[stats.claims > 50, `runs were claimed many times (${stats.claims})`],
	[stats.emptyClaims > 0, `contending claims came back empty (${stats.emptyClaims})`],
	[steals > 0, `expired leases were taken over by another worker (${steals})`],
	[stats.refusedWrites > 0, `writes after a lost lease were refused (${stats.refusedWrites})`],
];
let failed = false;
for (const [ok, msg] of checks) {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
	failed ||= !ok;
}
for (const v of violations.slice(0, 20)) console.log(`    ${v}`);
console.log(JSON.stringify({ workers: WORKERS, runs: RUNS, leaseMs: LEASE_MS, ...stats, steals }));
if (failed) process.exit(1);
console.log('\nlease claim proven: one driver per run.');
