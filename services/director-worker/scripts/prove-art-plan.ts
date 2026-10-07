/**
 * Proof of the technician's planning turn and the Art plan gate (ADR-0008 §5, §7), against a REAL
 * Postgres, with a fake model and a fake launcher — no API call is ever made:
 *
 *   createdb director_proof
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter launcher-api db:migrate
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter director-worker prove:art-plan
 *
 * The `atlas-technician`, as its definition (`agents/atlas-technician.md`) runs it, takes a turn
 * that replays the reference plan (`docs/director/eval/blueprints/expected-art-plan.json`, the
 * reference template's 23 regions) against the fixture catalogue (`catalogue.json`), plus recipes
 * that break the §5 rules on purpose.
 *
 * Proved:
 *  1. every rule-breaking recipe is answered with its reasons and not stored; the 23 valid ones are
 *     stored with their card revisions, licences and a projection recomputed by code; the Art plan
 *     opens exactly once, when the last planned region has a recipe, and the run waits on it;
 *  2. the owner's approval approves every recipe at its revision, writes each group's chain as the
 *     template's default (version 1), and tells the coordinator;
 *  3. a revision that changes nothing priced keeps its approval; one that changes a pipeline drops
 *     it and re-opens the Art plan;
 *  4. with the checkpoint off the plan is approved `auto` when its projection fits the cap, and is
 *     left unapproved, with a note, when it does not;
 *  5. a later run of the same template briefs the technician with that template default;
 *  6. a step renders once: not twice in a turn, and a resent recipe keeps a rendered step's state;
 *  7. (card 8E) an approval that does not name the revisions the owner saw is refused and the plan
 *     stays open; the owner's own edits are validated with the same rules, stored as the next
 *     revision with `editedBy` and no approval, and the plan re-opens on them without waking an
 *     agent; an edit that breaks a rule stores nothing and says why; a group edit of a per-atlas
 *     value lands as a whole; an edit made on an older revision and a malformed one are refused,
 *     and the next row still applies;
 *  8. a render advances its steps (`queued` → `done` with its variants; a failed render is queued
 *     again under the same approval and recorded like the first), the technician's pick and the
 *     committed tile are recorded on the recipe, and the job's measured time is folded into
 *     `director_blueprint_timings` once, however often its `job_done` is delivered;
 *  9. a new plan that leaves a region out takes its recipe's approval away;
 * 10. a revision is compared with the approved recipe priced on the same basis: one more variant
 *     loses the approval although the measured delay fell since;
 * 11. a revision at the same price keeps the approval of a recipe that has rendered nothing, and
 *     loses it, re-opening the Art plan, when it re-opens a step that has rendered;
 * 12. an Art plan approval while the launcher cannot be reached at all is refused, and the owner's
 *     stop queued behind it is applied rather than held;
 * 13. a step is queued again at most twice under one approval: its third failure withdraws the
 *     approval as a new revision and the gate refuses it; the Art plan opens for it, whatever its
 *     setting, and the owner's approval there retries it afresh;
 * 14. with the checkpoint off, a third failure whose bill also crosses the cap pauses at the cap,
 *     naming the step, and the resume that raises the cap approves nothing of it;
 * 15. a third failure landing on a run that is stopping opens nothing, and the stop finishes;
 * 16-17. a third failure landing on a run the owner paused, or one the spend cap paused at a
 *     submit: the resume opens the Art plan for it and approves nothing of it;
 * 18. an approval made on a card that did not show a step withdrawn since is refused;
 * 19. a third failure while a region batch waits is put to the owner once the batch resolves;
 * 20. a step's failures count from the owner's last approval at the Art plan: a revision approved
 *     automatically, a plan that drops the region and takes it back, or a resume past the cap
 *     keeps them, so its third failure since still goes to the owner; their approval at the Art
 *     plan starts them again, and the next re-opening there is labelled `retries_spent`;
 * 21. the region step does not end while one of its renders is in flight;
 * 22. a third failure where the Art plan cannot open (the build step; a region batch waiting with
 *     the checkpoint on) tells the owner in the feed, once, what waits for them and when it is asked;
 * 23. a technician revision or an owner edit of a step while it renders is refused, and a render
 *     whose step was replanned anyway still counts its failure against it, once.
 */
import type {
	BetaMessage,
	BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import postgres from 'postgres';
import { parsePricing } from 'director-costs';
import {
	recipeInputOf,
	type Catalogue,
	type RecipeInput,
	type StoredRecipe,
} from 'director-costs/recipe';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAgents, pricedModels, type AgentDefinition } from '../src/agents.ts';
import { driveRun, type DriverDeps } from '../src/driver.ts';
import type { AdapterResult, AdapterSpec, Launcher } from '../src/launcher.ts';
import { claimRun } from '../src/lease.ts';
import { recordSpend } from '../src/store.ts';
import type { VisionTransport } from '../src/mockups/vision.ts';
import { toolName, type ModelTransport } from '../src/model.ts';
import { TECHNICIAN } from '../src/recipes.ts';
import { ADAPTER_OPS, KNOWN_TOOLS } from '../src/tools.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required (a scratch database with the launcher migrations).');
	process.exit(2);
}
const sql = postgres(url, { max: 4, onnotice: () => {} });

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

const root = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const EVAL = root('../../docs/director/eval/blueprints/');
const pricing = parsePricing(JSON.parse(readFileSync(root('pricing.json'), 'utf8')));
const catalogue = JSON.parse(readFileSync(`${EVAL}catalogue.json`, 'utf8')) as Catalogue;
const expected = JSON.parse(readFileSync(`${EVAL}expected-art-plan.json`, 'utf8')) as {
	plan: { summary: string; batches: { name: string; regions: string[] }[] };
	recipes: RecipeInput[];
};

// ── Fakes ─────────────────────────────────────────────────────────────────────

type Reply = { content: BetaMessage['content'] };

function fakeModel(replies: Reply[]) {
	const requests: BetaMessageStreamParams[] = [];
	const transport: ModelTransport = {
		async send(request) {
			requests.push(structuredClone(request));
			// Past the script, every agent just ends its turn.
			const reply = replies[requests.length - 1] ?? { content: [say('Done.')] };
			return {
				id: `msg_${tag}_${Math.random().toString(36).slice(2)}`,
				type: 'message',
				role: 'assistant',
				model: request.model,
				stop_reason: reply.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
				stop_sequence: null,
				stop_details: null,
				usage: {
					input_tokens: 1000,
					output_tokens: 200,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
				content: reply.content,
			} as BetaMessage;
		},
	};
	return { transport, requests, calls: () => requests.length };
}

/** Serves every adapter op by name (so no agent is "missing tools") and the catalogue. */
/**
 * The launcher's queue gate as it decides (`ops/atlas.ts` `requireApprovedSteps`), over the real
 * stored recipes: every region needs an approved step on that atlas with those variants that is
 * not yet rendered (planned or failed). Answers the matched steps, as the launcher does.
 */
let jobSeq = 0;
async function queueGate(runId: string, input: unknown): Promise<AdapterResult> {
	const q = input as { atlas: string; regions: string[]; variants: number };
	const rows = await sql<{ recipe_json: StoredRecipe }[]>`
		select recipe_json from director_regions where run_id = ${runId} and recipe_json is not null`;
	const steps: { recipe: string; n: number; region: string }[] = [];
	for (const region of q.regions) {
		const hit = rows
			.map((r) => r.recipe_json)
			.filter((r) => r.approved && r.approved.rev === r.rev)
			.flatMap((r) => r.steps.map((s) => ({ ...s, recipe: r.region })))
			.find(
				(s) =>
					s.kind !== 'finish' &&
					s.atlas === q.atlas &&
					s.region === region &&
					s.variants === q.variants &&
					(s.status === 'planned' || s.status === 'failed'),
			);
		if (!hit) return { status: 409, body: { error: 'no_approved_step', message: region } };
		steps.push({ recipe: hit.recipe, n: hit.n, region });
	}
	return {
		status: 200,
		body: { jobRef: `st_${String(++jobSeq).padStart(16, '0')}`, status: 'queued', steps },
	};
}

function fakeLauncher(
	served: Catalogue = catalogue,
	answers: Record<string, (input: Record<string, unknown>) => unknown> = {},
) {
	const calls: string[] = [];
	const ops = new Map<string, AdapterSpec>(
		ADAPTER_OPS.map((id) => [
			id,
			{
				id,
				description: id,
				inputSchema: { type: 'object', properties: {}, additionalProperties: false },
				write: false,
			},
		]),
	);
	const launcher: Launcher = {
		async catalog() {
			return ops;
		},
		async call(id, body): Promise<AdapterResult> {
			calls.push(`${body.agent}:${id}`);
			if (id === 'atlas.list_blueprints') return { status: 200, body: served };
			if (id === 'atlas.queue_variants') return queueGate(body.runId, body.input);
			const answer = answers[id];
			if (answer) return { status: 200, body: answer(body.input as Record<string, unknown>) };
			return { status: 404, body: { error: 'unknown_op', message: `No adapter ${id}.` } };
		},
	};
	return { launcher, calls };
}

const noVision: VisionTransport = {
	async analyze() {
		throw new Error('proof: no vision call is expected');
	},
};

// ── Agents ────────────────────────────────────────────────────────────────────

const real = loadAgents(root('agents'), {
	models: pricedModels(root('pricing.json')),
	tools: KNOWN_TOOLS,
});
const coordinator: AgentDefinition = {
	name: 'coordinator',
	model: 'claude-opus-5-5',
	effort: 'medium',
	role: 'coordinator',
	tools: ['run.post_activity', 'run.assign_task'],
	inputs: '',
	outputs: '',
	systemPrompt: 'You are the coordinator.',
};
const technician = real.get(TECHNICIAN);
if (!technician) throw new Error(`proof: agents/ has no ${TECHNICIAN} definition`);
const AGENTS = new Map<string, AgentDefinition>([
	['coordinator', coordinator],
	['atlas-technician', technician],
]);

let useSeq = 0;
const use = (name: string, input: Record<string, unknown>) => ({
	type: 'tool_use' as const,
	id: `toolu_${++useSeq}`,
	name: toolName(name),
	input,
	caller: { type: 'direct' as const },
});
const say = (text: string) => ({ type: 'text' as const, text, citations: null });
const setRecipe = (r: RecipeInput) =>
	use('run.set_recipe', r as unknown as Record<string, unknown>);
const recipeOf = (region: string) =>
	structuredClone(expected.recipes.find((r) => r.region === region)!);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const tag = `art-plan-proof-${Date.now()}`;
const userId = `${tag}-owner`;
const TEMPLATE = `${tag}-tpl`;
let runSeq = 0;

async function newRun(over: { cap?: number; artPlan?: boolean } = {}) {
	const id = `${tag}-run-${++runSeq}`;
	const checkpoints = over.artPlan === false ? { artPlan: false } : {};
	await sql`insert into director_runs (id, project_key, template_project_key, owner_user_id, status,
			step, budget_cap_usd, checkpoints_json, preset_json)
		values (${id}, ${`${id}-p`}, ${TEMPLATE}, ${userId}, 'running', 'style_pack', ${over.cap ?? 25},
			${sql.json(checkpoints)}, ${sql.json({ blueprint: 'sdxl', finalPx: 1024, variantsPerRegion: 3 })})`;
	await sql`insert into director_events (run_id, agent, kind, tool, payload_json)
		values (${id}, 'coordinator', 'activity', 'run.set_plan',
			${sql.json({ type: 'plan', summary: expected.plan.summary, batches: expected.plan.batches })})`;
	return id;
}
const message = async (runId: string, agent: string, text: string) => {
	const [{ next }] = await sql<{ next: number }[]>`
		select coalesce(max(seq), 0) + 1 as next from director_messages
		where run_id = ${runId} and agent = ${agent}`;
	await sql`insert into director_messages (run_id, agent, seq, role, content_json)
		values (${runId}, ${agent}, ${next}, 'user', ${sql.json([{ type: 'text', text }])})`;
};
const event = (runId: string, agent: string, kind: string, payload: Record<string, unknown>) =>
	sql`insert into director_events (run_id, agent, kind, payload_json)
		values (${runId}, ${agent}, ${kind}, ${sql.json(payload as never)})`;

const retries = new Map<string, number>();
const deps = (model: ModelTransport, launcher: Launcher): DriverDeps => ({
	sql,
	transport: model,
	vision: noVision,
	launcher,
	agents: AGENTS,
	pricing: async () => pricing,
	retries,
	leaseMs: 2_000,
	retryBaseMs: 20,
});
async function drive(runId: string, d: DriverDeps) {
	const claimed = await claimRun(sql, `prover-${Math.random()}`, { runId, leaseMs: 2_000 });
	if (claimed) await driveRun(d, claimed);
}

const runRow = async (id: string) =>
	(
		await sql<{ status: string; step: string; waiting_on: string | null }[]>`
		select status, step, waiting_on from director_runs where id = ${id}`
	)[0];
const recipes = async (id: string) =>
	(
		await sql<{ recipe_json: StoredRecipe; recipe_rev: number; region_group: string }[]>`
		select recipe_json, recipe_rev, region_group from director_regions
		where run_id = ${id} and recipe_json is not null order by region`
	).map((r) => ({ ...r.recipe_json, column: { rev: r.recipe_rev, group: r.region_group } }));
const artPlanOpens = async (id: string) =>
	sql<{ payload: Record<string, unknown> }[]>`
		select payload_json as payload from director_events
		where run_id = ${id} and kind = 'checkpoint_open' and payload_json->>'checkpoint' = 'art_plan'
		order by id`;
const toolResults = async (id: string, agent: string) =>
	(
		await sql<{ content: { type: string; content?: string; is_error?: boolean }[] }[]>`
		select content_json as content from director_messages
		where run_id = ${id} and agent = ${agent} and role = 'user' order by seq`
	).flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
/** H1 of a run's recipes, as stored. */
const h1Of = async (run: string) => (await recipes(run)).find((r) => r.region === 'H1')!;
/** The technician queues `region`'s first step through the gate. */
async function queueStep(run: string, region = 'H1') {
	await message(run, 'atlas-technician', `Render ${region}.`);
	const recipe = (await recipes(run)).find((r) => r.region === region)!;
	const queue = use('atlas.queue_variants', {
		atlas: recipe.atlas,
		regions: [region],
		variants: recipe.steps[0].variants,
		step: `${region}#1`,
	});
	await drive(run, deps(fakeModel([{ content: [queue] }]).transport, fakeLauncher().launcher));
}
/** H1's queued render fails (billing `runpod` when given). */
async function h1Fails(run: string, runpod?: Record<string, unknown>) {
	await event(run, 'atlas-technician', 'job_done', {
		jobRef: (await h1Of(run)).steps[0].jobRef,
		status: 'failed',
		atlas: 'symbols',
		regions: ['H1'],
		result: { error: 'OOM', ...(runpod ? { runpod } : {}) },
	});
	await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
}
/** H1's first step is queued and its render fails. */
async function failH1(run: string, runpod?: Record<string, unknown>) {
	await queueStep(run, 'H1');
	await h1Fails(run, runpod);
}
/** A run with the reference plan stored, approved by the owner when the Art plan is on. */
async function plannedRun(over: { cap?: number; artPlan?: boolean } = {}) {
	const run = await newRun(over);
	await message(run, 'atlas-technician', 'Plan the recipes.');
	await drive(
		run,
		deps(
			fakeModel([{ content: expected.recipes.map(setRecipe) }]).transport,
			fakeLauncher().launcher,
		),
	);
	if (over.artPlan !== false) await approvePlan(run);
	return run;
}
/** The owner approves the Art plan as it stands, naming every revision as stored now (or `seen`). */
async function approvePlan(run: string, seen?: Record<string, number>) {
	await event(run, 'owner', 'checkpoint_resolved', {
		checkpoint: 'art_plan',
		decision: 'approve',
		recipeRevs: seen ?? Object.fromEntries((await recipes(run)).map((r) => [r.region, r.rev])),
		by: { uid: userId, name: 'owner' },
	});
	await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
}
/** The latest checkpoint the run opened. */
const lastOpen = async (run: string) =>
	(
		await sql<
			{
				payload: {
					checkpoint?: string;
					reason?: string;
					regions?: string[];
					message?: string;
					summary?: string;
				};
			}[]
		>`
			select payload_json as payload from director_events
			where run_id = ${run} and kind = 'checkpoint_open' order by id desc limit 1`
	)[0]?.payload;
/** What the owner is asked about H1, once its third failure has withdrawn its approval. */
const askedAboutH1 = async (run: string) => {
	const open = await lastOpen(run);
	return [
		(await h1Of(run)).approved,
		(await runRow(run)).waiting_on,
		open?.checkpoint,
		open?.regions,
	];
};
const ASKED_ABOUT_H1 = [null, 'art_plan', 'art_plan', ['H1']];
/** The latest note the worker posted to the run's feed. */
const lastNote = async (run: string) =>
	(
		await sql<{ text: string }[]>`
			select payload_json->>'text' as text from director_events
			where run_id = ${run} and agent = 'worker' and kind = 'activity'
				and payload_json->>'type' = 'note'
			order by id desc limit 1`
	)[0]?.text ?? '';
/** How many of the run's worker notes say `text`. */
const notesSaying = async (run: string, text: string) =>
	(
		await sql<{ n: number }[]>`
			select count(*)::int as n from director_events
			where run_id = ${run} and agent = 'worker' and kind = 'activity'
				and payload_json->>'type' = 'note' and payload_json->>'text' like ${`%${text}%`}`
	)[0].n;
/** The technician sends H1's recipe again with one more variant: a revision needing approval. */
async function oneMoreVariant(run: string) {
	const more = recipeInputOf(await h1Of(run));
	more.steps[0].variants += 1;
	await message(run, 'atlas-technician', 'One more variant on H1.');
	await drive(
		run,
		deps(fakeModel([{ content: [setRecipe(more)] }]).transport, fakeLauncher().launcher),
	);
}
/** The coordinator, also allowed to plan and to end a step (the fixture definition has neither). */
const planner = new Map(AGENTS);
planner.set('coordinator', {
	...coordinator,
	tools: [...coordinator.tools, 'run.set_plan', 'run.request_checkpoint'],
});
const userTexts = async (id: string, agent: string) =>
	(
		await sql<{ content: { type: string; text?: string }[] }[]>`
		select content_json as content from director_messages
		where run_id = ${id} and agent = ${agent} and role = 'user' order by seq`
	).flatMap((m) => m.content.map((b) => b.text ?? ''));

await sql`insert into users (id, email, name) values (${userId}, ${`${tag}@example.invalid`}, 'art plan proof')`;

try {
	// ── 1. The planning turn ──────────────────────────────────────────────────
	console.log('1. the technician plans the 23 regions; code validates every recipe');
	const runId = await newRun();
	{
		const badPipeline = recipeOf('H1');
		badPipeline.steps[0].pipeline = 'characterdesignertest3';
		const badSize = recipeOf('Background');
		badSize.steps[0].genPx = 4096;
		const credits = recipeOf('H2');
		credits.steps[1].pipeline = 'fixture_api_cut';
		const outside = recipeOf('Logo');
		outside.region = 'NotInTemplate';
		const model = fakeModel([
			{
				content: [
					say('Planning every region from the reviewed cards.'),
					setRecipe(badPipeline),
					setRecipe(badSize),
					setRecipe(credits),
					setRecipe(outside),
					...expected.recipes.map(setRecipe),
				],
			},
		]);
		const gate = fakeLauncher();
		await message(runId, 'atlas-technician', 'Task from coordinator:\n\nPlan the recipes.');
		await drive(runId, deps(model.transport, gate.launcher));

		const offered = (model.requests[0].tools ?? []).map((t) => (t as { name: string }).name);
		check(
			'the technician is offered its 18 tools, run.set_recipe among them',
			[offered.length, offered.includes(toolName('run.set_recipe'))],
			[18, true],
		);
		check('the catalogue is read once, as the worker, before the recipes are judged', gate.calls, [
			'worker:atlas.list_blueprints',
		]);
		const results = await toolResults(runId, 'atlas-technician');
		const errors = results.filter((r) => r.is_error).map((r) => String(r.content));
		check('the four broken recipes are answered as errors', errors.length, 4);
		check(
			'...each with its reason',
			[
				errors[0].includes('"characterdesignertest3" has no reviewed card'),
				errors[1].includes('genPx 4096 is outside'),
				errors[2].includes('bills credits'),
				errors[3].includes("not a region the run's plan names"),
			],
			[true, true, true, true],
		);
		const stored = await recipes(runId);
		check('the 23 valid recipes are stored, one per planned region', stored.length, 23);
		check(
			'...none of the broken ones (NotInTemplate absent, H1 is the valid chain)',
			[
				stored.some((r) => r.region === 'NotInTemplate'),
				stored.find((r) => r.region === 'H1')!.steps.map((s) => s.pipeline),
			],
			[false, ['sdxl', 'birefnet', '']],
		);
		const h1 = stored.find((r) => r.region === 'H1')!;
		check(
			'a stored recipe carries rev 1, its card revisions and licences, unapproved',
			[
				h1.rev,
				h1.column.rev,
				h1.column.group,
				h1.steps.map((s) => [s.cardRev, s.licence]),
				h1.approved,
			],
			[
				1,
				1,
				'Symbols',
				[
					[1, 'blocked'],
					[1, 'conditional'],
					[0, ''],
				],
				null,
			],
		);
		check(
			'...and a projection recomputed by code from the cards at the endpoint GPU price',
			[h1.projected.gpuSeconds > 0, h1.projected.gpuUsd !== null, h1.projected.placeholder],
			[true, true, true],
		);
		const opens = await artPlanOpens(runId);
		check('the Art plan opened exactly once', opens.length, 1);
		check(
			'...with the chains collapsed per group',
			String(opens[0]?.payload.summary).split('\n').slice(0, 2),
			['11 × Symbols: sdxl 1024 ×3 → birefnet → finish', '4 × Coins & jackpots: flux 1024 ×2'],
		);
		check('the run waits on it', await runRow(runId), {
			status: 'waiting',
			step: 'style_pack',
			waiting_on: 'art_plan',
		});
		check('no model call while the owner reviews: one call', model.calls(), 1);
	}

	// ── 2. The owner approves ─────────────────────────────────────────────────
	console.log('2. the owner approves the Art plan');
	{
		const before = await recipes(runId);
		const seen = Object.fromEntries(before.map((r) => [r.region, r.rev]));
		await event(runId, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'approve',
			recipeRevs: { ...seen, H1: 9 },
			by: { uid: userId, name: 'owner' },
		});
		await drive(runId, deps(fakeModel([]).transport, fakeLauncher().launcher));
		const refusal = await sql<{ payload: { type: string; error: string } }[]>`
			select payload_json as payload from director_events
			where run_id = ${runId} and kind = 'error' order by id desc limit 1`;
		check(
			'an approval of revisions the owner did not see is refused, and the plan stays open',
			[
				refusal[0]?.payload.type,
				/changed since you saw it/.test(refusal[0]?.payload.error ?? ''),
				(await runRow(runId)).waiting_on,
				(await recipes(runId)).every((r) => r.approved === null),
			],
			['refused_request', true, 'art_plan', true],
		);
		const model = fakeModel([{ content: [say('Assigning the first batch.')] }]);
		await event(runId, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'approve',
			recipeRevs: seen,
			by: { uid: userId, name: 'owner' },
		});
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		const stored = await recipes(runId);
		check(
			'every recipe is approved by the owner at its revision',
			stored.filter((r) => r.approved?.by !== userId || r.approved.rev !== r.rev).length,
			0,
		);
		check('the run is back in the style pack step', await runRow(runId), {
			status: 'running',
			step: 'style_pack',
			waiting_on: null,
		});
		const defaults = await sql<
			{ region_group: string; version: number; chain_json: { pipeline: string }[] }[]
		>`
			select region_group, version, chain_json from director_template_recipes
			where template_project_key = ${TEMPLATE} order by region_group`;
		check(
			"each group's chain becomes the template default, version 1",
			defaults.map((d) => [
				d.region_group,
				d.version,
				d.chain_json.map((s) => s.pipeline).join('>'),
			]),
			[
				['Backgrounds', 1, 'flux'],
				['Coins & jackpots', 1, 'flux'],
				['Reel frame & logo', 1, 'flux'],
				['Symbols', 1, 'sdxl>birefnet>'],
				['UI kit', 1, 'flux'],
				['Win banners', 1, 'flux'],
			],
		);
		check(
			'the coordinator is told',
			(await userTexts(runId, 'coordinator')).some((t) =>
				t.includes('approved the art_plan checkpoint'),
			),
			true,
		);
	}

	// ── 3. Revisions after approval ───────────────────────────────────────────
	console.log('3. a revision keeps its approval only when nothing priced changes');
	{
		const same = recipeOf('H2');
		same.steps[0].note = 'a gentler rim light';
		const changed = recipeOf('H1');
		changed.steps[1].pipeline = 'fixture_upscale';
		// One pipeline per atlas: the upscale runs on its own scratch atlas.
		changed.steps[1].atlas = 'symbols_up';
		changed.steps[1].region = 'up_H1';
		changed.steps[1].settings = [{ key: 'scale', value: '2' }];
		const model = fakeModel([{ content: [setRecipe(same), setRecipe(changed)] }]);
		await message(
			runId,
			'atlas-technician',
			'Owner note: soften H2, upscale H1 instead of the cutout.',
		);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		const stored = await recipes(runId);
		const h2 = stored.find((r) => r.region === 'H2')!;
		const h1 = stored.find((r) => r.region === 'H1')!;
		check(
			'the unchanged-chain revision is rev 2 and keeps its approval',
			[h2.rev, h2.approved?.rev],
			[2, 2],
		);
		check(
			'the pipeline change is rev 2 and needs the owner again',
			[h1.rev, h1.approved],
			[2, null],
		);
		check(
			'the Art plan re-opens for it',
			[(await artPlanOpens(runId)).length, (await runRow(runId)).waiting_on],
			[2, 'art_plan'],
		);
		check('...listing only what needs approving', (await artPlanOpens(runId))[1].payload.regions, [
			'H1',
		]);
	}

	// ── 4. The checkpoint off ─────────────────────────────────────────────────
	console.log('4. with the Art plan off, the cap decides');
	{
		const fits = await newRun({ artPlan: false });
		const model = fakeModel([
			{ content: expected.recipes.map(setRecipe) },
			{ content: [say('Recorded.')] },
		]);
		await message(fits, 'atlas-technician', 'Plan the recipes.');
		await drive(fits, deps(model.transport, fakeLauncher().launcher));
		const stored = await recipes(fits);
		check(
			'a plan that fits the cap is approved as auto, and no checkpoint opens',
			[
				stored.length,
				stored.every((r) => r.approved?.by === 'auto'),
				(await artPlanOpens(fits)).length,
			],
			[23, true, 0],
		);
		check('the run keeps running', (await runRow(fits)).status, 'running');

		// About $2.83 of GPU is projected; $1 leaves room for the planning turn, not the renders.
		const tight = await newRun({ artPlan: false, cap: 1 });
		const model2 = fakeModel([
			{ content: expected.recipes.map(setRecipe) },
			{ content: [say('Waiting.')] },
		]);
		await message(tight, 'atlas-technician', 'Plan the recipes.');
		await drive(tight, deps(model2.transport, fakeLauncher().launcher));
		const tightStored = await recipes(tight);
		const notes = await sql<{ payload: { text?: string } }[]>`
			select payload_json as payload from director_events
			where run_id = ${tight} and kind = 'activity' and payload_json->>'type' = 'note'`;
		check(
			'a plan over the cap stays unapproved, with a note for the owner',
			[
				tightStored.length,
				tightStored.every((r) => r.approved === null),
				notes.some((n) => /cap/.test(n.payload.text ?? '')),
			],
			[23, true, true],
		);
		const budget = await sql<{ payload: Record<string, unknown> }[]>`
			select payload_json as payload from director_events
			where run_id = ${tight} and kind = 'checkpoint_open'`;
		check(
			'...and the run pauses on the budget checkpoint: it fails closed',
			[(await runRow(tight)).status, budget.map((b) => [b.payload.checkpoint, b.payload.reason])],
			['paused', [['budget', 'art_plan']]],
		);
		await event(tight, 'owner', 'owner_request', {
			action: 'resume',
			budgetCapUsd: 40,
			by: { uid: userId, name: 'owner' },
		});
		await drive(tight, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'the owner raises the cap and resumes: the plan is approved, by the owner who resumed',
			[
				(await runRow(tight)).status,
				(await recipes(tight)).every((r) => r.approved?.by === userId),
			],
			['running', true],
		);

		const unpricedCatalogue = { ...catalogue, gpu: 'Unknown GPU' };
		const blind = await newRun({ artPlan: false });
		const model3 = fakeModel([{ content: expected.recipes.map(setRecipe) }]);
		const blindGate = fakeLauncher(unpricedCatalogue);
		await message(blind, 'atlas-technician', 'Plan the recipes.');
		await drive(blind, deps(model3.transport, blindGate.launcher));
		check(
			'a plan the GPU price cannot cost is never approved automatically',
			[(await runRow(blind)).status, (await recipes(blind)).every((r) => r.approved === null)],
			['paused', true],
		);
		const [pause] = await sql<{ payload: { reason?: string; message?: string } }[]>`
			select payload_json as payload from director_events
			where run_id = ${blind} and kind = 'checkpoint_open'`;
		check(
			"...and the pause says why in the recipes' own words",
			[
				pause?.payload.reason,
				/cannot be priced[^]*, \w+ and 18 more: the endpoint's GPU has no price\. Fix/.test(
					pause?.payload.message ?? '',
				),
			],
			['art_plan_unpriced', true],
		);
	}

	// ── 6. A rendered step is never rendered again ────────────────────────────
	console.log('6. a step renders once: not twice in a turn, not again after a resend');
	{
		const runId6 = await newRun({ artPlan: false, cap: 40 });
		const queue = (region: string) =>
			use('atlas.queue_variants', {
				atlas: 'symbols',
				regions: [region],
				variants: 3,
				step: `${region}#1`,
			});
		const model = fakeModel([
			{ content: expected.recipes.map(setRecipe) },
			{ content: [queue('H1'), queue('H1'), queue('H2')] },
			{ content: [setRecipe(recipeOf('H1')), queue('H1')] },
		]);
		await message(runId6, 'atlas-technician', 'Plan the recipes.');
		await drive(runId6, deps(model.transport, fakeLauncher().launcher));
		const results = (await toolResults(runId6, 'atlas-technician')).slice(23);
		check(
			'the plan is approved (auto), then the first queue of H1 renders and the second in the same turn is refused',
			[
				(await recipes(runId6)).every((r) => r.approved?.by === 'auto'),
				results.slice(0, 3).map((r) => Boolean(r.is_error)),
			],
			[true, [false, true, false]],
		);
		const h1 = (await recipes(runId6)).find((r) => r.region === 'H1')!;
		check(
			'only the matched step is marked queued, with its job',
			h1.steps.map((st) => [st.status, Boolean(st.jobRef)]),
			[
				['queued', true],
				['planned', false],
				['planned', false],
			],
		);
		check(
			'resending the same recipe keeps the rendered step queued and the approval',
			[h1.rev, h1.steps[0].status, h1.approved?.rev === h1.rev],
			[2, 'queued', true],
		);
		check(
			'...so the queue after the resend is refused: the region is not re-sampled unseen',
			Boolean(results.at(-1)?.is_error),
			true,
		);
	}

	// ── 5. The next run starts from the template default ──────────────────────
	console.log('5. a later run of the template briefs the technician with its default');
	{
		const next = await newRun();
		const model = fakeModel([
			{
				content: [use('run.assign_task', { agent: 'atlas-technician', task: 'Plan the recipes.' })],
			},
			{ content: [say('Assigned.')] },
			{ content: [say('Reading the cards.')] },
		]);
		await message(next, 'coordinator', 'Plan the run.');
		await drive(next, deps(model.transport, fakeLauncher().launcher));
		const brief = await sql<{ content: { type: string; text?: string }[] }[]>`
			select content_json as content from director_messages
			where run_id = ${next} and agent = 'atlas-technician' and role = 'user' order by seq limit 1`;
		const text = (brief[0]?.content ?? []).map((b) => b.text ?? '').join('\n');
		check(
			"the technician's task carries the template's default recipes, never the fallback where one exists",
			[
				text.includes('"group": "Symbols"'),
				text.includes('template default v1'),
				text.includes('fallback'),
			],
			[true, true, false],
		);
	}

	// ── 7. The owner edits the plan ───────────────────────────────────────────
	console.log('7. the owner edits the Art plan; the worker validates and re-opens it');
	const edited = await newRun();
	{
		const model = fakeModel([{ content: expected.recipes.map(setRecipe) }]);
		await message(edited, 'atlas-technician', 'Plan the recipes.');
		await drive(edited, deps(model.transport, fakeLauncher().launcher));
		const h1 = recipeOf('H1');
		h1.steps[0].variants = 2;
		await event(edited, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'revise',
			recipeEdits: [{ region: 'H1', rev: 1, steps: h1.steps }],
			by: { uid: userId, name: 'owner' },
		});
		const quiet = fakeModel([]);
		await drive(edited, deps(quiet.transport, fakeLauncher().launcher));
		const stored = (await recipes(edited)).find((r) => r.region === 'H1')!;
		check(
			'the edit is stored as the next revision, by the owner, unapproved',
			[stored.rev, stored.editedBy, stored.approved, stored.steps[0].variants],
			[2, userId, null, 2],
		);
		check(
			'...the plan re-opens on it, and no agent was woken for it',
			[(await runRow(edited)).waiting_on, (await artPlanOpens(edited)).length, quiet.calls()],
			['art_plan', 2, 0],
		);
		const broken = recipeOf('H2');
		broken.steps[0].variants = 99;
		await event(edited, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'revise',
			recipeEdits: [{ region: 'H2', rev: 1, steps: broken.steps }],
			by: { uid: userId, name: 'owner' },
		});
		await drive(edited, deps(fakeModel([]).transport, fakeLauncher().launcher));
		const notes = await sql<{ payload: { text?: string } }[]>`
			select payload_json as payload from director_events
			where run_id = ${edited} and kind = 'activity' and payload_json->>'type' = 'note'
			order by id desc limit 1`;
		check(
			'an edit that breaks a rule stores nothing, says why, and the plan stays as it was',
			[
				(await recipes(edited)).find((r) => r.region === 'H2')!.rev,
				/were not stored[\s\S]*at most/.test(notes[0]?.payload.text ?? ''),
				(await runRow(edited)).waiting_on,
			],
			[1, true, 'art_plan'],
		);
		const lastNote = async () =>
			(
				await sql<{ payload: { text?: string } }[]>`
				select payload_json as payload from director_events
				where run_id = ${edited} and kind = 'activity' and payload_json->>'type' = 'note'
				order by id desc limit 1`
			)[0]?.payload.text ?? '';
		const revise = (recipeEdits: unknown[]) =>
			event(edited, 'owner', 'checkpoint_resolved', {
				checkpoint: 'art_plan',
				decision: 'revise',
				recipeEdits,
				by: { uid: userId, name: 'owner' },
			});

		// A group edit of a per-atlas value: every Symbols region at 768 px, checked as a whole.
		const symbols = expected.plan.batches.find((b) => b.name === 'Symbols')!.regions;
		const byRegion = new Map((await recipes(edited)).map((r) => [r.region, r]));
		await revise(
			symbols.map((region) => {
				const r = byRegion.get(region)!;
				return {
					region,
					rev: r.rev,
					steps: r.steps.map((st, i) => (i === 0 ? { ...st, genPx: 768 } : st)),
				};
			}),
		);
		await drive(edited, deps(fakeModel([]).transport, fakeLauncher().launcher));
		const afterGroup = (await recipes(edited)).filter((r) => symbols.includes(r.region));
		check(
			"a group edit of the atlas's size lands on every region at once, not refused one by one",
			[
				afterGroup.every((r) => r.steps[0].genPx === 768 && r.editedBy === userId),
				afterGroup.length,
			],
			[true, symbols.length],
		);
		check(
			'...and the step fields the owner sent beyond a step are dropped',
			afterGroup.every((r) => r.steps.every((st) => st.status === 'planned' && !st.jobRef)),
			true,
		);

		// An edit made on an older revision, and a malformed one: refused, never thrown on.
		const h1Now = (await recipes(edited)).find((r) => r.region === 'H1')!;
		await revise([{ region: 'H1', rev: h1Now.rev - 1, steps: h1Now.steps }]);
		await drive(edited, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'an edit made on an older revision is refused: it would overwrite a newer one',
			[
				(await recipes(edited)).find((r) => r.region === 'H1')!.rev,
				/changed since you edited it/.test(await lastNote()),
			],
			[h1Now.rev, true],
		);
		await revise([
			{
				region: 'H1',
				rev: h1Now.rev,
				steps: h1Now.steps.map((st, i) =>
					i === 0 ? { ...st, style: null, settings: [{ key: 'ksampler_steps', value: 28 }] } : st,
				),
			},
		]);
		await drive(edited, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'a malformed edit is refused with its reason, and the run goes on: the next row applies',
			[
				/were not stored[\s\S]*each setting is \{key, value\} as text/.test(await lastNote()),
				(
					await sql`select count(*)::int as n from director_events
						where run_id = ${edited} and handled_at is null
							and kind in ('owner_request', 'owner_message', 'checkpoint_resolved', 'job_done')`
				)[0].n,
			],
			[true, 0],
		);

		const seen = Object.fromEntries((await recipes(edited)).map((r) => [r.region, r.rev]));
		await event(edited, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'approve',
			recipeRevs: seen,
			by: { uid: userId, name: 'owner' },
		});
		await drive(edited, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'the plan as edited is approved',
			(await recipes(edited)).every((r) => r.approved?.rev === r.rev),
			true,
		);
	}

	// ── 8. Renders advance the steps; their time is measured ──────────────────
	console.log('8. a render advances its steps and is measured once');
	{
		const h1 = (await recipes(edited)).find((r) => r.region === 'H1')!;
		const scratch = h1.steps[1];
		// The queue goes through the launcher's gate as it decides (`queueGate`), over the stored
		// recipes; the pick and the commit are answered as the adapter answers them.
		const launcher = fakeLauncher(catalogue, {
			'atlas.choose_variant': () => ({
				atlas: h1.atlas,
				region: 'H1',
				chosen: '00017',
				locked: true,
			}),
			'atlas.set_output': () => ({ atlas: h1.atlas, region: 'H1', committed: true }),
		});
		const queueH1 = () =>
			fakeModel([
				{
					content: [
						use('atlas.queue_variants', {
							atlas: h1.atlas,
							regions: ['H1'],
							variants: h1.steps[0].variants,
							step: 'H1#1',
						}),
					],
				},
				{ content: [say('Queued.')] },
			]);
		const firstStep = async () => (await recipes(edited)).find((r) => r.region === 'H1')!.steps[0];
		await message(edited, 'atlas-technician', 'Render H1.');
		await drive(edited, deps(queueH1().transport, launcher.launcher));
		const failedRef = (await firstStep()).jobRef!;
		await event(edited, 'atlas-technician', 'job_done', {
			jobRef: failedRef,
			status: 'failed',
			atlas: h1.atlas,
			regions: ['H1'],
			result: { error: 'OOM' },
		});
		await drive(
			edited,
			deps(fakeModel([{ content: [say('It failed.')] }]).transport, launcher.launcher),
		);
		check('a failed render fails its step', (await firstStep()).status, 'failed');
		await message(edited, 'atlas-technician', 'Render H1 again.');
		await drive(edited, deps(queueH1().transport, launcher.launcher));
		const queued = await firstStep();
		const jobRef = queued.jobRef!;
		check(
			'the render queued again under the same approval is recorded like the first',
			[queued.status, Boolean(jobRef) && jobRef !== failedRef],
			['queued', true],
		);
		const done = {
			jobRef,
			status: 'finished',
			atlas: h1.atlas,
			regions: ['H1'],
			result: {
				variants: [
					{ region: 'H1', variant: '00016' },
					{ region: 'H1', variant: '00017' },
				],
				runpod: {
					gpu: 'L40S (48 GB)',
					seconds: 50,
					executionSeconds: 40,
					delaySeconds: 10,
					jobs: 2,
					unreported: 0,
				},
			},
		};
		const timing = async () =>
			(
				await sql<{ jobs: number; mean_exec_seconds: number; mean_delay_seconds: number }[]>`
				select jobs, mean_exec_seconds, mean_delay_seconds from director_blueprint_timings
				where pipeline = ${queued.pipeline} and gen_px = ${queued.genPx}`
			)[0];
		const prior = await timing();
		await event(edited, 'atlas-technician', 'job_done', done);
		await drive(
			edited,
			deps(fakeModel([{ content: [say('Rendered.')] }]).transport, launcher.launcher),
		);
		const rendered = (await recipes(edited)).find((r) => r.region === 'H1')!.steps[0];
		check(
			'the job settles its step with the variants it made',
			[rendered.status, rendered.rendered],
			['done', ['00016', '00017']],
		);
		const first = await timing();
		await event(edited, 'atlas-technician', 'job_done', done);
		await drive(edited, deps(fakeModel([]).transport, launcher.launcher));
		const again = await timing();
		const n = prior?.jobs ?? 0;
		check(
			'its measured time is folded into the rolling means per job: 20 s execution, 5 s delay',
			[first?.jobs, first?.mean_exec_seconds, first?.mean_delay_seconds],
			[
				n + 2,
				((prior?.mean_exec_seconds ?? 0) * n + 40) / (n + 2),
				((prior?.mean_delay_seconds ?? 0) * n + 10) / (n + 2),
			],
		);
		check('...once, however often its job_done is delivered', again, first);
		const pick = fakeModel([
			{
				content: [
					use('atlas.choose_variant', { atlas: h1.atlas, region: 'H1', id: '00017', lock: true }),
					use('atlas.set_output', {
						atlas: h1.atlas,
						region: 'H1',
						from: { atlas: scratch.atlas, region: scratch.region, id: '00003' },
						base: { etag: 'e', rev: '1' },
					}),
				],
			},
			{ content: [say('Committed.')] },
		]);
		await message(edited, 'atlas-technician', 'Pick and commit H1.');
		await drive(edited, deps(pick.transport, launcher.launcher));
		const after = (await recipes(edited)).find((r) => r.region === 'H1')!;
		check(
			'the pick and the committed tile are on the recipe',
			[after.steps[0].status, after.steps[0].chosen, after.steps.at(-1)?.chosen],
			['chosen', '00017', `${scratch.atlas}/${scratch.region}/00003`],
		);
	}

	// ── 9. A plan that drops a region drops its approval ──────────────────────
	console.log('9. a new plan without a region takes its approval away');
	{
		const batches = expected.plan.batches.map((b) => ({
			...b,
			regions: b.regions.filter((r) => r !== 'Logo'),
		}));
		// Two plans the owner's approval could never name are refused first, and nothing changes.
		const misnamed = batches.map((b, i) =>
			i === 0 ? { ...b, regions: [...b.regions, 'H1 copy'] } : b,
		);
		const crowded = [{ name: 'All', regions: Array.from({ length: 257 }, (_, i) => `R${i}`) }];
		const model = fakeModel([
			{
				content: [
					use('run.set_plan', { summary: 'A misnamed region.', batches: misnamed }),
					use('run.set_plan', { summary: 'Too many regions.', batches: crowded }),
					use('run.set_plan', { summary: 'Without the logo.', batches }),
				],
			},
			{ content: [say('Re-planned.')] },
		]);
		const plannerAgents = new Map(AGENTS);
		plannerAgents.set('coordinator', {
			...coordinator,
			tools: [...coordinator.tools, 'run.set_plan'],
		});
		await message(edited, 'coordinator', 'Drop the logo.');
		await drive(edited, {
			...deps(model.transport, fakeLauncher().launcher),
			agents: plannerAgents,
		});
		check(
			'a plan with a name Atlas Maker would refuse, or more regions than an approval names, is refused',
			(await toolResults(edited, 'coordinator'))
				.slice(-3)
				.map((r) => [
					Boolean(r.is_error),
					/H1 copy\\?" is not a region name|257 regions, more than the 256/.test(
						JSON.stringify(r.content ?? ''),
					),
				]),
			[
				[true, true],
				[true, true],
				[false, false],
			],
		);
		const logo = (await recipes(edited)).find((r) => r.region === 'Logo')!;
		check(
			'the dropped region keeps its recipe as a record but loses its approval',
			[logo.rev, logo.approved],
			[1, null],
		);
		check(
			'...and the others keep theirs',
			(await recipes(edited)).filter((r) => r.region !== 'Logo').every((r) => r.approved !== null),
			true,
		);
	}

	// ── 10. A revision is held to the approved plan on today's prices ──────────
	console.log('10. a dearer revision loses its approval even when the timings fell since');
	{
		const setDelay = (delay: number) =>
			sql`insert into director_blueprint_timings
					(pipeline, gen_px, jobs, mean_exec_seconds, mean_delay_seconds)
				values ('sdxl', 1024, 50, 12, ${delay})
				on conflict (pipeline, gen_px) do update
				set jobs = 50, mean_exec_seconds = 12, mean_delay_seconds = ${delay}`;
		const before = await sql<
			{ jobs: number; mean_exec_seconds: number; mean_delay_seconds: number }[]
		>`
			select jobs, mean_exec_seconds, mean_delay_seconds from director_blueprint_timings
			where pipeline = 'sdxl' and gen_px = 1024`;
		await setDelay(60);
		const held = await newRun();
		await message(held, 'atlas-technician', 'Plan the recipes.');
		await drive(
			held,
			deps(
				fakeModel([{ content: expected.recipes.map(setRecipe) }]).transport,
				fakeLauncher().launcher,
			),
		);
		const seen = Object.fromEntries((await recipes(held)).map((r) => [r.region, r.rev]));
		await event(held, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'approve',
			recipeRevs: seen,
			by: { uid: userId, name: 'owner' },
		});
		await drive(held, deps(fakeModel([]).transport, fakeLauncher().launcher));
		await setDelay(10);
		const dearer = recipeOf('H2');
		dearer.steps[0].variants = dearer.steps[0].variants + 1;
		await message(held, 'atlas-technician', 'One more H2 variant.');
		await drive(
			held,
			deps(fakeModel([{ content: [setRecipe(dearer)] }]).transport, fakeLauncher().launcher),
		);
		const h2 = (await recipes(held)).find((r) => r.region === 'H2')!;
		check(
			'one more variant costs more on one pricing basis, so the approval goes',
			[h2.rev, h2.approved, (await runRow(held)).waiting_on],
			[2, null, 'art_plan'],
		);
		if (before[0]) {
			await sql`update director_blueprint_timings
				set jobs = ${before[0].jobs}, mean_exec_seconds = ${before[0].mean_exec_seconds},
					mean_delay_seconds = ${before[0].mean_delay_seconds}
				where pipeline = 'sdxl' and gen_px = 1024`;
		} else {
			await sql`delete from director_blueprint_timings where pipeline = 'sdxl' and gen_px = 1024`;
		}
	}

	// ── 11. Re-opening a rendered step needs the owner, whatever it costs ───────
	console.log(
		'11. a revision that re-opens a rendered step needs the owner again, at the same price',
	);
	{
		const stored = await recipes(edited);
		// A region-scoped setting, so the per-atlas rules hold and nothing priced changes.
		const weighted = (region: string) => {
			const input = recipeInputOf(stored.find((r) => r.region === region)!);
			input.steps[0].settings = [
				...input.steps[0].settings,
				{ key: 'ipadapter_weight', value: '0.4' },
			];
			return input;
		};
		const model = fakeModel([
			{ content: [setRecipe(weighted('H2')), setRecipe(weighted('H1'))] },
			{ content: [say('Revised.')] },
		]);
		await message(edited, 'atlas-technician', 'A touch more style on H1 and H2.');
		await drive(edited, deps(model.transport, fakeLauncher().launcher));
		const after = await recipes(edited);
		const h1 = after.find((r) => r.region === 'H1')!;
		const h2 = after.find((r) => r.region === 'H2')!;
		check(
			'H2 had rendered nothing: its revision keeps the approval',
			[h2.rev > stored.find((r) => r.region === 'H2')!.rev, h2.approved?.rev === h2.rev],
			[true, true],
		);
		check(
			'H1 had: its picked and committed steps start again, and the approval goes',
			[h1.steps.map((st) => st.status), h1.approved],
			[['planned', 'planned', 'planned'], null],
		);
		check(
			'...and the Art plan re-opens for it alone',
			[(await runRow(edited)).waiting_on, (await artPlanOpens(edited)).at(-1)?.payload.regions],
			['art_plan', ['H1']],
		);
	}

	// ── 12. A decision the launcher cannot answer never holds the owner's stop ──
	console.log(
		'12. an approval while the launcher is unreachable is refused; the stop behind it lands',
	);
	{
		const cut = await newRun();
		await message(cut, 'atlas-technician', 'Plan the recipes.');
		await drive(
			cut,
			deps(
				fakeModel([{ content: expected.recipes.map(setRecipe) }]).transport,
				fakeLauncher().launcher,
			),
		);
		const seen = Object.fromEntries((await recipes(cut)).map((r) => [r.region, r.rev]));
		await event(cut, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'approve',
			recipeRevs: seen,
			by: { uid: userId, name: 'owner' },
		});
		await event(cut, 'owner', 'owner_request', { action: 'stop' });
		const reachable = fakeLauncher().launcher;
		// No answer at all: what `fetch` throws when the launcher cannot be reached.
		const unreachable: Launcher = {
			catalog: () => reachable.catalog(),
			async call(id, body, signal) {
				if (id === 'atlas.list_blueprints') throw new TypeError('fetch failed');
				return reachable.call(id, body, signal);
			},
		};
		await drive(cut, deps(fakeModel([]).transport, unreachable));
		const refusals = await sql<{ payload: { type: string; error: string } }[]>`
			select payload_json as payload from director_events
			where run_id = ${cut} and kind = 'error' order by id`;
		check(
			'the approval is refused: the plan cannot be priced now',
			refusals.map((r) => [r.payload.type, /cannot be priced now/.test(r.payload.error)]),
			[['refused_request', true]],
		);
		check(
			"…and the owner's stop behind it is applied, not held",
			[
				(await runRow(cut)).status,
				(
					await sql`select count(*)::int as n from director_events
						where run_id = ${cut} and handled_at is null
							and kind in ('owner_request', 'checkpoint_resolved')`
				)[0].n,
			],
			['stopped', 0],
		);
	}

	// ── 13. Two retries per step per approval ─────────────────────────────────
	console.log('13. a step fails three times: the third failure withdraws its approval');
	for (const artPlan of [true, false]) {
		const label = artPlan ? 'Art plan on' : 'Art plan off';
		const run = await plannedRun(artPlan ? {} : { artPlan: false, cap: 40 });
		const gate = async () =>
			queueGate(run, {
				atlas: 'symbols',
				regions: ['H1'],
				variants: (await h1Of(run)).steps[0].variants,
			});
		await failH1(run);
		await failH1(run);
		const twice = await h1Of(run);
		check(
			`${label}: two failures, two retries: the step stays queueable under its approval`,
			[twice.steps[0].status, twice.failures, twice.approved?.rev === twice.rev],
			['failed', { 1: 2 }, true],
		);
		await failH1(run);
		const thrice = await h1Of(run);
		check(
			`${label}: the third withdraws the approval as a new revision, and the gate refuses the step`,
			[thrice.failures, thrice.approved, thrice.rev, (await gate()).status],
			[{ 1: 3 }, null, twice.rev + 1, 409],
		);
		check(`${label}: …the Art plan opens for it alone`, await askedAboutH1(run), ASKED_ABOUT_H1);
		await approvePlan(run);
		const again = await h1Of(run);
		check(
			`${label}: the owner's approval there approves it again, retries afresh`,
			[again.approved?.by, again.failures, (await gate()).status],
			[userId, undefined, 200],
		);
	}

	// ── 14. A cap pause names the spent step; its resume approves nothing of it ─
	console.log('14. a third failure that also crosses the cap: named in the pause, never resumed');
	{
		const timingOf = () => sql<
			{ jobs: number; mean_exec_seconds: number; mean_delay_seconds: number }[]
		>`
			select jobs, mean_exec_seconds, mean_delay_seconds from director_blueprint_timings
			where pipeline = 'sdxl' and gen_px = 1024`;
		const timingBefore = await timingOf();
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		// The third render ran a long time before it failed: its bill alone is over the cap.
		await failH1(run, {
			gpu: 'L40S (48 GB)',
			seconds: 85_000,
			executionSeconds: 84_000,
			delaySeconds: 1_000,
			jobs: 1,
			unreported: 0,
		});
		const pause = await lastOpen(run);
		check(
			'the run pauses at the cap, and the pause also names the step past its retries',
			[
				(await runRow(run)).status,
				pause?.reason,
				/than is left of the \$40\.00 cap[^]*H1 step 1 failed again after 2 retries: it waits for your approval in the Art plan/.test(
					pause?.message ?? '',
				),
			],
			['paused', 'art_plan', true],
		);
		await event(run, 'owner', 'owner_request', {
			action: 'resume',
			budgetCapUsd: 200,
			by: { uid: userId, name: 'owner' },
		});
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'…the resume that raises the cap approves nothing past its retries: the Art plan asks',
			await askedAboutH1(run),
			ASKED_ABOUT_H1,
		);
		const [before] = timingBefore;
		if (before) {
			await sql`update director_blueprint_timings
				set jobs = ${before.jobs}, mean_exec_seconds = ${before.mean_exec_seconds},
					mean_delay_seconds = ${before.mean_delay_seconds}
				where pipeline = 'sdxl' and gen_px = 1024`;
		} else {
			await sql`delete from director_blueprint_timings where pipeline = 'sdxl' and gen_px = 1024`;
		}
	}

	// ── 15. A stopping run is asked nothing ───────────────────────────────────
	console.log('15. a third failure on a stopping run: nothing opens, the stop finishes');
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		await queueStep(run, 'H1');
		// The launcher's record of the render, which keeps the stop waiting on it.
		const jobRef = (await h1Of(run)).steps[0].jobRef!;
		await sql`insert into director_atlas_jobs (job_ref, run_id, agent, atlas, regions, status)
			values (${jobRef}, ${run}, 'atlas-technician', 'symbols', ${sql.json(['H1'])}, 'queued')`;
		await event(run, 'owner', 'owner_request', { action: 'stop', by: { uid: userId } });
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check('the stop waits on the render in flight', (await runRow(run)).status, 'stopping');
		await sql`update director_atlas_jobs set status = 'failed', done_at = now()
			where job_ref = ${jobRef}`;
		await h1Fails(run);
		const [opened] = await sql<{ n: number }[]>`
			select count(*)::int as n from director_events
			where run_id = ${run} and kind = 'checkpoint_open'`;
		check(
			'its third failure withdraws the approval, opens nothing, and the stop finishes',
			[(await h1Of(run)).approved, opened.n, (await runRow(run)).status],
			[null, 0, 'stopped'],
		);
		check(
			'…and the stopping run is told nothing of it',
			await notesSaying(run, 'failed again after 2 retries'),
			0,
		);
	}

	// ── 16. A pause the owner asked for: their resume approves nothing spent ──
	console.log('16. a third failure on a run the owner paused: the resume approves nothing of it');
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		await queueStep(run, 'H1');
		await event(run, 'owner', 'owner_request', { action: 'pause', by: { uid: userId } });
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		await h1Fails(run);
		check(
			'the failure lands on the paused run: the approval goes, and the run stays paused',
			[(await h1Of(run)).approved, (await runRow(run)).status],
			[null, 'paused'],
		);
		check(
			'…and the owner is told the Art plan asks them when they resume',
			await lastNote(run),
			'H1 waits for your approval in the Art plan (H1 step 1 failed again after 2 retries). The Art plan opens when you resume the run.',
		);
		await event(run, 'owner', 'owner_request', { action: 'resume', by: { uid: userId } });
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'…their resume opens the Art plan for it instead',
			await askedAboutH1(run),
			ASKED_ABOUT_H1,
		);
	}

	// ── 17. A pause at the spend cap: its resume approves nothing spent ────────
	console.log('17. a third failure on a run paused at the spend cap: the resume approves nothing');
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		await queueStep(run, 'H1');
		// Spend from elsewhere leaves no room: the next submit pauses the run at its cap.
		await recordSpend(sql, {
			runId: run,
			agent: 'atlas-technician',
			model: 'L40S (48 GB)',
			kind: 'runpod',
			requestId: `${run}-earlier-renders`,
			usd: 39.9,
		});
		await queueStep(run, 'H2');
		check(
			'the next submit pauses the run at the cap, outside the plan gate',
			[(await runRow(run)).status, (await lastOpen(run))?.checkpoint],
			['paused', 'budget'],
		);
		await h1Fails(run);
		check(
			'the failure lands on the paused run: the approval goes',
			(await h1Of(run)).approved,
			null,
		);
		await event(run, 'owner', 'owner_request', {
			action: 'resume',
			budgetCapUsd: 200,
			by: { uid: userId },
		});
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'…the resume that raises the cap opens the Art plan for it, approving nothing of it',
			await askedAboutH1(run),
			ASKED_ABOUT_H1,
		);
	}

	// ── 18. An approval never covers a step withdrawn since the owner looked ────
	console.log(
		'18. a step withdrawn while the Art plan is open: the approval the owner saw is refused',
	);
	{
		const run = await plannedRun();
		await failH1(run);
		await failH1(run);
		await queueStep(run, 'H1');
		// H2 is revised onto another pipeline, so the Art plan opens for H2 alone.
		const dearer = recipeOf('H2');
		dearer.steps[1].pipeline = 'fixture_upscale';
		dearer.steps[1].atlas = 'symbols_up';
		dearer.steps[1].region = 'up_H2';
		dearer.steps[1].settings = [{ key: 'scale', value: '2' }];
		await message(run, 'atlas-technician', 'Upscale H2 instead.');
		await drive(
			run,
			deps(fakeModel([{ content: [setRecipe(dearer)] }]).transport, fakeLauncher().launcher),
		);
		check(
			'the Art plan is open for H2',
			[(await runRow(run)).waiting_on, (await lastOpen(run))?.regions],
			['art_plan', ['H2']],
		);
		const seen = Object.fromEntries((await recipes(run)).map((r) => [r.region, r.rev]));
		// H1's third render fails while the owner reads the card that lists only H2.
		await h1Fails(run);
		await approvePlan(run, seen);
		const [refusal] = await sql<{ payload: { type: string; error: string } }[]>`
			select payload_json as payload from director_events
			where run_id = ${run} and kind = 'error' order by id desc limit 1`;
		check(
			'the approval of what they saw is refused: H1 changed since, and nothing is approved',
			[
				refusal?.payload.type,
				/changed since you saw it \(H1 is at revision/.test(refusal?.payload.error ?? ''),
				(await h1Of(run)).approved,
				(await recipes(run)).find((r) => r.region === 'H2')!.approved,
				(await runRow(run)).waiting_on,
			],
			['refused_request', true, null, null, 'art_plan'],
		);
		await approvePlan(run);
		check(
			'…and approving what is there now approves both, knowingly',
			(await recipes(run))
				.filter((r) => r.region === 'H1' || r.region === 'H2')
				.map((r) => r.approved?.by),
			[userId, userId],
		);
	}

	// ── 19. A failure while a region batch waits is asked about when it resolves ─
	console.log('19. a third failure while a region batch waits: the Art plan asks once it resolves');
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		await queueStep(run, 'H1');
		// The coordinator's batch_done, as the state machine leaves the run.
		await sql`update director_runs set status = 'waiting', step = 'regions',
			waiting_on = 'region_batch' where id = ${run}`;
		await h1Fails(run);
		check(
			'the failure lands while the batch waits: the approval goes, and the batch still waits',
			[(await h1Of(run)).approved, (await runRow(run)).waiting_on],
			[null, 'region_batch'],
		);
		await event(run, 'owner', 'checkpoint_resolved', {
			checkpoint: 'region_batch',
			decision: 'approve',
			by: { uid: userId },
		});
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'…approving the batch puts it to the owner at once: the Art plan opens for it',
			await askedAboutH1(run),
			ASKED_ABOUT_H1,
		);
	}

	// ── 20. Only the owner's approval at the Art plan starts the failures again ──
	console.log(
		'20. a step that failed twice keeps its count through any approval but the Art plan owner’s',
	);
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		await oneMoreVariant(run);
		const revised = await h1Of(run);
		check(
			'Art plan off: a revision after two failures is approved automatically, its failures kept',
			[revised.approved?.by, revised.approved?.rev === revised.rev, revised.failures],
			['auto', true, { 1: 2 }],
		);
		await failH1(run);
		check(
			'…so its next failure is its third: the Art plan opens for it, whatever its setting',
			await askedAboutH1(run),
			ASKED_ABOUT_H1,
		);
	}
	{
		const run = await plannedRun();
		await failH1(run);
		await failH1(run);
		await oneMoreVariant(run);
		const revised = await h1Of(run);
		check(
			'Art plan on: the revision opens the Art plan for H1, its two failures kept',
			[
				revised.approved,
				revised.failures,
				(await runRow(run)).waiting_on,
				(await lastOpen(run))?.regions,
			],
			[null, { 1: 2 }, 'art_plan', ['H1']],
		);
		await approvePlan(run);
		const approved = await h1Of(run);
		check(
			'…the owner approving it there starts its failures again',
			[approved.approved?.by, approved.failures],
			[userId, undefined],
		);
		await failH1(run);
		await failH1(run);
		await failH1(run);
		const open = await lastOpen(run);
		check(
			'…and its third failure since re-opens the Art plan on it as a render that kept failing',
			[
				...(await askedAboutH1(run)),
				open?.reason,
				/\nH1 step 1 failed again after 2 retries\. Approve to let it try 3 more times\.$/.test(
					open?.summary ?? '',
				),
			],
			[...ASKED_ABOUT_H1, 'retries_spent', true],
		);
	}
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		const without = expected.plan.batches.map((b) => ({
			...b,
			regions: b.regions.filter((r) => r !== 'H1'),
		}));
		await message(run, 'coordinator', 'Re-plan H1.');
		await drive(run, {
			...deps(
				fakeModel([
					{
						content: [
							use('run.set_plan', { summary: 'Without H1.', batches: without }),
							use('run.set_plan', { summary: 'H1 back.', batches: expected.plan.batches }),
						],
					},
				]).transport,
				fakeLauncher().launcher,
			),
			agents: planner,
		});
		const replanned = await h1Of(run);
		check(
			'a plan that drops H1 and takes it back: its approval goes, its failures stay',
			[replanned.approved, replanned.failures],
			[null, { 1: 2 }],
		);
		await message(run, 'atlas-technician', 'H1 is planned again.');
		await drive(
			run,
			deps(
				fakeModel([{ content: [setRecipe(recipeInputOf(replanned))] }]).transport,
				fakeLauncher().launcher,
			),
		);
		const again = await h1Of(run);
		check(
			'…the gate approves it again automatically, keeping them',
			[again.approved?.by, again.failures],
			['auto', { 1: 2 }],
		);
		await failH1(run);
		check('…so its next failure puts it to the owner', await askedAboutH1(run), ASKED_ABOUT_H1);
	}
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		// No room left under the cap: the revision's approval pauses the run.
		await sql`update director_runs set budget_cap_usd = 1 where id = ${run}`;
		await oneMoreVariant(run);
		check(
			'a revision that crosses the cap pauses the run for the owner',
			[(await runRow(run)).status, (await lastOpen(run))?.reason, (await h1Of(run)).approved],
			['paused', 'art_plan', null],
		);
		await event(run, 'owner', 'owner_request', {
			action: 'resume',
			budgetCapUsd: 200,
			by: { uid: userId },
		});
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		const resumed = await h1Of(run);
		check(
			'…the resume that raises the cap approves it as the owner, its failures kept',
			[resumed.approved?.by, resumed.failures],
			[userId, { 1: 2 }],
		);
		await failH1(run);
		check('…so its next failure puts it to the Art plan', await askedAboutH1(run), ASKED_ABOUT_H1);
	}

	// ── 21. The region step ends once nothing it queued can still fail ─────────
	console.log('21. the region step does not end while a render is in flight');
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await sql`update director_runs set step = 'regions' where id = ${run}`;
		await queueStep(run, 'H1');
		const jobRef = (await h1Of(run)).steps[0].jobRef!;
		await sql`insert into director_atlas_jobs (job_ref, run_id, agent, atlas, regions, status)
			values (${jobRef}, ${run}, 'atlas-technician', 'symbols', ${sql.json(['H1'])}, 'queued')`;
		const stepDone = async () => {
			await message(run, 'coordinator', 'Every region is done.');
			await drive(run, {
				...deps(
					fakeModel([
						{ content: [use('run.request_checkpoint', { kind: 'step_done', summary: 'Done.' })] },
					]).transport,
					fakeLauncher().launcher,
				),
				agents: planner,
			});
		};
		await stepDone();
		const [answer] = (await toolResults(run, 'coordinator')).slice(-1);
		check(
			'step_done is refused while the render is in flight, saying why, and the step stays',
			[
				Boolean(answer?.is_error),
				/1 render is still in flight/.test(JSON.stringify(answer?.content ?? '')),
				(await runRow(run)).step,
			],
			[true, true, 'regions'],
		);
		await sql`update director_atlas_jobs set status = 'failed', done_at = now()
			where job_ref = ${jobRef}`;
		await h1Fails(run);
		await stepDone();
		check('…and once it has landed, the step ends', (await runRow(run)).step, 'build');
	}

	// ── 22. A gate the state machine refuses is told to the owner ─────────────
	console.log('22. an Art plan that cannot open is never silent');
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		// A render queued after the region step: its third failure has no Art plan to open.
		await sql`update director_runs set step = 'build' where id = ${run}`;
		await failH1(run);
		check(
			'Art plan off: a third failure in the build step tells the owner it renders nothing more',
			[(await h1Of(run)).approved, (await runRow(run)).step, await lastNote(run)],
			[
				null,
				'build',
				'H1 waits for your approval in the Art plan (H1 step 1 failed again after 2 retries). The Art plan cannot open in the build step: it renders nothing more in this run.',
			],
		);
		await message(run, 'atlas-technician', 'H2 again.');
		await drive(
			run,
			deps(
				fakeModel([{ content: [setRecipe(recipeOf('H2'))] }]).transport,
				fakeLauncher().launcher,
			),
		);
		check(
			'…in one note: none beside it for the withdrawal, and a later gate does not say it again',
			await notesSaying(run, 'H1 step 1 failed again after 2 retries'),
			1,
		);
	}
	{
		const run = await plannedRun();
		await failH1(run);
		await failH1(run);
		await queueStep(run, 'H1');
		await sql`update director_runs set status = 'waiting', step = 'regions',
			waiting_on = 'region_batch' where id = ${run}`;
		await h1Fails(run);
		check(
			'Art plan on: a third failure while a region batch waits tells the owner when it is asked',
			[(await runRow(run)).waiting_on, await lastNote(run)],
			[
				'region_batch',
				'H1 waits for your approval in the Art plan (H1 step 1 failed again after 2 retries). The Art plan opens once you resolve the region batch checkpoint.',
			],
		);
		await event(run, 'owner', 'checkpoint_resolved', {
			checkpoint: 'region_batch',
			decision: 'approve',
			by: { uid: userId },
		});
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'…and resolving the batch opens the Art plan on it, as a render that kept failing',
			[...(await askedAboutH1(run)), (await lastOpen(run))?.reason],
			[...ASKED_ABOUT_H1, 'retries_spent'],
		);
	}

	// ── 23. A render's failure always counts against its step ──────────────────
	console.log("23. a step stays as it is while it renders, and its render's failure is counted");
	{
		const run = await plannedRun({ artPlan: false, cap: 40 });
		await failH1(run);
		await failH1(run);
		await queueStep(run, 'H1');
		const queued = await h1Of(run);
		const jobRef = queued.steps[0].jobRef!;
		// The launcher's record of the render, with the step it runs (`queue_variants`).
		await sql`insert into director_atlas_jobs (job_ref, run_id, agent, atlas, regions, status, steps)
			values (${jobRef}, ${run}, 'atlas-technician', 'symbols', ${sql.json(['H1'])}, 'queued',
				${sql.json([{ recipe: 'H1', n: 1, region: 'H1' }])})`;
		await oneMoreVariant(run);
		const [answer] = (await toolResults(run, 'atlas-technician')).slice(-1);
		check(
			'a revision of a step while it renders is refused, saying why, and nothing is stored',
			[
				Boolean(answer?.is_error),
				/H1 step 1 is rendering; revise it once it settles/.test(
					JSON.stringify(answer?.content ?? ''),
				),
				(await h1Of(run)).rev,
			],
			[true, true, queued.rev],
		);
		await sql`update director_runs set status = 'waiting', waiting_on = 'art_plan' where id = ${run}`;
		const edit = recipeInputOf(queued);
		edit.steps[0].variants += 1;
		await event(run, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'revise',
			recipeEdits: [{ region: 'H1', rev: queued.rev, steps: edit.steps }],
			by: { uid: userId },
		});
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			"…as is the owner's edit of it",
			[
				/H1: step 1 is rendering; edit it once it settles/.test(await lastNote(run)),
				(await h1Of(run)).rev,
			],
			[true, queued.rev],
		);
		// However the step came to be replanned, the render it ran still fails that step.
		const replanned = {
			...queued,
			steps: queued.steps.map((st, i) =>
				i === 0 ? { ...st, status: 'planned', jobRef: undefined } : st,
			),
		};
		await sql`update director_regions set recipe_json = ${sql.json(replanned as never)}
			where run_id = ${run} and region = 'H1'`;
		await sql`update director_atlas_jobs set status = 'failed', done_at = now() where job_ref = ${jobRef}`;
		const failed = {
			jobRef,
			status: 'failed',
			atlas: 'symbols',
			regions: ['H1'],
			result: { error: 'OOM' },
		};
		await event(run, 'atlas-technician', 'job_done', failed);
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'a render whose step was replanned since still counts its failure: the third withdraws the approval',
			[(await h1Of(run)).failures, (await h1Of(run)).approved],
			[{ 1: 3 }, null],
		);
		await event(run, 'atlas-technician', 'job_done', failed);
		await drive(run, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check('…once, however often its job_done is delivered', (await h1Of(run)).failures, { 1: 3 });
	}
} finally {
	await sql`delete from director_template_recipes where template_project_key = ${TEMPLATE}`;
	await sql`delete from director_spend where run_id like ${`${tag}-%`}`;
	if (!process.env.KEEP) await sql`delete from users where id = ${userId}`;
	await sql.end();
}

console.log(`\nart plan: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
