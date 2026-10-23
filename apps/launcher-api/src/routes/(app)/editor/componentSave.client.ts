import type { ComponentDef } from 'engine-layout';

export interface ComponentSaveRequest {
	/** The POST body for `/api/editor/component`. */
	body: Record<string, unknown>;
	/** The save writes this project's copy of a shared or built-in component. */
	copiesToProject: boolean;
}

/**
 * The request **Save component** sends for `draft`.
 *
 * A project component saves to its project. A shared or built-in one opened inside a project saves
 * as that project's copy under the same id, which shadows the shared one in this project only:
 * saving it back to the shared library would change every game without its own copy, needs the
 * `componentPublish` capability, and is refused whenever the edit places this project's art (a
 * shared def may not depend on one project's rigs). Writing the shared library is
 * **Promote to shared**. With no project open, a shared draft still saves to the shared library.
 *
 * `baseEtag` is the precondition of the key the draft was loaded from, so a copy sends `null`
 * instead: the project had no copy of its own, or the draft would have opened as that copy.
 */
export function componentSaveRequest(
	draft: ComponentDef,
	projectKey: string,
	{ baseEtag, force }: { baseEtag: string | null; force: boolean },
): ComponentSaveRequest {
	const copiesToProject = draft.scope !== 'project' && projectKey.length > 0;
	const def = copiesToProject ? { ...draft, scope: 'project' as const } : draft;
	const precondition = force ? { force: true } : { baseEtag: copiesToProject ? null : baseEtag };
	return {
		body: {
			...def,
			...(def.scope === 'project' ? { project: projectKey } : {}),
			...precondition,
		},
		copiesToProject,
	};
}

/** The message a refused component save shows: the server's reason, else its status. */
export async function componentSaveError(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { message?: unknown };
		if (typeof body?.message === 'string' && body.message) return body.message;
	} catch {
		/* non-JSON error body */
	}
	return `Component save failed (${res.status}).`;
}
