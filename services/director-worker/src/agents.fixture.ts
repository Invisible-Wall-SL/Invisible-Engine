/**
 * The runtime-agent loader (PLAN 3.2):
 *
 *   pnpm --filter director-worker check:agents
 *
 * Pinned: the shipped definitions in `agents/` all load; the valid fixtures load with every field;
 * a model `pricing.json` does not price is refused; a tool outside `tools.ts` is refused (the loader
 * names the file and the offender); every malformed shape the strict frontmatter parser meets is
 * refused with a reason rather than half-read.
 */
import { fileURLToPath } from 'node:url';
import { loadAgents, parseAgent, pricedModels, type AgentCatalog } from './agents.ts';
import { ADAPTER_OPS, KNOWN_TOOLS, WORKER_TOOLS } from './tools.ts';

const here = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

let failures = 0;
const check = (ok: boolean, msg: string, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${ok ? '' : extra}`);
	if (!ok) failures++;
};
const throws = (fn: () => unknown): string => {
	try {
		fn();
		return '';
	} catch (error) {
		return (error as Error).message;
	}
};

const catalog: AgentCatalog = { models: pricedModels(here('pricing.json')), tools: KNOWN_TOOLS };

console.log('shipped definitions');
{
	const agents = loadAgents(here('agents'), catalog);
	check(
		[...agents.keys()].sort().join() ===
			'animator,art-director,atlas-artist,builder,coordinator,mockup-analyst,qa',
		'all seven runtime agents load',
		` — got ${[...agents.keys()].join()}`,
	);
	const qa = agents.get('qa');
	check(qa?.effort === null, 'qa (Haiku) has no effort');
	check(agents.get('coordinator')?.effort === 'high', 'coordinator effort is high');
	check(
		[...agents.values()].every(
			(a) => a.systemPrompt.length > 200 && !a.systemPrompt.startsWith('---'),
		),
		'every system prompt is the body, without the frontmatter',
	);
}

console.log('tool catalogue');
{
	const both = ADAPTER_OPS.filter((op) => (WORKER_TOOLS as readonly string[]).includes(op));
	check(both.length === 0, 'no tool is both an adapter op and a worker tool', ` — ${both.join()}`);
	const shape = [...KNOWN_TOOLS].filter((id) => !/^[a-z]+\.[a-z_]+$/.test(id));
	check(shape.length === 0, 'every tool id is <tool>.<op> in lower case', ` — ${shape.join()}`);
}

console.log('valid fixtures');
{
	const agents = loadAgents(here('fixtures/agents/valid'), catalog);
	const reviewer = agents.get('reviewer');
	check(
		JSON.stringify(reviewer) ===
			JSON.stringify({
				name: 'reviewer',
				model: 'claude-sonnet-5-5',
				effort: 'medium',
				role: 'A fixture agent: reviews variants.',
				tools: ['atlas.list_variants', 'run.post_activity'],
				inputs: "A region's variants.",
				outputs: 'A pick per region.',
				systemPrompt: 'You review variants. This is a fixture, not a real agent.',
			}),
		'every field is read, a quoted value unquoted',
		` — ${JSON.stringify(reviewer)}`,
	);
	check(agents.get('checker')?.effort === null, 'effort may be left out');
}

console.log('refused fixtures');
{
	const badModel = throws(() => loadAgents(here('fixtures/agents/bad-model'), catalog));
	check(
		badModel.includes('painter.md: model: claude-imaginary-9 is not in pricing.json'),
		'an unknown model is refused',
		` — ${badModel}`,
	);
	const badTool = throws(() => loadAgents(here('fixtures/agents/bad-tool'), catalog));
	check(
		badTool.includes('publisher.md: tools: gamemaker.publish is not a known tool') &&
			!badTool.includes('run.post_activity'),
		'an unknown tool is refused, and only it',
		` — ${badTool}`,
	);
}

console.log('malformed definitions');
{
	const base = {
		name: 'name: probe',
		model: 'model: claude-sonnet-5-5',
		effort: 'effort: medium',
		role: 'role: Probe.',
		tools: 'tools:\n  - run.post_activity',
		inputs: 'inputs: In.',
		outputs: 'outputs: Out.',
	};
	const doc = (front: Record<string, string>, body = 'Prompt.') =>
		`---\n${Object.values(front).join('\n')}\n---\n\n${body}\n`;
	const errorsOf = (text: string, file = 'probe.md') => {
		const result = parseAgent(file, text, catalog);
		return result.ok ? [] : result.errors;
	};
	const refuses = (msg: string, text: string, expected: string, file?: string) => {
		const errors = errorsOf(text, file);
		check(
			errors.some((e) => e.includes(expected)),
			msg,
			` — expected "${expected}", got ${JSON.stringify(errors)}`,
		);
	};

	check(errorsOf(doc(base)).length === 0, 'the probe itself is valid', ` — ${errorsOf(doc(base))}`);
	refuses('no frontmatter', 'Prompt only.\n', 'expected "---"');
	refuses('an unclosed frontmatter', '---\nname: probe\n', 'no closing');
	refuses('a missing key', doc({ ...base, role: '' }), 'role: required');
	refuses('an unknown key', doc({ ...base, extra: 'temperature: 1' }), 'temperature: unknown key');
	refuses('a key set twice', doc({ ...base, again: 'model: claude-sonnet-5-5' }), 'set twice');
	refuses('a name that is not the file name', doc(base), 'does not match other.md', 'other.md');
	refuses('an unknown effort', doc({ ...base, effort: 'effort: extreme' }), 'effort: extreme');
	refuses('a list where a value goes', doc({ ...base, model: 'model:\n  - a' }), 'not a list');
	refuses(
		'a value where a list goes',
		doc({ ...base, tools: 'tools: run.post_activity' }),
		'expected a list',
	);
	refuses('an empty tool list', doc({ ...base, tools: 'tools:' }), 'tools: empty');
	refuses(
		'a tool listed twice',
		doc({ ...base, tools: 'tools:\n  - run.post_activity\n  - run.post_activity' }),
		'listed twice',
	);
	refuses('flow-style YAML', doc({ ...base, tools: 'tools: [run.post_activity]' }), 'YAML syntax');
	refuses('a block scalar', doc({ ...base, role: 'role: |' }), 'YAML syntax');
	refuses('nesting', doc({ ...base, inputs: 'inputs:\n  run: x' }), 'line 9:');
	refuses('an empty system prompt', doc(base, ''), 'system prompt');
	const all = errorsOf(doc({ ...base, model: 'model: nope', tools: 'tools:\n  - nope.op' }));
	check(all.length === 2, 'every problem is reported at once, not just the first', ` — ${all}`);
}

if (failures > 0) {
	console.log(`\n${failures} check(s) failed.`);
	process.exit(1);
}
console.log('\nagent definitions load and validate.');
