/**
 * The agent evaluation, as `.github/workflows/agent-eval.yml` runs it from `main`'s checkout
 * (ADR-0007 "Agents tab"; PLAN 5.4):
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning \
 *     services/director-worker/scripts/agent-eval.ts --agent <name> --after <edited .md> \
 *     [--before <main's .md>] [--after-pack <families/<family>.md>] \
 *     [--before-pack <main's families/<family>.md>] --head <sha> --base <sha> --out <dir> [--cap <usd>] \
 *     [--cases <n,n>]
 *
 * The packs are the family pack each side runs with (ADR-0009 §4): a side without one runs its
 * definition alone, as a checkout from before the packs did. The workflow, which evaluates a change
 * to one definition, passes main's slot pack to both sides; a pack change is evaluated by hand.
 *
 * A pack change is evaluated by hand with the same definition on both sides: pass `--pack-compare`
 * with `--before-pack` (main's pack) and `--after-pack` (the branch's), and the "before" side runs
 * `--after`'s definition with the before pack (without the flag, no `--before` means "main has no
 * such agent": it is evaluated alone, as the workflow does for a new definition). Only a reference
 * set that reads the pack shows a difference: the mockup analyst's does (its system prompt is the definition, the pack, then the
 * template's catalogue), the doctor's does (the pack is its second system block).
 *
 * `--agent game-doctor` runs the repair set (docs/director/eval/repair/): the real definition,
 * under the real model, over scripted worlds, 5 cases; `--cases 1,3` runs some. A side with no
 * pack runs this checkout's slot pack. `--estimate` prints what a good run of each case would
 * cost (no key, no call) and exits 0.
 *
 * Writes `<out>/report.json` (the `EvalReport`, tab-indented) and `<out>/summary.txt` (line 1
 * `pass` or `fail`, line 2 the report's one-line summary), prints that line (a repair report adds one line per case and side) and exits 0 on a pass,
 * 1 on a fail; 2 is a usage error, with nothing written. `ANTHROPIC_API_KEY` comes from the
 * environment and is asked for only when a model call is about to be made, so an agent with no
 * reference set, or an edit the loader refuses, is evaluated without one. Neither the key nor any
 * request is ever printed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { parsePricing } from 'director-costs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AGENT_NAME, parseAgent, pricedModels } from '../src/agents.ts';
import { loadRepairSet } from '../src/eval/repairCase.ts';
import { DOCTOR_AGENT, caseMatches, defaultSlotPack } from '../src/eval/repairRun.ts';
import { estimateRepairSpend } from '../src/eval/repairScripts.ts';
import { EVAL_CAP_USD, caseLines, evalPasses } from '../src/eval/report.ts';
import { runAgentEval } from '../src/eval/run.ts';
import { anthropicTransport as chatTransport } from '../src/model.ts';
import { anthropicTransport } from '../src/mockups/vision.ts';
import { KNOWN_TOOLS } from '../src/tools.ts';

const USAGE = `usage: agent-eval.ts --agent <name> --after <edited .md> [--before <main's .md>]
                     [--after-pack <pack .md>] [--before-pack <main's pack .md>]
                     [--head <sha>] [--base <sha>] [--out <dir>] [--cap <usd, at most ${EVAL_CAP_USD}>]
                     [--pack-compare]  (both sides run --after; needs --before-pack and --after-pack)
                     [--cases <n,n>]   (game-doctor: only these repair cases)
       agent-eval.ts --estimate [--after <game-doctor .md>] [--cases <n,n>]   (what a good run costs; no key, no call)`;

function usageError(message: string): never {
	console.error(`${message}\n${USAGE}`);
	process.exit(2);
}

const { values } = parseArgs({
	options: {
		agent: { type: 'string' },
		after: { type: 'string' },
		before: { type: 'string' },
		'after-pack': { type: 'string' },
		'before-pack': { type: 'string' },
		head: { type: 'string' },
		base: { type: 'string' },
		out: { type: 'string' },
		cap: { type: 'string' },
		cases: { type: 'string' },
		estimate: { type: 'boolean' },
		'pack-compare': { type: 'boolean' },
	},
	strict: true,
	allowPositionals: false,
});

const read = (path: string): string => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return usageError(`cannot read ${path}`);
	}
};

const pricingFile = fileURLToPath(new URL('../pricing.json', import.meta.url));
const pricing = parsePricing(JSON.parse(readFileSync(pricingFile, 'utf8')));
const catalog = { models: pricedModels(pricingFile), tools: KNOWN_TOOLS };

const caseFilter = (): string[] | undefined => {
	if (values.cases === undefined) return undefined;
	const names = values.cases.split(',').map((c) => c.trim());
	if (names.some((c) => !/^[\w-]+$/.test(c)))
		usageError('--cases is a comma-separated list of case ids or numbers');
	return names;
};

if (values.estimate) {
	const text = values.after
		? read(values.after)
		: readFileSync(fileURLToPath(new URL(`../agents/${DOCTOR_AGENT}.md`, import.meta.url)), 'utf8');
	const parsed = parseAgent(`${DOCTOR_AGENT}.md`, text, catalog);
	if (!parsed.ok) usageError(`the definition fails the loader: ${parsed.errors.join('; ')}`);
	const set = loadRepairSet();
	const filter = caseFilter();
	const cases = filter ? set.cases.filter((c) => filter.some((f) => caseMatches(c, f))) : set.cases;
	if (cases.length === 0) usageError('--cases names no case');
	const pack = defaultSlotPack();
	const money = (usd: number) => `$${usd.toFixed(2)}`;
	console.log(
		'estimated cost of a good run of each case, per side, at the output tokens a turn (thinking included):',
	);
	const totals = [0, 0];
	for (const [i, out] of [1_000, 3_500].entries()) {
		const rows = await estimateRepairSpend({
			agent: parsed.agent,
			pack,
			set,
			pricing,
			outputTokensPerTurn: out,
			cases,
		});
		totals[i] = rows.reduce((sum, r) => sum + r.usd, 0);
		console.log(`  ${out} tokens a turn:`);
		for (const r of rows) console.log(`    ${r.id}: ${r.turns} turns, ${money(r.usd)}`);
		console.log(
			`    all ${rows.length}: ${money(totals[i])} a side, ${money(totals[i] * 2)} for two sides`,
		);
	}
	process.exit(0);
}

const { agent, after } = values;
const head = values.head ?? 'local';
const base = values.base ?? 'local';
const out = values.out ?? 'agent-eval-out';
if (!agent || !after) usageError('missing an option');
if (!AGENT_NAME.test(agent)) usageError('--agent must be a lower-case-kebab agent name');
if (values['pack-compare'] && (!values['before-pack'] || !values['after-pack'] || values.before)) {
	usageError('--pack-compare needs --before-pack and --after-pack, and no --before');
}
const capUsd = values.cap === undefined ? EVAL_CAP_USD : Number(values.cap);
if (values.cap === '' || !Number.isFinite(capUsd) || capUsd < 0 || capUsd > EVAL_CAP_USD) {
	usageError(`--cap must be a number of dollars from 0 to ${EVAL_CAP_USD}`);
}

const packFile = (path: string | undefined) =>
	path === undefined ? null : { file: basename(path), text: read(path) };

const report = await runAgentEval({
	agent,
	// A pack comparison runs the edited definition on both sides; otherwise no --before is "main has none".
	beforeText:
		values.before !== undefined ? read(values.before) : values['pack-compare'] ? read(after) : null,
	afterText: read(after),
	beforePack: packFile(values['before-pack']),
	afterPack: packFile(values['after-pack']),
	headSha: head,
	baseSha: base,
	capUsd,
	model: () => {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
		// No SDK retries: every attempt the API answers is billed, and only a response the transport
		// sees goes through the cap. A long vision call still fits in ten minutes.
		return anthropicTransport(new Anthropic({ apiKey, maxRetries: 0, timeout: 10 * 60_000 }));
	},
	chat: () => {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
		return chatTransport(apiKey, { maxRetries: 0, timeout: 10 * 60_000 });
	},
	cases: caseFilter(),
	pricing,
	catalog,
});

const passed = evalPasses(report.result);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`);
writeFileSync(join(out, 'summary.txt'), `${passed ? 'pass' : 'fail'}\n${report.line}\n`);
console.log(report.line);
for (const line of caseLines(report)) console.log(line);
process.exitCode = passed ? 0 : 1;
