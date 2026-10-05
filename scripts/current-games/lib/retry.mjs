// Retry a `current-games` run whose jobs GitHub failed to START: a hosted runner never acquired
// ("The job was not acquired by Runner of type hosted even after multiple attempts", the job is
// `cancelled` after ~15 min with no runner and no steps), or a runner lost before the job's body
// ran (checkout, toolchain, install, artifact download). Never a job that ran and failed: a step
// that exercised the branch — a build, the gates, a render shard, the compare — with any
// conclusion is a real result, and a real failure is never retried.
//
// `.github/workflows/current-games-retry.yml` runs this on every completed `Current games` run and
// re-runs the failed jobs at most ONCE per run (attempt 1 only). GitHub's "re-run failed jobs"
// re-runs every failed job and their dependents, so a run retries only when EVERY failed job
// either never ran its body or is downstream of one that did not (the report job fails whenever a
// shard is missing): one real failure in the set and nothing is retried.
//
//   node scripts/current-games/lib/retry.mjs --run <run id> [--apply]
//     GITHUB_REPOSITORY=owner/repo  GITHUB_TOKEN=<actions: write>  (`--apply` re-runs; else a dry run)

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const WORKFLOW = 'Current games';

/**
 * The jobs of `current-games.yml`: what each `needs`, and the names (prefixes) of the steps that
 * exercise the branch — its BODY. Steps before the body (checkout, pnpm, node, install, the
 * headless shell, artifact downloads) are set-up: a job that dies there tested nothing. `prepare`
 * has no body: it posts a status, picks a base and classifies the diff, and tests nothing.
 * `retry.fixture.mjs` proves this table matches the workflow file.
 */
export const JOBS = {
	prepare: { needs: [], body: [] },
	build: {
		needs: ['prepare'],
		body: ['Build the base runtime', 'Build the branch runtime', 'Plan the run'],
	},
	gates: { needs: ['prepare'], body: ["Run every game type's gates once"] },
	render: { needs: ['prepare', 'build'], body: ['Render shard '] },
	report: { needs: ['prepare', 'build', 'gates', 'render'], body: ['Compare', 'Post the status'] },
};

/** Conclusions that make a job a failed one for "re-run failed jobs". */
const FAILED = new Set(['failure', 'cancelled', 'timed_out']);

/** `render (6)` → `render`. */
export const jobKind = (name) => name.replace(/\s*\(.*\)\s*$/, '');

/** Every job `kind` depends on, transitively. */
export function needsOf(kind) {
	const seen = new Set();
	const walk = (k) => {
		for (const n of JOBS[k]?.needs ?? []) if (!seen.has(n)) (seen.add(n), walk(n));
	};
	walk(kind);
	return seen;
}

const started = (step) => !['queued', 'pending', 'waiting'].includes(step.status);
const isBody = (kind, step) => (JOBS[kind]?.body ?? []).some((p) => step.name.startsWith(p));

/**
 * How one failed job died: `infrastructure` (no runner, or lost before its body), `real` (a body
 * step started), or `unknown` (a job this table does not know: never retried). The `why` is for
 * the log.
 */
export function classifyJob(job) {
	const kind = jobKind(job.name);
	if (!JOBS[kind]) return { kind, outcome: 'unknown', why: 'not a job of current-games.yml' };
	const steps = job.steps ?? [];
	const body = steps.filter((s) => isBody(kind, s) && started(s) && s.conclusion !== 'skipped');
	if (body.length)
		return {
			kind,
			outcome: 'real',
			why: `its body ran: "${body[0].name}" ${body[0].conclusion ?? body[0].status}`,
		};
	if (!steps.some(started) && !job.runner_name)
		return {
			kind,
			outcome: 'infrastructure',
			why: `never acquired a runner (${job.conclusion}, no steps)`,
		};
	const last = [...steps].reverse().find(started);
	return {
		kind,
		outcome: 'infrastructure',
		why: `died before its body ran${last ? ` (last step "${last.name}" ${last.conclusion ?? last.status})` : ''}`,
	};
}

/**
 * The decision for one run: `{ retry, reason, jobs }`, where `jobs` lists each failed job with its
 * classification (`infrastructure` | `downstream` | `real` | `unknown`) and why.
 */
export function decideRetry({ conclusion, runAttempt, jobs }) {
	const failed = (jobs ?? []).filter((j) => FAILED.has(j.conclusion));
	const classified = failed.map((j) => ({
		name: j.name,
		conclusion: j.conclusion,
		...classifyJob(j),
	}));
	const infra = classified.filter((c) => c.outcome === 'infrastructure');
	for (const c of classified) {
		if (c.outcome !== 'real' && c.outcome !== 'unknown') continue;
		const upstream = infra.filter((i) => needsOf(c.kind).has(i.kind));
		if (c.outcome === 'real' && upstream.length) {
			c.outcome = 'downstream';
			c.why = `downstream of ${upstream.map((u) => u.name).join(', ')}: ${c.why}`;
		}
	}
	const result = (retry, reason) => ({ retry, reason, jobs: classified });
	if (conclusion !== 'failure')
		return result(false, `the run concluded "${conclusion}", not failure`);
	if (runAttempt !== 1)
		return result(false, `attempt ${runAttempt}: a run is retried at most once`);
	if (!infra.length) return result(false, 'no job died before its body ran');
	const blocking = classified.filter((c) => c.outcome === 'real' || c.outcome === 'unknown');
	if (blocking.length)
		return result(
			false,
			`a job ran and failed, so the failed set is not retried: ${blocking.map((c) => c.name).join(', ')}`,
		);
	return result(
		true,
		`${infra.length} job(s) never ran their body: ${infra.map((c) => c.name).join(', ')}`,
	);
}

// ---- the CLI ----

async function api(path, init = {}) {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const res = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			accept: 'application/vnd.github+json',
			'x-github-api-version': '2022-11-28',
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(init.headers ?? {}),
		},
	});
	if (!res.ok)
		throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
	return res.status === 204 ? undefined : res.json();
}

/** The run's conclusion and attempt, and every job of its LATEST attempt. */
export async function readRun(repository, runId) {
	const run = await api(`/repos/${repository}/actions/runs/${runId}`);
	const jobs = [];
	for (let page = 1; ; page++) {
		const got = await api(
			`/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`,
		);
		jobs.push(...got.jobs);
		if (got.jobs.length < 100) break;
	}
	return { conclusion: run.conclusion, runAttempt: run.run_attempt, jobs };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const { values: opt } = parseArgs({
		options: { run: { type: 'string' }, apply: { type: 'boolean', default: false } },
	});
	const repository = process.env.GITHUB_REPOSITORY;
	if (!opt.run || !repository) {
		console.error('usage: GITHUB_REPOSITORY=owner/repo retry.mjs --run <run id> [--apply]');
		process.exit(2);
	}
	const run = await readRun(repository, opt.run);
	const decision = decideRetry(run);
	const lines = [
		`run ${opt.run}: attempt ${run.runAttempt}, concluded ${run.conclusion}`,
		...decision.jobs.map((j) => `  ${j.name}: ${j.conclusion} — ${j.outcome}: ${j.why}`),
		`${decision.retry ? (opt.apply ? 'RETRY' : 'WOULD RETRY (dry run)') : 'no retry'}: ${decision.reason}`,
	];
	console.log(lines.join('\n'));
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`### current-games retry\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`,
		);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `retry=${decision.retry}\n`);
	if (decision.retry && opt.apply) {
		await api(`/repos/${repository}/actions/runs/${opt.run}/rerun-failed-jobs`, { method: 'POST' });
		console.log(`re-run of the failed jobs requested for run ${opt.run}`);
	}
}
