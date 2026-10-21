/**
 * Per-ratio keys in Animate mode, headless:
 *   pnpm --filter launcher-api check:timeline-ratio-keys
 *
 * A screen lays its nodes out per screen ratio, so a move keyed in one ratio rarely fits another
 * (reported: pots dropped 400 px under the reels on Desktop drop past them on Portrait, where they
 * are smaller and placed apart). A property track carrying a `layout` keys that ratio alone.
 *
 *  1. the format: a ratio with keys of its own plays them, every other ratio the default keys, and a
 *     caller that names no ratio never plays one ratio's keys everywhere (`keysLayout`,
 *     `sampleNodeActor`);
 *  2. *Key <ratio> separately* copies the default keys of every node actor to the ratio, and *Use
 *     default keys* drops them (`ratioKeyTracks`, `withoutRatioKeys`);
 *  3. the Timeline module shows, keys and pastes onto only the ratio's tracks while `propertyLayout`
 *     names it, and without the option (`/rigger`) a ratio's tracks are never shown or keyed;
 *  4. the Animate helpers read the ratio's keys: Properties' value, the key button, a stage drag;
 *  5. the editor preview plays what the game plays in that ratio (`timelineDrives`).
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

Object.assign(globalThis, {
	window: { addEventListener: () => {}, removeEventListener: () => {} },
	document: { activeElement: null },
});

const key = (time: number, value: number) => ({ time, value, ease: 'linear' as const });
const SCENE: Scene = {
	id: 'pots',
	name: 'Pots',
	nodes: [{ id: 'pot-red', kind: 'rect', label: 'Pot', x: 700, y: 215, width: 10, height: 10 }],
} as unknown as Scene;
const timeline = (): CinematicDoc => ({
	schemaVersion: 1,
	id: 'pots_drop',
	name: 'HideUnderReel',
	duration: 1,
	fps: 30,
	host: { kind: 'screen', sceneId: 'pots' },
	stage: {
		sceneId: null,
		cast: [{ actorId: 'pot', kind: 'node', target: 'Pot', place: {} }],
	} as CinematicDoc['stage'],
	tracks: [
		{
			id: 'prop_pot',
			actorId: 'pot',
			kind: 'property',
			channels: { y: [key(0, 0), key(1, 400)] },
		},
	],
	markers: [],
});
type Track = {
	id: string;
	kind: string;
	actorId?: string;
	layout?: string;
	channels?: Record<string, unknown[]>;
};
const tracks = (doc: CinematicDoc) => doc.tracks as unknown as Track[];
const yAt = (doc: CinematicDoc, t: number, layoutType?: string) =>
	EV.sampleNodeActor(
		doc.tracks as never,
		t,
		EV.keysLayout(doc.tracks as never, layoutType) as string | undefined,
	).y;

// ---- 1. the format --------------------------------------------------------------------------------
console.log('1. which keys a ratio plays');
{
	const doc = timeline();
	eq('no ratio keys: portrait plays the default keys', EV.keysLayout(doc.tracks as never, 'portrait'), undefined); // prettier-ignore
	tracks(doc).push({
		id: 'prop_pot_portrait',
		actorId: 'pot',
		kind: 'property',
		layout: 'portrait',
		channels: { y: [key(0, 0), key(1, 250)] },
	});
	eq('portrait has its own keys', EV.keysLayout(doc.tracks as never, 'portrait'), 'portrait');
	eq('desktop has none', EV.keysLayout(doc.tracks as never, 'desktop'), undefined);
	eq('portrait plays them', yAt(doc, 1, 'portrait'), 250);
	eq('desktop plays the default keys', yAt(doc, 1, 'desktop'), 400);
	eq('no ratio named: the default keys, never portrait’s', EV.sampleNodeActor(doc.tracks as never, 1).y, 400); // prettier-ignore
	eq('trackLayout reads the field', EV.trackLayout(tracks(doc)[1]), 'portrait');
	eq('…and an empty one as the default keys', EV.trackLayout({ layout: '' }), undefined);
}

// ---- 2. key a ratio separately, and back --------------------------------------------------------
console.log('2. Key <ratio> separately / Use default keys');
{
	const doc = timeline();
	doc.tracks.push({ id: 'cue', kind: 'cue', keys: [] });
	const copies = S.ratioKeyTracks(doc, 'portrait') as unknown as Track[];
	eq('copies each default property track of a node actor', copies.map((t) => [t.id, t.layout]), [['prop_pot_portrait', 'portrait']]); // prettier-ignore
	eq('…with the same keys', copies[0].channels, tracks(doc)[0].channels);
	copies[0].channels!.y = [key(0, 0), key(1, 250)];
	eq('…as a copy: editing it leaves the default keys alone', yAt(doc, 1), 400);
	doc.tracks.push(...(copies as unknown as CinematicDoc['tracks']));
	eq('the ratio then plays its copy', yAt(doc, 1, 'portrait'), 250);
	doc.tracks = S.withoutRatioKeys(doc, 'portrait');
	eq('Use default keys drops only that ratio’s tracks', tracks(doc).map((t) => t.id), ['prop_pot', 'cue']); // prettier-ignore
	eq('…and the ratio plays the default keys again', yAt(doc, 1, 'portrait'), 400);
	eq('what a ratio copies is the default keys of node actors', S.defaultNodeKeyTracks(doc).map((t) => t.id), ['prop_pot']); // prettier-ignore
	const empty = timeline();
	empty.tracks = [];
	eq('nothing keyed: nothing to copy', S.ratioKeyTracks(empty, 'portrait'), []);
}

// ---- 3. the Timeline module -----------------------------------------------------------------------
console.log('3. the module keys the ratio it is told');
{
	const doc = timeline();
	let ratio: string | undefined = undefined;
	const tl = mount(null, { doc, ev: EV, propertyLayout: () => ratio });
	tl.historyReset();
	tl.setTime(1);
	tl.keyProperty('pot', 'y', 380);
	eq('default keys: a key edits the default track', tracks(tl.doc()).map((t) => [t.layout ?? null, t.channels?.y?.length]), [[null, 2]]); // prettier-ignore
	ratio = 'portrait';
	eq('portrait with no tracks of its own: no rows', tl.propertyTracksOf('pot').length, 0);
	tl.keyProperty('pot', 'y', 250);
	const portrait = tracks(tl.doc()).find((t) => t.layout === 'portrait');
	eq('a key in portrait lands on a portrait track', portrait?.channels?.y, [key(1, 250)]);
	eq('the default keys are untouched', tracks(tl.doc())[0].channels?.y, [key(0, 0), key(1, 380)]);
	eq('portrait rows show only portrait’s track', tl.propertyTracksOf('pot').map((t) => t.layout), ['portrait']); // prettier-ignore
	ratio = undefined;
	eq('back on the default keys: only the default track', tl.propertyTracksOf('pot').map((t) => t.layout ?? null), [null]); // prettier-ignore
	const defaultTrack = tracks(tl.doc())[0].id;
	tl.selectKeys([{ trackId: defaultTrack, channel: 'y', time: 1 }]);
	tl.copyKeys();
	ratio = 'portrait';
	tl.setTime(0.5);
	tl.pasteKeys();
	eq('a key copied from the default keys pastes onto portrait’s track', tracks(tl.doc()).find((t) => t.layout === 'portrait')?.channels?.y, [key(0.5, 380), key(1, 250)]); // prettier-ignore
	eq('…never into the default keys portrait does not show', tracks(tl.doc())[0].channels?.y, [key(0, 0), key(1, 380)]); // prettier-ignore
	eq('…and selects the pasted key on portrait’s track', tl.selectedKeys().map((k) => tracks(tl.doc()).find((t) => t.id === k.trackId)?.layout), ['portrait']); // prettier-ignore
	tl.destroy();

	const rigger = mount(null, { doc: tl.doc(), ev: EV });
	eq('without the option (/rigger) a ratio’s track is never a row', rigger.propertyTracksOf('pot').map((t) => t.layout ?? null), [null]); // prettier-ignore
	rigger.setTime(0.5);
	rigger.keyProperty('pot', 'y', 100);
	eq('…nor keyed', tracks(rigger.doc()).find((t) => t.layout === 'portrait')?.channels?.y, [key(0.5, 380), key(1, 250)]); // prettier-ignore
	rigger.destroy();
}

// ---- 4. the Animate helpers -----------------------------------------------------------------------
console.log('4. Properties, the key button and a stage drag read the ratio’s keys');
{
	const doc = timeline();
	doc.tracks.push(...S.ratioKeyTracks(doc, 'portrait'));
	(tracks(doc)[1].channels as Record<string, unknown[]>).y = [key(0, 0), key(0.5, 250)];
	eq('Properties: the default value', S.nodeChannelValue(doc, 'pot', 'y', 0.5), 200);
	eq('Properties: portrait’s value', S.nodeChannelValue(doc, 'pot', 'y', 0.5, 'portrait'), 250);
	eq('key button: a key on the playhead in portrait', S.channelKeyState(doc, 'pot', 'y', 0.5, 'portrait'), 'key'); // prettier-ignore
	eq('…none there in the default keys', S.channelKeyState(doc, 'pot', 'y', 0.5), 'animated');
	eq('a ratio keying nothing on a channel reads it as unkeyed', S.isChannelKeyed(doc, 'pot', 'x', 'portrait'), false); // prettier-ignore
	eq(
		'a stage drag in portrait keys on top of portrait’s offset',
		S.stageDragKeys(doc, 'pot', { nodeId: 'pot-red', dy: 10 }, 0.5, ['y'], 'portrait'),
		{ y: 260 },
	);
}

// ---- 5. the preview plays what the game plays ----------------------------------------------------
console.log('5. the editor preview is the game’s sample');
{
	const doc = timeline();
	doc.tracks.push(...S.ratioKeyTracks(doc, 'portrait'));
	(tracks(doc)[1].channels as Record<string, unknown[]>).y = [key(0, 0), key(1, 250)];
	for (const layoutType of ['desktop', 'portrait', 'tablet']) {
		const ratio = EV.keysLayout(doc.tracks as never, layoutType) as string | undefined;
		const drive = S.timelineDrives(doc, SCENE, 1, ratio).get('pot-red');
		eq(`${layoutType}: the preview’s y is the game’s`, drive?.sample.y, yAt(doc, 1, layoutType));
	}
	eq('the preview keys `y` for the fold in every ratio', S.timelineDrives(doc, SCENE, 1, 'portrait').get('pot-red')?.bindings.map((b) => b.target), ['y']); // prettier-ignore
}

if (failures) {
	console.error(`\n❌ timeline ratio keys: ${failures} failed`);
	process.exit(1);
}
console.log('\n✓ timeline ratio keys: all passed');
