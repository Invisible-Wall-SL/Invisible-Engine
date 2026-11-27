/**
 * Building GitHub URL paths from a name a person chose. A branch name may hold `#` and `%` (git
 * allows both), and `fetch` drops everything from a `#`: `heads/main#x` would be sent as `heads/main`.
 * Every branch put in a path goes through {@link encodePath}.
 */

/** A path as a URL: each segment encoded, the slashes kept. */
export const encodePath = (path: string): string =>
	path.split('/').map(encodeURIComponent).join('/');

const PLAIN_BRANCH = /^[A-Za-z0-9._/-]+$/;

/**
 * Whether the launcher writes to a branch of this name: letters, digits and `-` `_` `.` `/`, no
 * leading or trailing `/`, no empty segment, no `..`, no segment starting or ending with `.` and
 * none ending in `.lock`. The names git allows beyond these are for a person to move by hand.
 */
export function isPlainBranchName(name: string): boolean {
	if (!PLAIN_BRANCH.test(name) || name.includes('..') || name.endsWith('/')) return false;
	return name
		.split('/')
		.every((s) => s !== '' && !s.startsWith('.') && !s.endsWith('.') && !s.endsWith('.lock'));
}
