import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import { error } from '@sveltejs/kit';
import { ASK_AI_MAX_CHARS, type AskAiEvent, type AskAiMessage } from '$lib/askAi';
import { TOOLS, manifestForRole, roleHasTool, toolDocSlug, type ToolDef } from '$lib/roles';
import { ENV } from './env';
import { getRoleOverrides } from './roleToolAccess';
import { toolAgents, toolGuide } from './toolGuides';
import { getToolOverrides } from './userToolAccess';

/**
 * "Ask the AI" — the chat on every tool's bar. Claude answers as the tool's own agent
 * (`docs/knowledge/owners.json`), grounded in the tool's user guide (`docs/tools/<slug>.md`), so
 * a new user can find out how to do something in the tool they have open. Read-only: it acts on
 * nothing and sees no project data.
 */
const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 2048;
const MAX_MESSAGES = 40;

export interface AskAiRequest {
	tool: ToolDef;
	messages: AskAiMessage[];
	/** The tools the asker can open, to point them at another one when it fits better. */
	otherTools: ToolDef[];
	projectKey?: string;
}

function isMessage(v: unknown): v is AskAiMessage {
	if (!v || typeof v !== 'object') return false;
	const m = v as Record<string, unknown>;
	return (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
}

/** Validate the body and the asker's access: they must have the tool they ask about. */
export async function readAskAiRequest(locals: App.Locals, body: unknown): Promise<AskAiRequest> {
	if (!locals.user) throw error(401, 'Not authenticated');
	if (!ENV.ANTHROPIC_API_KEY) throw error(503, 'Ask the AI is not configured on this server.');
	const b = (body ?? {}) as Record<string, unknown>;
	const tool = typeof b.tool === 'string' ? TOOLS[b.tool] : undefined;
	if (!tool) throw error(400, 'Say which tool the question is about.');

	const { role } = locals.user;
	const [roleOverrides, userOverrides] = await Promise.all([
		getRoleOverrides(role),
		getToolOverrides(locals.user.id),
	]);
	if (!roleHasTool(role, tool.id, roleOverrides, userOverrides)) {
		throw error(403, `Your role does not have access to ${tool.name}.`);
	}

	const raw = Array.isArray(b.messages) ? b.messages : [];
	if (!raw.length || raw.length > MAX_MESSAGES || !raw.every(isMessage)) {
		throw error(400, `Send 1–${MAX_MESSAGES} messages of { role, content }.`);
	}
	const messages = raw.map((m) => ({ role: m.role, content: m.content.trim() }));
	// An answer runs up to MAX_TOKENS, so it gets more room than a question.
	const limit = (m: AskAiMessage) => (m.role === 'user' ? ASK_AI_MAX_CHARS : ASK_AI_MAX_CHARS * 4);
	if (messages.some((m) => !m.content || m.content.length > limit(m))) {
		throw error(400, `Each question must be 1–${ASK_AI_MAX_CHARS} characters.`);
	}
	if (messages.some((m, i) => m.role !== (i % 2 === 0 ? 'user' : 'assistant'))) {
		throw error(400, 'Messages must alternate, starting and ending with a question.');
	}
	if (messages[messages.length - 1].role !== 'user') {
		throw error(400, 'The last message must be a question.');
	}

	const otherTools = manifestForRole(role, roleOverrides, userOverrides).filter(
		(t) => t.id !== tool.id && t.kind === 'online',
	);
	const projectKey =
		typeof b.project === 'string' && b.project.length <= 200 ? b.project : undefined;
	return { tool, messages, otherTools, projectKey };
}

function instructions(req: AskAiRequest): string {
	const agents = toolAgents(req.tool.id);
	const persona = agents.length
		? `You speak for ${agents.map((a) => `the \`${a.name}\` agent`).join(' and ')}, the team's expert on this tool: ${agents.map((a) => a.description).join(' ')}`
		: 'You are the team expert on this tool.';
	return [
		`You are "Ask the AI", the in-tool help chat of ${req.tool.name} (${req.tool.description}), part of the Invisible Wall studio pipeline.`,
		persona,
		"The person asking has this tool open in their browser and is learning how to use it. Explain how to achieve what they ask IN THE TOOL'S UI: which panel, button, field or shortcut, step by step.",
		"Ground every answer in the tool guide below. Use the guide's own names for buttons and panels. Never invent a control, a menu or a feature the guide does not describe; when the guide does not cover the question, say so plainly and suggest asking a teammate, or using the Report bug button beside this chat if something looks broken.",
		'When another tool does the job better, name it and its guide link. Code, file paths and internal architecture are for developers: mention them only when the person asks.',
		'Be concise: short paragraphs or numbered steps in Markdown. Answer in the language the person writes in.',
		req.projectKey ? `The project open in the tool is \`${req.projectKey}\`.` : '',
	]
		.filter(Boolean)
		.join('\n\n');
}

function otherToolsBlock(req: AskAiRequest): string {
	const lines = req.otherTools.map(
		(t) => `- ${t.name} — ${t.description} (guide: /docs/${toolDocSlug(t.id)})`,
	);
	return lines.length ? `Other tools this person can open:\n${lines.join('\n')}` : '';
}

function guideBlock(tool: ToolDef): string {
	const slug = toolDocSlug(tool.id);
	const guide = toolGuide(slug);
	return guide
		? `The ${tool.name} guide (/docs/${slug}):\n\n<guide>\n${guide}\n</guide>`
		: `${tool.name} has no written guide yet: say so when a question needs one.`;
}

function systemBlocks(req: AskAiRequest): Anthropic.TextBlockParam[] {
	const texts = [instructions(req), otherToolsBlock(req), guideBlock(req.tool)].filter(Boolean);
	return texts.map((text, i) =>
		i === texts.length - 1
			? { type: 'text', text, cache_control: { type: 'ephemeral' } }
			: { type: 'text', text },
	);
}

/** The answer as an NDJSON stream of `AskAiEvent`s; cancelling it (the asker left) stops Claude. */
export function askAiStream(req: AskAiRequest): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const client = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });
	let stream: MessageStream | undefined;
	let cancelled = false;
	return new ReadableStream({
		async start(controller) {
			const send = (event: AskAiEvent) => {
				if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			};
			try {
				stream = client.messages.stream({
					model: MODEL,
					max_tokens: MAX_TOKENS,
					system: systemBlocks(req),
					messages: req.messages,
				});
				stream.on('text', (v: string) => send({ t: 'text', v }));
				await stream.finalMessage();
				send({ t: 'done' });
			} catch (err) {
				if (!cancelled) {
					console.error('[ask-ai]', err);
					send({ t: 'error', v: 'The AI could not answer just now. Try again in a moment.' });
				}
			} finally {
				if (!cancelled) controller.close();
			}
		},
		cancel() {
			cancelled = true;
			stream?.abort();
		},
	});
}
