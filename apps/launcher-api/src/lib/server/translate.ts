import Anthropic from '@anthropic-ai/sdk';
import { ENV } from './env';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

/** One string to translate: stable `id` + the source text. */
export interface TranslateItem {
	id: string;
	source: string;
}

export interface TranslateInput {
	sourceLang: string;
	targetLangs: string[];
	context: string;
	items: TranslateItem[];
}

/** `id -> { lang -> translated text }` for every requested item/language. */
export type TranslateResult = Record<string, Record<string, string>>;

export class TranslateError extends Error {}

const BASE_INSTRUCTIONS = [
	'You are a professional video-game localization engine.',
	'You translate short UI/game strings from a source language into one or more target languages.',
	'Preserve placeholders, markup and escape sequences exactly (e.g. {0}, %s, \\n, <b>…</b>).',
	'Keep the original tone and length budget; do not add commentary.',
	'Respond with STRICT JSON only — no prose, no markdown fences.',
	'The JSON shape is: { "<entryId>": { "<langCode>": "<translation>" } }.',
	'Include every entry id and every requested target language. Use the exact ids and language codes given.',
].join('\n');

function contextBlock(context: string): string {
	return `Project context / glossary (apply consistently):\n${context.trim()}`;
}

function systemBlocks(context: string): Anthropic.MessageCreateParams['system'] {
	const blocks: Anthropic.TextBlockParam[] = [
		{
			type: 'text',
			text: BASE_INSTRUCTIONS,
			cache_control: { type: 'ephemeral' },
		},
	];
	if (context.trim()) {
		blocks.push({
			type: 'text',
			text: contextBlock(context),
			cache_control: { type: 'ephemeral' },
		});
	}
	return blocks;
}

/** The same system prompt flattened into one message, for OpenAI-shaped APIs. */
function systemText(context: string): string {
	return context.trim() ? `${BASE_INSTRUCTIONS}\n\n${contextBlock(context)}` : BASE_INSTRUCTIONS;
}

function userText(input: TranslateInput): string {
	const payload = {
		sourceLang: input.sourceLang,
		targetLangs: input.targetLangs,
		entries: input.items.map((i) => ({ id: i.id, text: i.source })),
	};
	return `Translate these strings. Input:\n${JSON.stringify(payload)}`;
}

/** Extract the first balanced JSON object from a model response. */
function extractJson(text: string): string {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		throw new TranslateError('Model response contained no JSON object.');
	}
	return text.slice(start, end + 1);
}

/**
 * Narrow a raw model response to `id -> lang -> text`, dropping anything the model
 * invented: only requested ids and requested language codes survive, and only when
 * the value is a string. Throws when nothing usable is left.
 */
function shapeResult(text: string, input: TranslateInput): TranslateResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(extractJson(text));
	} catch {
		throw new TranslateError('Could not parse the translation response as JSON.');
	}

	const result: TranslateResult = {};
	const obj = (parsed ?? {}) as Record<string, unknown>;
	for (const item of input.items) {
		const row = obj[item.id];
		if (!row || typeof row !== 'object') continue;
		const langs = row as Record<string, unknown>;
		const out: Record<string, string> = {};
		for (const lang of input.targetLangs) {
			const value = langs[lang];
			if (typeof value === 'string') out[lang] = value;
		}
		if (Object.keys(out).length > 0) result[item.id] = out;
	}

	if (Object.keys(result).length === 0) {
		throw new TranslateError('The translation response had no usable entries.');
	}
	return result;
}

/** Translate the batch in a SINGLE Anthropic request, with a prompt-cached system prompt. */
async function translateWithAnthropic(input: TranslateInput): Promise<TranslateResult> {
	const client = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });
	const message = await client.messages.create({
		model: ANTHROPIC_MODEL,
		max_tokens: MAX_TOKENS,
		system: systemBlocks(input.context),
		messages: [{ role: 'user', content: userText(input) }],
	});
	const text = message.content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('');
	return shapeResult(text, input);
}

interface ChatCompletion {
	choices?: { message?: { content?: string | null } }[];
}

/**
 * Translate the batch through any OpenAI-compatible `/chat/completions` endpoint
 * (Google AI Studio, OpenRouter, Groq, …). Kept dependency-free — the wire shape is
 * small enough that pulling in a second SDK would cost more than it saves.
 *
 * `response_format` markedly improves JSON adherence where it's supported but is
 * rejected outright by some providers/models, so a 400 retries once without it
 * rather than failing the batch (`shapeResult` tolerates fenced//prose-wrapped JSON).
 */
async function translateWithOpenAICompatible(input: TranslateInput): Promise<TranslateResult> {
	const url = `${ENV.LOCALIZATION_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
	const body = {
		model: ENV.LOCALIZATION_LLM_MODEL,
		max_tokens: MAX_TOKENS,
		messages: [
			{ role: 'system', content: systemText(input.context) },
			{ role: 'user', content: userText(input) },
		],
	};

	const post = (json: object) =>
		fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${ENV.LOCALIZATION_LLM_API_KEY}`,
			},
			body: JSON.stringify(json),
		});

	let res = await post({ ...body, response_format: { type: 'json_object' } });
	if (res.status === 400) res = await post(body);

	if (!res.ok) {
		const detail = (await res.text().catch(() => '')).slice(0, 400);
		throw new TranslateError(
			`Translation provider returned ${res.status}${detail ? `: ${detail}` : '.'}`,
		);
	}

	const completion = (await res.json()) as ChatCompletion;
	const text = completion.choices?.[0]?.message?.content;
	if (typeof text !== 'string' || !text.trim()) {
		throw new TranslateError('Translation provider returned an empty response.');
	}
	return shapeResult(text, input);
}

/**
 * Translate a batch of strings into the target languages in a SINGLE request,
 * against whichever provider is configured: an OpenAI-compatible endpoint when
 * `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` are set, else Anthropic.
 * Throws `TranslateError` (never an opaque crash) when no provider is configured,
 * on an empty batch, or on a parse/transport failure.
 */
export async function translateBatch(input: TranslateInput): Promise<TranslateResult> {
	if (input.targetLangs.length === 0) throw new TranslateError('No target languages selected.');
	if (input.items.length === 0) throw new TranslateError('Nothing to translate.');

	if (ENV.LOCALIZATION_LLM_BASE_URL && ENV.LOCALIZATION_LLM_API_KEY) {
		return translateWithOpenAICompatible(input);
	}
	if (ENV.ANTHROPIC_API_KEY) return translateWithAnthropic(input);
	throw new TranslateError(
		'No translation provider configured — set ANTHROPIC_API_KEY, or ' +
			'LOCALIZATION_LLM_BASE_URL + LOCALIZATION_LLM_API_KEY for an OpenAI-compatible provider.',
	);
}
