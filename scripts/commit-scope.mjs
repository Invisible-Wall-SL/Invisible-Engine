/**
 * The commit-subject rule, in one place: the `commit-msg` hook (`check-commit-scope.mjs`) applies it
 * to every local commit, and Invisible Pipeline Changes applies it to the subject of a squash merge
 * before asking GitHub, so `main` stays filterable per area (`git log --grep '^launcher:'`) whoever
 * writes to it. Plain JavaScript so the hook runs with no build step; `commit-scope.d.mts` carries
 * its types.
 */

// Area scopes (map to repo regions — keep in sync with .github/CODEOWNERS) +
// a few conventional types for cross-cutting work that isn't area-specific.
export const SCOPES = [
	// engine + games
	'engine',
	'games',
	'packages',
	'rgs',
	'editor',
	// launcher / studio
	'launcher',
	'admin',
	'localization',
	// python pipeline tools
	'pipeline',
	'atlas',
	'atlas-tool',
	'sheet-tool',
	'test-server',
	// cross-cutting
	'docs',
	'infra',
	'ci',
	'build',
	'deps',
	'scripts',
	'chore',
	'refactor',
	'test',
	'fix',
	'feat',
];

/** Machinery commits, which carry no scope: merges, reverts, and fixup!/squash!/amend!. */
const MACHINERY_RE = /^(merge\b|revert\b|fixup!|squash!|amend!)/i;

/** `scope: summary`, `scope(detail): summary` or `scope!: summary`, the scope case-insensitive. */
export const SUBJECT_RE = new RegExp(
	`^(?:${SCOPES.map((s) => s.replace(/[-]/g, '\\-')).join('|')})(?:\\([^)]+\\))?!?:\\s.+`,
	'i',
);

/**
 * Whether a subject passes the hook: it carries a recognized scope, or it is a machinery commit the
 * hook lets through.
 * @param {string} subject
 * @returns {boolean}
 */
export function subjectHasScope(subject) {
	return MACHINERY_RE.test(subject) || SUBJECT_RE.test(subject);
}
