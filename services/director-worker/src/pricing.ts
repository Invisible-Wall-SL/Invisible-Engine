import { readFileSync } from 'node:fs';
import type { Sql } from 'postgres';
import {
	DIRECTOR_PRICING_OVERRIDE_KEY,
	mergePricing,
	parsePricing,
	type DirectorPricing,
} from 'director-costs';
import { log } from './log.ts';
import { appSetting } from './store.ts';

/**
 * The prices the worker bills with (ADR-0006): `pricing.json`, with the Admin override from
 * `app_settings` laid over it — the same merge the launcher's Costs card uses, so both price a call
 * alike. Never throws once the file loaded: an unreadable or invalid override degrades to the file.
 */
export function pricingSource(sql: Sql | null, file: string): () => Promise<DirectorPricing> {
	const base = parsePricing(JSON.parse(readFileSync(file, 'utf8')));
	return async () => {
		if (!sql) return base;
		try {
			const raw = await appSetting(sql, DIRECTOR_PRICING_OVERRIDE_KEY);
			return raw?.trim() ? mergePricing(base, JSON.parse(raw)) : base;
		} catch (error) {
			log.warn('pricing override ignored: using pricing.json', {
				error: (error as Error).message,
			});
			return base;
		}
	};
}
