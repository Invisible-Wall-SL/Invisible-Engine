// `current-games-retry.yml` re-runs a run's failed jobs when GitHub failed to start them, once per
// run, and never a job that ran and failed. This proves the decision on the shapes GitHub's jobs
// API really gives (recorded from the 2026-10-05 runner shortage: runs 37364297800, 37366774720
// attempt 1 and 37361665057 attempt 1), and that the job table the decision reads matches
// `current-games.yml`, so a renamed step or a new job breaks here rather than retrying blindly.
//
//   node scripts/current-games/retry.fixture.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { classifyJob, decideRetry, JOBS, jobKind, needsOf, WORKFLOW } from './lib/retry.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ---- the shapes, as the API returned them ----

const step = (name, conclusion = 'success', status = 'completed') => ({ name, status, conclusion });
const SETUP = [
	step('Set up job'),
	step('Run actions/checkout@v7'),
	step('Run pnpm/action-setup@v6'),
	step('Run actions/setup-node@v7'),
	step('Run pnpm install --frozen-lockfile'),
];
const ok = (name, steps = [...SETUP, step('Complete job')]) => ({
	name,
	conclusion: 'success',
	runner_name: 'GitHub Actions 1000006735',
	steps,
});
/** Run 37364297800 `prepare`: cancelled after 15 min, runner_id 0, runner_name "", no steps. */
const neverAcquired = (name) => ({ name, conclusion: 'cancelled', runner_name: '', steps: [] });
/** Run 37366774720 attempt 1 `render (14)`: its body ran and failed. */
const renderFailed = (n) => ({
	name: `render (${n})`,
	conclusion: 'failure',
	runner_name: 'GitHub Actions 1000006735',
	steps: [
		...SETUP,
		step('Install the headless shell'),
		step('Let the headless shell start its sandbox'),
		step('Run actions/download-artifact@v4'),
		step('Run actions/download-artifact@v4'),
		step(`Render shard ${n}/20`, 'failure'),
		step('Run actions/upload-artifact@v4', 'skipped'),
		step('Complete job'),
	],
});
/** A runner lost mid-install: the job fails with its body never started. */
const lostInSetup = (
	name,
	last = step('Run pnpm install --frozen-lockfile', null, 'in_progress'),
) => ({
	name,
	conclusion: 'failure',
	runner_name: 'GitHub Actions 1000006736',
	steps: [...SETUP.slice(0, 4), last],
});
/** The report job after a shard went missing: its compare ran and posted the failure. */
const reportFailed = () => ({
	name: 'report',
	conclusion: 'failure',
	runner_name: 'GitHub Actions 1000006737',
	steps: [...SETUP, step('Compare'), step('Post the status', 'failure'), step('Complete job')],
});
const shards = (except = []) =>
	Array.from({ length: 20 }, (_, i) => i + 1)
		.filter((n) => !except.includes(n))
		.map((n) => ok(`render (${n})`));
const greenRun = () => [ok('prepare'), ok('build'), ok('gates'), ...shards(), ok('report')];
const failedRun = (jobs) => ({ conclusion: 'failure', runAttempt: 1, jobs });
const names = (decision, outcome) =>
	decision.jobs.filter((j) => j.outcome === outcome).map((j) => j.name);

// ---- 1. one job at a time ----
assert.equal(jobKind('render (14)'), 'render');
assert.equal(jobKind('report'), 'report');
assert.deepEqual([...needsOf('report')].sort(), ['build', 'gates', 'prepare', 'render']);
assert.deepEqual([...needsOf('render')].sort(), ['build', 'prepare']);
assert.deepEqual([...needsOf('prepare')], []);

assert.equal(classifyJob(neverAcquired('prepare')).outcome, 'infrastructure');
assert.match(classifyJob(neverAcquired('render (6)')).why, /never acquired a runner/);
assert.equal(classifyJob(lostInSetup('render (3)')).outcome, 'infrastructure');
assert.match(classifyJob(lostInSetup('render (3)')).why, /before its body ran.*pnpm install/);
assert.equal(
	classifyJob(lostInSetup('build', step('Run pnpm install --frozen-lockfile', 'failure'))).outcome,
	'infrastructure',
	'a set-up step marked failed still never ran the body',
);
assert.equal(classifyJob(renderFailed(14)).outcome, 'real');
assert.match(classifyJob(renderFailed(14)).why, /"Render shard 14\/20" failure/);
assert.equal(classifyJob(reportFailed()).outcome, 'real');
assert.equal(
	classifyJob({ ...renderFailed(2), conclusion: 'cancelled' }).outcome,
	'real',
	'a body step that started is a result whatever ended it',
);
assert.equal(classifyJob({ name: 'publish', conclusion: 'failure', steps: [] }).outcome, 'unknown');
{
	// Set-up names never match a body prefix, whichever job they are in.
	const setupNames = SETUP.map((s) => s.name).concat(
		'Install the headless shell',
		'Let the headless shell start its sandbox',
		'Run actions/download-artifact@v4',
		'Restore the base runtime',
		'Complete job',
	);
	for (const kind of Object.keys(JOBS))
		for (const name of setupNames)
			assert.ok(
				!JOBS[kind].body.some((p) => name.startsWith(p)),
				`${kind}: "${name}" is set-up, not body`,
			);
}

// ---- 2. the decision ----
// Runner lost (never acquired) → retry once.
{
	const d = decideRetry(failedRun([neverAcquired('prepare')]));
	assert.equal(d.retry, true, d.reason);
	assert.deepEqual(names(d, 'infrastructure'), ['prepare']);
}
{
	// Run 37366774720 attempt 1 without its real failure: nine shards never acquired, the report
	// cancelled in the queue.
	const lost = [5, 6, 8, 9, 10, 11, 12, 15, 19];
	const d = decideRetry(
		failedRun([
			ok('prepare'),
			ok('build'),
			ok('gates'),
			...shards(lost),
			...lost.map((n) => neverAcquired(`render (${n})`)),
			neverAcquired('report'),
		]),
	);
	assert.equal(d.retry, true, d.reason);
	assert.equal(names(d, 'infrastructure').length, 10);
}
{
	// A runner lost mid-install on one shard; the report ran and failed because of the hole.
	const d = decideRetry(
		failedRun([
			ok('prepare'),
			ok('build'),
			ok('gates'),
			...shards([3]),
			lostInSetup('render (3)'),
			reportFailed(),
		]),
	);
	assert.equal(d.retry, true, d.reason);
	assert.deepEqual(names(d, 'infrastructure'), ['render (3)']);
	assert.deepEqual(names(d, 'downstream'), ['report'], 'the report is a consequence, not a result');
}
{
	// The build never got a runner: renders skipped, report ran and failed.
	const d = decideRetry(
		failedRun([ok('prepare'), neverAcquired('build'), ok('gates'), reportFailed()]),
	);
	assert.equal(d.retry, true, d.reason);
	assert.deepEqual(names(d, 'downstream'), ['report']);
}

// Test failure → no retry.
{
	const d = decideRetry(
		failedRun([
			ok('prepare'),
			ok('build'),
			ok('gates'),
			...shards([14]),
			renderFailed(14),
			reportFailed(),
		]),
	);
	assert.equal(d.retry, false);
	assert.match(d.reason, /no job died before its body ran/);
	assert.deepEqual(names(d, 'real'), ['render (14)', 'report']);
}
{
	// Only the compare failed (changed screens): a result, never retried.
	const d = decideRetry(failedRun([...greenRun().slice(0, -1), reportFailed()]));
	assert.equal(d.retry, false);
	assert.deepEqual(names(d, 'real'), ['report']);
}
{
	// Run 37366774720 attempt 1 as it was: nine shards never acquired AND one shard's render
	// failed. "Re-run failed jobs" would re-run the real failure too, so nothing is retried.
	const lost = [5, 6, 8, 9, 10, 11, 12, 15, 19];
	const d = decideRetry(
		failedRun([
			ok('prepare'),
			ok('build'),
			ok('gates'),
			...shards([...lost, 14]),
			...lost.map((n) => neverAcquired(`render (${n})`)),
			renderFailed(14),
			neverAcquired('report'),
		]),
	);
	assert.equal(d.retry, false);
	assert.match(d.reason, /a job ran and failed.*render \(14\)/);
	assert.equal(names(d, 'infrastructure').length, 10);
}
{
	// A job this table does not know is never retried, alone or beside a lost runner.
	const unknown = { name: 'publish', conclusion: 'failure', steps: [] };
	const alone = decideRetry(failedRun([unknown]));
	assert.equal(alone.retry, false);
	assert.deepEqual(names(alone, 'unknown'), ['publish']);
	const beside = decideRetry(failedRun([unknown, neverAcquired('prepare')]));
	assert.equal(beside.retry, false);
	assert.match(beside.reason, /publish/);
}

// Already retried → no retry.
{
	const d = decideRetry({ conclusion: 'failure', runAttempt: 2, jobs: [neverAcquired('prepare')] });
	assert.equal(d.retry, false);
	assert.match(d.reason, /attempt 2/);
}
// Only a failed run.
for (const conclusion of ['cancelled', 'success', 'timed_out', 'skipped'])
	assert.equal(
		decideRetry({ conclusion, runAttempt: 1, jobs: [neverAcquired('prepare')] }).retry,
		false,
	);
// A green run decides nothing (and does not throw on an empty failed set).
assert.equal(decideRetry({ conclusion: 'success', runAttempt: 1, jobs: greenRun() }).retry, false);

// ---- 3. the table matches current-games.yml ----
{
	const yml = read('.github/workflows/current-games.yml');
	const jobsAt = yml.indexOf('\njobs:\n');
	assert.ok(jobsAt > 0);
	const jobs = {};
	let current;
	for (const line of yml.slice(jobsAt + 7).split('\n')) {
		let m;
		if ((m = /^  ([\w-]+):\s*$/.exec(line))) jobs[(current = m[1])] = { needs: [], steps: [] };
		else if (current && (m = /^    needs:\s*(.+?)\s*$/.exec(line)))
			jobs[current].needs = m[1]
				.replace(/^\[|\]$/g, '')
				.split(',')
				.map((s) => s.trim());
		else if (current && (m = /^      (?:- )?name:\s*(.+?)\s*$/.exec(line)))
			jobs[current].steps.push(m[1].replace(/^(['"])(.*)\1$/, '$2'));
	}
	assert.deepEqual(Object.keys(jobs).sort(), Object.keys(JOBS).sort(), 'every job is in the table');
	for (const [kind, { needs, body }] of Object.entries(JOBS)) {
		assert.deepEqual([...needs].sort(), [...jobs[kind].needs].sort(), `${kind}: needs`);
		for (const prefix of body)
			assert.ok(
				jobs[kind].steps.some((s) => s.startsWith(prefix.replace(/\$\{\{.*$/, ''))),
				`${kind}: body step "${prefix}" is a step of the workflow`,
			);
	}
	// The workflow's name is what the retry listens to.
	assert.equal(/^name:\s*(.+)$/m.exec(yml)[1], WORKFLOW);
}

// ---- 4. the retry workflow ----
{
	const yml = read('.github/workflows/current-games-retry.yml');
	assert.match(yml, /workflow_run:\n\s+workflows: \[Current games\]\n\s+types: \[completed\]/);
	// Least privilege: `actions: write` and nothing else.
	const perms = /^permissions:\n((?:  .+\n)+)/m.exec(yml);
	assert.ok(perms, 'a top-level permissions block');
	assert.deepEqual(
		perms[1]
			.trim()
			.split('\n')
			.map((l) => l.trim()),
		['actions: write'],
	);
	assert.ok(!/^\s+permissions:/m.test(yml.replace(perms[0], '')), 'no job widens the permissions');
	assert.match(yml, /run_attempt == 1/);
	assert.match(yml, /conclusion == 'failure'/);
	assert.match(yml, /scripts\/current-games\/lib\/retry\.mjs --run/);
}

console.log('retry.fixture: ok');
