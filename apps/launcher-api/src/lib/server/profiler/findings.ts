import { and, eq, inArray } from 'drizzle-orm';
import { PERF_REPORT_MAX_BYTES, type PerfReportListItem } from '$lib/profiler';
import type { EffectiveBudget } from '$lib/profilerBudgets';
import type { PerfBuildListItem } from '$lib/profilerBuilds';
import { findings, type Finding, type OwnerMap } from '$lib/profilerFindings';
import {
	buildFacts,
	FACTS_VERSION,
	MISSING_BUILD_FACTS,
	MISSING_REPORT_FACTS,
	reportFacts,
	type BuildFacts,
	type ReportFacts,
} from '$lib/profilerFindings/facts';
import { getDb } from '../db';
import { perfBuilds, perfReports } from '../db/schema';
import { storedProjectGameType } from '../projects';
import { getObjectTextBounded } from '../r2';

/** `docs/knowledge/owners.json`, mirrored by `scripts/copy-tool-docs.mjs`. */
const ownerFiles = import.meta.glob<OwnerMap>('$lib/tool-docs/owners.json', {
	import: 'default',
	eager: true,
});
export const OWNERS: OwnerMap = Object.values(ownerFiles)[0] ?? { tools: {}, kinds: {} };

/**
 * Rows kept before P4 (or filled by an older `FACTS_VERSION`) are read from R2 by the page load and
 * filled in, this many a load and a few at a time, so a project's findings are complete after a
 * few loads without one slow page.
 */
const FILL_PER_LOAD = 12;
const FILL_AT_ONCE = 4;

/**
 * A row's facts from its file: the missing marker when the file is gone, too large or not JSON
 * (so it is not retried); undefined when R2 could not be reached — left unfilled for a later load.
 */
async function read<T>(key: string, of: (json: unknown) => T, missing: T): Promise<T | undefined> {
	let text: Awaited<ReturnType<typeof getObjectTextBounded>>;
	try {
		text = await getObjectTextBounded(key, PERF_REPORT_MAX_BYTES);
	} catch {
		return undefined;
	}
	if (typeof text !== 'string' || text === 'large' || text === 'changed') return missing;
	try {
		return of(JSON.parse(text));
	} catch {
		return missing;
	}
}

const stale = (f: { v: number } | null) => !f || f.v !== FACTS_VERSION;

/** Runs `work` over `items`, `FILL_AT_ONCE` at a time; one failing never stops the rest. */
async function eachLimited<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
	for (let i = 0; i < items.length; i += FILL_AT_ONCE) {
		await Promise.all(items.slice(i, i + FILL_AT_ONCE).map((item) => work(item).catch(() => {})));
	}
}

async function readingFacts(projectKey: string, ids: string[]): Promise<Map<string, ReportFacts>> {
	const out = new Map<string, ReportFacts>();
	if (!ids.length) return out;
	const rows = await getDb()
		.select({ id: perfReports.id, facts: perfReports.facts, r2Key: perfReports.r2Key })
		.from(perfReports)
		.where(and(eq(perfReports.projectKey, projectKey), inArray(perfReports.id, ids)));
	await eachLimited(rows.filter((r) => stale(r.facts)).slice(0, FILL_PER_LOAD), async (r) => {
		const facts = await read(r.r2Key, reportFacts, MISSING_REPORT_FACTS);
		if (!facts) return;
		await getDb().update(perfReports).set({ facts }).where(eq(perfReports.id, r.id));
		r.facts = facts;
	});
	for (const r of rows) if (r.facts && !stale(r.facts)) out.set(r.id, r.facts);
	return out;
}

async function buildFactsMap(projectKey: string, ids: string[]): Promise<Map<string, BuildFacts>> {
	const out = new Map<string, BuildFacts>();
	if (!ids.length) return out;
	const rows = await getDb()
		.select({ id: perfBuilds.id, facts: perfBuilds.facts, r2Key: perfBuilds.r2Key })
		.from(perfBuilds)
		.where(and(eq(perfBuilds.projectKey, projectKey), inArray(perfBuilds.id, ids)));
	await eachLimited(rows.filter((r) => stale(r.facts)).slice(0, FILL_PER_LOAD), async (r) => {
		const facts = await read(r.r2Key, buildFacts, MISSING_BUILD_FACTS);
		if (!facts) return;
		await getDb().update(perfBuilds).set({ facts }).where(eq(perfBuilds.id, r.id));
		r.facts = facts;
	});
	for (const r of rows) if (r.facts && !stale(r.facts)) out.set(r.id, r.facts);
	return out;
}

/** The Findings tab's ranked list for one project (`$lib/profilerFindings`). */
export async function projectFindings(
	projectKey: string,
	readings: readonly PerfReportListItem[],
	builds: readonly PerfBuildListItem[],
	budgets: readonly EffectiveBudget[],
): Promise<Finding[]> {
	const [rf, bf, gameKind] = await Promise.all([
		readingFacts(
			projectKey,
			readings.map((r) => r.id),
		),
		buildFactsMap(
			projectKey,
			builds.map((b) => b.id),
		),
		storedProjectGameType(projectKey).catch(() => null),
	]);
	return findings({
		readings,
		builds,
		readingFacts: rf,
		buildFacts: bf,
		budgets,
		gameKind,
		owners: OWNERS,
	});
}
