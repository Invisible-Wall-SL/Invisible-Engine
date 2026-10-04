/**
 * Shared shape for the Admin → Costs page.
 *
 * One `ProviderCost` per paid service in the pipeline. Every collector returns this
 * same record whether it succeeded, failed, or was never configured — the page is a
 * dashboard, so a provider that can't answer must still render a card explaining why
 * rather than vanishing (a missing card reads as "$0", which is the one wrong answer).
 *
 * Money is USD throughout. Providers report in different units (Anthropic bills in
 * cents, R2 in bytes and operation counts) — each collector normalizes to dollars so
 * nothing downstream has to know the difference.
 */

/** Every provider the page and the monthly ledger know. The one list `ProviderId` derives from. */
export const PROVIDER_IDS = [
	'runpod',
	'railway',
	'r2',
	'openai',
	'anthropic',
	'anthropicAgents',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
	return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Providers whose spend is a SUBSET of another provider's bill, mapped to that parent.
 * Director agent spend is billed on the same Anthropic org the `anthropic` card reads, so
 * adding both to a total counts it twice. A subset is left out of every total whenever its
 * parent reports, and counted only when the parent has no figure.
 */
export const INCLUDED_IN: Partial<Record<ProviderId, ProviderId>> = {
	anthropicAgents: 'anthropic',
};

/** One row in a provider's breakdown — a pod, a service, a bucket, a model. */
export interface CostLine {
	label: string;
	/** USD. `null` for a usage-only line that carries no price (e.g. stored GB). */
	amountUsd: number | null;
	/** Free-text right-hand column: a rate, a count, a status. */
	detail?: string;
}

export interface ProviderCost {
	id: ProviderId;
	label: string;
	/** False when the credentials are absent — the card shows setup hints, not an error. */
	configured: boolean;
	/** False when configured but the call failed; `reason` says what went wrong. */
	ok: boolean;
	/** Why this provider has no numbers: the setup hint, or the upstream error text. */
	reason?: string;
	/**
	 * Prepaid credit still held by the provider, when it exposes one. `null` means the
	 * provider has NO balance API — not that the balance is zero. Only RunPod reports a
	 * real balance; for the others the ledger derives an estimate.
	 */
	balanceUsd: number | null;
	/** Measured spend over `spendWindow`. `null` when unavailable. */
	spendUsd: number | null;
	/** Human label for what `spendUsd` covers, e.g. 'last 30 days'. */
	spendWindow?: string;
	/** Current burn rate in USD/hour, when the provider reports one. */
	ratePerHourUsd?: number | null;
	/**
	 * True when `spendUsd` is OUR arithmetic over usage counters rather than a billed
	 * figure from the provider. The card labels these so nobody reconciles them against
	 * an invoice and assumes a bug.
	 */
	estimated?: boolean;
	lines: CostLine[];
	/** Extra titled breakdowns under `lines` (e.g. spend by agent, top runs). */
	sections?: { title: string; lines: CostLine[] }[];
	/** Set when this spend is already inside another provider's bill (see `INCLUDED_IN`). */
	includedIn?: ProviderId;
	/** A standing note under the figures, separate from `reason` (which explains a gap). */
	note?: string;
	/** Env vars the admin must set. Shown when `configured` is false. */
	requires?: string[];
}

/** A provider that isn't set up yet — a first-class result, not an error. */
export function notConfigured(
	id: ProviderId,
	label: string,
	requires: string[],
	reason: string,
): ProviderCost {
	return {
		id,
		label,
		configured: false,
		ok: false,
		reason,
		balanceUsd: null,
		spendUsd: null,
		lines: [],
		requires,
	};
}

/** A provider that is set up but could not be read this time. */
export function failed(id: ProviderId, label: string, reason: string): ProviderCost {
	return {
		id,
		label,
		configured: true,
		ok: false,
		reason,
		balanceUsd: null,
		spendUsd: null,
		lines: [],
	};
}

/** Coerce an unknown JSON number-ish value to a finite number, else `null`. */
export function num(value: unknown): number | null {
	const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
	return Number.isFinite(n) ? n : null;
}

/** USD as `$1,234.56`. `null` renders as an em dash so a gap never looks like zero. */
export function usd(amount: number | null | undefined): string {
	if (amount == null || !Number.isFinite(amount)) return '—';
	return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
