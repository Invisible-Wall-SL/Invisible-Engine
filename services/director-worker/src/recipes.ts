import {
	chainLine,
	defaultChainOf,
	needsReapproval,
	presetDefaultChain,
	validateRecipe,
	type Catalogue,
	type DefaultStep,
	type RecipeInput,
	type StoredRecipe,
} from 'director-costs/recipe';
import { applyTransition, insertEvent, runSpend, type Db, type LiveRun } from './store.ts';
import { transition } from './runState.ts';

/**
 * Recipes on the run (ADR-0008 §5, §7): the technician's plan per region, stored in
 * `director_regions.recipe_json` only after `director-costs/recipe` passes it, and the Art plan
 * gate the worker's own code opens once every region the coordinator's plan names has one. The
 * launcher's `atlas.queue_variants` refuses any render no approved recipe step names, so nothing
 * reaches RunPod before the owner (or, with the checkpoint off, the cap) says yes.
 */

export const TECHNICIAN = 'atlas-technician';

/** What `run.set_recipe` needs from outside the transaction: the reviewed cards and the GPU price. */
export interface RecipeDeps {
	catalogue: Catalogue;
	/** USD per second of the endpoint's GPU, or null when it is unpriced. */
	usdPerSecond: number | null;
}

/** The regions the coordinator's latest `run.set_plan` names, each with its batch (group). */
export async function planRegions(db: Db, runId: string): Promise<Map<string, string>> {
	const [row] = await db<{ payload_json: { batches?: { name?: unknown; regions?: unknown }[] } }[]>`
		select payload_json from director_events
		where run_id = ${runId} and kind = 'activity' and payload_json->>'type' = 'plan'
		order by id desc limit 1`;
	const out = new Map<string, string>();
	for (const batch of row?.payload_json.batches ?? []) {
		if (!Array.isArray(batch.regions)) continue;
		for (const region of batch.regions) {
			if (typeof region === 'string' && !out.has(region)) out.set(region, String(batch.name ?? ''));
		}
	}
	return out;
}

export async function loadRecipes(db: Db, runId: string): Promise<StoredRecipe[]> {
	const rows = await db<{ recipe_json: StoredRecipe }[]>`
		select recipe_json from director_regions
		where run_id = ${runId} and recipe_json is not null
		order by region`;
	return rows.map((r) => r.recipe_json);
}

async function storeRecipe(tx: Db, runId: string, recipe: StoredRecipe): Promise<void> {
	await tx`
		insert into director_regions (run_id, region, region_group, recipe_json, recipe_rev)
		values (${runId}, ${recipe.region}, ${recipe.group}, ${tx.json(recipe as never)}, ${recipe.rev})
		on conflict (run_id, region) do update
		set region_group = excluded.region_group, recipe_json = excluded.recipe_json,
			recipe_rev = excluded.recipe_rev, updated_at = now()`;
}

export type SetRecipeOutcome =
	{ ok: true; value: Record<string, unknown> } | { ok: false; message: string };

/**
 * `run.set_recipe`: validate, store as `rev + 1`, and open the Art plan once the plan is complete.
 * A revision of an approved recipe keeps its approval only when it changes no pipeline and does not
 * raise the projected cost (owner decision 9).
 */
export async function setRecipe(
	tx: Db,
	live: LiveRun,
	agent: string,
	input: RecipeInput,
	deps: RecipeDeps,
): Promise<SetRecipeOutcome> {
	const plan = await planRegions(tx, live.id);
	if (plan.size === 0) {
		return {
			ok: false,
			message:
				"Refused: the run has no plan yet. The coordinator's run.set_plan names the regions first.",
		};
	}
	const group = plan.get(input.region);
	if (group !== undefined && group !== input.group) {
		return {
			ok: false,
			message: `Refused: ${input.region} is in the plan's "${group}" batch, not "${input.group}".`,
		};
	}
	const recipes = await loadRecipes(tx, live.id);
	const prev = recipes.find((r) => r.region === input.region) ?? null;
	const result = validateRecipe(input, {
		catalogue: deps.catalogue,
		planRegions: new Set(plan.keys()),
		others: recipes,
		usdPerSecond: deps.usdPerSecond,
	});
	if (!result.ok) {
		return {
			ok: false,
			message: `Not stored. Fix and send the whole recipe again:\n- ${result.errors.join('\n- ')}`,
		};
	}
	const rev = (prev?.rev ?? 0) + 1;
	const next = { steps: result.steps, projected: result.projected };
	const keep = prev?.approved && !needsReapproval(prev, next);
	const recipe: StoredRecipe = {
		rev,
		region: input.region,
		atlas: input.atlas,
		group: input.group,
		plannedBy: agent,
		approved: keep && prev?.approved ? { ...prev.approved, rev } : null,
		...next,
	};
	await storeRecipe(tx, live.id, recipe);
	await insertEvent(
		tx,
		live.id,
		agent,
		'activity',
		{
			type: 'recipe',
			region: recipe.region,
			group: recipe.group,
			rev,
			chain: chainLine(recipe.steps),
			projected: recipe.projected,
			approved: recipe.approved !== null,
		},
		'run.set_recipe',
	);
	const all = [...recipes.filter((r) => r.region !== recipe.region), recipe];
	const gate = await afterRecipe(tx, live, plan, all);
	return {
		ok: true,
		value: {
			stored: true,
			region: recipe.region,
			rev,
			projected: recipe.projected,
			approved: recipe.approved !== null,
			artPlan: gate,
		},
	};
}

const unapproved = (r: StoredRecipe) => !r.approved || r.approved.rev !== r.rev;

/**
 * Once every planned region has a recipe and any is unapproved: open `art_plan` (on by default) or,
 * with it off, approve the plan as `auto` when its projection fits what is left of the cap.
 */
async function afterRecipe(
	tx: Db,
	live: LiveRun,
	plan: Map<string, string>,
	recipes: StoredRecipe[],
): Promise<string> {
	const have = new Set(recipes.map((r) => r.region));
	const missing = [...plan.keys()].filter((region) => !have.has(region));
	if (missing.length)
		return `waiting for ${missing.length} more region(s): ${missing.slice(0, 10).join(', ')}`;
	const order = [...plan.keys()];
	const pending = recipes
		.filter((r) => plan.has(r.region) && unapproved(r))
		.sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region));
	if (pending.length === 0) return 'every recipe is approved';
	const projectedUsd = pending.reduce((sum, r) => sum + (r.projected.gpuUsd ?? 0), 0);
	if (live.state.checkpoints.artPlan) {
		const result = transition(live.state, { type: 'plan_ready' });
		if (!result.ok) return `the Art plan cannot open now: ${result.error}`;
		if (!(await applyTransition(tx, live.id, live.state, result.state, 'art plan ready'))) {
			return 'the run changed while this turn ran';
		}
		const from = live.state.step;
		live.state = result.state;
		await insertEvent(tx, live.id, 'worker', 'checkpoint_open', {
			checkpoint: 'art_plan',
			step: from,
			summary: artPlanSummary(pending),
			regions: pending.map((r) => r.region),
			projectedGpuUsd: Math.round(projectedUsd * 10000) / 10000,
		});
		return 'opened: the owner reviews the Art plan now. End your turn.';
	}
	const spend = await runSpend(tx, live.id);
	const cap = live.budgetCapUsd;
	if (cap !== null && spend.totalUsd + projectedUsd > cap) {
		await insertEvent(tx, live.id, 'worker', 'activity', {
			type: 'note',
			text: `The Art plan projects $${projectedUsd.toFixed(2)} of GPU, more than is left of the $${cap.toFixed(2)} cap. Nothing renders until the owner raises the cap or the plan shrinks.`,
		});
		return 'not approved: the projection crosses the remaining cap';
	}
	await approve(tx, live.id, pending, 'auto');
	return 'approved automatically (the Art plan checkpoint is off and the projection fits the cap)';
}

/** "11 Symbols: sdxl 1024 ×3 → birefnet → finish", one line per (group, chain). */
export function artPlanSummary(recipes: readonly StoredRecipe[]): string {
	const lines = new Map<string, number>();
	for (const r of recipes) {
		const line = `${r.group}: ${chainLine(r.steps)}`;
		lines.set(line, (lines.get(line) ?? 0) + 1);
	}
	return [...lines].map(([line, n]) => `${n} × ${line}`).join('\n');
}

async function approve(tx: Db, runId: string, recipes: readonly StoredRecipe[], by: string) {
	const at = new Date().toISOString();
	for (const r of recipes) {
		await storeRecipe(tx, runId, { ...r, approved: { by, at, rev: r.rev } });
	}
}

/**
 * The owner approved the Art plan: every stored recipe is approved at its current revision, and each
 * group's first planned chain becomes the template's next default for that group, when it differs.
 */
export async function approveArtPlan(tx: Db, live: LiveRun, by: string): Promise<number> {
	const plan = await planRegions(tx, live.id);
	const recipes = (await loadRecipes(tx, live.id)).filter((r) => plan.has(r.region));
	const pending = recipes.filter(unapproved);
	await approve(tx, live.id, pending, by);
	const firstByGroup = new Map<string, StoredRecipe>();
	for (const region of plan.keys()) {
		const r = recipes.find((x) => x.region === region);
		if (r && !firstByGroup.has(r.group)) firstByGroup.set(r.group, r);
	}
	const current = await templateDefaults(tx, live.templateProjectKey);
	for (const [group, r] of firstByGroup) {
		const chain = defaultChainOf(r.steps);
		const had = current.get(group);
		if (had && JSON.stringify(had.chain) === JSON.stringify(chain)) continue;
		await tx`
			insert into director_template_recipes
				(template_project_key, region_group, version, chain_json, run_id, approved_by, approved_at)
			values (${live.templateProjectKey}, ${group}, ${(had?.version ?? 0) + 1},
				${tx.json(chain as never)}, ${live.id}, ${by}, now())`;
	}
	return pending.length;
}

/** The latest default chain per group for a template. */
export async function templateDefaults(
	db: Db,
	template: string,
): Promise<Map<string, { version: number; chain: DefaultStep[] }>> {
	const rows = await db<{ region_group: string; version: number; chain_json: DefaultStep[] }[]>`
		select distinct on (region_group) region_group, version, chain_json
		from director_template_recipes
		where template_project_key = ${template}
		order by region_group, version desc`;
	return new Map(rows.map((r) => [r.region_group, { version: r.version, chain: r.chain_json }]));
}

/**
 * The defaults the technician starts from, per group the plan names: the template's approved
 * chain, else the old preset's shape (until card 8C retires the preset).
 */
export async function defaultsBrief(db: Db, live: LiveRun): Promise<string> {
	const plan = await planRegions(db, live.id);
	const groups = [...new Set(plan.values())];
	const stored = await templateDefaults(db, live.templateProjectKey);
	const fallback = presetDefaultChain(live.presetJson as Record<string, unknown> | null);
	const out = groups.map((group) => {
		const own = stored.get(group);
		return own
			? { group, source: `template default v${own.version}`, chain: own.chain }
			: { group, source: 'fallback (the run preset)', chain: fallback };
	});
	return [
		'Default recipes to start from (adapt them to the cards in atlas.list_blueprints; every recipe is validated before it is stored):',
		JSON.stringify(
			out.length ? out : [{ group: '*', source: 'fallback (the run preset)', chain: fallback }],
			null,
			2,
		),
	].join('\n');
}

/** A queued render advances the planned steps it covers to `queued`, with its job. */
export async function markQueued(
	tx: Db,
	runId: string,
	atlas: string,
	regions: readonly string[],
	jobRef: string,
) {
	const want = new Set(regions);
	for (const recipe of await loadRecipes(tx, runId)) {
		let changed = false;
		const steps = recipe.steps.map((s) => {
			if (s.kind === 'finish' || s.atlas !== atlas || !want.has(s.region) || s.status !== 'planned')
				return s;
			changed = true;
			return { ...s, status: 'queued' as const, jobRef };
		});
		if (changed) await storeRecipe(tx, runId, { ...recipe, steps });
	}
}
