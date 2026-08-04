#!/usr/bin/env node
// Bump a standalone game repo's vendored `engine/` submodule AND refresh the game's
// root pnpm-lock.yaml in ONE atomic commit.
//
// WHY THIS EXISTS: a game repo's pnpm-workspace.yaml globs `engine/packages/*`, so its
// root lockfile pins the engine packages' dependency specifiers. The launcher build runs
// `pnpm install` frozen (CI=1). If you advance the engine pin WITHOUT regenerating the
// lockfile, that frozen install hard-fails with ERR_PNPM_OUTDATED_LOCKFILE — the exact
// break a pixi-svelte dep change (adding `config-lingui`) caused. The pin and the lockfile
// MUST travel together; the naive `git add engine && git commit` (what the old scaffold
// README documented) omits the lockfile and reintroduces the break every time.
//
// USAGE:
//   node <engine>/scripts/bump-game-engine.mjs [gameRepoDir] [--to <ref>] [--no-commit]
//     gameRepoDir  path to the game repo (default: cwd)
//     --to <ref>   engine ref to move to (default: origin/main)
//     --no-commit  do everything except the commit (inspect, then commit yourself)
//
// It does NOT push — it prints the push command so you stay in control of the deploy.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};
const has = (name) => args.includes(name);

const to = flag('--to') ?? 'origin/main';
const noCommit = has('--no-commit');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--to');
const repo = resolve(positional[0] ?? process.cwd());
const engineDir = join(repo, 'engine');

const sh = (cmd, cwd = repo) =>
	execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim();
const shInherit = (cmd, cwd = repo) => execSync(cmd, { cwd, stdio: 'inherit' });

// --- sanity: this looks like a game repo with a vendored engine submodule ---
if (!existsSync(join(repo, '.gitmodules')) || !existsSync(engineDir)) {
	console.error(`✗ ${repo}\n  Not a game repo (no .gitmodules / engine/). Pass the repo dir as the first arg.`);
	process.exit(1);
}
const ws = existsSync(join(repo, 'pnpm-workspace.yaml'))
	? readFileSync(join(repo, 'pnpm-workspace.yaml'), 'utf8')
	: '';
if (!ws.includes('engine/packages/')) {
	console.error(`✗ ${repo}\n  pnpm-workspace.yaml does not glob engine/packages/* — nothing to refresh here.`);
	process.exit(1);
}

console.log(`• Game repo: ${repo}`);
console.log(`• Fetching engine + moving submodule to ${to} …`);
sh('git fetch origin --quiet', engineDir);
const from = sh('git rev-parse --short HEAD', engineDir);
// `-f`: the vendored engine is read-only in a game repo, so any dirty state inside it is
// build-generated noise (e.g. engine-layout's generated scenes/bookof.json). Force past it.
sh(`git checkout -f ${to}`, engineDir);
const at = sh('git rev-parse --short HEAD', engineDir);
if (from === at) {
	console.log(`• Engine already at ${at} — nothing to bump.`);
} else {
	console.log(`• Engine ${from} → ${at}`);
}

console.log('• Refreshing root lockfile (pnpm install --lockfile-only) …');
shInherit('pnpm install --lockfile-only');

console.log('• Verifying a frozen install accepts it (the launcher build check) …');
shInherit('pnpm install --frozen-lockfile');

// Stage ONLY the two coupled files — never the author's asset/src working changes.
sh('git add engine pnpm-lock.yaml');
const staged = sh('git diff --cached --name-only');
if (!staged) {
	console.log('\n✓ Nothing changed — engine and lockfile were already current.');
	process.exit(0);
}
console.log(`\n• Staged: ${staged.split('\n').join(', ')}`);

if (noCommit) {
	console.log('\n--no-commit: staged but not committed. Commit + push when ready.');
	process.exit(0);
}

const msg = `engine: bump submodule to ${at} + refresh lockfile\n\nAdvances the vendored engine pin (${from} → ${at}) and regenerates the game\nroot pnpm-lock.yaml in the SAME commit so the launcher's frozen install stays\ngreen. Do not split these — see scripts/bump-game-engine.mjs.`;
execSync('git commit -F -', { cwd: repo, input: msg, stdio: ['pipe', 'inherit', 'inherit'] });
console.log(`\n✓ Committed. Push when ready:\n    git -C "${repo}" push origin main`);
