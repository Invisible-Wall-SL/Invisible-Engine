/** One turn of an "Ask the AI" chat (`$lib/AskAiPanel.svelte` ↔ `/api/ask-ai`). */
export interface AskAiMessage {
	role: 'user' | 'assistant';
	content: string;
}

/** One line of the answer stream (NDJSON): text as it arrives, then `done` or `error`. */
export type AskAiEvent = { t: 'text'; v: string } | { t: 'done' } | { t: 'error'; v: string };

/** The longest question (and answer) the chat sends back to the server. */
export const ASK_AI_MAX_CHARS = 8000;
