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
 * WORKERS drivers on separate connections (two per worker id, as two loops of one process) race
 * over RUNS runs (fewer runs than workers, so most claims contend) for DURATION_MS. Each run has a
 * pending conversation, so it always has work to claim. Each driver claims with the real `claimRun`,
 * then makes a few guarded writes — a state write through the real `withLease` + `applyTransition`,
 * as the turn loop makes them, or a `renewLease` — sometimes stalling past its lease first, and
 * releases.
 * A trigger logs every change to a run's lease or state in the SAME transaction, under the row lock,
 * so the log's order per run is the order the writes really happened in. The proof replays it:
 *
 *  1. a claim takes a run only when its lease was free or expired at that moment;
 *  2. every write after a claim is by the worker that claimed it, inside its lease — once another
 *     worker has claimed the run, the old holder never writes to it again;
 *  3. the contention and the stalls really happened (claims were refused, leases were stolen,
 *     stale writes were refused), so the run exercised the paths it claims to prove.
 */
import postgres, { type Sql } from 'postgres';
import { claimRun, releaseLease, renewLease, type ClaimedRun } from '../src/lease.ts';
import { checkpointSettings, type RunState } from '../src/runState.ts';
import { applyTransition, LeaseLost, withLease } from '../src/store.ts';

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

/** A state write as the turn loop makes it; false when the lease was lost and nothing was written. */
const guardedWrite = (sql: Sql, claimed: ClaimedRun) =>
	withLease(sql, claimed, (tx) =>
		applyTransition(tx, claimed.id, running, running, 'lease proof'),
	).then(
		() => true,
		(error: unknown) => {
			if (error instanceof LeaseLost) return false;
			throw error;
		},
	);

/**
 * One driver: claim, drive a few guarded steps (sometimes stalling past the lease), release. Drivers
 * share a worker id in pairs, as two loops of one process would (the sweep and a NOTIFY): the lease
 * must fence each CLAIM, not each process.
 */
async function worker(index: number, deadline: number) {
	const sql = postgres(url!, {
		max: 1,
		onnotice: () => {},
		connection: { application_name: `driver-${index}` },
	});
	const workerId = `worker-${Math.floor(index / 2)}`;
	try {
		while (Date.now() < deadline) {
			const claimed = await claimRun(sql, workerId, { leaseMs: LEASE_MS });
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
					i % 2 === 0 ? await guardedWrite(sql, claimed) : await renewLease(sql, claimed, LEASE_MS);
				if (held) stats.writes++;
				else stats.refusedWrites++;
			}
			if (held && (await releaseLease(sql, claimed))) stats.releases++;
		}
	} finally {
		await sql.end();
	}
}

interface LogRow {
	id: number;
	run_id: string;
	/** The connection that wrote — one per driver — whatever `lease_holder` it wrote. */
	driver: string;
	old_holder: string | null;
	new_holder: string | null;
	/** The old lease against the writing transaction's `now()` — the clock its guard compared
	 *  against — exactly as each guard does. Compared in SQL: a JS Date drops the microseconds. */
	claimable: boolean;
	writable: boolean;
}

/**
 * Replay each run's log in order. A change is classified by what the database allowed, not by the
 * holder string: setting a holder over a free or expired lease is a claim, anything else that keeps a
 * holder is a write under a live lease. Every write and release must then come from the DRIVER that
 * made the run's last claim, so a fence that only told processes apart would be caught here.
 */
function replay(log: LogRow[]) {
	const violations: string[] = [];
	let steals = 0;
	let sameProcessSteals = 0;
	const driving = new Map<string, string | null>();
	for (const row of log) {
		const driver = driving.get(row.run_id) ?? null;
		const where = `#${row.id} ${row.driver} on ${row.run_id}`;
		if (row.new_holder === null) {
			if (row.driver !== driver) violations.push(`${where}: released a run ${driver} drives`);
			driving.set(row.run_id, null);
		} else if (row.old_holder === null || row.claimable) {
			if (row.old_holder !== null) {
				steals++;
				if (row.old_holder.split('#')[0] === row.new_holder.split('#')[0]) sameProcessSteals++;
			}
			if (row.new_holder === row.old_holder) violations.push(`${where}: a claim reused a token`);
			driving.set(row.run_id, row.driver);
		} else if (!row.writable) {
			violations.push(`${where}: claimed under a live lease, or wrote after it expired`);
		} else if (row.driver !== driver) {
			violations.push(`${where}: wrote while ${driver} drives it`);
		} else if (row.new_holder !== row.old_holder) {
			violations.push(`${where}: changed the holder without claiming`);
		}
	}
	return { violations, steals, sameProcessSteals };
}

let log: LogRow[] = [];
try {
	await admin`create table director_lease_proof_log (
		id bigserial primary key,
		run_id text not null,
		driver text not null,
		old_holder text,
		new_holder text,
		old_lease_until timestamptz,
		at timestamptz not null
	)`;
	await admin`create function director_lease_proof_log_fn() returns trigger as $$
		begin
			insert into director_lease_proof_log (run_id, driver, old_holder, new_holder, old_lease_until, at)
			values (new.id, current_setting('application_name'), old.lease_holder, new.lease_holder,
				old.lease_until, now());
			return new;
		end $$ language plpgsql`;
	await admin`create trigger director_lease_proof_log_trg after update on director_runs
		for each row execute function director_lease_proof_log_fn()`;

	await admin`insert into users (id, email, name)
		values (${userId}, ${`${tag}@example.invalid`}, 'lease proof')`;
	for (const id of runIds) {
		await admin`insert into director_runs (id, project_key, template_project_key, owner_user_id, status, step)
			values (${id}, ${`${id}-p`}, 'template', ${userId}, 'running', 'regions')`;
		// A pending conversation: work the run is claimed for, which these drivers never consume.
		await admin`insert into director_messages (run_id, agent, seq, role, content_json)
			values (${id}, 'coordinator', 0, 'user', ${admin.json([{ type: 'text', text: 'work' }])})`;
	}

	const deadline = Date.now() + DURATION_MS;
	await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i, deadline)));

	log = await admin<LogRow[]>`select id, run_id, driver, old_holder, new_holder,
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

const { violations, steals, sameProcessSteals } = replay(log);
const checks: [boolean, string][] = [
	[violations.length === 0, `no two workers drove one run (${log.length} logged changes replayed)`],
	[stats.claims > 50, `runs were claimed many times (${stats.claims})`],
	[stats.emptyClaims > 0, `contending claims came back empty (${stats.emptyClaims})`],
	[steals > 0, `expired leases were taken over by another claim (${steals})`],
	[
		sameProcessSteals > 0,
		`... including by the same process, fenced by the claim token (${sameProcessSteals})`,
	],
	[stats.refusedWrites > 0, `writes after a lost lease were refused (${stats.refusedWrites})`],
];
let failed = false;
for (const [ok, msg] of checks) {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
	failed ||= !ok;
}
for (const v of violations.slice(0, 20)) console.log(`    ${v}`);
console.log(
	JSON.stringify({
		drivers: WORKERS,
		runs: RUNS,
		leaseMs: LEASE_MS,
		...stats,
		steals,
		sameProcessSteals,
	}),
);
if (failed) process.exit(1);
console.log('\nlease claim proven: one driver per run.');
