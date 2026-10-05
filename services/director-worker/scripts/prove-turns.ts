/**
 * Proof of the turn loop (PLAN 3.4, 3.5, 3.7) against a REAL Postgres, with a fake Anthropic
 * transport and a fake launcher — no API call is ever made:
 *
 *   createdb director_turns_proof
 *   DATABASE_URL=postgres://…/director_turns_proof pnpm --filter launcher-api db:migrate
 *   DATABASE_URL=postgres://…/director_turns_proof pnpm --filter director-worker prove:turns
 *
 * The run tables' behaviour IS the thing under test — lease-checked transactions, the unique
 * `request_id`, the NOTIFY trigger — so an in-memory fake would prove nothing. Every scenario uses
 * its own run ids and the script removes its rows at the end, so it can share a scratch database
 * with `prove:lease` (run that one first: it refuses a non-empty `director_runs`).
 *
 * Proved:
 *  1. a worker killed between an adapter write and storing its result resumes from the stored
 *     messages: the write is sent again with the SAME opId (the launcher replays it — one effect),
 *     the worker tool in the same turn runs once, and the model is not asked that turn again;
 *  2. an idle run — waiting on a checkpoint, or running with every agent waiting on a GPU job —
 *     makes zero model calls however often it is woken;
 *  3. a refusal pauses the run, shows the reason, stores no assistant message, and is still billed;
 *  4. a run whose spend plus the projected next call reaches its cap pauses BEFORE the call, with a
 *     budget checkpoint;
 *  5. a retried spend write (same response id, or a redelivered job) is ignored;
 *  6. owner start → the cap is snapshotted onto the run; a checkpoint the agent asks for opens and
 *     the run waits; the owner's approval moves it on and the next turn runs;
 *  7. `job_done` reaches the agent that queued the job and is billed once as a RunPod row;
 *  8. the AFTER INSERT trigger NOTIFYs `director_wake` for owner rows and `job_done` only;
 *  9. an owner's pause pressed while a turn runs is applied before that turn's calls go out;
 * 10. a call the API rejects (400) pauses the run; a transient failure (529) is left for the next
 *     wake, which asks again;
 * 11. after a mid-output refusal fallback, the declined model's thinking and tool calls are neither
 *     stored nor run, and the turn is billed per attempt;
 * 12. an adapter answer that leaves the outcome unknown (409 in_progress) stores nothing; the next
 *     claim sends the same opId, so the op runs once.
 */
import type {
	BetaMessage,
	BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import Anthropic from '@anthropic-ai/sdk';
import postgres from 'postgres';
import { parsePricing } from 'director-costs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentDefinition } from '../src/agents.ts';
import { driveRun, type DriverDeps } from '../src/driver.ts';
import type { AdapterResult, AdapterSpec, Launcher } from '../src/launcher.ts';
import { claimRun } from '../src/lease.ts';
import { toolName, type ModelTransport } from '../src/model.ts';
import { recordSpend } from '../src/store.ts';

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

const pricing = parsePricing(
	JSON.parse(readFileSync(fileURLToPath(new URL('../pricing.json', import.meta.url)), 'utf8')),
);

// ── Fakes ─────────────────────────────────────────────────────────────────────

type Reply = Partial<BetaMessage> & {
	content: BetaMessage['content'];
	/** Runs while the call is in flight — e.g. the owner pressing Pause. */
	during?: () => Promise<unknown>;
	/** The call fails with this instead of answering. */
	error?: unknown;
};

/** Scripted model: answers each call with the next reply; counts and keeps every request. */
function fakeModel(replies: Reply[]) {
	const requests: BetaMessageStreamParams[] = [];
	let n = 0;
	const transport: ModelTransport = {
		async send(request) {
			requests.push(structuredClone(request));
			const reply = replies[n++];
			if (!reply)
				throw new Error(`the model was called ${n} times; only ${replies.length} expected`);
			await reply.during?.();
			if (reply.error) throw reply.error;
			return {
				id: reply.id ?? `msg_${tag}_${n}_${Math.random().toString(36).slice(2)}`,
				type: 'message',
				role: 'assistant',
				model: reply.model ?? request.model,
				stop_reason:
					reply.stop_reason ??
					(reply.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
				stop_sequence: null,
				stop_details: reply.stop_details ?? null,
				usage: reply.usage ?? {
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

const SPECS: AdapterSpec[] = [
	{
		id: 'gamemaker.create_from_template',
		description: 'Create the project.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		write: true,
	},
	{
		id: 'atlas.queue_variants',
		description: 'Queue variants.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		write: true,
	},
];

/** The launcher gate's idempotency: a write's opId runs once; a repeat returns the stored result. */
function fakeLauncher(answer?: (id: string, nth: number) => AdapterResult | null) {
	const effects: string[] = [];
	const sent: string[] = [];
	const stored = new Map<string, unknown>();
	const launcher: Launcher = {
		async catalog() {
			return new Map(SPECS.map((s) => [s.id, s]));
		},
		async call(id, body) {
			sent.push(`${id}@${body.opId}`);
			const scripted = answer?.(id, sent.length);
			if (scripted) return scripted;
			if (body.opId && stored.has(body.opId)) return { status: 200, body: stored.get(body.opId) };
			effects.push(id);
			const result =
				id === 'atlas.queue_variants'
					? { jobRef: `job-${effects.length}` }
					: { ok: effects.length };
			if (body.opId) stored.set(body.opId, result);
			return { status: 200, body: result };
		},
	};
	return { launcher, effects, sent };
}

const agent = (name: string, tools: string[], model = 'claude-sonnet-5-5'): AgentDefinition => ({
	name,
	model,
	effort: 'medium',
	role: name,
	tools,
	inputs: '',
	outputs: '',
	systemPrompt: `You are ${name}.`,
});
const AGENTS = new Map([
	[
		'coordinator',
		agent(
			'coordinator',
			[
				'run.post_activity',
				'run.request_checkpoint',
				'run.assign_task',
				'gamemaker.create_from_template',
			],
			'claude-opus-5-5',
		),
	],
	['atlas-artist', agent('atlas-artist', ['atlas.queue_variants', 'run.post_activity'])],
]);

const use = (id: string, name: string, input: Record<string, unknown> = {}) => ({
	type: 'tool_use' as const,
	id,
	name: toolName(name),
	input,
	caller: { type: 'direct' as const },
});
const say = (text: string) => ({ type: 'text' as const, text, citations: null });

// ── Fixtures ──────────────────────────────────────────────────────────────────

const tag = `turns-proof-${Date.now()}`;
const userId = `${tag}-owner`;
let runSeq = 0;

async function newRun(
	over: { status?: string; step?: string; waitingOn?: string | null; cap?: number | null } = {},
) {
	const id = `${tag}-run-${++runSeq}`;
	await sql`insert into director_runs (id, project_key, template_project_key, owner_user_id, status,
			step, waiting_on, budget_cap_usd)
		values (${id}, ${`${id}-p`}, 'template', ${userId}, ${over.status ?? 'running'},
			${over.step ?? 'breakdown'}, ${over.waitingOn ?? null},
			${over.cap === undefined ? 25 : over.cap})`;
	return id;
}
async function userMessage(runId: string, agentName: string, text: string) {
	await sql`insert into director_messages (run_id, agent, seq, role, content_json)
		select ${runId}, ${agentName}, coalesce(max(seq), -1) + 1, 'user',
			${sql.json([{ type: 'text', text }])}
		from director_messages where run_id = ${runId} and agent = ${agentName}`;
}
const event = (
	runId: string,
	agentName: string,
	kind: string,
	payload: Record<string, unknown>,
	tool: string | null = null,
) =>
	sql`insert into director_events (run_id, agent, kind, tool, payload_json)
		values (${runId}, ${agentName}, ${kind}, ${tool}, ${sql.json(payload as never)})`;

const deps = (
	transport: ModelTransport,
	launcher: Launcher,
	over: Partial<DriverDeps> = {},
): DriverDeps => ({
	sql,
	transport,
	launcher,
	agents: AGENTS,
	pricing: async () => pricing,
	leaseMs: 2_000,
	...over,
});

/** Claim `runId` (as a fresh worker would) and drive it once. */
async function drive(runId: string, d: DriverDeps) {
	const claimed = await claimRun(sql, `prover-${Math.random()}`, { runId, leaseMs: 2_000 });
	if (claimed) await driveRun(d, claimed);
	return claimed !== null;
}
const runRow = async (id: string) =>
	(
		await sql<
			{ status: string; step: string; waiting_on: string | null; budget_cap_usd: number | null }[]
		>`
		select status, step, waiting_on, budget_cap_usd from director_runs where id = ${id}`
	)[0];
const messages = async (id: string, agentName: string) =>
	sql<{ role: string; content: { type: string }[] }[]>`
		select role, content_json as content from director_messages
		where run_id = ${id} and agent = ${agentName} order by seq`;
const events = async (id: string, kind: string) =>
	sql<{ payload: Record<string, unknown> }[]>`
		select payload_json as payload from director_events where run_id = ${id} and kind = ${kind} order by id`;
const spendRows = async (id: string) =>
	sql<{ kind: string; model: string; request_id: string; usd: number }[]>`
		select kind, model, request_id, usd from director_spend where run_id = ${id} order by at`;

await sql`insert into users (id, email, name) values (${userId}, ${`${tag}@example.invalid`}, 'turns proof')`;

try {
	// ── 1. Kill mid-turn ──────────────────────────────────────────────────────
	console.log('1. a worker killed mid-turn resumes with no duplicate op');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const model = fakeModel([
			{
				content: [
					say('Creating.'),
					use('t1', 'gamemaker.create_from_template'),
					use('t2', 'run.post_activity', { text: 'project created' }),
				],
			},
			{ content: [say('Done.')] },
		]);
		const gate = fakeLauncher();
		let killed = false;
		const kill = () => {
			if (!killed) {
				killed = true;
				throw new Error('killed');
			}
		};
		let crashed = false;
		try {
			await drive(runId, deps(model.transport, gate.launcher, { afterAdapterCall: kill }));
		} catch (error) {
			crashed = (error as Error).message === 'killed';
		}
		check('the first worker died after the write, before storing its result', crashed, true);
		check('…having asked the model once', model.calls(), 1);
		check(
			'…with the assistant turn stored and no results yet',
			(await messages(runId, 'coordinator')).map((m) => m.role),
			['user', 'assistant'],
		);
		await sql`update director_runs set lease_until = now() - interval '1 second' where id = ${runId} and lease_holder is not null`;

		check(
			'a second worker claims and drives the run',
			await drive(runId, deps(model.transport, gate.launcher)),
			true,
		);
		check(
			'the write was sent twice with one opId',
			new Set(gate.sent).size === 1 && gate.sent.length === 2,
			true,
		);
		check('…and took effect once', gate.effects, ['gamemaker.create_from_template']);
		check(
			'the opId is <runId>:<agent>-t<turn>:<call>',
			gate.sent[0],
			`gamemaker.create_from_template@${runId}:coordinator-t1:0`,
		);
		check('the worker tool in the same turn ran once', (await events(runId, 'activity')).length, 1);
		check('the model was asked once more, not for the stored turn again', model.calls(), 2);
		check(
			'the resumed request is the stored history plus the results',
			model.requests[1].messages.map((m) => m.role),
			['user', 'assistant', 'user'],
		);
		check(
			'history is append-only: user, assistant, results, assistant',
			(await messages(runId, 'coordinator')).map((m) => m.role),
			['user', 'assistant', 'user', 'assistant'],
		);
		check('each response is billed once', (await spendRows(runId)).length, 2);
	}

	// ── 2. Idle runs ──────────────────────────────────────────────────────────
	console.log('2. an idle run makes zero model calls');
	{
		const model = fakeModel([]);
		const gate = fakeLauncher();
		const waiting = await newRun({ status: 'waiting', step: 'breakdown', waitingOn: 'breakdown' });
		await userMessage(waiting, 'coordinator', 'Plan.');
		await event(waiting, 'owner', 'owner_message', { text: 'Make the coins gold.' });
		for (let i = 0; i < 3; i++) await drive(waiting, deps(model.transport, gate.launcher));
		check('a run waiting on the owner: zero calls after three wakes', model.calls(), 0);
		check(
			"…and the owner's message is stored for the coordinator's next turn",
			(await messages(waiting, 'coordinator')).length,
			2,
		);

		const onJob = await newRun({ step: 'regions' });
		await sql`insert into director_messages (run_id, agent, seq, role, content_json) values
			(${onJob}, 'atlas-artist', 0, 'user', ${sql.json([{ type: 'text', text: 'Draw.' }])}),
			(${onJob}, 'atlas-artist', 1, 'assistant', ${sql.json([{ type: 'text', text: 'Queued job-1.' }])}),
			(${onJob}, 'coordinator', 0, 'user', ${sql.json([{ type: 'text', text: 'Go.' }])}),
			(${onJob}, 'coordinator', 1, 'assistant', ${sql.json([{ type: 'text', text: 'Waiting on job-1.' }])})`;
		for (let i = 0; i < 3; i++) await drive(onJob, deps(model.transport, gate.launcher));
		check(
			'a running run whose agents wait on a GPU job: zero calls after three wakes',
			model.calls(),
			0,
		);

		const paused = await newRun({ status: 'paused' });
		await userMessage(paused, 'coordinator', 'Go.');
		await drive(paused, deps(model.transport, gate.launcher));
		check('a paused run with a pending turn: zero calls', model.calls(), 0);
	}

	// ── 3. Refusal ────────────────────────────────────────────────────────────
	console.log('3. a refusal pauses the run');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const model = fakeModel([
			{
				content: [],
				stop_reason: 'refusal',
				stop_details: {
					type: 'refusal',
					category: 'general_harms',
					explanation: 'Declined by policy.',
				} as never,
			},
		]);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check('the run is paused', (await runRow(runId)).status, 'paused');
		const [error] = await events(runId, 'error');
		check(
			'the reason is shown',
			[error?.payload.type, error?.payload.category, error?.payload.explanation],
			['refusal', 'general_harms', 'Declined by policy.'],
		);
		check(
			'no assistant message is stored',
			(await messages(runId, 'coordinator')).map((m) => m.role),
			['user'],
		);
		check('the refused call is still billed', (await spendRows(runId)).length, 1);
		check('one call, no retry loop', model.calls(), 1);
	}

	// ── 4. Budget cap ─────────────────────────────────────────────────────────
	console.log('4. the cap pauses the run before the call');
	{
		const runId = await newRun({ cap: 1 });
		await userMessage(runId, 'coordinator', 'Start.');
		await recordSpend(sql, {
			runId,
			agent: 'coordinator',
			model: 'claude-opus-5-5',
			kind: 'claude',
			requestId: `${runId}-earlier`,
			usd: 0.95,
		});
		const model = fakeModel([{ content: [say('never')] }]);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check('no call was made', model.calls(), 0);
		check('the run is paused', (await runRow(runId)).status, 'paused');
		const [budget] = await events(runId, 'checkpoint_open');
		check(
			'a budget checkpoint asks the owner',
			[budget?.payload.checkpoint, budget?.payload.before, budget?.payload.capUsd],
			['budget', 'model_call', 1],
		);

		await event(runId, 'owner', 'owner_request', { action: 'resume', budgetCapUsd: 10 });
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check('raising the cap and resuming runs the call', model.calls(), 1);
		check('…with the raised cap on the run', (await runRow(runId)).budget_cap_usd, 10);

		const gpuRun = await newRun({ cap: 1, step: 'regions' });
		await userMessage(gpuRun, 'atlas-artist', 'Draw.');
		await recordSpend(sql, {
			runId: gpuRun,
			agent: 'atlas-artist',
			model: 'L40S (48 GB)',
			kind: 'runpod',
			requestId: `${gpuRun}-job0`,
			usd: 0.5,
		});
		const gpuModel = fakeModel([{ content: [use('q1', 'atlas.queue_variants')] }]);
		const gate = fakeLauncher();
		await drive(gpuRun, deps(gpuModel.transport, gate.launcher));
		check('a GPU submit that would reach the cap is not sent', gate.effects, []);
		check(
			'…and pauses the run with a GPU budget checkpoint',
			[(await runRow(gpuRun)).status, (await events(gpuRun, 'checkpoint_open'))[0]?.payload.before],
			['paused', 'gpu_submit'],
		);
	}

	// ── 5. Retried spend writes ───────────────────────────────────────────────
	console.log('5. a retried spend write is ignored');
	{
		const runId = await newRun();
		const row = {
			runId,
			agent: 'coordinator',
			model: 'claude-opus-5-5',
			kind: 'claude' as const,
			requestId: `msg_${runId}`,
			usd: 0.01,
		};
		check('the first write lands', await recordSpend(sql, row), true);
		check(
			'the same response id again is ignored',
			await recordSpend(sql, { ...row, usd: 99 }),
			false,
		);
		check(
			'one row, at the first price',
			(await spendRows(runId)).map((r) => r.usd),
			[0.01],
		);

		// A worker that dies after the call but before storing it asks again; were the API to answer
		// with the same id, it would not be billed twice.
		await userMessage(runId, 'coordinator', 'Go.');
		const model = fakeModel([{ id: `msg_${runId}_same`, content: [say('ok')] }]);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		await recordSpend(sql, { ...row, requestId: `msg_${runId}_same`, usd: 5 });
		check('a response billed by the loop is not billed again', (await spendRows(runId)).length, 2);
	}

	// ── 6. Start → checkpoint → approval ──────────────────────────────────────
	console.log('6. start, checkpoint, approval');
	{
		await sql`insert into app_settings (key, value) values ('DIRECTOR_RUN_BUDGET_USD', '7')
			on conflict (key) do update set value = excluded.value`;
		const runId = await newRun({ status: 'draft', cap: null });
		const model = fakeModel([
			{
				content: [
					use('c1', 'run.request_checkpoint', { kind: 'step_done', summary: 'Breakdown ready.' }),
				],
			},
			{ content: [say('Starting the style pack.')] },
		]);
		const gate = fakeLauncher();
		await event(runId, 'owner', 'owner_request', { action: 'start' });
		await drive(runId, deps(model.transport, gate.launcher));
		const row = await runRow(runId);
		check('start snapshots the cap from Settings onto the run', row.budget_cap_usd, 7);
		check(
			'the checkpoint the agent asked for is open',
			[row.status, row.waiting_on],
			['waiting', 'breakdown'],
		);
		check(
			'the checkpoint is shown to the owner',
			(await events(runId, 'checkpoint_open'))[0]?.payload.summary,
			'Breakdown ready.',
		);
		check('one call, then the run waits', model.calls(), 1);
		await sql`update app_settings set value = '400' where key = 'DIRECTOR_RUN_BUDGET_USD'`;

		await event(runId, 'owner', 'checkpoint_resolved', {
			checkpoint: 'breakdown',
			decision: 'approve',
			note: 'Nice.',
		});
		await drive(runId, deps(model.transport, gate.launcher));
		const after = await runRow(runId);
		check('approval moves the run on', [after.status, after.step], ['running', 'style_pack']);
		check('…and the coordinator takes its next turn', model.calls(), 2);
		check('a changed Setting does not move a running run', after.budget_cap_usd, 7);
		check(
			'the approval reached the coordinator',
			JSON.stringify(model.requests[1].messages.at(-1)).includes(
				'approved the breakdown checkpoint',
			),
			true,
		);
		await sql`delete from app_settings where key = 'DIRECTOR_RUN_BUDGET_USD'`;
	}

	// ── 7. GPU job round trip ─────────────────────────────────────────────────
	console.log('7. job_done reaches the agent and is billed once');
	{
		const runId = await newRun({ step: 'regions' });
		await userMessage(runId, 'coordinator', 'Draw the symbols.');
		const model = fakeModel([
			// Oldest pending conversation first: the artist's task is stored before the results of
			// the coordinator's call that assigned it.
			{
				content: [
					use('a1', 'run.assign_task', { agent: 'atlas-artist', task: 'Draw the symbols.' }),
				],
			},
			{ content: [use('q1', 'atlas.queue_variants')] },
			{ content: [say('Assigned.')] },
			{ content: [say('Queued job-1; ending my turn.')] },
			{ content: [say('Waiting on the artist.')] },
			{ content: [say('Variants are in.')] },
			{ content: [say('Good.')] },
		]);
		const gate = fakeLauncher();
		await drive(runId, deps(model.transport, gate.launcher));
		check('the coordinator assigned, the artist queued and both went idle', model.calls(), 5);
		check(
			"the artist's report reached the coordinator",
			JSON.stringify(model.requests[4].messages.at(-1)).includes('Report from atlas-artist'),
			true,
		);
		check('the job was queued once', gate.effects, ['atlas.queue_variants']);

		const done = {
			jobRef: 'job-1',
			status: 'finished',
			result: { variants: 4, runpod: { gpu: 'L40S (48 GB)', seconds: 100 } },
		};
		await event(runId, 'atlas-artist', 'job_done', done, 'atlas.queue_variants');
		await event(runId, 'atlas-artist', 'job_done', done, 'atlas.queue_variants');
		await drive(runId, deps(model.transport, gate.launcher));
		check('job_done woke the artist, whose report woke the coordinator', model.calls(), 7);
		const gpu = (await spendRows(runId)).filter((r) => r.kind === 'runpod');
		check(
			'a redelivered job_done is billed once, at seconds × $/s',
			gpu.map((r) => [r.request_id, r.usd]),
			[['runpod:job-1', 100 * pricing.runpod.perSecondByGpu['L40S (48 GB)']]],
		);
	}

	// ── 9. Pause or stop during a turn ────────────────────────────────────────
	console.log('9. a pause pressed during a turn stops its tool calls going out');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const gate = fakeLauncher();
		const model = fakeModel([
			{
				during: () => event(runId, 'owner', 'owner_request', { action: 'pause' }),
				content: [use('p1', 'gamemaker.create_from_template')],
			},
			{ content: [use('p2', 'gamemaker.create_from_template')] },
			{ content: [say('Created.')] },
		]);
		await drive(runId, deps(model.transport, gate.launcher));
		check('the write was not sent', gate.sent, []);
		check('the run is paused', (await runRow(runId)).status, 'paused');
		const stored = await messages(runId, 'coordinator');
		check(
			'the call is answered "not run"',
			JSON.stringify(stored.at(-1)?.content).includes('Not run: the run is paused'),
			true,
		);
		await event(runId, 'owner', 'owner_request', { action: 'resume' });
		await drive(runId, deps(model.transport, gate.launcher));
		check('after resume the agent asks again and the write runs once', gate.effects, [
			'gamemaker.create_from_template',
		]);
		check('three calls in all', model.calls(), 3);
	}

	// ── 10. API errors ────────────────────────────────────────────────────────
	console.log('10. a rejected call pauses the run; a transient failure is retried');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const rejected = Anthropic.APIError.generate(
			400,
			{ type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } },
			'bad request',
			new Headers(),
		);
		const model = fakeModel([{ content: [], error: rejected }]);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check('a 400 pauses the run', (await runRow(runId)).status, 'paused');
		check('…with the status shown', (await events(runId, 'error'))[0]?.payload.status, 400);
		check(
			'…and nothing billed or stored',
			[(await spendRows(runId)).length, (await messages(runId, 'coordinator')).length],
			[0, 1],
		);

		const flaky = await newRun();
		await userMessage(flaky, 'coordinator', 'Start.');
		const overloaded = Anthropic.APIError.generate(529, undefined, 'overloaded', new Headers());
		const retried = fakeModel([{ content: [], error: overloaded }, { content: [say('Done.')] }]);
		let threw = false;
		try {
			await drive(flaky, deps(retried.transport, fakeLauncher().launcher));
		} catch {
			threw = true;
		}
		check(
			'a 529 leaves the run running for the next wake',
			[threw, (await runRow(flaky)).status],
			[true, 'running'],
		);
		await drive(flaky, deps(retried.transport, fakeLauncher().launcher));
		check(
			'…which asks again and stores one turn',
			(await messages(flaky, 'coordinator')).length,
			2,
		);
	}

	// ── 11. Mid-output fallback ───────────────────────────────────────────────
	console.log("11. a mid-output fallback drops the declined model's thinking and calls");
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const gate = fakeLauncher();
		const model = fakeModel([
			{
				model: 'claude-opus-5',
				content: [
					{ type: 'thinking', thinking: '', signature: 'sig' },
					use('f1', 'gamemaker.create_from_template'),
					{
						type: 'fallback',
						from: { model: 'claude-opus-5-5' },
						to: { model: 'claude-opus-5' },
					},
					say('Taking over.'),
					use('f2', 'run.post_activity', { text: 'after the fallback' }),
				] as never,
				usage: {
					input_tokens: 1000,
					output_tokens: 100,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
					iterations: [
						{ type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 50 },
						{
							type: 'fallback_message',
							model: 'claude-opus-5',
							input_tokens: 1000,
							output_tokens: 100,
						},
					],
				} as never,
			},
			{ content: [say('Done.')] },
		]);
		await drive(runId, deps(model.transport, gate.launcher));
		const stored = (await messages(runId, 'coordinator'))[1];
		check(
			'the stored turn keeps the marker and what follows it',
			stored.content.map((b) => b.type),
			['fallback', 'text', 'tool_use'],
		);
		check("the declined model's call never ran", gate.sent, []);
		check('the call after the boundary ran', (await events(runId, 'activity')).length, 1);
		const [first] = await spendRows(runId);
		check(
			'the turn is billed per attempt, each at its model',
			first?.usd,
			(1000 * 4 + 50 * 20 + 1000 * 5 + 100 * 25) / 1_000_000,
		);
	}

	// ── 12. An adapter answer that leaves the outcome unknown ─────────────────
	console.log('12. an op still in progress is retried with the same opId, never re-issued');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const gate = fakeLauncher((_id, nth) =>
			nth === 1 ? { status: 409, body: { error: 'in_progress' } } : null,
		);
		const model = fakeModel([
			{ content: [use('i1', 'gamemaker.create_from_template')] },
			{ content: [say('Created.')] },
		]);
		await drive(runId, deps(model.transport, gate.launcher));
		check(
			'nothing is stored for the call yet',
			(await messages(runId, 'coordinator')).map((m) => m.role),
			['user', 'assistant'],
		);
		await drive(runId, deps(model.transport, gate.launcher));
		check(
			'the next claim sends the same opId again',
			new Set(gate.sent).size === 1 && gate.sent.length === 2,
			true,
		);
		check('…the op runs once and the turn goes on', [gate.effects.length, model.calls()], [1, 2]);
	}

	// ── 8. The wake trigger ───────────────────────────────────────────────────
	console.log('8. the trigger NOTIFYs director_wake for waking rows only');
	{
		const runId = await newRun();
		const heard: string[] = [];
		const listener = await sql.listen('director_wake', (payload) => heard.push(payload));
		await event(runId, 'worker', 'activity', { text: 'not a wake' });
		await event(runId, 'owner', 'owner_message', { text: 'wake' });
		await event(runId, 'atlas-artist', 'job_done', { jobRef: 'x' });
		await new Promise((r) => setTimeout(r, 300));
		await listener.unlisten();
		check('two NOTIFYs, each naming the run', heard, [runId, runId]);
	}
} finally {
	await sql`delete from director_spend where run_id like ${`${tag}-%`}`;
	await sql`delete from users where id = ${userId}`;
	await sql.end();
}

console.log(`\nturns: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
