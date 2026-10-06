// `current-games-verdict.yml` posts the required `current-games` status from main's copy of the
// code, so a pull request cannot say its own harness passed. This proves every branch of that
// decision (verify the run, the two phases, what a change can reach, the jobs, the report), that the
// harness workflow can no longer post (no `statuses` permission, no `/statuses/` call), and that the
// verdict workflow never checks out or installs anything but main.
//
//   node scripts/current-games/verdict.fixture.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SECRET_ENV } from './lib/redact.mjs';
import { runtimeInputs } from './lib/touched.mjs';
import { checkRun, decide, decideRequested, reachOf } from './lib/verdict.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const REPO = 'Invisible-Wall-SL/Invisible-Engine';
const SHA = 'a'.repeat(40);
const URL = `https://github.com/${REPO}/actions/runs/1`;

const run = (over = {}) => ({
	id: 1,
	path: '.github/workflows/current-games.yml',
	event: 'pull_request',
	status: 'completed',
	conclusion: 'success',
	run_attempt: 1,
	head_sha: SHA,
	html_url: URL,
	display_title: 'some PR',
	repository: { full_name: REPO },
	head_repository: { full_name: REPO },
	pull_requests: [{ number: 7 }],
	...over,
});
const pr = (over = {}) => ({
	number: 7,
	state: 'open',
	head: { sha: SHA, repo: { full_name: REPO } },
	base: { sha: 'b'.repeat(40) },
	...over,
});
const check = (r, p = pr()) => checkRun({ run: r, pr: p, repository: REPO });

// ---- 1. is it a run we post for? ----
{
	const ok = check(run());
	assert.deepEqual([ok.ok, ok.context, ok.sha], [true, 'current-games', SHA]);
}
assert.match(check(run({ path: '.github/workflows/other.yml' })).why, /not a run of/);
assert.match(check(run({ repository: { full_name: 'x/y' } })).why, /belongs to x\/y/);
assert.match(check(run({ head_repository: { full_name: 'x/y' } })).why, /fork/);
assert.match(check(run({ pull_requests: [] })).why, /names no pull request/);
assert.match(check(run({ event: 'push', pull_requests: [] })).why, /push run posts no status/);
assert.match(check(run(), pr({ state: 'closed' })).why, /PR not open, nothing posted/);
assert.match(check(run(), pr({ head: { sha: SHA, repo: { full_name: 'x/y' } } })).why, /fork/);
assert.match(
	check(run(), pr({ head: { sha: 'c'.repeat(40), repo: { full_name: REPO } } })).why,
	/moved on.*newer run posts/,
);
assert.match(checkRun({ run: run(), repository: REPO }).why, /could not be read/);
// A manual run posts a context of its own, never `current-games`.
{
	const self = check(
		run({
			event: 'workflow_dispatch',
			pull_requests: [],
			display_title: 'Current games: self-compare',
		}),
	);
	assert.deepEqual([self.ok, self.context, self.sha], [true, 'current-games/self-compare', SHA]);
	for (const display_title of ['Current games: manual', 'Current games', 'anything', undefined]) {
		const manual = check(run({ event: 'workflow_dispatch', pull_requests: [], display_title }));
		assert.equal(manual.context, 'current-games/manual', String(display_title));
	}
	const fork = check(
		run({ event: 'workflow_dispatch', head_repository: { full_name: 'x/y' }, pull_requests: [] }),
	);
	assert.equal(fork.ok, false);
}

// ---- 2. the phases ----
{
	const d = decideRequested({ run: run({ status: 'in_progress', conclusion: null }) });
	assert.deepEqual(d.post, {
		state: 'pending',
		description: 'Rendering every live game…',
		target_url: URL,
	});
	assert.equal(
		decideRequested({ run: run({ status: 'queued', conclusion: null }) }).post.state,
		'pending',
	);
	const late = decideRequested({ run: run() });
	assert.equal(late.post, undefined, 'a requested event after completion posts nothing');
	assert.match(late.why, /completed event decides/);
}

// ---- 3. what can a change reach? (main's touched.mjs) ----
{
	assert.deepEqual(reachOf(['docs/a.md', '.claude/agents/x.md'], runtimeInputs), {
		render: false,
		description: 'Docs-only change: no game can differ',
	});
	const untouched = reachOf(['apps/launcher-api/src/x.ts', 'docs/a.md'], runtimeInputs);
	assert.equal(untouched.render, false);
	assert.match(untouched.description, /^Runtime untouched: no game can differ \(1 changed files/);
	assert.equal(reachOf(['packages/pixi-svelte/src/x.ts'], runtimeInputs).render, true);
	assert.equal(reachOf(['scripts/current-games/lib/verdict.mjs'], runtimeInputs).render, true);
	assert.equal(reachOf(null).render, true, 'an undecidable diff renders');
	assert.equal(
		reachOf(['x.ts'], () => {
			throw new Error('no workspace');
		}).render,
		true,
		'an unreadable workspace renders',
	);
}

// ---- 4. the decision ----
const job = (name, conclusion = 'success') => ({ name, conclusion });
const shards = (n = 20, bad = {}) =>
	Array.from({ length: n }, (_, i) => job(`render (${i + 1})`, bad[i + 1] ?? 'success'));
const green = () => [job('prepare'), job('build'), job('gates'), ...shards(), job('report')];
const line = '12 pass · 0 fail · 0 not rendered · 0 changed screen(s)';
const report = (over = {}) => ({
	head: { sha: SHA },
	summary: { verdict: 'pass', line },
	...over,
});
const verdict = (over = {}) =>
	decide({ run: run(), jobs: green(), report: report(), reach: { render: true }, ...over });

// Docs-only and untouched pass without any job or report, with the text the harness always posted.
{
	const d = decide({
		run: run(),
		jobs: [],
		reach: reachOf(['docs/a.md'], runtimeInputs),
	});
	assert.deepEqual(d, {
		state: 'success',
		description: 'Docs-only change: no game can differ',
		target_url: URL,
	});
	const u = decide({
		run: run(),
		jobs: [],
		reach: reachOf(['apps/launcher-api/src/x.ts'], runtimeInputs),
	});
	assert.equal(u.state, 'success');
	assert.match(u.description, /^Runtime untouched/);
	assert.ok(u.description.length <= 140);
}
// A render that passes; the launcher compares the description with the summary line cut to 139.
{
	const d = verdict();
	assert.deepEqual(d, { state: 'success', description: line, target_url: URL });
	const long = 'x'.repeat(300);
	const cut = verdict({ report: report({ summary: { verdict: 'fail', line: long } }) });
	assert.equal(cut.description, long.slice(0, 139), "the launcher's slice(0, 139)");
	assert.equal(cut.state, 'failure');
}
// Changed screens: a failure that carries the summary line.
{
	const changed = '11 pass · 1 fail · 0 not rendered · 2 changed screen(s)';
	const d = verdict({ report: report({ summary: { verdict: 'fail', line: changed } }) });
	assert.deepEqual([d.state, d.description], ['failure', changed]);
}
// A job that did not succeed.
{
	const build = verdict({
		jobs: [job('prepare'), job('build', 'failure'), job('gates'), ...shards(20, {})],
		report: report({
			aborted: 'the plan failed: R2 unreachable',
			summary: { verdict: 'fail', line: 'x' },
		}),
	});
	assert.deepEqual(
		[build.state, build.description],
		['failure', 'the plan failed: R2 unreachable'],
	);
	const noReason = verdict({
		jobs: [job('prepare'), job('build', 'failure'), job('gates'), ...shards()],
		report: undefined,
	});
	assert.equal(noReason.description, 'the runtime build failed');
	const gates = verdict({
		jobs: [job('prepare'), job('build'), job('gates', 'failure'), ...shards()],
	});
	assert.equal(gates.description, 'the gates job did not finish');
	const shard = verdict({
		jobs: [job('prepare'), job('build'), job('gates'), ...shards(20, { 6: 'failure' })],
	});
	assert.deepEqual([shard.state, shard.description], ['failure', `a render shard died (${line})`]);
	const noShards = verdict({ jobs: [job('prepare'), job('build'), job('gates')] });
	assert.match(noShards.description, /a render shard died/, 'no render job is not a pass');
	const noBuild = verdict({ jobs: [job('prepare'), job('gates'), ...shards()] });
	assert.equal(noBuild.state, 'failure');
	assert.equal(verdict({ report: undefined }).description, 'no report');
	const died = verdict({
		jobs: [job('prepare'), job('build'), job('gates'), ...shards(20, { 6: 'cancelled' })],
		report: undefined,
	});
	assert.equal(died.description, 'a render shard died (no report)');
}
// The prepare job did not succeed: the secrets it names, or that it could not start.
{
	const jobs = [job('prepare', 'failure'), job('build', 'skipped'), job('gates', 'skipped')];
	const missing = verdict({
		jobs,
		report: undefined,
		prepare: { missingSecrets: ['PIPELINE_CI_TOKEN', 'CURRENT_GAMES_R2_BUCKET'] },
	});
	assert.deepEqual(
		[missing.state, missing.description],
		['failure', 'Missing secret(s): PIPELINE_CI_TOKEN CURRENT_GAMES_R2_BUCKET'],
	);
	const all = verdict({ jobs, report: undefined, prepare: { missingSecrets: SECRET_ENV } });
	assert.match(all.description, /^Missing 6 secrets \(named in the run log\): PIPELINE_GAMES_URL/);
	assert.ok(all.description.length <= 140);
	const unknown = verdict({
		jobs,
		report: undefined,
		prepare: { missingSecrets: ['ANYTHING_ELSE', '<script>'] },
	});
	assert.equal(unknown.description, 'The harness could not start: see the prepare job');
	assert.equal(
		verdict({ jobs, report: undefined }).description,
		'The harness could not start: see the prepare job',
	);
	assert.equal(
		verdict({ jobs: [job('prepare', 'cancelled')], report: undefined }).state,
		'failure',
	);
}
// The run's own prepare said nothing renders while main says something does.
{
	const d = verdict({
		jobs: [job('prepare'), job('build', 'skipped'), job('gates', 'skipped'), ...shards(20, {})].map(
			(j) => (j.name.startsWith('render') ? { ...j, conclusion: 'skipped' } : j),
		),
		report: undefined,
	});
	assert.equal(d.state, 'failure');
	assert.match(d.description, /^This change can reach a game, but the run rendered nothing/);
	assert.ok(d.description.length <= 139);
}
// A report for another commit never passes this one.
{
	const other = 'd'.repeat(40);
	const d = verdict({ report: report({ head: { sha: other } }) });
	assert.deepEqual(
		[d.state, d.description],
		['failure', 'The report is for ddddddd, not this head'],
	);
	assert.equal(verdict({ report: report({ head: undefined }) }).state, 'failure');
}
// The harness's own report job takes the same decision, from the jobs' results in env.
{
	const local = (BUILD, GATES, RENDER, rep = report()) =>
		decide({
			run: { head_sha: SHA, html_url: URL },
			jobs: Object.entries({ prepare: 'success', build: BUILD, gates: GATES, render: RENDER }).map(
				([name, conclusion]) => job(name, conclusion),
			),
			report: rep,
		});
	assert.equal(local('success', 'success', 'success').state, 'success');
	assert.equal(local('failure', 'success', 'success').state, 'failure');
	assert.equal(local('success', 'failure', 'success').state, 'failure');
	assert.equal(local('success', 'success', 'failure').state, 'failure');
	assert.equal(local('success', 'success', 'success', null).description, 'no report');
}

// ---- 5. the workflows ----
{
	const yml = read('.github/workflows/current-games.yml');
	assert.ok(
		!/statuses/.test(yml.replace(/^\s*#.*$/gm, '')),
		'the harness holds no statuses permission',
	);
	assert.ok(!/\/statuses\//.test(yml), 'the harness never calls the statuses API');
	assert.ok(!/STATUS_(CONTEXT|SHA)/.test(yml));
	assert.match(yml, /^permissions:\n {2}contents: read\n {2}pull-requests: read\n/m);
	assert.match(yml, /name: Verdict\n[\s\S]*verdict\.mjs --local/);
	assert.match(yml, /name: current-games-prepare/);
	assert.match(yml, /^run-name:.*Current games: self-compare/m);
}
{
	const file = read('.github/workflows/current-games-verdict.yml');
	const yml = file.replace(/^\s*#.*$/gm, '');
	assert.match(yml, /^name: Current games verdict$/m);
	assert.match(
		yml,
		/workflow_run:\n\s+workflows: \[Current games\]\n\s+types: \[requested, completed\]/,
	);
	assert.ok(!/^\s+ref:/m.test(yml), 'it checks out the default branch only');
	assert.ok(!/pnpm install|pnpm\/action-setup|npm (ci|install)/.test(yml), 'it installs nothing');
	assert.match(yml, /persist-credentials: false/);
	assert.match(yml, /environment: current-games-verdict/);
	assert.match(yml, /scripts\/current-games\/lib\/verdict\.mjs/);
	assert.match(yml, /^permissions:\n(?: {2}.+\n)*? {2}statuses: write\n/m);
	assert.ok(
		!/actions\/download-artifact|upload-artifact/.test(yml),
		'it never downloads an artifact',
	);
}

console.log('verdict.fixture: ok');
