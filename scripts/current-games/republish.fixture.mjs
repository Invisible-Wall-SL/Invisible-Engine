// The "as republished" variant (`lib/builtins.mjs`, `lib/republish.mjs`) and its planning
// (`planRepublished` in `lib/plan.mjs`), on a synthetic snapshot — no browser, no R2. Runs under the
// TS loader, as `check:all` runs every `*.fixture.mjs`:
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/current-games/republish.fixture.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import {
	BUILTINS_FILE,
	canonical,
	extractBuiltins,
	extractBuiltinsAt,
	publishedBuiltinsFor,
	readBuiltins,
	republishVariants,
	resolveCommit,
} from './lib/builtins.mjs';
import { planRepublished, unitId } from './lib/plan.mjs';
import { classifyBaked, republish } from './lib/republish.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'cg-republish-'));

let failures = 0;
const test = async (name, fn) => {
	try {
		await fn();
		console.log(`ok   ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL ${name}\n     ${e.stack ?? e.message}`);
	}
};

// 1. The extraction: this checkout's built-ins, as a runtime build carries them.
const buildDir = join(tmp, 'build');
await test('a runtime build carries every built-in def, keyed by id', () => {
	extractBuiltins(ROOT, join(tmp, BUILTINS_FILE));
	// `extractBuiltins` writes the file it is asked for; `readBuiltins` reads a build dir's.
	rmSync(buildDir, { recursive: true, force: true });
	spawnSync('mkdir', ['-p', buildDir]);
	writeFileSync(join(buildDir, BUILTINS_FILE), readFileSync(join(tmp, BUILTINS_FILE)));
	const builtins = readBuiltins(buildDir);
	assert.equal(builtins.version, 1);
	assert.deepEqual(Object.keys(builtins.defs).sort(), BUILTIN_COMPONENTS.map((d) => d.id).sort());
	assert.equal(
		canonical(builtins.defs.freeSpinCounter),
		canonical(BUILTIN_COMPONENTS.find((d) => d.id === 'freeSpinCounter')),
	);
	assert.equal(readBuiltins(join(tmp, 'no-such-build')), null);
});

// CI hands the build a RELATIVE cache path, so the checkout and the out file arrive relative to a
// cwd that is not the checkout; the child must not resolve them against the worktree (the first CI
// run did, and looked for the source at a doubled path).
await test('the extraction takes relative paths from another cwd', () => {
	const cwd = process.cwd();
	process.chdir(tmp);
	try {
		extractBuiltins(relative(tmp, ROOT), relative(tmp, join(tmp, 'relative', BUILTINS_FILE)));
	} finally {
		process.chdir(cwd);
	}
	assert.equal(
		canonical(readBuiltins(join(tmp, 'relative')).defs),
		canonical(readBuiltins(buildDir).defs),
	);
});

const base = readBuiltins(buildDir).defs;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** A head whose `freeSpinCounter` frame sits 1 px to the right (the proof's change). */
const headMoved = () => {
	const head = clone(base);
	head.freeSpinCounter.root.children[0].x += 1;
	return head;
};

const instance = (id, n) => ({
	id: `${id}-${n}`,
	kind: 'componentInstance',
	componentId: id,
	x: 0,
	y: 0,
});

/** A snapshot like a publish writes it: the doc, the baked closure, one def the author edited. */
const snapshot = () => {
	const hudReadout = { ...clone(base.hudReadout), name: 'My Readout' };
	return {
		doc: {
			scenes: [
				{ id: 'basegame', nodes: [instance('freeSpinCounter', 1), instance('hudReadout', 1)] },
				{ id: 'loading', nodes: [instance('loadingBar', 1)] },
			],
		},
		componentDefs: {
			freeSpinCounter: clone(base.freeSpinCounter),
			hudReadout,
			loadingBar: clone(base.loadingBar),
		},
		componentDefaults: {},
		editorArt: { sheets: [], images: [] },
	};
};

await test("a baked def equal to main's built-in is a copy; an edited one is the author's", () => {
	const { copies, authored } = classifyBaked(snapshot(), base);
	assert.deepEqual(copies, ['freeSpinCounter', 'loadingBar']);
	assert.deepEqual(authored, ['hudReadout']);
});

await test("the head variant carries the branch's built-in, the base variant the snapshot's copy", async () => {
	const bundle = snapshot();
	const made = await republish(bundle, base, headMoved());
	assert.deepEqual(made.meta, {
		copies: ['freeSpinCounter', 'loadingBar'],
		authored: ['hudReadout'],
		changed: ['freeSpinCounter'],
		versionsChanged: false,
		affected: true,
		classifiedAgainst: 'main',
	});
	assert.equal(
		made.head.componentDefs.freeSpinCounter.root.children[0].x,
		base.freeSpinCounter.root.children[0].x + 1,
	);
	for (const id of Object.keys(bundle.componentDefs))
		assert.equal(
			canonical(made.base.componentDefs[id]),
			canonical(bundle.componentDefs[id]),
			`${id} on the base side`,
		);
	assert.equal(made.head.componentDefs.hudReadout.name, 'My Readout', 'the authored def is kept');
	assert.equal(made.head.componentDefs.loadingBar.name, base.loadingBar.name);
	// Everything else in the snapshot travels untouched.
	assert.deepEqual(made.head.doc, bundle.doc);
	assert.deepEqual(made.head.editorArt, bundle.editorArt);
	assert.equal('componentVersions' in made.head, false);
});

await test("a copy of a built-in that main changed since the publish is told by the published engine's built-ins", async () => {
	// The game was published on an engine whose counter frame was narrower; main has since widened it,
	// and the branch moves it. Against main's built-ins the baked copy reads as authored (kept, so the
	// branch's change is missed); against the published engine's it is the copy it is.
	const published = clone(base);
	published.freeSpinCounter.root.children[0].width -= 10;
	const bundle = snapshot();
	bundle.componentDefs.freeSpinCounter = clone(published.freeSpinCounter);
	const missed = await republish(bundle, base, headMoved());
	assert.equal(missed.meta.affected, false, "main's built-ins miss the stale copy");
	assert.deepEqual(missed.meta.authored, ['freeSpinCounter', 'hudReadout']);
	assert.equal(missed.meta.classifiedAgainst, 'main');
	const told = await republish(bundle, base, headMoved(), published);
	assert.equal(told.meta.classifiedAgainst, 'published');
	assert.deepEqual(told.meta.copies, ['freeSpinCounter', 'loadingBar']);
	assert.deepEqual(told.meta.changed, ['freeSpinCounter']);
	// Both variants carry a current def: main's on the base side, the branch's on the head side.
	assert.equal(
		told.base.componentDefs.freeSpinCounter.root.children[0].width,
		base.freeSpinCounter.root.children[0].width,
	);
	assert.equal(
		told.head.componentDefs.freeSpinCounter.root.children[0].x,
		base.freeSpinCounter.root.children[0].x + 1,
	);
});

await test('the built-ins of a commit are read from a bare worktree of it', () => {
	const sha = resolveCommit('HEAD', ROOT);
	assert.match(sha, /^[0-9a-f]{40}$/);
	assert.equal(resolveCommit('no-such-ref-0000', ROOT), null);
	assert.equal(resolveCommit('bad ref; rm -rf', ROOT), null);
	const file = join(tmp, 'at', 'builtins.json');
	extractBuiltinsAt(sha, file, { repo: ROOT, cache: join(tmp, 'cache') });
	assert.equal(canonical(readBuiltins(join(tmp, 'at')).defs), canonical(base));
	assert.equal(
		existsSync(join(tmp, 'cache', 'worktrees', `builtins-${sha}`)),
		false,
		'the worktree is removed',
	);
	assert.throws(
		() =>
			extractBuiltinsAt('0'.repeat(40), join(tmp, 'at2', 'b.json'), {
				repo: ROOT,
				cache: join(tmp, 'cache'),
			}),
		/worktree add/,
	);
});

await test("which built-ins tell a game's copies: the fixture's own, the published engine's, else main's", () => {
	const options = {
		builtinsDir: join(tmp, 'plan', 'builtins'),
		cache: join(tmp, 'cache'),
		repo: ROOT,
	};
	const fixture = publishedBuiltinsFor(
		{
			game: { local: { publishedBuiltins: '/x/published-builtins.json' } },
			snapshot: { id: 'local' },
		},
		options,
	);
	assert.deepEqual(fixture, {
		file: '/x/published-builtins.json',
		note: 'the built-ins the fixture was baked from',
	});
	const sha = resolveCommit('HEAD', ROOT);
	const short = sha.slice(0, 7);
	const engine = publishedBuiltinsFor(
		{ game: {}, snapshot: { id: 's1', engine: { version: '12', shortCommit: short } } },
		options,
	);
	assert.equal(engine.file, join(options.builtinsDir, `${sha}.json`));
	assert.match(engine.note, /^the built-ins of engine 12 \(/);
	assert.equal(canonical(JSON.parse(readFileSync(engine.file, 'utf8')).defs), canonical(base));
	const again = publishedBuiltinsFor(
		{ game: {}, snapshot: { id: 's2', engine: { version: '12', shortCommit: short } } },
		options,
	);
	assert.equal(again.file, engine.file, 'an engine is extracted once per plan');
	const none = publishedBuiltinsFor({ game: {}, snapshot: { id: 's3' } }, options);
	assert.equal(none.file, undefined);
	assert.match(none.note, /records no engine/);
	const unknown = publishedBuiltinsFor(
		{ game: {}, snapshot: { id: 's4', engine: { version: '3', shortCommit: 'deadbeef' } } },
		options,
	);
	assert.equal(unknown.file, undefined);
	assert.match(unknown.note, /deadbeef is not a commit in this checkout/);
});

await test('the same built-ins on both sides: nothing is affected, and the variants equal the snapshot', async () => {
	const bundle = snapshot();
	const made = await republish(bundle, base, clone(base));
	assert.equal(made.meta.affected, false);
	assert.deepEqual(made.meta.changed, []);
	assert.equal(canonical(made.head.componentDefs), canonical(bundle.componentDefs));
});

await test('a changed built-in the snapshot does not ship affects nothing', async () => {
	const head = clone(base);
	head.wheel.root.x += 1;
	const made = await republish(snapshot(), base, head);
	assert.equal(made.meta.affected, false);
	assert.equal('wheel' in made.head.componentDefs, false);
});

await test("a built-in that newly nests another def ships it, as the bake's closure does", async () => {
	const head = clone(base);
	head.freeSpinCounter.root.children.push(instance('tapToContinue', 9));
	const made = await republish(snapshot(), base, head);
	assert.deepEqual(made.meta.changed, ['freeSpinCounter', 'tapToContinue']);
	assert.ok(made.head.componentDefs.tapToContinue, 'the nested def ships on the branch side');
	assert.equal('tapToContinue' in made.base.componentDefs, false);
});

await test('a built-in the branch removed is dropped from the head variant', async () => {
	const head = clone(base);
	delete head.loadingBar;
	const made = await republish(snapshot(), base, head);
	assert.deepEqual(made.meta.changed, ['loadingBar']);
	assert.equal('loadingBar' in made.head.componentDefs, false);
	assert.ok(made.base.componentDefs.loadingBar);
});

await test('pinned versions: a copy of a built-in follows the side, an authored one is kept, a satisfied pin is dropped', async () => {
	const bundle = snapshot();
	// An authored pin at an older version, and a pinned copy of a built-in.
	const olderReadout = {
		...clone(base.hudReadout),
		name: 'Older',
		version: base.hudReadout.version - 1,
	};
	bundle.componentVersions = [olderReadout, clone(base.freeSpinCounter)];
	const head = headMoved();
	head.freeSpinCounter.version += 1;
	const made = await republish(bundle, base, head);
	assert.deepEqual(
		made.base.componentVersions,
		[olderReadout],
		'the base side keeps the authored pin and drops the satisfied one',
	);
	assert.deepEqual(made.head.componentVersions, [olderReadout]);
	assert.equal(made.meta.versionsChanged, false);
	assert.equal(made.meta.affected, true, 'the def itself changed');
});

await test('the CLI writes both variants and the classification', () => {
	const dir = join(tmp, 'cli');
	writeFileSync(join(tmp, 'bundle.json'), JSON.stringify(snapshot()));
	writeFileSync(join(tmp, 'head-builtins.json'), JSON.stringify({ version: 1, defs: headMoved() }));
	const meta = republishVariants({
		bundleFile: join(tmp, 'bundle.json'),
		baseBuiltinsFile: join(tmp, BUILTINS_FILE),
		headBuiltinsFile: join(tmp, 'head-builtins.json'),
		outDir: dir,
	});
	assert.deepEqual(meta.changed, ['freeSpinCounter']);
	assert.equal(meta.classifiedAgainst, 'main');
	assert.ok(existsSync(join(dir, 'base', 'runtime.json')));
	const head = JSON.parse(readFileSync(join(dir, 'head', 'runtime.json'), 'utf8'));
	assert.equal(
		head.componentDefs.freeSpinCounter.root.children[0].x,
		base.freeSpinCounter.root.children[0].x + 1,
	);
	const told = republishVariants({
		bundleFile: join(tmp, 'bundle.json'),
		baseBuiltinsFile: join(tmp, BUILTINS_FILE),
		headBuiltinsFile: join(tmp, 'head-builtins.json'),
		publishedBuiltinsFile: join(tmp, BUILTINS_FILE),
		outDir: join(tmp, 'cli-published'),
	});
	assert.equal(told.classifiedAgainst, 'published');
	assert.throws(
		() =>
			republishVariants({
				bundleFile: join(tmp, 'no-such-bundle.json'),
				baseBuiltinsFile: join(tmp, BUILTINS_FILE),
				headBuiltinsFile: join(tmp, 'head-builtins.json'),
				outDir: join(tmp, 'cli-fail'),
			}),
		/no-such-bundle|ENOENT/,
	);
});

await test('the plan renders only an affected game as republished, and a variant that cannot be made is an error', async () => {
	const game = (key, status = 'render') => ({
		game: { key, name: key, gameType: 'lines' },
		script: 'lines',
		status,
		snapshot: { id: 's1' },
		notes: [],
		scenarios:
			status === 'render'
				? [
						{ id: 'base', weight: 1 },
						{ id: 'line-win', weight: 2 },
					]
				: [],
	});
	const plan = {
		games: [game('affected'), game('same'), game('broken'), game('desktop', 'own-bundle')],
		units: [],
	};
	const metas = {
		affected: {
			affected: true,
			copies: ['freeSpinCounter'],
			authored: [],
			changed: ['freeSpinCounter'],
			classifiedAgainst: 'published',
		},
		same: { affected: false, copies: ['button'], authored: ['hudReadout'], changed: [] },
	};
	const publishedFiles = [];
	await planRepublished(plan, {
		bundleFor: async (entry) => `${entry.game.key}/runtime.json`,
		publishedBuiltinsFor: (entry) =>
			entry.game.key === 'affected'
				? {
						file: '/plan-out/builtins/abc.json',
						stored: 'builtins/abc.json',
						note: 'the built-ins of engine 7 (abc1234)',
					}
				: { note: "main's built-ins, since the pointer records no engine for this snapshot" },
		variantsFor: async (entry, bundleFile, published) => {
			publishedFiles.push(published);
			if (entry.game.key === 'broken') throw new Error('secret-free reason');
			return metas[entry.game.key];
		},
	});
	// The variants read the file where it is now; the entry records it as the shards will find it.
	assert.deepEqual(publishedFiles, ['/plan-out/builtins/abc.json', undefined, undefined]);
	assert.equal(plan.games[0].republished.publishedBuiltins, 'builtins/abc.json');
	assert.equal(plan.games[0].republished.classifiedAgainst, 'published');
	assert.match(plan.games[0].republished.note, /engine 7/);
	assert.equal(plan.games[1].republished.classifiedAgainst, 'main');
	assert.equal('publishedBuiltins' in plan.games[1].republished, false);
	assert.deepEqual(
		plan.units.map((u) => u.id).sort(),
		['base', 'head']
			.flatMap((side) =>
				['base', 'line-win'].map((sc) => unitId('affected', sc, side, 'republished')),
			)
			.sort(),
	);
	assert.ok(plan.units.every((u) => u.variant === 'republished' && u.id.endsWith('--republished')));
	assert.equal(plan.units.find((u) => u.scenario === 'line-win').weight, 2);
	assert.equal(plan.games[0].republished.status, 'planned');
	assert.equal(plan.games[1].republished.affected, false);
	assert.equal(plan.games[2].republished.status, 'error');
	assert.match(plan.games[2].republished.detail, /could not be made: secret-free reason/);
	assert.equal('republished' in plan.games[3], false, 'a game that is not rendered is not planned');
});

await test('the stand-in fixtures bake the given built-ins, like a publish', () => {
	const out = join(tmp, 'fixtures');
	const headFile = join(tmp, 'head-builtins.json');
	const r = spawnSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--no-warnings',
			'--import',
			'./scripts/ts-loader.mjs',
			'scripts/current-games/fixtures.mjs',
			'--out',
			out,
			'--builtins',
			headFile,
		],
		{ cwd: ROOT, encoding: 'utf8' },
	);
	assert.equal(r.status, 0, r.stderr);
	const lines = JSON.parse(
		readFileSync(join(out, 'snapshots', 'cg-lines', 'runtime.json'), 'utf8'),
	);
	assert.ok(lines.componentDefs.freeSpinCounter, 'the lines doc places the free-spin counter');
	assert.equal(
		lines.componentDefs.freeSpinCounter.root.children[0].x,
		base.freeSpinCounter.root.children[0].x + 1,
		'baked from the given built-ins',
	);
	assert.deepEqual(lines.componentDefaults, {});
	const { copies, authored } = classifyBaked(lines, headMoved());
	assert.equal(authored.length, 0, 'every baked def is a copy of the built-ins it was baked from');
	assert.ok(copies.includes('freeSpinCounter'));
	// The fixture records the built-ins it was baked from, as a live pointer records its engine.
	const games = JSON.parse(readFileSync(join(out, 'games.json'), 'utf8')).games;
	const game = games.find((g) => g.key === 'cg-lines');
	assert.equal(
		game.local.publishedBuiltins,
		join(out, 'snapshots', 'cg-lines', 'published-builtins.json'),
	);
	assert.equal(
		canonical(JSON.parse(readFileSync(game.local.publishedBuiltins, 'utf8')).defs),
		canonical(headMoved()),
	);
});

rmSync(tmp, { recursive: true, force: true });
if (failures) {
	console.error(`${failures} failure(s)`);
	process.exit(1);
}
console.log('current-games republish: all checks pass');
