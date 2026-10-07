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
	chosen?: string;
}

export interface Projection {
	gpuSeconds: number;
	/** Null while the endpoint's GPU has no price. */
	gpuUsd: number | null;
	/** True when a step's card has no seconds for its size, or a card's seconds are a guess. */
	placeholder: boolean;
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

/** The recipe's projected GPU time and cost, recomputed by code from the cards (§6). */
export function project(
	steps: readonly StepInput[],
	cards: ReadonlyMap<string, Card>,
	usdPerSecond: number | null,
): Projection {
	let seconds = 0;
	let placeholder = false;
	const batches = new Set<string>();
	for (const step of steps) {
		if (step.kind === 'finish') continue;
		const card = cards.get(step.pipeline);
		if (!card) continue;
		const each = secondsAt(card, step.genPx);
		if (each === null) placeholder = true;
		if (card.gpu.source !== 'measured') placeholder = true;
		seconds += (each ?? 0) * step.variants;
		const batch = `${step.atlas}\u0000${step.pipeline}`;
		if (!batches.has(batch)) {
			batches.add(batch);
			seconds += card.gpu.coldStart;
		}
	}
	const gpuSeconds = Math.round(seconds * 10) / 10;
	return {
		gpuSeconds,
		gpuUsd: usdPerSecond === null ? null : Math.round(gpuSeconds * usdPerSecond * 10000) / 10000,
		placeholder,
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
	return { ok: true, steps: stored, projected: project(steps, cards, ctx.usdPerSecond) };
}

/**
 * Whether a revision of an approved recipe needs the owner again (ADR-0008 §5, owner decision 9):
 * it changes a pipeline, or raises the projected cost.
 */
export function needsReapproval(
	prev: StoredRecipe | null,
	next: Pick<StoredRecipe, 'steps' | 'projected'>,
) {
	if (!prev?.approved) return true;
	const chain = (steps: readonly StepInput[]) =>
		steps.map((s) => `${s.kind}:${s.pipeline}:${s.atlas}/${s.region}`).join('>');
	if (chain(prev.steps) !== chain(next.steps)) return true;
	return next.projected.gpuSeconds > prev.projected.gpuSeconds;
}

/** One line per chain, e.g. "sdxl 1024 ×3 → birefnet → finish". */
export function chainLine(steps: readonly StepInput[]): string {
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

/** The preset a run stored before card 8C, as far as the fallback recipe reads it. */
export interface PresetShape {
	blueprint?: unknown;
	finalPx?: unknown;
	variantsPerRegion?: unknown;
}

/**
 * The fallback default recipe until a template has its own (§5, §1 "expand then contract"): the
 * old preset's blueprint at its final size and its variants, then `birefnet`, then finish.
 */
export function presetDefaultChain(preset: PresetShape | null | undefined): DefaultStep[] {
	const pipeline =
		typeof preset?.blueprint === 'string' && preset.blueprint ? preset.blueprint : 'sdxl';
	const genPx = isNum(preset?.finalPx) ? preset.finalPx : 1024;
	const variants = isNum(preset?.variantsPerRegion) ? preset.variantsPerRegion : 3;
	return [
		{ kind: 'generate', pipeline, genPx, variants, settings: [] },
		{ kind: 'process', pipeline: 'birefnet', genPx, variants: 1, settings: [] },
		{ kind: 'finish', pipeline: '', genPx: 0, variants: 0, settings: [] },
	];
}
