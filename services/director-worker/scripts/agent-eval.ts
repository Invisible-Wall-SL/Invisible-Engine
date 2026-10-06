/**
 * The agent evaluation, as `.github/workflows/agent-eval.yml` runs it from `main`'s checkout
 * (ADR-0007 "Agents tab"; PLAN 5.4):
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning \
 *     services/director-worker/scripts/agent-eval.ts --agent <name> --after <edited .md> \
 *     [--before <main's .md>] --head <sha> --base <sha> --out <dir> [--cap <usd>]
 *
 * Writes `<out>/report.json` (the `EvalReport`, tab-indented) and `<out>/summary.txt` (line 1
 * `pass` or `fail`, line 2 the report's one-line summary), prints that line and exits 0 on a pass,
 * 1 on a fail; 2 is a usage error, with nothing written. `ANTHROPIC_API_KEY` comes from the
 * environment and is asked for only when a model call is about to be made, so an agent with no
 * reference set, or an edit the loader refuses, is evaluated without one. Neither the key nor any
 * request is ever printed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { parsePricing } from 'director-costs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { pricedModels } from '../src/agents.ts';
import { EVAL_CAP_USD, evalPasses } from '../src/eval/report.ts';
import { runAgentEval } from '../src/eval/run.ts';
import { anthropicTransport } from '../src/mockups/vision.ts';
import { KNOWN_TOOLS } from '../src/tools.ts';

const USAGE = `usage: agent-eval.ts --agent <name> --after <edited .md> [--before <main's .md>]
                     --head <sha> --base <sha> --out <dir> [--cap <usd, at most ${EVAL_CAP_USD}>]`;

function usageError(message: string): never {
	console.error(`${message}\n${USAGE}`);
	process.exit(2);
}

const { values } = parseArgs({
	options: {
		agent: { type: 'string' },
		after: { type: 'string' },
		before: { type: 'string' },
		head: { type: 'string' },
		base: { type: 'string' },
		out: { type: 'string' },
		cap: { type: 'string' },
	},
	strict: true,
	allowPositionals: false,
});

const { agent, after, head, base, out } = values;
if (!agent || !after || !head || !base || !out) usageError('missing an option');
if (!/^[a-z][a-z-]*$/.test(agent)) usageError('--agent must be a lower-case-kebab agent name');
const capUsd = values.cap === undefined ? EVAL_CAP_USD : Number(values.cap);
if (values.cap === '' || !Number.isFinite(capUsd) || capUsd < 0 || capUsd > EVAL_CAP_USD) {
	usageError(`--cap must be a number of dollars from 0 to ${EVAL_CAP_USD}`);
}

const read = (path: string): string => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return usageError(`cannot read ${path}`);
	}
};

const pricingFile = fileURLToPath(new URL('../pricing.json', import.meta.url));
const pricing = parsePricing(JSON.parse(readFileSync(pricingFile, 'utf8')));

const report = await runAgentEval({
	agent,
	beforeText: values.before === undefined ? null : read(values.before),
	afterText: read(after),
	headSha: head,
	baseSha: base,
	capUsd,
	model: () => {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
		return anthropicTransport(new Anthropic({ apiKey }));
	},
	pricing,
	catalog: { models: pricedModels(pricingFile), tools: KNOWN_TOOLS },
});

const passed = evalPasses(report.result);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`);
writeFileSync(join(out, 'summary.txt'), `${passed ? 'pass' : 'fail'}\n${report.line}\n`);
console.log(report.line);
process.exitCode = passed ? 0 : 1;
