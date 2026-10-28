import type {
	BetaContentBlockParam,
	BetaMessageParam,
	BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { DirectorPricing } from 'director-costs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentDefinition } from '../agents.ts';
import { parseFamilyPack, type FamilyPack } from '../familyPack.ts';
import type { AdapterSpec } from '../launcher.ts';
import { sumUsage } from '../mockups/vision.ts';
import { buildRequest, echoable, type ModelTransport, type ToolSpec } from '../model.ts';
import { repairBrief } from '../repair.ts';
import { capImages } from '../toolResult.ts';
import { workerToolSpecs } from '../workerTools.ts';
import {
	EvalCapped,
	ModelUnavailable,
	capModel,
	newLedgers,
	safeMessage,
	type Ledger,
	type Side,
} from './cap.ts';
import { loadRepairSet, shotFilesOf, type RepairCase, type RepairSet } from './repairCase.ts';
import {
	scoreRepairCase,
	type CaseVerdict,
	type RepairRun,
	type StopReason,
} from './repairScore.ts';
import { RepairWorld } from './repairWorld.ts';
import type {
	EvalCase,
	EvalCaseSide,
	EvalElementView,
	EvalItem,
	EvalOutcome,
	EvalSide,
} from './report.ts';

/**
 * The repair eval (ADR-0012 §6, 9G.4): the REAL `game-doctor` definition, under the real model,
 * driven through a multi-turn loop over a scripted world (`repairWorld.ts`) until it concludes or a
 * limit stops it, and scored per case (`repairScore.ts`).
 *
 * A turn is built exactly as the worker builds it (`takeTurn` in `driver.ts`): `buildRequest` with
 * the agent, the run's family pack as the second system block, the agent's tools in its
 * definition's order and the stored conversation through `capImages`; the model's reply is stored
 * as `echoable` content, its tool calls are answered (here by the world) and the answers go back
 * as the next user message; a reply with no tool call ends the turn, and what the worker would
 * tell the doctor next (a play's report, a builder's report) arrives as the next message.
 */

export const DOCTOR_AGENT = 'game-doctor';

/** The pack a side runs with when none is given: the slot pack of this checkout (the set is a slot game). */
export function defaultSlotPack(): FamilyPack {
	const file = fileURLToPath(new URL('../../families/slot.md', import.meta.url));
	const parsed = parseFamilyPack('slot.md', readFileSync(file, 'utf8'));
	if (!parsed.ok) throw new Error(`families/slot.md fails the loader: ${parsed.errors.join('; ')}`);
	return parsed.pack;
}

/** The tools `agent` is offered, in its definition's order, as the worker offers them in a repair run. */
export function repairToolSpecs(
	agent: AgentDefinition,
	specs: ReadonlyMap<string, AdapterSpec>,
): ToolSpec[] {
	const worker = workerToolSpecs(['builder', 'animator'], 'repair') as Record<
		string,
		ToolSpec | undefined
	>;
	return agent.tools.map((id) => {
		const spec = worker[id] ?? specs.get(id);
		if (!spec) {
			throw new Error(
				`the repair eval set has no catalog entry for ${id}: add it to docs/director/eval/repair/tool-specs.json (check:director-adapters --update-repair-eval-specs) and give the cases an answer for it`,
			);
		}
		return { id, description: spec.description, inputSchema: spec.inputSchema };
	});
}

/** What an empty reply is stored as: the API refuses an empty message anywhere but last. */
const storable = (content: BetaContentBlockParam[]): BetaContentBlockParam[] =>
	content.length ? content : [{ type: 'text', text: '(no reply)' }];

export interface PlayCaseInput {
	agent: AgentDefinition;
	pack: FamilyPack;
	set: RepairSet;
	case: RepairCase;
	transport: ModelTransport;
	/** This case's spend so far on this side. */
	spent: () => number;
	signal?: AbortSignal;
}

/**
 * One repair run of one case. Ends when the doctor's `run.submit_repair` is accepted, or at the
 * case's turn or spend limit, or when the doctor has ended its turn with nothing on its way, or on
 * a refusal. An API failure is not caught here: it is the whole eval's.
 */
export async function playCase(input: PlayCaseInput): Promise<RepairRun> {
	const { agent, pack, set, case: c, transport } = input;
	const specs = repairToolSpecs(agent, set.specs);
	const world = new RepairWorld({
		set,
		case: c,
		tools: agent.tools,
		specs: set.specs,
		spentUsd: input.spent,
	});
	const signal = input.signal ?? new AbortController().signal;
	const run = set.base.run;
	const messages: BetaMessageParam[] = [
		{
			role: 'user',
			content: [
				{
					type: 'text',
					text: repairBrief({
						runId: `eval-${c.id}`,
						project: run.project,
						client: run.client,
						bugNumber: c.bugNumber,
						family: run.family,
						budgetCapUsd: run.budgetCapUsd,
					}),
				},
			],
		},
	];
	let turns = 0;
	const end = (stop: StopReason): RepairRun => ({
		trace: world.trace,
		turns,
		stop,
		costUsd: input.spent(),
	});

	for (;;) {
		if (world.concluded) return end('submitted');
		if (turns >= c.limits.maxTurns) return end('turn_limit');
		if (input.spent() >= c.limits.maxUsd) return end('spend_limit');
		const response = await transport.send(
			buildRequest(agent, pack, specs, capImages(messages)),
			signal,
		);
		turns++;
		world.startTurn(turns);
		if (response.stop_reason === 'refusal') return end('refusal');
		const content = storable(echoable(response.content as BetaContentBlockParam[]));
		messages.push({ role: 'assistant', content });
		const calls = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
		if (response.stop_reason === 'max_tokens') {
			// A cut-off reply may hold a half-written call: every call is answered unrun.
			messages.push({
				role: 'user',
				content: [
					...calls.map((call) => ({
						type: 'tool_result' as const,
						tool_use_id: call.id,
						content: 'Not run: the reply was cut off.',
						is_error: true,
					})),
					{
						type: 'text',
						text: 'Your reply hit the output limit, so no tool ran. Continue, more briefly.',
					},
				],
			});
			continue;
		}
		if (calls.length) {
			messages.push({ role: 'user', content: calls.map((call) => world.call(call)) });
			continue;
		}
		const told = world.deliver();
		if (!told) return end('stalled');
		messages.push({ role: 'user', content: told });
	}
}

/** Whether `filter` names the case: its id, or its number (`3`, `03`). */
export const caseMatches = (c: RepairCase, filter: string): boolean =>
	c.id === filter ||
	c.id.startsWith(`${filter}-`) ||
	String(Number(c.id.slice(0, 2))) === filter.replace(/^0+(?=\d)/, '');

export interface RepairEvalInput {
	definitions: Record<Side, AgentDefinition | null>;
	/** A side's pack; absent or null runs this checkout's slot pack. */
	packs: Record<Side, FamilyPack | null>;
	cases?: string[];
	capUsd: number;
	chat: ModelTransport | (() => ModelTransport);
	pricing: DirectorPricing;
	/** The set to run; the repository's by default. */
	set?: RepairSet;
}

interface SideResult {
	verdict: CaseVerdict;
	run: RepairRun;
}

const sideOf = (agent: AgentDefinition, results: SideResult[], ledger: Ledger): EvalSide => {
	const n = results.length;
	const checks = results.flatMap((r) => r.verdict.checks);
	return {
		definition: { model: agent.model, effort: agent.effort },
		score: results.filter((r) => r.verdict.passed).length / n,
		statusAgreement: results.filter((r) => r.verdict.outcomeOk).length / n,
		regionAgreement: checks.filter((k) => k.ok).length / checks.length,
		extraElements: checks.filter((k) => k.violation && !k.ok).length,
		calls: ledger.calls,
		usage: sumUsage(ledger.usages),
		costUsd: ledger.costUsd,
	};
};

const caseSideOf = (r: SideResult | undefined): EvalCaseSide | null => {
	if (!r) return null;
	const checks = r.verdict.checks;
	return {
		passed: r.verdict.passed,
		outcome: r.verdict.outcome,
		area: r.verdict.area,
		stop: r.run.stop,
		turns: r.run.turns,
		tasks: r.run.trace.tasks.length,
		costUsd: r.run.costUsd,
		checks: { passed: checks.filter((k) => k.ok).length, total: checks.length },
		reasons: r.verdict.reasons,
	};
};

/** A case's side in the element table's shape: outcome as status, area as regions, checks held as the region score. */
const viewOf = (side: EvalCaseSide | null, c: RepairCase): EvalElementView | null =>
	side && {
		found: side.outcome !== null,
		name: side.passed ? 'passed' : side.reasons.join('; ').slice(0, 300),
		status: side.outcome,
		regions: side.area ? [side.area] : [],
		statusMatch: side.outcome !== null && c.expect.outcomes.includes(side.outcome as never),
		regionScore: side.checks.total ? side.checks.passed / side.checks.total : 1,
	};

/**
 * Run the repair set on each side that has a definition, case by case (both sides of a case before
 * the next, so a run the cap stops has paired results), and report. Never throws: a cap stop, an API
 * failure and an unusable definition are each a result.
 */
export async function runRepairEval(input: RepairEvalInput): Promise<EvalOutcome> {
	const set = input.set ?? loadRepairSet();
	const picked =
		input.cases === undefined
			? set.cases
			: set.cases.filter((c) => input.cases!.some((f) => caseMatches(c, f)));
	const unknown = (input.cases ?? []).filter((f) => !set.cases.some((c) => caseMatches(c, f)));
	if (unknown.length || picked.length === 0) {
		return {
			result: 'invalid',
			costUsd: 0,
			capped: false,
			set: null,
			before: null,
			after: null,
			items: [],
			errors: [
				`no such case: ${unknown.join(', ') || '(none given)'}. The cases are ${set.cases.map((c) => c.id).join(', ')}`,
			],
		};
	}
	const sides = (['before', 'after'] as const).filter((s) => input.definitions[s]);
	const ledgers = newLedgers();
	const results: Record<Side, SideResult[]> = { before: [], after: [] };
	const byCase = new Map<string, Partial<Record<Side, SideResult>>>();
	let failure: { error: unknown; side: Side | null } | null = null;
	let running: Side | null = null;
	const slot = defaultSlotPack();

	try {
		const chat = input.chat;
		const transportFor = capModel(
			typeof chat === 'function' ? chat : () => chat,
			input.pricing,
			input.capUsd,
			ledgers,
		);
		for (const c of picked) {
			for (const side of sides) {
				running = side;
				const agent = input.definitions[side]!;
				const transport = transportFor(side);
				const start = ledgers[side].costUsd;
				const run = await playCase({
					agent,
					pack: input.packs[side] ?? slot,
					set,
					case: c,
					transport,
					spent: () => ledgers[side].costUsd - start,
				});
				const result = { verdict: scoreRepairCase(c, run, agent.tools), run };
				results[side].push(result);
				byCase.set(c.id, { ...byCase.get(c.id), [side]: result });
			}
		}
	} catch (error) {
		failure = { error, side: running };
	}

	const capped = failure?.error instanceof EvalCapped;
	const errors: string[] = [];
	if (failure) {
		const message = safeMessage(failure.error);
		const unattributed = capped || !failure.side || failure.error instanceof ModelUnavailable;
		errors.push(unattributed ? message : `side ${failure.side}: ${message}`);
	}
	const finished = (side: Side) =>
		input.definitions[side] && results[side].length === picked.length
			? sideOf(input.definitions[side]!, results[side], ledgers[side])
			: null;

	const done = picked.filter((c) => byCase.has(c.id));
	const cases: EvalCase[] = done.map((c) => {
		const r = byCase.get(c.id)!;
		const before = caseSideOf(r.before);
		const after = caseSideOf(r.after);
		return {
			id: c.id,
			title: c.title,
			expected: { outcomes: c.expect.outcomes, areas: c.expect.areas ?? [] },
			before,
			after,
			changed: before !== null && after !== null && before.passed !== after.passed,
		};
	});
	const items: EvalItem[] = done.map((c, i) => ({
		image: c.id,
		n: c.adrBug,
		name: c.title,
		expected: { status: c.expect.outcomes.join(' or '), regions: c.expect.areas ?? [] },
		before: viewOf(cases[i].before, c),
		after: viewOf(cases[i].after, c),
		changed: cases[i].changed,
	}));
	return {
		result: !failure ? 'scored' : capped ? 'capped' : 'error',
		costUsd: ledgers.before.costUsd + ledgers.after.costUsd,
		capped,
		set: {
			name: 'repair',
			images: new Set(picked.flatMap(shotFilesOf)).size,
			elements: picked.length,
		},
		before: finished('before'),
		after: finished('after'),
		items,
		cases,
		errors,
	};
}
