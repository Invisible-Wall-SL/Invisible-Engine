// Invisible Cinematic — the Flow-v2 `playCinematic` node, headless.
//
//   node tools/rigger-spike/cinematic-flow.mjs
//
// Bundles the REAL `engine-flow-v2` runtime + validator with esbuild and drives a graph through
// them with a recording env. The thing under test is not "does it call play" — it is the
// AWAIT/LOOP semantics, because the failure mode there is a round that hangs forever with no
// error, which is the single worst outcome a flow node can have (the repo has the
// `showContainer{awaitComplete}`-with-no-release trap on record already).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const ESBUILD = new URL('node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild/lib/main.js', ROOT).href;
const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'cine-flow-')), 'bundle.mjs');
await esbuild.build({
	entryPoints: [fileURLToPath(new URL('packages/engine-flow-v2/index.ts', ROOT))],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	logLevel: 'silent',
});
const FLOW = await import(pathToFileURL(out).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ---- harness --------------------------------------------------------------

const VOCAB = {
	id: 'test', events: [{ name: 'go', payload: [] }], actions: [], cues: [],
	structs: [], enums: [], collections: [], containers: [], engine: [],
};
const LIBRARY = { functions: [] };

/** A graph: `go` event → playCinematic(node opts) → a marker action we can watch for. */
function graphWith(nodeOpts) {
	return {
		version: 2,
		templateId: 'test',
		graph: {
			nodes: [
				{ id: 'ev', kind: 'event', ref: 'go', pos: { x: 0, y: 0 } },
				{ id: 'cine', kind: 'playCinematic', pos: { x: 1, y: 0 }, ...nodeOpts },
				{ id: 'after', kind: 'fireCue', ref: 'afterCue', pos: { x: 2, y: 0 } },
			],
			exec: [
				{ from: { node: 'ev', pin: 'exec' }, to: { node: 'cine', pin: 'play' } },
				{ from: { node: 'cine', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
			],
			data: [],
		},
		// The validator walks the doc's declared containers; an authored doc always has the key.
		containers: [],
	};
}

/** A recording env whose `playCinematic` promise WE control, so "did the chain wait?" is observable. */
function makeEnv() {
	const log = [];
	let settle = null;
	const env = {
		log,
		settlePlay: () => settle?.(),
		// `fireCue` nodes go through `env.broadcast` — that is the marker we watch for.
		broadcast: (name) => { log.push(`cue:${name}`); },
		fireCue: (name) => { log.push(`cue:${name}`); },
		runAction: () => {},
		showContainer: async () => {},
		hideContainer: async () => {},
		waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)),
		timeScale: () => 1,
		engineRead: () => undefined,
		playCinematic: (id, opts) => {
			log.push(`play:${id}:${opts.loop ? 'loop' : 'once'}:${opts.speed ?? 1}`);
			if (opts.loop) return; // a looping cinematic never completes — nothing to await
			return new Promise((resolve) => { settle = () => { log.push('completed'); resolve(); }; });
		},
		stopCinematic: (id) => { log.push(`stop:${id}`); },
	};
	return env;
}

const run = (doc, env) =>
	FLOW.runFlowEvent(doc, { vocab: VOCAB, library: LIBRARY, env }, 'go', {});

const settled = (p) => {
	let done = false;
	p.then(() => { done = true; });
	return { get done() { return done; } };
};
const flush = () => new Promise((r) => setTimeout(r, 5));

// =========================================================================
console.log('\n1. play — the basics');
{
	const env = makeEnv();
	const p = run(graphWith({ ref: 'intro', speed: 2 }), env);
	await flush();
	ok('the node plays the cinematic it names, with its speed', env.log[0] === 'play:intro:once:2', env.log.join(' | '));
	env.settlePlay();
	await p;
	ok('the chain continues past it', env.log.includes('cue:afterCue'), env.log.join(' | '));
}

// =========================================================================
console.log('\n2. awaitComplete — the hold');
{
	const env = makeEnv();
	const state = settled(run(graphWith({ ref: 'intro', awaitComplete: true }), env));
	await flush();
	ok('with awaitComplete the chain does NOT continue yet', !env.log.includes('cue:afterCue'), env.log.join(' | '));
	ok('...and the run is still pending', !state.done);
	env.settlePlay();
	await flush();
	ok('completing the cinematic releases the chain', env.log.includes('cue:afterCue'), env.log.join(' | '));
	ok('...in order: play → completed → cue', env.log.join('>') === 'play:intro:once:1>completed>cue:afterCue', env.log.join(' | '));
}

{
	const env = makeEnv();
	const state = settled(run(graphWith({ ref: 'intro', awaitComplete: false }), env));
	await flush();
	ok('WITHOUT awaitComplete the chain continues immediately', env.log.includes('cue:afterCue'), env.log.join(' | '));
	ok('...and the run finishes without the cinematic ending', state.done);
}

// =========================================================================
console.log('\n3. loop + awaitComplete — the deadlock, refused at BOTH layers');
{
	// The runtime must not hang even if a doc carries the invalid combination (hand-edited, or
	// written by an older editor) — refusing to deadlock is more important than honouring the flag.
	const env = makeEnv();
	const state = settled(run(graphWith({ ref: 'idle', loop: true, awaitComplete: true }), env));
	await flush();
	ok('a LOOPING cinematic never hangs the chain, even with awaitComplete set',
		env.log.includes('cue:afterCue'), env.log.join(' | '));
	ok('...and the run completes', state.done);

	// And the validator refuses it at authoring time, as an ERROR (not a warning).
	const issues = FLOW.validateFlowDoc(graphWith({ ref: 'idle', loop: true, awaitComplete: true }), VOCAB, LIBRARY);
	const issue = issues.find((i) => i.code === 'cinematic-await-loop');
	ok('the validator flags loop+await', !!issue, issues.map((i) => i.code).join(',') || 'no issues');
	ok('...as an ERROR, because it would hang a live round', issue?.severity === 'error', issue?.severity);
}

// =========================================================================
console.log('\n4. stop, and the authoring guards');
{
	const env = makeEnv();
	const doc = graphWith({ ref: 'idle', loop: true });
	doc.graph.exec[0] = { from: { node: 'ev', pin: 'exec' }, to: { node: 'cine', pin: 'stop' } };
	await run(doc, env);
	ok('the stop inlet stops it', env.log.includes('stop:idle'), env.log.join(' | '));
	ok('...and still continues the chain', env.log.includes('cue:afterCue'), env.log.join(' | '));

	const issues = FLOW.validateFlowDoc(graphWith({ ref: '' }), VOCAB, LIBRARY);
	const missing = issues.find((i) => i.code === 'cinematic-missing-ref');
	ok('an empty ref is flagged', !!missing, issues.map((i) => i.code).join(','));
	ok('...only as a warning (it is inert, not fatal)', missing?.severity === 'warning', missing?.severity);

	const clean = FLOW.validateFlowDoc(graphWith({ ref: 'intro', awaitComplete: true }), VOCAB, LIBRARY);
	ok('a well-formed cinematic node raises no cinematic issues',
		!clean.some((i) => i.code.startsWith('cinematic-')), clean.map((i) => i.code).join(','));
}

// =========================================================================
console.log('\n5. pins');
{
	const doc = graphWith({ ref: 'intro' });
	const node = doc.graph.nodes.find((n) => n.kind === 'playCinematic');
	const pins = FLOW.derivePins(node, { vocab: VOCAB, library: LIBRARY });
	const ids = pins.map((p) => `${p.dir}:${p.id}`).sort().join(',');
	ok('exec-ins play + stop, one exec-out', ids === 'in:play,in:stop,out:exec', ids);
	ok('no data pins — everything is authored in /rigger', pins.every((p) => p.kind === 'exec'));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
