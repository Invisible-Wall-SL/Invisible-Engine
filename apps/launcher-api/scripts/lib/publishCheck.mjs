// The online Publish's checks, on a desktop build. `bake-editor-doc.mjs` runs them on every bake
// that has a token (a desktop ☁ Publish or 📦 Deliver), after the doc fetch and before any export
// writes `deploy/` or anything is compiled. A bake with no token (a dev build, CI) never asks.
//
// The PORTAL runs the checks (`GET /api/launcher/publish-check` → `src/lib/server/publishChecks.ts`,
// which calls the gate functions the online Publish calls), so a gate changed there reaches every
// desktop build the day it deploys. This file decides only what the build does with the answer:
// bake on when nothing failed or every finding was lifted, stop (exit 1) otherwise.
//
//   IE_PUBLISH_ANYWAY=1         / --publish-anyway         lift every finding that has an override
//   IE_PUBLISH_ANYWAY=<id>,<id> / --publish-anyway <ids>   lift only those
//   ALLOW_INVALID_FLOW=1        / --allow-invalid-flow     the bake's flow override = `invalid-flow`
//
// A finding with no override (`flow-wrong-kind`, `unplayable-family`) stops the build whatever is set.
//
// A CHECK THE PORTAL DID NOT ANSWER STOPS THE BUILD — a network error, a 5xx after the retries, a
// portal older than the route (404), an answer with no verdict — as the doc fetch and the deploy
// pull stop a build that has a token: "could not check" must never read as "passed". Its refusal
// names the override too, and a build lifted past it is recorded as `unchecked`.
//
// The verdict goes to the build report folder (`publish-check.json`) for the build breakdown, and
// a refusal to `IE_BUILD_REFUSAL_JSON` in the shape of the bake's other gates (`refuseAtGate`), so
// the launcher's Build refused dialog shows it and offers the override it names.

export const PUBLISH_ANYWAY = { flag: '--publish-anyway', env: 'IE_PUBLISH_ANYWAY' };
export const PUBLISH_CHECK_REPORT = 'publish-check.json';
/** The refusal's `gate` when the portal could not be asked. */
export const PUBLISH_CHECK_UNREACHABLE = 'publish-check-unreachable';

const ALL = new Set(['1', 'true', 'yes', 'on', 'all']);
const NONE = new Set(['', '0', 'false', 'no', 'off']);

/** What the caller chose to ship anyway, from the bake's argv and env: `{ all, ids }`. */
export function publishAnywayFrom(args, env) {
	const lifted = { all: false, ids: new Set() };
	const take = (value) => {
		const v = String(value ?? '')
			.trim()
			.toLowerCase();
		if (NONE.has(v)) return;
		if (ALL.has(v)) lifted.all = true;
		else for (const id of v.split(',')) if (id.trim()) lifted.ids.add(id.trim());
	};
	const at = args.indexOf(PUBLISH_ANYWAY.flag);
	if (at >= 0) {
		const next = args[at + 1];
		take(next === undefined || next.startsWith('--') ? '1' : next);
	}
	take(env[PUBLISH_ANYWAY.env]);
	if (args.includes('--allow-invalid-flow') || env.ALLOW_INVALID_FLOW === '1') {
		lifted.ids.add('invalid-flow');
	}
	return lifted;
}

/** True when the caller lifted `id`. */
export const lifts = (lifted, id) => lifted.all || lifted.ids.has(id);

const asFailure = (f) => ({
	id: String(f?.id),
	reason: String(f?.reason ?? f?.id),
	items: Array.isArray(f?.items) ? f.items.map(String) : [],
	fixIn: String(f?.fixIn ?? 'the launcher'),
	overridable: f?.overridable === true,
});

function unanswered(project, error, lifted) {
	const shipped = lifts(lifted, PUBLISH_CHECK_UNREACHABLE);
	return {
		project,
		status: shipped ? 'unchecked' : 'unreachable',
		error,
		checked: [],
		failed: [],
		overridden: shipped ? [PUBLISH_CHECK_UNREACHABLE] : [],
		blocking: shipped ? [] : [PUBLISH_CHECK_UNREACHABLE],
		override: shipped ? null : PUBLISH_ANYWAY,
	};
}

/**
 * Ask the portal and decide. `get(url)` fetches; the bake passes its retrying fetch. Never throws:
 * every failure to get a verdict is an `unreachable` (or, lifted, `unchecked`) verdict.
 *
 * `status`: `passed` · `overridden` (findings shipped anyway) · `refused` · `unreachable` ·
 * `unchecked`. `blocking` lists what stops the build; `override` is what would let it through, or
 * `null` when something blocking has none.
 */
export async function runPublishCheck({ base, project, token, lifted, get = (url) => fetch(url) }) {
	const url =
		`${base}/api/launcher/publish-check?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	let answer;
	try {
		const res = await get(url);
		if (!res.ok) {
			const body = (await res.text().catch(() => '')).slice(0, 200);
			const old =
				res.status === 404 ? ' (a portal without the publish checks, or one deploying)' : '';
			return unanswered(project, `HTTP ${res.status}${old}${body ? ` — ${body}` : ''}`, lifted);
		}
		answer = await res.json();
	} catch (err) {
		return unanswered(project, err instanceof Error ? err.message : String(err), lifted);
	}
	const failed = Array.isArray(answer?.failed) ? answer.failed.map(asFailure) : null;
	if (!failed || !Array.isArray(answer?.checked) || answer.ok !== (failed.length === 0)) {
		return unanswered(project, 'the portal answered without a verdict', lifted);
	}
	const shipped = failed.filter((f) => f.overridable && lifts(lifted, f.id));
	const blocking = failed.filter((f) => !shipped.includes(f));
	return {
		project,
		status: blocking.length ? 'refused' : shipped.length ? 'overridden' : 'passed',
		checked: answer.checked.map(String),
		failed,
		overridden: shipped.map((f) => f.id),
		blocking: blocking.map((f) => f.id),
		override: blocking.length && blocking.every((f) => f.overridable) ? PUBLISH_ANYWAY : null,
	};
}

const findingLines = (f) => [`${f.reason} Fix it in ${f.fixIn}.`, ...f.items.map((i) => `  ${i}`)];

/** The log lines that come before the bake goes on, or before its refusal (`publishCheckRefusal`). */
export function describePublishCheck(verdict) {
	const shipped = verdict.failed.filter((f) => verdict.overridden.includes(f.id));
	const lines = [];
	if (verdict.status === 'passed') {
		lines.push(
			`✓ publish checks: ${verdict.checked.join(', ')} pass (the online Publish's checks).`,
		);
	}
	if (verdict.status === 'refused') {
		lines.push('✖ publish checks: this build fails the checks the online Publish runs.');
	}
	if (verdict.status === 'unchecked') {
		lines.push(
			`⚠ publish checks: could not be run (${verdict.error}). Baking UNCHECKED because ` +
				`${PUBLISH_ANYWAY.env} lifts it: nothing checked this build's sounds, flow or family.`,
		);
	}
	if (shipped.length) {
		lines.push(`⚠ publish checks: shipping anyway (${PUBLISH_ANYWAY.env}):`);
		for (const f of shipped) lines.push(...findingLines(f).map((l) => `    ${l}`));
	}
	return lines;
}

/**
 * The bake's `refuseAtGate` arguments for a verdict that stops the build, or `null`. One finding
 * keeps its own gate id (`invalid-flow` reads exactly as the flow export's refusal); several are
 * `publish-checks`, every one listed.
 */
export function publishCheckRefusal(verdict) {
	const override = verdict.override
		? { flag: verdict.override.flag, env: verdict.override.env }
		: {};
	if (verdict.status === 'unreachable') {
		return {
			gate: PUBLISH_CHECK_UNREACHABLE,
			error:
				`Could not run the publish checks: ${verdict.error}. A desktop publish runs the online ` +
				"Publish's checks before it builds, so it stops rather than ship unchecked.",
			details: [],
			fixIn: 'the portal (check it is up, then publish again)',
			...override,
		};
	}
	if (verdict.status !== 'refused') return null;
	const blocking = verdict.failed.filter((f) => verdict.blocking.includes(f.id));
	if (blocking.length === 1) {
		const [f] = blocking;
		return { gate: f.id, error: f.reason, details: f.items, fixIn: f.fixIn, ...override };
	}
	return {
		gate: 'publish-checks',
		error: `${blocking.length} publish checks failed (the checks the online Publish runs):`,
		details: blocking.flatMap(findingLines),
		fixIn: 'the tools named above',
		...override,
	};
}

/**
 * The build breakdown's checks for `publish-check.json` (`scripts/build-breakdown.mjs`), as its
 * `{ level, title, detail, items }`. A build that passed adds none.
 */
export function publishCheckIssues(report) {
	if (!report || typeof report !== 'object') return [];
	const failed = Array.isArray(report.failed) ? report.failed.map(asFailure) : [];
	const overridden = Array.isArray(report.overridden) ? report.overridden : [];
	const blocking = Array.isArray(report.blocking) ? report.blocking : [];
	const shipped = failed.filter((f) => overridden.includes(f.id));
	const stopped = failed.filter((f) => blocking.includes(f.id));
	const issues = [];
	if (shipped.length) {
		issues.push({
			level: 'warn',
			title: 'Shipped past the publish checks',
			detail:
				`This build was told to ship anyway (${PUBLISH_ANYWAY.env}). The online Publish refuses ` +
				'the same game until these are fixed or overridden.',
			items: shipped.flatMap(findingLines),
		});
	}
	if (report.status === 'unchecked') {
		issues.push({
			level: 'warn',
			title: 'Publish checks never ran',
			detail:
				`The portal could not be asked, and this build was told to ship anyway ` +
				`(${PUBLISH_ANYWAY.env}=1): nothing checked its sounds, flow or family.`,
			items: [String(report.error ?? 'no answer')],
		});
	}
	if (report.status === 'refused' || report.status === 'unreachable') {
		issues.push({
			level: 'error',
			title: 'Stopped by the publish checks',
			detail: 'The bake refused this build; nothing past it should have run.',
			items: stopped.length ? stopped.flatMap(findingLines) : [String(report.error ?? 'no answer')],
		});
	}
	return issues;
}
