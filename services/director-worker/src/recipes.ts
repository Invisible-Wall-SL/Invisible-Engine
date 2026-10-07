import { readFileSync } from 'node:fs';
import { DIRECTOR_RUN_BUDGET_DEFAULT_USD, parseEstimateProfiles } from 'director-costs';
import {
	approvalProblem,
	basisOf,
	carryProgress,
	chainLine,
	defaultChainOf,
	fallbackDefaultChain,
	needsReapproval,
	parseStepInput,
	project,
	RETRIES_PER_APPROVAL,
	retriesSpent,
	validateRecipe,
	type Catalogue,
	type DefaultStep,
	type PriceBasis,
	type ProjectionFloor,
	type RecipeInput,
	type StepInput,
	type StoredRecipe,
	type StoredStep,
	type Timing,
	type ValidationContext,
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

/** The technician's tools (ADR-0008 Appendix A): what its definition names, in this order. */
export const TECHNICIAN_TOOLS = [
	'atlas.list_blueprints',
	'atlas.list_regions',
	'atlas.get_region',
	'atlas.set_atlas_pipeline',
	'atlas.set_region_pipeline',
	'atlas.set_refs',
	'atlas.add_layer',
	'atlas.remove_layer',
	'atlas.duplicate_atlas',
	'atlas.queue_variants',
	'atlas.list_variants',
	'atlas.choose_variant',
	'atlas.set_output',
	'atlas.pack_sheet',
	'atlas.deploy_atlas',
	'comfyui.job_status',
	'run.set_recipe',
	'run.post_activity',
] as const;

/** What `run.set_recipe` needs from outside the transaction: the reviewed cards and the GPU price. */
export interface RecipeDeps {
	catalogue: Catalogue;
	/** USD per second of the endpoint's GPU, or null when it is unpriced. */
	usdPerSecond: number | null;
	/** Measured GPU time per (pipeline, genPx), `director_blueprint_timings`. */
	timings: Timing[];
	/** The projection's floor: the seed seconds per render and the seed queue delay per job. */
	floor: ProjectionFloor;
}

const contextOf = (
	deps: RecipeDeps,
	plan: ReadonlyMap<string, string>,
	others: readonly StoredRecipe[],
): ValidationContext => ({
	catalogue: deps.catalogue,
	planRegions: new Set(plan.keys()),
	others,
	usdPerSecond: deps.usdPerSecond,
	timings: deps.timings,
	floor: deps.floor,
});

/** The pricing basis of the cards, the GPU rate and the measurements as `deps` holds them now. */
export const basisOfDeps = (deps: RecipeDeps): PriceBasis =>
	basisOf(contextOf(deps, new Map(), []));

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
 * A revision of an approved recipe keeps its approval only when it changes no pipeline, does not
 * raise the projected cost (owner decision 9) and re-opens no step that has rendered.
 */
export async function setRecipe(
	tx: Db,
	live: LiveRun,
	agent: string,
	input: RecipeInput,
	deps: RecipeDeps,
): Promise<SetRecipeOutcome> {
	if (live.state.status !== 'running') {
		return { ok: false, message: `Not stored: the run is ${live.state.status}.` };
	}
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
	const result = validateRecipe(input, contextOf(deps, plan, recipes));
	if (!result.ok) {
		return {
			ok: false,
			message: `Not stored. Fix and send the whole recipe again:\n- ${result.errors.join('\n- ')}`,
		};
	}
	const rev = (prev?.rev ?? 0) + 1;
	// A step the revision leaves as it was keeps what already happened to it: a resend never
	// re-opens a rendered step, and a revision that does needs the owner again, so nothing is
	// queued (and paid for) again unseen.
	const steps = prev ? carryProgress(prev.steps, result.steps) : result.steps;
	const next = { steps, projected: result.projected };
	// Compared on one basis: the stored figure predates the timings measured since.
	const prevNow = prev && { ...prev, projected: project(prev.steps, basisOfDeps(deps)) };
	const keep = prev?.approved && !needsReapproval(prevNow, next);
	const recipe: StoredRecipe = {
		rev,
		region: input.region,
		atlas: input.atlas,
		group: input.group,
		plannedBy: agent,
		approved: keep && prev?.approved ? { ...prev.approved, rev } : null,
		// Counted since the last approval: a revision is not one.
		...(prev?.failures ? { failures: prev.failures } : {}),
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

/** "H1: step 2: "flux" has no GPU seconds for 2048 px; …", each reason once with its regions. */
function unpricedReasons(recipes: readonly StoredRecipe[]): string {
	const regions = new Map<string, string[]>();
	for (const r of recipes) {
		for (const why of r.projected.unpriced ?? ['it has no price']) {
			regions.set(why, [...(regions.get(why) ?? []), r.region]);
		}
	}
	return [...regions]
		.map(
			([why, names]) =>
				`${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}: ${why}`,
		)
		.join('; ');
}

/**
 * Re-check the gate: after the owner's edits, a withdrawn approval, or the owner resuming the run
 * (`byOwner`: a raised cap may now fit the plan, and the resume approves again what failed past
 * its retries).
 */
export async function reviewPlanGate(tx: Db, live: LiveRun, byOwner = false): Promise<string> {
	const plan = await planRegions(tx, live.id);
	if (plan.size === 0) return 'no plan';
	return afterRecipe(tx, live, plan, await loadRecipes(tx, live.id), byOwner);
}

/**
 * Once every planned region has a recipe and any is unapproved: open `art_plan` (on by default) or,
 * with it off, approve the plan as `auto` when its projection fits what is left of the cap. A
 * recipe whose failures withdrew its approval is approved automatically only by the owner's
 * resume (`byOwner`); until then the run pauses for them.
 */
async function afterRecipe(
	tx: Db,
	live: LiveRun,
	plan: Map<string, string>,
	recipes: StoredRecipe[],
	byOwner = false,
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
	// What is still to be paid for: every planned recipe with a step not yet rendered, approved
	// or not (a recipe's whole projection, which over-counts a half-rendered one: fails closed).
	const toRender = recipes.filter(
		(r) =>
			plan.has(r.region) &&
			(unapproved(r) ||
				r.steps.some(
					(s) => s.kind !== 'finish' && (s.status === 'planned' || s.status === 'failed'),
				)),
	);
	const projectedUsd = toRender.reduce((sum, r) => sum + (r.projected.gpuUsd ?? 0), 0);
	const unpriced = toRender.filter((r) => r.projected.gpuUsd === null);
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
	// Fails closed (ADR-0006): a plan the cap cannot price, or one over it, pauses for the owner.
	const spend = await runSpend(tx, live.id);
	const cap = live.budgetCapUsd ?? DIRECTOR_RUN_BUDGET_DEFAULT_USD;
	if (unpriced.length || spend.totalUsd + projectedUsd > cap) {
		const text = unpriced.length
			? `The Art plan cannot be priced, so it is not approved automatically: ${unpricedReasons(unpriced)}. Fix that, or turn the Art plan checkpoint on, and resume.`
			: `The Art plan projects $${projectedUsd.toFixed(2)} of GPU, more than is left of the $${cap.toFixed(2)} cap. Raise the cap and resume, or ask for a smaller plan.`;
		await insertEvent(tx, live.id, 'worker', 'activity', { type: 'note', text });
		const result = transition(live.state, { type: 'pause', reason: 'budget_cap' });
		if (
			result.ok &&
			(await applyTransition(tx, live.id, live.state, result.state, 'art plan over the cap'))
		) {
			live.state = result.state;
			await insertEvent(tx, live.id, 'worker', 'checkpoint_open', {
				checkpoint: 'budget',
				reason: unpriced.length ? 'art_plan_unpriced' : 'art_plan',
				message: text,
				spentUsd: spend.totalUsd,
				projectedUsd: Math.round(projectedUsd * 10000) / 10000,
				capUsd: cap,
			});
		}
		return 'not approved: the run paused for the owner (the plan is unpriced or crosses the cap)';
	}
	const spent = byOwner ? [] : pending.filter((r) => retriesSpent(r).length);
	if (spent.length) {
		const text = `${spent.map((r) => `${r.region} step ${retriesSpent(r).join(', ')}`).join('; ')} failed again after ${RETRIES_PER_APPROVAL} retries, so it is not approved automatically. Resume the run to approve it again, or stop it.`;
		await insertEvent(tx, live.id, 'worker', 'error', { type: 'retries_spent', message: text });
		const result = transition(live.state, { type: 'pause', reason: 'error' });
		if (
			result.ok &&
			(await applyTransition(tx, live.id, live.state, result.state, 'retries spent'))
		) {
			live.state = result.state;
		}
		return 'not approved: the run paused for the owner (a step failed past its retries)';
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

async function approve(
	tx: Db,
	runId: string,
	recipes: readonly StoredRecipe[],
	by: string,
	basis?: PriceBasis,
) {
	const at = new Date().toISOString();
	for (const r of recipes) {
		// The owner approved the plan as priced now: that figure is what a revision is held to. A
		// new approval retries every step afresh.
		const projected = basis ? project(r.steps, basis) : r.projected;
		await storeRecipe(tx, runId, {
			...r,
			projected,
			approved: { by, at, rev: r.rev },
			failures: undefined,
		});
	}
}

/**
 * The owner approved the Art plan: every stored recipe is approved at its current revision, and each
 * group's first planned chain becomes the template's next default for that group, when it differs.
 */
export async function approveArtPlan(
	tx: Db,
	live: LiveRun,
	by: string,
	deps: RecipeDeps,
): Promise<number> {
	const plan = await planRegions(tx, live.id);
	const recipes = (await loadRecipes(tx, live.id)).filter((r) => plan.has(r.region));
	const pending = recipes.filter(unapproved);
	await approve(tx, live.id, pending, by, basisOfDeps(deps));
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
		// The next version computed in SQL; a run of the same template approving at the same moment
		// takes the other number, and a lost race is skipped rather than failing the approval.
		await tx`
			insert into director_template_recipes
				(template_project_key, region_group, version, chain_json, run_id, approved_by, approved_at)
			select ${live.templateProjectKey}, ${group}, coalesce(max(version), 0) + 1,
				${tx.json(chain as never)}, ${live.id}, ${by}, now()
			from director_template_recipes
			where template_project_key = ${live.templateProjectKey} and region_group = ${group}
			on conflict do nothing`;
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
 * The chain a group starts from before its template has an approved one: the estimate profiles'
 * `fallbackRecipe`, the same file the launcher prices that fallback from. Read once at load, so a
 * missing or malformed file stops the worker at boot.
 */
export const FALLBACK_CHAIN: DefaultStep[] = fallbackDefaultChain(
	parseEstimateProfiles(
		JSON.parse(readFileSync(new URL('../estimate-profiles.json', import.meta.url), 'utf8')),
	).fallbackRecipe,
);
const FALLBACK_SOURCE = 'fallback (the estimate profiles)';

/**
 * The defaults the technician starts from, per group the plan names: the template's approved
 * chain, else `FALLBACK_CHAIN`.
 */
export async function defaultsBrief(db: Db, live: LiveRun): Promise<string> {
	const plan = await planRegions(db, live.id);
	const groups = [...new Set(plan.values())];
	const stored = await templateDefaults(db, live.templateProjectKey);
	const out = groups.map((group) => {
		const own = stored.get(group);
		return own
			? { group, source: `template default v${own.version}`, chain: own.chain }
			: { group, source: FALLBACK_SOURCE, chain: FALLBACK_CHAIN };
	});
	return [
		'Default recipes to start from (adapt them to the cards in atlas.list_blueprints; every recipe is validated before it is stored):',
		JSON.stringify(
			out.length ? out : [{ group: '*', source: FALLBACK_SOURCE, chain: FALLBACK_CHAIN }],
			null,
			2,
		),
	].join('\n');
}

/**
 * A queued render advances exactly the recipe steps the launcher's gate matched for it
 * (`{ recipe, n }`, planned or failed) to `queued`, with its job.
 */
export async function markQueued(
	tx: Db,
	runId: string,
	matched: readonly { recipe: string; n: number }[],
	jobRef: string,
) {
	for (const recipe of await loadRecipes(tx, runId)) {
		const ns = new Set(matched.filter((m) => m.recipe === recipe.region).map((m) => m.n));
		if (ns.size === 0) continue;
		let changed = false;
		const steps = recipe.steps.map((s) => {
			if (!ns.has(s.n) || (s.status !== 'planned' && s.status !== 'failed')) return s;
			changed = true;
			return { ...s, status: 'queued' as const, jobRef };
		});
		if (changed) await storeRecipe(tx, runId, { ...recipe, steps });
	}
}

/**
 * A finished render advances its steps: `done` with the variants it made, or `failed`. A failure is
 * counted against the recipe's approval; past `RETRIES_PER_APPROVAL` retries of a step the
 * approval is withdrawn (`withdrawn`), so the gate queues none of its steps until it is approved
 * again.
 */
export async function settleJob(
	tx: Db,
	runId: string,
	jobRef: string,
	finished: boolean,
	variants: readonly { region: string; id: string }[],
): Promise<{
	settled: { pipeline: string; genPx: number }[];
	withdrawn: { region: string; steps: number[] }[];
}> {
	const settled: { pipeline: string; genPx: number }[] = [];
	const withdrawn: { region: string; steps: number[] }[] = [];
	for (const recipe of await loadRecipes(tx, runId)) {
		let changed = false;
		const failures = { ...recipe.failures };
		const steps = recipe.steps.map((s) => {
			if (s.jobRef !== jobRef || s.status !== 'queued') return s;
			changed = true;
			settled.push({ pipeline: s.pipeline, genPx: s.genPx });
			const rendered = variants.filter((v) => v.region === s.region).map((v) => v.id);
			if (finished && rendered.length) return { ...s, status: 'done' as const, rendered };
			failures[s.n] = (failures[s.n] ?? 0) + 1;
			return { ...s, status: 'failed' as const };
		});
		if (!changed) continue;
		const spent = retriesSpent({ failures });
		const approved = spent.length ? null : recipe.approved;
		if (recipe.approved && !approved) withdrawn.push({ region: recipe.region, steps: spent });
		await storeRecipe(tx, runId, {
			...recipe,
			steps,
			approved,
			...(Object.keys(failures).length ? { failures } : {}),
		});
	}
	return { settled, withdrawn };
}

/**
 * Fold one job's measured GPU time into the rolling means for its (pipeline, genPx), in one
 * statement so two jobs landing at once both count. A job whose steps ran more than one pipeline or
 * size (regions with their own override in one batch) cannot be split honestly and is skipped.
 */
export async function recordTiming(
	tx: Db,
	steps: readonly { pipeline: string; genPx: number }[],
	usage: { jobs: number; executionSeconds: number; delaySeconds: number },
): Promise<boolean> {
	const keys = new Set(steps.map((s) => `${s.pipeline}\u0000${s.genPx}`));
	if (keys.size !== 1 || usage.jobs <= 0) return false;
	const { pipeline, genPx } = steps[0];
	if (!pipeline || genPx <= 0) return false;
	const exec = usage.executionSeconds / usage.jobs;
	const delay = usage.delaySeconds / usage.jobs;
	await tx`
		insert into director_blueprint_timings as t
			(pipeline, gen_px, jobs, mean_exec_seconds, mean_delay_seconds, updated_at)
		values (${pipeline}, ${genPx}, ${usage.jobs}, ${exec}, ${delay}, now())
		on conflict (pipeline, gen_px) do update set
			jobs = t.jobs + excluded.jobs,
			mean_exec_seconds =
				(t.mean_exec_seconds * t.jobs + excluded.mean_exec_seconds * excluded.jobs)
				/ (t.jobs + excluded.jobs),
			mean_delay_seconds =
				(t.mean_delay_seconds * t.jobs + excluded.mean_delay_seconds * excluded.jobs)
				/ (t.jobs + excluded.jobs),
			updated_at = now()`;
	return true;
}

export async function loadTimings(db: Db): Promise<Timing[]> {
	const rows = await db<
		{
			pipeline: string;
			gen_px: number;
			jobs: number;
			mean_exec_seconds: number;
			mean_delay_seconds: number;
		}[]
	>`select pipeline, gen_px, jobs, mean_exec_seconds, mean_delay_seconds from director_blueprint_timings`;
	return rows.map((r) => ({
		pipeline: r.pipeline,
		genPx: r.gen_px,
		jobs: r.jobs,
		meanExecSeconds: r.mean_exec_seconds,
		meanDelaySeconds: r.mean_delay_seconds,
	}));
}

/**
 * The technician chose a variant on a region (`atlas.choose_variant`): the latest rendered step
 * there records it, for "How this was made".
 */
export async function markChosen(
	tx: Db,
	runId: string,
	agent: string,
	atlas: string,
	region: string,
	id: string,
) {
	for (const recipe of await loadRecipes(tx, runId)) {
		const at = recipe.steps.findLastIndex(
			(s) =>
				s.kind !== 'finish' &&
				s.atlas === atlas &&
				s.region === region &&
				(s.status === 'done' || s.status === 'chosen'),
		);
		if (at === -1) continue;
		const steps = recipe.steps.map((s, i) =>
			i === at ? { ...s, status: 'chosen' as const, chosen: id } : s,
		);
		await storeRecipe(tx, runId, { ...recipe, steps });
		await insertEvent(tx, runId, agent, 'activity', {
			type: 'recipe_step',
			region: recipe.region,
			n: steps[at].n,
			status: 'chosen',
			text: `chose variant ${id} on ${atlas}/${region} (step ${steps[at].n} of ${recipe.region})`,
		});
	}
}

/** A chain's result landed on its template region (`atlas.set_output`): the finish step is done. */
export async function markCommitted(
	tx: Db,
	runId: string,
	agent: string,
	atlas: string,
	region: string,
	from: string,
) {
	for (const recipe of await loadRecipes(tx, runId)) {
		if (recipe.atlas !== atlas || recipe.region !== region) continue;
		const finish = recipe.steps.find((s) => s.kind === 'finish');
		if (!finish) continue;
		const steps = recipe.steps.map((s) =>
			s.kind === 'finish' ? { ...s, status: 'done' as const, chosen: from } : s,
		);
		await storeRecipe(tx, runId, { ...recipe, steps });
		await insertEvent(tx, runId, agent, 'activity', {
			type: 'recipe_step',
			region: recipe.region,
			n: finish.n,
			status: 'done',
			text: `committed ${from} as ${atlas}/${region}'s tile`,
		});
	}
}

/**
 * A new `run.set_plan` that no longer names a region takes its recipe's approval away: the queue
 * gate renders only approved steps, so a dropped region cannot render on an old approval. The
 * recipe stays stored as the run's record; if a later plan names the region again, the recipe
 * comes back unapproved, and the Art plan re-opens on the next `run.set_recipe`.
 */
export async function forgetUnplanned(tx: Db, runId: string): Promise<string[]> {
	const plan = await planRegions(tx, runId);
	const dropped: string[] = [];
	for (const recipe of await loadRecipes(tx, runId)) {
		if (plan.has(recipe.region) || !recipe.approved) continue;
		dropped.push(recipe.region);
		await storeRecipe(tx, runId, { ...recipe, approved: null });
	}
	return dropped;
}

/**
 * One owner edit (ADR-0008 §5): the region's whole chain as the Art plan panel left it, and the
 * revision it was edited from. Steps are parsed by the recipe rules, never trusted.
 */
export interface RecipeEdit {
	region: string;
	rev: number;
	steps: unknown[];
}

export const MAX_RECIPE_EDITS = 64;

/**
 * Apply the owner's Art plan edits, all or nothing. Every edit names the revision it was made on,
 * and one made on an older revision is refused (two tabs, or a technician's revision since). Each
 * edited chain is validated with the same rules a technician's is, against the plan with EVERY
 * edit applied, so a group edit of a per-atlas value (a size, a pipeline) passes as a whole as it
 * does on the page. A pass is stored as `rev + 1` with `editedBy` and no approval, keeping what the
 * unchanged leading steps already rendered, and the plan re-opens for the owner to approve what
 * they now see. Nothing an edit sends can throw here: a step of the wrong shape is a reason.
 */
export async function applyRecipeEdits(
	tx: Db,
	live: LiveRun,
	by: string,
	edits: readonly RecipeEdit[],
	deps: RecipeDeps,
): Promise<{ ok: true; regions: string[] } | { ok: false; errors: string[] }> {
	if (edits.length > MAX_RECIPE_EDITS) {
		return { ok: false, errors: [`at most ${MAX_RECIPE_EDITS} regions per edit`] };
	}
	const plan = await planRegions(tx, live.id);
	const recipes = await loadRecipes(tx, live.id);
	const errors: string[] = [];
	const parsed = new Map<string, { prev: StoredRecipe; steps: StepInput[] }>();
	for (const edit of edits) {
		const prev = recipes.find((r) => r.region === edit.region);
		if (!prev) {
			errors.push(`${edit.region}: has no recipe to edit`);
			continue;
		}
		if (prev.rev !== edit.rev) {
			errors.push(
				`${edit.region}: changed since you edited it (revision ${prev.rev}, your edit was made on ${edit.rev}); review it again`,
			);
			continue;
		}
		const steps: StepInput[] = [];
		for (const raw of edit.steps) {
			const one = parseStepInput(raw);
			if ('error' in one) errors.push(`${edit.region}: ${one.error}`);
			else steps.push(one.step);
		}
		parsed.set(edit.region, { prev, steps });
	}
	if (errors.length) return { ok: false, errors };

	// The plan as it will be once every edit lands: what each edit is checked against.
	const asPlanned = (steps: StepInput[]): StoredStep[] =>
		steps.map((st) => ({ ...st, cardRev: 0, licence: '', status: 'planned' }));
	const edited = recipes.map((r) => {
		const e = parsed.get(r.region);
		return e ? { ...r, steps: asPlanned(e.steps) } : r;
	});
	const next = new Map<string, StoredRecipe>();
	for (const [region, { prev, steps }] of parsed) {
		const result = validateRecipe(
			{ region: prev.region, atlas: prev.atlas, group: prev.group, steps },
			contextOf(
				deps,
				plan,
				edited.filter((r) => r.region !== region),
			),
		);
		if (!result.ok) {
			errors.push(...result.errors.map((e) => `${region}: ${e}`));
			continue;
		}
		next.set(region, {
			...prev,
			rev: prev.rev + 1,
			editedBy: by,
			approved: null,
			steps: carryProgress(prev.steps, result.steps),
			projected: result.projected,
		});
	}
	if (errors.length) return { ok: false, errors };
	for (const recipe of next.values()) {
		await storeRecipe(tx, live.id, recipe);
		await insertEvent(
			tx,
			live.id,
			'worker',
			'activity',
			{
				type: 'recipe',
				region: recipe.region,
				group: recipe.group,
				rev: recipe.rev,
				chain: chainLine(recipe.steps),
				projected: recipe.projected,
				approved: false,
				editedBy: by,
			},
			'owner.recipe_edit',
		);
	}
	return { ok: true, regions: [...next.keys()] };
}

/**
 * The worker's side of `approvalProblem`: the run's plan and recipes as they are now, each priced
 * again on the cards, the GPU rate and the timings `deps` read before the transaction.
 */
export async function artPlanApprovalRefusal(
	tx: Db,
	runId: string,
	seen: unknown,
	deps: RecipeDeps,
): Promise<string | null> {
	const plan = await planRegions(tx, runId);
	const basis = basisOfDeps(deps);
	const problem = approvalProblem(await loadRecipes(tx, runId), new Set(plan.keys()), seen, (r) =>
		project(r.steps, basis),
	);
	return problem?.reason ?? null;
}
