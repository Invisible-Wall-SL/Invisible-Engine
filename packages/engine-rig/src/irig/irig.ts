import { IRIG_V1, IRIG_VERSION, RIG_FIELDS, type Field, type IrigDoc } from './schema';

export type { IrigAnimation, IrigAttachment, IrigDoc } from './schema';
export { IRIG_VERSION } from './schema';

/** A value the schema could not keep, and why. */
export interface IrigIssue {
	path: string;
	reason: string;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

const describe = (v: unknown): string =>
	v === null ? 'null' : Array.isArray(v) ? 'a list' : `a ${typeof v}`;

/**
 * Returns `value` as the schema keeps it, or `undefined` when it cannot be kept; every loss is
 * recorded in `issues`. Object keys keep their source order: the order of animations, timelines and
 * map entries is meaning (the first animation is the default one; timelines apply in order).
 */
function clean(field: Field, value: unknown, path: string, issues: IrigIssue[]): unknown {
	const fail = (reason: string): undefined => {
		issues.push({ path, reason });
		return undefined;
	};
	switch (field.kind) {
		case 'num':
			return typeof value === 'number' ? value : fail(`expected a number, got ${describe(value)}`);
		case 'str':
			return typeof value === 'string' ? value : fail(`expected a string, got ${describe(value)}`);
		case 'bool':
			return typeof value === 'boolean'
				? value
				: fail(`expected true/false, got ${describe(value)}`);
		case 'lit': {
			if (typeof value !== 'string') return fail(`expected a name, got ${describe(value)}`);
			if (field.values.includes(value)) return value;
			return fail(`"${value}" is not one of ${field.values.join(', ')}`);
		}
		case 'curve':
			if (value === 'stepped') return value;
			if (Array.isArray(value) && value.every((n) => typeof n === 'number')) return value;
			return fail(`expected "stepped" or a list of numbers, got ${describe(value)}`);
		case 'arr': {
			if (!Array.isArray(value)) return fail(`expected a list, got ${describe(value)}`);
			if (field.length !== undefined && value.length !== field.length)
				return fail(`expected ${field.length} items, got ${value.length}`);
			// One bad item drops the whole list: dropping only the item would shift every index after
			// it, and bones, slots and vertices are referenced by index.
			const out: unknown[] = [];
			for (const [i, item] of value.entries()) {
				const kept = clean(field.of, item, `${path}[${i}]`, issues);
				if (kept === undefined) return fail('dropped with its bad item');
				out.push(kept);
			}
			return out;
		}
		case 'map': {
			if (!isObject(value)) return fail(`expected an object, got ${describe(value)}`);
			const out: Json = {};
			for (const [k, v] of Object.entries(value)) {
				const kept = clean(field.of, v, `${path}.${k}`, issues);
				if (kept !== undefined) out[k] = kept;
			}
			return out;
		}
		case 'obj':
			return cleanObject(field.fields, field.required, value, path, issues);
		case 'variant': {
			if (!isObject(value)) return fail(`expected an object, got ${describe(value)}`);
			const type = value.type === undefined ? field.fallback : value.type;
			if (typeof type !== 'string' || !(type in field.cases))
				return fail(`unknown attachment type ${JSON.stringify(type)}`);
			const shape = field.cases[type];
			return cleanObject(
				{ type: { kind: 'str' }, ...shape.fields },
				shape.required,
				value,
				path,
				issues,
			);
		}
	}
}

function cleanObject(
	fields: Record<string, Field>,
	required: readonly string[],
	value: unknown,
	path: string,
	issues: IrigIssue[],
): Json | undefined {
	if (!isObject(value)) {
		issues.push({ path, reason: `expected an object, got ${describe(value)}` });
		return undefined;
	}
	const out: Json = {};
	for (const [k, v] of Object.entries(value)) {
		const at = path ? `${path}.${k}` : k;
		const field = fields[k];
		if (!field) {
			issues.push({ path: at, reason: 'not an irig field' });
			continue;
		}
		const kept = clean(field, v, at, issues);
		if (kept !== undefined) out[k] = kept;
	}
	const missing = required.filter((k) => !(k in out));
	if (missing.length) {
		issues.push({ path, reason: `missing ${missing.join(', ')}` });
		return undefined;
	}
	return out;
}

/** Renames one key in place, keeping its position. */
function renameKey(o: Json, from: string, to: string): Json {
	return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
}

/**
 * A 4.2-format skeleton (parsed JSON or its text) as an irig v1 document.
 *
 * Everything the 4.2 reader reads is kept, plus our extensions (`pivot`, event `fx` / `flipbook`).
 * Anything else is left out and listed in `issues`: a key the reader ignores (a 4.1 export's bone
 * `transform`, an editor-only `icon`), or a value of the wrong type. A key the reader ignores changes
 * nothing; a wrong-typed value is one the reader would have misread, so an import with issues is a
 * report to look at, not a silent fix.
 */
export function importSpine42Json(json: string | object): { doc: IrigDoc; issues: IrigIssue[] } {
	const root: unknown = typeof json === 'string' ? JSON.parse(json) : json;
	if (!isObject(root)) throw new Error('A skeleton must be a JSON object.');
	const source: Json = { ...root };
	if (isObject(source.skeleton))
		source.skeleton = renameKey(source.skeleton, 'spine', 'importedFrom');
	// The 4.2 reader also takes skins as an object keyed by name; v1 has one form, the list.
	if (isObject(source.skins))
		source.skins = Object.entries(source.skins).map(([name, attachments]) => ({
			name,
			attachments,
		}));

	const issues: IrigIssue[] = [];
	const body = cleanObject(RIG_FIELDS, ['bones'], source, '', issues);
	if (!body) throw new Error(`Not a skeleton: ${issues.map((i) => i.reason).join('; ')}`);
	return { doc: { irig: IRIG_VERSION, ...body } as IrigDoc, issues };
}

/** An irig document of any version, by its `irig` stamp; a 4.2 file has none. */
export function isIrigDocument(value: unknown): value is Json & { irig: number } {
	return isObject(value) && typeof value.irig === 'number';
}

/** Parses and checks an irig v1 document. Unlike an import, nothing is dropped: any value outside
 * the schema refuses the whole document. */
export function readIrig(input: string | object): IrigDoc {
	const root: unknown = typeof input === 'string' ? JSON.parse(input) : input;
	if (!isIrigDocument(root)) throw new Error('Not an irig document.');
	if (root.irig > IRIG_VERSION)
		throw new Error(`irig version ${root.irig} is newer than this reader (${IRIG_VERSION}).`);
	if (root.irig !== IRIG_VERSION) throw new Error(`Unknown irig version ${root.irig}.`);
	const issues: IrigIssue[] = [];
	const doc = clean(IRIG_V1, root, '', issues);
	if (issues.length || !doc) {
		const list = issues.slice(0, 5).map((i) => `${i.path || '(root)'}: ${i.reason}`);
		if (issues.length > 5) list.push(`…and ${issues.length - 5} more`);
		throw new Error(`Invalid irig document — ${list.join('; ')}`);
	}
	return doc as IrigDoc;
}

export function writeIrig(doc: IrigDoc): string {
	return JSON.stringify(doc);
}

/**
 * The document as 4.2-format JSON, extensions inline where today's files carry them. INTERNAL: no
 * route or screen offers it (the format is import only). It serves the round-trip gate, the Rigger
 * while it still edits 4.2-shaped data, and the parity gate against the reference runtime.
 */
export function exportSpine42Json(doc: IrigDoc): Record<string, unknown> {
	const out: Json = { ...doc };
	delete out.irig;
	if (isObject(out.skeleton)) out.skeleton = renameKey(out.skeleton, 'importedFrom', 'spine');
	return out;
}
