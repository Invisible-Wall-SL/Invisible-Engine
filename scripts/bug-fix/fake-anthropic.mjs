// A stand-in for the Anthropic Messages API, for proving what the pinned Claude Code CLI does with
// the tool calls a model makes (prove-cli.mjs). The CLI is pointed at it with ANTHROPIC_BASE_URL;
// a script decides each answer from the conversation so far, so a "model" can be made to try
// exactly what a hostile bug report would steer a real one to try, at no cost, every time.
//
// Every request is recorded: its path, the headers the proof reads (the API key the CLI sent), and
// its body — whose messages carry the tool results the CLI reports back, which is where the proof
// reads what a command saw.

import { createServer } from 'node:http';

/**
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'tool_use', id?: string, name: string, input: Record<string, unknown> }} Block
 * @typedef {{ blocks: Block[], usage?: Partial<Usage> }} Reply
 * @typedef {{ input_tokens: number, output_tokens: number, cache_read_input_tokens: number,
 *   cache_creation_input_tokens: number }} Usage
 * @typedef {{ path: string, apiKey: string | null, authorization: string | null, body: any }} Recorded
 */

const USAGE = {
	input_tokens: 10,
	output_tokens: 5,
	cache_read_input_tokens: 0,
	cache_creation_input_tokens: 0,
};

/** The text of a message's content, whatever its shape: tool results and text blocks joined. */
export function textOf(content) {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((b) => {
			if (b?.type === 'text') return b.text ?? '';
			if (b?.type === 'tool_result') return textOf(b.content);
			return '';
		})
		.join('\n');
}

/** The first user message's text: what tells one conversation (main or a sub-agent) from another. */
export const openingOf = (body) => textOf(body?.messages?.[0]?.content);

/** How many turns the assistant has already taken in this conversation. */
export const turnOf = (body) =>
	(body?.messages ?? []).filter((m) => m?.role === 'assistant').length;

/** The tool results of the last user message, by the tool_use id they answer. */
export function lastResults(body) {
	const last = (body?.messages ?? []).at(-1);
	const out = new Map();
	if (last?.role !== 'user' || !Array.isArray(last.content)) return out;
	for (const b of last.content) {
		if (b?.type === 'tool_result') {
			out.set(b.tool_use_id, { text: textOf(b.content), isError: b.is_error === true });
		}
	}
	return out;
}

let ids = 0;
const nextId = (prefix) => `${prefix}_${(++ids).toString(36).padStart(8, '0')}`;

function sse(res, event, data) {
	res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function answer(res, body, reply) {
	const usage = { ...USAGE, ...reply.usage };
	const content = reply.blocks.map((b) =>
		b.type === 'tool_use'
			? { type: 'tool_use', id: b.id ?? nextId('toolu'), name: b.name, input: b.input }
			: { type: 'text', text: b.text },
	);
	const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
	const message = {
		id: nextId('msg'),
		type: 'message',
		role: 'assistant',
		model: body.model,
		content,
		stop_reason: stop,
		stop_sequence: null,
		usage,
	};
	if (!body.stream) {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify(message));
		return;
	}
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
	sse(res, 'message_start', {
		type: 'message_start',
		message: { ...message, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } },
	});
	content.forEach((b, index) => {
		if (b.type === 'tool_use') {
			sse(res, 'content_block_start', {
				type: 'content_block_start',
				index,
				content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} },
			});
			sse(res, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
			});
		} else {
			sse(res, 'content_block_start', {
				type: 'content_block_start',
				index,
				content_block: { type: 'text', text: '' },
			});
			sse(res, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'text_delta', text: b.text },
			});
		}
		sse(res, 'content_block_stop', { type: 'content_block_stop', index });
	});
	sse(res, 'message_delta', {
		type: 'message_delta',
		delta: { stop_reason: stop, stop_sequence: null },
		usage: { output_tokens: usage.output_tokens },
	});
	sse(res, 'message_stop', { type: 'message_stop' });
	res.end();
}

/**
 * Listen on 127.0.0.1. `script(body)` answers each Messages request (null: a plain "ok"), and
 * every request lands in `requests`.
 *
 * @param {(body: any) => Reply | null} script
 * @returns {Promise<{ url: string, requests: Recorded[], close: () => Promise<void> }>}
 */
export async function startFakeAnthropic(script) {
	/** @type {Recorded[]} */
	const requests = [];
	const server = createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			let body = null;
			try {
				body = raw ? JSON.parse(raw) : null;
			} catch {
				body = { unparsed: raw.slice(0, 2000) };
			}
			const path = (req.url ?? '').split('?')[0];
			requests.push({
				path,
				apiKey: req.headers['x-api-key'] ?? null,
				authorization: req.headers.authorization ?? null,
				body,
			});
			if (req.method === 'POST' && path === '/v1/messages/count_tokens') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ input_tokens: 100 }));
				return;
			}
			if (req.method === 'POST' && path === '/v1/messages') {
				let reply;
				try {
					reply = script(body) ?? { blocks: [{ type: 'text', text: 'ok' }] };
				} catch (err) {
					reply = { blocks: [{ type: 'text', text: `script error: ${err}` }] };
				}
				answer(res, body, reply);
				return;
			}
			res.writeHead(404, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: path } }));
		});
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		close: () =>
			new Promise((done) => {
				server.closeAllConnections?.();
				server.close(() => done());
			}),
	};
}
