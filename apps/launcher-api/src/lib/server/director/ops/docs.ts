import { ZodError } from 'zod';
import { AdapterError, type AdapterContext } from '../adapter';

/**
 * What the PLAN 2.6 adapters share: the version token a read hands out and a write hands back, and
 * the mapping of a tool's own validation failure onto a 400 the agent can act on.
 *
 * A read returns `baseEtag` — the stored object's ETag, or {@link NEW_DOC} when there is no object
 * yet. A write takes it back verbatim and saves under that precondition through the tool's own
 * storage module, so a person's save since the read makes the write a `conflict`, never an
 * overwrite. R2 ETags are quoted, so the bare word cannot collide with one.
 */
export const NEW_DOC = 'new';

export const baseEtagProp = {
	type: 'string',
	description: `The baseEtag the matching read returned ("${NEW_DOC}" when the doc did not exist). A save by anyone since that read makes this write a conflict: re-read and retry.`,
	minLength: 1,
	maxLength: 200,
} as const;

export const baseOf = (etag: string | null | undefined): string => etag ?? NEW_DOC;

/** The storage precondition for a `baseEtag`: `null` asserts the doc does not exist yet. */
export const preconditionOf = (baseEtag: string): string | null =>
	baseEtag === NEW_DOC ? null : baseEtag;

/** The run's project, as the gate resolved and access-checked it for a `project`-scoped op. */
export const projectOf = (ctx: AdapterContext) => ctx.scope!;

/** Run a tool's own validation, answering what it refuses as `invalid_input` rather than a 500. */
export async function validated<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof ZodError) {
			const issues = e.issues.map((i) => `${i.path.join('.') || 'doc'}: ${i.message}`);
			throw new AdapterError(400, 'invalid_input', issues.slice(0, 10).join('; '));
		}
		throw e;
	}
}
