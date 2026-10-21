// Offline fixture for scripts/deploy-drift.mjs — the scheduled "Deploy drift" check.
//
//   node scripts/deploy-drift.fixture.mjs
//
// Three claims:
//   1. The verdict: nothing pending is current, pending inside the grace window is a deploy in
//      flight, pending past it is a missed deploy, and a running commit off `main` is drift too.
//   2. A watch-path service's pending commits are exactly the ones touching its watch paths (a
//      real git repo, real pathspecs), and a service with no watch paths waits on every commit.
//   3. The script's watch paths are the ones docs/INFRA.md lists — a copy that drifted would
//      silently miss, or invent, a deploy.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIFTED, GRACE_MINUTES, pendingCommits, SERVICES, verdict } from './deploy-drift.mjs';

let checks = 0;
const ok = (label, fn) => {
	fn();
	checks++;
	console.log(`  ✓ ${label}`);
};

console.log('1. the verdict');
const now = 1_800_000_000;
const at = (minutesAgo) => ({ sha: 'x', subject: 's', time: now - minutesAgo * 60 });
ok('nothing pending is current', () => {
	assert.equal(verdict({ onMain: true, pending: [], now }), 'current');
});
ok('pending inside the grace window is a deploy still in flight', () => {
	assert.equal(verdict({ onMain: true, pending: [at(GRACE_MINUTES - 1)], now }), 'deploying');
});
ok('one commit past the window is a missed deploy, whatever came after it', () => {
	assert.equal(verdict({ onMain: true, pending: [at(GRACE_MINUTES + 1), at(2)], now }), 'behind');
});
ok('a running commit off main is drift', () => {
	assert.equal(verdict({ onMain: false, pending: [], now }), 'off-main');
});
ok('only behind and off-main raise the alarm', () => {
	assert.deepEqual([...DRIFTED].sort(), ['behind', 'off-main']);
});

console.log('2. pending commits follow the watch paths');
const repo = mkdtempSync(join(tmpdir(), 'deploy-drift-'));
const git = (...args) =>
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
		cwd: repo,
		encoding: 'utf8',
	}).trim();
const commit = (path, subject) => {
	mkdirSync(dirname(join(repo, path)), { recursive: true });
	writeFileSync(join(repo, path), subject);
	git('add', '-A');
	git('commit', '-q', '-m', subject);
	return git('rev-parse', 'HEAD');
};
const cwd = process.cwd();
try {
	git('init', '-q');
	const deployed = commit('README.md', 'base');
	commit('docs/INFRA.md', 'docs only');
	commit('services/_shared/iw_common/x.py', 'shared');
	commit('services/atlas-tool/ui_server.py', 'atlas');
	commit('scripts/mock-rgs-server-book.mjs', 'mock');
	commit('scripts/other.mjs', 'other script');
	process.chdir(repo);
	const watchOf = (name) => SERVICES.find((s) => s.name === name).watch;
	const subjects = (name) => pendingCommits(deployed, watchOf(name)).map((c) => c.subject);
	ok('atlas-tool waits on its own folder and services/_shared, oldest first', () => {
		assert.deepEqual(subjects('atlas-tool'), ['shared', 'atlas']);
	});
	ok('sheet-tool waits on services/_shared only', () => {
		assert.deepEqual(subjects('sheet-tool'), ['shared']);
	});
	ok('the test server waits on the mock RGS scripts, not every script', () => {
		assert.deepEqual(subjects('Invisible-test-Server'), ['mock']);
	});
	ok('the launcher (no watch paths) waits on every commit', () => {
		assert.deepEqual(subjects('launcher'), [
			'docs only',
			'shared',
			'atlas',
			'mock',
			'other script',
		]);
	});
	ok('a service on HEAD has nothing pending', () => {
		assert.deepEqual(pendingCommits(git('rev-parse', 'HEAD'), null), []);
	});
} finally {
	process.chdir(cwd);
	rmSync(repo, { recursive: true, force: true });
}

console.log('3. the watch paths are the ones docs/INFRA.md lists');
const infra = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'INFRA.md'),
	'utf8',
);
const start = infra.indexOf('| Service                   | Watch Paths');
const table = infra.slice(start, infra.indexOf('\n\n', start));
const listed = Object.fromEntries(
	[...table.matchAll(/^\| \*\*([^*]+)\*\*\s*\|([^|]+)\|/gm)].map(([, name, cell]) => [
		name,
		[...cell.matchAll(/`\/([^`]+)`/g)].map(([, path]) => path),
	]),
);
ok('every service with watch paths matches its INFRA row', () => {
	const watched = Object.fromEntries(SERVICES.filter((s) => s.watch).map((s) => [s.name, s.watch]));
	assert.deepEqual(watched, listed);
});
ok('the launcher has none, as INFRA says', () => {
	assert.equal(SERVICES.find((s) => s.name === 'launcher').watch, null);
	assert.match(infra, /The \*\*launcher\*\* deliberately has none/);
});

console.log(`\nPASS — ${checks} checks.`);
