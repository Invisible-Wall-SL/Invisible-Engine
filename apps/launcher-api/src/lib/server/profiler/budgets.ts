import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
	type BudgetKey,
	type BudgetMetric,
	type BudgetOverride,
	type BudgetPhase,
	type BudgetScope,
	type BudgetThresholds,
} from '$lib/profilerBudgets';
import { getDb } from '../db';
import { perfBudgets, type PerfBudget } from '../db/schema';

/**
 * A fresh revision token for a written line. Random, not a counter: a counter restarting at 1
 * after a reset would let an edit made against the OLD row's 1 land on a NEW override (reset, then
 * re-override, between someone's read and their save).
 */
export const REV_LIMIT = 2 ** 31;
/** Never the one it replaces, so a stale tab holding it cannot match the new row. */
const newRev = (old: number | null = null): number => {
	let rev = randomInt(1, REV_LIMIT);
	while (rev === old) rev = randomInt(1, REV_LIMIT);
	return rev;
};

export function toOverride(r: PerfBudget): BudgetOverride {
	return {
		deviceClass: r.deviceClass as BudgetScope,
		metric: r.metric as BudgetMetric,
		phase: r.phase as BudgetPhase,
		warn: r.warn,
		fail: r.fail,
		rev: r.rev,
		updatedAt: r.updatedAt.toISOString(),
		updatedBy: r.updatedBy,
	};
}

/** A project's overrides; every other line is the studio default. */
export async function listBudgetOverrides(projectKey: string): Promise<BudgetOverride[]> {
	const rows = await getDb()
		.select()
		.from(perfBudgets)
		.where(eq(perfBudgets.projectKey, projectKey));
	return rows.map(toOverride);
}

const keyIs = (projectKey: string, k: BudgetKey) =>
	and(
		eq(perfBudgets.projectKey, projectKey),
		eq(perfBudgets.deviceClass, k.deviceClass),
		eq(perfBudgets.metric, k.metric),
		eq(perfBudgets.phase, k.phase),
	);

async function current(projectKey: string, k: BudgetKey): Promise<BudgetOverride | null> {
	const [row] = await getDb().select().from(perfBudgets).where(keyIs(projectKey, k));
	return row ? toOverride(row) : null;
}

/**
 * What a save is made against: the override's `rev` as the editor last saw it, or null when it saw
 * the studio default (no override).
 */
export type BudgetExpected = number | null;

export type BudgetWriteResult =
	| { ok: true; override: BudgetOverride | null }
	/** Someone else changed this line first; `current` is what it is now (null: the default). */
	| { ok: false; current: BudgetOverride | null };

/**
 * Sets one line's override, only while it is still what the editor saw: a first override inserts
 * only if no row exists (two people overriding the default at once — one wins, one is told); an
 * edit updates only the revision it was made against and gives it a new one. Never a
 * read-modify-write: the condition is in the one statement that writes.
 */
export async function setBudget(
	projectKey: string,
	key: BudgetKey,
	t: BudgetThresholds,
	expected: BudgetExpected,
	userId: string,
): Promise<BudgetWriteResult> {
	const db = getDb();
	const rows =
		expected === null
			? await db
					.insert(perfBudgets)
					.values({
						projectKey,
						...key,
						warn: t.warn,
						fail: t.fail,
						rev: newRev(),
						updatedBy: userId,
					})
					.onConflictDoNothing()
					.returning()
			: await db
					.update(perfBudgets)
					.set({
						warn: t.warn,
						fail: t.fail,
						rev: newRev(expected),
						updatedBy: userId,
						updatedAt: new Date(),
					})
					.where(and(keyIs(projectKey, key), eq(perfBudgets.rev, expected)))
					.returning();
	if (rows.length) return { ok: true, override: toOverride(rows[0]) };
	return { ok: false, current: await current(projectKey, key) };
}

/**
 * Drops one line's override, so the studio default applies again — only the revision the editor
 * saw. Resetting a line that is already the default is a no-op success; resetting one someone else
 * changed meanwhile is refused with what it is now.
 */
export async function resetBudget(
	projectKey: string,
	key: BudgetKey,
	expected: BudgetExpected,
): Promise<BudgetWriteResult> {
	if (expected === null) {
		const now = await current(projectKey, key);
		return now ? { ok: false, current: now } : { ok: true, override: null };
	}
	const rows = await getDb()
		.delete(perfBudgets)
		.where(and(keyIs(projectKey, key), eq(perfBudgets.rev, expected)))
		.returning({ projectKey: perfBudgets.projectKey });
	if (rows.length) return { ok: true, override: null };
	const now = await current(projectKey, key);
	return now ? { ok: false, current: now } : { ok: true, override: null };
}
