import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** The most characters of a text result the model is shown; the rest is cut and marked. */
export const MAX_RESULT_CHARS = 60_000;

/** What the Messages API accepts as an image block. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** The API refuses an image over 5 MB (decoded). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

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
	if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES) return 'the image is over 5 MB';
	return null;
}

/**
 * The content of a `tool_result` for a successful adapter answer. An answer carrying
 * `image: { mediaType, base64 }` is the rest of the answer as text and the image as an image block,
 * so the model sees it; an image it cannot be shown is dropped with a note, never cut mid-base64.
 * Every other answer is its JSON, cut at `MAX_RESULT_CHARS`, as it always was.
 */
export function answerContent(body: unknown): BetaToolResultBlockParam['content'] {
	const found = imageOf(body);
	if (!found) return cutResult(JSON.stringify(body));
	const why = refusal(found.mediaType, found.data);
	if (why) return cutResult(JSON.stringify({ ...found.rest, imageNotShown: why }));
	return [
		{ type: 'text', text: cutResult(JSON.stringify(found.rest)) },
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
