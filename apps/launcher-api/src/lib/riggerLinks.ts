/** The `/rigger` query param, and the static page's hash key, that name the rig to open. */
export const RIGGER_RIG_PARAM = 'rig';

/**
 * The `/rigger` URL that opens the Rigger on a rig by its bundle name: the name a rig node and a
 * character sheet store. `projectKey` names the project the rig is in, as every tool link does
 * (`?project=`); without it the Rigger opens on the session's. A name the project has not opens
 * the Rigger's list with a note.
 */
export function riggerLinkFor(rig: string, projectKey?: string): string {
	const params = new URLSearchParams();
	if (projectKey) params.set('project', projectKey);
	params.set(RIGGER_RIG_PARAM, rig);
	return `/rigger?${params.toString()}`;
}

/**
 * The hash `/rigger` hands its static page for the rig a link named (`#rig=<name>`), or `''`. A
 * hash, not a query param: the page reads its target from the hash, and it is never sent to the
 * server with the page's own requests.
 */
export function riggerRigHash(search: URLSearchParams): string {
	const rig = search.get(RIGGER_RIG_PARAM)?.trim();
	return rig ? `#${new URLSearchParams({ [RIGGER_RIG_PARAM]: rig }).toString()}` : '';
}
