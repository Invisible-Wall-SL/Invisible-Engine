/**
 * The manual top-up ledger behind Admin → Costs.
 *
 * Only RunPod tells us a real balance. For every other provider the best available
 * answer to "how much credit is left?" is: what an admin recorded adding, minus what
 * the provider reports spending since that date. That is an ESTIMATE built on a human
 * claim — `remainingUsd` is presented as such, never as a balance.
 *
 * Reads/writes go through here so the cents↔dollars conversion happens in exactly one
 * place; the table stores integer cents (see `schema.ts`), the UI speaks dollars.
 */

import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { costTopUps } from '../db/schema';
import type { ProviderId } from './types';

export interface TopUpEntry {
	id: string;
	provider: ProviderId;
	amountUsd: number;
	occurredAt: Date;
	note: string | null;
}

/** Largest single top-up we'll accept, as a typo guard ($100,000). */
const MAX_CENTS = 10_000_000;

/** Every recorded top-up, newest first. */
export async function listTopUps(): Promise<TopUpEntry[]> {
	const rows = await getDb().select().from(costTopUps).orderBy(desc(costTopUps.occurredAt));
	return rows.map((r) => ({
		id: r.id,
		provider: r.provider as ProviderId,
		amountUsd: r.amountCents / 100,
		occurredAt: r.occurredAt,
		note: r.note,
	}));
}

/**
 * Record a top-up. `amountUsd` is rounded to whole cents; a non-finite, zero, negative,
 * or absurd amount is rejected rather than stored (a bad row silently skews the
 * burndown for everyone).
 */
export async function addTopUp(input: {
	provider: ProviderId;
	amountUsd: number;
	occurredAt: Date;
	note: string | null;
	userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	const cents = Math.round(input.amountUsd * 100);
	if (!Number.isFinite(cents) || cents <= 0) {
		return { ok: false, error: 'Enter a positive amount in USD.' };
	}
	if (cents > MAX_CENTS) {
		return { ok: false, error: 'That amount looks like a typo — the cap is $100,000 per entry.' };
	}
	if (Number.isNaN(input.occurredAt.getTime())) {
		return { ok: false, error: 'Enter a valid date.' };
	}
	await getDb().insert(costTopUps).values({
		provider: input.provider,
		amountCents: cents,
		occurredAt: input.occurredAt,
		note: input.note,
		createdBy: input.userId,
	});
	return { ok: true };
}

/** Delete one ledger entry. Silently succeeds if it's already gone. */
export async function deleteTopUp(id: string): Promise<void> {
	await getDb().delete(costTopUps).where(eq(costTopUps.id, id));
}

/**
 * The most recent top-up for a provider — the anchor point the burndown counts spend
 * from. `null` when the admin has never recorded one for that provider.
 */
export async function latestTopUp(provider: ProviderId): Promise<TopUpEntry | null> {
	const [row] = await getDb()
		.select()
		.from(costTopUps)
		.where(and(eq(costTopUps.provider, provider)))
		.orderBy(desc(costTopUps.occurredAt))
		.limit(1);
	if (!row) return null;
	return {
		id: row.id,
		provider: row.provider as ProviderId,
		amountUsd: row.amountCents / 100,
		occurredAt: row.occurredAt,
		note: row.note,
	};
}

/** Total credit recorded for a provider across all time, in USD. */
export function totalToppedUp(entries: TopUpEntry[], provider: ProviderId): number {
	return entries.filter((e) => e.provider === provider).reduce((sum, e) => sum + e.amountUsd, 0);
}
