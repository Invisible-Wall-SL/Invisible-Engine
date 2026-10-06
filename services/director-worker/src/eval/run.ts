import { costOfUsage, type DirectorPricing } from 'director-costs';
import { parseAgent, type AgentCatalog, type AgentDefinition } from '../agents.ts';
import { ANALYST_AGENT, analyzeMockups, type Breakdown } from '../mockups/analyze.ts';
import {
	summarizeUsage,
	sumUsage,
	VisionError,
	type BilledResponse,
	type Usage,
	type VisionTransport,
} from '../mockups/vision.ts';
import { modelProfile } from '../model.ts';
import { expectedBreakdown, referenceAdapters, referenceTemplateKey } from './mockupSet.ts';
import {
	EVAL_REPORT_VERSION,
	evalLine,
	parseEvalReport,
	type EvalReport,
	type EvalSide,
} from './report.ts';
import { evalItems, scoreBreakdown } from './score.ts';

/**
 * The agent evaluation (ADR-0007 "Agents tab"; PLAN 5.4): an edited runtime-agent definition and
 * `main`'s run over the agent's reference set, scored against the expected result. `agent-eval.yml`
 * runs it from `main`'s checkout through `scripts/agent-eval.ts`; the report it returns is what the
 * workflow uploads and what Invisible Pipeline Changes reads.
 *
 * Every outcome is a report, never a throw: an edit the loader refuses, an agent with nothing to
 * compare on yet, a cap that stopped the run and an API failure each have a `result`. The money is
 * counted from what the API returns, not from a forecast (`capTransport`).
 */

export interface EvalInput {
	agent: string;
	/** `main`'s definition of the agent; null when `main` has none (a new agent). */
	beforeText: string | null;
	/** The edited definition, as the PR head has it. */
	afterText: string;
	headSha: string;
	baseSha: string;
	capUsd: number;
	/** A factory is called only once a model call is certain, so a run that stops earlier needs no key. */
	model: VisionTransport | (() => VisionTransport);
	pricing: DirectorPricing;
	catalog: AgentCatalog;
}

type Side = 'before' | 'after';

interface Ledger {
	calls: number;
	costUsd: number;
	usages: Usage[];
}

type Outcome = Pick<
	EvalReport,
	'result' | 'costUsd' | 'capped' | 'set' | 'before' | 'after' | 'items' | 'errors'
>;

/** The cap stopped the run: the message says where. */
class EvalCapped extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EvalCapped';
	}
}

/**
 * A definition as the worker would boot with it: it parses, and its model has a request profile
 * (`model.ts`), which the loader's catalogue (every PRICED model) does not check on its own.
 */
function loadDefinition(
	agent: string,
	text: string,
	catalog: AgentCatalog,
): { ok: true; agent: AgentDefinition } | { ok: false; errors: string[] } {
	const parsed = parseAgent(`${agent}.md`, text, catalog);
	if (!parsed.ok) return parsed;
	try {
		modelProfile(parsed.agent.model);
	} catch (error) {
		return { ok: false, errors: [(error as Error).message] };
	}
	return parsed;
}

/** An error's message as a report may carry it: one line, short, and nothing key-shaped. */
function safeMessage(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text
		.replace(/sk-ant-[\w-]+/g, '[redacted]')
		.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 300);
}

/**
 * The cap, in code. Every response the API returns is priced as it arrives (`costOfUsage`, the same
 * arithmetic as the spend ledger), a refused or malformed one included — those are billed too.
 * A call is not made once the total has reached the cap; a response that carries the total past it
 * is the last, so the run overshoots by at most one call.
 */
function capTransport(
	inner: VisionTransport,
	pricing: DirectorPricing,
	capUsd: number,
	ledgers: Record<Side, Ledger>,
): (side: Side) => VisionTransport {
	const spent = () => ledgers.before.costUsd + ledgers.after.costUsd;
	return (side) => ({
		async analyze(request, signal) {
			const ledger = ledgers[side];
			if (spent() >= capUsd) {
				throw new EvalCapped(`stopped before call ${ledger.calls + 1} of side ${side}`);
			}
			const bill = (response: BilledResponse) => {
				ledger.costUsd += costOfUsage(response.model, response.usage, pricing);
				ledger.calls++;
				ledger.usages.push(summarizeUsage(response.usage));
				if (spent() > capUsd) {
					throw new EvalCapped(`stopped after call ${ledger.calls} of side ${side}`);
				}
			};
			let answer;
			try {
				answer = await inner.analyze(request, signal);
			} catch (error) {
				if (error instanceof VisionError && error.response) bill(error.response);
				throw error;
			}
			bill(answer);
			return answer;
		},
	});
}

function finish(input: EvalInput, outcome: Outcome): EvalReport {
	const body = {
		agent: input.agent,
		head: { sha: input.headSha },
		base: { sha: input.baseSha },
		capUsd: input.capUsd,
		...outcome,
	};
	// Through JSON and the launcher's own parser: what is written is what the launcher will accept.
	return parseEvalReport(
		JSON.parse(JSON.stringify({ version: EVAL_REPORT_VERSION, ...body, line: evalLine(body) })),
	);
}

const nothingRan = (result: 'invalid' | 'no-eval-set', errors: string[]): Outcome => ({
	result,
	costUsd: 0,
	capped: false,
	set: null,
	before: null,
	after: null,
	items: [],
	errors,
});

export async function runAgentEval(input: EvalInput): Promise<EvalReport> {
	const edited = loadDefinition(input.agent, input.afterText, input.catalog);
	if (!edited.ok) return finish(input, nothingRan('invalid', edited.errors));
	// Only the mockup analyst has a reference set so far (`mockupSet.ts`).
	if (edited.agent.name !== ANALYST_AGENT) return finish(input, nothingRan('no-eval-set', []));

	const notes: string[] = [];
	let main: AgentDefinition | null = null;
	if (input.beforeText !== null) {
		const parsed = loadDefinition(input.agent, input.beforeText, input.catalog);
		if (parsed.ok) main = parsed.agent;
		else {
			notes.push(
				`main's definition fails the loader, so there is no "before" run: ${parsed.errors.join('; ')}`,
			);
		}
	}

	const definitions: Record<Side, AgentDefinition | null> = { before: main, after: edited.agent };
	const ledgers: Record<Side, Ledger> = {
		before: { calls: 0, costUsd: 0, usages: [] },
		after: { calls: 0, costUsd: 0, usages: [] },
	};
	const finished: Record<Side, Breakdown | null> = { before: null, after: null };
	let expected: Breakdown | null = null;
	let failure: { error: unknown; side: Side | null } | null = null;
	let running: Side | null = null;

	try {
		expected = expectedBreakdown();
		const inner = typeof input.model === 'function' ? input.model() : input.model;
		const transportFor = capTransport(inner, input.pricing, input.capUsd, ledgers);
		const run = { id: 'eval', templateProjectKey: referenceTemplateKey() };
		for (const [side, pass] of [
			['before', 1],
			['after', 2],
		] as const) {
			const agent = definitions[side];
			if (!agent) continue;
			running = side;
			finished[side] = await analyzeMockups({
				adapters: referenceAdapters(),
				model: transportFor(side),
				agent,
				run,
				pass,
			});
		}
	} catch (error) {
		failure = { error, side: running };
	}

	const sideReport = (side: Side): EvalSide | null => {
		const breakdown = finished[side];
		const agent = definitions[side];
		if (!breakdown || !agent || !expected) return null;
		const { score, statusAgreement, regionAgreement, extraElements } = scoreBreakdown(
			expected,
			breakdown,
		);
		const ledger = ledgers[side];
		return {
			definition: { model: agent.model, effort: agent.effort },
			score,
			statusAgreement,
			regionAgreement,
			extraElements,
			calls: ledger.calls,
			usage: sumUsage(ledger.usages),
			costUsd: ledger.costUsd,
		};
	};

	const capped = failure?.error instanceof EvalCapped;
	const errors = [...notes];
	if (failure) {
		const message = safeMessage(failure.error);
		errors.unshift(capped || !failure.side ? message : `side ${failure.side}: ${message}`);
	}
	const images = expected?.images.filter((image) => !image.styleOnly) ?? [];
	return finish(input, {
		result: !failure ? 'scored' : capped ? 'capped' : 'error',
		costUsd: ledgers.before.costUsd + ledgers.after.costUsd,
		capped,
		set: expected
			? {
					name: 'mockups',
					images: images.length,
					elements: images.reduce((sum, image) => sum + image.elements.length, 0),
				}
			: null,
		before: sideReport('before'),
		after: sideReport('after'),
		items:
			expected && (finished.before || finished.after)
				? evalItems(expected, finished.before, finished.after)
				: [],
		errors,
	});
}
