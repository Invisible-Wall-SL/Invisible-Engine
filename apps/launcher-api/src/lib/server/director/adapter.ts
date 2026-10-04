import type { DirectorRun } from '../db/schema';

/**
 * The shape of an Invisible Director tool adapter (ADR-0002): a typed operation with an
 * MCP-compatible input schema, the runtime agents allowed to call it, and a handler that calls the
 * SAME server-side module the tool's own page uses. The gate (`gate.ts`) does auth, run and project
 * scope, the allow-list, input validation, the write guard and idempotency, so a handler only ever
 * sees a call that has passed all of them.
 */

/**
 * The runtime agents (`services/director-worker/agents/<name>.md`), plus `worker`: the worker's own
 * code acting outside any model turn — creating the project before the first agent starts. An op's
 * allow-list names these; `check-director-adapters.ts` holds each model agent's frontmatter `tools:`
 * to the same list.
 */
export const DIRECTOR_AGENTS = [
	'coordinator',
	'mockup-analyst',
	'art-director',
	'atlas-artist',
	'animator',
	'builder',
	'qa',
	'worker',
] as const;
export type DirectorAgent = (typeof DIRECTOR_AGENTS)[number];

export function isDirectorAgent(value: unknown): value is DirectorAgent {
	return typeof value === 'string' && (DIRECTOR_AGENTS as readonly string[]).includes(value);
}

/** The subset of JSON Schema the ops use — what an MCP `inputSchema` carries. */
export type JsonSchema =
	| {
			type: 'string';
			description?: string;
			enum?: readonly string[];
			pattern?: string;
			minLength?: number;
			maxLength?: number;
	  }
	| { type: 'integer' | 'number'; description?: string; minimum?: number; maximum?: number }
	| { type: 'boolean'; description?: string }
	| { type: 'array'; description?: string; items: JsonSchema; maxItems?: number }
	| ObjectSchema;

export interface ObjectSchema {
	type: 'object';
	description?: string;
	properties: Record<string, JsonSchema>;
	required?: readonly string[];
	additionalProperties: false;
}

/** Every reason `value` does not match `schema`, as `path: problem`; empty when it matches. */
export function schemaErrors(schema: JsonSchema, value: unknown, path = 'input'): string[] {
	switch (schema.type) {
		case 'string': {
			if (typeof value !== 'string') return [`${path}: expected a string`];
			const out: string[] = [];
			if (schema.enum && !schema.enum.includes(value)) {
				out.push(`${path}: must be one of ${schema.enum.join(', ')}`);
			}
			if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
				out.push(`${path}: must match ${schema.pattern}`);
			}
			if (schema.minLength !== undefined && value.length < schema.minLength) {
				out.push(`${path}: shorter than ${schema.minLength}`);
			}
			if (schema.maxLength !== undefined && value.length > schema.maxLength) {
				out.push(`${path}: longer than ${schema.maxLength}`);
			}
			return out;
		}
		case 'integer':
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value))
				return [`${path}: expected a number`];
			if (schema.type === 'integer' && !Number.isInteger(value)) {
				return [`${path}: expected an integer`];
			}
			const out: string[] = [];
			if (schema.minimum !== undefined && value < schema.minimum) {
				out.push(`${path}: below ${schema.minimum}`);
			}
			if (schema.maximum !== undefined && value > schema.maximum) {
				out.push(`${path}: above ${schema.maximum}`);
			}
			return out;
		}
		case 'boolean':
			return typeof value === 'boolean' ? [] : [`${path}: expected a boolean`];
		case 'array': {
			if (!Array.isArray(value)) return [`${path}: expected an array`];
			if (schema.maxItems !== undefined && value.length > schema.maxItems) {
				return [`${path}: more than ${schema.maxItems} items`];
			}
			return value.flatMap((item, i) => schemaErrors(schema.items, item, `${path}[${i}]`));
		}
		case 'object': {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				return [`${path}: expected an object`];
			}
			const record = value as Record<string, unknown>;
			const out: string[] = [];
			for (const key of schema.required ?? []) {
				if (record[key] === undefined) out.push(`${path}.${key}: required`);
			}
			for (const [key, item] of Object.entries(record)) {
				const property = schema.properties[key];
				if (!property) out.push(`${path}.${key}: unknown property`);
				else if (item !== undefined) out.push(...schemaErrors(property, item, `${path}.${key}`));
			}
			return out;
		}
	}
}

/**
 * Who a Director write is attributed to (Q5): the run's owner, marked as written by Director and
 * by which agent. Docs carry it as `saved_by`, the field the concurrency layer already reads to
 * name who saved last (`services/_shared/iw_common/docsave.py`).
 */
export interface DirectorSavedBy {
	uid: string;
	name: string;
	tool: 'director';
	agent: DirectorAgent;
	runId: string;
	at: string;
	rev: string;
}

/** The project scope an op is checked against on every call. */
export type OpScope =
	/** The run's own project: it must exist and the owner must be able to access it. */
	| 'project'
	/** The run's template project: the owner must be able to access it, and it must still be a
	 *  Director template. For the op that creates the run's project from it. */
	| 'template'
	/** A project the input names (`input.key`): the owner must be able to access it. */
	| 'input'
	/** No single project: the op returns only projects the owner can access. */
	| 'owner';

export interface AdapterContext {
	run: DirectorRun;
	/** The run's owner — every call acts as this user. */
	owner: NonNullable<App.Locals['user']>;
	agent: DirectorAgent;
	/** The access-checked `(client, project)` the op's {@link OpScope} resolved to; null for
	 *  `owner`-scoped ops. */
	scope: { clientKey: string; projectKey: string } | null;
	savedBy: DirectorSavedBy;
}

interface OpBase<I, O> {
	tool: string;
	name: string;
	description: string;
	inputSchema: ObjectSchema;
	agents: readonly DirectorAgent[];
	scope: OpScope;
	handler: (ctx: AdapterContext, input: I) => Promise<O>;
}

export type AdapterOp<I = unknown, O = unknown> =
	| (OpBase<I, O> & { write: false })
	| (OpBase<I, O> & {
			write: true;
			/**
			 * Every R2 key (or `prefix/`) the op writes, so the gate can refuse a forbidden one before
			 * the handler runs. Must be inside the run's project.
			 */
			writes: (input: I, scope: { clientKey: string; projectKey: string }) => string[];
	  })
	| (OpBase<I, O> & {
			write: true;
			/**
			 * The op CREATES the run's project through Game Maker's own path, so it writes a whole
			 * tree that did not exist — including the math contract, copied from the template. The
			 * gate exempts it from the key guard only because nothing is there to overwrite: it
			 * refuses the call when the run's project key is taken in the DB or in R2, unless this
			 * run itself started creating it.
			 */
			createsProject: true;
	  });

/** Type an op by its input and output while the registry stores it erased. The gate validates the
 *  input against `inputSchema` before the handler runs, which is what makes the erasure sound. */
export function defineOp<I, O>(op: AdapterOp<I, O>): AdapterOp {
	return op as unknown as AdapterOp;
}

/** A refusal a handler raises; the gate answers `{ error: code, message }` with `status`. */
export class AdapterError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409 | 413 | 502,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'AdapterError';
	}
}
