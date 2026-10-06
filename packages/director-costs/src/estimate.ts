import type { DirectorPricing } from './index';

/**
 * The New-game estimate (ADR-0006 "Estimate"): a cost and time RANGE computed before a run starts,
 * from the template's region count, the mockups, the preset and the checkpoints — never from a
 * RunPod or Anthropic call. The per-unit token and GPU profiles live in
 * `services/director-worker/estimate-profiles.json` (a reviewed file beside `pricing.json`;
 * editing it is a pipeline change) and are placeholders until PLAN 6.3 replaces them with figures
 * measured on the pilot. Pure, like the rest of this package: the launcher loads the file and the
 * prices and hands both here.
 *
 * Every token is priced uncached, so the Claude side errs high. The RunPod side scales one
 * variant's seconds at 1024 px by the pixel count of the preset's resolutions and prices them at
 * the preset's GPU, so an unpriced GPU is refused here rather than estimated at nothing.
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
		/** Once per rendered draft variant (regions × variants per region). */
		perVariant: TokenProfile[];
		/** Once per checkpoint the owner reviews. */
		perCheckpoint: TokenProfile[];
	};
	runpod: {
		/** Seconds one variant takes to render at 1024 × 1024, [low, high]. */
		secondsPerVariantAt1024: Range;
		/** Renders at the final resolution per region, after the pick. */
		finalRendersPerRegion: number;
	};
}

export interface EstimateInput {
	/** Template regions the run re-themes (the sum of the template's atlas region counts). */
	regions: number;
	/** Mockups the analyst reads (style references excluded). */
	mockups: number;
	variantsPerRegion: number;
	/** Pixels on the side of a draft render and of a final render. */
	draftPx: number;
	finalPx: number;
	/** A GPU named in `pricing.runpod.perSecondByGpu`. */
	gpu: string;
	checkpoints: { breakdown: boolean; regionBatch: boolean };
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
		/** True while the GPU rates in `pricing.json` are unconfirmed. */
		placeholder: boolean;
		draftRenders: number;
		finalRenders: number;
		minutes: Range;
		usd: Range;
	};
	total: { usd: Range };
	/** How many times the run stops for the owner: the enabled checkpoints plus before publishing. */
	checkpoints: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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
	const finals = raw.runpod.finalRendersPerRegion;
	if (typeof finals !== 'number' || !Number.isInteger(finals) || finals < 0) {
		throw new Error('estimate profiles: runpod.finalRendersPerRegion must be a whole number ≥ 0');
	}
	return {
		placeholder: raw.placeholder,
		note: typeof raw.note === 'string' ? raw.note : undefined,
		claude: {
			perRun: profiles(raw.claude.perRun, 'claude.perRun'),
			perMockup: profiles(raw.claude.perMockup, 'claude.perMockup'),
			perRegion: profiles(raw.claude.perRegion, 'claude.perRegion'),
			perVariant: profiles(raw.claude.perVariant, 'claude.perVariant'),
			perCheckpoint: profiles(raw.claude.perCheckpoint, 'claude.perCheckpoint'),
		},
		runpod: {
			secondsPerVariantAt1024: range(
				raw.runpod.secondsPerVariantAt1024,
				'runpod.secondsPerVariantAt1024',
			),
			finalRendersPerRegion: finals,
		},
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
	return (checkpoints.breakdown ? 1 : 0) + (checkpoints.regionBatch ? 1 : 0) + 1;
}

export function estimateRun(
	input: EstimateInput,
	p: EstimateProfiles,
	pricing: DirectorPricing,
): RunEstimate {
	const regions = count(input.regions, 'regions');
	const mockups = count(input.mockups, 'mockups');
	const variants = count(input.variantsPerRegion, 'variantsPerRegion');
	const draftPx = count(input.draftPx, 'draftPx');
	const finalPx = count(input.finalPx, 'finalPx');
	const checkpoints = checkpointCount(input.checkpoints);

	const gpuRate = Object.hasOwn(pricing.runpod.perSecondByGpu, input.gpu)
		? pricing.runpod.perSecondByGpu[input.gpu]
		: undefined;
	if (gpuRate === undefined) throw new Error(`estimate: no RunPod price for GPU "${input.gpu}"`);

	const units: [TokenProfile[], number][] = [
		[p.claude.perRun, 1],
		[p.claude.perMockup, mockups],
		[p.claude.perRegion, regions],
		[p.claude.perVariant, regions * variants],
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

	const pixels = (px: number) => (px * px) / (1024 * 1024);
	const draftRenders = regions * variants;
	const finalRenders = regions * p.runpod.finalRendersPerRegion;
	const seconds = add(
		scale(p.runpod.secondsPerVariantAt1024, draftRenders * pixels(draftPx)),
		scale(p.runpod.secondsPerVariantAt1024, finalRenders * pixels(finalPx)),
	);
	const gpuUsd = { low: cents(seconds.low * gpuRate), high: cents(seconds.high * gpuRate) };
	const claudeUsd = { low: cents(usd.low), high: cents(usd.high) };

	return {
		placeholder: p.placeholder || pricing.runpod.placeholder,
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
			gpu: input.gpu,
			placeholder: pricing.runpod.placeholder,
			draftRenders,
			finalRenders,
			minutes: { low: Math.round(seconds.low / 60), high: Math.ceil(seconds.high / 60) },
			usd: gpuUsd,
		},
		total: {
			usd: { low: cents(claudeUsd.low + gpuUsd.low), high: cents(claudeUsd.high + gpuUsd.high) },
		},
		checkpoints,
	};
}
