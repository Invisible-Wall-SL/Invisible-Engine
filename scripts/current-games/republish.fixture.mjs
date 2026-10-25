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
	const made = await republish(bundle, base, headMoved(), base);
	assert.deepEqual(made.meta, {
		copies: ['freeSpinCounter', 'loadingBar'],
		authored: ['hudReadout'],
		merged: [],
		changed: ['freeSpinCounter'],
		versionsChanged: false,
		affected: true,
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
	// branch's change is missed — why the plan fails closed without the published engine's); against
	// the published engine's it is the copy it is.
	const published = clone(base);
	published.freeSpinCounter.root.children[0].width -= 10;
	const bundle = snapshot();
	bundle.componentDefs.freeSpinCounter = clone(published.freeSpinCounter);
	const missed = await republish(bundle, base, headMoved(), base);
	assert.equal(missed.meta.affected, false, "main's built-ins miss the stale copy");
	assert.deepEqual(missed.meta.authored, ['freeSpinCounter', 'hudReadout']);
	const told = await republish(bundle, base, headMoved(), published);
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

await test("an authored def under a built-in's id takes the side's new coded params, as the bake's merge does", async () => {
	// The author edited the counter (so it is kept), and the branch adds a coded param to the built-in
	// and binds the frame's x to it. A republish loads the edited def through
	// `mergeBuiltinCodedParams`, so the branch's publish bakes the new param and binding into it.
	const bundle = snapshot();
	bundle.componentDefs.freeSpinCounter = { ...clone(base.freeSpinCounter), name: 'My Counter' };
	// A purely authored component (no built-in twin) rides along untouched.
	const custom = {
		id: 'c_custom',
		name: 'Custom',
		version: 1,
		params: [],
		root: { id: 'c_custom-root', kind: 'container', x: 0, y: 0, children: [] },
	};
	bundle.componentDefs.c_custom = custom;
	bundle.doc.scenes[0].nodes.push(instance('c_custom', 1));
	const head = clone(base);
	head.freeSpinCounter.params.push({ key: 'frameShift', kind: 'number', label: 'Frame shift' });
	head.freeSpinCounter.root.children[0].paramBindings = {
		...head.freeSpinCounter.root.children[0].paramBindings,
		x: 'frameShift',
	};
	const made = await republish(bundle, base, head, base);
	assert.deepEqual(made.meta.authored, ['freeSpinCounter', 'hudReadout', 'c_custom']);
	assert.deepEqual(made.meta.merged, ['freeSpinCounter']);
	assert.deepEqual(made.meta.changed, ['freeSpinCounter']);
	assert.equal(made.meta.affected, true, 'the republished row is planned');
	const baked = made.head.componentDefs.freeSpinCounter;
	assert.equal(baked.name, 'My Counter', "the author's content is kept");
	assert.equal(baked.params.at(-1).key, 'frameShift', 'the new coded param is appended');
	assert.equal(baked.root.children[0].paramBindings.x, 'frameShift', 'and its binding merged in');
	assert.equal(
		baked.root.children[0].paramBindings.region,
		'frameImage',
		"the author's bindings win",
	);
	assert.equal(
		canonical(made.base.componentDefs.freeSpinCounter),
		canonical(bundle.componentDefs.freeSpinCounter),
		"main's built-in adds nothing the published engine's did not: unchanged on the base side",
	);
	assert.deepEqual(made.head.componentDefs.c_custom, custom);
	// Through the CLI, as the plan makes it: the same verdict in `republish.json`.
	writeFileSync(join(tmp, 'merge-bundle.json'), JSON.stringify(bundle));
	writeFileSync(join(tmp, 'merge-head.json'), JSON.stringify({ version: 1, defs: head }));
	const meta = republishVariants({
		bundleFile: join(tmp, 'merge-bundle.json'),
		baseBuiltinsFile: join(tmp, BUILTINS_FILE),
		headBuiltinsFile: join(tmp, 'merge-head.json'),
		publishedBuiltinsFile: join(tmp, BUILTINS_FILE),
		outDir: join(tmp, 'merge-out'),
	});
	assert.equal(meta.affected, true);
	assert.deepEqual(meta.merged, ['freeSpinCounter']);
	const headVariant = JSON.parse(
		readFileSync(join(tmp, 'merge-out', 'head', 'runtime.json'), 'utf8'),
	);
	assert.equal(headVariant.componentDefs.freeSpinCounter.params.at(-1).key, 'frameShift');
});

await test("the published engine's built-ins are required: nothing stands in for them", async () => {
	await assert.rejects(() => republish(snapshot(), base, headMoved()), /required/);
	assert.throws(
		() =>
			republishVariants({
				bundleFile: join(tmp, 'bundle.json'),
				baseBuiltinsFile: join(tmp, BUILTINS_FILE),
				headBuiltinsFile: join(tmp, BUILTINS_FILE),
				outDir: join(tmp, 'no-published'),
			}),
		/required/,
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

await test("which built-ins tell a game's copies: the fixture's own, the published engine's, else unknown", () => {
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
	assert.match(none.unknown, /records no engine/);
	const unknown = publishedBuiltinsFor(
		{ game: {}, snapshot: { id: 's4', engine: { version: '3', shortCommit: 'deadbeef' } } },
		options,
	);
	assert.equal(unknown.file, undefined);
	assert.match(unknown.unknown, /deadbeef is not a commit in this checkout/);
});

await test('the same built-ins on both sides: nothing is affected, and the variants equal the snapshot', async () => {
	const bundle = snapshot();
	const made = await republish(bundle, base, clone(base), base);
	assert.equal(made.meta.affected, false);
	assert.deepEqual(made.meta.changed, []);
	assert.equal(canonical(made.head.componentDefs), canonical(bundle.componentDefs));
});

await test('a changed built-in the snapshot does not ship affects nothing', async () => {
	const head = clone(base);
	head.wheel.root.x += 1;
	const made = await republish(snapshot(), base, head, base);
	assert.equal(made.meta.affected, false);
	assert.equal('wheel' in made.head.componentDefs, false);
});

await test("a built-in that newly nests another def ships it, as the bake's closure does", async () => {
	const head = clone(base);
	head.freeSpinCounter.root.children.push(instance('tapToContinue', 9));
	const made = await republish(snapshot(), base, head, base);
	assert.deepEqual(made.meta.changed, ['freeSpinCounter', 'tapToContinue']);
	assert.ok(made.head.componentDefs.tapToContinue, 'the nested def ships on the branch side');
	assert.equal('tapToContinue' in made.base.componentDefs, false);
});

await test('a built-in the branch removed is dropped from the head variant', async () => {
	const head = clone(base);
	delete head.loadingBar;
	const made = await republish(snapshot(), base, head, base);
	assert.deepEqual(made.meta.changed, ['loadingBar']);
	assert.equal('loadingBar' in made.head.componentDefs, false);
	assert.ok(made.base.componentDefs.loadingBar);
});

await test("pins ship as the bake's `resolveReferencedDefs` does: a satisfied pin nothing, another the exact def", async () => {
	const bundle = snapshot();
	const [counter, readout] = bundle.doc.scenes[0].nodes;
	// The readout is pinned at an older version the author shipped; the counter at the published
	// built-in's version, which the snapshot also shipped as a pinned copy.
	const olderReadout = {
		...clone(base.hudReadout),
		name: 'Older',
		version: base.hudReadout.version - 1,
	};
	readout.componentVersion = olderReadout.version;
	counter.componentVersion = base.freeSpinCounter.version;
	bundle.componentVersions = [olderReadout, clone(base.freeSpinCounter)];
	const head = headMoved();
	head.freeSpinCounter.version += 1;
	const made = await republish(bundle, base, head, base);
	assert.deepEqual(
		made.base.componentVersions,
		[olderReadout],
		"main's counter is at the pinned version, so the pin ships nothing; the authored pin ships",
	);
	assert.deepEqual(
		made.head.componentVersions,
		[head.freeSpinCounter, olderReadout],
		"the branch's counter is not at the pinned version, so the pin ships the built-in, at any version (pins in doc order)",
	);
	assert.equal(made.meta.versionsChanged, true);
	assert.equal(made.meta.affected, true);
	// A snapshot's shipped versions the doc no longer pins are not re-shipped, as the bake would not.
	const unpinned = snapshot();
	unpinned.componentVersions = [olderReadout];
	const dropped = await republish(unpinned, base, clone(base), base);
	assert.equal('componentVersions' in dropped.head, false);
});

await test('the CLI writes both variants and the classification', () => {
	const dir = join(tmp, 'cli');
	writeFileSync(join(tmp, 'bundle.json'), JSON.stringify(snapshot()));
	writeFileSync(join(tmp, 'head-builtins.json'), JSON.stringify({ version: 1, defs: headMoved() }));
	const meta = republishVariants({
		bundleFile: join(tmp, 'bundle.json'),
		baseBuiltinsFile: join(tmp, BUILTINS_FILE),
		headBuiltinsFile: join(tmp, 'head-builtins.json'),
		publishedBuiltinsFile: join(tmp, BUILTINS_FILE),
		outDir: dir,
	});
	assert.deepEqual(meta.changed, ['freeSpinCounter']);
	assert.deepEqual(meta.merged, []);
	assert.ok(existsSync(join(dir, 'base', 'runtime.json')));
	const head = JSON.parse(readFileSync(join(dir, 'head', 'runtime.json'), 'utf8'));
	assert.equal(
		head.componentDefs.freeSpinCounter.root.children[0].x,
		base.freeSpinCounter.root.children[0].x + 1,
	);
	assert.throws(
		() =>
			republishVariants({
				bundleFile: join(tmp, 'no-such-bundle.json'),
				baseBuiltinsFile: join(tmp, BUILTINS_FILE),
				headBuiltinsFile: join(tmp, 'head-builtins.json'),
				publishedBuiltinsFile: join(tmp, BUILTINS_FILE),
				outDir: join(tmp, 'cli-fail'),
			}),
		/no-such-bundle|ENOENT/,
	);
});

await test('the plan renders only an affected game as republished; a variant that cannot be made, or an unknown engine, is an error', async () => {
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
		games: [
			game('affected'),
			game('same'),
			game('broken'),
			game('unknown'),
			game('desktop', 'own-bundle'),
		],
		units: [],
	};
	const metas = {
		affected: {
			affected: true,
			copies: ['freeSpinCounter'],
			authored: [],
			merged: [],
			changed: ['freeSpinCounter'],
		},
		same: { affected: false, copies: ['button'], authored: ['hudReadout'], changed: [] },
	};
	const publishedFiles = [];
	const variantsFor = [];
	await planRepublished(plan, {
		bundleFor: async (entry) => `${entry.game.key}/runtime.json`,
		publishedBuiltinsFor: (entry) =>
			entry.game.key === 'unknown'
				? { unknown: 'the pointer records no engine for this snapshot' }
				: {
						file: '/plan-out/builtins/abc.json',
						stored: 'builtins/abc.json',
						note: 'the built-ins of engine 7 (abc1234)',
					},
		variantsFor: async (entry, bundleFile, published) => {
			variantsFor.push(entry.game.key);
			publishedFiles.push(published);
			if (entry.game.key === 'broken') throw new Error('secret-free reason');
			return metas[entry.game.key];
		},
	});
	// The variants read the file where it is now; the entry records it as the shards will find it.
	assert.deepEqual(
		variantsFor,
		['affected', 'same', 'broken'],
		'no variant is made for an unknown engine',
	);
	assert.ok(publishedFiles.every((f) => f === '/plan-out/builtins/abc.json'));
	assert.equal(plan.games[0].republished.publishedBuiltins, 'builtins/abc.json');
	assert.match(plan.games[0].republished.note, /engine 7/);
	assert.deepEqual(plan.games[1].republished.merged, [], 'a meta without `merged` reads as none');
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
	assert.equal(plan.games[3].republished.status, 'error', 'an unknown engine fails closed');
	assert.match(
		plan.games[3].republished.detail,
		/engine this game was published with is unknown \(the pointer records no engine for this snapshot\).*failing closed/,
	);
	assert.equal('republished' in plan.games[4], false, 'a game that is not rendered is not planned');
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
