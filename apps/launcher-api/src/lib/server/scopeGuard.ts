import { json } from '@sveltejs/kit';

/**
 * The SCOPE GUARD for a write (or read) that resolves its project from the SESSION. The tab that
 * sends it resolved its project when it opened; switching project in another tab moves the session
 * under it. Unguarded that is a silent cross-project write; with `If-Match` alone it masquerades as
 * an ordinary conflict and invites an "overwrite" that destroys an unrelated project's work.
 *
 * The caller sends the project it was loaded for (`projectKey`); a mismatch is refused with a 409
 * `scope-mismatch`, which `force` never bypasses. The sent key is only ever COMPARED, never used as
 * the target, so a client still cannot name a project the session does not hold. Absent ⇒ no
 * check (older callers, e.g. the Rigger's static page); the editor's own callers always send it
 * (`check:component-links` enumerates them).
 *
 * Returns the 409 response to send, or `null` to go ahead. `json(…)`, never `error()`: the tools
 * read `error: 'scope-mismatch'` from the body.
 */
export function scopeMismatch(sent: unknown, projectKey: string): Response | null {
	if (typeof sent !== 'string' || sent === projectKey) return null;
	return json(
		{
			ok: false,
			error: 'scope-mismatch',
			message:
				`This tab is editing "${sent}" but your active project is now "${projectKey}". ` +
				'Reload to continue — going on here would act on the wrong project.',
		},
		{ status: 409 },
	);
}
