/**
 * Building GitHub URL paths from a name a person chose. A branch name may hold `#` and `%` (git
 * allows both), and `fetch` drops everything from a `#`: `heads/main#x` would be sent as `heads/main`.
 * Every branch put in a path goes through {@link encodePath}, and every ref URL through
 * {@link refReadPath} or {@link refWritePath}: the one place a branch becomes part of a path.
 */

/** A path as a URL: each segment encoded, the slashes kept. */
export const encodePath = (path: string): string =>
	path.split('/').map(encodeURIComponent).join('/');

/** `GET /repos/<repo>/git/ref/heads/<branch>`: a branch's tip. */
export const refReadPath = (repo: string, branch: string): string =>
	`/repos/${repo}/git/ref/heads/${encodePath(branch)}`;

/** `PATCH` or `DELETE /repos/<repo>/git/refs/heads/<branch>`: move or remove a branch. */
export const refWritePath = (repo: string, branch: string): string =>
	`/repos/${repo}/git/refs/heads/${encodePath(branch)}`;

const PLAIN_BRANCH = /^[A-Za-z0-9._/-]+$/;

/**
 * Whether the launcher writes to a branch of this name: letters, digits and `-` `_` `.` `/`, no
 * leading `-`, `/` or trailing `/`, no empty segment, no `..`, no segment starting or ending with
 * `.` and none ending in `.lock`, and none that reads as a ref (`refs/…`, `heads/…`, `HEAD`). The
 * names git allows beyond these are for a person to move by hand.
 */
export function isPlainBranchName(name: string): boolean {
	if (!PLAIN_BRANCH.test(name) || name.includes('..') || name.endsWith('/')) return false;
	if (name.startsWith('-') || name === 'HEAD') return false;
	if (name.startsWith('refs/') || name.startsWith('heads/')) return false;
	return name
		.split('/')
		.every((s) => s !== '' && !s.startsWith('.') && !s.endsWith('.') && !s.endsWith('.lock'));
}
