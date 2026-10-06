import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgent, type AgentCatalog, type AgentDefinition } from './agentDefinition.ts';

/**
 * Runtime-agent definitions (ADR-0001): `agents/<name>.md`, YAML frontmatter plus the system prompt
 * as the body. Loaded once at boot; a definition that fails validation stops the worker booting, so
 * a bad edit never reaches a run. The parser itself is `agentDefinition.ts` (pure, shared with the
 * launcher's Agents tab); this file adds the directory walk and the model catalogue.
 */

export {
	AGENT_KEYS,
	AGENT_NAME,
	EFFORTS,
	parseAgent,
	type AgentCatalog,
	type AgentDefinition,
	type Effort,
	type ParseResult,
} from './agentDefinition.ts';

/** The model ids `pricing.json` prices. */
export function pricedModels(pricingPath: string): ReadonlySet<string> {
	const pricing = JSON.parse(readFileSync(pricingPath, 'utf8')) as { perMTok?: unknown };
	if (typeof pricing.perMTok !== 'object' || pricing.perMTok === null) {
		throw new Error(`${pricingPath}: perMTok is missing`);
	}
	return new Set(Object.keys(pricing.perMTok));
}

/** Load every `*.md` in `dir`, throwing one error that lists every problem in every file. */
export function loadAgents(dir: string, catalog: AgentCatalog): Map<string, AgentDefinition> {
	const agents = new Map<string, AgentDefinition>();
	const problems: string[] = [];
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.md'))
		.sort();
	if (files.length === 0) problems.push(`${dir}: no agent definitions`);
	for (const file of files) {
		const result = parseAgent(file, readFileSync(join(dir, file), 'utf8'), catalog);
		if (result.ok) agents.set(result.agent.name, result.agent);
		else problems.push(...result.errors.map((e) => `${file}: ${e}`));
	}
	if (problems.length > 0) {
		throw new Error(`Invalid agent definitions:\n  ${problems.join('\n  ')}`);
	}
	return agents;
}
