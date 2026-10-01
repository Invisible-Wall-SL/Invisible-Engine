import { z } from 'zod';

/**
 * Readers ignore unknown fields (`docs/conventions/doc-readers.md`).
 *
 * A doc authored against a NEWER launcher carries fields this build does not know yet — during a
 * rolling deploy, a rollback, or when a published snapshot outlives the code that wrote it. Fed
 * straight to a `.strict()` schema, one such field fails the WHOLE doc and the reader degrades to
 * its empty fallback, so every authored value silently vanishes.
 *
 * This walks `schema` alongside `input` and returns a copy with every key the schema does not
 * declare removed — object keys outside a shape, and record keys outside an enum key set — calling
 * `onUnknown` with the dotted path of each one the schema would have REJECTED (a `.strict()`
 * object's extras, an enum-keyed record's strays; a `.strip()` object's extras go silently, as they
 * always did). Everything else is left for the schema to judge, so a malformed value under a KNOWN
 * key still fails the parse. A doc with no unknown keys comes back structurally identical, so its
 * normalized output does not change.
 *
 * Walked: objects (incl. catchall), records, arrays, unions, discriminated unions and the
 * optional / nullable / default / catch / refine / branded / lazy / pipeline-input wrappers. NOT
 * walked (left to the parse, so a strict object inside one still fails the doc): preprocess,
 * intersections, tuples, maps, sets and readonly.
 */
export function stripUnknownKeys(
	schema: z.ZodTypeAny,
	input: unknown,
	onUnknown: (path: string) => void,
): unknown {
	return strip(schema, input, [], onUnknown);
}

/** {@link stripUnknownKeys} with the standard server warning, labelled by doc. */
export function stripUnknownKeysWithWarning(
	schema: z.ZodTypeAny,
	input: unknown,
	doc: string,
): unknown {
	return stripUnknownKeys(schema, input, (path) =>
		console.warn(`[${doc}] ignoring unknown field "${path}" (written by a newer build?)`),
	);
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** An own data property even for `__proto__` (which `JSON.parse` yields as a plain key). */
export const setKey = (target: Record<string, unknown>, key: string, value: unknown): void => {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
};

const pathOf = (path: readonly (string | number)[]) => path.join('.');

function strip(
	schema: z.ZodTypeAny,
	input: unknown,
	path: (string | number)[],
	onUnknown: (path: string) => void,
): unknown {
	const def = schema._def as { typeName?: z.ZodFirstPartyTypeKind };
	switch (def.typeName) {
		case z.ZodFirstPartyTypeKind.ZodOptional:
		case z.ZodFirstPartyTypeKind.ZodNullable:
		case z.ZodFirstPartyTypeKind.ZodDefault:
		case z.ZodFirstPartyTypeKind.ZodCatch:
			return input === undefined || input === null
				? input
				: strip((schema._def as { innerType: z.ZodTypeAny }).innerType, input, path, onUnknown);
		case z.ZodFirstPartyTypeKind.ZodEffects: {
			const effects = schema as z.ZodEffects<z.ZodTypeAny>;
			// A preprocess may rename keys the inner shape then declares; it is not walked.
			if (effects._def.effect.type === 'preprocess') return input;
			return strip(effects.innerType(), input, path, onUnknown);
		}
		case z.ZodFirstPartyTypeKind.ZodBranded:
			return strip((schema as z.ZodBranded<z.ZodTypeAny, string>).unwrap(), input, path, onUnknown);
		case z.ZodFirstPartyTypeKind.ZodLazy:
			return strip((schema as z.ZodLazy<z.ZodTypeAny>).schema, input, path, onUnknown);
		case z.ZodFirstPartyTypeKind.ZodPipeline:
			return strip((schema._def as { in: z.ZodTypeAny }).in, input, path, onUnknown);
		case z.ZodFirstPartyTypeKind.ZodArray: {
			if (!Array.isArray(input)) return input;
			const item = (schema as z.ZodArray<z.ZodTypeAny>).element;
			return input.map((value, i) => strip(item, value, [...path, i], onUnknown));
		}
		case z.ZodFirstPartyTypeKind.ZodObject:
			return stripObject(schema as z.AnyZodObject, input, path, onUnknown);
		case z.ZodFirstPartyTypeKind.ZodRecord:
			return stripRecord(schema as z.ZodRecord, input, path, onUnknown);
		case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
			const union = schema as z.ZodDiscriminatedUnion<string, z.AnyZodObject[]>;
			if (!isPlainObject(input)) return input;
			const option = union.optionsMap.get(input[union.discriminator] as z.Primitive);
			return option ? strip(option, input, path, onUnknown) : input;
		}
		case z.ZodFirstPartyTypeKind.ZodUnion:
			return stripUnion((schema as z.ZodUnion<[z.ZodTypeAny]>).options, input, path, onUnknown);
		default:
			return input;
	}
}

function stripObject(
	schema: z.AnyZodObject,
	input: unknown,
	path: (string | number)[],
	onUnknown: (path: string) => void,
): unknown {
	if (!isPlainObject(input)) return input;
	const shape = schema.shape as Record<string, z.ZodTypeAny>;
	const catchall = schema._def.catchall as z.ZodTypeAny;
	const hasCatchall = catchall._def.typeName !== z.ZodFirstPartyTypeKind.ZodNever;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		const at = [...path, key];
		if (Object.hasOwn(shape, key)) setKey(out, key, strip(shape[key], value, at, onUnknown));
		else if (hasCatchall) setKey(out, key, strip(catchall, value, at, onUnknown));
		else if (schema._def.unknownKeys === 'passthrough') setKey(out, key, value);
		// A `.strip()` object always dropped extras silently; only a `.strict()` one used to fail.
		else if (schema._def.unknownKeys === 'strict') onUnknown(pathOf(at));
	}
	return out;
}

function stripRecord(
	schema: z.ZodRecord,
	input: unknown,
	path: (string | number)[],
	onUnknown: (path: string) => void,
): unknown {
	if (!isPlainObject(input)) return input;
	const known = enumKeys(schema.keySchema);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (known && !known.has(key)) onUnknown(pathOf([...path, key]));
		else setKey(out, key, strip(schema.valueSchema, value, [...path, key], onUnknown));
	}
	return out;
}

/** The closed key set of a record keyed by an enum; `null` for an open (string) key. */
function enumKeys(key: z.ZodTypeAny): Set<string> | null {
	const def = key._def as { typeName?: z.ZodFirstPartyTypeKind; innerType?: z.ZodTypeAny };
	if (def.typeName === z.ZodFirstPartyTypeKind.ZodEnum)
		return new Set((key as z.ZodEnum<[string, ...string[]]>).options);
	if (def.typeName === z.ZodFirstPartyTypeKind.ZodNativeEnum)
		return new Set(Object.values((key as z.ZodNativeEnum<z.EnumLike>).enum).map(String));
	if (def.typeName === z.ZodFirstPartyTypeKind.ZodEffects)
		return enumKeys((key as z.ZodEffects<z.ZodTypeAny>).innerType());
	return null;
}

/** A value some option already accepts is left alone. Otherwise the union strips against the option
 *  that then accepts it with the fewest keys removed; a value no option accepts is left for the
 *  parse. */
function stripUnion(
	options: readonly z.ZodTypeAny[],
	input: unknown,
	path: (string | number)[],
	onUnknown: (path: string) => void,
): unknown {
	if (options.some((option) => option.safeParse(input).success)) return input;
	let best: { candidate: unknown; removed: string[] } | null = null;
	for (const option of options) {
		const removed: string[] = [];
		const candidate = strip(option, input, path, (p) => removed.push(p));
		if (option.safeParse(candidate).success && (!best || removed.length < best.removed.length))
			best = { candidate, removed };
	}
	if (!best) return input;
	best.removed.forEach(onUnknown);
	return best.candidate;
}
