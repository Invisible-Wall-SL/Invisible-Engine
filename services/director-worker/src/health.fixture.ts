/**
 * `/healthz` is liveness (PLAN 3.1): up and the run tables answering is 200 whether or not runs
 * are driven; a missing secret shows as `driving: false`, never as a 503 that blocks the deploy.
 * Run: pnpm --filter director-worker check:health
 */
import { healthReport } from './health.ts';

let checks = 0;
let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) {
		failures++;
		console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
	}
};

const info = { agents: 7, workerId: 'w:1' };
const report = (configured: boolean, driving: boolean, dbUp: boolean) =>
	healthReport({ configured, driving, dbUp }, info);

check('driving with the tables answering is 200', report(true, true, true), {
	status: 200,
	body: { ok: true, db: 'up', driving: true, agents: 7, workerId: 'w:1' },
});
check(
	'not driving (a secret unset) with the tables answering is 200, and says so in the body',
	report(true, false, true),
	{ status: 200, body: { ok: true, db: 'up', driving: false, agents: 7, workerId: 'w:1' } },
);
check('a sweep that failed while driving is 503', report(true, true, false).status, 503);
check(
	'the tables not answering while not driving is 503 too',
	[report(true, false, false).status, report(true, false, false).body.db],
	[503, 'down'],
);
check(
	'no DATABASE_URL is 503 and never reads as driving',
	[report(false, true, true).status, report(false, true, true).body],
	[503, { ok: false, db: 'unconfigured', driving: false, agents: 7, workerId: 'w:1' }],
);

console.log(`health: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
