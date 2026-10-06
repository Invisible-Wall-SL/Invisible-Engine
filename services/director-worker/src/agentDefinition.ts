/**
 * One runtime-agent definition, parsed and validated (ADR-0001): `agents/<name>.md` is YAML
 * frontmatter plus the system prompt as the body. This is the PURE half of the loader: no file
 * system, no imports, only erasable TypeScript — so the launcher's Agents tab (PLAN 5.4) runs the
 * same parser in the browser, as a preview, and on the server, as the gate, and an edit the worker
 * would refuse at boot can never be submitted. `agents.ts` adds the directory walk and the model
 * catalogue; both import from here.
 *
 * The frontmatter is read with a strict parser for the one shape these files use — `key: value`
 * scalars and `key:` followed by `  - item` lists. Anything else (nesting, anchors, flow syntax,
 * block scalars) is an error naming its line, rather than a value the loader half-understood.
 */

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface AgentDefinition {
	name: string;
	model: string;
	/** Null for a model steered with a thinking budget instead (Haiku, ADR-0001). */
	effort: Effort | null;
	role: string;
	tools: string[];
	inputs: string;
	outputs: string;
	systemPrompt: string;
}

export interface AgentCatalog {
	/** Model ids the worker can price: the keys of `pricing.json` `perMTok`. */
	models: ReadonlySet<string>;
	/** Tool ids an agent may name (`tools.ts`). */
	tools: ReadonlySet<string>;
}

export type ParseResult = { ok: true; agent: AgentDefinition } | { ok: false; errors: string[] };

type Frontmatter = Map<string, string | string[]>;

/** The keys a definition may carry, in the order the files write them. */
export const AGENT_KEYS = [
	'name',
	'model',
	'effort',
	'role',
	'tools',
	'inputs',
	'outputs',
] as const;
const OPTIONAL_KEYS = new Set<string>(['effort']);

/** The file name of a definition: its agent's name. */
const fileName = (file: string): string => file.split(/[\\/]/).pop() ?? file;

function unquote(value: string): string {
	const q = value[0];
	return (q === '"' || q === "'") && value.length >= 2 && value.at(-1) === q
		? value.slice(1, -1)
		: value;
}

function parseFrontmatter(text: string): { front: Frontmatter; body: string; errors: string[] } {
	const errors: string[] = [];
	const front: Frontmatter = new Map();
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	if (lines[0] !== '---') return { front, body: '', errors: ['line 1: expected "---"'] };
	const end = lines.indexOf('---', 1);
	if (end < 0) return { front, body: '', errors: ['frontmatter has no closing "---"'] };

	let list: string[] | null = null;
	for (let i = 1; i < end; i++) {
		const line = lines[i];
		const at = `line ${i + 1}`;
		if (line.trim() === '') continue;
		const item = /^\s+-\s+(\S.*)$/.exec(line);
		if (item) {
			if (list) list.push(unquote(item[1].trim()));
			else errors.push(`${at}: list item outside a list`);
			continue;
		}
		const pair = /^([a-z][a-z_]*):(?:\s+(\S.*))?$/.exec(line);
		if (!pair) {
			errors.push(`${at}: expected "key: value", "key:" or "  - item"`);
			list = null;
			continue;
		}
		const [, key, raw] = pair;
		if (front.has(key)) errors.push(`${at}: ${key} is set twice`);
		if (raw === undefined) {
			list = [];
			front.set(key, list);
		} else {
			list = null;
			const value = raw.trim();
			if (/^[[{|>&*!]/.test(value))
				errors.push(`${at}: ${key} uses YAML syntax the loader refuses`);
			front.set(key, unquote(value));
		}
	}
	return {
		front,
		body: lines
			.slice(end + 1)
			.join('\n')
			.trim(),
		errors,
	};
}

/** Parse and validate one definition. `file` is its file name; the agent's name must match it. */
export function parseAgent(file: string, text: string, catalog: AgentCatalog): ParseResult {
	const { front, body, errors } = parseFrontmatter(text);
	const string = (key: string): string => {
		const value = front.get(key);
		if (value === undefined) {
			if (!OPTIONAL_KEYS.has(key)) errors.push(`${key}: required`);
			return '';
		}
		if (typeof value !== 'string') {
			errors.push(`${key}: expected a single value, not a list`);
			return '';
		}
		if (!value) errors.push(`${key}: empty`);
		return value;
	};

	for (const key of front.keys()) {
		if (!(AGENT_KEYS as readonly string[]).includes(key)) errors.push(`${key}: unknown key`);
	}

	const name = string('name');
	if (name && !/^[a-z][a-z-]*$/.test(name)) errors.push(`name: ${name} is not lower-case-kebab`);
	if (name && `${name}.md` !== fileName(file)) {
		errors.push(`name: ${name} does not match ${fileName(file)}`);
	}

	const model = string('model');
	if (model && !catalog.models.has(model)) {
		errors.push(`model: ${model} is not in pricing.json`);
	}

	let effort: Effort | null = null;
	if (front.has('effort')) {
		const value = string('effort');
		if ((EFFORTS as readonly string[]).includes(value)) effort = value as Effort;
		else errors.push(`effort: ${value} is not one of ${EFFORTS.join(', ')}`);
	}

	const role = string('role');
	const inputs = string('inputs');
	const outputs = string('outputs');

	const rawTools = front.get('tools');
	const tools = Array.isArray(rawTools) ? rawTools : [];
	if (rawTools === undefined) errors.push('tools: required');
	else if (!Array.isArray(rawTools)) errors.push('tools: expected a list');
	else if (tools.length === 0) errors.push('tools: empty');
	for (const tool of tools) {
		if (!catalog.tools.has(tool)) errors.push(`tools: ${tool} is not a known tool`);
	}
	for (const tool of new Set(tools.filter((t, i) => tools.indexOf(t) !== i))) {
		errors.push(`tools: ${tool} is listed twice`);
	}

	if (!body) errors.push('the system prompt (the body after the frontmatter) is empty');

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		agent: { name, model, effort, role, tools, inputs, outputs, systemPrompt: body },
	};
}
