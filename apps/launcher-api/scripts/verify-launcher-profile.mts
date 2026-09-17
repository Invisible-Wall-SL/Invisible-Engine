// Offline fixture for the DERIVED desktop-launcher profile (`src/lib/server/launcherProfile.ts`).
//
//   cd apps/launcher-api && npx tsx scripts/verify-launcher-profile.mts
//
// WHAT IT PROVES. `GET /api/launcher/projects` used to serve `projects.launcher_profile`
// verbatim — a column ONLY the desktop launcher's owner-only "⬆ Setup" ever wrote. So a
// project created ONLINE synced down with no `game` block, the desktop's ☁ Publish refused
// it ("no 'Cloud publish' section"), and its build command / cwd / output dir / protocol /
// cloud key were hand-typed per project. The profile is now derived from the project's own
// authored game kind instead.
//
// Five claims, over the REAL modules:
//
//   1. PROTOCOL PARITY — the derivation and the online publish read the SAME `protocolFor`,
//      so the mock the test server deals cannot depend on which end published the game.
//      This is the load-bearing one: two copies of this map is how a `ways` project ends up
//      dealt as `lines` from one path and `ways` from the other.
//   2. The derived publish block pins the engine submodule BEFORE the frozen install, and
//      makes the cloud key and the portal project key the same slug (a mismatch registers
//      the game "global", visible under every project).
//   3. A STORED profile still wins — the desktop knows its own build best — and is still
//      normalized to pin the submodule when it predates that contract.
//   4. The two carve-outs hold: a ComfyUI workspace (`kind: 'comfy'`) and the shared default
//      `cloud` project never grow a publish block they cannot honour.
//   5. The derived shape is exactly what the desktop reads. `_synced_entry` in
//      Invisible_Launcher.py takes `profile.game`, `profile.kind`, `profile.repo` and
//      `profile.base_rel`; a derived profile must fill `game` without inventing a `repo`
//      (the portal genuinely has none) and must flag itself `derived` so the launcher keeps
//      a local publish block in preference to it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derivePublishBlock, launcherProfileFor } from '../src/lib/server/launcherProfile';
import { protocolFor } from '../src/lib/server/mockProtocol';

type Rec = Record<string, unknown>;
const pubOf = (profile: unknown): Rec => ((profile as Rec).game as Rec).publish as Rec;

let checks = 0;
const ok = (label: string, fn: () => void) => {
	fn();
	checks++;
	console.log(`  ✓ ${label}`);
};

// ── 1. Protocol parity ────────────────────────────────────────────────────────────────
console.log('1. protocol parity — one map, both publish paths');
ok('every built-in kind maps to its own mock', () => {
	assert.equal(protocolFor('lines'), 'lines');
	assert.equal(protocolFor('bookOf'), 'book');
	assert.equal(protocolFor('ways'), 'ways');
	assert.equal(protocolFor('cluster'), 'cluster');
	assert.equal(protocolFor('scatter'), 'scatter');
});
ok('a custom kind falls back to the lines mock, not to undefined', () => {
	// §21.6 custom kinds are author-created ids with no mock of their own.
	assert.equal(protocolFor('my-custom-kind'), 'lines');
	assert.equal(protocolFor(''), 'lines');
});
ok('the derived block reads the SAME map (no second copy)', () => {
	for (const kind of ['lines', 'bookOf', 'ways', 'cluster', 'scatter', 'whatever']) {
		assert.equal(
			derivePublishBlock({ key: 'k', name: 'K', gameType: kind }).protocol,
			protocolFor(kind),
			`kind ${kind}`,
		);
	}
});

// ── 2. The derived publish block ──────────────────────────────────────────────────────
console.log('2. the derived publish block');
const derived = derivePublishBlock({
	key: 'bookofborut',
	name: 'Book of Borut',
	gameType: 'bookOf',
});
ok('pins the submodule BEFORE the frozen install', () => {
	assert.equal(
		derived.build_cmd,
		'git submodule update --init --recursive && pnpm install && pnpm build',
	);
	assert.ok(
		derived.build_cmd.indexOf('submodule update') < derived.build_cmd.indexOf('pnpm install'),
		'the pin must precede the install or the lockfile check fails',
	);
});
ok('cloud key == portal project key', () => {
	assert.equal(derived.key, 'bookofborut');
	assert.equal(derived.project, 'bookofborut');
});
ok('carries the standalone build layout + the kind-derived protocol', () => {
	assert.equal(derived.build_cwd, '.');
	assert.equal(derived.build_out, 'build');
	assert.equal(derived.protocol, 'book');
	assert.equal(derived.name, 'Book of Borut');
});
ok('a nameless project falls back to its key, never to an empty card title', () => {
	assert.equal(derivePublishBlock({ key: 'k', name: '', gameType: 'lines' }).name, 'k');
});

// ── 3. A stored profile still wins ────────────────────────────────────────────────────
console.log('3. a stored profile wins, and is still normalized');
const project = { key: 'hotfruits', name: 'Hot Fruits', gameType: 'lines' };
ok('a hand-tuned build command survives untouched', () => {
	const stored = {
		kind: 'game',
		repo: { url: 'https://github.com/Invisible-Wall-SL/hotfruits.git', branch: 'main' },
		game: {
			publish: {
				key: 'hotfruits',
				name: 'Hot Fruits',
				protocol: 'lines',
				build_cmd: 'git submodule update --init --recursive && pnpm i && pnpm run ship',
				build_cwd: 'frontend',
				build_out: 'dist',
			},
		},
	};
	const out = launcherProfileFor(stored, project);
	assert.deepEqual(out, stored, 'an already-pinning stored profile must pass through byte-equal');
	assert.equal((out as Rec).derived, undefined, 'a stored profile is not flagged derived');
});
ok('a stored profile predating the pin contract gets the pin prepended', () => {
	const out = launcherProfileFor(
		{
			kind: 'game',
			game: { publish: { key: 'hotfruits', build_cmd: 'pnpm install && pnpm build' } },
		},
		project,
	);
	assert.equal(
		pubOf(out).build_cmd,
		'git submodule update --init --recursive && pnpm install && pnpm build',
	);
});
ok('a stored profile with a BLANK build command is repaired, not left empty', () => {
	const out = launcherProfileFor(
		{ game: { publish: { key: 'hotfruits', build_cmd: '  ' } } },
		project,
	);
	assert.equal(
		pubOf(out).build_cmd,
		'git submodule update --init --recursive && pnpm install && pnpm build',
	);
});

// ── 4. The carve-outs ─────────────────────────────────────────────────────────────────
console.log('4. carve-outs — what must NOT grow a publish block');
ok('a ComfyUI workspace is left alone', () => {
	const comfy = { kind: 'comfy', base_rel: 'ComfyUI', repo: { url: 'x', branch: '' } };
	const out = launcherProfileFor(comfy, { key: 'gpu-box', name: 'GPU box', gameType: 'lines' });
	assert.deepEqual(out, comfy);
	assert.equal((out as Rec).game, undefined, 'a comfy project must not gain a Launch Game button');
});
ok('the endpoint excludes the shared default `cloud` scope from derivation', () => {
	// Asserted against the source: the carve-out lives in the route (deciding which projects
	// are real titles is its job), and this module stays a leaf so it can be verified offline.
	// A regression here would put a ☁ Publish button that cannot work on every launcher.
	const route = readFileSync(
		new URL('../src/routes/api/launcher/projects/+server.ts', import.meta.url),
		'utf8',
	);
	assert.match(
		route.replace(/\s+/g, ' '),
		/p\.key === DEFAULT_PROJECT_KEY \? p\.launcherProfile : launcherProfileFor\(/,
		'the cloud carve-out must guard the launcherProfileFor call',
	);
});

// ── 5. The shape the desktop actually reads ───────────────────────────────────────────
console.log('5. the shape Invisible_Launcher.py `_synced_entry` reads');
const online = launcherProfileFor(null, {
	key: 'newslot',
	name: 'New Slot',
	gameType: 'ways',
}) as Rec;
ok('null stored ⇒ a complete game profile derived from the kind', () => {
	assert.equal(online.kind, 'game');
	assert.equal(pubOf(online).protocol, 'ways');
	assert.equal(pubOf(online).key, 'newslot');
	assert.equal(pubOf(online).project, 'newslot');
});
ok('flags itself `derived` so a local publish block is not clobbered on Sync', () => {
	assert.equal(online.derived, true);
});
ok('invents NO repo — the portal has none for a data-only online project', () => {
	assert.equal(online.repo, undefined);
	assert.equal(online.base_rel, undefined);
});
ok('a stored profile with a repo but no game keeps the repo and gains the build', () => {
	const out = launcherProfileFor(
		{ repo: { url: 'https://github.com/Invisible-Wall-SL/newslot.git', branch: 'main' } },
		{ key: 'newslot', name: 'New Slot', gameType: 'cluster' },
	) as Rec;
	assert.deepEqual(out.repo, {
		url: 'https://github.com/Invisible-Wall-SL/newslot.git',
		branch: 'main',
	});
	assert.equal(pubOf(out).protocol, 'cluster');
	assert.equal(out.derived, true);
});
ok('derivation does not mutate the stored object', () => {
	const stored = { repo: { url: 'u', branch: '' } };
	const snapshot = JSON.stringify(stored);
	launcherProfileFor(stored, { key: 'k', name: 'K', gameType: 'lines' });
	assert.equal(JSON.stringify(stored), snapshot);
});

console.log(`\nPASS — ${checks} checks.`);
