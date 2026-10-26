/**
 * A tool link that opens `projectKey`, never whatever the session moved to since:
 * `resolveToolScope` takes `?project=` and syncs the session to it. Used by the launcher home and
 * every tool's top bar, so switching tools never switches project behind the author's back.
 */
export function withProject(url: string, projectKey: string | undefined): string {
	if (!projectKey) return url;
	const [path, hash] = url.split('#', 2);
	const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
	params.set('project', projectKey);
	const base = path.includes('?') ? path.slice(0, path.indexOf('?')) : path;
	return `${base}?${params.toString()}${hash === undefined ? '' : `#${hash}`}`;
}

/**
 * The "Report bug" link on every tool's bar: Invisible Pipeline Bug Reports' form (`bugsUrl`) with
 * the tool filled in, and where it happened — the page's address without its query (an external
 * tool's can carry a launch token), plus the project the bar shows. The HTML twins build the same.
 */
export function reportBugHref(
	bugsUrl: string,
	toolId: string,
	pageAddress: string,
	projectKey: string | undefined,
): string {
	const params = new URLSearchParams({
		new: '1',
		for: toolId,
		page: withProject(pageAddress, projectKey),
	});
	return `${bugsUrl}?${params.toString()}`;
}
