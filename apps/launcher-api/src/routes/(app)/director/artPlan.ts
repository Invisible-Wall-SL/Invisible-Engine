import {
	chainLine,
	genPxRange,
	project,
	recipeInputOf,
	removeStep,
	scopeOf,
	stepKey,
	validateRecipe,
	type Card,
	type CardSetting,
	type PriceBasis,
	type StepInput,
	type StoredRecipe,
	type StoredStep,
} from 'director-costs/recipe';
import type { ArtPlanAnswer } from '$lib/server/director/artPlan';

/**
 * The Live run screen's view of a run's art (ADR-0008 §5, §7; card 8E): the Art plan checkpoint
 * (recipes grouped by region group and collapsed by identical chain, each pipeline with its card's
 * purpose, the projection against the cap), the owner's edits within the cards' ranges, the
 * before-publish licence list and "How this was made" per region. Pure over the `/recipes` answer,
 * so a fixture drives it without a browser. An edit is checked here with the SAME rules module the
 * worker stores it with (`director-costs/recipe`), so the owner sees a refusal at the field; the
 * worker checks again against the cards as they are then, and the stored plan is what is approved.
 */

export type { ArtPlanAnswer };
export type PlanRecipe = ArtPlanAnswer['recipes'][number];

/** An owner's edited chain, and the revision of the recipe it was edited from. */
export interface Draft {
	rev: number;
	steps: readonly StepInput[];
}

/** The owner's edited chains, by region; a region absent here is as the technician planned it. */
export type Drafts = ReadonlyMap<string, Draft>;

export interface PlanRow {
	group: string;
	/** "sdxl 1024 ×3 → birefnet → finish". */
	chain: string;
	/** The regions this chain is planned for, in the plan's order. */
	regions: string[];
	/** The first region's steps, as edited: what the row shows and edits for all of them. */
	steps: StepInput[];
	edited: boolean;
	/** Why the edited chain would be refused, for any of its regions; empty when it passes. */
	errors: string[];
	gpuUsd: number | null;
	gpuSeconds: number;
	placeholder: boolean;
}

export interface PlanGroup {
	group: string;
	rows: PlanRow[];
	regions: number;
	gpuUsd: number | null;
}

export interface ArtPlanView {
	groups: PlanGroup[];
	/** Planned regions with no recipe yet. */
	missing: string[];
	/** Recipes of regions the latest plan no longer names: never rendered on an approval. */
	outside: string[];
	/** Recipes not yet approved at their current revision. */
	pending: number;
	/** The projection over every planned recipe, as edited; null when any cannot be priced. */
	gpuUsd: number | null;
	gpuSeconds: number;
	placeholder: boolean;
	/** Why the projection has no price: one line per reason, naming the regions it holds back. */
	unpriced: string[];
	/** Edited regions whose chain breaks a card rule (their rows say how). */
	invalid: number;
	/** What an approval names: the revision of every planned recipe, by region. */
	recipeRevs: Record<string, number>;
	/** The edits to send, every edited region's chain whole, with the revision it was edited on. */
	edits: { region: string; rev: number; steps: StepInput[] }[];
	/** True when every edited chain passes the rules. */
	editsValid: boolean;
}

const unapproved = (r: StoredRecipe) => !r.approved || r.approved.rev !== r.rev;

export const cardsOf = (answer: ArtPlanAnswer): Map<string, Card> =>
	new Map((answer.catalogue?.blueprints ?? []).map((b) => [b.id, b.card]));

export const purposeOf = (answer: ArtPlanAnswer, pipeline: string): string =>
	answer.catalogue?.blueprints.find((b) => b.id === pipeline)?.card.purpose ?? '';

/** Two chains are the same as the rules see them: field by field, never by key order. */
const same = (a: readonly StepInput[], b: readonly StepInput[]) =>
	a.length === b.length && a.every((step, i) => stepKey(step, true) === stepKey(b[i], true));

/** A chain without the atlas and region each step runs on: regions sharing it share one row. */
const shapeOf = (steps: readonly StepInput[]) =>
	steps
		.map((s) =>
			JSON.stringify([
				s.kind,
				s.pipeline,
				s.genPx,
				s.variants,
				[...s.settings].map((x) => [x.key, x.value]).sort((a, b) => a[0].localeCompare(b[0])),
			]),
		)
		.join('>');

const asStored = (recipe: StoredRecipe, steps: readonly StepInput[]): StoredRecipe => ({
	...recipe,
	steps: steps.map((s): StoredStep => ({ ...s, cardRev: 0, licence: '', status: 'planned' })),
});

/** Every planned recipe with the drafts applied, as the rules see the run. */
function editedRecipes(recipes: readonly PlanRecipe[], drafts: Drafts): StoredRecipe[] {
	return recipes.map((r) => {
		const draft = drafts.get(r.region);
		return draft ? asStored(r, draft.steps) : r;
	});
}

/** What the run's chains are priced on now: the answer's cards, rate, timings and seed delay. */
export const basisOfAnswer = (answer: ArtPlanAnswer): PriceBasis => ({
	cards: cardsOf(answer),
	usdPerSecond: answer.catalogue?.usdPerSecond ?? null,
	timings: answer.timings,
	floor: answer.floor,
});

/**
 * The drafts still worth keeping after the recipes were read again: those made on the revision
 * each recipe still has and that still change it. An edit the worker stored moved its recipe on,
 * and a technician's revision since makes a draft stale; one the worker refused stays, to fix.
 */
export function pruneDrafts(answer: ArtPlanAnswer, drafts: Drafts): Map<string, Draft> {
	const out = new Map<string, Draft>();
	for (const [region, draft] of drafts) {
		const recipe = answer.recipes.find((r) => r.region === region);
		if (recipe && recipe.rev === draft.rev && !same(draft.steps, recipeInputOf(recipe).steps)) {
			out.set(region, draft);
		}
	}
	return out;
}

interface Outcome {
	/** The rules' refusals of an edited chain; empty when it passes (or was not edited). */
	errors: string[];
	/** Why it has no price; empty when it has one. */
	unpriced: string[];
	gpuUsd: number | null;
	gpuSeconds: number;
	placeholder: boolean;
}

/**
 * One planned region as the owner sees it now. Every chain is priced again from the cards, the
 * rate and the timings as they are, so an edited row and an unedited one compare like for like
 * (a stored projection predates the timings measured since), exactly as the worker prices the
 * plan again when the owner approves it (`approvalProblem`).
 */
function outcomeOf(
	answer: ArtPlanAnswer,
	recipe: PlanRecipe,
	draft: Draft | undefined,
	others: readonly StoredRecipe[],
	plan: ReadonlySet<string>,
	basis: PriceBasis,
): Outcome {
	if (!answer.catalogue) {
		const why = answer.catalogueError ?? 'The blueprint catalogue could not be read.';
		return {
			errors: draft ? [why] : [],
			unpriced: [why],
			gpuUsd: null,
			gpuSeconds: 0,
			placeholder: true,
		};
	}
	if (draft) {
		const result = validateRecipe(
			{ region: recipe.region, atlas: recipe.atlas, group: recipe.group, steps: [...draft.steps] },
			{
				catalogue: answer.catalogue,
				planRegions: plan,
				others,
				usdPerSecond: basis.usdPerSecond,
				timings: answer.timings,
				floor: basis.floor,
			},
		);
		if (!result.ok) {
			return {
				errors: result.errors,
				unpriced: [],
				gpuUsd: null,
				gpuSeconds: 0,
				placeholder: true,
			};
		}
		return {
			errors: [],
			unpriced: result.projected.unpriced ?? [],
			gpuUsd: result.projected.gpuUsd,
			gpuSeconds: result.projected.gpuSeconds,
			placeholder: result.projected.placeholder,
		};
	}
	const now = project(recipe.steps, basis);
	return {
		errors: [],
		unpriced: now.unpriced ?? [],
		gpuUsd: now.gpuUsd,
		gpuSeconds: now.gpuSeconds,
		placeholder: now.placeholder,
	};
}

const addUsd = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
const roundUsd = (usd: number | null) => (usd === null ? null : Math.round(usd * 10000) / 10000);

export function artPlanView(answer: ArtPlanAnswer, drafts: Drafts = new Map()): ArtPlanView {
	const planned = answer.recipes.filter((r) => r.planned);
	const have = new Set(planned.map((r) => r.region));
	const all = editedRecipes(answer.recipes, drafts);
	const plan = new Set(answer.plan.map((p) => p.region));
	const basis = basisOfAnswer(answer);
	const outcome = new Map<string, Outcome>(
		planned.map((r) => [
			r.region,
			outcomeOf(
				answer,
				r,
				drafts.get(r.region),
				all.filter((o) => o.region !== r.region),
				plan,
				basis,
			),
		]),
	);

	const groups: PlanGroup[] = [];
	for (const r of planned) {
		const steps = [...(drafts.get(r.region)?.steps ?? recipeInputOf(r).steps)];
		let group = groups.find((g) => g.group === r.group);
		if (!group) {
			group = { group: r.group, rows: [], regions: 0, gpuUsd: 0 };
			groups.push(group);
		}
		const o = outcome.get(r.region)!;
		const row = group.rows.find((x) => shapeOf(x.steps) === shapeOf(steps));
		if (row) {
			row.regions.push(r.region);
			row.errors.push(...o.errors.filter((e) => !row.errors.includes(e)));
			row.gpuUsd = addUsd(row.gpuUsd, o.gpuUsd);
			row.gpuSeconds += o.gpuSeconds;
			row.placeholder ||= o.placeholder;
			row.edited ||= drafts.has(r.region);
		} else {
			group.rows.push({
				group: r.group,
				chain: chainLine(steps),
				regions: [r.region],
				steps,
				edited: drafts.has(r.region),
				errors: [...o.errors],
				gpuUsd: o.gpuUsd,
				gpuSeconds: o.gpuSeconds,
				placeholder: o.placeholder,
			});
		}
		group.regions++;
		group.gpuUsd = addUsd(group.gpuUsd, o.gpuUsd);
	}
	for (const g of groups) {
		g.gpuUsd = roundUsd(g.gpuUsd);
		for (const row of g.rows) row.gpuUsd = roundUsd(row.gpuUsd);
	}

	// One line per reason, naming the regions it holds back.
	const reasons = new Map<string, string[]>();
	for (const r of planned) {
		for (const why of outcome.get(r.region)!.unpriced) {
			reasons.set(why, [...(reasons.get(why) ?? []), r.region]);
		}
	}
	const unpriced = [...reasons].map(([why, regions]) =>
		regions.length <= 3
			? `${regions.join(', ')}: ${why}`
			: `${regions.slice(0, 3).join(', ')} and ${regions.length - 3} more: ${why}`,
	);
	const values = [...outcome.values()];
	const edits = planned.flatMap((r) => {
		const d = drafts.get(r.region);
		return d && !same(d.steps, recipeInputOf(r).steps)
			? [{ region: r.region, rev: d.rev, steps: [...d.steps] }]
			: [];
	});
	return {
		groups,
		missing: answer.plan.filter((p) => !have.has(p.region)).map((p) => p.region),
		outside: answer.recipes.filter((r) => !r.planned).map((r) => r.region),
		pending: planned.filter(unapproved).length,
		gpuUsd: roundUsd(values.reduce<number | null>((sum, o) => addUsd(sum, o.gpuUsd), 0)),
		gpuSeconds: Math.round(values.reduce((sum, o) => sum + o.gpuSeconds, 0)),
		placeholder: values.some((o) => o.placeholder),
		unpriced,
		invalid: planned.filter((r) => outcome.get(r.region)!.errors.length > 0).length,
		recipeRevs: Object.fromEntries(planned.map((r) => [r.region, r.rev])),
		edits,
		editsValid: edits.every((e) => (outcome.get(e.region)?.errors ?? []).length === 0),
	};
}

// ── Editing ───────────────────────────────────────────────────────────────────

export type StepPatch =
	| { pipeline: string }
	| { genPx: number }
	| { variants: number }
	| { setting: { key: string; value: string } }
	| { remove: true };

/** One step's patch, applied to every region of a row. A changed pipeline drops its settings:
 *  they were the old card's. An empty setting value takes it out (the card's default applies). */
export function editRow(
	answer: ArtPlanAnswer,
	drafts: Drafts,
	regions: readonly string[],
	n: number,
	patch: StepPatch,
): Map<string, Draft> {
	const next = new Map<string, Draft>(drafts);
	for (const region of regions) {
		const recipe = answer.recipes.find((r) => r.region === region);
		if (!recipe) continue;
		const draft = drafts.get(region);
		const rev = draft?.rev ?? recipe.rev;
		const steps = [...(draft?.steps ?? recipeInputOf(recipe).steps)];
		if ('remove' in patch) {
			next.set(region, { rev, steps: removeStep(steps, n) });
			continue;
		}
		next.set(region, {
			rev,
			steps: steps.map((s) => {
				if (s.n !== n) return s;
				if ('pipeline' in patch) return { ...s, pipeline: patch.pipeline, settings: [] };
				if ('genPx' in patch) return { ...s, genPx: patch.genPx };
				if ('variants' in patch) return { ...s, variants: patch.variants };
				const { key, value } = patch.setting;
				const rest = s.settings.filter((x) => x.key !== key);
				return { ...s, settings: value === '' ? rest : [...rest, { key, value }] };
			}),
		});
	}
	return next;
}

/** The pipelines a step may switch to: reviewed image cards fit for its kind. */
export function pipelineOptions(answer: ArtPlanAnswer, step: StepInput): string[] {
	if (step.kind === 'finish') return [];
	return (answer.catalogue?.blueprints ?? [])
		.filter((b) => b.kind === 'image' && b.card.billing !== 'credits')
		.filter((b) => step.kind !== 'generate' || (b.card.inputs.prompt ?? 'none') !== 'none')
		.map((b) => b.id);
}

const SIZES = [512, 768, 1024, 1280, 1536, 2048];

/** The sizes a step may render at under its card, the current one always among them. */
export function sizeOptions(card: Card | undefined, current: number): number[] {
	if (!card) return [current];
	const range = genPxRange(card);
	if (range.fixed !== null) return [range.fixed];
	const out = SIZES.filter((px) => px >= range.min && px <= range.max);
	if (!out.includes(current)) out.push(current);
	return out.sort((a, b) => a - b);
}

export function variantOptions(card: Card | undefined, current: number): number[] {
	const max = Math.max(1, card?.variants.max ?? current);
	return Array.from({ length: max }, (_, i) => i + 1);
}

/** The settings a step's card lets an edit set: with their scope, range or options. */
export const editableSettings = (card: Card | undefined): CardSetting[] =>
	(card?.settings ?? []).filter((s) => s.key !== 'gen_width' && s.key !== 'gen_height');

export const settingScope = (s: CardSetting) => scopeOf(s);

// ── Before publishing, and how a region was made ─────────────────────────────

type Licence = Card['licence'] | '';
const LICENCE_RANK: Record<Licence, number> = { '': 0, ok: 0, conditional: 1, blocked: 2 };
const worse = (a: Licence, b: Licence): Licence => (LICENCE_RANK[b] > LICENCE_RANK[a] ? b : a);

/** Whether a step's work reached the project: it rendered, was picked, or committed a tile. */
const reachedProject = (s: StoredStep) =>
	s.status === 'done' || s.status === 'chosen' || (s.kind === 'finish' && Boolean(s.chosen));

/**
 * Every step whose blueprint is blocked or conditional for its licence (ADR-0008 §7), for the
 * before-publish list: the planned recipes' steps, and every step of any recipe whose art reached
 * the project (a region a later plan dropped keeps the tile it committed). The licence is the
 * worse of the one the step was planned with and its card's now; a card no longer reviewed counts
 * as conditional, since nothing vouches for it. Grouped by blueprint and licence, blocked first,
 * each group naming every region and step.
 */
export function licenceList(
	answer: ArtPlanAnswer,
): { pipeline: string; licence: 'blocked' | 'conditional'; steps: string[] }[] {
	const cards = cardsOf(answer);
	const out: { pipeline: string; licence: 'blocked' | 'conditional'; steps: string[] }[] = [];
	for (const r of answer.recipes) {
		for (const s of r.steps) {
			if (s.kind === 'finish' || (!r.planned && !reachedProject(s))) continue;
			const now: Licence = answer.catalogue
				? (cards.get(s.pipeline)?.licence ?? 'conditional')
				: s.licence;
			const licence = worse(s.licence, now);
			if (licence !== 'blocked' && licence !== 'conditional') continue;
			const step = `${r.region} (step ${s.n})`;
			const found = out.find((g) => g.pipeline === s.pipeline && g.licence === licence);
			if (found) found.steps.push(step);
			else out.push({ pipeline: s.pipeline, licence, steps: [step] });
		}
	}
	return out.sort((a, b) => LICENCE_RANK[b.licence] - LICENCE_RANK[a.licence]);
}

const KIND_WORDS: Record<StepInput['kind'], string> = {
	generate: 'Generate',
	process: 'Process',
	finish: 'Finish',
};

const STATUS_WORDS: Record<StoredStep['status'], string> = {
	planned: 'planned',
	queued: 'rendering',
	done: 'rendered',
	chosen: 'chosen',
	failed: 'failed',
};

export interface MadeStep {
	n: number;
	/** "Generate · sdxl · 1024 px × 3 · on symbols/H1". */
	line: string;
	status: string;
	purpose: string;
	licence: StoredStep['licence'];
	/** The image the step left: its chosen variant, else its first render; the finish's tile. */
	image: { atlas: string; region: string; id: string } | null;
}

export interface MadeOf {
	region: string;
	rev: number;
	approvedBy: string | null;
	editedBy: string | null;
	steps: MadeStep[];
	/** The committed tile, once the finish step ran. */
	tile: { atlas: string; region: string; id: string } | null;
}

const VARIANT_REF =
	/^([A-Za-z0-9_-][A-Za-z0-9_.-]{0,119})\/([A-Za-z0-9_][A-Za-z0-9_.()-]{0,119})\/([0-9]{1,8})$/;
const VARIANT_ID = /^[0-9]{1,8}$/;

/** "How this was made" for one region: its recipe step by step, with each step's image. */
export function madeOf(answer: ArtPlanAnswer, region: string): MadeOf | null {
	const recipe = answer.recipes.find((r) => r.region === region);
	if (!recipe) return null;
	let tile: MadeOf['tile'] = null;
	const steps = recipe.steps.map((s): MadeStep => {
		let image: MadeStep['image'] = null;
		if (s.kind === 'finish') {
			const m = VARIANT_REF.exec(s.chosen ?? '');
			if (m) image = tile = { atlas: m[1], region: m[2], id: m[3] };
		} else {
			const id = s.chosen ?? s.rendered?.[0];
			if (id && VARIANT_ID.test(id)) image = { atlas: s.atlas, region: s.region, id };
		}
		const line =
			s.kind === 'finish'
				? `${KIND_WORDS.finish} · commit the chain's image as ${s.atlas}/${s.region}`
				: `${KIND_WORDS[s.kind]} · ${s.pipeline} · ${s.genPx} px × ${s.variants} · on ${s.atlas}/${s.region}${
						s.settings.length ? ` · ${s.settings.map((x) => `${x.key} ${x.value}`).join(', ')}` : ''
					}`;
		return {
			n: s.n,
			line,
			status:
				s.kind === 'finish'
					? s.status === 'done'
						? 'committed'
						: 'not yet committed'
					: (STATUS_WORDS[s.status] ?? s.status),
			purpose: s.kind === 'finish' ? '' : purposeOf(answer, s.pipeline),
			licence: s.licence,
			image,
		};
	});
	return {
		region,
		rev: recipe.rev,
		approvedBy: recipe.approved?.by ?? null,
		editedBy: recipe.editedBy ?? null,
		steps,
		tile,
	};
}
