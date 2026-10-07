/**
 * Invisible Director prices and the arithmetic over them (ADR-0006), shared by the launcher (the
 * Costs card and the estimate) and the director worker (the spend ledger and the budget cap).
 *
 * Pure: no DB, no env, no file reads, and only erasable TypeScript, so the worker runs it with
 * Node's type stripping. ONE file, on purpose: the worker's loader rewrites no extensions, so a
 * relative import would need `./x.ts`, which the launcher's typecheck (no
 * `allowImportingTsExtensions`) refuses — no extension breaks the one, `.ts` breaks the other.
 * The prices themselves live in `services/director-worker/pricing.json` (a reviewed file —
 * editing it is a pipeline change) with an optional Admin override in `app_settings`; each side
 * loads both and hands the merged result here. Nothing in this module carries a price.
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
		/**
		 * Seconds one render is projected at while the run has no billed render to go by, priced at
		 * the dearest GPU in the table (`seedRenderUsd`), and what a job that ended without reporting
		 * its time is billed at when none of its render's jobs did. The cap fails closed, never open.
		 */
		seedSecondsPerRender: number;
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
			seedSecondsPerRender: price(raw.runpod.seedSecondsPerRender, 'runpod.seedSecondsPerRender'),
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
		if (override.runpod.seedSecondsPerRender !== undefined) {
			runpod.seedSecondsPerRender = price(
				override.runpod.seedSecondsPerRender,
				'override runpod.seedSecondsPerRender',
			);
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

/**
 * USD one render is projected at before any of the run's renders is billed: the seed seconds at
 * the dearest GPU priced, so the figure errs high. 0 only when no GPU is priced at all, and then
 * nothing can be billed either.
 */
export function seedRenderUsd(pricing: DirectorPricing): number {
	const rates = Object.values(pricing.runpod.perSecondByGpu);
	return rates.length ? pricing.runpod.seedSecondsPerRender * Math.max(...rates) : 0;
}

/**
 * USD cost of a serverless job: its billed seconds × the GPU's $/s. RunPod bills a worker's
 * uptime, cold start included, so the seconds are the job's `executionTime` plus its `delayTime`.
 */
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

// ── The New-game estimate ─────────────────────────────────────────────────────

/**
 * The New-game estimate (ADR-0006 "Estimate", ADR-0008 §6): a cost and time RANGE computed before a
 * run starts, from the template's region count, the mockups, the checkpoints and the GPU side
 * priced per recipe chain (`director-costs/recipe` `priceChains`, from the reviewed cards and the
 * measured timings) — never from a RunPod or Anthropic call. The per-unit token profiles live in
 * `services/director-worker/estimate-profiles.json` (a reviewed file beside `pricing.json`;
 * editing it is a pipeline change) and are placeholders until PLAN 6.3 replaces them with figures
 * measured on the pilot. Pure, like the rest of this package: the launcher loads the file, the
 * prices and the chain price and hands them here.
 *
 * Every token is priced uncached, so the Claude side errs high. The GPU side fails closed: when
 * it cannot be priced the estimate has no total (`total.usd` null) and says why, and no run is
 * offered on it.
 */

export interface Range {
	low: number;
	high: number;
}

/** Tokens one unit of work costs an agent: [low, high] input and output. */
export interface TokenProfile {
	agent: string;
	model: string;
	input: Range;
	output: Range;
}

export interface EstimateProfiles {
	/** True until the figures are measured (PLAN 6.3); the panel says so. */
	placeholder: boolean;
	note?: string;
	claude: {
		/** Once per run, whatever its size. */
		perRun: TokenProfile[];
		/** Once per mockup that is not a style reference. */
		perMockup: TokenProfile[];
		/** Once per template region. */
		perRegion: TokenProfile[];
		/** Once per recipe step of every region (the technician's set-up and run of it). */
		perStep: TokenProfile[];
		/** Once per reviewed draft variant (the generate steps' variants over every region). */
		perVariant: TokenProfile[];
		/** Once per checkpoint the owner reviews. */
		perCheckpoint: TokenProfile[];
	};
	runpod: {
		/**
		 * Seconds one image takes at 1024 × 1024, [low, high], for a step whose pipeline has no
		 * reviewed card (or no figure for its size): the fallback, scaled by pixel count.
		 */
		secondsPerVariantAt1024: Range;
	};
	/**
	 * The default recipe a region group starts from, and is priced at, before its template has an
	 * approved one (ADR-0008 §5 "Reuse"): `pipeline` at `genPx` × `variants`, then `process`.
	 */
	fallbackRecipe: FallbackRecipe;
}

export interface FallbackRecipe {
	pipeline: string;
	genPx: number;
	variants: number;
	process: string;
}

/** The GPU side as `priceChains` answers it. */
export interface GpuPart {
	gpu: string;
	seconds: Range;
	/** Null when it cannot be priced; `unpriced` says why. */
	usd: Range | null;
	renders: number;
	reviewedVariants: number;
	steps: number;
	placeholder: boolean;
	unpriced: string[];
}

export interface EstimateInput {
	/** Template regions the run re-themes (the sum of the template's atlas region counts). */
	regions: number;
	/** Mockups the analyst reads (style references excluded). */
	mockups: number;
	gpu: GpuPart;
	checkpoints: { breakdown: boolean; artPlan: boolean; regionBatch: boolean };
}

export interface RunEstimate {
	placeholder: boolean;
	note?: string;
	claude: {
		usd: Range;
		byAgent: Record<string, Range>;
		tokens: { input: Range; output: Range };
	};
	runpod: {
		gpu: string;
		/** True while the GPU rates in `pricing.json` are unconfirmed or a figure is a guess. */
		placeholder: boolean;
		renders: number;
		reviewedVariants: number;
		minutes: Range;
		usd: Range | null;
	};
	/** Null when the GPU side cannot be priced: no run is offered on an unknown cost. */
	total: { usd: Range | null };
	/** Why the estimate has no total; empty when it has one. */
	unpriced: string[];
	/** How many times the run stops for the owner: the enabled checkpoints plus before publishing. */
	checkpoints: number;
}

function range(value: unknown, path: string): Range {
	if (
		!Array.isArray(value) ||
		value.length !== 2 ||
		!value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
	) {
		throw new Error(`estimate profiles: ${path} must be [low, high] with both ≥ 0`);
	}
	const [low, high] = value as [number, number];
	if (low > high) throw new Error(`estimate profiles: ${path} has low above high`);
	return { low, high };
}

function profile(value: unknown, path: string): TokenProfile {
	if (!isRecord(value)) throw new Error(`estimate profiles: ${path} must be an object`);
	if (typeof value.agent !== 'string' || !value.agent) {
		throw new Error(`estimate profiles: ${path}.agent must be a name`);
	}
	if (typeof value.model !== 'string' || !value.model) {
		throw new Error(`estimate profiles: ${path}.model must be a model id`);
	}
	return {
		agent: value.agent,
		model: value.model,
		input: range(value.input, `${path}.input`),
		output: range(value.output, `${path}.output`),
	};
}

const PIPELINE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function fallbackRecipe(value: unknown): FallbackRecipe {
	if (!isRecord(value)) throw new Error('estimate profiles: fallbackRecipe must be an object');
	for (const key of ['pipeline', 'process'] as const) {
		if (typeof value[key] !== 'string' || !PIPELINE_ID.test(value[key])) {
			throw new Error(`estimate profiles: fallbackRecipe.${key} must be a pipeline id`);
		}
	}
	for (const key of ['genPx', 'variants'] as const) {
		const n = value[key];
		if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
			throw new Error(`estimate profiles: fallbackRecipe.${key} must be a whole number ≥ 1`);
		}
	}
	return {
		pipeline: value.pipeline as string,
		genPx: value.genPx as number,
		variants: value.variants as number,
		process: value.process as string,
	};
}

function profiles(value: unknown, path: string): TokenProfile[] {
	if (!Array.isArray(value)) throw new Error(`estimate profiles: ${path} must be a list`);
	return value.map((v, i) => profile(v, `${path}[${i}]`));
}

/** Validate the shape of `estimate-profiles.json`. Throws on anything off. */
export function parseEstimateProfiles(raw: unknown): EstimateProfiles {
	if (!isRecord(raw)) throw new Error('estimate profiles: must be an object');
	if (typeof raw.placeholder !== 'boolean') {
		throw new Error('estimate profiles: placeholder must be true or false');
	}
	if (!isRecord(raw.claude)) throw new Error('estimate profiles: claude must be an object');
	if (!isRecord(raw.runpod)) throw new Error('estimate profiles: runpod must be an object');
	return {
		placeholder: raw.placeholder,
		note: typeof raw.note === 'string' ? raw.note : undefined,
		claude: {
			perRun: profiles(raw.claude.perRun, 'claude.perRun'),
			perMockup: profiles(raw.claude.perMockup, 'claude.perMockup'),
			perRegion: profiles(raw.claude.perRegion, 'claude.perRegion'),
			perStep: profiles(raw.claude.perStep, 'claude.perStep'),
			perVariant: profiles(raw.claude.perVariant, 'claude.perVariant'),
			perCheckpoint: profiles(raw.claude.perCheckpoint, 'claude.perCheckpoint'),
		},
		runpod: {
			secondsPerVariantAt1024: range(
				raw.runpod.secondsPerVariantAt1024,
				'runpod.secondsPerVariantAt1024',
			),
		},
		fallbackRecipe: fallbackRecipe(raw.fallbackRecipe),
	};
}

/** Every model the profiles name, so a caller can check them against the agents' definitions. */
export function profileModels(p: EstimateProfiles): Record<string, string> {
	const out: Record<string, string> = {};
	for (const list of Object.values(p.claude)) {
		for (const line of list) out[line.agent] = line.model;
	}
	return out;
}

const cents = (usd: number) => Math.round(usd * 100) / 100;
const add = (a: Range, b: Range): Range => ({ low: a.low + b.low, high: a.high + b.high });
const scale = (r: Range, by: number): Range => ({ low: r.low * by, high: r.high * by });

function count(value: number, what: string): number {
	if (!Number.isFinite(value) || value < 0) throw new Error(`estimate: ${what} must be ≥ 0`);
	return value;
}

/** How many times the run stops for the owner. `before_publish` is always one of them. */
export function checkpointCount(checkpoints: EstimateInput['checkpoints']): number {
	return (
		(checkpoints.breakdown ? 1 : 0) +
		(checkpoints.artPlan ? 1 : 0) +
		(checkpoints.regionBatch ? 1 : 0) +
		1
	);
}

export function estimateRun(
	input: EstimateInput,
	p: EstimateProfiles,
	pricing: DirectorPricing,
): RunEstimate {
	const regions = count(input.regions, 'regions');
	const mockups = count(input.mockups, 'mockups');
	const steps = count(input.gpu.steps, 'steps');
	const variants = count(input.gpu.reviewedVariants, 'reviewedVariants');
	const checkpoints = checkpointCount(input.checkpoints);

	const units: [TokenProfile[], number][] = [
		[p.claude.perRun, 1],
		[p.claude.perMockup, mockups],
		[p.claude.perRegion, regions],
		[p.claude.perStep, steps],
		[p.claude.perVariant, variants],
		[p.claude.perCheckpoint, checkpoints],
	];
	const byAgent: Record<string, Range> = {};
	let usd: Range = { low: 0, high: 0 };
	let inputTokens: Range = { low: 0, high: 0 };
	let outputTokens: Range = { low: 0, high: 0 };
	for (const [lines, times] of units) {
		for (const line of lines) {
			const rate = Object.hasOwn(pricing.perMTok, line.model)
				? pricing.perMTok[line.model]
				: undefined;
			if (!rate) throw new Error(`estimate: no price for model "${line.model}"`);
			const inTok = scale(line.input, times);
			const outTok = scale(line.output, times);
			const cost: Range = {
				low: (inTok.low * rate.input + outTok.low * rate.output) / 1_000_000,
				high: (inTok.high * rate.input + outTok.high * rate.output) / 1_000_000,
			};
			byAgent[line.agent] = add(byAgent[line.agent] ?? { low: 0, high: 0 }, cost);
			usd = add(usd, cost);
			inputTokens = add(inputTokens, inTok);
			outputTokens = add(outputTokens, outTok);
		}
	}
	for (const agent of Object.keys(byAgent)) {
		byAgent[agent] = { low: cents(byAgent[agent].low), high: cents(byAgent[agent].high) };
	}

	const seconds = input.gpu.seconds;
	const gpuUsd = input.gpu.usd
		? { low: cents(input.gpu.usd.low), high: cents(input.gpu.usd.high) }
		: null;
	const claudeUsd = { low: cents(usd.low), high: cents(usd.high) };

	return {
		placeholder: p.placeholder || pricing.runpod.placeholder || input.gpu.placeholder,
		note: p.note,
		claude: {
			usd: claudeUsd,
			byAgent,
			tokens: {
				input: { low: Math.round(inputTokens.low), high: Math.round(inputTokens.high) },
				output: { low: Math.round(outputTokens.low), high: Math.round(outputTokens.high) },
			},
		},
		runpod: {
			gpu: input.gpu.gpu,
			placeholder: pricing.runpod.placeholder || input.gpu.placeholder,
			renders: input.gpu.renders,
			reviewedVariants: variants,
			minutes: { low: Math.round(seconds.low / 60), high: Math.ceil(seconds.high / 60) },
			usd: gpuUsd,
		},
		total: {
			usd: gpuUsd
				? { low: cents(claudeUsd.low + gpuUsd.low), high: cents(claudeUsd.high + gpuUsd.high) }
				: null,
		},
		unpriced: [...input.gpu.unpriced],
		checkpoints,
	};
}
