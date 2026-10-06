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
 *     claim sends the same opId, so the op runs once;
 * 13. a run with no work (every agent idle, a stop waiting on a render, a checkpoint) is never
 *     claimed, so a live wake loop never spins on it;
 * 14. a catalog outage leaves a stored turn for a later claim instead of answering its calls;
 * 15. only an explicit approve or revise resolves a checkpoint;
 * 16. a pause queued behind a job_done still stops the turn's calls;
 * 17. a GPU budget stop wins over a checkpoint request in the same turn;
 * 18. an empty reply is stored as text, so the next request stays valid;
 * 19. a resume raises the cap within the Settings bounds, and only when it is allowed;
 * 20. a job_done that lands after the run ended is still billed;
 * 21. handling a billed job_done needs no second pool connection;
 * 22. a failure that persists pauses the run after MAX_FAILURES drives, retrying the same opId;
 *     settled while paused, the turn is answered from what the launcher recorded for each opId —
 *     a write that ran gets its result and is not issued again, one that never ran is "not run";
 * 23. tokens streamed before a failure are billed;
 * 24. a job_done that reports no usable GPU time writes no spend row, is logged, and a finished
 *     render among them is an `error` event the owner can see;
 * 25. the renders in flight (queued, or settled with a job_done not yet applied) count toward the
 *     cap, before a model call and before a GPU submit; before any is billed, pricing.json's seed
 *     stands in, so a run cannot submit without limit until its first render is billed;
 * 26. a render that reported GPU time with no GPU to price it by pauses the run before its next
 *     GPU submit, naming the env to set, until the owner resumes;
 * 27. jobs that ended without reporting a time are billed as an estimate, flagged as such.
 */
import type {
	BetaMessage,
	BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import Anthropic from '@anthropic-ai/sdk';
import postgres from 'postgres';
import { parsePricing, seedRenderUsd } from 'director-costs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentDefinition } from '../src/agents.ts';
import { driveRun, MAX_FAILURES, type DriverDeps } from '../src/driver.ts';
import type { AdapterResult, AdapterSpec, Launcher } from '../src/launcher.ts';
import { claimRun, deferLease } from '../src/lease.ts';
import { PartialResponse, toolName, type ModelTransport } from '../src/model.ts';
import type { ModelTransport as VisionTransport } from '../src/mockups/vision.ts';
import { pricingSource } from '../src/pricing.ts';
import { recordSpend, runSpend } from '../src/store.ts';
import { startWake } from '../src/wake.ts';

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

/** Scripted model: answers each call with the next reply, or with what a reply function makes of
 *  the request (as a model reacts to a tool result); counts and keeps every request. */
function fakeModel(replies: (Reply | ((request: BetaMessageStreamParams) => Reply))[]) {
	const requests: BetaMessageStreamParams[] = [];
	let n = 0;
	const transport: ModelTransport = {
		async send(request) {
			requests.push(structuredClone(request));
			const next = replies[n++];
			const reply = typeof next === 'function' ? next(request) : next;
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

/**
 * The launcher gate's idempotency, on the real `director_ops` table as the gate keeps it: a write's
 * opId runs once and is recorded `done` with its result; a repeat returns that result. `answer`
 * scripts a reply before the op runs (it does not run); `loseAnswer` lets the op run and record,
 * then loses the reply on the way back, as a dropped connection would.
 */
function fakeLauncher(
	answer?: (id: string, nth: number) => AdapterResult | null,
	catalogUp: () => boolean = () => true,
	loseAnswer: () => boolean = () => false,
) {
	const effects: string[] = [];
	const sent: string[] = [];
	const launcher: Launcher = {
		async catalog() {
			if (!catalogUp()) throw new Error('the launcher is unreachable');
			return new Map(SPECS.map((s) => [s.id, s]));
		},
		async call(id, body) {
			// None of these runs has mockups: the breakdown step reads the listing and leaves the
			// step to the coordinator (`prove:breakdown` covers the runs that have them).
			if (id === 'mockups.list') {
				return {
					status: 200,
					body: { fidelity: 'match', ownershipConfirmed: null, modelLongEdge: 1568, images: [] },
				};
			}
			sent.push(`${id}@${body.opId}`);
			const scripted = answer?.(id, sent.length);
			if (scripted) return scripted;
			const lost: AdapterResult = { status: 503, body: { error: 'unavailable' } };
			if (body.opId) {
				const [done] = await sql<{ result: unknown }[]>`
					select result from director_ops where op_id = ${body.opId} and status = 'done'`;
				if (done) return loseAnswer() ? lost : { status: 200, body: done.result };
			}
			effects.push(id);
			const result =
				id === 'atlas.queue_variants'
					? { jobRef: `job-${effects.length}` }
					: { ok: effects.length };
			if (body.opId) {
				await sql`insert into director_ops (op_id, run_id, agent, op, input_hash, status, result,
						completed_at)
					values (${body.opId}, ${body.runId}, ${body.agent}, ${id}, 'proof', 'done',
						${sql.json(result)}, now())`;
			}
			return loseAnswer() ? lost : { status: 200, body: result };
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
				'atlas.queue_variants',
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

/** Failed drives in a row, shared like a worker process shares it. */
const retries = new Map<string, number>();
/** No run here has mockups, so the analysis never calls the vision model. */
const noVision: VisionTransport = {
	analyze: async () => {
		throw new Error('the vision model was called, but no run here has mockups');
	},
};
const RETRY_BASE_MS = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Long enough for any deferral these scenarios cause to run out. */
const afterRetryDelay = () => sleep(RETRY_BASE_MS * 2 ** MAX_FAILURES + 50);

const deps = (
	transport: ModelTransport,
	launcher: Launcher,
	over: Partial<DriverDeps> = {},
): DriverDeps => ({
	sql,
	transport,
	vision: noVision,
	launcher,
	agents: AGENTS,
	pricing: async () => pricing,
	retries,
	leaseMs: 2_000,
	retryBaseMs: RETRY_BASE_MS,
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
		await drive(runId, deps(model.transport, gate.launcher, { afterAdapterCall: kill }));
		check('the first worker died after the write, before storing its result', killed, true);
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
		await drive(flaky, deps(retried.transport, fakeLauncher().launcher));
		check(
			'a 529 leaves the run running, with nothing stored',
			[(await runRow(flaky)).status, (await messages(flaky, 'coordinator')).length],
			['running', 1],
		);
		check(
			'…tells the owner a retry is coming',
			(await events(flaky, 'error'))[0]?.payload.type,
			'retrying',
		);
		check(
			'…and holds the run back meanwhile',
			await claimRun(sql, 'prover', { runId: flaky }),
			null,
		);
		await afterRetryDelay();
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
		await afterRetryDelay();
		await drive(runId, deps(model.transport, gate.launcher));
		check(
			'the next claim sends the same opId again',
			new Set(gate.sent).size === 1 && gate.sent.length === 2,
			true,
		);
		check('…the op runs once and the turn goes on', [gate.effects.length, model.calls()], [1, 2]);
	}

	// ── 13. Only runs with work are claimed ───────────────────────────────────
	console.log('13. a run with no work is never claimed, so the worker never spins on it');
	{
		const idle = await newRun({ step: 'regions' });
		await sql`insert into director_messages (run_id, agent, seq, role, content_json) values
			(${idle}, 'coordinator', 0, 'user', ${sql.json([{ type: 'text', text: 'Go.' }])}),
			(${idle}, 'coordinator', 1, 'assistant', ${sql.json([{ type: 'text', text: 'Waiting.' }])})`;
		const stopping = await newRun({ status: 'stopping', step: 'regions' });
		await sql`insert into director_atlas_jobs (job_ref, run_id, agent, atlas, regions, status)
			values (${`${stopping}-job`}, ${stopping}, 'atlas-artist', 'symbols', ${sql.json(['A'])}, 'queued')`;
		const waiting = await newRun({ status: 'waiting', waitingOn: 'breakdown' });
		for (const [name, id] of [
			['running, every agent idle', idle],
			['stopping, a render still queued', stopping],
			['waiting on the owner', waiting],
		]) {
			check(`not claimable: ${name}`, await claimRun(sql, 'prover', { runId: id }), null);
		}
		const driven: string[] = [];
		const wake = await startWake(
			sql,
			'prover-wake',
			async (claimed) => {
				driven.push(claimed.id);
				await deferLease(sql, claimed, 60_000);
			},
			50,
		);
		await sleep(400);
		await wake.stop();
		await wake.drain(1_000);
		check(
			'a live wake loop drives none of them',
			driven.filter((id) => [idle, stopping, waiting].includes(id)),
			[],
		);
		check('…and drives nothing twice', driven.length, new Set(driven).size);
	}

	// ── 14. The launcher unreachable mid-turn ─────────────────────────────────
	console.log('14. a catalog outage leaves a stored turn for later, never answered "not yours"');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		let up = true;
		const gate = fakeLauncher(undefined, () => up);
		const model = fakeModel([
			{ during: async () => (up = false), content: [use('c1', 'gamemaker.create_from_template')] },
			{ content: [say('Created.')] },
		]);
		await drive(runId, deps(model.transport, gate.launcher));
		check(
			'the turn is stored, its call unanswered',
			(await messages(runId, 'coordinator')).map((m) => m.role),
			['user', 'assistant'],
		);
		check('the run keeps running', (await runRow(runId)).status, 'running');
		up = true;
		await afterRetryDelay();
		await drive(runId, deps(model.transport, gate.launcher));
		const results = JSON.stringify((await messages(runId, 'coordinator'))[2]?.content);
		check('once the launcher is back the call runs', gate.effects, [
			'gamemaker.create_from_template',
		]);
		check(
			'…and is never answered "not one of your tools"',
			results.includes('not one of your tools'),
			false,
		);
	}

	// ── 15. Checkpoint decisions ──────────────────────────────────────────────
	console.log('15. only an explicit approve or revise resolves a checkpoint');
	{
		const runId = await newRun({ status: 'waiting', step: 'handoff', waitingOn: 'before_publish' });
		const model = fakeModel([]);
		await event(runId, 'owner', 'checkpoint_resolved', {
			checkpoint: 'before_publish',
			decision: 'reject',
		});
		await event(runId, 'owner', 'checkpoint_resolved', { checkpoint: 'before_publish' });
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		const row = await runRow(runId);
		check(
			'"reject" and a missing decision leave the run waiting',
			[row.status, row.waiting_on],
			['waiting', 'before_publish'],
		);
		check(
			'…each refused visibly',
			(await events(runId, 'error')).map((e) => e.payload.type),
			['refused_request', 'refused_request'],
		);
	}

	// ── 16. Pause queued behind another event ─────────────────────────────────
	console.log("16. a pause queued behind a job_done still stops the turn's calls");
	{
		const runId = await newRun({ step: 'regions' });
		await userMessage(runId, 'coordinator', 'Draw.');
		const gate = fakeLauncher();
		const model = fakeModel([
			{
				during: async () => {
					await event(
						runId,
						'atlas-artist',
						'job_done',
						{ jobRef: 'j0', status: 'finished' },
						'atlas.queue_variants',
					);
					await event(runId, 'owner', 'owner_request', { action: 'pause' });
				},
				content: [use('q1', 'atlas.queue_variants')],
			},
		]);
		await drive(runId, deps(model.transport, gate.launcher));
		check('the render was not queued', gate.sent, []);
		check('the run is paused', (await runRow(runId)).status, 'paused');
		check('the job_done was still handled', (await messages(runId, 'atlas-artist')).length, 1);
	}

	// ── 17. Budget stop and a checkpoint request in one turn ──────────────────
	console.log('17. a GPU budget stop wins over a checkpoint request in the same turn');
	{
		const runId = await newRun({ cap: 1, step: 'breakdown' });
		await userMessage(runId, 'coordinator', 'Go.');
		await recordSpend(sql, {
			runId,
			agent: 'atlas-artist',
			model: 'L40S (48 GB)',
			kind: 'runpod',
			requestId: `${runId}-job0`,
			usd: 0.5,
		});
		const gate = fakeLauncher();
		const model = fakeModel([
			{
				content: [
					use('g1', 'atlas.queue_variants'),
					use('g2', 'run.request_checkpoint', { kind: 'step_done', summary: 'Done.' }),
				],
			},
		]);
		await drive(runId, deps(model.transport, gate.launcher));
		const row = await runRow(runId);
		check('the run is paused, not waiting', [row.status, row.waiting_on], ['paused', null]);
		check(
			'only the budget checkpoint is open',
			(await events(runId, 'checkpoint_open')).map((e) => e.payload.checkpoint),
			['budget'],
		);
		check('the render was not queued', gate.sent, []);
	}

	// ── 18. An empty reply ────────────────────────────────────────────────────
	console.log('18. an empty reply is stored so the next request stays valid');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Anything to add?');
		const model = fakeModel([{ content: [] }, { content: [say('Noted.')] }]);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		await event(runId, 'owner', 'owner_message', { text: 'Carry on.' });
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check('the agent was asked again', model.calls(), 2);
		check(
			'no message in the next request is empty',
			model.requests[1].messages.every((m) => Array.isArray(m.content) && m.content.length > 0),
			true,
		);
	}

	// ── 19. Raising the cap ───────────────────────────────────────────────────
	console.log('19. a resume raises the cap within the Settings bounds');
	{
		const runId = await newRun({ status: 'paused', cap: 1 });
		await event(runId, 'owner', 'owner_request', { action: 'resume', budgetCapUsd: 1e9 });
		await drive(runId, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check('1e9 is clamped to $500', (await runRow(runId)).budget_cap_usd, 500);
		const refused = await newRun({ status: 'running', cap: 5 });
		await event(refused, 'owner', 'owner_request', { action: 'resume', budgetCapUsd: 50 });
		await drive(refused, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check('a refused resume leaves the cap alone', (await runRow(refused)).budget_cap_usd, 5);
	}

	// ── 20. A job that lands as the run ends ──────────────────────────────────
	console.log('20. a job_done that lands after the run ended is still billed');
	{
		const runId = await newRun({ status: 'stopped' });
		await event(
			runId,
			'atlas-artist',
			'job_done',
			{
				jobRef: `${runId}-late`,
				status: 'finished',
				result: { runpod: { gpu: 'L40S (48 GB)', seconds: 10 } },
			},
			'atlas.queue_variants',
		);
		await drive(runId, deps(fakeModel([]).transport, fakeLauncher().launcher));
		check(
			'billed once',
			(await spendRows(runId)).map((r) => r.request_id),
			[`runpod:${runId}-late`],
		);
		check('nothing is told to the ended run', (await messages(runId, 'atlas-artist')).length, 0);
	}

	// ── 21. One pool connection ───────────────────────────────────────────────
	console.log('21. handling a billed job_done needs no second connection');
	{
		const runId = await newRun({ step: 'regions' });
		await event(
			runId,
			'atlas-artist',
			'job_done',
			{
				jobRef: `${runId}-one`,
				status: 'finished',
				result: { runpod: { gpu: 'L40S (48 GB)', seconds: 10 } },
			},
			'atlas.queue_variants',
		);
		const single = postgres(url, { max: 1, onnotice: () => {} });
		const pricingFile = fileURLToPath(new URL('../pricing.json', import.meta.url));
		const claimed = await claimRun(single, 'prover-single', { runId, leaseMs: 2_000 });
		const finished = await Promise.race([
			driveRun(
				deps(
					fakeModel([{ content: [say('Seen.')] }, { content: [say('Noted.')] }]).transport,
					fakeLauncher().launcher,
					{
						sql: single,
						pricing: pricingSource(single, pricingFile),
					},
				),
				claimed!,
			).then(() => true),
			sleep(5_000).then(() => false),
		]);
		check('the drive finishes on a one-connection pool', finished, true);
		check('…and the job is billed', (await spendRows(runId)).length >= 1, true);
		await single.end({ timeout: 1 });
	}

	// ── 22. A failure that does not go away ───────────────────────────────────
	console.log(`22. ${MAX_FAILURES} failed drives in a row pause the run`);
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const gate = fakeLauncher(() => ({ status: 503, body: { error: 'disabled' } }));
		const model = fakeModel([{ content: [use('d1', 'gamemaker.create_from_template')] }]);
		for (let i = 0; i < MAX_FAILURES + 2 && (await runRow(runId)).status === 'running'; i++) {
			await drive(runId, deps(model.transport, gate.launcher));
			await afterRetryDelay();
		}
		check('the run is paused', (await runRow(runId)).status, 'paused');
		check(
			'with a retry notice per failure, then the reason',
			(await events(runId, 'error')).map((e) => e.payload.type),
			[...Array(MAX_FAILURES - 1).fill('retrying'), 'retries_exhausted'],
		);
		check('every attempt sent the same opId', new Set(gate.sent).size, 1);
		check('the model was asked once', model.calls(), 1);
	}
	console.log('22b. after that pause, a write that never ran is reported not run, and runs once');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		let outage = true;
		const gate = fakeLauncher(() => (outage ? { status: 503, body: { error: 'disabled' } } : null));
		const model = fakeModel([
			{ content: [use('n1', 'gamemaker.create_from_template')] },
			{ content: [use('n2', 'gamemaker.create_from_template')] },
			{ content: [say('Created.')] },
		]);
		for (let i = 0; i < MAX_FAILURES + 2 && (await runRow(runId)).status === 'running'; i++) {
			await drive(runId, deps(model.transport, gate.launcher));
			await afterRetryDelay();
		}
		outage = false;
		await event(runId, 'owner', 'owner_request', { action: 'resume' });
		await drive(runId, deps(model.transport, gate.launcher));
		const results = JSON.stringify((await messages(runId, 'coordinator'))[2]?.content);
		check('the call that never completed is reported not run', results.includes('Not run'), true);
		check('the model issued it again after resume, and it ran once', gate.effects, [
			'gamemaker.create_from_template',
		]);
	}
	console.log('22c. after that pause, a write that ran but whose answers were lost runs once');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		let lossy = true;
		const gate = fakeLauncher(undefined, undefined, () => lossy);
		const model = fakeModel([
			{ content: [use('l1', 'gamemaker.create_from_template')] },
			// As a model would: told the write did not run, it issues it again.
			(request) =>
				JSON.stringify(
					request.messages.slice(request.messages.findLastIndex((m) => m.role === 'assistant')),
				).includes('Not run')
					? { content: [use('l2', 'gamemaker.create_from_template')] }
					: { content: [say('Created.')] },
			{ content: [say('Created.')] },
		]);
		for (let i = 0; i < MAX_FAILURES + 2 && (await runRow(runId)).status === 'running'; i++) {
			await drive(runId, deps(model.transport, gate.launcher));
			await afterRetryDelay();
		}
		check(
			'the run paused with the op done but unconfirmed',
			[(await runRow(runId)).status, gate.effects.length],
			['paused', 1],
		);
		lossy = false;
		// An owner message is enough to settle the turn, before any resume.
		await event(runId, 'owner', 'owner_message', { text: 'What happened?' });
		await drive(runId, deps(model.transport, gate.launcher));
		const [answer] = ((await messages(runId, 'coordinator'))[2]?.content ?? []) as unknown as {
			content: string;
			is_error?: boolean;
		}[];
		check(
			"the turn is answered with the op's recorded result",
			[answer?.content, answer?.is_error ?? false],
			['{"ok":1}', false],
		);
		await event(runId, 'owner', 'owner_request', { action: 'resume' });
		await drive(runId, deps(model.transport, gate.launcher));
		check('after resume the op is not issued again: it ran once', gate.effects, [
			'gamemaker.create_from_template',
		]);
		check('the model went on from the result', model.calls(), 2);
	}

	// ── 23. A stream cut off partway ──────────────────────────────────────────
	console.log('23. tokens streamed before a failure are billed');
	{
		const runId = await newRun();
		await userMessage(runId, 'coordinator', 'Start.');
		const partial = {
			id: `msg_${runId}_partial`,
			type: 'message',
			role: 'assistant',
			model: 'claude-opus-5-5',
			content: [],
			stop_reason: null,
			stop_sequence: null,
			stop_details: null,
			usage: {
				input_tokens: 2000,
				output_tokens: 300,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		} as unknown as BetaMessage;
		const dropped = Anthropic.APIError.generate(529, undefined, 'overloaded', new Headers());
		const model = fakeModel([{ content: [], error: new PartialResponse(partial, dropped) }]);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check(
			'the partial response is billed under its id',
			(await spendRows(runId)).map((r) => [r.request_id, r.usd]),
			[[partial.id, (2000 * 4 + 300 * 20) / 1_000_000]],
		);
		check('the run waits for its retry', (await runRow(runId)).status, 'running');
	}

	// ── 24. A job_done with nothing to bill ───────────────────────────────────
	console.log('24. a job_done that reports no GPU time writes no row and says so');
	{
		const runId = await newRun({ step: 'regions' });
		const done = (jobRef: string, status: string, result: Record<string, unknown>) =>
			event(runId, 'atlas-artist', 'job_done', { jobRef, status, result }, 'atlas.queue_variants');
		await done(`${runId}-blind`, 'finished', { variants: [] });
		await done(`${runId}-nogpu`, 'finished', { runpod: { gpu: null, seconds: 42 } });
		await done(`${runId}-lost`, 'failed', { error: 'lost' });
		const logged: string[] = [];
		const write = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			logged.push(String(chunk));
			return write(chunk);
		}) as typeof process.stdout.write;
		try {
			await drive(
				runId,
				deps(
					fakeModel([{ content: [say('Seen.')] }, { content: [say('Noted.')] }]).transport,
					fakeLauncher().launcher,
				),
			);
		} finally {
			process.stdout.write = write;
		}
		check(
			'no RunPod row is written for any of them',
			(await spendRows(runId)).filter((r) => r.kind === 'runpod'),
			[],
		);
		check(
			'each is logged, with what was reported',
			logged
				.filter((l) => l.includes('GPU job not billed'))
				.map((l) => JSON.parse(l))
				.map((l) => [l.jobRef.replace(runId, 'run'), l.status, l.gpu, l.seconds]),
			[
				['run-blind', 'finished', null, null],
				['run-nogpu', 'finished', null, 42],
				['run-lost', 'failed', null, null],
			],
		);
		check(
			'the finished renders are error events the owner sees; the lost one is only logged',
			(await events(runId, 'error')).map((e) => [
				e.payload.type,
				String(e.payload.jobRef).replace(runId, 'run'),
				e.payload.seconds,
			]),
			[
				['unbilled_job', 'run-blind', null],
				['unbilled_job', 'run-nogpu', 42],
			],
		);
		check(
			'the agent still hears every job_done',
			(await messages(runId, 'atlas-artist')).map((m) => m.role),
			['user', 'user', 'user', 'assistant'],
		);
	}

	// ── 25. Queued GPU work counts toward the cap ─────────────────────────────
	console.log('25. renders queued and not yet billed count toward the cap');
	{
		const queue = (runId: string, jobRef: string) =>
			sql`insert into director_atlas_jobs (job_ref, run_id, agent, atlas, regions, status)
				values (${jobRef}, ${runId}, 'atlas-artist', 'symbols', ${sql.json(['H1'])}, 'queued')`;
		const billed = (runId: string, usd: number) =>
			recordSpend(sql, {
				runId,
				agent: 'atlas-artist',
				model: 'L40S (48 GB)',
				kind: 'runpod',
				requestId: `${runId}-job0`,
				usd,
			});

		// Before a model call: $0.50 spent on one render, two more in flight at that mean, cap $1.50.
		// The call alone (~$0.16) would fit; with the $1.00 still to land it does not.
		const runId = await newRun({ cap: 1.5, step: 'regions' });
		await userMessage(runId, 'coordinator', 'Go.');
		await billed(runId, 0.5);
		await queue(runId, `${runId}-q1`);
		await queue(runId, `${runId}-q2`);
		const model = fakeModel([{ content: [say('Going.')] }]);
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check(
			'no call is made while the renders in flight would carry the run past its cap',
			model.calls(),
			0,
		);
		const [budget] = await events(runId, 'checkpoint_open');
		check(
			'the budget checkpoint shows the renders in flight and what they project',
			[
				budget?.payload.before,
				budget?.payload.rendersInFlight,
				budget?.payload.queuedGpuUsd,
				budget?.payload.spentUsd,
			],
			['model_call', 2, 1, 0.5],
		);
		await sql`update director_atlas_jobs set status = 'finished', done_at = now() where run_id = ${runId}`;
		await event(runId, 'owner', 'owner_request', { action: 'resume' });
		await drive(runId, deps(model.transport, fakeLauncher().launcher));
		check('with nothing in flight, the same spend lets the call through', model.calls(), 1);

		// Before a GPU submit: $0.50 spent, two in flight, cap $2. The call fits ($0.50 + $1.00 +
		// ~$0.08); the submit — itself plus the two in flight, $1.50 — does not.
		const gpuRun = await newRun({ cap: 2, step: 'regions' });
		await userMessage(gpuRun, 'atlas-artist', 'Draw.');
		await billed(gpuRun, 0.5);
		await queue(gpuRun, `${gpuRun}-q1`);
		await queue(gpuRun, `${gpuRun}-q2`);
		const gpuModel = fakeModel([{ content: [use('q1', 'atlas.queue_variants')] }]);
		const gate = fakeLauncher();
		await drive(gpuRun, deps(gpuModel.transport, gate.launcher));
		check('the call went out, the submit did not', [gpuModel.calls(), gate.effects], [1, []]);
		const [stop] = await events(gpuRun, 'checkpoint_open');
		check(
			'the GPU budget checkpoint projects this render on top of the ones in flight',
			[
				stop?.payload.before,
				stop?.payload.rendersInFlight,
				stop?.payload.queuedGpuUsd,
				stop?.payload.projectedUsd,
			],
			['gpu_submit', 2, 1, 1.5],
		);

		// Before any render is billed the seed stands in: $0.60 of Claude spend, cap $1, no RunPod
		// row (so no mean). The call fits; the submit projects pricing.json's seed and does not.
		const seedRun = await newRun({ cap: 1, step: 'regions' });
		await userMessage(seedRun, 'atlas-artist', 'Draw.');
		await recordSpend(sql, {
			runId: seedRun,
			agent: 'coordinator',
			model: 'claude-opus-5-5',
			kind: 'claude',
			requestId: `${seedRun}-c`,
			usd: 0.6,
		});
		const seedModel = fakeModel([{ content: [use('q1', 'atlas.queue_variants')] }]);
		const seedGate = fakeLauncher();
		await drive(seedRun, deps(seedModel.transport, seedGate.launcher));
		const [seedStop] = await events(seedRun, 'checkpoint_open');
		check(
			'with no billed render to go by, a submit projects the seed and is not sent at the cap',
			[
				seedModel.calls(),
				seedGate.effects,
				seedStop?.payload.before,
				seedStop?.payload.rendersInFlight,
				seedStop?.payload.projectedUsd,
			],
			[1, [], 'gpu_submit', 0, seedRenderUsd(pricing)],
		);

		// A render the launcher settled whose job_done this worker has not applied is in flight too.
		const lateRun = await newRun({ step: 'regions' });
		await sql`insert into director_atlas_jobs (job_ref, run_id, agent, atlas, regions, status, done_at)
			values (${`${lateRun}-done`}, ${lateRun}, 'atlas-artist', 'symbols', ${sql.json(['H1'])},
				'finished', now())`;
		await event(
			lateRun,
			'atlas-artist',
			'job_done',
			{
				jobRef: `${lateRun}-done`,
				status: 'finished',
				result: { runpod: { gpu: 'L40S (48 GB)', seconds: 10 } },
			},
			'atlas.queue_variants',
		);
		check(
			'a render settled but not yet billed counts as in flight',
			(await runSpend(sql, lateRun)).rendersInFlight,
			1,
		);
		await drive(
			lateRun,
			deps(
				fakeModel([{ content: [say('Seen.')] }, { content: [say('Noted.')] }]).transport,
				fakeLauncher().launcher,
			),
		);
		check(
			'…and no longer once its job_done is applied and billed',
			[(await runSpend(sql, lateRun)).rendersInFlight, (await spendRows(lateRun)).length],
			[0, 3],
		);
	}

	// ── 26. No GPU to price by: submits blocked until the owner resumes ──────
	console.log('26. a render with no GPU to price by blocks GPU submits until the owner resumes');
	{
		const runId = await newRun({ step: 'regions' });
		await userMessage(runId, 'atlas-artist', 'Draw.');
		await event(
			runId,
			'atlas-artist',
			'job_done',
			{
				jobRef: `${runId}-blind`,
				status: 'finished',
				result: { runpod: { gpu: null, seconds: 42, jobs: 1, unreported: 0 } },
			},
			'atlas.queue_variants',
		);
		const model = fakeModel([
			{ content: [use('q1', 'atlas.queue_variants')] },
			{ content: [use('q2', 'atlas.queue_variants')] },
			{ content: [say('Queued.')] },
			{ content: [say('Noted.')] },
		]);
		const gate = fakeLauncher();
		await drive(runId, deps(model.transport, gate.launcher));
		check(
			'the submit is not sent and the run pauses',
			[gate.effects, (await runRow(runId)).status],
			[[], 'paused'],
		);
		const [opened] = await events(runId, 'checkpoint_open');
		check(
			'the owner is told what to set',
			[
				(await events(runId, 'error')).map((e) => e.payload.type),
				opened?.payload.reason,
				String(opened?.payload.message).includes('RUNPOD_ENDPOINT_GPU'),
			],
			[['unbilled_job', 'gpu_submit_blocked'], 'unpriced_gpu', true],
		);
		check(
			'nothing is billed by a guess',
			(await spendRows(runId)).filter((r) => r.kind === 'runpod'),
			[],
		);
		await event(runId, 'owner', 'owner_request', { action: 'resume' });
		await drive(runId, deps(model.transport, gate.launcher));
		check('after the owner resumes, the next submit goes out', gate.effects, [
			'atlas.queue_variants',
		]);
	}

	// ── 27. Jobs that ended without a time are billed as an estimate ─────────
	console.log('27. unreported jobs are billed as an estimate, flagged');
	{
		const runId = await newRun({ step: 'regions' });
		const rate = pricing.runpod.perSecondByGpu['L40S (48 GB)'];
		const done = (jobRef: string, status: string, runpod: Record<string, unknown>) =>
			event(
				runId,
				'atlas-artist',
				'job_done',
				{ jobRef, status, result: { runpod } },
				'atlas.queue_variants',
			);
		await done(`${runId}-part`, 'finished', {
			gpu: 'L40S (48 GB)',
			seconds: 100,
			jobs: 4,
			unreported: 2,
		});
		await done(`${runId}-lost`, 'failed', {
			gpu: 'L40S (48 GB)',
			seconds: 0,
			jobs: 0,
			unreported: 3,
		});
		await drive(
			runId,
			deps(
				fakeModel([{ content: [say('Seen.')] }, { content: [say('Noted.')] }]).transport,
				fakeLauncher().launcher,
			),
		);
		const rows = (await spendRows(runId))
			.filter((r) => r.kind === 'runpod')
			.map((r) => [r.request_id.replace(runId, 'run'), r.usd])
			.sort();
		check(
			"the reported time is billed, and the unreported jobs at the render's mean per job, or at the seed when none reported",
			rows,
			[
				['runpod:run-lost:unreported', 3 * pricing.runpod.seedSecondsPerRender * rate],
				['runpod:run-part', 100 * rate],
				['runpod:run-part:unreported', 50 * rate],
			],
		);
		check(
			'the estimates are flagged on their spend events and explained to the owner',
			[
				(await events(runId, 'spend'))
					.filter((e) => e.payload.estimated)
					.map((e) => e.payload.unreported),
				(await events(runId, 'error')).map((e) => [e.payload.type, e.payload.seconds]),
			],
			[
				[2, 3],
				[
					['estimated_gpu_time', 50],
					['estimated_gpu_time', 1800],
				],
			],
		);
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
