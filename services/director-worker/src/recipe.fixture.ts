/**
 * Fixture for the recipe rules (ADR-0008 §5, `director-costs/recipe`):
 *   pnpm --filter director-worker check:recipes
 *
 * The reference template's 23-region plan (`docs/director/eval/blueprints/expected-art-plan.json`)
 * passes against the fixture catalogue; then each rule is broken on purpose and must be refused
 * with its reason, and the projection, re-approval and preset fallback are pinned.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	chainLine,
	needsReapproval,
	presetDefaultChain,
	secondsAt,
	validateRecipe,
	type Catalogue,
	type RecipeInput,
	type StoredRecipe,
	type ValidationContext,
} from 'director-costs/recipe';

let checks = 0;
let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ✓ ${name}`);
	else {
		failures++;
		console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
	}
};

const EVAL = fileURLToPath(new URL('../../../docs/director/eval/blueprints/', import.meta.url));
const catalogue = JSON.parse(readFileSync(`${EVAL}catalogue.json`, 'utf8')) as Catalogue;
const expected = JSON.parse(readFileSync(`${EVAL}expected-art-plan.json`, 'utf8')) as {
	plan: { batches: { name: string; regions: string[] }[] };
	recipes: RecipeInput[];
};
const planRegions = new Set(expected.plan.batches.flatMap((b) => b.regions));
const USD = 0.00053;

check('the reference plan names 23 regions', planRegions.size, 23);

// The whole plan, stored one recipe at a time as the worker would.
const stored: StoredRecipe[] = [];
const refused: string[] = [];
for (const recipe of expected.recipes) {
	const result = validateRecipe(recipe, {
		catalogue,
		planRegions,
		others: stored,
		usdPerSecond: USD,
	});
	if (!result.ok) refused.push(`${recipe.region}: ${result.errors.join('; ')}`);
	else {
		stored.push({
			...recipe,
			rev: 1,
			plannedBy: 'atlas-technician',
			approved: null,
			steps: result.steps,
			projected: result.projected,
		});
	}
}
check('every recipe of the reference plan passes', refused, []);
check(
	'...and is stored with its card revision and licence per step',
	stored[0]?.steps.map((s) => [s.cardRev, s.licence, s.status]),
	[
		[1, 'blocked', 'planned'],
		[1, 'conditional', 'planned'],
		[0, '', 'planned'],
	],
);
check(
	'the chain reads as one line',
	chainLine(stored[0].steps),
	'sdxl 1024 ×3 → birefnet → finish',
);

const ctx: ValidationContext = { catalogue, planRegions, others: stored, usdPerSecond: USD };
const h1 = expected.recipes.find((r) => r.region === 'H1')!;
const bg = expected.recipes.find((r) => r.region === 'Background')!;
const variant = (recipe: RecipeInput, edit: (r: RecipeInput) => void) => {
	const copy = structuredClone(recipe);
	edit(copy);
	return copy;
};
const reasons = (recipe: RecipeInput, over: Partial<ValidationContext> = {}) => {
	const result = validateRecipe(recipe, { ...ctx, ...over });
	return result.ok ? [] : result.errors;
};
const refusedFor = (name: string, recipe: RecipeInput, needle: string, over = {}) => {
	const why = reasons(recipe, over);
	check(name, why.some((r) => r.includes(needle)) ? needle : why, needle);
};

refusedFor(
	'a pipeline with no card is refused',
	variant(h1, (r) => (r.steps[0].pipeline = 'nope')),
	'"nope" has no reviewed card',
);
{
	const drafts = structuredClone(catalogue);
	drafts.blueprints.find((b) => b.id === 'birefnet')!.card.status = 'draft';
	refusedFor('a draft card is refused', h1, '"birefnet" has no reviewed card', {
		catalogue: drafts,
	});
}
refusedFor(
	'a credit-billed card is refused until ADR-0006 tracks credits',
	variant(h1, (r) => (r.steps[1].pipeline = 'fixture_api_cut')),
	'bills credits',
);
refusedFor(
	'a generate step on a card with no prompt is refused',
	variant(h1, (r) => (r.steps[0].pipeline = 'birefnet')),
	'takes no prompt',
);
refusedFor(
	'a process step with no source is refused',
	variant(h1, (r) => (r.steps[1].style = { source: 'keep', value: '' })),
	'needs a source image',
);
refusedFor(
	'a size outside the card range is refused',
	variant(bg, (r) => (r.steps[0].genPx = 4096)),
	'outside',
);
refusedFor(
	'more variants than the card allows are refused',
	variant(h1, (r) => (r.steps[0].variants = 7)),
	'at most 6 variants',
);
refusedFor(
	'a setting the card does not name is refused',
	variant(h1, (r) => r.steps[0].settings.push({ key: 'run_on', value: 'runpod' })),
	'has no setting run_on',
);
refusedFor(
	'a setting outside the card range is refused',
	variant(h1, (r) => (r.steps[0].settings[0].value = '80')),
	"above the card's maximum 45",
);
refusedFor(
	'the generation size is genPx, never a setting',
	variant(h1, (r) => r.steps[0].settings.push({ key: 'gen_width', value: '512' })),
	'set by genPx',
);
refusedFor(
	'a finish step lands only on the recipe region',
	variant(h1, (r) => (r.steps[2].region = 'H2')),
	'finish lands on',
);
refusedFor(
	'a step never touches another template region',
	variant(h1, (r) => (r.steps[0].region = 'H2')),
	'another template region',
);
refusedFor(
	'a process step on the template atlas is refused',
	variant(h1, (r) => (r.steps[1].atlas = 'symbols')),
	'runs on a scratch atlas',
);
refusedFor(
	'a scratch chain must end with finish',
	variant(h1, (r) => r.steps.pop()),
	'ends with a finish step',
);
refusedFor(
	'a variant reference must point at an earlier step',
	variant(h1, (r) => (r.steps[1].style.value = 'step:2')),
	'not an earlier step',
);
refusedFor(
	'a region the plan does not name is refused',
	variant(bg, (r) => (r.region = 'Extra')),
	"not a region the run's plan names",
);
refusedFor(
	'one generation size per atlas, across recipes',
	variant(
		expected.recipes.find((r) => r.region === 'H2')!,
		(r) => (r.steps[0].genPx = 768),
	),
	'already has genPx 1024',
);
refusedFor(
	'one value per per-atlas setting, across recipes',
	variant(
		expected.recipes.find((r) => r.region === 'H2')!,
		(r) => (r.steps[0].settings[1].value = 'off'),
	),
	'already has atlas:rembg on',
);
refusedFor(
	'one pipeline per atlas, across recipes',
	variant(
		expected.recipes.find((r) => r.region === 'Logo')!,
		(r) => (r.steps[0].pipeline = 'sdxl'),
	),
	'already has pipeline flux',
);
refusedFor(
	"a step never renders on another recipe's template atlas",
	variant(h1, (r) => {
		r.steps[1].atlas = 'ui';
		r.steps[1].region = 'Logo';
	}),
	'is a template atlas of another recipe',
);
check(
	'a region-scope setting may differ between regions',
	reasons(
		variant(
			expected.recipes.find((r) => r.region === 'H2')!,
			(r) => r.steps[0].settings.push({ key: 'ipadapter_weight', value: '0.5' }),
		),
	),
	[],
);

// Projection: linear in pixel count between the card's sizes, cold start once per batch.
const upscale = catalogue.blueprints.find((b) => b.id === 'fixture_upscale')!.card;
check('seconds at a listed size', secondsAt(upscale, 1024), 6);
check(
	'seconds between sizes, by pixel count',
	secondsAt(upscale, 768),
	2 + ((768 ** 2 - 512 ** 2) / (1024 ** 2 - 512 ** 2)) * 4,
);
check('seconds above the largest size scale by pixel count', secondsAt(upscale, 2048), 24);
check(
	'a card with no seconds is unknown',
	secondsAt({ ...upscale, gpu: { ...upscale.gpu, secondsPerImage: {} } }, 1024),
	null,
);
check('a guessed card marks the projection a placeholder', stored[0].projected.placeholder, true);

// Re-approval (owner decision 9).
const approved = { ...stored[0], approved: { by: 'owner', at: 'now', rev: 1 } };
check('an unapproved recipe always needs approval', needsReapproval(stored[0], stored[0]), true);
check(
	'the same chain at the same cost keeps its approval',
	needsReapproval(approved, approved),
	false,
);
check(
	'a changed pipeline needs re-approval',
	needsReapproval(approved, {
		...approved,
		steps: approved.steps.map((s, i) => (i === 1 ? { ...s, pipeline: 'fixture_upscale' } : s)),
	}),
	true,
);
check(
	'a step moved to another atlas or region needs re-approval',
	needsReapproval(approved, {
		...approved,
		steps: approved.steps.map((st, i) => (i === 1 ? { ...st, region: 'cut_H9' } : st)),
	}),
	true,
);
check(
	'a higher projection needs re-approval',
	needsReapproval(approved, {
		...approved,
		projected: { ...approved.projected, gpuSeconds: approved.projected.gpuSeconds + 1 },
	}),
	true,
);

check(
	'the preset fallback chain',
	presetDefaultChain({ blueprint: 'flux', finalPx: 768, variantsPerRegion: 2 }).map((s) => [
		s.kind,
		s.pipeline,
		s.genPx,
		s.variants,
	]),
	[
		['generate', 'flux', 768, 2],
		['process', 'birefnet', 768, 1],
		['finish', '', 0, 0],
	],
);
check('an empty preset falls back to sdxl 1024 ×3', presetDefaultChain(null)[0], {
	kind: 'generate',
	pipeline: 'sdxl',
	genPx: 1024,
	variants: 3,
	settings: [],
});

console.log(`recipes: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
