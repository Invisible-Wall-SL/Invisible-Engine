/**
 * The idle-deploy check (ADR-0008 §1, owner decision 8), run by the deploy checklist before a
 * director-worker build that changes agents' tools:
 *
 *   DATABASE_URL=… pnpm --filter director-worker check:idle            # report; exit 1 unless idle
 *   DATABASE_URL=… pnpm --filter director-worker check:idle --pause    # pause running runs, wait
 *
 * With `--pause`, every running run gets the owner's `pause` request and every live run a note
 * naming why; the check then waits (up to `--wait <s>`, default 120) for the worker to apply the
 * pauses. Exit 0 = nothing running or stopping: deploy. Exit 1 = not idle: do not deploy.
 */
import postgres from 'postgres';
import { idleVerdict, liveRuns, pauseForDeploy } from '../src/idle.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required.');
	process.exit(2);
}
const args = process.argv.slice(2);
const pause = args.includes('--pause');
const waitAt = args.indexOf('--wait');
const waitSeconds = waitAt >= 0 ? Number(args[waitAt + 1]) : 120;
const REASON =
	'Paused for a deploy that changes the agents and their tools (the atlas technician). Resume the run once the deploy is live.';

const sql = postgres(url, { max: 2, onnotice: () => {} });
try {
	if (pause) {
		const asked = await pauseForDeploy(sql, REASON);
		console.log(`asked ${asked.length} running run(s) to pause: ${asked.join(', ') || '—'}`);
		const until = Date.now() + waitSeconds * 1000;
		while (!idleVerdict(await liveRuns(sql)).idle && Date.now() < until) {
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
	const verdict = idleVerdict(await liveRuns(sql));
	console.log(JSON.stringify(verdict, null, 2));
	console.log(verdict.idle ? 'idle: the deploy may go.' : 'NOT idle: do not deploy yet.');
	process.exitCode = verdict.idle ? 0 : 1;
} finally {
	await sql.end();
}
