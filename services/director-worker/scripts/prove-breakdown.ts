/**
 * Proof that the breakdown step is the worker's (ADR-0005 "Conflict handling", ADR-0003), against a
 * REAL Postgres, with a fake vision model, a fake turn model and a fake launcher — no API call is
 * ever made:
 *
 *   createdb director_proof
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter launcher-api db:migrate
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter director-worker prove:breakdown
 *
 * The run tables' behaviour is the thing under test — the lease-checked submission that opens the
 * checkpoint once, the `director_ops` idempotency of the crops, the spend rows — so an in-memory
 * fake would prove nothing. Every scenario uses its own run ids and the script removes its rows at
 * the end, so it shares a scratch database with `prove:lease` and `prove:turns`.
 *
 * Proved:
 *  1. a started run with mockups gets its breakdown from the worker before any agent turn: the
 *     `breakdown` checkpoint opens exactly once, with the code rules' output — a buy control the
 *     model called `left_out` on a template that CAN buy is `matched`, a `left_out` no rule confirms
 *     is `needs_you` — every vision call is billed once, the crops are saved in the worker's name
 *     under the pass's opId, and the coordinator is told; waking the waiting run again makes no
 *     call and stores nothing; the owner's approval moves the run on and the coordinator plans from
 *     the report;
 *  2. a run whose mockups' ownership is unconfirmed pauses before any model call, having read only
 *     the listing; the owner's confirmation plus a resume runs the step;
 *  3. a pass killed after the crops were saved and before the submission leaves the run where it
 *     was (no checkpoint, no report); the next claim runs a NEW pass — a new crops opId, since the
 *     answers may differ — and stores the breakdown once;
 *  4. the coordinator can neither open the breakdown checkpoint nor assign the analyst on a run
 *     with mockups: both are refused and the checkpoint still opens with the rules' output; on a
 *     run without mockups its style-board checkpoint opens as before and no vision call is made;
 *  5. the cap pauses the step before a vision call, and a raised cap resumes it;
 *  6. an owner's pause pressed between two images stops the step before the next call; the resume
 *     runs it again;
 *  7. a revise re-runs the step with the owner's note in the image prompt (never in the cached
 *     system block) and opens the checkpoint a second time, once, as attempt 2;
 *  8. an API error a retry cannot fix (413) and an answer off the schema each pause the run at
 *     once, billed, without re-running the pass; the resume runs it again;
 *  9. an owner's pause pressed during the LAST image applies before the submission; the resume
 *     rebuilds the breakdown from the stored answers — no image re-asked — and submits it.
 *
 * Every answer is stored as it arrives (`breakdown_image` rows), so 3, 6, 8 and 9 all show a
 * stopped pass asking again only for the images it lacks.
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
import { loadAgents, pricedModels, type AgentDefinition } from '../src/agents.ts';
import { driveRun, type DriverDeps } from '../src/driver.ts';
import type { AdapterResult, AdapterSpec, Launcher } from '../src/launcher.ts';
import { claimRun } from '../src/lease.ts';
import type { Breakdown } from '../src/mockups/analyze.ts';
import type { AnalystOutput } from '../src/mockups/schema.ts';
import {
	readAnswerText,
	summarizeUsage,
	VisionError,
	type VisionRequest,
	type VisionTransport,
} from '../src/mockups/vision.ts';
import { toolName, type ModelTransport } from '../src/model.ts';
import { recordSpend } from '../src/store.ts';
import { KNOWN_TOOLS } from '../src/tools.ts';

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
const EVAL = root('../../docs/director/eval/mockups/');
const pricing = parsePricing(JSON.parse(readFileSync(root('pricing.json'), 'utf8')));

// ── The reference set (docs/director/eval/mockups) ───────────────────────────

interface Reference {
	template: {
		key: string;
		name: string;
		gameTypeName: string;
		lockedItems: {
			id: string;
			label: string;
			detail: string;
			facts?: { betModes: { id: string; buyBonus: boolean }[] };
		}[];
	};
	regions: unknown;
	fidelity: 'match' | 'start';
	ownershipConfirmed: { by: { uid: string; name: string }; at: string } | null;
	images: {
		id: string;
		file: string;
		mediaType: 'image/png' | 'image/jpeg';
		w: number;
		h: number;
		tag: string;
		styleOnly: boolean;
		dominantColors: { hex: string; share: number }[];
	}[];
	answers: Record<string, AnalystOutput>;
}
const reference = JSON.parse(readFileSync(`${EVAL}reference.json`, 'utf8')) as Reference;
const fileBytes = new Map(
	reference.images.map((img) => [img.id, readFileSync(`${EVAL}${img.file}`)]),
);
const BASE = reference.images[0].id;

/** The reference template, but its bet modes CAN buy (scatter.json's shape: a mode named `bonus`). */
const buyTemplate = structuredClone(reference.template);
{
	const betModes = buyTemplate.lockedItems.find((l) => l.id === 'bet_modes')!;
	betModes.detail = 'base, bonus (buy)';
	betModes.facts = {
		betModes: [
			{ id: 'base', buyBonus: false },
			{ id: 'bonus', buyBonus: true },
		],
	};
}

/**
 * The canned base-game answer, but the model leaves the buy button OUT naming Bet modes, and ties
 * the gamble button (which no rule is about) to Bet modes too.
 */
const wrongBuy = structuredClone(reference.answers[BASE]);
{
	const buy = wrongBuy.elements.find((e) => e.name === 'Buy bonus button')!;
	buy.status = 'left_out';
	buy.lockedItem = 'bet_modes';
	buy.reason = 'The math has no buy feature.';
	wrongBuy.elements.find((e) => e.name === 'Gamble button')!.lockedItem = 'bet_modes';
}

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface VisionOptions {
	answers?: Partial<Record<string, AnalystOutput>>;
	/** Runs while the n-th call (1-based) is in flight — e.g. the owner pressing Pause. */
	during?: (n: number) => Promise<unknown> | void;
	/** The n-th call (1-based) fails with this instead of answering. */
	fail?: (n: number, id: string) => unknown;
}

/** The analyst's model: answers each image from `reference.json`, counts and keeps every request. */
function fakeVision(options: VisionOptions = {}) {
	const requests: VisionRequest[] = [];
	const ids: string[] = [];
	const transport: VisionTransport = {
		async analyze(request) {
			requests.push(request);
			const n = requests.length;
			const img = reference.images.find(
				(i) => fileBytes.get(i.id)!.toString('base64') === request.image.base64,
			);
			if (!img) throw new Error('proof: the vision model got an image it does not know');
			await options.during?.(n);
			const id = `vmsg_${tag}_${Math.random().toString(36).slice(2)}`;
			const failure = options.fail?.(n, id);
			if (failure) throw failure;
			const output = readAnswerText(
				JSON.stringify(options.answers?.[img.id] ?? reference.answers[img.id]),
			);
			const usage = {
				input_tokens: 1500,
				output_tokens: 600,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			};
			ids.push(id);
			return { id, model: request.model, usage, usageSummary: summarizeUsage(usage), output };
		},
	};
	return { transport, requests, ids, calls: () => requests.length };
}

type Reply = { content: BetaMessage['content'] };

/** The coordinator's model: scripted replies; throws when asked more than scripted. */
function fakeTurnModel(replies: Reply[] = []) {
	const requests: BetaMessageStreamParams[] = [];
	const transport: ModelTransport = {
		async send(request) {
			requests.push(structuredClone(request));
			const reply = replies[requests.length - 1];
			if (!reply) {
				throw new Error(
					`the turn model was called ${requests.length} time(s); only ${replies.length} expected`,
				);
			}
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

interface GateCall {
	id: string;
	agent: string;
	opId?: string;
}

interface GateOptions {
	template?: Reference['template'];
	/** The listing's ownership check, read on each call so a scenario can flip it. */
	ownership?: () => Reference['ownershipConfirmed'];
	/** The listing's images; `[]` = a run without mockups. */
	images?: () => Reference['images'];
	/** Runs after a `save_crops` recorded its result — a worker dying there. */
	afterSave?: () => Promise<unknown> | void;
}

/**
 * The launcher's mockup, template and region adapters over the reference set, with the gate's
 * idempotency for the one write (`save_crops`) on the real `director_ops` table: an opId runs once
 * and is recorded `done` with its result; a repeat returns that result.
 */
function fakeLauncher(options: GateOptions = {}) {
	const calls: GateCall[] = [];
	const effects: string[] = [];
	const ok = (body: unknown): AdapterResult => ({ status: 200, body });
	const launcher: Launcher = {
		async catalog() {
			return new Map<string, AdapterSpec>();
		},
		async call(id, body) {
			calls.push({ id, agent: body.agent, opId: body.opId });
			const images = options.images?.() ?? reference.images;
			switch (id) {
				case 'mockups.list':
					return ok({
						fidelity: reference.fidelity,
						ownershipConfirmed: options.ownership
							? options.ownership()
							: reference.ownershipConfirmed,
						modelLongEdge: 1568,
						images: images.map(({ dominantColors: _d, ...img }) => img),
					});
				case 'mockups.get_image': {
					const img = images.find((i) => i.id === (body.input as { id: string }).id)!;
					return ok({
						id: img.id,
						mediaType: img.mediaType,
						base64: fileBytes.get(img.id)!.toString('base64'),
						w: img.w,
						h: img.h,
						scale: 1,
						dominantColors: img.dominantColors,
					});
				}
				case 'gamemaker.get_template':
					return ok(options.template ?? reference.template);
				case 'atlas.list_regions':
					return ok(reference.regions);
				case 'mockups.save_crops': {
					if (!body.opId) return { status: 400, body: { error: 'bad_op_id' } };
					const [done] = await sql<{ result: unknown }[]>`
						select result from director_ops where op_id = ${body.opId} and status = 'done'`;
					if (done) return ok(done.result);
					const crops = (body.input as { crops: { region: string; imageId: string }[] }).crops;
					const result = {
						saved: crops.map((c) => ({
							region: c.region,
							imageId: c.imageId,
							key: `acme/sunken_temple/director/crops/${body.runId}/${c.region}.png`,
						})),
						skipped: [],
					};
					effects.push(body.opId);
					await sql`insert into director_ops (op_id, run_id, agent, op, input_hash, status, result,
							completed_at)
						values (${body.opId}, ${body.runId}, ${body.agent}, ${id}, 'proof', 'done',
							${sql.json(result)}, now())`;
					await options.afterSave?.();
					return ok(result);
				}
				default:
					return { status: 404, body: { error: 'unknown_op', message: `No adapter ${id}.` } };
			}
		},
	};
	return { launcher, calls, effects };
}

// ── Agents: a scripted coordinator and the REAL mockup analyst definition ────

const real = loadAgents(root('agents'), {
	models: pricedModels(root('pricing.json')),
	tools: KNOWN_TOOLS,
});
const coordinator: AgentDefinition = {
	name: 'coordinator',
	model: 'claude-opus-5-5',
	effort: 'medium',
	role: 'coordinator',
	tools: ['run.post_activity', 'run.request_checkpoint', 'run.assign_task'],
	inputs: '',
	outputs: '',
	systemPrompt: 'You are the coordinator.',
};
const AGENTS = new Map<string, AgentDefinition>([
	['coordinator', coordinator],
	['mockup-analyst', real.get('mockup-analyst')!],
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

const tag = `breakdown-proof-${Date.now()}`;
const userId = `${tag}-owner`;
let runSeq = 0;

async function newRun(over: { status?: string; step?: string; cap?: number } = {}) {
	const id = `${tag}-run-${++runSeq}`;
	await sql`insert into director_runs (id, project_key, template_project_key, owner_user_id, status,
			step, budget_cap_usd)
		values (${id}, ${`${id}-p`}, ${reference.template.key}, ${userId}, ${over.status ?? 'draft'},
			${over.step ?? 'breakdown'}, ${over.cap ?? 25})`;
	return id;
}
const event = (runId: string, agent: string, kind: string, payload: Record<string, unknown>) =>
	sql`insert into director_events (run_id, agent, kind, payload_json)
		values (${runId}, ${agent}, ${kind}, ${sql.json(payload as never)})`;
const start = (runId: string) => event(runId, 'owner', 'owner_request', { action: 'start' });
const resume = (runId: string, budgetCapUsd?: number) =>
	event(runId, 'owner', 'owner_request', {
		action: 'resume',
		...(budgetCapUsd === undefined ? {} : { budgetCapUsd }),
	});

const retries = new Map<string, number>();
const deps = (
	turns: ModelTransport,
	vision: VisionTransport,
	launcher: Launcher,
	over: Partial<DriverDeps> = {},
): DriverDeps => ({
	sql,
	transport: turns,
	vision,
	launcher,
	agents: AGENTS,
	pricing: async () => pricing,
	retries,
	leaseMs: 2_000,
	retryBaseMs: 20,
	...over,
});

/** Claim `runId` as a fresh worker would and drive it once; false when nothing was claimable. */
async function drive(runId: string, d: DriverDeps) {
	const claimed = await claimRun(sql, `prover-${Math.random()}`, { runId, leaseMs: 2_000 });
	if (claimed) await driveRun(d, claimed);
	return claimed !== null;
}
/** A failed drive defers the lease; let the retry delay run out. */
const expireLease = (runId: string) =>
	sql`update director_runs set lease_until = now() - interval '1 second'
		where id = ${runId} and lease_holder is not null`;

const runRow = async (id: string) =>
	(
		await sql<{ status: string; step: string; waiting_on: string | null }[]>`
		select status, step, waiting_on from director_runs where id = ${id}`
	)[0];
const events = async (id: string, kind: string) =>
	sql<{ agent: string; payload: Record<string, unknown> }[]>`
		select agent, payload_json as payload from director_events
		where run_id = ${id} and kind = ${kind} order by id`;
const breakdownOpens = async (id: string) =>
	(await events(id, 'checkpoint_open')).filter((e) => e.payload.checkpoint === 'breakdown');
/** The feed without the per-image answer rows, which `storedAnswers` counts. */
const activityTypes = async (id: string) =>
	(await events(id, 'activity'))
		.map((e) => e.payload.type ?? e.payload.message)
		.filter((t) => t !== 'breakdown_image');
const storedAnswers = async (id: string) =>
	(await events(id, 'activity')).filter((e) => e.payload.type === 'breakdown_image').length;
const messages = async (id: string, agent: string) =>
	sql<{ role: string; content: { type: string; text?: string; content?: string }[] }[]>`
		select role, content_json as content from director_messages
		where run_id = ${id} and agent = ${agent} order by seq`;
const spendRows = async (id: string) =>
	sql<{ agent: string; kind: string; request_id: string; usd: number }[]>`
		select agent, kind, request_id, usd from director_spend where run_id = ${id} order by at`;
const texts = (rows: { content: { type: string; text?: string }[] }[]) =>
	rows.flatMap((m) => m.content.filter((b) => b.type === 'text').map((b) => b.text ?? ''));
const elementsOf = (b: Breakdown, file: string) => b.images.find((i) => i.file === file)!.elements;
const byName = (b: Breakdown, name: string) =>
	elementsOf(b, 'base-game.png').find((e) => e.name === name)!;

await sql`insert into users (id, email, name) values (${userId}, ${`${tag}@example.invalid`}, 'breakdown proof')`;

try {
	// ── 1. The worker's breakdown, once, with the rules' output ───────────────
	console.log('1. a started run with mockups gets the worker’s breakdown, once');
	{
		const runId = await newRun();
		const vision = fakeVision({ answers: { [BASE]: wrongBuy } });
		const turns = fakeTurnModel([
			{ content: [say('Planning the style pack from the breakdown.')] },
		]);
		const gate = fakeLauncher({ template: buyTemplate });
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));

		const row = await runRow(runId);
		check(
			'the run waits on the breakdown checkpoint',
			[row.status, row.waiting_on],
			['waiting', 'breakdown'],
		);
		const opens = await breakdownOpens(runId);
		check('the breakdown checkpoint opened exactly once', opens.length, 1);
		check(
			'…as attempt 1, by the analyst',
			[opens[0]?.payload.attempt, opens[0]?.agent],
			[1, 'mockup-analyst'],
		);
		const breakdown = opens[0]?.payload.breakdown as Breakdown;
		const buy = byName(breakdown, 'Buy bonus button');
		check(
			'a buy control the model called left_out on a template that can buy is matched',
			[buy.status, buy.regions, buy.lockedItem],
			['matched', ['BetPanel'], null],
		);
		const gamble = byName(breakdown, 'Gamble button');
		check(
			'a left_out no rule about the element can judge is needs_you, although the model named the same bet modes',
			[gamble.status, gamble.lockedItem],
			['needs_you', null],
		);
		check(
			'a matched control the model tied to bet modes that no rule is about is the owner’s call',
			[byName(breakdown, 'Shop').status, byName(breakdown, 'Shop').lockedItem],
			['needs_you', null],
		);
		check(
			'nothing is left out on that template',
			breakdown.images.flatMap((i) => i.elements).filter((e) => e.status === 'left_out').length,
			0,
		);
		check(
			'one vision call per non-style image, no agent turn',
			[vision.calls(), turns.calls()],
			[2, 0],
		);

		const spend = await spendRows(runId);
		check(
			'every vision call is billed once, as the analyst',
			spend.map((r) => [r.agent, r.kind, r.request_id]).sort(),
			vision.ids.map((id) => ['mockup-analyst', 'claude', id]).sort(),
		);
		check('…with a spend event each', (await events(runId, 'spend')).length, 2);
		check('the activity feed shows the pass and the result', await activityTypes(runId), [
			'breakdown_pass',
			'Mockup breakdown ready',
		]);
		check('…and holds one stored answer per image analysed', await storedAnswers(runId), 2);
		const saves = gate.calls.filter((c) => c.id === 'mockups.save_crops');
		check(
			'the crops are saved once, in the worker’s name, under the pass’s opId',
			saves.map((c) => [c.agent, c.opId]),
			[['worker', `${runId}:breakdown_crops:1`]],
		);
		check(
			'every read is made in the analyst’s name',
			gate.calls
				.filter((c) => c.id !== 'mockups.save_crops')
				.every((c) => c.agent === 'mockup-analyst'),
			true,
		);
		const coordinatorMessages = await messages(runId, 'coordinator');
		check(
			'the coordinator holds the brief and the report, unread',
			coordinatorMessages.map((m) => m.role),
			['user', 'user'],
		);
		check(
			'…and the report is the worker’s, with the figures',
			/The worker produced the mockup breakdown: 21 of 23 template regions matched/.test(
				texts(coordinatorMessages)[1],
			),
			true,
		);

		check(
			'waking the waiting run again claims nothing',
			await drive(runId, deps(turns.transport, vision.transport, gate.launcher)),
			false,
		);
		check(
			'…no call, no second checkpoint',
			[vision.calls(), (await breakdownOpens(runId)).length],
			[2, 1],
		);

		await event(runId, 'owner', 'checkpoint_resolved', {
			checkpoint: 'breakdown',
			decision: 'approve',
		});
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		const after = await runRow(runId);
		check(
			'the approval moves the run on and the coordinator takes its turn',
			[after.status, after.step, turns.calls()],
			['running', 'style_pack', 1],
		);
		check(
			'…planning from the report',
			JSON.stringify(turns.requests[0].messages).includes(
				'The worker produced the mockup breakdown',
			),
			true,
		);
		check(
			'the analysis did not run again',
			[vision.calls(), (await breakdownOpens(runId)).length],
			[2, 1],
		);
	}

	// ── 2. Ownership ──────────────────────────────────────────────────────────
	console.log('2. unconfirmed ownership never reaches the model');
	{
		const runId = await newRun();
		let confirmed: Reference['ownershipConfirmed'] = null;
		const vision = fakeVision();
		const turns = fakeTurnModel();
		const gate = fakeLauncher({ template: buyTemplate, ownership: () => confirmed });
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check('the run is paused', (await runRow(runId)).status, 'paused');
		const [error] = await events(runId, 'error');
		check(
			'…with the ownership refusal for the owner',
			[
				error?.payload.type,
				/Confirm that these designs belong to us/.test(String(error?.payload.message)),
			],
			['ownership_unconfirmed', true],
		);
		check('no model call of either kind', [vision.calls(), turns.calls()], [0, 0]);
		check(
			'the launcher was asked for the listing only',
			[...new Set(gate.calls.map((c) => c.id))],
			['mockups.list'],
		);
		check('no checkpoint opened', (await breakdownOpens(runId)).length, 0);

		confirmed = reference.ownershipConfirmed;
		await resume(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'confirmed and resumed, the step runs',
			[(await runRow(runId)).waiting_on, vision.calls(), (await breakdownOpens(runId)).length],
			['breakdown', 2, 1],
		);
	}

	// ── 3. Kill after the crops, before the submission ────────────────────────
	console.log('3. a pass killed before its submission is run again, stored once');
	{
		const runId = await newRun();
		let killed = false;
		const vision = fakeVision({ answers: { [BASE]: wrongBuy } });
		const turns = fakeTurnModel();
		const gate = fakeLauncher({
			template: buyTemplate,
			afterSave: () => {
				if (!killed) {
					killed = true;
					throw new Error('killed');
				}
			},
		});
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check('the first worker died after the crops were saved', killed, true);
		const row = await runRow(runId);
		check(
			'the run is where it was: running in breakdown',
			[row.status, row.step],
			['running', 'breakdown'],
		);
		check(
			'no checkpoint, no report',
			[(await breakdownOpens(runId)).length, (await messages(runId, 'coordinator')).length],
			[0, 1],
		);
		check('a retry is announced', (await events(runId, 'error'))[0]?.payload.type, 'retrying');
		check('one pass started', await activityTypes(runId), ['breakdown_pass']);
		check('…whose two answers are stored', await storedAnswers(runId), 2);

		await expireLease(runId);
		check(
			'a second worker claims the run',
			await drive(runId, deps(turns.transport, vision.transport, gate.launcher)),
			true,
		);
		check('the checkpoint opened once', (await breakdownOpens(runId)).length, 1);
		check(
			'the second pass saved its crops under a NEW opId (its answers may differ)',
			gate.effects.map((o) => o.slice(runId.length)),
			[':breakdown_crops:1', ':breakdown_crops:2'],
		);
		check('the feed shows two passes and one result', await activityTypes(runId), [
			'breakdown_pass',
			'breakdown_pass',
			'Mockup breakdown ready',
		]);
		check('the coordinator got one report', (await messages(runId, 'coordinator')).length, 2);
		check(
			'the second pass reused both stored answers: no new call, no new spend',
			[vision.calls(), (await spendRows(runId)).length],
			[2, 2],
		);
	}

	// ── 4. The coordinator cannot bypass the worker ───────────────────────────
	console.log('4. the coordinator cannot open the breakdown checkpoint or assign the analyst');
	{
		const runId = await newRun({ status: 'running' });
		await sql`insert into director_messages (run_id, agent, seq, role, content_json) values
			(${runId}, 'coordinator', 0, 'user', ${sql.json([say('Start.')])}),
			(${runId}, 'coordinator', 1, 'assistant', ${sql.json([
				say('Submitting my own breakdown.'),
				use('c1', 'run.request_checkpoint', {
					kind: 'step_done',
					summary: 'My own breakdown: BUY matched.',
				}),
				use('a1', 'run.assign_task', { agent: 'mockup-analyst', task: 'Analyse the mockups.' }),
			] as never)})`;
		const vision = fakeVision({ answers: { [BASE]: wrongBuy } });
		const turns = fakeTurnModel();
		const gate = fakeLauncher({ template: buyTemplate });
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		const results = (await messages(runId, 'coordinator'))[2];
		check(
			'both calls are refused',
			results?.content.map((b) => [b.type, String(b.content).startsWith('Refused:')]),
			[
				['tool_result', true],
				['tool_result', true],
			],
		);
		const opens = await breakdownOpens(runId);
		check(
			'the checkpoint still opened once, with the worker’s breakdown',
			[opens.length, opens[0]?.payload.summary, typeof opens[0]?.payload.breakdown],
			[1, undefined, 'object'],
		);
		check(
			'…holding the rules’ verdict, not the coordinator’s',
			byName(opens[0]!.payload.breakdown as Breakdown, 'Buy bonus button').status,
			'matched',
		);
		check('two vision calls, no turn', [vision.calls(), turns.calls()], [2, 0]);

		const styleRun = await newRun();
		const noMockups = fakeLauncher({ images: () => [] });
		const board = fakeTurnModel([
			{
				content: [
					use('c1', 'run.request_checkpoint', { kind: 'step_done', summary: 'Style board ready.' }),
				],
			},
		]);
		const idle = fakeVision();
		await start(styleRun);
		await drive(styleRun, deps(board.transport, idle.transport, noMockups.launcher));
		const [open] = await breakdownOpens(styleRun);
		check(
			'without mockups the coordinator’s style board opens the checkpoint as before',
			[(await runRow(styleRun)).waiting_on, open?.payload.summary, open?.payload.breakdown],
			['breakdown', 'Style board ready.', undefined],
		);
		check('…with no vision call', idle.calls(), 0);
	}

	// ── 5. The cap ────────────────────────────────────────────────────────────
	console.log('5. the cap pauses the step before a vision call');
	{
		const runId = await newRun({ cap: 1 });
		await recordSpend(sql, {
			runId,
			agent: 'coordinator',
			model: 'claude-opus-5-5',
			kind: 'claude',
			requestId: `${runId}-earlier`,
			usd: 0.95,
		});
		const vision = fakeVision();
		const turns = fakeTurnModel();
		const gate = fakeLauncher({ template: buyTemplate });
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'the run is paused before the first call',
			[(await runRow(runId)).status, vision.calls()],
			['paused', 0],
		);
		const [budget] = await events(runId, 'checkpoint_open');
		check(
			'…with a budget checkpoint naming the analyst’s model call',
			[budget?.payload.checkpoint, budget?.payload.agent, budget?.payload.before],
			['budget', 'mockup-analyst', 'model_call'],
		);
		await resume(runId, 10);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'a raised cap runs the step',
			[(await runRow(runId)).waiting_on, vision.calls(), (await breakdownOpens(runId)).length],
			['breakdown', 2, 1],
		);
	}

	// ── 6. Pause between images ───────────────────────────────────────────────
	console.log('6. an owner’s pause between two images stops the step');
	{
		const runId = await newRun();
		const vision = fakeVision({
			during: (n) =>
				n === 1 ? event(runId, 'owner', 'owner_request', { action: 'pause' }) : undefined,
		});
		const turns = fakeTurnModel();
		const gate = fakeLauncher({ template: buyTemplate });
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'the pause applied before the second call',
			[(await runRow(runId)).status, vision.calls()],
			['paused', 1],
		);
		check('no checkpoint opened', (await breakdownOpens(runId)).length, 0);
		check('the one answer is still billed', (await spendRows(runId)).length, 1);
		await resume(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'the resume asks only for the image that was missing, and opens the checkpoint once',
			[(await runRow(runId)).waiting_on, vision.calls(), (await breakdownOpens(runId)).length],
			['breakdown', 2, 1],
		);
	}

	// ── 7. Revise ─────────────────────────────────────────────────────────────
	console.log('7. a revise re-runs the step with the owner’s note');
	{
		const runId = await newRun();
		const vision = fakeVision();
		const turns = fakeTurnModel();
		const gate = fakeLauncher({ template: buyTemplate });
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		const note = 'The fish swarm is a symbol, not decoration.';
		await event(runId, 'owner', 'checkpoint_resolved', {
			checkpoint: 'breakdown',
			decision: 'revise',
			note,
		});
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		const opens = await breakdownOpens(runId);
		check(
			'the checkpoint opened a second time, once, as attempt 2',
			opens.map((o) => o.payload.attempt),
			[1, 2],
		);
		check('the run waits on it', (await runRow(runId)).waiting_on, 'breakdown');
		check(
			'the owner’s note is in the second pass’s image prompts',
			vision.requests.slice(2).map((r) => r.prompt.includes(`- ${note}`)),
			[true, true],
		);
		check(
			'…and never in the cached system block',
			vision.requests.some((r) => r.system.includes(note)),
			false,
		);
		check('each pass saved its crops under its own opId', gate.effects.length, 2);
		check(
			'the coordinator holds the brief, the first report, the revise and the second report',
			texts(await messages(runId, 'coordinator')).map((t) => t.split(/[:.]/)[0]),
			[
				'A new Invisible Director run',
				'The worker produced the mockup breakdown',
				'The owner asked for revisions at the breakdown checkpoint',
				"The worker produced the mockup breakdown (attempt 2, after the owner's notes)",
			],
		);
		check('no agent turn in all of it', turns.calls(), 0);
	}

	// ── 8. Permanent errors pause once ────────────────────────────────────────
	console.log('8. a permanent API error or a bad answer pauses the run once, billed');
	{
		const runId = await newRun();
		const tooLarge = Anthropic.APIError.generate(
			413,
			undefined,
			'request too large',
			new Headers(),
		);
		const vision = fakeVision({ fail: (n) => (n === 2 ? tooLarge : undefined) });
		const turns = fakeTurnModel();
		const gate = fakeLauncher({ template: buyTemplate });
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check('a 413 on the second image pauses the run', (await runRow(runId)).status, 'paused');
		const [error] = await events(runId, 'error');
		check(
			'…with the status shown',
			[error?.payload.type, error?.payload.status],
			['api_error', 413],
		);
		check(
			'…the first answer billed, no checkpoint',
			[(await spendRows(runId)).length, (await breakdownOpens(runId)).length],
			[1, 0],
		);
		check(
			'…and no retry: two calls, one pass',
			[vision.calls(), await activityTypes(runId)],
			[2, ['breakdown_pass']],
		);
		check(
			'a paused run is not claimed again',
			await drive(runId, deps(turns.transport, vision.transport, gate.launcher)),
			false,
		);
		await resume(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'the resume asks only for the image that failed',
			[(await runRow(runId)).waiting_on, vision.calls(), (await breakdownOpens(runId)).length],
			['breakdown', 3, 1],
		);

		const badRun = await newRun();
		const bad = fakeVision({
			fail: (n, id) =>
				n === 1
					? new VisionError('bad_shape', 'elements[0].box: expected integer x, y, w, h', {
							id,
							model: 'claude-opus-5-5',
							usage: { input_tokens: 1500, output_tokens: 50 },
						})
					: undefined,
		});
		await start(badRun);
		await drive(badRun, deps(turns.transport, bad.transport, gate.launcher));
		const [badError] = await events(badRun, 'error');
		check(
			'an answer off the schema pauses the run at once, naming the code',
			[(await runRow(badRun)).status, badError?.payload.type, badError?.payload.code, bad.calls()],
			['paused', 'bad_answer', 'bad_shape', 1],
		);
		check(
			'…and the unusable answer is still billed',
			(await spendRows(badRun)).map((r) => r.agent),
			['mockup-analyst'],
		);
	}

	// ── 9. Pause during the last image ────────────────────────────────────────
	console.log('9. a pause during the last image: the resume rebuilds from the stored answers');
	{
		const runId = await newRun();
		const vision = fakeVision({
			during: (n) =>
				n === 2 ? event(runId, 'owner', 'owner_request', { action: 'pause' }) : undefined,
		});
		const turns = fakeTurnModel();
		const gate = fakeLauncher({ template: buyTemplate });
		await start(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'the pause applied before the submission',
			[(await runRow(runId)).status, (await breakdownOpens(runId)).length],
			['paused', 0],
		);
		check(
			'…the breakdown is noted as held, both answers billed and stored, the crops saved once',
			[
				await activityTypes(runId),
				(await spendRows(runId)).length,
				await storedAnswers(runId),
				gate.effects.length,
			],
			[['breakdown_pass', 'breakdown_held'], 2, 2, 1],
		);
		await resume(runId);
		await drive(runId, deps(turns.transport, vision.transport, gate.launcher));
		check(
			'the resume opens the checkpoint from the stored answers',
			[(await runRow(runId)).waiting_on, (await breakdownOpens(runId)).length],
			['breakdown', 1],
		);
		check(
			'…asking for no image again and spending nothing more; the crops are saved under the new pass',
			[vision.calls(), (await spendRows(runId)).length, gate.effects.length],
			[2, 2, 2],
		);
		check('…as a second pass', await activityTypes(runId), [
			'breakdown_pass',
			'breakdown_held',
			'breakdown_pass',
			'Mockup breakdown ready',
		]);
		check('…and the coordinator told once', (await messages(runId, 'coordinator')).length, 2);
	}
} finally {
	await sql`delete from director_spend where run_id like ${`${tag}-%`}`;
	await sql`delete from users where id = ${userId}`;
	await sql.end();
}

console.log(`\nbreakdown: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
