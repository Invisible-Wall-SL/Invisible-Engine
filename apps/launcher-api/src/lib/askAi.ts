/** One turn of an "Ask the AI" chat (`$lib/AskAiPanel.svelte` ↔ `/api/ask-ai`). */
export interface AskAiMessage {
	role: 'user' | 'assistant';
	content: string;
}

/** One line of the answer stream (NDJSON): text as it arrives, then `done` or `error`. */
export type AskAiEvent = { t: 'text'; v: string } | { t: 'done' } | { t: 'error'; v: string };

/** The longest question (and answer) the chat sends back to the server. */
export const ASK_AI_MAX_CHARS = 8000;

/**
 * The longest alternating question/answer run that ends on an answer. A chat closed mid-answer
 * stores its unanswered question, and the next question would then be refused (turns must
 * alternate), so a stored chat is read back through this.
 */
export function settledChat(list: unknown): AskAiMessage[] {
	const out: AskAiMessage[] = [];
	for (const [i, m] of (Array.isArray(list) ? list : []).entries()) {
		const role = i % 2 ? 'assistant' : 'user';
		if (!m || typeof m !== 'object' || m.role !== role || typeof m.content !== 'string') break;
		out.push({ role, content: m.content });
	}
	if (out.length % 2) out.pop();
	return out;
}
