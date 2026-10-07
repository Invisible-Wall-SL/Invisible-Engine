/**
 * Proof of the technician's planning turn and the Art plan gate (ADR-0008 §5, §7), against a REAL
 * Postgres, with a fake model and a fake launcher — no API call is ever made:
 *
 *   createdb director_proof
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter launcher-api db:migrate
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter director-worker prove:art-plan
 *
 * The REAL `atlas-technician` definition takes a turn that replays the reference plan
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
 *  5. a later run of the same template briefs the technician with that template default;
 *  6. (card 8E) an approval that does not name the revisions the owner saw is refused and the plan
 *     stays open; the owner's own edits are validated with the same rules, stored as the next
 *     revision with `editedBy` and no approval, and the plan re-opens on them without waking an
 *     agent; an edit that breaks a rule stores nothing and says why;
 *  7. a render advances its steps (`queued` → `done` with its variants), the technician's pick
 *     and the committed tile are recorded on the recipe, and the job's measured time is folded
 *     into `director_blueprint_timings` once, however often its `job_done` is delivered;
 *  8. a new plan that leaves a region out takes its recipe's approval away.
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
const AGENTS = new Map<string, AgentDefinition>([
	['coordinator', coordinator],
	['atlas-technician', real.get('atlas-technician')!],
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

async function newRun(
	over: {
		cap?: number;
		artPlan?: boolean;
		template?: string;
		stalePreset?: Record<string, string | number>;
	} = {},
) {
	const id = `${tag}-run-${++runSeq}`;
	const checkpoints = over.artPlan === false ? { artPlan: false } : {};
	await sql`insert into director_runs (id, project_key, template_project_key, owner_user_id, status,
			step, budget_cap_usd, checkpoints_json, preset_json)
		values (${id}, ${`${id}-p`}, ${over.template ?? TEMPLATE}, ${userId}, 'running', 'style_pack',
			${over.cap ?? 25}, ${sql.json(checkpoints)}, ${sql.json(over.stalePreset ?? {})})`;
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
			'the real technician definition is offered its 18 tools, run.set_recipe among them',
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

	// ── 5b. Without a template default, the fallback is the estimate profiles' ─
	console.log('5b. a template with no default briefs the profiles fallback; preset_json is unread');
	{
		const fresh = await newRun({
			template: `${tag}-tpl-new`,
			stalePreset: { blueprint: 'flux', finalPx: 768, variantsPerRegion: 2 },
		});
		const model = fakeModel([
			{
				content: [use('run.assign_task', { agent: 'atlas-technician', task: 'Plan the recipes.' })],
			},
			{ content: [say('Assigned.')] },
			{ content: [say('Reading the cards.')] },
		]);
		await message(fresh, 'coordinator', 'Plan the run.');
		await drive(fresh, deps(model.transport, fakeLauncher().launcher));
		const rows = await sql<{ content: { type: string; text?: string }[] }[]>`
			select content_json as content from director_messages
			where run_id = ${fresh} and agent = 'atlas-technician' and role = 'user' order by seq limit 1`;
		const text = (rows[0]?.content ?? []).map((b) => b.text ?? '').join('\n');
		check(
			"the technician starts from the profiles' fallback chain, never the run's stored preset",
			[
				text.includes('fallback (the estimate profiles)'),
				text.includes('"pipeline": "sdxl"'),
				text.includes('"genPx": 1024'),
				text.includes('"variants": 3'),
				text.includes('flux'),
				text.includes('768'),
			],
			[true, true, true, true, false, false],
		);
	}

	// ── 6. The owner edits the plan ───────────────────────────────────────────
	console.log('6. the owner edits the Art plan; the worker validates and re-opens it');
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
			recipeEdits: [{ region: 'H1', steps: h1.steps }],
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
			recipeEdits: [{ region: 'H2', steps: broken.steps }],
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

	// ── 7. Renders advance the steps; their time is measured ──────────────────
	console.log('7. a render advances its steps and is measured once');
	{
		const h1 = (await recipes(edited)).find((r) => r.region === 'H1')!;
		const jobRef = 'st_00000000000000e8';
		const scratch = h1.steps[1];
		const launcher = fakeLauncher(catalogue, {
			'atlas.queue_variants': () => ({ atlas: h1.atlas, regions: ['H1'], jobRef }),
			'atlas.choose_variant': () => ({
				atlas: h1.atlas,
				region: 'H1',
				chosen: '00017',
				locked: true,
			}),
			'atlas.set_output': () => ({ atlas: h1.atlas, region: 'H1', committed: true }),
		});
		const model = fakeModel([
			{
				content: [
					use('atlas.queue_variants', {
						atlas: h1.atlas,
						regions: ['H1'],
						variants: 2,
						step: 'H1#1',
					}),
				],
			},
			{ content: [say('Queued.')] },
		]);
		await message(edited, 'atlas-technician', 'Render H1.');
		await drive(edited, deps(model.transport, launcher.launcher));
		const queued = (await recipes(edited)).find((r) => r.region === 'H1')!.steps[0];
		check('a queued render marks its step', [queued.status, queued.jobRef], ['queued', jobRef]);
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

	// ── 8. A plan that drops a region drops its approval ──────────────────────
	console.log('8. a new plan without a region takes its approval away');
	{
		const batches = expected.plan.batches.map((b) => ({
			...b,
			regions: b.regions.filter((r) => r !== 'Logo'),
		}));
		const model = fakeModel([
			{ content: [use('run.set_plan', { summary: 'Without the logo.', batches })] },
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
} finally {
	await sql`delete from director_template_recipes where template_project_key = ${TEMPLATE}`;
	await sql`delete from director_spend where run_id like ${`${tag}-%`}`;
	if (!process.env.KEEP) await sql`delete from users where id = ${userId}`;
	await sql.end();
}

console.log(`\nart plan: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
