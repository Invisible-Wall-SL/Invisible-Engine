import { costOfResponse, type DirectorPricing } from 'director-costs';
import { parseAgent, type AgentCatalog, type AgentDefinition } from '../agents.ts';
import { parseFamilyPack, type FamilyPack } from '../familyPack.ts';
import { ANALYST_AGENT, analyzeMockups, type Breakdown } from '../mockups/analyze.ts';
import {
	summarizeUsage,
	sumUsage,
	VisionError,
	type BilledResponse,
	type VisionTransport,
} from '../mockups/vision.ts';
import { modelProfile, type ModelTransport } from '../model.ts';
import {
	EvalCapped,
	ModelUnavailable,
	newLedgers,
	safeMessage,
	type Ledger,
	type Side,
} from './cap.ts';
import { expectedBreakdown, referenceAdapters, referenceTemplateKey } from './mockupSet.ts';
import {
	EVAL_REPORT_VERSION,
	evalLine,
	parseEvalReport,
	type EvalOutcome,
	type EvalReport,
	type EvalSide,
} from './report.ts';
import { DOCTOR_AGENT, runRepairEval } from './repairRun.ts';
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
	/**
	 * The family pack each side runs with (`families/<family>.md`, ADR-0009 §4), as its checkout has
	 * it; absent or null for a side whose checkout has no packs (a `main` from before 9F).
	 */
	beforePack?: PackFile | null;
	afterPack?: PackFile | null;
	headSha: string;
	baseSha: string;
	capUsd: number;
	/** A factory is called only once a model call is certain, so a run that stops earlier needs no key. */
	model: VisionTransport | (() => VisionTransport);
	/**
	 * The chat transport of an agent whose reference set is whole runs (`game-doctor`'s repair
	 * set): the same seam the worker's drive calls the model through, behind the same cap.
	 */
	chat?: ModelTransport | (() => ModelTransport);
	/** Run only these cases of such a set (an id, or its number: `03`, `3`); absent: all of them. */
	cases?: string[];
	pricing: DirectorPricing;
	catalog: AgentCatalog;
}

/** A pack file: its name (the family) and its text. */
export interface PackFile {
	file: string;
	text: string;
}

/** A side's pack, parsed: null for no pack, else the pack or the loader's errors. */
function loadPack(
	pack: PackFile | null | undefined,
): { ok: true; pack: FamilyPack | null } | { ok: false; errors: string[] } {
	if (!pack) return { ok: true, pack: null };
	const parsed = parseFamilyPack(pack.file, pack.text);
	return parsed.ok
		? { ok: true, pack: parsed.pack }
		: { ok: false, errors: parsed.errors.map((e) => `${pack.file}: ${e}`) };
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

/**
 * The cap, in code. Every response the API returns is priced as it arrives (`costOfResponse`, the
 * same arithmetic as the spend ledger, so a refusal fallback's declined attempt counts), a refused or
 * malformed one included — those are billed too.
 * A call is not made once the total has reached the cap; a response that carries the total past it
 * is the last, so the run overshoots by at most one call.
 */
function capTransport(
	model: () => VisionTransport,
	pricing: DirectorPricing,
	capUsd: number,
	ledgers: Record<Side, Ledger>,
): (side: Side) => VisionTransport {
	const spent = () => ledgers.before.costUsd + ledgers.after.costUsd;
	// Made on the first call that passes the cap, not before: a run the cap stops at once, or one
	// that never calls, needs no key.
	let inner: VisionTransport | null = null;
	return (side) => ({
		async analyze(request, signal) {
			const ledger = ledgers[side];
			if (spent() >= capUsd) {
				throw new EvalCapped(`stopped before call ${ledger.calls + 1} of side ${side}`);
			}
			if (!inner) {
				try {
					inner = model();
				} catch (error) {
					throw new ModelUnavailable(error);
				}
			}
			const bill = (response: BilledResponse) => {
				ledger.costUsd += costOfResponse(response, pricing).usd;
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

function finish(input: EvalInput, outcome: EvalOutcome): EvalReport {
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

/** An evaluation that needs a chat transport was given none. */
const notConfigured = (): never => {
	throw new Error('this evaluation needs a chat transport (EvalInput.chat)');
};

const nothingRan = (result: 'invalid' | 'no-eval-set', errors: string[]): EvalOutcome => ({
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
	const afterPack = loadPack(input.afterPack);
	if (!afterPack.ok) return finish(input, nothingRan('invalid', afterPack.errors));
	// Two reference sets: the mockup analyst's (`mockupSet.ts`) and the game doctor's repair set
	// (`repairCase.ts`): everything else has none yet.
	if (edited.agent.name !== ANALYST_AGENT && edited.agent.name !== DOCTOR_AGENT) {
		return finish(input, nothingRan('no-eval-set', []));
	}

	const notes: string[] = [];
	let main: AgentDefinition | null = null;
	let mainPack: FamilyPack | null = null;
	if (input.beforeText !== null) {
		const parsed = loadDefinition(input.agent, input.beforeText, input.catalog);
		const pack = loadPack(input.beforePack);
		if (!parsed.ok) {
			notes.push(
				`main's definition fails the loader, so there is no "before" run: ${parsed.errors.join('; ')}`,
			);
		} else if (!pack.ok) {
			notes.push(
				`main's family pack fails the loader, so there is no "before" run: ${pack.errors.join('; ')}`,
			);
		} else {
			main = parsed.agent;
			mainPack = pack.pack;
		}
	}

	const definitions: Record<Side, AgentDefinition | null> = { before: main, after: edited.agent };
	const packs: Record<Side, FamilyPack | null> = { before: mainPack, after: afterPack.pack };
	if (edited.agent.name === DOCTOR_AGENT) {
		const outcome = await runRepairEval({
			definitions,
			packs,
			cases: input.cases,
			capUsd: input.capUsd,
			chat: input.chat ?? (() => notConfigured()),
			pricing: input.pricing,
		});
		return finish(input, { ...outcome, errors: [...notes, ...outcome.errors] });
	}
	const ledgers = newLedgers();
	const finished: Record<Side, Breakdown | null> = { before: null, after: null };
	let expected: Breakdown | null = null;
	let failure: { error: unknown; side: Side | null } | null = null;
	let running: Side | null = null;

	try {
		expected = expectedBreakdown();
		const model = input.model;
		const transportFor = capTransport(
			typeof model === 'function' ? model : () => model,
			input.pricing,
			input.capUsd,
			ledgers,
		);
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
				pack: packs[side],
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
		const unattributed = capped || !failure.side || failure.error instanceof ModelUnavailable;
		errors.unshift(unattributed ? message : `side ${failure.side}: ${message}`);
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
