/**
 * Invisible Director prices and the arithmetic over them (ADR-0006), shared by the launcher (the
 * Costs card and the estimate) and the director worker (the spend ledger and the budget cap).
 *
 * Pure: no DB, no env, no file reads, and only erasable TypeScript, so the worker runs it with
 * Node's type stripping. The prices themselves live in `services/director-worker/pricing.json` (a
 * reviewed file — editing it is a pipeline change) with an optional Admin override in
 * `app_settings`; each side loads both and hands the merged result here. Nothing in this module
 * carries a price.
 *
 * An unknown model THROWS rather than falling back to a neighbour's price: a ledger row priced
 * by a guess is worse than a loud failure, because nobody can tell it apart from a real one.
 */

export interface ModelPrice {
	/** USD per million input tokens. */
	input: number;
	/** USD per million output tokens. */
	output: number;
}

export interface DirectorPricing {
	currency: 'USD';
	perMTok: Record<string, ModelPrice>;
	/** Cache reads cost this fraction of the model's input price. */
	cacheReadMultiplier: number;
	/** Cache writes cost this multiple of the model's input price. */
	cacheWriteMultiplier: number;
	runpod: {
		/** True until the owner confirms `perSecondByGpu`; the Admin card says so. */
		placeholder: boolean;
		note?: string;
		/** USD per second of serverless execution, per GPU type. */
		perSecondByGpu: Record<string, number>;
	};
}

/**
 * A Messages response's `usage`, as the API returns it. `input_tokens` excludes the cached
 * tokens, which are counted separately — so the four buckets add, never overlap.
 */
export interface ClaudeUsage {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function price(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`pricing: ${path} must be a non-negative number`);
	}
	return value;
}

function modelPrice(value: unknown, path: string): ModelPrice {
	if (!isRecord(value)) throw new Error(`pricing: ${path} must be an object`);
	return {
		input: price(value.input, `${path}.input`),
		output: price(value.output, `${path}.output`),
	};
}

function priceTable(value: unknown, path: string): Record<string, number> {
	if (!isRecord(value)) throw new Error(`pricing: ${path} must be an object`);
	return Object.fromEntries(
		Object.entries(value).map(([key, v]) => [key, price(v, `${path}.${key}`)]),
	);
}

/** Validate a full pricing document (the shape of `pricing.json`). Throws on anything off. */
export function parsePricing(raw: unknown): DirectorPricing {
	if (!isRecord(raw)) throw new Error('pricing: must be an object');
	if (raw.currency !== 'USD') throw new Error('pricing: currency must be "USD"');
	if (!isRecord(raw.perMTok)) throw new Error('pricing: perMTok must be an object');
	const perMTok = Object.fromEntries(
		Object.entries(raw.perMTok).map(([model, v]) => [model, modelPrice(v, `perMTok.${model}`)]),
	);
	if (!isRecord(raw.runpod)) throw new Error('pricing: runpod must be an object');
	if (typeof raw.runpod.placeholder !== 'boolean') {
		throw new Error('pricing: runpod.placeholder must be true or false');
	}
	return {
		currency: 'USD',
		perMTok,
		cacheReadMultiplier: price(raw.cacheReadMultiplier, 'cacheReadMultiplier'),
		cacheWriteMultiplier: price(raw.cacheWriteMultiplier, 'cacheWriteMultiplier'),
		runpod: {
			placeholder: raw.runpod.placeholder,
			note: typeof raw.runpod.note === 'string' ? raw.runpod.note : undefined,
			perSecondByGpu: priceTable(raw.runpod.perSecondByGpu, 'runpod.perSecondByGpu'),
		},
	};
}

/**
 * Lay an Admin override over the file's prices. Every field is optional; a model's
 * `input`/`output` can be overridden one at a time, and a model the file doesn't list can be
 * added with both. Throws on an invalid override — the caller decides whether to degrade.
 */
export function mergePricing(base: DirectorPricing, override: unknown): DirectorPricing {
	if (!isRecord(override)) throw new Error('pricing override: must be a JSON object');
	if (override.currency !== undefined && override.currency !== 'USD') {
		throw new Error('pricing override: currency must be "USD"');
	}

	let perMTok = base.perMTok;
	if (override.perMTok !== undefined) {
		if (!isRecord(override.perMTok)) throw new Error('pricing override: perMTok must be an object');
		const overridden = Object.entries(override.perMTok).map(([model, v]) => {
			if (!isRecord(v)) throw new Error(`pricing override: perMTok.${model} must be an object`);
			const current = Object.hasOwn(base.perMTok, model) ? base.perMTok[model] : undefined;
			return [model, modelPrice({ ...current, ...v }, `override perMTok.${model}`)] as const;
		});
		perMTok = Object.fromEntries([...Object.entries(base.perMTok), ...overridden]);
	}

	const runpod = { ...base.runpod };
	if (override.runpod !== undefined) {
		if (!isRecord(override.runpod)) throw new Error('pricing override: runpod must be an object');
		if (override.runpod.perSecondByGpu !== undefined) {
			runpod.perSecondByGpu = Object.fromEntries([
				...Object.entries(base.runpod.perSecondByGpu),
				...Object.entries(
					priceTable(override.runpod.perSecondByGpu, 'override runpod.perSecondByGpu'),
				),
			]);
		}
		if (override.runpod.placeholder !== undefined) {
			if (typeof override.runpod.placeholder !== 'boolean') {
				throw new Error('pricing override: runpod.placeholder must be true or false');
			}
			runpod.placeholder = override.runpod.placeholder;
		}
	}

	return {
		currency: 'USD',
		perMTok,
		cacheReadMultiplier:
			override.cacheReadMultiplier === undefined
				? base.cacheReadMultiplier
				: price(override.cacheReadMultiplier, 'override cacheReadMultiplier'),
		cacheWriteMultiplier:
			override.cacheWriteMultiplier === undefined
				? base.cacheWriteMultiplier
				: price(override.cacheWriteMultiplier, 'override cacheWriteMultiplier'),
		runpod,
	};
}

function tokens(value: number | null | undefined, field: string): number {
	if (value == null) return 0;
	if (!Number.isFinite(value) || value < 0) throw new Error(`usage: ${field} must be ≥ 0`);
	return value;
}

/** USD cost of one Messages response's `usage`, billed at `model`'s price. */
export function costOfUsage(model: string, usage: ClaudeUsage, pricing: DirectorPricing): number {
	const rate = Object.hasOwn(pricing.perMTok, model) ? pricing.perMTok[model] : undefined;
	if (!rate) throw new Error(`pricing: no price for model "${model}"`);
	const input = tokens(usage.input_tokens, 'input_tokens');
	const output = tokens(usage.output_tokens, 'output_tokens');
	const cacheRead = tokens(usage.cache_read_input_tokens, 'cache_read_input_tokens');
	const cacheWrite = tokens(usage.cache_creation_input_tokens, 'cache_creation_input_tokens');
	return (
		(input * rate.input +
			cacheRead * rate.input * pricing.cacheReadMultiplier +
			cacheWrite * rate.input * pricing.cacheWriteMultiplier +
			output * rate.output) /
		1_000_000
	);
}

/** USD cost of a serverless job: its `executionTime` (seconds) × the GPU's $/s. */
export function costOfRunpodJob(gpu: string, seconds: number, pricing: DirectorPricing): number {
	const rate = Object.hasOwn(pricing.runpod.perSecondByGpu, gpu)
		? pricing.runpod.perSecondByGpu[gpu]
		: undefined;
	if (rate === undefined) throw new Error(`pricing: no RunPod price for GPU "${gpu}"`);
	return tokens(seconds, 'seconds') * rate;
}

/** One sampling attempt inside a Messages response (`usage.iterations[]`), as the API reports it. */
export interface ClaudeIteration extends ClaudeUsage {
	type: string;
	model?: string | null;
}

/** What `costOfResponse` reads off a Messages response. */
export interface ClaudeResponseUsage {
	/** The model that produced the returned message (the fallback model after a fallback). */
	model: string;
	usage: ClaudeUsage & { iterations?: readonly ClaudeIteration[] | null };
}

export interface ResponseCost {
	usd: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * USD cost and token totals of one Messages response. With server-side refusal fallbacks the
 * top-level `usage` covers only the attempt that produced the message, and `usage.iterations` is
 * the per-attempt truth — a declined attempt billed at ITS model's price, the serving attempt at
 * the fallback model's — so iterations, when present, are what is summed. An iteration with no
 * model was run by the response's own model.
 */
export function costOfResponse(
	response: ClaudeResponseUsage,
	pricing: DirectorPricing,
): ResponseCost {
	const iterations = response.usage.iterations ?? [];
	const parts: { model: string; usage: ClaudeUsage }[] = iterations.length
		? iterations.map((it) => ({ model: it.model ?? response.model, usage: it }))
		: [{ model: response.model, usage: response.usage }];
	const total: ResponseCost = { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const { model, usage } of parts) {
		total.usd += costOfUsage(model, usage, pricing);
		total.input += tokens(usage.input_tokens, 'input_tokens');
		total.output += tokens(usage.output_tokens, 'output_tokens');
		total.cacheRead += tokens(usage.cache_read_input_tokens, 'cache_read_input_tokens');
		total.cacheWrite += tokens(usage.cache_creation_input_tokens, 'cache_creation_input_tokens');
	}
	return total;
}

/** Settings key: the Invisible Director per-run budget cap in USD (ADR-0006). */
export const DIRECTOR_RUN_BUDGET_KEY = 'DIRECTOR_RUN_BUDGET_USD';
/** Budget cap when the admin hasn't set one. */
export const DIRECTOR_RUN_BUDGET_DEFAULT_USD = 25;
/** Lowest cap a run can be given — below this a run would pause on its first call. */
export const DIRECTOR_RUN_BUDGET_MIN_USD = 1;
/** Highest cap Settings accepts, so a typo (2500 for 25.00) can't remove the guard. */
export const DIRECTOR_RUN_BUDGET_MAX_USD = 500;
/**
 * Settings key: an optional JSON override laid over `services/director-worker/pricing.json`
 * (same shape, every field optional). Unset means the file's prices apply.
 */
export const DIRECTOR_PRICING_OVERRIDE_KEY = 'directorPricingOverride';

/**
 * Clamp a budget figure into `[DIRECTOR_RUN_BUDGET_MIN_USD, DIRECTOR_RUN_BUDGET_MAX_USD]`,
 * rounded to cents. `null` for anything that isn't a positive finite number.
 */
export function clampDirectorBudget(value: number): number | null {
	if (!Number.isFinite(value) || value <= 0) return null;
	const clamped = Math.min(
		DIRECTOR_RUN_BUDGET_MAX_USD,
		Math.max(DIRECTOR_RUN_BUDGET_MIN_USD, value),
	);
	return Math.round(clamped * 100) / 100;
}

/**
 * The cap a stored `DIRECTOR_RUN_BUDGET_USD` value means: the default when unset or unparseable,
 * clamped otherwise.
 */
export function budgetFromSetting(raw: string | undefined | null): number {
	if (raw == null || raw.trim() === '') return DIRECTOR_RUN_BUDGET_DEFAULT_USD;
	return clampDirectorBudget(Number(raw)) ?? DIRECTOR_RUN_BUDGET_DEFAULT_USD;
}
