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
 *
 * UNKNOWN ENUM VALUES are handled only when `onUnknownValue` is given (a READ; a save leaves them
 * for the parse to reject, as its typo guard). A value counts as unknown when an enum, literal or
 * discriminator does not list it but it has the same primitive type as the values it does list:
 * `type: 'video'` against `['sprite', 'spine']`, or `version: 2` against `1`. A value of the wrong
 * type (`type: 3`) is malformed and still fails. An unknown value
 *   - in an OPTIONAL field drops the field, so the reader's default applies (`blendMode`);
 *   - in a REQUIRED field drops the smallest thing that can go without it: the optional field, array
 *     element or record entry holding it (a cell's `type` drops the cell);
 *   - in a field wrapped in {@link readUnknownValueAs} reads as that value instead.
 * `onUnknownValue` hears each one once, with what was dropped.
 */
export function stripUnknownKeys(
	schema: z.ZodTypeAny,
	input: unknown,
	onUnknown: (path: string) => void,
	onUnknownValue?: (unknown: UnknownValue) => void,
): unknown {
	const out = strip(schema, input, [], { onUnknownKey: onUnknown, onUnknownValue });
	// Nothing encloses the root: a doc that cannot stand without the value is left for the parse.
	return out instanceof Dropped ? input : out;
}

/** What {@link stripUnknownKeys} did with one unknown enum value. */
export type UnknownValue = {
	/** Dotted path of the value itself. */
	path: string;
	value: unknown;
	/** The value it now reads as ({@link readUnknownValueAs}), or the path of what was dropped. */
	outcome: { readAs: unknown } | { dropped: string };
};

/** How a reader treats an unknown enum value: `'drop'` on a read, `'reject'` (the parse fails, the
 *  endpoint answers 400) on a save, where it is the typo guard. See `docs/conventions/doc-readers.md`. */
export type UnknownValues = 'drop' | 'reject';

/** {@link stripUnknownKeys} with the standard server warnings, labelled by doc. */
export function stripUnknownKeysWithWarning(
	schema: z.ZodTypeAny,
	input: unknown,
	doc: string,
	unknownValues: UnknownValues,
): unknown {
	return stripUnknownKeys(
		schema,
		input,
		(path) => console.warn(`[${doc}] ignoring unknown field "${path}" (written by a newer build?)`),
		unknownValues === 'drop'
			? ({ path, value, outcome }) => {
					const seen = `unknown value ${JSON.stringify(value)} at "${path}"`;
					const action =
						'readAs' in outcome
							? `reading ${seen} as ${JSON.stringify(outcome.readAs)}`
							: outcome.dropped === path
								? `ignoring ${seen}`
								: `dropping "${outcome.dropped}" over ${seen}`;
					console.warn(`[${doc}] ${action} (written by a newer build?)`);
				}
			: undefined,
	);
}

const READ_AS = new WeakMap<z.ZodTypeAny, unknown>();

/**
 * Mark a REQUIRED enum field whose unknown value should read as `fallback` instead of dropping the
 * entry around it — for an entry worth more than the field (a sound whose `kind` only sections the
 * library). Only {@link stripUnknownKeys} reads the mark; the parse still rejects the value on save.
 */
export function readUnknownValueAs<T extends z.ZodTypeAny>(schema: T, fallback: z.infer<T>): T {
	READ_AS.set(schema, fallback);
	return schema;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** An own data property even for `__proto__` (which `JSON.parse` yields as a plain key). */
const setKey = (target: Record<string, unknown>, key: string, value: unknown): void => {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
};

const pathOf = (path: readonly (string | number)[]) => path.join('.');

interface Walk {
	onUnknownKey: (path: string) => void;
	/** Absent on a save: unknown enum values are left for the parse to reject. */
	onUnknownValue?: (unknown: UnknownValue) => void;
}

/** An unknown enum value travelling up to the first thing that can be dropped without it. */
class Dropped {
	constructor(
		readonly path: string,
		readonly value: unknown,
	) {}
}

/** The listed values of an enum, literal or native enum; `null` for any other schema. */
function listedValues(schema: z.ZodTypeAny): readonly unknown[] | null {
	const def = schema._def as { typeName?: z.ZodFirstPartyTypeKind };
	if (def.typeName === z.ZodFirstPartyTypeKind.ZodEnum)
		return (schema as z.ZodEnum<[string, ...string[]]>).options;
	if (def.typeName === z.ZodFirstPartyTypeKind.ZodLiteral)
		return [(schema as z.ZodLiteral<unknown>).value];
	if (def.typeName === z.ZodFirstPartyTypeKind.ZodNativeEnum)
		return z.util.getValidEnumValues((schema as z.ZodNativeEnum<z.EnumLike>).enum);
	return null;
}

/** Not listed, but the same primitive type as a listed value — so a newer build's, not junk. */
const isUnknownValue = (listed: readonly unknown[], value: unknown): boolean =>
	!listed.includes(value) && listed.some((known) => typeof known === typeof value);

function strip(
	schema: z.ZodTypeAny,
	input: unknown,
	path: (string | number)[],
	walk: Walk,
): unknown {
	const { onUnknownValue } = walk;
	const listed = onUnknownValue && listedValues(schema);
	if (onUnknownValue && listed && isUnknownValue(listed, input)) {
		if (!READ_AS.has(schema)) return new Dropped(pathOf(path), input);
		const readAs = READ_AS.get(schema);
		onUnknownValue({ path: pathOf(path), value: input, outcome: { readAs } });
		return readAs;
	}
	const def = schema._def as { typeName?: z.ZodFirstPartyTypeKind };
	switch (def.typeName) {
		case z.ZodFirstPartyTypeKind.ZodOptional:
		case z.ZodFirstPartyTypeKind.ZodNullable:
		case z.ZodFirstPartyTypeKind.ZodDefault:
		case z.ZodFirstPartyTypeKind.ZodCatch:
			return input === undefined || input === null
				? input
				: strip((schema._def as { innerType: z.ZodTypeAny }).innerType, input, path, walk);
		case z.ZodFirstPartyTypeKind.ZodEffects: {
			const effects = schema as z.ZodEffects<z.ZodTypeAny>;
			// A preprocess may rename keys the inner shape then declares; it is not walked.
			if (effects._def.effect.type === 'preprocess') return input;
			return strip(effects.innerType(), input, path, walk);
		}
		case z.ZodFirstPartyTypeKind.ZodBranded:
			return strip((schema as z.ZodBranded<z.ZodTypeAny, string>).unwrap(), input, path, walk);
		case z.ZodFirstPartyTypeKind.ZodLazy:
			return strip((schema as z.ZodLazy<z.ZodTypeAny>).schema, input, path, walk);
		case z.ZodFirstPartyTypeKind.ZodPipeline:
			return strip((schema._def as { in: z.ZodTypeAny }).in, input, path, walk);
		case z.ZodFirstPartyTypeKind.ZodArray: {
			if (!Array.isArray(input)) return input;
			const item = (schema as z.ZodArray<z.ZodTypeAny>).element;
			const out: unknown[] = [];
			input.forEach((value, i) => {
				const next = strip(item, value, [...path, i], walk);
				if (next instanceof Dropped) dropped(walk, next, [...path, i]);
				else out.push(next);
			});
			return out;
		}
		case z.ZodFirstPartyTypeKind.ZodObject:
			return stripObject(schema as z.AnyZodObject, input, path, walk);
		case z.ZodFirstPartyTypeKind.ZodRecord:
			return stripRecord(schema as z.ZodRecord, input, path, walk);
		case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
			const union = schema as z.ZodDiscriminatedUnion<string, z.AnyZodObject[]>;
			if (!isPlainObject(input)) return input;
			const tag = input[union.discriminator];
			const option = union.optionsMap.get(tag as z.Primitive);
			if (option) return strip(option, input, path, walk);
			return walk.onUnknownValue && isUnknownValue([...union.optionsMap.keys()], tag)
				? new Dropped(pathOf([...path, union.discriminator]), tag)
				: input;
		}
		case z.ZodFirstPartyTypeKind.ZodUnion:
			return stripUnion((schema as z.ZodUnion<[z.ZodTypeAny]>).options, input, path, walk);
		default:
			return input;
	}
}

/** Report an unknown value against what was removed to drop it. */
const dropped = (walk: Walk, value: Dropped, at: readonly (string | number)[]): void =>
	walk.onUnknownValue?.({ path: value.path, value: value.value, outcome: { dropped: pathOf(at) } });

function stripObject(
	schema: z.AnyZodObject,
	input: unknown,
	path: (string | number)[],
	walk: Walk,
): unknown {
	if (!isPlainObject(input)) return input;
	const shape = schema.shape as Record<string, z.ZodTypeAny>;
	const catchall = schema._def.catchall as z.ZodTypeAny;
	const hasCatchall = catchall._def.typeName !== z.ZodFirstPartyTypeKind.ZodNever;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		const at = [...path, key];
		const declared = Object.hasOwn(shape, key);
		if (declared || hasCatchall) {
			const field = declared ? shape[key] : catchall;
			const next = strip(field, value, at, walk);
			if (!(next instanceof Dropped)) setKey(out, key, next);
			// A required field the object cannot stand without takes the object with it.
			else if (declared && !field.isOptional()) return next;
			else dropped(walk, next, at);
		} else if (schema._def.unknownKeys === 'passthrough') setKey(out, key, value);
		// A `.strip()` object always dropped extras silently; only a `.strict()` one used to fail.
		else if (schema._def.unknownKeys === 'strict') walk.onUnknownKey(pathOf(at));
	}
	return out;
}

function stripRecord(
	schema: z.ZodRecord,
	input: unknown,
	path: (string | number)[],
	walk: Walk,
): unknown {
	if (!isPlainObject(input)) return input;
	const known = enumKeys(schema.keySchema);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		const at = [...path, key];
		if (known && !known.has(key)) {
			walk.onUnknownKey(pathOf(at));
			continue;
		}
		const next = strip(schema.valueSchema, value, at, walk);
		if (next instanceof Dropped) dropped(walk, next, at);
		else setKey(out, key, next);
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
 *  that then accepts it with the fewest things removed. A value no option accepts is dropped only
 *  when EVERY option holds an unknown value in it; otherwise it is a malformed known variant, left
 *  for the parse to fail. */
function stripUnion(
	options: readonly z.ZodTypeAny[],
	input: unknown,
	path: (string | number)[],
	walk: Walk,
): unknown {
	if (options.some((option) => option.safeParse(input).success)) return input;
	let best: { candidate: unknown; reports: (() => void)[] } | null = null;
	const drops: Dropped[] = [];
	for (const option of options) {
		// Only the chosen option's removals are reported, so each is held until the choice is made.
		const reports: (() => void)[] = [];
		const { onUnknownValue } = walk;
		const candidate = strip(option, input, path, {
			onUnknownKey: (p) => reports.push(() => walk.onUnknownKey(p)),
			onUnknownValue: onUnknownValue && ((u) => reports.push(() => onUnknownValue(u))),
		});
		if (candidate instanceof Dropped) drops.push(candidate);
		else if (option.safeParse(candidate).success && (!best || reports.length < best.reports.length))
			best = { candidate, reports };
	}
	if (!best) return drops.length === options.length ? drops[0] : input;
	best.reports.forEach((report) => report());
	return best.candidate;
}
