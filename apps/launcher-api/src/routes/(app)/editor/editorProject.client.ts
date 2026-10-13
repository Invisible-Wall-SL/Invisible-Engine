/**
 * The project the editor page was LOADED for, bound once by `+page.svelte` before anything mounts.
 * The module-level fetch helpers (art bounds, flipbook clips) read it to pin every request, so a
 * read or a save from this tab can never be answered with — or land in — whatever project another
 * tab moved the session to (the server refuses a mismatch: `scopeMismatch`).
 */
let projectKey = '';

export function bindEditorProject(key: string): void {
	projectKey = key;
}

export function editorProjectKey(): string {
	return projectKey;
}

/** `url` with this tab's `projectKey` appended (unchanged when none is bound). */
export function withEditorProject(url: string): string {
	if (!projectKey) return url;
	return `${url}${url.includes('?') ? '&' : '?'}projectKey=${encodeURIComponent(projectKey)}`;
}
