/**
 * The Timeline's cue, text and visibility rows (Rive plan Phase 9d), headless:
 *   pnpm --filter launcher-api check:timeline-rows
 *
 *  1. Report Event: `addCue('signal:')` puts a `signal:` cue at the snapped playhead, one undo
 *     step, and the game's `cuesCrossed` fires it once on the way past;
 *  2. visibility: `keyVisibility` keys a node actor shown / hidden (stepped), the game's
 *     `sampleNodeActor` reads it and the editor preview drives `visible` from it;
 *  3. text: a count-up and a switch key land on one text track, a mode switch drops the other
 *     kind's keys and names the mode (a track with no mode plays nothing), `deleteTextKey` prunes
 *     the emptied track, the game samples both modes, validation is clean, and the editor's text
 *     preview shows what the game would;
 *  4. absent ⇒ unchanged: mounting with `textRows` and keying nothing leaves a doc byte-identical,
 *     and the rows add no field the format lacks.
 */
import { textNodeStrings, validateNodeActors, type CinematicDoc, type Scene } from 'engine-layout';
import * as EV from '../../../packages/engine-cinematic/src/cinematicEval.js';
import { mount } from '../src/lib/timeline/timeline.js';
import { ensureNodeActor, timelineDrives } from '../src/lib/timeline/screenTimeline.ts';
import {
	REPORT_EVENT_PREFIX,
	cueKeys,
	keyText,
	previewTextShown,
	setTextMode,
	textKeyAt,
	textModeOf,
	textTrackOf,
} from '../src/lib/timeline/timelineRows.ts';

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

Object.assign(globalThis, {
	window: { addEventListener: () => {}, removeEventListener: () => {} },
	document: { activeElement: null },
});

const scene = {
	id: 's',
	name: 'Win',
	nodes: [
		{ id: 'n1', kind: 'text', label: 'Amount', text: '0', x: 0, y: 0, style: {} },
		{
			id: 'n2',
			kind: 'text',
			label: 'Title',
			text: 'WIN',
			switchKeys: ['BIG WIN', 'MEGA WIN'],
			x: 0,
			y: 0,
			style: {},
		},
	],
} as unknown as Scene;

const blank = (): CinematicDoc => ({
	schemaVersion: 1,
	id: 'rows',
	name: 'rows',
	duration: 2,
	fps: 30,
	host: { kind: 'screen', sceneId: 's' },
	stage: { sceneId: null, cast: [] },
	tracks: [],
	markers: [],
});

const doc = blank();
const tl = mount(null, { doc, ev: EV, textRows: true, interpolation: true, summaryRows: true });
tl.setActive(true);
tl.historyReset();

// ---- 1. Report Event --------------------------------------------------------------------------
console.log('1. Report event (a signal: cue at the playhead)');
tl.setTime(0.51);
const before = tl.historyDepth().index;
tl.addCue(REPORT_EVENT_PREFIX + 'coins');
eq('the cue lands at the snapped playhead', cueKeys(tl.doc()), [
	{ time: 0.5, cue: 'signal:coins' },
]);
eq('one undo step', tl.historyDepth().index - before, 1);
{
	const seed = mount(null, { doc: blank(), ev: EV });
	seed.addCue();
	eq('a bare addCue still seeds fx: (/rigger)', cueKeys(seed.doc())[0]?.cue, 'fx:');
}
const cueTrack = tl.cueTrack() as unknown as { keys: { time: number; cue: string }[] };
eq(
	'the game fires it once crossing 0.4 → 0.6',
	EV.cuesCrossed(cueTrack.keys, 0.4, 0.6).map((k) => k.cue),
	['signal:coins'],
);
eq('and not again from 0.6 → 1', EV.cuesCrossed(cueTrack.keys, 0.6, 1).length, 0);

// ---- 2. visibility -----------------------------------------------------------------------------
console.log('2. visibility keys');
const amount = ensureNodeActor(tl.doc(), 'Amount');
tl.setTime(0);
tl.keyVisibility(amount, false);
tl.setTime(1);
tl.keyVisibility(amount, true);
const visTrack = tl.visTracksOf(amount)[0] as unknown as { keys: unknown[] };
eq('two stepped keys', visTrack.keys, [
	{ time: 0, visible: false },
	{ time: 1, visible: true },
]);
const tracksOf = (id: string) => tl.doc().tracks.filter((t) => t.actorId === id);
eq('the game hides it before 1s', EV.sampleNodeActor(tracksOf(amount), 0.5).visible, false);
eq('and shows it from 1s', EV.sampleNodeActor(tracksOf(amount), 1.2).visible, true);
const drive = timelineDrives(tl.doc(), scene, 0.5).get('n1');
eq(
	'the editor preview drives `visible`',
	drive?.bindings.some((b) => b.target === 'visible'),
	true,
);

// ---- 3. text ------------------------------------------------------------------------------------
console.log('3. text keys');
const uid = (() => {
	let n = 0;
	return () => `text_${++n}`;
})();
keyText(tl.doc(), amount, 0, 'countUp', 0, uid);
keyText(tl.doc(), amount, 1, 'countUp', 1500, uid);
keyText(tl.doc(), amount, 1, 'countUp', 2500, uid);
tl.commit('key text');
eq('a count-up track with two keys (re-keying replaces)', textTrackOf(tl.doc(), amount), {
	id: 'text_1',
	actorId: amount,
	kind: 'text',
	mode: 'countUp',
	keys: [
		{ time: 0, value: 0 },
		{ time: 1, value: 2500 },
	],
});
eq('the game counts up halfway', EV.sampleNodeActor(tracksOf(amount), 0.5).text, {
	mode: 'countUp',
	value: 1250,
});
eq(
	'the editor shows it grouped',
	previewTextShown(scene.nodes[0], timelineDrives(tl.doc(), scene, 1).get('n1')?.sample.text),
	'2,500',
);
eq(
	'a share of a value source reads as a percentage',
	previewTextShown(scene.nodes[0], { mode: 'countUp', value: 0.5 }, 'win'),
	'50% of win',
);
eq('the key at the playhead', textKeyAt(tl.doc(), amount, 1.01, 0.5 / 30), {
	time: 1,
	value: 2500,
});

const title = ensureNodeActor(tl.doc(), 'Title');
keyText(tl.doc(), title, 0, 'switchKey', 'BIG WIN', uid);
keyText(tl.doc(), title, 1, 'switchKey', 'MEGA WIN', uid);
eq('a switch track', textModeOf(tl.doc(), title), 'switchKey');
eq('the game switches at 1s', EV.sampleNodeActor(tracksOf(title), 1.5).text, {
	mode: 'switchKey',
	key: 'MEGA WIN',
});
eq(
	'the editor shows a declared string',
	previewTextShown(scene.nodes[1], { mode: 'switchKey', key: 'BIG WIN' }),
	'BIG WIN',
);
eq(
	'and the node text for an undeclared one',
	previewTextShown(scene.nodes[1], { mode: 'switchKey', key: 'NOPE' }),
	undefined,
);
eq('the offered strings', textNodeStrings(scene.nodes[1]), ['WIN', 'BIG WIN', 'MEGA WIN']);
eq(
	'validation is clean',
	validateNodeActors(tl.doc(), scene, () => undefined),
	[],
);

eq('a mode switch drops the other kind', setTextMode(tl.doc(), title, 'countUp'), true);
eq('…leaving an empty count-up track', textTrackOf(tl.doc(), title)?.keys, []);
const modeless = blank();
modeless.tracks.push({ id: 't', actorId: 'a', kind: 'text', keys: [{ time: 0, value: 3 }] });
eq('a track with no mode is named, keeping its keys', setTextMode(modeless, 'a', 'countUp'), true);
eq('…and now plays', EV.sampleNodeActor(modeless.tracks, 0).text, { mode: 'countUp', value: 3 });

const titleTrack = textTrackOf(tl.doc(), title)!;
keyText(tl.doc(), title, 0.5, 'countUp', 7, uid);
tl.deleteTextKey(titleTrack.id, 0.5);
eq('deleting the last key prunes the track', textTrackOf(tl.doc(), title), null);

// ---- 4. absent ⇒ unchanged ----------------------------------------------------------------------
console.log('4. absent ⇒ unchanged');
const untouched = blank();
untouched.stage.cast.push({ actorId: 'a', kind: 'node', target: 'Amount', place: {} });
untouched.tracks.push({
	id: 'p',
	actorId: 'a',
	kind: 'property',
	channels: { x: [{ time: 0, value: 1 }] },
});
const bytes = JSON.stringify(untouched);
const quiet = mount(null, { doc: untouched, ev: EV, textRows: true });
quiet.setActive(true);
quiet.historyReset();
quiet.renderTimeline();
quiet.setTime(1);
eq(
	'mounting with textRows and keying nothing keeps the doc byte-identical',
	JSON.stringify(quiet.doc()),
	bytes,
);
const fields = new Set<string>();
for (const t of tl.doc().tracks) for (const k of Object.keys(t)) fields.add(k);
eq(
	'the rows write only fields the format already has',
	[...fields].filter((f) => !['id', 'actorId', 'kind', 'keys', 'mode', 'channels'].includes(f)),
	[],
);

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\ncheck:timeline-rows passed');
