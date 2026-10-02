import { ZodDefault, ZodObject, ZodOptional, type z } from 'zod';
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
 * The stored doc the author loaded, parsed, so a save can carry over what a NEWER launcher wrote
 * into it that this build does not know (`docs/conventions/doc-readers.md`, "Round-tripping").
 *
 * Only for an `If-Match` save (`baseEtag` a string), and only when the stored object is the very
 * version the author loaded (its ETag equals `baseEtag`): any other stored version makes the PUT
 * 409 anyway, and a create or a forced overwrite has no loaded version to preserve from. A missing
 * or unparseable object yields `undefined`.
 */
export async function loadedStoredDoc(
	key: string,
	baseEtag: string | null | undefined,
): Promise<unknown> {
	if (typeof baseEtag !== 'string') return undefined;
	const stored = await getObjectTextWithEtag(key);
	if (!stored || stored.etag === null || etagDiffers(stored.etag, baseEtag)) return undefined;
	try {
		return JSON.parse(stored.text);
	} catch {
		return undefined;
	}
}

/**
 * The top-level blocks of the loaded stored doc ({@link loadedStoredDoc}) that `schema` does not
 * declare. Symbols grafts only these; win text also grafts one level down
 * ({@link withUnknownFamilyFields}).
 */
export async function storedUnknownBlocks(
	key: string,
	schema: z.AnyZodObject,
	baseEtag: string | null | undefined,
): Promise<Record<string, unknown>> {
	return unknownTopLevelBlocks(schema, await loadedStoredDoc(key, baseEtag));
}

/** The shape of the object under a top-level field, through `.optional()` / `.default()`. */
function objectShape(field: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
	let inner = field;
	while (inner instanceof ZodOptional || inner instanceof ZodDefault)
		inner = inner._def.innerType as z.ZodTypeAny;
	return inner instanceof ZodObject ? (inner.shape as Record<string, z.ZodTypeAny>) : null;
}

/**
 * `next` with the fields a NEWER launcher wrote inside a top-level object block (a "family") of
 * `loaded` that this build's `schema` does not declare, put back into the same family — also when
 * the author emptied the family's known fields and it was pruned away. The author cannot see an
 * unknown field, so clearing what they could see says nothing about it; a family is a fixed
 * namespace, not an entity whose deletion should take its contents along. One level only. Returns
 * `next` itself when nothing is grafted, so a known-only doc saves byte-identically.
 */
export function withUnknownFamilyFields<T extends Record<string, unknown>>(
	schema: z.AnyZodObject,
	loaded: unknown,
	next: T,
): T {
	if (!isPlainObject(loaded)) return next;
	const out: Record<string, unknown> = { ...next };
	let grafted = false;
	for (const [family, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
		const stored = loaded[family];
		const shape = objectShape(field);
		if (!shape || !isPlainObject(stored)) continue;
		const unknown = Object.entries(stored).filter(([key]) => !Object.hasOwn(shape, key));
		if (!unknown.length) continue;
		const current = out[family];
		const merged: Record<string, unknown> = isPlainObject(current) ? { ...current } : {};
		for (const [key, value] of unknown) setKey(merged, key, value);
		out[family] = merged;
		grafted = true;
	}
	return grafted ? (out as T) : next;
}
