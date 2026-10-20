/**
 * Keying and easing in the shared Timeline (Rive plan Phase 9b), headless:
 *   pnpm --filter launcher-api check:timeline-keying
 *
 *  1. a new key takes the doc's `defaultEase` (a cubic stays an array), an existing key keeps its
 *     own, and *Set as default* back to Linear removes the field;
 *  2. the Interpolation panel's write sets every selected key's ease in one undo step;
 *  3. Ctrl+C / Ctrl+V copies the selected keys to the playhead on the same channels (values and
 *     eases kept, a key already there replaced, the pasted keys selected); Delete removes every
 *     selected key and prunes the emptied channel;
 *  4. `,` / `.` step a frame (Shift: ten) and Space plays / pauses through the host — and none of
 *     them fire while a field has focus;
 *  5. the Animate helpers: a key button's state, the absolute value Properties shows and its
 *     inverse, what a stage drag keys (on top of the current offset), and the onion skin's ghosts.
 *
 * The DOM side (rows, the curve editor, box select) is the owner's browser check; `/rigger`'s
 * markup is pinned by `tools/rigger-spike/cinematic-timeline.mjs`.
 */
import type { CinematicDoc, Scene } from 'engine-layout';
import * as EV from '../../../packages/engine-cinematic/src/cinematicEval.js';
import { mount } from '../src/lib/timeline/timeline.js';
import * as S from '../src/lib/timeline/screenTimeline.ts';

let failures = 0;
const eq = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
	}
};

type Handler = (e: Partial<KeyboardEvent> & { preventDefault(): void }) => void;
const handlers: Handler[] = [];
const focus: { activeElement: { tagName: string; isContentEditable?: boolean } | null } = {
	activeElement: null,
};
Object.assign(globalThis, {
	window: {
		addEventListener: (_: string, h: Handler) => handlers.push(h),
		removeEventListener: () => {},
	},
	document: focus,
});
const press = (key: string, mods: { shift?: boolean; ctrl?: boolean } = {}): boolean => {
	let prevented = false;
	for (const h of handlers)
		h({
			key,
			shiftKey: !!mods.shift,
			ctrlKey: !!mods.ctrl,
			metaKey: false,
			altKey: false,
			preventDefault: () => (prevented = true),
		});
	return prevented;
};

const doc: CinematicDoc = {
	schemaVersion: 1,
	id: 'k',
	name: 'k',
	duration: 4,
	fps: 30,
	host: { kind: 'screen', sceneId: 's' },
	stage: {
		sceneId: null,
		cast: [{ actorId: 'a', kind: 'node', target: 'Coin', place: {} }],
	} as CinematicDoc['stage'],
	tracks: [],
	markers: [],
};
let toggled = 0;
const tl = mount(null, {
	doc,
	ev: EV,
	interpolation: true,
	summaryRows: true,
	host: { togglePlay: () => toggled++ },
});
tl.setActive(true);
tl.historyReset();
const keysOf = (channel: string) =>
	(tl.doc().tracks.find((t) => t.kind === 'property') as { channels: Record<string, unknown[]> })
		?.channels[channel];
const trackId = () => tl.doc().tracks.find((t) => t.kind === 'property')!.id as string;

// ---- 1. default ease --------------------------------------------------------------------------
console.log('1. default interpolation');
tl.keyProperty('a', 'x', 0);
eq('no default: a new key is linear', keysOf('x'), [{ time: 0, value: 0, ease: 'linear' }]);
tl.setDefaultEase([0.76, 0, 0.18, 1]);
eq('Set as default stores the cubic on the doc', tl.doc().defaultEase, [0.76, 0, 0.18, 1]);
tl.setTime(1);
tl.keyProperty('a', 'x', 50);
eq('a new key takes the default', (keysOf('x')![1] as { ease: unknown }).ease, [0.76, 0, 0.18, 1]);
tl.setTime(0);
tl.keyProperty('a', 'x', 5);
eq(
	're-keying an existing key keeps its own ease',
	(keysOf('x')![0] as { ease: unknown }).ease,
	'linear',
);
tl.setTime(1);
tl.keyProperty('a', 'scale', 1, 'hold');
eq(
	'an explicit ease wins over the default',
	(keysOf('scale')![0] as { ease: unknown }).ease,
	'hold',
);
tl.setDefaultEase('linear');
eq('Linear as the default removes the field', 'defaultEase' in tl.doc(), false);

// ---- 2. the Interpolation panel's write ----------------------------------------------------------
console.log('2. the panel sets every selected key');
tl.selectKeys([
	{ trackId: trackId(), channel: 'x', time: 0 },
	{ trackId: trackId(), channel: 'x', time: 1 },
]);
const before = tl.historyDepth().index;
tl.setSelectedEase([0.42, 0, 0.58, 1]);
eq(
	'both keys are cubic',
	keysOf('x')!.map((k) => (k as { ease: unknown }).ease),
	[
		[0.42, 0, 0.58, 1],
		[0.42, 0, 0.58, 1],
	],
);
eq('one undo step', tl.historyDepth().index - before, 1);
tl.setSelectedEase('hold', true);
eq('a live write (a handle mid-drag) records no step', tl.historyDepth().index - before, 1);
tl.setSelectedEase('hold');
eq('a later write coalesces with it', tl.historyDepth().label, 'interpolation');

// ---- 3. copy / paste / delete -------------------------------------------------------------------
console.log('3. copy, paste and delete keys');
eq('Ctrl+C with keys selected is handled', press('c', { ctrl: true }), true);
tl.setTime(2);
eq('Ctrl+V pastes', press('v', { ctrl: true }), true);
eq('the copies land from the playhead, values and eases kept', keysOf('x'), [
	{ time: 0, value: 5, ease: 'hold' },
	{ time: 1, value: 50, ease: 'hold' },
	{ time: 2, value: 5, ease: 'hold' },
	{ time: 3, value: 50, ease: 'hold' },
]);
eq(
	'the pasted keys are selected',
	tl.selectedKeys().map((k) => k.time),
	[2, 3],
);
tl.setTime(3);
tl.pasteKeys();
eq('pasting over a key replaces it', keysOf('x')!.length, 5);
tl.selectKeys(
	keysOf('x')!.map((k) => ({
		trackId: trackId(),
		channel: 'x',
		time: (k as { time: number }).time,
	})),
);
eq('Delete removes every selected key', press('Delete'), true);
eq('…and prunes the emptied channel', keysOf('x'), undefined);
eq('the other channel stays', keysOf('scale')!.length, 1);
void tl.undo();
eq('undo brings them back', keysOf('x')!.length, 5);

// ---- 4. frame stepping + Space ----------------------------------------------------------------
console.log('4. `,` `.` and Space');
tl.setTime(1);
press('.');
eq('`.` steps one frame', Math.round(tl.time() * 30), 31);
press('.', { shift: true });
eq('Shift+`.` steps ten', Math.round(tl.time() * 30), 41);
press(',');
eq('`,` steps back', Math.round(tl.time() * 30), 40);
eq('Space plays through the host', [press(' '), toggled], [true, 1]);
focus.activeElement = { tagName: 'INPUT' };
press('.');
press(' ');
eq('nothing fires while a field has focus', [Math.round(tl.time() * 30), toggled], [40, 1]);
focus.activeElement = { tagName: 'DIV', isContentEditable: true };
press('.');
eq('…nor in an editable element', Math.round(tl.time() * 30), 40);
focus.activeElement = null;
tl.destroy();

// ---- 5. the Animate helpers ------------------------------------------------------------------
console.log('5. key states, shown values, stage drags and the onion skin');
const d = tl.doc();
eq(
	'key states',
	[
		S.channelKeyState(d, 'a', 'x', 1),
		S.channelKeyState(d, 'a', 'x', 1.5),
		S.channelKeyState(d, 'a', 'y', 1),
		S.channelKeyState(d, 'a', 'x', 1 + 0.4 / 30),
		S.channelKeyState(d, null, 'x', 1),
	],
	['key', 'animated', 'none', 'key', 'none'],
);
const pose = { x: 100, y: 50, rotation: 30, alpha: 0.5, tint: 0x336699 };
const shown = S.KEYED_CHANNELS.map((c) => S.shownChannelValue(c, S.NODE_IDENTITY[c], pose, false));
eq('an unkeyed field shows the Design pose', shown, [100, 50, 1, 30, 0.5, 0x336699]);
eq(
	'a keyed field shows the pose with the channel folded on',
	[
		S.shownChannelValue('x', 20, pose, true),
		S.shownChannelValue('alpha', 2, pose, true),
		S.shownChannelValue('tint', 0xff0000, pose, true),
	],
	[120, 1, 0xff0000],
);
eq(
	'typing a value keys the relative one (the inverse)',
	(['x', 'y', 'rotation', 'alpha', 'scale'] as const).map((c) =>
		S.relativeChannelValue(c, S.shownChannelValue(c, 7, pose, true), pose),
	),
	[7, 7, 7, 7, 7],
);
eq(
	'a node authored at alpha 0 keys the typed value itself',
	S.relativeChannelValue('alpha', 0.8, { ...pose, alpha: 0 }),
	0.8,
);
eq(
	'a stage drag keys only what changed, on top of the current offset',
	S.stageDragKeys(d, 'a', { nodeId: 'n', dx: 10, dy: 0, scale: 1 }, 1, S.KEYED_CHANNELS),
	{ x: 60 },
);
eq(
	'scale multiplies, rotation adds',
	S.stageDragKeys(d, 'a', { nodeId: 'n', scale: 2, rotation: 15 }, 1, ['scale', 'rotation']),
	{ scale: 2, rotation: 15 },
);
eq(
	'a channel the node cannot key is skipped',
	S.stageDragKeys(d, null, { nodeId: 'n', dx: 5, rotation: 15 }, 0, ['x']),
	{ x: 5 },
);
const scene = {
	id: 's',
	name: 's',
	nodes: [{ id: 'n1', kind: 'sprite', label: 'Coin', x: 0, y: 0 }],
} as unknown as Scene;
const ghosts = S.onionFrames(d, scene, 1, 2);
eq(
	'onion: ±2 frames, nearest first',
	ghosts.map((g) => g.offset),
	[-1, 1, -2, 2],
);
eq(
	'onion: each ghost drives the node',
	ghosts.every((g) => g.drives.has('n1')),
	true,
);
eq(
	'onion: frames outside the timeline are dropped',
	S.onionFrames(d, scene, 0, 2).map((g) => g.offset),
	[1, 2],
);
eq('onion: off is no ghosts', S.onionFrames(d, scene, 1, 0), []);

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nall timeline-keying checks passed');
