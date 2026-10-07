/**
 * Proof of the idle-deploy check (ADR-0008 §1) against a REAL Postgres:
 *
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter director-worker prove:idle
 *
 * Proved: a running or stopping run blocks the deploy, a waiting or paused one is held, drafts and
 * ended runs are ignored; `pauseForDeploy` asks every running run to pause through the owner's own
 * request, notes the reason on every live run, and the worker's next drive applies the pause so
 * the check turns idle; the strict form stays not quiet while a held run is unended.
 */
import postgres from 'postgres';
import { parsePricing } from 'director-costs';
import { readFileSync } from 'node:fs';
import { idleVerdict, liveRuns, pauseForDeploy } from '../src/idle.ts';
import { driveRun } from '../src/driver.ts';
import { claimRun } from '../src/lease.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required (a scratch database with the launcher migrations).');
	process.exit(2);
}
const sql = postgres(url, { max: 4, onnotice: () => {} });
const pricing = parsePricing(
	JSON.parse(readFileSync(new URL('../pricing.json', import.meta.url), 'utf8')),
);

let checks = 0;
let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ✓ ${name}`);
	else {
		failures++;
		console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
	}
};

const tag = `idle-proof-${Date.now()}`;
const userId = `${tag}-owner`;
const mine = <T extends { id: string }>(rows: T[]) => rows.filter((r) => r.id.startsWith(tag));

await sql`insert into users (id, email, name) values (${userId}, ${`${tag}@example.invalid`}, 'idle proof')`;
try {
	const add = (suffix: string, status: string, step = 'regions', waitingOn: string | null = null) =>
		sql`insert into director_runs (id, project_key, template_project_key, owner_user_id, status, step,
				waiting_on)
			values (${`${tag}-${suffix}`}, ${`${tag}-${suffix}`}, 'tpl', ${userId}, ${status}, ${step},
				${waitingOn})`;
	await add('draft', 'draft', 'breakdown');
	await add('running', 'running');
	await add('waiting', 'waiting', 'style_pack', 'art_plan');
	await add('paused', 'paused');
	await add('done', 'handed_off', 'handoff');

	const verdict = idleVerdict(mine(await liveRuns(sql)));
	check(
		'a running run blocks the deploy; waiting and paused are held; drafts and ended runs are not listed',
		verdict,
		{
			idle: false,
			running: [`${tag}-running`],
			stopping: [],
			held: [`${tag}-paused`, `${tag}-waiting`],
			quiet: false,
		},
	);
	check('the strict check is quiet only with no started run unended', idleVerdict([]).quiet, true);
	check(
		'a stopping run blocks too',
		idleVerdict([{ id: 's', status: 'stopping', step: 'regions', waiting_on: null }]).idle,
		false,
	);

	const asked = (await pauseForDeploy(sql, 'deploy reason')).filter((id) => id.startsWith(tag));
	check('the running run is asked to pause', asked, [`${tag}-running`]);
	const notes = await sql<{ run_id: string }[]>`
		select run_id from director_events
		where run_id like ${`${tag}-%`} and kind = 'activity' and payload_json->>'text' = 'deploy reason'
		order by run_id`;
	check(
		'every live run gets the note',
		notes.map((n) => n.run_id),
		[`${tag}-paused`, `${tag}-running`, `${tag}-waiting`],
	);

	const claimed = await claimRun(sql, 'idle-prover', { runId: `${tag}-running`, leaseMs: 2_000 });
	if (claimed) {
		await driveRun(
			{
				sql,
				transport: {
					send: async () => {
						throw new Error('no model call expected');
					},
				},
				vision: {
					analyze: async () => {
						throw new Error('no vision call expected');
					},
				},
				launcher: {
					catalog: async () => new Map(),
					call: async () => ({ status: 404, body: {} }),
				},
				agents: new Map(),
				pricing: async () => pricing,
				retries: new Map(),
				leaseMs: 2_000,
			},
			claimed,
		);
	}
	const [row] = await sql<
		{ status: string }[]
	>`select status from director_runs where id = ${`${tag}-running`}`;
	check('the worker applies the pause', row.status, 'paused');
	const after = idleVerdict(mine(await liveRuns(sql)));
	check('...and the check turns idle', after.idle, true);
	check('...but not quiet while runs are held (the strict check, card 8C)', after.quiet, false);
} finally {
	await sql`delete from users where id = ${userId}`;
	await sql.end();
}

console.log(`\nidle: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
