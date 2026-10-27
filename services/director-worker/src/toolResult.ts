import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { wrapUntrusted } from './untrusted.ts';

/** The most characters of a text result the model is shown; the rest is cut and marked. */
export const MAX_RESULT_CHARS = 60_000;

/** What the Messages API accepts as an image block. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** The API refuses an image over 5 MB; the limit is on the base64 string, so it is measured there. */
export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;

/**
 * What one request carries of images (the API takes 100 per request and a 32 MB body; above 20
 * images each may be 2000 px at most, and ours are 1568). The newest 20, at most 12 MB of base64 in
 * all — well under both, so a long run never builds a request the API refuses for good.
 */
export const MAX_IMAGES_PER_REQUEST = 20;
export const MAX_IMAGE_BASE64_PER_REQUEST = 12 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** What an untrusted answer's text is cut to: the wrapper's own lines still fit in the result. */
const UNTRUSTED_MAX_CHARS = MAX_RESULT_CHARS - 500;

export const cutResult = (text: string) =>
	text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…[truncated]` : text;

interface ImageAnswer {
	rest: Record<string, unknown>;
	mediaType: unknown;
	data: unknown;
}

/** `{ image: { mediaType, base64 }, ...rest }`, or null for an answer with no such field. */
function imageOf(body: unknown): ImageAnswer | null {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
	const { image, ...rest } = body as Record<string, unknown>;
	if (typeof image !== 'object' || image === null) return null;
	const { mediaType, base64 } = image as Record<string, unknown>;
	return { rest, mediaType, data: base64 };
}

/** Why an image cannot be shown to the model, or null when it can. */
function refusal(mediaType: unknown, data: unknown): string | null {
	if (!IMAGE_TYPES.includes(mediaType as ImageType)) {
		const type = typeof mediaType === 'string' ? mediaType : 'unknown';
		return `the image type ${type} is not one the model can be shown`;
	}
	if (typeof data !== 'string' || !BASE64.test(data)) return 'the image data is not base64';
	if (data.length > MAX_IMAGE_BASE64) return 'the image is over 5 MB';
	return null;
}

/**
 * The content of a `tool_result` for a successful adapter answer. An answer of an op flagged
 * `image` carrying `image: { mediaType, base64 }` is the rest of the answer as text and the image as an image block,
 * so the model sees it; an image it cannot be shown is dropped with a note, never cut mid-base64.
 * Every other answer, of any op, is its JSON, cut at `MAX_RESULT_CHARS`, as it always was.
 */
export function answerContent(
	body: unknown,
	imageOp = false,
	untrusted = false,
): BetaToolResultBlockParam['content'] {
	// People's words are data, whole or not at all: the fixed line, then the text between the
	// tags, cut inside them (`wrapUntrusted`). An image rides after that text block.
	const text = (json: string) =>
		untrusted ? wrapUntrusted(json, UNTRUSTED_MAX_CHARS) : cutResult(json);
	const found = imageOp ? imageOf(body) : null;
	if (!found) return text(JSON.stringify(body));
	const why = refusal(found.mediaType, found.data);
	if (why) return text(JSON.stringify({ ...found.rest, imageNotShown: why }));
	return [
		{ type: 'text', text: text(JSON.stringify(found.rest)) },
		{
			type: 'image',
			source: {
				type: 'base64',
				media_type: found.mediaType as ImageType,
				data: found.data as string,
			},
		},
	];
}

const isImageBlock = (b: unknown): b is { type: 'image'; source: { data: string } } =>
	(b as { type?: string })?.type === 'image';

/** What an older image is replaced by: the region and id its result's text names, if it does. */
function stubFor(text: unknown): string {
	try {
		const { region, id } = JSON.parse(String(text)) as { region?: unknown; id?: unknown };
		const label = [region, id].filter((x) => typeof x === 'string' || typeof x === 'number');
		if (label.length) return `[image shown earlier: ${label.join('/')}]`;
	} catch {
		// the text is not JSON: no label
	}
	return '[image shown earlier]';
}

/**
 * The messages as a request carries them: only the newest `MAX_IMAGES_PER_REQUEST` images, and
 * `MAX_IMAGE_BASE64_PER_REQUEST` of base64 among them, stay images; an older one is a short text
 * stub. Built from the stored rows alone, never stored, so a replay builds the same request and a
 * long run never grows past what the API accepts. Messages with no image to replace are returned
 * as they are.
 */
export function capImages<M extends { role: string; content: unknown }>(messages: M[]): M[] {
	let count = 0;
	let bytes = 0;
	const keep = new Set<unknown>();
	for (let i = messages.length - 1; i >= 0; i--) {
		const content = messages[i].content;
		if (!Array.isArray(content)) continue;
		for (let j = content.length - 1; j >= 0; j--) {
			const inner = (content[j] as { content?: unknown }).content;
			if (!Array.isArray(inner)) continue;
			for (let k = inner.length - 1; k >= 0; k--) {
				const block = inner[k];
				if (!isImageBlock(block)) continue;
				const size = block.source.data.length;
				if (count < MAX_IMAGES_PER_REQUEST && bytes + size <= MAX_IMAGE_BASE64_PER_REQUEST) {
					count++;
					bytes += size;
					keep.add(block);
				}
			}
		}
	}
	return messages.map((m) => {
		if (!Array.isArray(m.content)) return m;
		let changed = false;
		const content = m.content.map((part) => {
			const inner = (part as { content?: unknown }).content;
			if (!Array.isArray(inner) || !inner.some((b) => isImageBlock(b) && !keep.has(b))) return part;
			changed = true;
			return {
				...part,
				content: inner.map((b, at) =>
					isImageBlock(b) && !keep.has(b)
						? { type: 'text', text: stubFor((inner[at - 1] as { text?: unknown })?.text) }
						: b,
				),
			};
		});
		return changed ? { ...m, content } : m;
	});
}
