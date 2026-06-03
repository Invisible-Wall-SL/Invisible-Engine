#!/usr/bin/env node
/**
 * commit-msg hook: require a recognized scope prefix on the subject line so the
 * single `main` history stays filterable per area (`git log --grep '^launcher:'`).
 *
 * Enable once per clone:  git config core.hooksPath scripts/git-hooks
 * Manual run:             node scripts/check-commit-scope.mjs <path-to-msg-file>
 *
 * Accepted subject forms (case-insensitive scope):
 *   scope: summary
 *   scope(detail): summary          e.g.  editor(slots): ...
 *   scope!: summary                 (breaking change)
 *
 * Skipped automatically: merge commits, reverts, and fixup!/squash! commits.
 * Rare one-off bypass:    git commit --no-verify
 */
import { readFileSync } from 'node:fs';

// Area scopes (map to repo regions — keep in sync with .github/CODEOWNERS) +
// a few conventional types for cross-cutting work that isn't area-specific.
const SCOPES = [
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
	'atlas-backend',
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

const msgPath = process.argv[2];
if (!msgPath) {
	console.error('check-commit-scope: no commit message file passed.');
	process.exit(1);
}

const raw = readFileSync(msgPath, 'utf8');
// First non-comment, non-blank line is the subject.
const subject = raw
	.split('\n')
	.find((l) => l.trim() && !l.startsWith('#'))
	?.trim();

if (!subject) process.exit(0); // empty commit message — let git handle it

// Skip machinery commits.
if (/^(merge\b|revert\b|fixup!|squash!|amend!)/i.test(subject)) process.exit(0);

const scopeAlt = SCOPES.map((s) => s.replace(/[-]/g, '\\-')).join('|');
const re = new RegExp(`^(?:${scopeAlt})(?:\\([^)]+\\))?!?:\\s.+`, 'i');

if (re.test(subject)) process.exit(0);

console.error(`
✗ Commit subject needs a recognized scope prefix.

  Your subject: ${subject}

  Use:  <scope>: <summary>      e.g.  launcher: add session colour tags
        <scope>(detail): ...           editor(slots): fill via dropdown
        <scope>!: ...                  (breaking change)

  Allowed scopes:
    ${SCOPES.join(', ')}

  This keeps the single main history filterable per area
  (git log --grep '^launcher:').  Add a scope and recommit.
  Genuine one-off exception:  git commit --no-verify
`);
process.exit(1);
