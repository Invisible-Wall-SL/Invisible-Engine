/**
 * Import smoke test for the shared cinematic SEQUENCER — the module `/rigger` mounts today and
 * `/editor`'s Svelte wrapper mounts next (docs/design/rive-style-editor.md §3.4, Phase 3):
 *   pnpm --filter launcher-api exec tsx --tsconfig tsconfig.scripts.json cinematicSequencer.fixture.ts
 *
 * What it pins: the module imports through the `$lib` path Svelte code uses, touches no browser
 * global until `mount` (so a Svelte component can import it during SSR), runs headless with no
 * timeline element, and keeps the undo contract — one step per discrete edit, edits sharing a
 * coalesce key within 600 ms merge, a new edit drops the redo branch, and undo hands the host a NEW
 * document object. The DOM side (every row, drag and inspector) is gated in a real browser by
 * `tools/rigger-spike/cinematic-sequencer.mjs`.
 */
import type { CinematicDoc } from 'engine-layout';
import * as EV from '../../packages/engine-cinematic/src/cinematicEval.js';
import { CAM_CHANNELS, PROP_CHANNELS, hasStrips, mount } from '$lib/cinematic/sequencer.js';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
};

check('the module loaded with no window/document', typeof globalThis.window, 'undefined');
check(
	'channel tables',
	[PROP_CHANNELS.map((c) => c.key), CAM_CHANNELS.map((c) => c.key)],
	[
		['x', 'y', 'scale', 'rotation', 'alpha'],
		['x', 'y', 'zoom'],
	],
);
check('hasStrips', [hasStrips({ id: 'a', strips: [] }), hasStrips({ id: 'b' })], [true, false]);

// `mount` registers its keyboard handler — the only global it needs headless.
const listeners: string[] = [];
Object.assign(globalThis, {
	window: {
		addEventListener: (type: string) => listeners.push(type),
		removeEventListener: (type: string) => listeners.splice(listeners.indexOf(type), 1),
	},
});
let clock = 1_000_000;
Date.now = () => clock;

const doc: CinematicDoc = {
	schemaVersion: 1,
	id: 'smoke',
	name: 'Smoke',
	duration: 4,
	fps: 30,
	stage: {
		sceneId: null,
		cast: [{ actorId: 'a1', place: { x: 0, y: 0, scale: 1 }, z: 0, visible: true }],
	},
	tracks: [],
	markers: [],
};

const seen = { evaluate: [] as number[], seeked: 0, changed: 0, replaced: [] as CinematicDoc[] };
const seq = mount(null as unknown as HTMLElement, {
	doc,
	ev: EV,
	host: {
		evaluate: (t) => seen.evaluate.push(t),
		seeked: () => (seen.seeked += 1),
		changed: () => (seen.changed += 1),
		docReplaced: (d) => void seen.replaced.push(d),
	},
});
check('mount listens for keys', listeners, ['keydown']);
seq.historyReset();

seq.setTime(9);
check(
	'setTime clamps to the duration and poses, then reports',
	[seq.time(), seen.evaluate, seen.seeked],
	[4, [4], 1],
);
seq.setTime(1.01);
seq.keyProperty('a1', 'x', 50);
check('a key at the playhead snaps to the fps grid', seq.propertyTracksOf('a1')[0].channels, {
	x: [{ time: 1, value: 50, ease: 'linear' }],
});
check('the key is one undo step', seq.historyDepth(), { index: 1, size: 2, label: 'key x' });

doc.stage.cast[0].place.y = 10;
seq.commit('move actor', 'place:a1:y');
clock += 300;
doc.stage.cast[0].place.y = 20;
seq.commit('move actor', 'place:a1:y');
check('same key within 600 ms coalesces', seq.historyDepth().size, 3);
clock += 700;
doc.stage.cast[0].place.y = 30;
seq.commit('move actor', 'place:a1:y');
check('…and past 600 ms is a new step', seq.historyDepth().size, 4);
check('every commit told the host', seen.changed, 4);

await seq.undo();
check(
	'undo replaces the document object',
	[seen.replaced.length, seen.replaced[0] !== doc],
	[1, true],
);
check('…with the previous state', seq.doc().stage.cast[0].place.y, 20);
await seq.undo();
await seq.undo();
check(
	'back to the open state',
	[seq.doc().tracks.length, seq.canUndo(), seq.canRedo()],
	[0, false, true],
);
await seq.redo();
check('redo reapplies the key', seq.propertyTracksOf('a1')[0].channels, {
	x: [{ time: 1, value: 50, ease: 'linear' }],
});
seq.commit('rename', 'name');
check('a new edit drops the redo branch', [seq.canRedo(), seq.historyDepth().size], [false, 3]);

seq.destroy();
check('destroy removes the key handler', listeners, []);

console.log('');
if (failures > 0) {
	console.error(`CINEMATIC SEQUENCER: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('CINEMATIC SEQUENCER: PASSED');
