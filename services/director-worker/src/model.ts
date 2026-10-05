import Anthropic from '@anthropic-ai/sdk';
import type {
	BetaMessage,
	BetaMessageParam,
	BetaMessageStreamParams,
	BetaTool,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AgentDefinition } from './agents.ts';

/**
 * How one agent turn is asked of the model (ADR-0001): one streamed Messages call, built only from
 * the agent's definition, the tools it may use and its stored conversation.
 *
 * - `tool_choice: auto` with `strict` tools: forced tool choice is a 400 on Opus 5.5 and Sonnet 5.5.
 * - Thinking: adaptive with the definition's `effort` on the 5.5 models; a token budget on Haiku 4.5.
 * - Refusals: the server-side fallback (`fallbacks: "default"`) on the 5.5 models. A refusal that
 *   survives it is the turn's final answer, and the run pauses on it.
 * - Caching: the tools and the system prompt are the prefix, byte-stable for an agent — nothing
 *   run-specific or time-dependent is in either — with a breakpoint on the system block; the
 *   top-level breakpoint caches the conversation so far. 5-minute TTL (OPEN_QUESTIONS #1044).
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

interface ModelProfile {
	maxTokens: number;
	thinking: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number };
	/** Takes `output_config.effort` from the definition. */
	effort: boolean;
	/** Takes the server-side refusal fallback. */
	fallbacks: boolean;
}

const PROFILES: Record<string, ModelProfile> = {
	'claude-opus-5-5': {
		maxTokens: 64_000,
		thinking: { type: 'adaptive' },
		effort: true,
		fallbacks: true,
	},
	'claude-sonnet-5-5': {
		maxTokens: 64_000,
		thinking: { type: 'adaptive' },
		effort: true,
		fallbacks: true,
	},
	'claude-haiku-4-5-20251001': {
		maxTokens: 32_000,
		thinking: { type: 'enabled', budget_tokens: 8_000 },
		effort: false,
		fallbacks: false,
	},
};

/** The model's request profile; throws for a model the worker does not know how to call. */
export function modelProfile(model: string): ModelProfile {
	const profile = Object.hasOwn(PROFILES, model) ? PROFILES[model] : undefined;
	if (!profile) throw new Error(`no request profile for model ${model} (src/model.ts)`);
	return profile;
}

/** A tool as the worker knows it: a served adapter op or one of its own run tools. */
export interface ToolSpec {
	/** `<tool>.<op>`, as agent frontmatter names it. */
	id: string;
	description: string;
	inputSchema: JsonSchema;
}

export type JsonSchema = { [key: string]: unknown };

/** API tool names allow no dots: `atlas.queue_variants` → `atlas__queue_variants`. */
export const toolName = (id: string) => id.replace('.', '__');
export const toolId = (name: string) => name.replace('__', '.');

/** Keywords strict tool schemas reject; the launcher's gate still enforces them on every call. */
const UNSUPPORTED = ['pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'maxItems'];

/**
 * A schema strict tool use accepts: the unsupported constraints are moved into the description,
 * where the model still reads them, and every nested object stays closed.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
	const out: JsonSchema = {};
	const notes: string[] = [];
	for (const [key, value] of Object.entries(schema)) {
		if (UNSUPPORTED.includes(key)) notes.push(`${key}: ${JSON.stringify(value)}`);
		else if (key === 'properties' && value && typeof value === 'object') {
			out.properties = Object.fromEntries(
				Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, strictSchema(v)]),
			);
		} else if (key === 'items' && value && typeof value === 'object') {
			out.items = strictSchema(value as JsonSchema);
		} else out[key] = value;
	}
	if (notes.length) {
		const base = typeof out.description === 'string' ? `${out.description} ` : '';
		out.description = `${base}(${notes.join('; ')})`;
	}
	if (out.type === 'object') out.additionalProperties = false;
	return out;
}

export function apiTool(spec: ToolSpec): BetaTool {
	return {
		name: toolName(spec.id),
		description: spec.description,
		input_schema: strictSchema(spec.inputSchema) as BetaTool['input_schema'],
		strict: true,
	};
}

/** The request for one turn. `tools` must be in the definition's order (a stable prefix). */
export function buildRequest(
	agent: AgentDefinition,
	tools: readonly ToolSpec[],
	messages: BetaMessageParam[],
): BetaMessageStreamParams {
	const profile = modelProfile(agent.model);
	const request: BetaMessageStreamParams = {
		model: agent.model,
		max_tokens: profile.maxTokens,
		thinking: profile.thinking,
		tool_choice: { type: 'auto' },
		tools: tools.map(apiTool),
		system: [{ type: 'text', text: agent.systemPrompt, cache_control: { type: 'ephemeral' } }],
		cache_control: { type: 'ephemeral' },
		messages,
	};
	if (profile.effort && agent.effort) request.output_config = { effort: agent.effort };
	if (profile.fallbacks) {
		request.fallbacks = 'default';
		request.betas = [FALLBACK_BETA];
	}
	return request;
}

/** The one seam to the Messages API, so tests run the loop on a fake. */
export interface ModelTransport {
	send(request: BetaMessageStreamParams, signal: AbortSignal): Promise<BetaMessage>;
}

/** The real transport: a streamed call (long turns never hit an HTTP timeout), final message. */
export function anthropicTransport(apiKey: string): ModelTransport {
	const client = new Anthropic({ apiKey });
	return {
		send: (request, signal) => client.beta.messages.stream(request, { signal }).finalMessage(),
	};
}
