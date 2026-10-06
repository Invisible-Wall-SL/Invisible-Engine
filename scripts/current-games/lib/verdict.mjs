// The trusted `current-games` verdict. The harness (`current-games.yml`) renders and uploads what
// it found, but it runs the PULL REQUEST'S tree, so nothing it says may be taken as the answer: a PR
// that could post the required status could post a green one. This decides, and posts, from
// `current-games-verdict.yml`, which `workflow_run` runs from the DEFAULT branch's copy in the base
// repository's context: a PR cannot change what decides or what posts.
//
// What it trusts, and what it checks:
//   - the run itself, read from the API: its workflow file, its repository, its head commit, and for
//     a pull request that the PR is INTO MAIN, open, from this repository and still at that commit
//     (a status belongs to the head commit, which a PR into another branch would share);
//   - the jobs of that attempt, as GitHub recorded them (a job's result is not the PR's to write);
//   - `report.json` and `prepare.json`, parsed as DATA ONLY: they are never imported, required,
//     evaluated or executed, and the zip is unpacked by `unzip -p` into memory;
//   - whether the change can reach a game, decided by MAIN's `touched.mjs` over a diff of commit
//     objects fetched (never checked out) from the PR. The run's own decision is not believed: a run
//     that rendered nothing for a change main says can reach a game is a failure. A PR whose diff
//     edits the harness (`HARNESS_SOURCES`) wrote the report it would be judged by, so it fails
//     without reading it, and so does one whose diff cannot be read; a report whose base is not on
//     main fails too.
// A cancelled run fails, unless a newer run on its head will post. It never executes anything from
// the PR or from an artifact.
//
// The harness's report job calls the same `decide` (`--local`) to fail the job exactly when the
// status will be a failure, so the two cannot drift.
//
//   node scripts/current-games/lib/verdict.mjs --run <run id> --event requested|completed [--attempt <n>] [--post]
//     GITHUB_REPOSITORY=owner/repo  GITHUB_TOKEN=<read: actions, pull requests>  (optional: public API)
//     STATUS_TOKEN=<statuses: write>  (`--post` only; else a dry run that prints the decision)
//   node scripts/current-games/lib/verdict.mjs --local --report report/report.json
//     HEAD_SHA RUN_URL PREPARE BUILD GATES RENDER   (the report job's own check: exits 1 on failure)

import { spawnSync } from 'node:child_process';
import {
	appendFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { SECRET_ENV } from './redact.mjs';
import { changedFiles, classifyChange, describe, isDoc, runtimeInputs } from './touched.mjs';

export const WORKFLOW_PATH = '.github/workflows/current-games.yml';
/** The branch whose required check this is: a PR into any other branch shares its head's status. */
export const BASE_BRANCH = 'main';
/** What makes the report (the launcher's `HARNESS_SOURCES`): a PR editing it wrote its own report. */
export const HARNESS_SOURCES = [/^\.github\/workflows\//, /^scripts\/current-games\//];
export const CONTEXT = 'current-games';
export const SELF_COMPARE_TITLE = 'Current games: self-compare';
export const REPORT_ARTIFACT = 'current-games-report-json';
export const PREPARE_ARTIFACT = 'current-games-prepare';
const MAX_BYTES = 8 * 1024 * 1024;
const PENDING = 'Rendering every live game…';

/** `render (6)` → `render`. */
const jobKind = (name) => name.replace(/\s*\(.*\)\s*$/, '');

/**
 * Is this run one whose status this workflow posts, and where? `{ ok: true, context, sha, pr }`, or
 * `{ ok: false, why }`: any failure posts nothing. `pr` is the pull request re-read from the API.
 */
export function checkRun({ run, pr, repository }) {
	if (run.path !== WORKFLOW_PATH) return { ok: false, why: `not a run of ${WORKFLOW_PATH}` };
	if (run.repository?.full_name !== repository)
		return { ok: false, why: `the run belongs to ${run.repository?.full_name}, not ${repository}` };
	if (run.head_repository?.full_name !== repository)
		return {
			ok: false,
			why: `the head is in ${run.head_repository?.full_name}: a fork gets no status`,
		};
	if (run.event === 'workflow_dispatch') {
		const self = run.display_title === SELF_COMPARE_TITLE;
		return {
			ok: true,
			context: `${CONTEXT}/${self ? 'self-compare' : 'manual'}`,
			sha: run.head_sha,
		};
	}
	if (run.event !== 'pull_request') return { ok: false, why: `a ${run.event} run posts no status` };
	if (!run.pull_requests?.length) return { ok: false, why: 'the run names no pull request' };
	if (!prIntoBase(run))
		return { ok: false, why: `the run names no pull request into ${BASE_BRANCH}` };
	if (!pr) return { ok: false, why: 'the pull request could not be read' };
	if (pr.state !== 'open') return { ok: false, why: 'PR not open, nothing posted' };
	if (pr.base?.ref !== BASE_BRANCH)
		return { ok: false, why: `the pull request targets ${pr.base?.ref}, not ${BASE_BRANCH}` };
	if (pr.head?.repo?.full_name !== repository)
		return { ok: false, why: 'the pull request is from a fork' };
	if (pr.head.sha !== run.head_sha)
		return { ok: false, why: `the PR moved on (${pr.head.sha.slice(0, 7)}); the newer run posts` };
	return { ok: true, context: CONTEXT, sha: run.head_sha, pr };
}

/**
 * The run's pull request into the base branch. A commit status belongs to the head commit, so it is
 * shared by every PR with that head: a run for a PR into another branch compared against that
 * branch, and must never answer for the PR into main.
 */
export const prIntoBase = (run) =>
	run.pull_requests?.find((p) => p.base?.ref === BASE_BRANCH) ?? null;

/** The changed files that make the harness's own report, by `HARNESS_SOURCES`. */
export const harnessFiles = (files) =>
	(files ?? []).filter((f) => HARNESS_SOURCES.some((re) => re.test(f)));

/**
 * A cancelled run: nothing when a newer run of the harness exists for the same head (it posts),
 * else a failure — the status would otherwise stay `pending` forever.
 */
export function decideCancelled({ run, newer }) {
	if (newer) return { why: 'the run was cancelled; a newer run on this head posts' };
	return {
		post: {
			state: 'failure',
			description: 'The harness run was cancelled: re-run it',
			target_url: run.html_url,
		},
	};
}

/** The `requested` phase: the pending status, unless the run already finished. */
export function decideRequested({ run }) {
	if (run.status === 'completed')
		return { why: 'the run already completed; its completed event decides' };
	return { post: { state: 'pending', description: PENDING, target_url: run.html_url } };
}

/** What can a change reach? `files` is git's diff, or null when git cannot say (render). */
export function reachOf(files, inputs) {
	if (!files) return { render: true, files: null, why: 'the change set is unknown' };
	let result;
	try {
		result = classifyChange(files, inputs());
	} catch (error) {
		return { render: true, files, why: `the workspace cannot be read (${error.message})` };
	}
	if (result.kind === 'touched') return { render: true, files, why: 'the change reaches a game' };
	return {
		render: false,
		files,
		description: describe(result, files.filter((f) => !isDoc(f)).length),
	};
}

const SECRET_NAMES = new Set(SECRET_ENV);

/**
 * The status for a run that renders: from the jobs of its attempt (`{ name, conclusion }`), its
 * `report.json` and `prepare.json` (both data, either may be missing). With `reach`, a change main's
 * `touched.mjs` says cannot reach a game passes as docs-only and untouched always did. Used by the
 * verdict workflow and by the harness's own report job, so the two agree.
 *
 * The description is the report's summary line, which the harness already redacted before writing
 * it (`writeReport`); this job holds no secret to redact with.
 */
export function decide({ run, jobs, report, prepare, reach, baseOnMain }) {
	const target_url = run.html_url;
	const fail = (description) => ({
		state: 'failure',
		description: description.slice(0, 139),
		target_url,
	});
	if (reach && !reach.render)
		return { state: 'success', description: reach.description.slice(0, 140), target_url };
	// Without the diff it cannot be told whether the PR wrote the report it would be judged by.
	if (reach && reach.files === null)
		return fail(
			'The change set could not be read, so the report cannot be trusted: re-run the verdict',
		);
	// The PR wrote the report it would be judged by: the launcher refuses to approve it too.
	const edits = harnessFiles(reach?.files);
	if (edits.length)
		return fail(
			`Edits the harness (${edits[0]}${edits.length > 1 ? `, +${edits.length - 1}` : ''}): its own run cannot vouch for it; merge after review`,
		);

	const result = (kind) => {
		const of = jobs.filter((j) => jobKind(j.name) === kind);
		return of.length && of.every((j) => j.conclusion === 'success')
			? 'success'
			: (of.find((j) => j.conclusion !== 'success')?.conclusion ?? 'missing');
	};
	if (result('prepare') !== 'success') {
		const names = (prepare?.missingSecrets ?? []).filter((n) => SECRET_NAMES.has(n));
		if (!names.length) return fail('The harness could not start: see the prepare job');
		const description = `Missing secret(s): ${names.join(' ')}`;
		return {
			state: 'failure',
			description: (description.length <= 140
				? description
				: `Missing ${names.length} secrets (named in the run log): ${names.join(' ')}`
			).slice(0, 140),
			target_url,
		};
	}
	// An aborted run (no plan) writes a report without a head: it names why, so it is not stale.
	const aborted = report?.aborted;
	const stale = report && !aborted && report.head?.sha !== run.head_sha;
	const line = report?.summary?.line ?? 'no report';
	if (result('build') === 'skipped')
		return fail(
			"This change can reach a game, but the run rendered nothing (main's harness decides what renders)",
		);
	if (result('build') !== 'success')
		return fail(aborted ? String(aborted) : 'the runtime build failed');
	if (result('gates') !== 'success') return fail('the gates job did not finish');
	if (result('render') !== 'success') return fail(`a render shard died (${line})`);
	if (!report) return fail('no report');
	if (stale)
		return fail(
			`The report is for ${String(report.head?.sha ?? 'no commit').slice(0, 7)}, not this head`,
		);
	if (baseOnMain === false)
		return fail(
			`The report compared against ${String(report.base?.sha ?? 'no commit').slice(0, 7)}, which is not on ${BASE_BRANCH}`,
		);
	return {
		state: report.summary?.verdict === 'pass' ? 'success' : 'failure',
		description: String(line).slice(0, 139),
		target_url,
	};
}

// ---- the CLI ----

async function api(path, init = {}) {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const res = await fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, {
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
	return res;
}
const json = async (path) => (await api(path)).json();

async function paginate(path, key) {
	const all = [];
	for (let page = 1; ; page++) {
		const got = await json(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
		all.push(...got[key]);
		if (got[key].length < 100) return all;
	}
}

/** One JSON file of a run's artifact, parsed as data; undefined when there is none or it is odd. */
async function artifactJson(repository, runId, name, file) {
	const found = (
		await paginate(`/repos/${repository}/actions/runs/${runId}/artifacts`, 'artifacts')
	)
		.filter((a) => a.name === name && !a.expired)
		.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
	if (!found) return undefined;
	if (found.size_in_bytes > MAX_BYTES) {
		console.error(`${name} is ${found.size_in_bytes} bytes: refused`);
		return undefined;
	}
	const zip = Buffer.from(
		await (await api(`/repos/${repository}/actions/artifacts/${found.id}/zip`)).arrayBuffer(),
	);
	if (zip.length > MAX_BYTES) return undefined;
	const dir = mkdtempSync(join(tmpdir(), 'verdict-'));
	try {
		writeFileSync(join(dir, 'a.zip'), zip);
		const out = spawnSync('unzip', ['-p', join(dir, 'a.zip'), file], { maxBuffer: MAX_BYTES });
		if (out.status !== 0 || out.error) return undefined;
		return JSON.parse(out.stdout.toString('utf8'));
	} catch (error) {
		console.error(`${name}/${file} is not usable: ${error.message}`);
		return undefined;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Can the PR's change reach a game, by main's rules? Objects are fetched, nothing is checked out. */
function prReach(pr, headSha) {
	const fetched = spawnSync('git', ['fetch', '-q', '--no-tags', 'origin', headSha, pr.base.sha], {
		encoding: 'utf8',
	});
	if (fetched.status !== 0) return reachOf(null);
	const base = spawnSync('git', ['merge-base', pr.base.sha, headSha], { encoding: 'utf8' });
	if (base.status !== 0) return reachOf(null);
	return reachOf(changedFiles(base.stdout.trim(), headSha), runtimeInputs);
}

/** Is `sha` on the base branch? Fetched first; one that cannot be fetched is not. */
function onBaseBranch(sha) {
	// Report data reaches git as an argument: only a full commit id, never an option.
	if (!/^[0-9a-f]{40}$/.test(sha)) return false;
	const fetched = spawnSync(
		'git',
		[
			'fetch',
			'-q',
			'--no-tags',
			'origin',
			`+refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}`,
			sha,
		],
		{ encoding: 'utf8' },
	);
	if (fetched.status !== 0) return false;
	return (
		spawnSync('git', ['merge-base', '--is-ancestor', sha, `origin/${BASE_BRANCH}`]).status === 0
	);
}

/** The `completed` phase of a run that was not cancelled. */
async function decideCompleted(run, checked, attempt, repository, lines) {
	let reach = { render: true, why: 'a manual run renders what it was asked to' };
	if (run.event === 'pull_request') reach = prReach(checked.pr, run.head_sha);
	else if (run.display_title === SELF_COMPARE_TITLE) reach = { render: true, why: 'self-compare' };
	lines.push(
		reach.render
			? `main's touched.mjs: renders (${reach.why})`
			: `main's touched.mjs: ${reach.description}`,
	);
	if (!reach.render) return decide({ run, jobs: [], reach });
	const jobs = await paginate(
		`/repos/${repository}/actions/runs/${run.id}/attempts/${attempt}/jobs`,
		'jobs',
	);
	const report = await artifactJson(repository, run.id, REPORT_ARTIFACT, 'report.json');
	const prepare = await artifactJson(repository, run.id, PREPARE_ARTIFACT, 'prepare.json');
	// A PR's report must compare against main: a base off main could hide the change.
	const baseOnMain =
		run.event === 'pull_request' && report?.base?.sha
			? onBaseBranch(String(report.base.sha))
			: undefined;
	return decide({ run, jobs, report, prepare, reach, baseOnMain });
}

const summarize = (lines) => {
	console.log(lines.join('\n'));
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`### current-games verdict\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`,
		);
};

async function runLocal(reportPath) {
	let report;
	if (existsSync(reportPath))
		try {
			report = JSON.parse(readFileSync(reportPath, 'utf8'));
		} catch {}
	const e = process.env;
	const decision = decide({
		run: { head_sha: e.HEAD_SHA, html_url: e.RUN_URL },
		jobs: ['prepare', 'build', 'gates', 'render'].map((name) => ({
			name,
			conclusion: e[name.toUpperCase()],
		})),
		report,
	});
	summarize([`${decision.state}: ${decision.description}`]);
	if (decision.state !== 'success') process.exitCode = 1;
}

async function runRemote(opt, repository) {
	const run = await json(`/repos/${repository}/actions/runs/${opt.run}`);
	const lines = [
		`run ${run.id}: ${run.event}, attempt ${run.run_attempt}, ${run.status}/${run.conclusion}, head ${run.head_sha}`,
	];
	const stop = (why) => {
		summarize([...lines, `nothing posted: ${why}`]);
	};
	const prNumber = prIntoBase(run)?.number;
	const pr =
		run.event === 'pull_request' && prNumber
			? await json(`/repos/${repository}/pulls/${prNumber}`)
			: undefined;
	const checked = checkRun({ run, pr, repository });
	if (!checked.ok) return stop(checked.why);
	lines.push(`context ${checked.context} on ${checked.sha}`);

	let decision;
	if (opt.event === 'requested') {
		const d = decideRequested({ run });
		if (!d.post) return stop(d.why);
		decision = d.post;
	} else {
		if (run.status !== 'completed') return stop('the run has not completed');
		const attempt = Number(opt.attempt ?? run.run_attempt);
		if (attempt !== run.run_attempt)
			return stop(
				`attempt ${attempt} is not the latest (${run.run_attempt}); its own event decides`,
			);
		if (run.conclusion === 'cancelled') {
			const { workflow_runs: runs } = await json(
				`/repos/${repository}/actions/runs?head_sha=${run.head_sha}&per_page=100`,
			);
			const newer = runs.some(
				(r) => r.id > run.id && r.path === WORKFLOW_PATH && r.event === run.event,
			);
			const d = decideCancelled({ run, newer });
			if (!d.post) return stop(d.why);
			decision = d.post;
		} else decision = await decideCompleted(run, checked, attempt, repository, lines);
	}
	lines.push(`${decision.state}: ${decision.description}`);
	if (!opt.post) return summarize([...lines, 'dry run: nothing posted']);
	if (!process.env.STATUS_TOKEN) throw new Error('--post needs STATUS_TOKEN');
	await api(`/repos/${repository}/statuses/${checked.sha}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${process.env.STATUS_TOKEN}` },
		body: JSON.stringify({ ...decision, context: checked.context }),
	});
	summarize([...lines, `posted ${checked.context}`]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const { values: opt } = parseArgs({
		options: {
			run: { type: 'string' },
			attempt: { type: 'string' },
			event: { type: 'string' },
			post: { type: 'boolean', default: false },
			local: { type: 'boolean', default: false },
			report: { type: 'string', default: 'report/report.json' },
		},
	});
	const repository = process.env.GITHUB_REPOSITORY;
	if (opt.local) await runLocal(opt.report);
	else if (opt.run && repository && ['requested', 'completed'].includes(opt.event))
		await runRemote(opt, repository);
	else {
		console.error(
			'usage: GITHUB_REPOSITORY=owner/repo verdict.mjs --run <id> --event requested|completed [--attempt <n>] [--post]\n       verdict.mjs --local [--report report/report.json]',
		);
		process.exit(2);
	}
}
