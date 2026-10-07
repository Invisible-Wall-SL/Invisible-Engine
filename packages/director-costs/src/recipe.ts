/**
 * Invisible Director recipes (ADR-0008 §5): how one template region is made, as a chain of
 * Atlas Maker pipeline steps the `atlas-technician` plans from the reviewed blueprint cards. The
 * worker validates every recipe with these rules before it stores one; the launcher's queue gate
 * and (card 8E) the Art plan display read the same module, so the rules have one home.
 *
 * Pure and self-contained like `index.ts` (no relative imports, erasable TypeScript only).
 */

export type InputNeed = 'required' | 'optional' | 'none';

/** The part of a reviewed `card.json` the rules read (atlas-tool `cards.py`). */
export interface CardSetting {
	key: string;
	default?: string | number | boolean;
	min?: number;
	max?: number;
	options?: (string | number | boolean)[];
	scope?: 'atlas' | 'region';
	draft?: number;
	final?: number;
}

export interface Card {
	id: string;
	rev: number;
	status: string;
	purpose?: string;
	inputs: Partial<
		Record<
			'prompt' | 'negative' | 'reference' | 'shape' | 'sourceImage' | 'mask' | 'layer',
			InputNeed
		>
	>;
	outputs: { kind: string; alpha?: boolean; count?: number; fixedPx?: number };
	settings?: CardSetting[];
	chain?: { position?: string; follows?: string[]; precedes?: string[] };
	gpu: { secondsPerImage: Record<string, number>; coldStart: number; source: 'guess' | 'measured' };
	variants: { draft: number; final: number; max: number };
	billing: 'gpu' | 'credits';
	licence: 'ok' | 'blocked' | 'conditional';
}

/** One pipeline as `GET /blueprints?kind=image` answers it to an agent. */
export interface CatalogueEntry {
	id: string;
	name: string;
	kind: string;
	builtin: boolean;
	roles: string[];
	card: Card;
}

export interface Catalogue {
	/** The endpoint's GPU (`RUNPOD_ENDPOINT_GPU`), "" when atlas-tool reports none. */
	gpu: string;
	blueprints: CatalogueEntry[];
}

export const STEP_KINDS = ['generate', 'process', 'finish'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const REF_SOURCES = ['keep', 'clear', 'key', 'variant', 'mockupCrop'] as const;
export type RefSource = (typeof REF_SOURCES)[number];

export interface RefChoice {
	source: RefSource;
	value: string;
}

/** A step as `run.set_recipe` takes it (ADR-0008 Appendix A). */
export interface StepInput {
	n: number;
	kind: StepKind;
	pipeline: string;
	atlas: string;
	region: string;
	genPx: number;
	variants: number;
	settings: { key: string; value: string }[];
	style: RefChoice;
	shape: RefChoice;
	note: string;
}

export interface RecipeInput {
	region: string;
	atlas: string;
	group: string;
	steps: StepInput[];
}

export type StepStatus = 'planned' | 'queued' | 'done' | 'chosen' | 'failed';

export interface StoredStep extends StepInput {
	/** The card revision the step was planned against; 0 on `finish`. */
	cardRev: number;
	licence: Card['licence'] | '';
	status: StepStatus;
	jobRef?: string;
	/** The variant ids the step's render produced on its own atlas and region. */
	rendered?: string[];
	/** A render step: the variant id chosen on its region. `finish`: the committed variant as
	 *  `<atlas>/<region>/<id>`. */
	chosen?: string;
}

export interface Projection {
	gpuSeconds: number;
	/** Null while it cannot be priced: the endpoint's GPU has no price, or a step has no figure. */
	gpuUsd: number | null;
	/** True when a step's seconds are only the card's guess, with nothing measured beside them. */
	placeholder: boolean;
	/** Why the projection has no price, one line per reason; empty when it has one. Absent on
	 *  recipes stored before card 8E, which read as none. */
	unpriced?: string[];
}

export interface Approval {
	by: string;
	at: string;
	rev: number;
}

export interface StoredRecipe {
	rev: number;
	region: string;
	atlas: string;
	group: string;
	plannedBy: string;
	approved: Approval | null;
	editedBy?: string;
	steps: StoredStep[];
	projected: Projection;
}

export interface ValidationContext {
	catalogue: Catalogue;
	/** The template regions the run's plan names; a recipe for any other region is refused. */
	planRegions: ReadonlySet<string>;
	/** The run's other stored recipes, for the per-atlas rules. */
	others: readonly StoredRecipe[];
	/** USD per GPU second for `catalogue.gpu`, or null when unpriced. */
	usdPerSecond: number | null;
	/** Measured GPU time per (pipeline, genPx), from `director_blueprint_timings`. */
	timings?: readonly Timing[];
}

export type ValidationResult =
	{ ok: true; steps: StoredStep[]; projected: Projection } | { ok: false; errors: string[] };

/** The generation size a pipeline may run at when its card names no `gen_width` bounds. */
export const GEN_PX_MIN = 256;
export const GEN_PX_MAX = 2048;

/** Settings that the step's own `genPx` sets: a recipe never names them. */
const SIZE_KEYS = new Set(['gen_width', 'gen_height']);
const VARIANT_REF =
	/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}\/[A-Za-z0-9_][A-Za-z0-9_.()-]{0,119}\/[0-9]{1,8}$/;
const STEP_REF = /^step:([0-9]{1,3})$/;
const SHEET_KEY =
	/^(?:[a-z0-9_-]+\/[a-z0-9_-]+\/)?(?:sheets|sheet_src)\/[A-Za-z0-9_./() -]{1,300}$/;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A card setting's scope; a setting with none is per atlas. */
export const scopeOf = (s: CardSetting) => s.scope ?? 'atlas';

/** Seconds per image at `px`, linear in pixel count between the card's sizes; null if unknown. */
export function secondsAt(card: Card, px: number): number | null {
	const points = Object.entries(card.gpu.secondsPerImage ?? {})
		.map(([size, s]) => [Number(size), s] as const)
		.filter(([size, s]) => size > 0 && isNum(s))
		.sort((a, b) => a[0] - b[0]);
	if (points.length === 0 || px <= 0) return null;
	const pixels = px * px;
	const [lowPx, lowS] = points[0];
	if (px <= lowPx) return (lowS * pixels) / (lowPx * lowPx);
	const [highPx, highS] = points[points.length - 1];
	if (px >= highPx) return (highS * pixels) / (highPx * highPx);
	for (let i = 1; i < points.length; i++) {
		const [aPx, aS] = points[i - 1];
		const [bPx, bS] = points[i];
		if (px <= bPx) {
			const t = (pixels - aPx * aPx) / (bPx * bPx - aPx * aPx);
			return aS + t * (bS - aS);
		}
	}
	return highS;
}

/**
 * Measured GPU time for one (effective pipeline, genPx), per RunPod job (one image): the rolling
 * means `director_blueprint_timings` holds, written by the worker from every `job_done`.
 */
export interface Timing {
	pipeline: string;
	genPx: number;
	jobs: number;
	meanExecSeconds: number;
	meanDelaySeconds: number;
}

export const timingOf = (
	timings: readonly Timing[] | undefined,
	pipeline: string,
	genPx: number,
): Timing | null =>
	timings?.find((t) => t.pipeline === pipeline && t.genPx === genPx && t.jobs > 0) ?? null;

/**
 * Billed seconds one image of a step costs (ADR-0008 §6): the card's seconds at that size, or the
 * measured execution mean when it is higher, plus the measured queue delay per job. Never lower
 * than either figure: a measurement only raises a guess, and the owner copies a lower one into
 * the card (`source: measured`) by hand. Null when there is neither a card figure nor a
 * measurement, or the card bills credits: the step cannot be priced.
 */
export function secondsPerImage(
	card: Card,
	genPx: number,
	timing: Timing | null,
): { seconds: number; guess: boolean } | null {
	if (card.billing === 'credits') return null;
	const fromCard = secondsAt(card, genPx);
	if (fromCard === null && timing === null) return null;
	const exec = Math.max(fromCard ?? 0, timing?.meanExecSeconds ?? 0);
	return {
		seconds: exec + (timing?.meanDelaySeconds ?? 0),
		guess: card.gpu.source !== 'measured' && timing === null,
	};
}

/**
 * The recipe's projected GPU time and cost, recomputed by code from the cards and the measured
 * timings (§6), with the card's cold start once per (atlas, pipeline) batch. Fails closed: a step
 * whose card is gone or bills credits, or has no figure for its size, leaves the whole recipe
 * unpriced (`gpuUsd: null`) rather than counting it as nothing.
 */
export function project(
	steps: readonly StepInput[],
	cards: ReadonlyMap<string, Card>,
	usdPerSecond: number | null,
	timings?: readonly Timing[],
): Projection {
	let seconds = 0;
	let placeholder = false;
	const unpriced: string[] = [];
	const batches = new Set<string>();
	for (const step of steps) {
		if (step.kind === 'finish') continue;
		const card = cards.get(step.pipeline);
		if (!card) {
			unpriced.push(`step ${step.n}: "${step.pipeline}" has no reviewed card to price it by`);
			continue;
		}
		const each = secondsPerImage(card, step.genPx, timingOf(timings, step.pipeline, step.genPx));
		if (each === null) {
			unpriced.push(
				card.billing === 'credits'
					? `step ${step.n}: "${step.pipeline}" bills credits`
					: `step ${step.n}: "${step.pipeline}" has no GPU seconds for ${step.genPx} px`,
			);
			continue;
		}
		if (each.guess) placeholder = true;
		seconds += each.seconds * step.variants;
		const batch = `${step.atlas}\u0000${step.pipeline}`;
		if (!batches.has(batch)) {
			batches.add(batch);
			seconds += card.gpu.coldStart;
		}
	}
	if (usdPerSecond === null) unpriced.push("the endpoint's GPU has no price");
	const gpuSeconds = Math.round(seconds * 10) / 10;
	return {
		gpuSeconds,
		gpuUsd: unpriced.length ? null : Math.round(gpuSeconds * usdPerSecond! * 10000) / 10000,
		placeholder,
		unpriced,
	};
}

/** Why `value` is not acceptable for `setting`, or null. Values travel as strings (Appendix A). */
function settingProblem(setting: CardSetting, value: string): string | null {
	if (value.length > 200) return 'is longer than 200 characters';
	if (setting.options?.length) {
		return setting.options.map(String).includes(value)
			? null
			: `must be one of ${setting.options.map(String).join(', ')}`;
	}
	if (typeof setting.default === 'boolean') {
		return value === 'true' || value === 'false' ? null : 'must be true or false';
	}
	if (isNum(setting.default) || isNum(setting.min) || isNum(setting.max)) {
		const n = Number(value);
		if (value.trim() === '' || !Number.isFinite(n)) return 'must be a number';
		if (isNum(setting.min) && n < setting.min) return `is below the card's minimum ${setting.min}`;
		if (isNum(setting.max) && n > setting.max) return `is above the card's maximum ${setting.max}`;
	}
	return null;
}

/** The generation sizes a card allows: its `gen_width` bounds, else the general ones. */
export function genPxRange(card: Card): { min: number; max: number; fixed: number | null } {
	const width = card.settings?.find((s) => s.key === 'gen_width');
	return {
		min: isNum(width?.min) ? width.min : GEN_PX_MIN,
		max: isNum(width?.max) ? width.max : GEN_PX_MAX,
		fixed: isNum(card.outputs?.fixedPx) ? card.outputs.fixedPx : null,
	};
}

/** The per-atlas facts a step sets, keyed so two steps on one atlas can be compared (§5). */
function atlasFacts(
	step: StepInput,
	card: Card | undefined,
	builtin: boolean,
): Map<string, string> {
	const facts = new Map<string, string>([
		['genPx', String(step.genPx)],
		['pipeline', step.pipeline],
	]);
	for (const s of step.settings) {
		const setting = card?.settings?.find((c) => c.key === s.key);
		if (!setting || scopeOf(setting) !== 'atlas') continue;
		// A built-in's per-atlas keys are shared by every built-in step on the atlas; a blueprint's
		// are its own `bpParams[<id>]`.
		facts.set(builtin ? `atlas:${s.key}` : `bp:${step.pipeline}:${s.key}`, s.value);
	}
	return facts;
}

function refProblem(ref: RefChoice, n: number, label: string): string | null {
	switch (ref.source) {
		case 'keep':
		case 'clear':
			return ref.value === '' ? null : `${label}: ${ref.source} takes no value`;
		case 'key':
			return SHEET_KEY.test(ref.value)
				? null
				: `${label}: a key is a Sheet Maker image (sheets/… or sheet_src/…)`;
		case 'mockupCrop':
			return null;
		case 'variant': {
			const step = STEP_REF.exec(ref.value);
			if (step) {
				return Number(step[1]) >= 1 && Number(step[1]) < n
					? null
					: `${label}: step:${step[1]} is not an earlier step`;
			}
			return VARIANT_REF.test(ref.value)
				? null
				: `${label}: a variant is step:<n> or <atlas>/<region>/<id>`;
		}
	}
}

const gives = (ref: RefChoice) =>
	ref.source === 'key' || ref.source === 'variant' || ref.source === 'mockupCrop';

/**
 * Check a recipe against the reviewed cards and the run (ADR-0008 §5). Answers the stored steps and
 * the recomputed projection, or every reason it fails. Nothing here trusts the model's numbers.
 */
export function validateRecipe(input: RecipeInput, ctx: ValidationContext): ValidationResult {
	const errors: string[] = [];
	const entries = new Map(ctx.catalogue.blueprints.map((b) => [b.id, b]));
	const cards = new Map(ctx.catalogue.blueprints.map((b) => [b.id, b.card]));
	const steps = input.steps ?? [];

	if (!ctx.planRegions.has(input.region)) {
		errors.push(`${input.region} is not a region the run's plan names`);
	}
	if (steps.length === 0) errors.push('a recipe has at least one step');
	if (steps.length > 8) errors.push('a recipe has at most 8 steps');

	const templateAtlases = new Set(ctx.others.map((r) => r.atlas));
	steps.forEach((step, i) => {
		const at = `step ${i + 1}`;
		if (step.n !== i + 1) errors.push(`${at}: steps are numbered 1, 2, 3… (got ${step.n})`);
		const onTemplate = step.atlas === input.atlas;
		if (step.atlas !== input.atlas && templateAtlases.has(step.atlas)) {
			errors.push(
				`${at}: ${step.atlas} is a template atlas of another recipe; a chain leaves its own atlas only for a scratch atlas`,
			);
		}
		if (step.kind === 'finish') {
			if (step.pipeline !== '') errors.push(`${at}: a finish step has no pipeline`);
			if (step.genPx !== 0 || step.variants !== 0 || step.settings.length) {
				errors.push(`${at}: a finish step renders nothing (genPx 0, variants 0, no settings)`);
			}
			if (i !== steps.length - 1) errors.push(`${at}: finish is the last step`);
			if (step.atlas !== input.atlas || step.region !== input.region) {
				errors.push(
					`${at}: finish lands on the recipe's own region ${input.atlas}/${input.region}`,
				);
			}
			if (step.style.source !== 'variant') {
				errors.push(`${at}: finish commits a variant (style.source variant)`);
			}
		} else {
			if (onTemplate && step.region !== input.region) {
				errors.push(
					`${at}: ${step.atlas}/${step.region} is another template region; work on a scratch atlas`,
				);
			}
			if (step.kind === 'process' && onTemplate) {
				errors.push(`${at}: a process step runs on a scratch atlas (atlas.duplicate_atlas)`);
			}
		}
		const styleWhy = refProblem(step.style, step.n, `${at} style`);
		if (styleWhy) errors.push(styleWhy);
		const shapeWhy = refProblem(step.shape, step.n, `${at} shape`);
		if (shapeWhy) errors.push(shapeWhy);
		if (step.kind === 'finish') return;

		const entry = entries.get(step.pipeline);
		const card = entry?.card;
		if (!entry || !card || card.status !== 'reviewed') {
			errors.push(`${at}: "${step.pipeline}" has no reviewed card`);
			return;
		}
		if (entry.kind !== 'image') errors.push(`${at}: "${step.pipeline}" is not an image pipeline`);
		if (card.billing === 'credits') {
			errors.push(`${at}: "${step.pipeline}" bills credits, which Director cannot track yet`);
		}
		if (step.kind === 'generate' && (card.inputs.prompt ?? 'none') === 'none') {
			errors.push(`${at}: "${step.pipeline}" takes no prompt, so it cannot be a generate step`);
		}
		const sourced = gives(step.style) || gives(step.shape);
		if (step.kind === 'process' && !sourced) {
			errors.push(`${at}: a process step needs a source image (style or shape)`);
		}
		if (card.inputs.sourceImage === 'required' && !sourced) {
			errors.push(`${at}: "${step.pipeline}" needs a source image`);
		}
		const range = genPxRange(card);
		if (!Number.isInteger(step.genPx) || step.genPx % 8 !== 0) {
			errors.push(`${at}: genPx is a whole number of pixels divisible by 8`);
		} else if (range.fixed !== null && step.genPx !== range.fixed) {
			errors.push(`${at}: "${step.pipeline}" renders at ${range.fixed} px only`);
		} else if (step.genPx < range.min || step.genPx > range.max) {
			errors.push(`${at}: genPx ${step.genPx} is outside ${range.min}–${range.max}`);
		}
		if (!Number.isInteger(step.variants) || step.variants < 1) {
			errors.push(`${at}: variants is at least 1`);
		} else if (step.variants > card.variants.max) {
			errors.push(`${at}: "${step.pipeline}" allows at most ${card.variants.max} variants`);
		}
		const seen = new Set<string>();
		for (const s of step.settings) {
			if (seen.has(s.key)) errors.push(`${at}: setting ${s.key} appears twice`);
			seen.add(s.key);
			if (SIZE_KEYS.has(s.key)) {
				errors.push(`${at}: ${s.key} is set by genPx, not as a setting`);
				continue;
			}
			const setting = card.settings?.find((c) => c.key === s.key);
			if (!setting) {
				errors.push(`${at}: "${step.pipeline}" has no setting ${s.key}`);
				continue;
			}
			const why = settingProblem(setting, s.value);
			if (why) errors.push(`${at}: ${s.key} ${why}`);
		}
	});

	const last = steps[steps.length - 1];
	const offTemplate = steps.some((s) => s.kind !== 'finish' && s.atlas !== input.atlas);
	if (last && offTemplate && last.kind !== 'finish') {
		errors.push('a chain that runs on a scratch atlas ends with a finish step');
	}
	if (steps.filter((s) => s.kind === 'finish').length > 1) errors.push('one finish step at most');

	// One generation size and one set of per-atlas settings per atlas, across every recipe.
	const facts = new Map<string, Map<string, { value: string; who: string }>>();
	const note = (recipeRegion: string, list: readonly StepInput[]) => {
		for (const step of list) {
			if (step.kind === 'finish') continue;
			const entry = entries.get(step.pipeline);
			const atlasFactsMap = facts.get(step.atlas) ?? new Map();
			facts.set(step.atlas, atlasFactsMap);
			for (const [key, value] of atlasFacts(step, entry?.card, entry?.builtin ?? false)) {
				const who = `${recipeRegion} step ${step.n}`;
				const prev = atlasFactsMap.get(key);
				if (!prev) atlasFactsMap.set(key, { value, who });
				else if (prev.value !== value) {
					errors.push(
						`${who}: atlas ${step.atlas} already has ${key} ${prev.value} (${prev.who}); one value per atlas`,
					);
				}
			}
		}
	};
	for (const other of ctx.others) {
		if (other.region !== input.region) note(other.region, other.steps);
	}
	note(input.region, steps);

	if (errors.length) return { ok: false, errors };
	const stored: StoredStep[] = steps.map((step) => {
		const card = cards.get(step.pipeline);
		return {
			...step,
			cardRev: step.kind === 'finish' ? 0 : (card?.rev ?? 0),
			licence: step.kind === 'finish' ? '' : (card?.licence ?? ''),
			status: 'planned',
		};
	});
	return {
		ok: true,
		steps: stored,
		projected: project(steps, cards, ctx.usdPerSecond, ctx.timings),
	};
}

/**
 * Whether a revision of an approved recipe needs the owner again (ADR-0008 §5, owner decision 9):
 * it changes a pipeline or where a step runs, raises the projected cost, or leaves it unpriced.
 */
export function needsReapproval(
	prev: StoredRecipe | null,
	next: Pick<StoredRecipe, 'steps' | 'projected'>,
) {
	if (!prev?.approved) return true;
	const chain = (steps: readonly StepInput[]) =>
		steps.map((s) => `${s.kind}:${s.pipeline}:${s.atlas}/${s.region}`).join('>');
	if (chain(prev.steps) !== chain(next.steps)) return true;
	if (next.projected.gpuUsd === null) return true;
	if (prev.projected.gpuUsd !== null && next.projected.gpuUsd > prev.projected.gpuUsd) return true;
	return next.projected.gpuSeconds > prev.projected.gpuSeconds;
}

/** One line per chain, e.g. "sdxl 1024 ×3 → birefnet → finish". */
export function chainLine(
	steps: readonly Pick<StepInput, 'kind' | 'pipeline' | 'genPx' | 'variants'>[],
): string {
	return steps
		.map((s) =>
			s.kind === 'finish'
				? 'finish'
				: `${s.pipeline}${s.kind === 'generate' ? ` ${s.genPx} ×${s.variants}` : ''}`,
		)
		.join(' → ');
}

/** A chain without its region: the shape a group default carries (§5 "Reuse"). */
export interface DefaultStep {
	kind: StepKind;
	pipeline: string;
	genPx: number;
	variants: number;
	settings: { key: string; value: string }[];
}

export const defaultChainOf = (steps: readonly StepInput[]): DefaultStep[] =>
	steps.map(({ kind, pipeline, genPx, variants, settings }) => ({
		kind,
		pipeline,
		genPx,
		variants,
		settings,
	}));

/**
 * The fallback default chain (§5 "Reuse") from the estimate profiles' `fallbackRecipe`: its
 * pipeline at its size and variants, then its process step, then finish.
 */
export function fallbackDefaultChain(r: {
	pipeline: string;
	genPx: number;
	variants: number;
	process: string;
}): DefaultStep[] {
	return [
		{ kind: 'generate', pipeline: r.pipeline, genPx: r.genPx, variants: r.variants, settings: [] },
		{ kind: 'process', pipeline: r.process, genPx: r.genPx, variants: 1, settings: [] },
		{ kind: 'finish', pipeline: '', genPx: 0, variants: 0, settings: [] },
	];
}

// ── The Art plan: what the owner reviews and edits (§7) ─────────────────────

/** A stored recipe as `run.set_recipe` would take it again: the input an owner edit starts from. */
export const recipeInputOf = (r: StoredRecipe): RecipeInput => ({
	region: r.region,
	atlas: r.atlas,
	group: r.group,
	steps: r.steps.map(
		({ n, kind, pipeline, atlas, region, genPx, variants, settings, style, shape, note }) => ({
			n,
			kind,
			pipeline,
			atlas,
			region,
			genPx,
			variants,
			settings: settings.map((s) => ({ ...s })),
			style: { ...style },
			shape: { ...shape },
			note,
		}),
	),
});

/**
 * The steps without step `n`, renumbered. A later step that took the removed step's image
 * (`step:<n>`) takes what the removed step took instead, so the chain stays connected; refs to
 * later steps move down by one.
 */
export function removeStep(steps: readonly StepInput[], n: number): StepInput[] {
	const gone = steps.find((s) => s.n === n);
	if (!gone) return steps.map((s) => ({ ...s }));
	const remap = (ref: RefChoice, fallback: RefChoice): RefChoice => {
		const m = STEP_REF.exec(ref.source === 'variant' ? ref.value : '');
		if (!m) return ref;
		const k = Number(m[1]);
		if (k === n) return { ...fallback };
		return k > n ? { source: 'variant', value: `step:${k - 1}` } : ref;
	};
	return steps
		.filter((s) => s.n !== n)
		.map((s, i) => ({
			...s,
			n: i + 1,
			style: remap(s.style, gone.style),
			shape: remap(s.shape, gone.shape),
		}));
}

/** Every step whose card's licence is not plain `ok`, for the before-publish list (§7). */
export function licenceFlags(
	recipes: readonly StoredRecipe[],
): { region: string; n: number; pipeline: string; licence: 'blocked' | 'conditional' }[] {
	const out: { region: string; n: number; pipeline: string; licence: 'blocked' | 'conditional' }[] =
		[];
	for (const r of recipes) {
		for (const s of r.steps) {
			if (s.licence === 'blocked' || s.licence === 'conditional') {
				out.push({ region: r.region, n: s.n, pipeline: s.pipeline, licence: s.licence });
			}
		}
	}
	return out;
}

/** Recipes of one group collapsed by identical chain: "11 Symbols: sdxl 1024 ×3 → birefnet → finish". */
export function planGroups(
	recipes: readonly StoredRecipe[],
): { group: string; chain: string; regions: string[] }[] {
	const out: { group: string; chain: string; regions: string[] }[] = [];
	for (const r of recipes) {
		const chain = chainLine(r.steps);
		const found = out.find((g) => g.group === r.group && g.chain === chain);
		if (found) found.regions.push(r.region);
		else out.push({ group: r.group, chain, regions: [r.region] });
	}
	return out;
}

// ── Chain pricing for the estimate (§6) ─────────────────────────────────────

export interface Span {
	low: number;
	high: number;
}

/** One region group as the estimate prices it: how many regions, and the chain each gets. */
export interface ChainGroup {
	group: string;
	regions: number;
	chain: readonly DefaultStep[];
	/** Where the chain came from, for the panel: a template default, or the fallback. */
	source: string;
}

export interface ChainPrice {
	gpu: string;
	/** Billed GPU seconds over every group, cold starts included. */
	seconds: Span;
	/** Null when anything cannot be priced: see `unpriced`. */
	usd: Span | null;
	/** Images rendered, every step of every region. */
	renders: number;
	/** Images the art director and the owner review: the generate steps' variants. */
	reviewedVariants: number;
	/** Recipe steps over every region, finish included (the technician's per-step work). */
	steps: number;
	/** True when a figure is a card's guess or the profiles' fallback, not a measurement. */
	placeholder: boolean;
	unpriced: string[];
	groups: { group: string; regions: number; chain: string; source: string; seconds: Span }[];
}

/**
 * The GPU side of the New-game estimate, priced per chain from the reviewed cards and the measured
 * timings (§6): per image, `secondsPerImage`; a step whose pipeline has no reviewed card takes the
 * profiles' `secondsPerVariantAt1024` scaled by pixel count and marks the figure a placeholder.
 * The high end never sits below that fallback for a guessed card, so a guess cannot shrink the
 * range. Fails closed: no GPU, an unpriced GPU, or a credit-billed card leaves `usd` null with
 * the reasons, and the run is not offered.
 */
export function priceChains(
	groups: readonly ChainGroup[],
	cards: ReadonlyMap<string, Card>,
	facts: { gpu: string; usdPerSecond: number | null; timings?: readonly Timing[] },
	fallbackAt1024: Span,
): ChainPrice {
	const unpriced: string[] = [];
	let placeholder = false;
	let renders = 0;
	let reviewedVariants = 0;
	let steps = 0;
	const total: Span = { low: 0, high: 0 };
	const rows: ChainPrice['groups'] = [];
	for (const g of groups) {
		const span: Span = { low: 0, high: 0 };
		const batches = new Set<string>();
		for (const step of g.chain) {
			steps += g.regions;
			if (step.kind === 'finish') continue;
			const images = step.variants * g.regions;
			renders += images;
			if (step.kind === 'generate') reviewedVariants += images;
			const scaleBy = (step.genPx * step.genPx) / (1024 * 1024);
			const fallback = { low: fallbackAt1024.low * scaleBy, high: fallbackAt1024.high * scaleBy };
			const card = cards.get(step.pipeline);
			let each: Span;
			if (!card) {
				placeholder = true;
				each = fallback;
			} else {
				const priced = secondsPerImage(
					card,
					step.genPx,
					timingOf(facts.timings, step.pipeline, step.genPx),
				);
				if (priced === null && card.billing === 'credits') {
					unpriced.push(`${g.group}: "${step.pipeline}" bills credits, which cannot be priced yet`);
					continue;
				}
				if (priced === null) {
					placeholder = true;
					each = fallback;
				} else if (priced.guess) {
					placeholder = true;
					each = { low: priced.seconds, high: Math.max(priced.seconds, fallback.high) };
				} else {
					each = { low: priced.seconds, high: priced.seconds };
				}
				if (!batches.has(step.pipeline)) {
					batches.add(step.pipeline);
					span.low += card.gpu.coldStart;
					span.high += card.gpu.coldStart;
				}
			}
			span.low += each.low * images;
			span.high += each.high * images;
		}
		total.low += span.low;
		total.high += span.high;
		rows.push({
			group: g.group,
			regions: g.regions,
			chain: chainLine(g.chain),
			source: g.source,
			seconds: span,
		});
	}
	if (!facts.gpu) unpriced.push('atlas-tool reports no RunPod GPU (RUNPOD_ENDPOINT_GPU)');
	else if (facts.usdPerSecond === null)
		unpriced.push(`pricing.json has no price for the GPU "${facts.gpu}"`);
	const rate = facts.usdPerSecond;
	return {
		gpu: facts.gpu,
		seconds: total,
		usd:
			unpriced.length || rate === null ? null : { low: total.low * rate, high: total.high * rate },
		renders,
		reviewedVariants,
		steps,
		placeholder,
		unpriced,
		groups: rows,
	};
}

/**
 * Why an owner's Art plan approval cannot stand, or null (§7): the approval names the revision of
 * every recipe the owner saw (`seen`, region → rev), so a plan that changed since never runs on
 * it; and a plan that cannot be priced is never approved (money fails closed). The worker refuses
 * on this, and the launcher refuses up front with the same words.
 */
export function approvalProblem(
	recipes: readonly StoredRecipe[],
	plan: ReadonlySet<string>,
	seen: unknown,
): string | null {
	if (typeof seen !== 'object' || seen === null || Array.isArray(seen)) {
		return 'the approval does not name the recipe revisions it approves';
	}
	const revs = seen as Record<string, unknown>;
	const named = new Set(Object.keys(revs));
	const planned = recipes.filter((r) => plan.has(r.region));
	if (planned.length === 0) return 'the run has no Art plan to approve';
	for (const r of planned) {
		if (revs[r.region] !== r.rev) {
			return `the Art plan changed since you saw it (${r.region} is at revision ${r.rev}); review it again`;
		}
		named.delete(r.region);
		if (r.projected.gpuUsd === null) {
			const why = (r.projected.unpriced ?? []).join('; ') || 'no price';
			return `${r.region} cannot be priced (${why}), so the plan cannot be approved`;
		}
	}
	if (named.size) {
		return `the Art plan changed since you saw it (${[...named].slice(0, 5).join(', ')} is not in it now); review it again`;
	}
	return null;
}
