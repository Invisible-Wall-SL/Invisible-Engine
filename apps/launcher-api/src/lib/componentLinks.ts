/**
 * Where component authoring lives: the Components side of `/editor` (Rive plan Phase 4). The old
 * standalone `/components` route redirects here, so every link to it keeps working.
 *
 *   /components                 → /editor?view=components
 *   /components?id=<id>         → /editor?component=<id>
 *
 * Every other query parameter (`project`, `client`, …) is carried over unchanged, so a deep link
 * still binds to the project it named.
 */
export const COMPONENTS_VIEW_PARAM = 'view';
export const COMPONENTS_VIEW_VALUE = 'components';
export const COMPONENT_PARAM = 'component';

/** The `/editor` URL that opens the Components side, on `id` when given. */
export function componentsHref(id?: string | null, search?: URLSearchParams): string {
	const params = new URLSearchParams(search);
	params.delete(COMPONENT_PARAM);
	params.delete(COMPONENTS_VIEW_PARAM);
	if (id) params.set(COMPONENT_PARAM, id);
	else params.set(COMPONENTS_VIEW_PARAM, COMPONENTS_VIEW_VALUE);
	return `/editor?${params.toString()}`;
}

/** The `/editor` URL a legacy `/components?…` link lands on. */
export function legacyComponentsRedirect(search: URLSearchParams): string {
	const rest = new URLSearchParams(search);
	const id = rest.get('id');
	rest.delete('id');
	return componentsHref(id, rest);
}

/** What an `/editor` URL asks the Components side to open: `undefined` = the Screens side,
 * `null` = the components home, a string = that component. */
export function componentsTarget(search: URLSearchParams): string | null | undefined {
	const id = search.get(COMPONENT_PARAM);
	if (id) return id;
	return search.get(COMPONENTS_VIEW_PARAM) === COMPONENTS_VIEW_VALUE ? null : undefined;
}

/**
 * What `/editor`, open on `projectKey`, does with a navigation to `/editor` itself (a tool-bar
 * card, a deep link). The page holds one project's screens, components, ETags and leases, and a
 * same-route navigation does not remount it:
 *   - `in-place` — the link names this same project: only the side or the open component changes,
 *     which the page applies itself;
 *   - `reload` — another project, or none named (the server would fall back to the session's,
 *     which another tab may have moved): a full document load, so one project's state is never
 *     saved into another.
 */
export function editorSelfNavigation(to: URL, projectKey: string): 'in-place' | 'reload' {
	return to.searchParams.get('project')?.trim() === projectKey ? 'in-place' : 'reload';
}
