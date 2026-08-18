/**
 * RunPod cost collector — the ONLY provider in the pipeline that reports a real
 * prepaid balance, so this is the one card where "credits remaining" is a fact rather
 * than a ledger estimate.
 *
 * Reuses the authenticated GraphQL transport in `$lib/server/runpod.ts` (same
 * `RUNPOD_API_KEY`, same timeout, same fail-safe contract) — no new secret is needed
 * for this card to work.
 *
 * `myself` carries the account-level figures; `myself.pods[]` carries per-pod
 * `costPerHr`, which is what actually burns the balance. A STOPPED pod still bills for
 * its disk but not its GPU, so the per-pod lines mark status — a pod left running is
 * the usual reason the balance moves overnight.
 */

import { ENV } from '../env';
import { gql } from '../runpod';
import { failed, notConfigured, num, type CostLine, type ProviderCost } from './types';

const LABEL = 'RunPod (GPU)';

interface MyselfPod {
	id?: string;
	name?: string;
	desiredStatus?: string;
	costPerHr?: number | string | null;
	runtime?: { uptimeInSeconds?: number } | null;
}

interface Myself {
	clientBalance?: number | string | null;
	currentSpendPerHr?: number | string | null;
	spendLimit?: number | string | null;
	pods?: MyselfPod[] | null;
}

/** `desiredStatus` → a short human word for the pod line. */
function statusWord(pod: MyselfPod): string {
	if (pod.desiredStatus !== 'RUNNING') return 'stopped';
	return pod.runtime ? 'running' : 'starting';
}

export async function collectRunpod(): Promise<ProviderCost> {
	if (!ENV.RUNPOD_API_KEY) {
		return notConfigured(
			'runpod',
			LABEL,
			['RUNPOD_API_KEY'],
			'Set the RunPod API key on the launcher service to read the account balance and per-pod burn rate.',
		);
	}

	// Ask for the account figures and the pod list in one round trip. If RunPod rejects
	// the pod sub-selection (schema drift), fall back to the account fields alone —
	// a balance with no breakdown still beats an empty card.
	let myself: Myself | undefined;
	const full = await gql(
		`query { myself { clientBalance currentSpendPerHr spendLimit pods { id name desiredStatus costPerHr runtime { uptimeInSeconds } } } }`,
	);
	myself = (full?.data as { myself?: Myself } | undefined)?.myself;

	if (!myself) {
		const minimal = await gql(`query { myself { clientBalance currentSpendPerHr } }`);
		myself = (minimal?.data as { myself?: Myself } | undefined)?.myself;
		if (!myself) {
			const err = full?.errors?.find((e) => e.message)?.message;
			return failed('runpod', LABEL, err?.trim() || 'RunPod did not answer — try refreshing.');
		}
	}

	const balanceUsd = num(myself.clientBalance);
	const ratePerHourUsd = num(myself.currentSpendPerHr);
	const spendLimit = num(myself.spendLimit);

	const lines: CostLine[] = [];
	for (const pod of myself.pods ?? []) {
		const rate = num(pod.costPerHr);
		const status = statusWord(pod);
		lines.push({
			label: pod.name?.trim() || pod.id || 'unnamed pod',
			// Only a RUNNING pod is burning its GPU rate; showing the rate against a
			// stopped pod would overstate the burn.
			amountUsd: status === 'stopped' ? 0 : rate,
			detail: rate == null ? status : `${status} · $${rate.toFixed(3)}/hr`,
		});
	}
	if (spendLimit != null && spendLimit > 0) {
		lines.push({ label: 'Account spend limit', amountUsd: spendLimit, detail: 'cap' });
	}

	// Runway is the number an admin actually acts on: at the current burn, how long
	// before the pods stop. Only meaningful while something is running.
	let reason: string | undefined;
	if (balanceUsd != null && ratePerHourUsd != null && ratePerHourUsd > 0) {
		const hours = balanceUsd / ratePerHourUsd;
		reason =
			hours < 48
				? `About ${hours.toFixed(1)}h of runway left at the current burn rate.`
				: `About ${Math.floor(hours / 24)} days of runway at the current burn rate.`;
	}

	return {
		id: 'runpod',
		label: LABEL,
		configured: true,
		ok: true,
		reason,
		balanceUsd,
		// RunPod bills continuously against the balance rather than exposing a
		// period total, so the honest spend figure here is the rate, not a sum.
		spendUsd: null,
		ratePerHourUsd,
		lines,
	};
}
