/**
 * The monthly cost history behind Admin → Costs.
 *
 * Months are **Europe/Madrid calendar months** grouped into calendar years, because
 * the Spanish tax year is the calendar year and the table exists to be filed against.
 *
 * How a month gets its number:
 *
 * 1. While the month is **open**, every snapshot rewrites its row from the live
 *    month-to-date estimate. The figure rises and falls during the month exactly as
 *    the providers revise it — that is the intended behaviour, not drift.
 * 2. The first snapshot taken **after** the month ends stamps `lockedAt`, freezing
 *    whatever value was last observed. From then on it is never recomputed.
 *
 * Locking is what makes the table trustworthy: a filed number must stop moving. It is
 * also the only option available — the providers cannot rebuild a past month. RunPod
 * exposes no spend history whatsoever, Railway reports current-cycle only, and R2's
 * analytics retention is short.
 *
 * **The known cost of that design:** a month is frozen at the last value seen *while
 * the page was being used*. If nobody opens Costs for the last few days of a month,
 * those days are missing from the locked figure. The EUR column is the corrective —
 * it holds the real bank charge, so the authoritative number is never the estimate.
 */

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { costMonths } from '../db/schema';
import type { ProviderId } from './types';

const ZONE = 'Europe/Madrid';

/** A year+month pair in the Madrid calendar. */
export interface YearMonth {
	year: number;
	month: number;
}

/**
 * Offset of `ZONE` from UTC at a given instant, in ms. Derived by formatting the same
 * instant twice rather than hardcoding +1/+2, so DST is handled by the platform.
 */
function zoneOffsetMs(at: Date): number {
	const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
	const local = new Date(at.toLocaleString('en-US', { timeZone: ZONE }));
	return local.getTime() - utc.getTime();
}

/** The Madrid calendar year+month containing `at`. */
export function madridMonth(at: Date = new Date()): YearMonth {
	// en-CA formats as YYYY-MM-DD, which parses without locale ambiguity.
	const [year, month] = new Intl.DateTimeFormat('en-CA', {
		timeZone: ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	})
		.format(at)
		.split('-')
		.map(Number);
	return { year, month };
}

/** The UTC instant at which a Madrid calendar month begins. */
export function startOfMadridMonth({ year, month }: YearMonth): Date {
	const naive = Date.UTC(year, month - 1, 1, 0, 0, 0);
	// Spain's DST switches happen at the end of March and October, never at a month
	// boundary, so the offset at the naive instant is the offset that actually applies.
	return new Date(naive - zoneOffsetMs(new Date(naive)));
}

/** How far through the current Madrid month we are, as `{ elapsed, total }` days. */
export function madridMonthProgress(at: Date = new Date()): { elapsed: number; total: number } {
	const ym = madridMonth(at);
	const start = startOfMadridMonth(ym);
	const next = startOfMadridMonth(
		ym.month === 12 ? { year: ym.year + 1, month: 1 } : { year: ym.year, month: ym.month + 1 },
	);
	const total = Math.round((next.getTime() - start.getTime()) / 86_400_000);
	const elapsed = Math.min(total, Math.max(1, (at.getTime() - start.getTime()) / 86_400_000));
	return { elapsed, total };
}

/** `2026-08` — a sortable key used to compare months without date maths. */
function key({ year, month }: YearMonth): number {
	return year * 12 + (month - 1);
}

/**
 * Reserved `provider` value for the MONTH-LEVEL euro figure.
 *
 * The USD estimate is naturally per provider, but the euro number an admin types is
 * what the bank charged for the month as a whole — that's the figure that gets filed.
 * Storing it under a reserved key keeps it in the same table (one month, one row set)
 * without inventing a parallel table, and it is excluded from every USD rollup.
 */
export const TOTAL_KEY = 'total';

export type MonthProvider = ProviderId | typeof TOTAL_KEY;

export interface MonthRow {
	provider: MonthProvider;
	year: number;
	month: number;
	amountUsd: number;
	/** True when the USD figure was typed in rather than measured. */
	manual: boolean;
	/** What the bank actually charged, when an admin has entered it. */
	eur: number | null;
	locked: boolean;
	note: string | null;
}

/**
 * Write the open month's running totals and lock anything older.
 *
 * Called from the snapshot path, so it runs at most once per cache miss (~6×/hour at
 * worst). Fails soft: the monthly table is a reporting surface, and losing an update
 * must never break the live cards it sits under.
 */
/**
 * Longest gap we'll bill an accumulating provider for in one step.
 *
 * RunPod's month is integrated from its burn rate, so a long outage (or a cold boot
 * after days idle) would otherwise book the whole gap at the CURRENT rate — even
 * though the pods may have been stopped for most of it. Capping under-counts a real
 * outage rather than inventing spend, which is the safer direction for a figure
 * nobody can reconstruct afterwards.
 */
const MAX_ACCRUAL_GAP_H = 12;

export interface MeasuredProvider {
	provider: ProviderId;
	/** A period total: replaces whatever is stored. */
	spendUsd?: number | null;
	/**
	 * A burn RATE, for providers that publish no period total (RunPod). Integrated
	 * across the gap since this row was last written and ADDED to the running figure.
	 */
	ratePerHourUsd?: number | null;
}

export async function recordAndLock(
	measured: MeasuredProvider[],
	at: Date = new Date(),
): Promise<void> {
	const now = madridMonth(at);
	const db = getDb();

	// 1. Freeze every still-open row belonging to a month that has already ended.
	//    Compared as (year, month) tuples rather than dates, so no timezone maths.
	await db
		.update(costMonths)
		.set({ lockedAt: at })
		.where(
			and(
				isNull(costMonths.lockedAt),
				or(
					lt(costMonths.year, now.year),
					and(eq(costMonths.year, now.year), lt(costMonths.month, now.month)),
				),
			),
		);

	// 2. Rewrite the open month from the live estimate. Providers with no spend figure
	//    (RunPod publishes a balance and a rate, never a period total) are skipped
	//    rather than written as 0 — a zero would read as "this cost nothing".
	const monthStart = startOfMadridMonth(now);
	for (const entry of measured) {
		let cents: number;

		if (entry.spendUsd != null && Number.isFinite(entry.spendUsd)) {
			cents = Math.round(entry.spendUsd * 100);
		} else if (entry.ratePerHourUsd != null && Number.isFinite(entry.ratePerHourUsd)) {
			// Integrate the rate across the gap since this row was last touched. The
			// first write of a month accrues from the month's start (capped), so a fresh
			// month doesn't begin by discarding the interval before the first snapshot.
			const [existing] = await db
				.select({ amountUsdCents: costMonths.amountUsdCents, updatedAt: costMonths.updatedAt })
				.from(costMonths)
				.where(
					and(
						eq(costMonths.provider, entry.provider),
						eq(costMonths.year, now.year),
						eq(costMonths.month, now.month),
					),
				);
			const since = existing ? existing.updatedAt.getTime() : monthStart.getTime();
			const gapH = Math.max(0, Math.min((at.getTime() - since) / 3_600_000, MAX_ACCRUAL_GAP_H));
			const accrued = Math.round(entry.ratePerHourUsd * gapH * 100);
			cents = (existing?.amountUsdCents ?? 0) + accrued;
		} else {
			continue;
		}

		await db
			.insert(costMonths)
			.values({
				provider: entry.provider,
				year: now.year,
				month: now.month,
				amountUsdCents: cents,
				updatedAt: at,
			})
			.onConflictDoUpdate({
				target: [costMonths.provider, costMonths.year, costMonths.month],
				// Only while still open AND not hand-entered: a locked month must not be
				// revived by a late snapshot, and a typed figure must never be silently
				// replaced by an estimate.
				setWhere: and(isNull(costMonths.lockedAt), eq(costMonths.manualUsd, false)),
				set: { amountUsdCents: cents, updatedAt: at },
			});
	}
}

/** Every recorded month, newest first. */
export async function listMonths(): Promise<MonthRow[]> {
	const rows = await getDb()
		.select()
		.from(costMonths)
		.orderBy(sql`${costMonths.year} desc, ${costMonths.month} desc`);
	return rows.map((r) => ({
		provider: r.provider as MonthProvider,
		year: r.year,
		month: r.month,
		amountUsd: r.amountUsdCents / 100,
		manual: r.manualUsd,
		eur: r.eurCents == null ? null : r.eurCents / 100,
		locked: r.lockedAt != null,
		note: r.note,
	}));
}

/** One month in the UI: per-provider USD, the total, and the real EUR charge. */
export interface MonthSummary {
	year: number;
	month: number;
	/** USD per provider id. */
	byProvider: Record<string, number>;
	/** Provider ids whose USD figure was typed in rather than measured. */
	manualProviders: string[];
	totalUsd: number;
	/** Sum of entered EUR charges; null when nothing has been entered for the month. */
	totalEur: number | null;
	locked: boolean;
	/** Change in total USD vs the previous month, or null when there's nothing before. */
	deltaUsd: number | null;
}

export interface YearSummary {
	year: number;
	/** Newest month first — the order the table renders. */
	months: MonthSummary[];
	totalUsd: number;
	totalEur: number | null;
}

/**
 * Roll the flat rows into calendar years. Deltas are computed against the
 * chronologically previous month **across the year boundary**, so January is compared
 * with the previous December rather than showing no change.
 */
export function summarize(rows: MonthRow[]): YearSummary[] {
	const byMonth = new Map<number, MonthSummary>();
	for (const row of rows) {
		const k = key(row);
		let entry = byMonth.get(k);
		if (!entry) {
			entry = {
				year: row.year,
				month: row.month,
				byProvider: {},
				manualProviders: [],
				totalUsd: 0,
				totalEur: null,
				locked: row.locked,
				deltaUsd: null,
			};
			byMonth.set(k, entry);
		}
		if (row.provider === TOTAL_KEY) {
			// The month-level euro row carries no USD — it exists only to hold the real
			// bank charge, and folding its (always zero) amount into the estimate would
			// be harmless but misleading to read in the code.
			if (row.eur != null) entry.totalEur = row.eur;
		} else {
			entry.byProvider[row.provider] = (entry.byProvider[row.provider] ?? 0) + row.amountUsd;
			entry.totalUsd += row.amountUsd;
			if (row.manual) entry.manualProviders.push(row.provider);
			// A month is only "locked" once every provider row for it is locked.
			entry.locked = entry.locked && row.locked;
		}
	}

	const ascending = [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
	for (let i = 1; i < ascending.length; i++) {
		// Only a genuinely adjacent month is a fair comparison; a gap in the data
		// would otherwise show as a huge swing.
		const prev = ascending[i - 1];
		const cur = ascending[i];
		if (key(cur) - key(prev) === 1) cur.deltaUsd = cur.totalUsd - prev.totalUsd;
	}

	const years = new Map<number, YearSummary>();
	for (const m of ascending) {
		let y = years.get(m.year);
		if (!y) {
			y = { year: m.year, months: [], totalUsd: 0, totalEur: null };
			years.set(m.year, y);
		}
		y.months.push(m);
		y.totalUsd += m.totalUsd;
		if (m.totalEur != null) y.totalEur = (y.totalEur ?? 0) + m.totalEur;
	}

	return [...years.values()]
		.sort((a, b) => b.year - a.year)
		.map((y) => ({ ...y, months: y.months.reverse() }));
}

/**
 * Hand-enter the USD figure for one provider-month.
 *
 * The escape hatch for providers that cannot report a period total: RunPod (balance
 * and burn rate only) and Railway (usage units only — its measurement enum has no
 * cost member). Without this their months read as `—` and the total silently
 * under-counts, which on a tax record is the worst kind of wrong.
 *
 * Sets `manualUsd`, which `recordAndLock` treats as a write guard, so the typed
 * figure survives every later snapshot. Passing `null` clears it and hands the cell
 * back to the estimator.
 */
export async function setMonthUsd(input: {
	provider: MonthProvider;
	year: number;
	month: number;
	usd: number | null;
	userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	if (input.month < 1 || input.month > 12 || input.year < 2000 || input.year > 2200) {
		return { ok: false, error: 'That month is out of range.' };
	}
	if (input.usd == null) {
		await getDb()
			.update(costMonths)
			.set({ manualUsd: false, amountUsdCents: 0, updatedBy: input.userId, updatedAt: new Date() })
			.where(
				and(
					eq(costMonths.provider, input.provider),
					eq(costMonths.year, input.year),
					eq(costMonths.month, input.month),
				),
			);
		return { ok: true };
	}
	const cents = Math.round(input.usd * 100);
	if (!Number.isFinite(cents) || cents < 0) {
		return { ok: false, error: 'Enter the amount as a positive number.' };
	}
	if (cents > 10_000_000) {
		return { ok: false, error: 'That looks like a typo — the cap is $100,000 per month.' };
	}
	await getDb()
		.insert(costMonths)
		.values({
			provider: input.provider,
			year: input.year,
			month: input.month,
			amountUsdCents: cents,
			manualUsd: true,
			updatedBy: input.userId,
		})
		.onConflictDoUpdate({
			target: [costMonths.provider, costMonths.year, costMonths.month],
			set: {
				amountUsdCents: cents,
				manualUsd: true,
				updatedBy: input.userId,
				updatedAt: new Date(),
			},
		});
	return { ok: true };
}

/**
 * Write imported history in one go.
 *
 * Every row is marked `manualUsd` — these are invoice figures, and the estimator must
 * never overwrite them. Past months are locked immediately rather than waiting for the
 * next rollover, since an imported month is already final by definition. The CURRENT
 * month is left open so it keeps tracking live.
 *
 * Returns how many rows were written, so the UI can confirm the paste landed.
 */
export async function importMonths(
	rows: { provider: ProviderId; year: number; month: number; usd: number }[],
	userId: string,
	at: Date = new Date(),
): Promise<number> {
	const open = madridMonth(at);
	const db = getDb();
	let written = 0;

	for (const row of rows) {
		if (row.month < 1 || row.month > 12 || row.year < 2000 || row.year > 2200) continue;
		const cents = Math.round(row.usd * 100);
		if (!Number.isFinite(cents) || cents < 0) continue;

		const isPast = row.year < open.year || (row.year === open.year && row.month < open.month);
		const values = {
			provider: row.provider,
			year: row.year,
			month: row.month,
			amountUsdCents: cents,
			manualUsd: true,
			lockedAt: isPast ? at : null,
			updatedBy: userId,
		};
		await db
			.insert(costMonths)
			.values(values)
			.onConflictDoUpdate({
				target: [costMonths.provider, costMonths.year, costMonths.month],
				set: {
					amountUsdCents: cents,
					manualUsd: true,
					lockedAt: values.lockedAt,
					updatedBy: userId,
					updatedAt: at,
				},
			});
		written++;
	}
	return written;
}

/**
 * Set (or clear) the euro amount actually charged for one provider-month. Passing
 * `null` clears it. Rejects an absurd figure rather than storing a typo that would
 * skew a year total.
 */
export async function setMonthEur(input: {
	provider: MonthProvider;
	year: number;
	month: number;
	eur: number | null;
	userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	if (input.month < 1 || input.month > 12 || input.year < 2000 || input.year > 2200) {
		return { ok: false, error: 'That month is out of range.' };
	}
	let cents: number | null = null;
	if (input.eur != null) {
		cents = Math.round(input.eur * 100);
		if (!Number.isFinite(cents) || cents < 0) {
			return { ok: false, error: 'Enter the euro amount as a positive number.' };
		}
		if (cents > 10_000_000) {
			return { ok: false, error: 'That looks like a typo — the cap is €100,000 per month.' };
		}
	}
	await getDb()
		.insert(costMonths)
		.values({
			provider: input.provider,
			year: input.year,
			month: input.month,
			amountUsdCents: 0,
			eurCents: cents,
			updatedBy: input.userId,
		})
		.onConflictDoUpdate({
			target: [costMonths.provider, costMonths.year, costMonths.month],
			set: { eurCents: cents, updatedBy: input.userId, updatedAt: new Date() },
		});
	return { ok: true };
}
