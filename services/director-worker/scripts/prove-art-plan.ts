/**
 * Proof of the technician's planning turn and the Art plan gate (ADR-0008 §5, §7), against a REAL
 * Postgres, with a fake model and a fake launcher — no API call is ever made:
 *
 *   createdb director_proof
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter launcher-api db:migrate
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter director-worker prove:art-plan
 *
 * The `atlas-technician` (its real definition once it has landed, else the same tools as a fixture) takes a turn that replays the reference plan
 * (`docs/director/eval/blueprints/expected-art-plan.json`, the reference template's 23 regions)
 * against the fixture catalogue (`catalogue.json`), plus recipes that break the §5 rules on purpose.
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
 *  5. a later run of the same template briefs the technician with that template default.
 */
import type {
	BetaMessage,
	BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import postgres from 'postgres';
import { parsePricing } from 'director-costs';
import type { Catalogue, RecipeInput, StoredRecipe } from 'director-costs/recipe';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAgents, pricedModels, type AgentDefinition } from '../src/agents.ts';
import { driveRun, type DriverDeps } from '../src/driver.ts';
import type { AdapterResult, AdapterSpec, Launcher } from '../src/launcher.ts';
import { claimRun } from '../src/lease.ts';
import type { VisionTransport } from '../src/mockups/vision.ts';
import { toolName, type ModelTransport } from '../src/model.ts';
import { TECHNICIAN, TECHNICIAN_TOOLS } from '../src/recipes.ts';
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

function fakeLauncher(served: Catalogue = catalogue) {
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
/**
 * The technician as its definition will run it (ADR-0008 Appendix A), until that definition lands
 * in its own PR; once it has, the proof runs the real one.
 */
const fixtureTechnician: AgentDefinition = {
	name: TECHNICIAN,
	model: 'claude-sonnet-5-5',
	effort: 'high',
	role: 'atlas technician',
	tools: [...TECHNICIAN_TOOLS],
	inputs: '',
	outputs: '',
	systemPrompt: 'You plan and run Atlas Maker.',
};
const AGENTS = new Map<string, AgentDefinition>([
	['coordinator', coordinator],
	['atlas-technician', real.get(TECHNICIAN) ?? fixtureTechnician],
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
		const model = fakeModel([{ content: [say('Assigning the first batch.')] }]);
		await event(runId, 'owner', 'checkpoint_resolved', {
			checkpoint: 'art_plan',
			decision: 'approve',
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
		await event(tight, 'owner', 'owner_request', { action: 'resume', budgetCapUsd: 40 });
		await drive(tight, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'the owner raises the cap and resumes: the plan is approved as auto',
			[
				(await runRow(tight)).status,
				(await recipes(tight)).every((r) => r.approved?.by === 'auto'),
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
} finally {
	await sql`delete from director_template_recipes where template_project_key = ${TEMPLATE}`;
	await sql`delete from director_spend where run_id like ${`${tag}-%`}`;
	if (!process.env.KEEP) await sql`delete from users where id = ${userId}`;
	await sql.end();
}

console.log(`\nart plan: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
