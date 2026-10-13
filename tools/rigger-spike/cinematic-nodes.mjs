// Invisible Cinematic — NODE ACTORS + HOSTS (Rive plan Phase 1), headless.
//
//   node tools/rigger-spike/cinematic-nodes.mjs
//
// A timeline can drive layout nodes of a host Scene by name (`cast.kind === 'node'`, `doc.host`).
// This gate pins the parts that decide what a node does at time t, over the REAL modules:
//   1. the shared evaluator's node sampling (`sampleNodeActor`, `sampleTint`, `sampleText`,
//      `cinematicHost`) — the same file /rigger loads;
//   2. engine-layout's binding of actors to nodes (`resolveNodeActors`, `findNodeByName`), the
//      validator, the switch-key collector, and the value-binding fold the player feeds — so a
//      keyed channel moves / scales / fades a node exactly as stated in `types.ts`;
//   3. PARITY: a document with no node actor and no host resolves to nothing new — no node is
//      driven, the set is still `stage.sceneId`, and every channel a binding would fold is absent.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESBUILD } from './esbuild.mjs';
import {
	NODE_CHANNELS,
	cinematicHost,
	isNodeActor,
	sampleNodeActor,
	sampleText,
	sampleTint,
	evaluateActor,
} from '../../packages/engine-cinematic/src/cinematicEval.js';

const ROOT = new URL('../../', import.meta.url);
const LIB = fileURLToPath(new URL('packages/engine-layout/src/lib/', ROOT));
const esbuild = await import(ESBUILD);
const dir = mkdtempSync(join(tmpdir(), 'cine-nodes-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export * from ${JSON.stringify(join(LIB, 'cinematicNodes.ts'))};
export { foldBoundTransform, boundFillShare, boundFrameOutput } from ${JSON.stringify(join(LIB, 'valueBindings.ts'))};`,
);
const out = join(dir, 'bundle.mjs');
await esbuild.build({
	entryPoints: [entry],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	logLevel: 'silent',
});
const L = await import(pathToFileURL(out).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) =>
	ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---- fixtures -------------------------------------------------------------

const scene = {
	id: 'base',
	name: 'Base game',
	nodes: [
		{ id: 'n1', kind: 'sprite', label: 'logo', x: 100, y: 50, rotation: 0.5, alpha: 0.8, scale: { x: 2, y: 2 }, region: 'logo' },
		{
			id: 'grp',
			kind: 'container',
			label: 'panel',
			x: 0,
			y: 0,
			children: [
				{ id: 'n2', kind: 'text', label: 'title', x: 0, y: 0, text: 'GOOD LUCK', switchKeys: ['BIG WIN', 'MEGA WIN'] },
				{ id: 'n3', kind: 'flipbook', label: 'coin', x: 0, y: 0, clipId: 'coin' },
			],
		},
		{ id: 'n4', kind: 'rect', x: 0, y: 0, width: 10, height: 10 },
		{ id: 'n5', kind: 'componentInstance', label: 'spinButton', x: 0, y: 0, componentId: 'btn' },
	],
};

const nodeDoc = {
	schemaVersion: 1,
	id: 'intro',
	name: 'Intro',
	duration: 2,
	fps: 30,
	host: { kind: 'screen', sceneId: 'base' },
	stage: {
		sceneId: null,
		cast: [
			{ actorId: 'a1', kind: 'node', target: 'logo', place: {} },
			{ actorId: 'a2', kind: 'node', target: 'title', place: {} },
			{ actorId: 'a3', kind: 'node', target: 'coin', place: {} },
			{ actorId: 'a4', kind: 'node', target: 'n4', place: {} },
			{ actorId: 'a5', kind: 'node', target: 'ghost', place: {} },
		],
	},
	tracks: [
		{
			id: 'p1', kind: 'property', actorId: 'a1',
			channels: {
				x: [{ time: 0, value: -200 }, { time: 1, value: 0 }],
				scale: [{ time: 0, value: 0.5, ease: 'hold' }, { time: 1, value: 1 }],
				alpha: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
				rotation: [{ time: 0, value: 90 }],
				tint: [{ time: 0, value: 0xff0000 }, { time: 1, value: 0x0000ff }],
				flipX: [{ time: 0, value: 1 }],
			},
		},
		{ id: 'v1', kind: 'visibility', actorId: 'a1', keys: [{ time: 0.5, visible: false }, { time: 1, visible: true }] },
		{
			id: 't2', kind: 'text', actorId: 'a2', mode: 'switchKey',
			keys: [{ time: 0.5, key: 'BIG WIN' }, { time: 1.5, key: 'MEGA WIN' }, { time: 1.8, key: 'NOT DECLARED' }],
		},
		{ id: 'p3', kind: 'property', actorId: 'a3', channels: { frame: [{ time: 0, value: 0 }, { time: 2, value: 8 }], fill: [{ time: 0, value: 0 }, { time: 2, value: 1 }] } },
		{ id: 'p4', kind: 'property', actorId: 'a4', channels: { frame: [{ time: 0, value: 2 }] } },
		{ id: 'cue', kind: 'cue', keys: [{ time: 1, cue: 'sfx:ding' }] },
	],
	markers: [],
};

// ---- 1. evaluator ---------------------------------------------------------

console.log('\n1. the shared evaluator samples node actors');
eq('NODE_CHANNELS is the documented set', [...NODE_CHANNELS], ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'alpha', 'tint', 'frame', 'fill']);
ok('absent kind reads as a rig', !isNodeActor({ actorId: 'r' }) && !isNodeActor({ kind: 'rig' }) && isNodeActor({ kind: 'node' }));
eq('absent host is the cast', cinematicHost({}), { kind: 'cast' });
eq('a screen host normalises', cinematicHost(nodeDoc), { kind: 'screen', sceneId: 'base' });
eq('a component host normalises', cinematicHost({ host: { kind: 'component', componentId: 'btn', extra: 1 } }), { kind: 'component', componentId: 'btn' });
eq('a malformed host falls back to the cast', cinematicHost({ host: { kind: 'screen' } }), { kind: 'cast' });
eq('an unknown host kind falls back to the cast', cinematicHost({ host: { kind: 'world' } }), { kind: 'cast' });

const a1 = nodeDoc.tracks.filter((t) => t.actorId === 'a1');
const s0 = sampleNodeActor(a1, 0);
eq('t=0: offsets, multipliers, degrees and tint as keyed', s0, { x: -200, rotation: 90, alpha: 0, tint: 0xff0000, scaleX: 0.5, scaleY: 0.5, visible: false });
const sMid = sampleNodeActor(a1, 0.5);
ok('t=0.5: x is linear', near(sMid.x, -100));
ok('t=0.5: a `hold` key steps (scale stays 0.5)', sMid.scaleX === 0.5 && sMid.scaleY === 0.5);
eq('t=0.5: tint eases PER CHANNEL, not as one integer', sMid.tint, (128 << 16) | 128);
ok('t=0.5: a visibility key hides the node', sMid.visible === false);
ok('t=0.25: visibility holds its FIRST key backwards', sampleNodeActor(a1, 0.25).visible === false);
ok('t=1: shown again, end values hold', sampleNodeActor(a1, 1).visible === true && sampleNodeActor(a1, 5).x === 0);
ok('a rig-only channel (flipX) is not a node channel', !('flipX' in s0));
eq('an un-keyed node samples to nothing', sampleNodeActor([], 1), {});
eq('scaleX alone leaves scaleY at identity', sampleNodeActor([{ kind: 'property', channels: { scaleX: [{ time: 0, value: 3 }] } }], 0), { scaleX: 3, scaleY: 1 });
ok('scale multiplies into scaleX/scaleY', sampleNodeActor([{ kind: 'property', channels: { scale: [{ time: 0, value: 2 }], scaleY: [{ time: 0, value: 3 }] } }], 0).scaleY === 6);
eq('sampleTint: no keys', sampleTint(undefined, 0), undefined);
eq('sampleTint: hold ease steps', sampleTint([{ time: 0, value: 0xffffff, ease: 'hold' }, { time: 1, value: 0 }], 0.9), 0xffffff);

const t2 = nodeDoc.tracks.find((t) => t.id === 't2');
eq('switchKey: before the first key, hold it backwards', sampleText(t2, 0), { mode: 'switchKey', key: 'BIG WIN' });
eq('switchKey: stepped at the second key', sampleText(t2, 1.5), { mode: 'switchKey', key: 'MEGA WIN' });
eq('switchKey: between keys, the earlier one', sampleText(t2, 1.49), { mode: 'switchKey', key: 'BIG WIN' });
const count = { kind: 'text', mode: 'countUp', keys: [{ time: 0, value: 0 }, { time: 2, value: 500 }, { time: 3, key: 'junk' }] };
eq('countUp: eased like a channel', sampleText(count, 1), { mode: 'countUp', value: 250 });
eq('countUp: keys without a value are skipped', sampleText(count, 9), { mode: 'countUp', value: 500 });
eq('an unknown text mode yields nothing', sampleText({ kind: 'text', mode: 'freeText', keys: [{ time: 0, key: 'x' }] }, 0), undefined);
eq('sampleNodeActor carries the text sample', sampleNodeActor([count], 2).text, { mode: 'countUp', value: 500 });
ok('evaluateActor still poses only rigs (unchanged export)', typeof evaluateActor === 'function');

// ---- 2. engine-layout binding --------------------------------------------

console.log('\n2. engine-layout binds actors to host nodes by name');
eq('findNodeByName: by label, depth-first', L.findNodeByName(scene.nodes, 'title')?.id, 'n2');
eq('findNodeByName: falls back to id', L.findNodeByName(scene.nodes, 'n4')?.id, 'n4');
eq('findNodeByName: a label wins over an earlier id match', L.findNodeByName([{ id: 'x', kind: 'rect' }, { id: 'y', kind: 'rect', label: 'x' }], 'x')?.id, 'y');
eq('findNodeByName: nothing', L.findNodeByName(scene.nodes, 'ghost'), undefined);

const bound = L.resolveNodeActors(nodeDoc, scene);
eq('resolveNodeActors: keyed by NODE id; missing nodes left out', [...bound.keys()], ['n1', 'n2', 'n3', 'n4']);
eq('...each carrying only its own tracks', bound.get('n1').tracks.map((t) => t.id), ['p1', 'v1']);
eq('a cast-hosted doc drives no node', L.resolveNodeActors({ ...nodeDoc, host: undefined }, scene).size, 0);
eq('a component host drives no screen node (Phase 4)', L.resolveNodeActors({ ...nodeDoc, host: { kind: 'component', componentId: 'btn' } }, scene).size, 0);
eq('a screen host for ANOTHER scene drives nothing here', L.resolveNodeActors({ ...nodeDoc, host: { kind: 'screen', sceneId: 'other' } }, scene).size, 0);
eq('the set of a screen host is its scene', L.cinematicSetSceneId(nodeDoc), 'base');
eq('the set of a cast doc is stage.sceneId', L.cinematicSetSceneId({ ...nodeDoc, host: undefined, stage: { ...nodeDoc.stage, sceneId: 'fs' } }), 'fs');

eq('channels per kind: text', L.nodeActorChannelsForKind('text'), ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'alpha', 'visible', 'text']);
ok('channels per kind: flipbook takes frame + fill + tint', ['frame', 'fill', 'tint'].every((c) => L.nodeActorChannelsForKind('flipbook').includes(c)));
ok('channels per kind: a rect takes fill but no tint', L.nodeActorChannelsForKind('rect').includes('fill') && !L.nodeActorChannelsForKind('rect').includes('tint'));

const issues = L.validateNodeActors(nodeDoc, scene);
eq('validate: the codes, in cast order', issues.map((i) => `${i.actorId}:${i.code}`), [
	'a1:channel-unsupported', // flipX
	'a2:switch-key-undeclared', // NOT DECLARED
	'a4:channel-unsupported', // frame on a rect
	'a5:node-missing',
]);
eq('validate: an actor with no target', L.validateNodeActors({ ...nodeDoc, stage: { ...nodeDoc.stage, cast: [{ actorId: 'z', kind: 'node', place: {} }] } }, scene).map((i) => i.code), ['no-target']);

eq('switch keys collected per actor, deduped', L.collectTimelineSwitchKeys(nodeDoc).map((k) => k.key), ['BIG WIN', 'MEGA WIN', 'NOT DECLARED']);
eq('textNodeStrings: own text first, then switchKeys', L.textNodeStrings(scene.nodes[1].children[0]), ['GOOD LUCK', 'BIG WIN', 'MEGA WIN']);

// The player feeds a node actor's channels through the node's own value-binding fold.
const authored = { x: 100, y: 50, rotation: 0.5, alpha: 0.8, scale: { x: 2, y: 2 }, visible: true };
const channels = L.keyedNodeChannels(bound.get('n1').tracks);
const bindings = L.nodeActorBindings(channels);
eq('bindings stand for the keyed channels', bindings.map((b) => b.target), ['x', 'rotation', 'alpha', 'visible', 'scaleX', 'scaleY']);
const folded = L.foldBoundTransform(authored, bindings, L.nodeActorOutputs(bindings, sampleNodeActor(bound.get('n1').tracks, 1)));
ok('fold: x is an OFFSET from the authored x', folded.x === 100);
ok('fold: rotation adds DEGREES to the authored radians', near(folded.rotation, 0.5 + Math.PI / 2));
ok('fold: alpha multiplies', near(folded.alpha, 0.8));
ok('fold: scale multiplies', folded.scale.x === 2 && folded.scale.y === 2);
const hidden = L.foldBoundTransform(authored, bindings, L.nodeActorOutputs(bindings, sampleNodeActor(bound.get('n1').tracks, 0.5)));
ok('fold: a visibility key hides the node', hidden.visible === false);
const fb = L.nodeActorBindings(L.keyedNodeChannels(bound.get('n3').tracks));
const fbOut = L.nodeActorOutputs(fb, sampleNodeActor(bound.get('n3').tracks, 1));
eq('fold: fill reveals the keyed share', L.boundFillShare(fb, fbOut), { share: 0.5, direction: 'right' });
eq('fold: frame holds the keyed frame', L.boundFrameOutput(fb, fbOut), 4);

// ---- 3. parity ------------------------------------------------------------

console.log('\n3. parity: an existing (rig-only) cinematic gains nothing');
const rigDoc = {
	schemaVersion: 1, id: 'old', name: 'Old', duration: 3, fps: 30,
	stage: { sceneId: 'base', cast: [{ actorId: 'r1', rigFolder: 'bigwin', place: { x: 1 } }] },
	tracks: [{ id: 'p', kind: 'property', actorId: 'r1', channels: { x: [{ time: 0, value: 5 }] } }],
	markers: [],
};
const before = JSON.stringify(rigDoc);
eq('no node is driven', L.resolveNodeActors(rigDoc, scene).size, 0);
eq('the set is still stage.sceneId', L.cinematicSetSceneId(rigDoc), 'base');
eq('nothing to validate', L.validateNodeActors(rigDoc, scene), []);
eq('no switch keys', L.collectTimelineSwitchKeys(rigDoc), []);
ok('the rig actor is not a node actor', !isNodeActor(rigDoc.stage.cast[0]));
eq('the host reads as the cast', cinematicHost(rigDoc), { kind: 'cast' });
eq('no channel ⇒ no extra binding', L.nodeActorBindings(new Set()), []);
const untouched = L.foldBoundTransform(authored, [], []);
ok('no binding ⇒ the fold hands back the SAME transform object', untouched === authored);
ok('none of it mutated the document', JSON.stringify(rigDoc) === before);

console.log(fail === 0 ? `\nPASS — ${pass}/${pass + fail}` : `\nFAIL — ${fail} of ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
