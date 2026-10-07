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
	NO_FLOOR,
	approvalProblem,
	carryProgress,
	chainLine,
	needsReapproval,
	presetDefaultChain,
	priceChains,
	project,
	recipeInputOf,
	parseStepInput,
	removeStep,
	secondsAt,
	secondsPerImage,
	validateRecipe,
	type Card,
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
		floor: NO_FLOOR,
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

const ctx: ValidationContext = {
	catalogue,
	planRegions,
	others: stored,
	usdPerSecond: USD,
	floor: NO_FLOOR,
};
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
{
	const cards = new Map(catalogue.blueprints.map((b) => [b.id, b.card]));
	const up = { ...h1.steps[1], pipeline: 'fixture_upscale', settings: [] };
	const floor = { seedSecondsPerImage: 600, delaySecondsPerJob: 5 };
	check(
		'a measured card is priced by its seconds plus the delay per job, above no floor',
		project([up], { cards, usdPerSecond: 1, floor }).gpuSeconds,
		6 + 5 + 30,
	);
	check(
		'a guessed card never projects below the seed seconds per render',
		project([h1.steps[1]], { cards, usdPerSecond: 1, floor }).gpuSeconds,
		600 + 5 + 60,
	);
	const noSeconds = new Map(cards);
	noSeconds.set('fixture_upscale', {
		...cards.get('fixture_upscale')!,
		gpu: { secondsPerImage: {}, coldStart: 0, source: 'measured' },
	});
	check(
		'a size the card has no seconds for leaves the cost unpriced (fails closed)',
		project([up], { cards: noSeconds, usdPerSecond: 1, floor }).gpuUsd,
		null,
	);
}
refusedFor(
	'a mockup crop is named by a region',
	variant(h1, (r) => (r.steps[0].style = { source: 'mockupCrop', value: '../x' })),
	'a mockup crop is named by its region',
);

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
	'more variants need re-approval',
	needsReapproval(approved, {
		...approved,
		steps: approved.steps.map((st, i) => (i === 0 ? { ...st, variants: st.variants + 1 } : st)),
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

// Pricing fails closed and measurements only raise a guess (card 8E, ADR-0008 §6).
const cards = new Map<string, Card>(catalogue.blueprints.map((b) => [b.id, b.card]));
const basis = { cards, usdPerSecond: USD, floor: NO_FLOOR };
const timing = (pipeline: string, genPx: number, exec: number, delay: number) => ({
	pipeline,
	genPx,
	jobs: 4,
	meanExecSeconds: exec,
	meanDelaySeconds: delay,
});
check(
	'an image costs the card seconds plus the measured delay',
	secondsPerImage(upscale, 1024, timing('fixture_upscale', 1024, 1, 5), {
		seedSecondsPerImage: 0,
		delaySecondsPerJob: 99,
	}),
	{ seconds: 11, guess: false },
);
check(
	'a slower measurement raises the guess',
	secondsPerImage(upscale, 1024, timing('fixture_upscale', 1024, 9, 0), {
		seedSecondsPerImage: 0,
		delaySecondsPerJob: 99,
	})?.seconds,
	9,
);
check(
	'with nothing measured the figure is the guess',
	secondsPerImage({ ...upscale, gpu: { ...upscale.gpu, source: 'guess' } }, 1024, null, {
		seedSecondsPerImage: 0,
		delaySecondsPerJob: 0,
	}),
	{
		seconds: 6,
		guess: true,
	},
);
check(
	'with nothing measured, the seed delay is priced per image (ADR-0008 §6)',
	secondsPerImage({ ...upscale, gpu: { ...upscale.gpu, source: 'guess' } }, 1024, null, {
		seedSecondsPerImage: 0,
		delaySecondsPerJob: 15,
	})?.seconds,
	21,
);
check(
	'…and a measured delay replaces it',
	secondsPerImage(upscale, 1024, timing('fixture_upscale', 1024, 6, 2), {
		seedSecondsPerImage: 0,
		delaySecondsPerJob: 15,
	})?.seconds,
	8,
);
check(
	'a guessed card never goes below the seed, even with a faster measurement beside it',
	secondsPerImage(
		{ ...upscale, gpu: { ...upscale.gpu, source: 'guess' } },
		1024,
		timing('fixture_upscale', 1024, 4, 1),
		{
			seedSecondsPerImage: 600,
			delaySecondsPerJob: 15,
		},
	)?.seconds,
	601,
);
check(
	'…while a measured card may: its seconds, raised only by a slower measurement',
	secondsPerImage(upscale, 1024, timing('fixture_upscale', 1024, 4, 1), {
		seedSecondsPerImage: 600,
		delaySecondsPerJob: 15,
	})?.seconds,
	7,
);
check(
	'no card seconds and nothing measured: not priced',
	secondsPerImage({ ...upscale, gpu: { ...upscale.gpu, secondsPerImage: {} } }, 1024, null, {
		seedSecondsPerImage: 0,
		delaySecondsPerJob: 15,
	}),
	null,
);
check(
	'no card seconds for the size: not priced, whatever was measured at it',
	secondsPerImage(
		{ ...upscale, gpu: { ...upscale.gpu, secondsPerImage: {} } },
		1024,
		timing('fixture_upscale', 1024, 6, 2),
		{ seedSecondsPerImage: 0, delaySecondsPerJob: 15 },
	),
	null,
);
check(
	'a credit-billed card is never priced',
	secondsPerImage({ ...upscale, billing: 'credits' }, 1024, null, {
		seedSecondsPerImage: 0,
		delaySecondsPerJob: 15,
	}),
	null,
);
const h1Steps = stored.find((r) => r.region === 'H1')!.steps;
check(
	'a step whose card is gone leaves the recipe unpriced',
	project(h1Steps, { ...basis, cards: new Map([...cards].filter(([id]) => id !== 'birefnet')) })
		.gpuUsd,
	null,
);
check(
	'…with the reason',
	project(h1Steps, { ...basis, cards: new Map([...cards].filter(([id]) => id !== 'birefnet')) })
		.unpriced?.[0]?.length !== undefined,
	true,
);
check(
	'an unpriced GPU leaves it unpriced',
	project(h1Steps, { ...basis, usdPerSecond: null }).gpuUsd,
	null,
);
const measured = project(h1Steps, { ...basis, timings: [timing('sdxl', 1024, 40, 10)] });
check(
	'a measured timing feeds the projection',
	measured.gpuSeconds > project(h1Steps, basis).gpuSeconds,
	true,
);
check(
	'an approved recipe whose projection becomes unpriced needs re-approval',
	needsReapproval(approved, {
		...approved,
		projected: { ...approved.projected, gpuUsd: null },
	}),
	true,
);

// The Art plan panel's helpers.
const input = recipeInputOf(stored[0]);
check('a stored recipe reads back as the input it came from', validateRecipe(input, ctx).ok, true);
const without = removeStep(input.steps, 2);
check(
	'removing a step renumbers the chain',
	without.map((s) => [s.n, s.kind]),
	[
		[1, 'generate'],
		[2, 'finish'],
	],
);
check('…and a step that took its image takes what it took', without[1].style, input.steps[1].style);

// Chain pricing for the New-game estimate.
const chain = [
	{ kind: 'generate' as const, pipeline: 'sdxl', genPx: 1024, variants: 3, settings: [] },
	{ kind: 'process' as const, pipeline: 'birefnet', genPx: 1024, variants: 1, settings: [] },
	{ kind: 'finish' as const, pipeline: '', genPx: 0, variants: 0, settings: [] },
];
const facts = { gpu: 'RTX 4090 (24 GB)', usdPerSecond: USD, seedDelaySeconds: 0 };
const fallback = { low: 12, high: 30 };
const priced = priceChains(
	[{ group: 'Symbols', regions: 10, chain, source: 'fallback' }],
	cards,
	facts,
	fallback,
);
check('a chain is priced', priced.usd !== null && priced.usd.low <= priced.usd.high, true);
check(
	'renders, reviewed variants and steps count every region',
	[priced.renders, priced.reviewedVariants, priced.steps],
	[40, 30, 30],
);
check(
	'a guessed card never shrinks the high end below the fallback',
	priced.seconds.high >= 30 * 30,
	true,
);
check(
	'no GPU named: no price, and why',
	(() => {
		const p = priceChains(
			[{ group: 'Symbols', regions: 1, chain, source: 'fallback' }],
			cards,
			{ gpu: '', usdPerSecond: null, seedDelaySeconds: 0 },
			fallback,
		);
		return [p.usd, p.unpriced.length];
	})(),
	[null, 1],
);
check(
	'a credit-billed card leaves the estimate unpriced',
	priceChains(
		[{ group: 'Symbols', regions: 1, chain, source: 'fallback' }],
		new Map(
			[...cards].map(([id, c]) => [id, id === 'sdxl' ? { ...c, billing: 'credits' as const } : c]),
		),
		facts,
		fallback,
	).usd,
	null,
);
check(
	'a pipeline with no reviewed card falls back to the profiles, as a placeholder',
	(() => {
		const p = priceChains(
			[
				{
					group: 'Symbols',
					regions: 1,
					chain: [{ ...chain[0], pipeline: 'unreviewed' }],
					source: 'fallback',
				},
			],
			cards,
			facts,
			fallback,
		);
		return [p.placeholder, p.seconds];
	})(),
	[true, { low: 36, high: 90 }],
);

// The owner approves the plan they saw (card 8E).
const seen = Object.fromEntries(stored.map((r) => [r.region, r.rev]));
/** Prices each recipe at its stored figure; `freshly` prices it again now. */
const stays = (r: StoredRecipe) => r.projected;
const freshly = (r: StoredRecipe) => project(r.steps, basis);
check(
	'an approval of the plan as stored stands',
	approvalProblem(stored, planRegions, seen, stays),
	null,
);
check(
	'an approval that names no revisions is refused',
	approvalProblem(stored, planRegions, undefined, stays)?.includes('revisions'),
	true,
);
check(
	'a recipe revised since it was seen refuses the approval',
	approvalProblem(
		stored.map((r, i) => (i === 0 ? { ...r, rev: 2 } : r)),
		planRegions,
		seen,
		stays,
	)?.includes('changed since you saw it'),
	true,
);
check(
	'a region the plan dropped since refuses it too',
	approvalProblem(
		stored,
		new Set([...planRegions].filter((x) => x !== stored[0].region)),
		seen,
		stays,
	)?.includes('not in it now'),
	true,
);
check(
	'an unpriced recipe is never approved',
	approvalProblem(
		stored.map((r, i) => (i === 0 ? { ...r, projected: { ...r.projected, gpuUsd: null } } : r)),
		planRegions,
		seen,
		stays,
	)?.includes('cannot be priced'),
	true,
);
check(
	'the plan is priced again at approval: a card that lost its review refuses it',
	approvalProblem(stored, planRegions, seen, (r) =>
		project(r.steps, { ...basis, cards: new Map([...cards].filter(([id]) => id !== 'birefnet')) }),
	)?.includes('cannot be priced'),
	true,
);
check(
	'…and a recipe stored unpriced is approvable once it prices now',
	approvalProblem(
		stored.map((r, i) => (i === 0 ? { ...r, projected: { ...r.projected, gpuUsd: null } } : r)),
		planRegions,
		seen,
		freshly,
	),
	null,
);
check(
	'a planned region with no recipe refuses the approval',
	approvalProblem(stored.slice(1), planRegions, seen, stays)?.includes('has a recipe yet'),
	true,
);

// A malformed step is a reason, never a throw (an owner's edit comes from outside).
const malformed = (edit: (step: Record<string, unknown>) => void) => {
	const copy = structuredClone(h1) as unknown as { steps: Record<string, unknown>[] };
	edit(copy.steps[0]);
	try {
		const result = validateRecipe(copy as unknown as RecipeInput, ctx);
		return result.ok ? 'passed' : 'refused';
	} catch {
		return 'threw';
	}
};
check(
	'a missing style, a null shape, a number setting value or a null setting is refused, not thrown on',
	[
		malformed((st) => delete st.style),
		malformed((st) => (st.shape = null)),
		malformed((st) => (st.settings = [{ key: 'ksampler_steps', value: 28 }])),
		malformed((st) => (st.settings = [null])),
		malformed((st) => (st.genPx = '1024')),
	],
	['refused', 'refused', 'refused', 'refused', 'refused'],
);
const extra = parseStepInput({ ...h1.steps[0], jobRef: 'st_0000000000000001', chosen: '7' });
check(
	'a step keeps only its own fields: a jobRef or a chosen sent with it is dropped',
	'step' in extra && !('jobRef' in extra.step) && !('chosen' in extra.step),
	true,
);

// What a revision keeps of what the previous one did.
const progressed = stored[0].steps.map((st, i) =>
	i === 0
		? {
				...st,
				status: 'chosen' as const,
				jobRef: 'st_00000000000000a1',
				rendered: ['1', '2'],
				chosen: '2',
			}
		: i === 1
			? { ...st, status: 'queued' as const, jobRef: 'st_00000000000000a2' }
			: st,
);
const later = stored[0].steps.map((st, i) => (i === 2 ? { ...st, note: 'changed' } : st));
check(
	'a revision keeps what its unchanged leading steps did: a rendered step is never re-opened',
	carryProgress(progressed, later).map((st) => [st.status, st.jobRef ?? null, st.chosen ?? null]),
	[
		['chosen', 'st_00000000000000a1', '2'],
		['queued', 'st_00000000000000a2', null],
		['planned', null, null],
	],
);
check(
	'a step read back from the database (keys in jsonb order) is still the same work',
	carryProgress(
		progressed.map((st) => ({
			...st,
			style: { value: st.style.value, source: st.style.source } as typeof st.style,
			shape: { value: st.shape.value, source: st.shape.source } as typeof st.shape,
		})),
		later,
	).map((st) => st.status),
	['chosen', 'queued', 'planned'],
);
check(
	'a step that changed, and every step after it, starts again',
	carryProgress(
		progressed,
		stored[0].steps.map((st, i) => (i === 0 ? { ...st, variants: 2 } : st)),
	).map((st) => st.status),
	['planned', 'planned', 'planned'],
);

// A revision that re-opens a rendered step goes back to the owner, whatever its price.
const progressedRecipe = { ...approved, steps: progressed };
const revise = (from: typeof progressed, i: number, key: string) =>
	carryProgress(
		from,
		stored[0].steps.map((st, k) =>
			k === i ? { ...st, settings: [...st.settings, { key, value: '7' }] } : st,
		),
	);
check(
	'a revision that keeps the rendered steps and changes a later one keeps its approval',
	needsReapproval(progressedRecipe, { ...progressedRecipe, steps: revise(progressed, 2, 'x') }),
	false,
);
check(
	'a revision that re-opens a rendered step needs the owner again, at the same price',
	needsReapproval(progressedRecipe, {
		...progressedRecipe,
		steps: revise(progressed, 0, 'ksampler_seed'),
	}),
	true,
);
check(
	'…and so does one that re-opens a render in flight',
	needsReapproval(progressedRecipe, { ...progressedRecipe, steps: revise(progressed, 1, 'blur') }),
	true,
);
const failedFirst = stored[0].steps.map((st, i) =>
	i === 0 ? { ...st, status: 'failed' as const, jobRef: 'st_00000000000000a3' } : st,
);
check(
	'a failed step it re-opens is queued again under the approval, as any retry is',
	needsReapproval(
		{ ...approved, steps: failedFirst },
		{ ...approved, steps: revise(failedFirst, 0, 'ksampler_seed') },
	),
	false,
);

console.log(`recipes: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
