// Is every Railway service running the code `main` says it should? Run by the "Deploy drift"
// workflow after every push to main (.github/workflows/deploy-drift.yml), or by hand from a full
// clone:
//
//   node scripts/deploy-drift.mjs        # probe the live services; exit 3 when one has drifted
//
// WHY THIS EXISTS. Railway deploys on GitHub's push webhook, and a push it missed — Railway down,
// the webhook dropped — is never retried. The launcher catches up on the next push, because it
// rebuilds on every push. A service with Watch Paths does not: it rebuilds only on a push that
// touches its own files, so a deploy it missed stays missing until someone notices the old code.
//
// HOW. Each service reports the commit it runs (`commit`, 12 chars of RAILWAY_GIT_COMMIT_SHA). Its
// PENDING commits are the ones on `main` after that commit which touch its watch paths (every
// commit, for the launcher). One older than GRACE_MINUTES is a deploy that should have happened
// and didn't. A newer one is a deploy still in flight: Railway can take half an hour
// (docs/INFRA.md "How to tell whether a push actually deployed").
//
// It needs the history back to the oldest running commit (a full or `blob:none` clone).

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Railway's own build queue can sit at half an hour on a normal day. */
export const GRACE_MINUTES = 45;

/**
 * Every repo-root Railway service, with the Watch Paths its Railway settings list (docs/INFRA.md,
 * which `deploy-drift.fixture.mjs` holds this table to). `watch: null` = no watch paths (rebuilds
 * on every push); `health: null` = no public URL to ask.
 */
export const SERVICES = [
	{ name: 'launcher', health: 'https://app.invisiblewall.org/api/health', watch: null },
	{
		name: 'atlas-tool',
		health: 'https://atlas-tool-production.up.railway.app/healthz',
		watch: ['services/atlas-tool/**', 'services/_shared/**'],
	},
	{
		name: 'sheet-tool',
		health: 'https://sheet-tool-production.up.railway.app/healthz',
		watch: ['services/sheet-tool/**', 'services/_shared/**'],
	},
	{
		name: 'Invisible-test-Server',
		health: 'https://games.invisiblewall.org/healthz',
		watch: ['services/test-server/**', 'scripts/mock-rgs-server*.mjs'],
	},
	{
		name: 'director-worker',
		health: null,
		watch: ['services/director-worker/**', 'packages/director-costs/**'],
	},
];

/**
 * The verdict for one service. `pending` = the commits after the running one that touch its watch
 * paths, oldest first, as `{ sha, subject, time }` (seconds). Pure, so the fixture can pin it.
 *
 * - `current`   — nothing pending.
 * - `deploying` — pending, but every commit is still inside the grace window.
 * - `behind`    — a pending commit is older than the grace window: a missed deploy.
 * - `off-main`  — the running commit is not on `main` (a manual deploy of another branch).
 */
export function verdict({ onMain, pending, now, graceMinutes = GRACE_MINUTES }) {
	if (!onMain) return 'off-main';
	if (pending.length === 0) return 'current';
	const overdue = pending.some((c) => now - c.time > graceMinutes * 60);
	return overdue ? 'behind' : 'deploying';
}

/** The verdicts that mean "act": everything else is fine or someone else's alarm. */
export const DRIFTED = new Set(['behind', 'off-main']);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function resolveCommit(short) {
	try {
		return git('rev-parse', '--verify', '--quiet', `${short}^{commit}`);
	} catch {
		return null;
	}
}

/** The commits after `running` on HEAD that touch `watch` (all of them when null), oldest first. */
export function pendingCommits(running, watch) {
	const out = git(
		'log',
		'--reverse',
		'--format=%H%x09%ct%x09%s',
		`${running}..HEAD`,
		...(watch ? ['--', ...watch.map((p) => `:(glob)${p}`)] : []),
	);
	return out
		? out.split('\n').map((line) => {
				const [sha, time, subject] = line.split('\t');
				return { sha, time: Number(time), subject };
			})
		: [];
}

async function runningCommit(url) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
		// A 503 health answer still names its commit (an unready launcher), so read the body anyway.
		const body = await res.json();
		return { commit: typeof body.commit === 'string' ? body.commit : '' };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

/** Probe every service; returns one row each, `status` one of the verdicts or a probe problem. */
export async function probe(now = Math.floor(Date.now() / 1000)) {
	const rows = [];
	for (const service of SERVICES) {
		if (!service.health) {
			rows.push({ service, status: 'not-probed', note: 'no public URL' });
			continue;
		}
		const answer = await runningCommit(service.health);
		if (answer.error) {
			// Down is the uptime monitor's alarm (docs/INFRA.md "Monitoring"), not this one's.
			rows.push({ service, status: 'unreachable', note: answer.error });
			continue;
		}
		if (!answer.commit) {
			rows.push({ service, status: 'unknown', note: 'its health answer names no commit' });
			continue;
		}
		const full = resolveCommit(answer.commit);
		if (!full) {
			rows.push({ service, status: 'unknown', note: `${answer.commit} is not in this clone` });
			continue;
		}
		let onMain = true;
		try {
			git('merge-base', '--is-ancestor', full, 'HEAD');
		} catch {
			onMain = false;
		}
		const pending = onMain ? pendingCommits(full, service.watch) : [];
		rows.push({
			service,
			running: answer.commit,
			pending,
			status: verdict({ onMain, pending, now }),
		});
	}
	return rows;
}

/** The report, in markdown, for the terminal, the job log and the alert issue alike. */
export function report(rows, head, now = Math.floor(Date.now() / 1000)) {
	const lines = [
		`\`main\` is at ${head.slice(0, 12)}. A pending commit older than ${GRACE_MINUTES} min is a missed deploy.`,
		'',
	];
	for (const row of rows) {
		const running = row.running ? ` — running ${row.running}` : '';
		const note = row.note ? ` (${row.note})` : '';
		lines.push(`- **${row.service.name}**: ${row.status}${running}${note}`);
		for (const c of row.pending ?? []) {
			const age = Math.round((now - c.time) / 60);
			lines.push(`  - ${c.sha.slice(0, 12)} ${age} min ago — ${c.subject}`);
		}
	}
	return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const rows = await probe();
	console.log(report(rows, git('rev-parse', 'HEAD')));
	// 3, not 1: an uncaught error also exits 1, and a crash must never read as drift.
	process.exit(rows.some((r) => DRIFTED.has(r.status)) ? 3 : 0);
}
