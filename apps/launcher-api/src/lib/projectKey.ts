/**
 * A project key as Game Maker accepts it, in one place for every form and gate that takes one:
 * the Create and Duplicate forms, Invisible Director's New game, and the server's
 * `isValidProjectKey`. The words are the ones every refusal uses.
 */
export const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The same rule for an `<input pattern>` (no anchors; the browser adds them). */
export const PROJECT_KEY_HTML_PATTERN = '[a-z0-9][a-z0-9_\\-]{0,63}';

export const PROJECT_KEY_WORDS = 'Key must match a-z, 0-9, _ or - (max 64).';

export const isValidProjectKey = (value: string): boolean => PROJECT_KEY_PATTERN.test(value);

/** Slugify a typed name into a project key: lower-case, runs of anything else become `-`. */
export function slugifyProjectKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}
