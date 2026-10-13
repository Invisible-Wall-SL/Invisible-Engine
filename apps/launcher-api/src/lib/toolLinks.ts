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
