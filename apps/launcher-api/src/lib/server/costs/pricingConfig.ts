import pricingFile from '../../../../../../services/director-worker/pricing.json';
import { DIRECTOR_PRICING_OVERRIDE_KEY, getAppSetting } from '../appSettings';
import { mergePricing, parsePricing, type DirectorPricing } from './directorPricing';

/** The reviewed prices in `services/director-worker/pricing.json`, validated once at load. */
export const FILE_PRICING: DirectorPricing = parsePricing(pricingFile);

export interface EffectivePricing {
	pricing: DirectorPricing;
	/** Where the prices came from: the file alone, or the file under an Admin override. */
	source: 'file' | 'override';
	/** Set when an override is stored but could not be used (bad JSON, bad value, DB error). */
	overrideError?: string;
	/** The stored override text exactly as saved (even when invalid), for the Settings editor. */
	overrideRaw?: string;
}

/**
 * The prices to bill with: the file, with the Admin override (`app_settings`) laid over it
 * when one is set. Never throws — an unreadable or invalid override degrades to the file and
 * says why, so a typo in Settings can't stop spend from being recorded.
 */
export async function getDirectorPricing(): Promise<EffectivePricing> {
	let raw: string | undefined;
	try {
		raw = await getAppSetting(DIRECTOR_PRICING_OVERRIDE_KEY);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn('[pricing] override DB read failed — using pricing.json:', message);
		return {
			pricing: FILE_PRICING,
			source: 'file',
			overrideError: 'The override could not be read.',
		};
	}
	if (!raw?.trim()) return { pricing: FILE_PRICING, source: 'file' };
	try {
		const pricing = mergePricing(FILE_PRICING, JSON.parse(raw));
		return { pricing, source: 'override', overrideRaw: raw };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn('[pricing] override ignored — using pricing.json:', message);
		return { pricing: FILE_PRICING, source: 'file', overrideError: message, overrideRaw: raw };
	}
}
