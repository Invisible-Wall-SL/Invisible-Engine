import {
	AGENT_NAME,
	parseAgent,
	type AgentDefinition,
} from '../../../../services/director-worker/src/agentDefinition';

/**
 * Whether an edited runtime-agent definition can be submitted as a pipeline change (ADR-0007
 * "Agents tab"; PLAN 5.4). Pure and browser-safe, so the editor previews the SAME verdict the
 * server gives on submit:
 *
 * 1. the worker's own loader (`services/director-worker/src/agentDefinition.ts`): a definition the
 *    worker would refuse at boot — an unknown key, model or tool, a bad effort, an empty prompt —
 *    is refused here with the loader's own words;
 * 2. the adapter allow-lists `check:director-adapters` pins: each adapter op is served to the
 *    agents its registry entry names, and that fixture holds every definition's `tools:` to that
 *    list, both ways. A change that adds or drops an adapter op is therefore a launcher change too
 *    (the registry's allow-list), not a definition-only change this tab can open: it would fail
 *    CI, so it is refused before a branch exists.
 *
 * The rules themselves (`AgentEditRules`) come from the server, which reads pricing.json, the
 * worker's tool catalogue and the launcher's registry; nothing here hard-codes a model or a tool.
 */

export interface AgentEditRules {
	/** Model ids the worker can run: `pricing.json` prices them and `model.ts` has a profile. */
	models: string[];
	/** Every tool id an agent may name (`tools.ts`). */
	tools: string[];
	/** Adapter ops whose allow-list names this agent: the definition must name exactly these. */
	fixedAdapterTools: string[];
	/** Registered adapter ops whose allow-list does not name this agent. */
	otherAdapterTools: string[];
	/** Adapter ops in transition (ADR-0008 card 8D): named all together, or none of them. */
	transitionTools?: string[];
}

export type AgentEditVerdict =
	{ ok: true; agent: AgentDefinition; errors: [] } | { ok: false; agent: null; errors: string[] };

/** The file the definition lives in. */
export const agentPath = (name: string): string => `services/director-worker/agents/${name}.md`;

export { AGENT_NAME };

/** The one-line reason the PR carries in its title; one line, within the title GitHub shows. */
export const WHY_MAX = 120;

export function whyProblem(why: string): string | null {
	const trimmed = why.trim();
	if (!trimmed) return 'Say in one line why the definition changes.';
	if (/[\r\n]/.test(trimmed)) return 'The reason is one line.';
	if (trimmed.length > WHY_MAX) return `The reason is at most ${WHY_MAX} characters.`;
	return null;
}

export function validateAgentEdit(
	name: string,
	text: string,
	rules: AgentEditRules,
): AgentEditVerdict {
	const parsed = parseAgent(`${name}.md`, text, {
		models: new Set(rules.models),
		tools: new Set(rules.tools),
	});
	if (!parsed.ok) return { ok: false, agent: null, errors: parsed.errors };
	const errors: string[] = [];
	const named = new Set(parsed.agent.tools);
	for (const id of rules.fixedAdapterTools) {
		if (!named.has(id)) {
			errors.push(
				`tools: ${id} is served to ${name} (the launcher's adapter allow-list); dropping it is a launcher change, not a definition change`,
			);
		}
	}
	for (const id of rules.otherAdapterTools) {
		if (named.has(id)) {
			errors.push(
				`tools: ${id} is not served to ${name} (the launcher's adapter allow-list); adding it is a launcher change, not a definition change`,
			);
		}
	}
	const moving = rules.transitionTools ?? [];
	const kept = moving.filter((id) => named.has(id));
	if (kept.length && kept.length !== moving.length) {
		errors.push(
			`tools: ${kept.join(', ')} and ${moving.filter((id) => !named.has(id)).join(', ')} go together (the definition as main holds it, or the new one)`,
		);
	}
	if (errors.length) return { ok: false, agent: null, errors };
	return { ok: true, agent: parsed.agent, errors: [] };
}
