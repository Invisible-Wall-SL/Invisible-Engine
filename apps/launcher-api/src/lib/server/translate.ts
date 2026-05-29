import Anthropic from '@anthropic-ai/sdk';
import { ENV } from './env';

const MODEL = 'claude-sonnet-4-6';

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

function systemBlocks(context: string): Anthropic.MessageCreateParams['system'] {
	const blocks: Anthropic.TextBlockParam[] = [
		{
			type: 'text',
			text: BASE_INSTRUCTIONS,
			cache_control: { type: 'ephemeral' },
		},
	];
	const trimmed = context.trim();
	if (trimmed) {
		blocks.push({
			type: 'text',
			text: `Project context / glossary (apply consistently):\n${trimmed}`,
			cache_control: { type: 'ephemeral' },
		});
	}
	return blocks;
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
 * Translate a batch of strings into the target languages in a SINGLE Anthropic
 * request. The fixed instructions + project context go in a prompt-cached system
 * prompt so repeated translate clicks reuse the cache. Throws `TranslateError`
 * (never an opaque crash) on an unset key, an empty batch or a parse failure.
 */
export async function translateBatch(input: TranslateInput): Promise<TranslateResult> {
	if (!ENV.ANTHROPIC_API_KEY) throw new TranslateError('ANTHROPIC_API_KEY not set');
	if (input.targetLangs.length === 0) throw new TranslateError('No target languages selected.');
	if (input.items.length === 0) throw new TranslateError('Nothing to translate.');

	const client = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });

	const payload = {
		sourceLang: input.sourceLang,
		targetLangs: input.targetLangs,
		entries: input.items.map((i) => ({ id: i.id, text: i.source })),
	};

	const message = await client.messages.create({
		model: MODEL,
		max_tokens: 8192,
		system: systemBlocks(input.context),
		messages: [
			{
				role: 'user',
				content: `Translate these strings. Input:\n${JSON.stringify(payload)}`,
			},
		],
	});

	const text = message.content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('');

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
