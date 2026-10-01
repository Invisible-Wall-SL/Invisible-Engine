import type { z } from 'zod';
import { etagDiffers } from './docBackups';
import { getObjectTextWithEtag } from './r2';
import { isPlainObject, setKey } from './stripUnknownKeys';

/**
 * The top-level blocks of `doc` that `schema` does not declare, as a fresh object (empty when
 * there are none, or when `doc` is not a plain object).
 *
 * Computed from the shape rather than reported by `stripUnknownKeys`: the doc roots are `.strip()`
 * objects, whose extras that walk drops silently.
 */
export function unknownTopLevelBlocks(
	schema: z.AnyZodObject,
	doc: unknown,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (!isPlainObject(doc)) return out;
	for (const [key, value] of Object.entries(doc)) {
		if (!Object.hasOwn(schema.shape, key)) setKey(out, key, value);
	}
	return out;
}

/**
 * The top-level blocks a NEWER launcher wrote into the stored doc that this build does not know,
 * so a save can carry them over instead of deleting them (`docs/conventions/doc-readers.md`,
 * "Round-tripping").
 *
 * Only for an `If-Match` save (`baseEtag` a string), and only when the stored object is the very
 * version the author loaded (its ETag equals `baseEtag`): any other stored version makes the PUT
 * 409 anyway, and a create or a forced overwrite has no loaded version to preserve from. A missing
 * or unparseable object yields nothing. Top level only — a nested graft could resurrect a parent
 * block the author deleted.
 */
export async function storedUnknownBlocks(
	key: string,
	schema: z.AnyZodObject,
	baseEtag: string | null | undefined,
): Promise<Record<string, unknown>> {
	if (typeof baseEtag !== 'string') return {};
	const stored = await getObjectTextWithEtag(key);
	if (!stored || stored.etag === null || etagDiffers(stored.etag, baseEtag)) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(stored.text);
	} catch {
		return {};
	}
	return unknownTopLevelBlocks(schema, parsed);
}
