// Invisible Timeline — a SCREEN timeline end to end (Rive plan Phase 3), headless.
//
//   node tools/rigger-spike/cinematic-screen-timeline.mjs
//
// The Phase 3 proof: a screen intro authored the way the Scene Editor's Animate mode authors it
// is saved, exported, baked, played by a Flow `playCinematic` node, and drawn in game exactly as
// the editor previewed it. Every step runs the REAL module:
//   1. authoring — the shared Timeline module (`apps/launcher-api/src/lib/timeline/timeline.js`,
//      headless) keys node actors made by `screenTimeline.ts` (`nodeActorTarget` refuses an unnamed
//      or shared name; `ensureNodeActor` binds by name);
//   2. storage — `cinematicStorage.ts` over an in-memory R2 that honours If-Match / If-None-Match;
//      the summary's `host`, and the `/flow-v2` picker labels (`cinematicPickerOptions`);
//   3. validation — `validateNodeActors` against the host screen;
//   4. ship — `cinematicExport.ts` (`loadAuthoredCinematics` → `exportCinematics` → `deploy/`), and
//      the runtime bundle's `cinematics` field as `runtimeBundle.ts` embeds it;
//   5. Flow — the real `engine-flow-v2` interpreter runs `playCinematic` (await) on that id;
//   6. game vs editor — the game's fold (`resolveNodeActors` → `sampleNodeActor` →
//      `withNodeActorOutputs` → `foldBoundTransform`, as `LayoutNodeView` runs it) against the
//      editor's preview seam (`valuePreview.client.svelte.ts`, compiled with Svelte's own compiler)
//      fed by `timelineDrives` — equal at every sampled time;
//   7. parity — no preview ⇒ the editor draws the authored transform; a rig cinematic drives no node.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ESBUILD } from './esbuild.mjs';
import { resolveFromPackage } from './resolve.mjs';

const ROOT = new URL('../../', import.meta.url);
const at = (p) => fileURLToPath(new URL(p, ROOT));
const LAUNCHER_LIB = at('apps/launcher-api/src/lib');
const LAYOUT_LIB = at('packages/engine-layout/src/lib/');
const esbuild = await import(ESBUILD);
const svelte = await import(
	pathToFileURL(
		join(resolveFromPackage('svelte', 'engine-layout').pkgDir, 'src/compiler/index.js'),
	).href
);

const dir = mkdtempSync(join(tmpdir(), 'cine-screen-'));
// engine-layout's root index pulls the whole engine; the pieces under test are pure files.
const layoutShim = join(dir, 'engine-layout.ts');
writeFileSync(
	layoutShim,
	[
		'cinematicNodes',
		'componentInterface',
		'fxNodeParams',
		'valueBindings',
		'resolveTransform',
		'soundLibrary',
		'componentEvents',
	]
		.map((f) => `export * from ${JSON.stringify(join(LAYOUT_LIB, `${f}.ts`))};`)
		.join('\n'),
);
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export * from ${JSON.stringify(join(LAUNCHER_LIB, 'timeline/screenTimeline.ts'))};
export { mount } from ${JSON.stringify(join(LAUNCHER_LIB, 'timeline/timeline.js'))};
export * as preview from ${JSON.stringify(at('apps/launcher-api/src/routes/(app)/editor/valuePreview.client.svelte.ts'))};
export * as storage from ${JSON.stringify(join(LAUNCHER_LIB, 'server/cinematicStorage.ts'))};
export * as exporter from ${JSON.stringify(join(LAUNCHER_LIB, 'server/cinematicExport.ts'))};
export * as layout from ${JSON.stringify(layoutShim)};
export * as ev from ${JSON.stringify(at('packages/engine-cinematic/index.ts'))};`,
);

// The R2 boundary: an in-memory bucket on `globalThis`, honouring the conditional-write contract.
const stubR2 = {
	name: 'stub-r2',
	setup(build) {
		build.onResolve({ filter: /^\.\/r2$/ }, () => ({ path: 'stub-r2', namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
			loader: 'js',
			contents: `
				const B = (globalThis.__bucket ??= new Map());
				let n = 0;
				export class ConflictError extends Error {}
				export const precondition = (e) => e === undefined ? undefined : e === null ? { ifNoneMatch: '*' } : { ifMatch: e };
				export async function getObjectTextWithEtag(key) { return B.get(key) ?? null; }
				export async function getObjectText(key) { return B.get(key)?.text ?? null; }
				export async function putObjectText(key, text, _t, cond) {
					const cur = B.get(key);
					if (cond?.ifNoneMatch === '*' && cur) throw new ConflictError(key);
					if (cond?.ifMatch !== undefined && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
					const etag = '"e' + ++n + '"';
					B.set(key, { text, etag });
					return etag;
				}
				export async function listAllObjects(prefix) {
					return [...B.keys()].filter((k) => k.startsWith(prefix)).map((key, i) => ({ key, size: 0, lastModified: i }));
				}
				export async function deleteObject(key) { B.delete(key); }
				export async function deleteObjects(keys) { for (const k of keys) B.delete(k); }
			`,
		}));
	},
};
// The editor's preview module is a rune module (`$state`): compile it the way SvelteKit does.
const svelteModules = {
	name: 'svelte-modules',
	setup(build) {
		build.onLoad({ filter: /\.svelte\.ts$/ }, async (args) => {
			const ts = await esbuild.transform(readFileSync(args.path, 'utf8'), { loader: 'ts' });
			const { js } = svelte.compileModule(ts.code, { filename: args.path, generate: 'client' });
			return { contents: js.code, loader: 'js', resolveDir: dirname(args.path) };
		});
	},
};
const out = join(dir, 'bundle.mjs');
await esbuild.build({
	entryPoints: [entry],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	plugins: [stubR2, svelteModules],
	alias: { $lib: LAUNCHER_LIB, 'engine-layout': layoutShim },
	logLevel: 'silent',
});
// The Timeline listens for keys on `window` even headless; Node has none.
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const M = await import(pathToFileURL(out).href);

const flowOut = join(dir, 'flow.mjs');
await esbuild.build({
	entryPoints: [at('packages/engine-flow-v2/index.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: flowOut,
	logLevel: 'silent',
});
const FLOW = await import(pathToFileURL(flowOut).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
	}
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---- the host screen --------------------------------------------------------------------------

const sprite = (id, label, x, y) => ({
	id,
	kind: 'sprite',
	label,
	assetKey: 'atlas',
	region: 'logo',
	x,
	y,
	scale: { x: 1, y: 1 },
	rotation: 0,
	alpha: 1,
});
const SCENE = {
	id: 'base',
	name: 'Base game',
	space: 'game',
	nodes: [
		sprite('n_logo', 'Logo', 100, 50),
		{ id: 'n_box', kind: 'rect', x: 0, y: 0, width: 10, height: 10, fill: 0 },
		sprite('n_coin1', 'Coin', 10, 10),
		{
			id: 'n_group',
			kind: 'container',
			label: 'Group',
			x: 0,
			y: 0,
			children: [sprite('n_coin2', 'Coin', 20, 20)],
		},
	],
};

const EV = { resolvePlace: M.ev.resolvePlace, resolveVisible: M.ev.resolveVisible, putKey: M.ev.putKey };
const CLIENT = 'acme';
const PROJECT = 'borut';

// =================================================================================================
console.log('\n1. authoring — Animate mode keys a node actor by NAME');
const doc = M.newScreenTimeline({
	id: M.screenTimelineId('base', 'Intro', []),
	name: 'Intro',
	sceneId: 'base',
});
{
	ok('the id is already storage-safe', doc.id === 'base_intro', doc.id);
	ok('a new timeline is hosted by its screen', JSON.stringify(doc.host) === '{"kind":"screen","sceneId":"base"}');
	ok('a taken id gets a suffix', M.screenTimelineId('base', 'Intro', ['base_intro']) === 'base_intro_2');

	const logo = M.nodeActorTarget(SCENE, 'n_logo');
	ok('a uniquely named node is a target, by its name', logo.ok && logo.target === 'Logo', logo);
	const unnamed = M.nodeActorTarget(SCENE, 'n_box');
	ok('an unnamed node is refused with a prompt to name it', !unnamed.ok && unnamed.reason === 'unnamed', unnamed);
	const dup = M.nodeActorTarget(SCENE, 'n_coin2');
	ok('a shared name is refused — never a silent id or the wrong node', !dup.ok && dup.reason === 'duplicate', dup);
	ok('tint is offered on a sprite, not on a rect', M.keyableChannels('sprite').includes('tint') && !M.keyableChannels('rect').includes('tint'));

	const tl = M.mount(null, { doc, ev: EV, channels: M.SCREEN_CHANNELS });
	tl.historyReset();
	const actor = M.ensureNodeActor(tl.doc(), logo.target);
	ok('ensureNodeActor makes ONE node actor targeting the name', M.ensureNodeActor(tl.doc(), 'Logo') === actor && tl.doc().stage.cast.length === 1);
	tl.setTime(0);
	tl.keyProperty(actor, 'y', -200);
	tl.keyProperty(actor, 'alpha', 0);
	tl.keyProperty(actor, 'scale', 0.5);
	tl.keyProperty(actor, 'tint', 0xff0000);
	tl.setTime(1);
	tl.keyProperty(actor, 'y', 0);
	tl.keyProperty(actor, 'alpha', 1);
	tl.keyProperty(actor, 'scale', 1);
	tl.keyProperty(actor, 'tint', 0xffffff);
	ok('keys land at the playhead (two per channel)', ['y', 'alpha', 'scale', 'tint'].every((c) => tl.propertyTracksOf(actor)[0].channels[c].length === 2));
	ok('the fields read the value at the playhead', M.nodeChannelValue(tl.doc(), actor, 'y', 0.5) === -100);
	ok('an unkeyed channel reads the identity', M.nodeChannelValue(tl.doc(), actor, 'x', 0.5) === 0 && M.nodeChannelValue(tl.doc(), actor, 'rotation', 0) === 0);
	ok('isChannelKeyed tells keyed from not', M.isChannelKeyed(tl.doc(), actor, 'y') && !M.isChannelKeyed(tl.doc(), actor, 'x'));
	ok('each key is one undo step', tl.historyDepth().size === 9, tl.historyDepth());
	tl.destroy();
}

// =================================================================================================
console.log('\n2. storage — the cinematic store, unchanged');
const rigCinematic = {
	schemaVersion: 1,
	id: 'bonus',
	name: 'Bonus',
	duration: 2,
	fps: 30,
	stage: { sceneId: null, cast: [{ actorId: 'a1', rigFolder: 'hero', place: { x: 0, y: 0 } }] },
	tracks: [],
	markers: [],
};
{
	ok('the authored doc is a valid cinematic doc', M.storage.isCinematicDoc(doc));
	const { etag } = await M.storage.saveCinematic(CLIENT, PROJECT, doc, null);
	ok('created under <client>/<project>/cinematics/', globalThis.__bucket.has('acme/borut/cinematics/base_intro.json'));
	let conflict = false;
	try {
		await M.storage.saveCinematic(CLIENT, PROJECT, doc, null);
	} catch (e) {
		conflict = e instanceof Error;
	}
	ok('a second create is refused (If-None-Match)', conflict);
	await M.storage.saveCinematic(CLIENT, PROJECT, doc, etag);
	await M.storage.saveCinematic(CLIENT, PROJECT, rigCinematic, null);
	const loaded = await M.storage.loadCinematic(CLIENT, PROJECT, doc.id);
	ok('loads back byte-identical', JSON.stringify(loaded.doc) === JSON.stringify(doc));
	const rows = await M.storage.listCinematics(CLIENT, PROJECT);
	ok('the listing carries each host', rows.find((r) => r.id === 'base_intro')?.host?.kind === 'screen' && rows.find((r) => r.id === 'bonus')?.host === undefined);
	ok('screenTimelinesOf keeps only that screen', JSON.stringify(M.screenTimelinesOf(rows, 'base').map((r) => r.id)) === '["base_intro"]' && M.screenTimelinesOf(rows, 'other').length === 0);
	const options = M.cinematicPickerOptions(rows, { base: 'Base game' });
	ok(
		'/flow-v2 picker lists the screen timeline first, labelled by its screen',
		JSON.stringify(options) ===
			JSON.stringify([
				{ id: 'base_intro', label: 'Timeline · Base game · Intro' },
				{ id: 'bonus', label: 'Cinematic · Bonus' },
			]),
		options,
	);
	const orphan = M.cinematicPickerOptions([{ id: 'x', name: 'Gone', host: { kind: 'screen', sceneId: 'deleted' } }], {});
	ok('a timeline whose screen is gone stays listed, showing the screen id', orphan[0].label === 'Timeline · deleted · Gone', orphan);
}

// =================================================================================================
console.log('\n3. validation — what would silently do nothing');
{
	ok('the authored intro validates clean on its screen', M.layout.validateNodeActors(doc, SCENE).length === 0, M.layout.validateNodeActors(doc, SCENE));
	const broken = structuredClone(doc);
	broken.stage.cast[0].target = 'Gone';
	const issues = M.layout.validateNodeActors(broken, SCENE);
	ok('a target no node carries is node-missing', issues.length === 1 && issues[0].code === 'node-missing', issues);
}

// =================================================================================================
console.log('\n4. ship — export → deploy/ → bake');
let bundle;
{
	const docs = await M.exporter.loadAuthoredCinematics(CLIENT, PROJECT);
	ok('the screen timeline is an authored cinematic', docs.some((d) => d.id === 'base_intro'));
	ok('it seeds no rig into the art export (node actors carry no rigFolder)', !M.exporter.cinematicRigNames(docs.filter((d) => d.id === 'base_intro')).size);
	const index = await M.exporter.exportCinematics(CLIENT, PROJECT, docs);
	const deployed = globalThis.__bucket.get('acme/borut/deploy/cinematics/base_intro.json');
	ok('exported to deploy/cinematics/', !!deployed && JSON.parse(deployed.text).host.sceneId === 'base');
	// `runtimeBundle.ts` embeds the export index's list as the bundle's `cinematics`.
	bundle = JSON.parse(JSON.stringify({ ...(index.cinematics?.length ? { cinematics: index.cinematics } : {}) }));
	ok('the bundle carries it', bundle.cinematics.some((d) => d.id === 'base_intro'));
}

// =================================================================================================
console.log('\n5. Flow — playCinematic plays it, and waits for it');
{
	const VOCAB = { id: 'test', events: [{ name: 'go', payload: [] }], actions: [], cues: [], structs: [], enums: [], collections: [], containers: [], engine: [] };
	const LIBRARY = { functions: [] };
	const flowDoc = {
		version: 2,
		templateId: 'test',
		graph: {
			nodes: [
				{ id: 'ev', kind: 'event', ref: 'go', pos: { x: 0, y: 0 } },
				{ id: 'cine', kind: 'playCinematic', ref: 'base_intro', awaitComplete: true, pos: { x: 1, y: 0 } },
				{ id: 'after', kind: 'fireCue', ref: 'afterIntro', pos: { x: 2, y: 0 } },
			],
			exec: [
				{ from: { node: 'ev', pin: 'exec' }, to: { node: 'cine', pin: 'play' } },
				{ from: { node: 'cine', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
			],
			data: [],
		},
		containers: [],
	};
	const errors = FLOW.validateFlowDoc(flowDoc, VOCAB, LIBRARY).filter((i) => i.severity === 'error' && i.nodeId === 'cine');
	ok('the playCinematic node validates', errors.length === 0, errors);
	const log = [];
	let settle;
	const env = {
		broadcast: (name) => log.push(`cue:${name}`),
		fireCue: (name) => log.push(`cue:${name}`),
		runAction: () => {},
		showContainer: async () => {},
		hideContainer: async () => {},
		waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)),
		timeScale: () => 1,
		engineRead: () => undefined,
		playCinematic: (id) => {
			// FlowV2Cinematics: the baked doc by id, its set through `cinematicSetSceneId`.
			const played = bundle.cinematics.find((c) => c.id === id);
			log.push(`play:${id}:${played ? M.layout.cinematicSetSceneId(played) : 'missing'}`);
			return new Promise((resolve) => (settle = resolve));
		},
		stopCinematic: () => {},
	};
	const run = FLOW.runFlowEvent(flowDoc, { vocab: VOCAB, library: LIBRARY, env }, 'go', {});
	await new Promise((r) => setTimeout(r, 5));
	ok('the interpreter plays the baked timeline on its host screen', log[0] === 'play:base_intro:base', log);
	ok('awaitComplete holds the chain while it plays', !log.includes('cue:afterIntro'), log);
	settle();
	await run;
	ok('completion releases the chain', log.at(-1) === 'cue:afterIntro', log);
}

// =================================================================================================
console.log('\n6. game == editor — the same pose at every time');
{
	const played = bundle.cinematics.find((c) => c.id === 'base_intro');
	const drives = M.layout.resolveNodeActors(played, SCENE);
	ok('the game binds the actor to the Logo node', drives.size === 1 && drives.has('n_logo'));
	const logo = SCENE.nodes[0];
	const layoutType = 'desktop';
	/** `LayoutNodeView`'s fold, verbatim in shape: own bindings + the timeline's, then tint. */
	const gameTransform = (t) => {
		const actor = drives.get(logo.id);
		const bindings = M.layout.nodeActorBindings(M.layout.keyedNodeChannels(actor.tracks));
		const sample = M.ev.sampleNodeActor(actor.tracks, t);
		const all = [...(logo.valueBindings ?? []), ...bindings];
		const outputs = M.layout.withNodeActorOutputs(logo.valueBindings, [], bindings, sample);
		const folded = M.layout.foldBoundTransform(M.layout.resolveTransform(logo, layoutType), all, outputs);
		return sample.tint === undefined ? folded : { ...folded, tint: sample.tint };
	};
	let same = true;
	const mismatches = [];
	for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
		M.preview.setTimelinePreview(M.timelineDrives(played, SCENE, t));
		const editor = M.preview.previewResolveTransform(logo, layoutType);
		const game = gameTransform(t);
		if (JSON.stringify(editor) !== JSON.stringify(game)) {
			same = false;
			mismatches.push({ t, editor, game });
		}
	}
	ok('the editor preview equals the game transform at t = 0 … 1', same, mismatches);
	M.preview.setTimelinePreview(M.timelineDrives(played, SCENE, 0));
	const start = M.preview.previewResolveTransform(logo, layoutType);
	ok('t=0: lifted 200, scaled 0.5, transparent, red', near(start.y, -150) && near(start.scale.x, 0.5) && near(start.alpha, 0) && start.tint === 0xff0000, start);
	M.preview.setTimelinePreview(M.timelineDrives(played, SCENE, 1));
	const end = M.preview.previewResolveTransform(logo, layoutType);
	ok('t=end: settles on the authored pose', near(end.y, 50) && near(end.x, 100) && near(end.scale.x, 1) && near(end.alpha, 1) && end.tint === 0xffffff, end);
	ok('previewTint follows the timeline', M.preview.previewTint(logo) === 0xffffff);
	ok('previewBindings appends the timeline bindings', M.preview.previewBindings(logo).length === 4);
}

// =================================================================================================
console.log('\n7. parity — nothing previewed, nothing changed');
{
	const logo = SCENE.nodes[0];
	M.preview.setTimelinePreview(null);
	const plain = M.preview.previewResolveTransform(logo, 'desktop');
	ok('no timeline ⇒ the editor draws the authored transform', JSON.stringify(plain) === JSON.stringify(M.layout.resolveTransform(logo, 'desktop')));
	ok('no timeline ⇒ no preview outputs, bindings or tint', M.preview.previewOutputs(logo).length === 0 && M.preview.previewBindings(logo) === undefined && M.preview.previewTint(logo) === undefined);
	ok('a rig cinematic drives no node', M.timelineDrives(rigCinematic, SCENE, 0).size === 0);
	const otherScreen = { ...doc, host: { kind: 'screen', sceneId: 'other' } };
	ok('a timeline of another screen drives nothing here', M.timelineDrives(otherScreen, SCENE, 0).size === 0);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
