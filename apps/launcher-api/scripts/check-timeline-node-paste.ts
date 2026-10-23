/**
 * Ctrl+V of copied keys onto ANOTHER node, headless:
 *   pnpm --filter launcher-api check:timeline-node-paste
 *
 * Reported: "I want the reel background to do exactly the same animation — can I copy and paste
 * the keys?" Paste only ever wrote back onto the copied track, so the keys could not move to
 * another node. Now, with the keys of ONE node copied and another node selected on the stage, the
 * Timeline's `host.pasteTarget` names it and the keys land on its fields.
 *
 *  1. keys copied from `Reel grid` paste onto the selected `Reel_Background`: a node actor and a
 *     property track created for it, the same fields, values and eases, timed from the playhead;
 *  2. the same node selected (or none, or no host hook — `/rigger`) pastes exactly as before;
 *  3. the paste lands in the ratio being edited (`propertyLayout`), and a field the target cannot
 *     key is skipped;
 *  4. the editor panel hands the module its `pasteTarget`, built on `ensureNodeActor` +
 *     `keyableChannels`.
 */
import { readFileSync } from 'node:fs';
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

const SCENE: Scene = {
	id: 'base',
	name: 'Base game',
	nodes: [
		{ id: 'bg', kind: 'sprite', label: 'Reel_Background', x: 0, y: 0 },
		{ id: 'grid', kind: 'reelGrid', label: 'Reel grid', x: 0, y: 0 },
	],
} as unknown as Scene;

type Track = { id: string; actorId?: string; kind: string; layout?: string; channels?: Record<string, { time: number; value: number; ease?: unknown }[]> }; // prettier-ignore
const tracks = (doc: CinematicDoc): Track[] => doc.tracks as unknown as Track[];

/** The owner's Reel_Intro: `Reel grid` keys y at 0 / 1 / 2 s and scale at 0 / 2 s. */
const reelIntro = (): CinematicDoc => ({
	schemaVersion: 1,
	id: 'base_reel_intro',
	name: 'Reel_Intro',
	duration: 2,
	fps: 30,
	host: { kind: 'screen', sceneId: 'base' },
	stage: {
		sceneId: null,
		cast: [{ actorId: 'node_reel_grid', kind: 'node', target: 'Reel grid', place: {} }],
	} as CinematicDoc['stage'],
	tracks: [
		{
			id: 'prop_grid',
			actorId: 'node_reel_grid',
			kind: 'property',
			channels: {
				y: [
					{ time: 0, value: -600, ease: [0.42, 0, 0.58, 1] },
					{ time: 1, value: 40, ease: 'hold' },
					{ time: 2, value: 0 },
				],
				scale: [
					{ time: 0, value: 0.5, ease: 'linear' },
					{ time: 2, value: 1 },
				],
			},
		},
	] as CinematicDoc['tracks'],
});

/** The editor's hook, as `EditorTimelinePanel`'s `pasteTarget` builds it. */
const editorHost = (doc: () => CinematicDoc, selected: () => string | null) => ({
	pasteTarget(fromActorId: string) {
		const id = selected();
		const target = id ? S.nodeActorTarget(SCENE, id) : null;
		if (!target?.ok) return null;
		const from = doc().stage.cast.find((c) => c.actorId === fromActorId);
		if (!from || from.kind !== 'node' || from.target === target.target) return null;
		return {
			channels: S.keyableChannels(target.node.kind),
			actor: () => S.ensureNodeActor(doc(), target.target),
		};
	},
});

const selectAll = (doc: CinematicDoc) =>
	tracks(doc).flatMap((t) =>
		Object.entries(t.channels ?? {}).flatMap(([channel, keys]) =>
			keys.map((k) => ({ trackId: t.id, channel, time: k.time })),
		),
	);

console.log('1. keys copied from Reel grid paste onto the selected Reel_Background');
{
	const doc = reelIntro();
	let selected: string | null = 'grid';
	const tl = mount(null, {
		doc,
		ev: EV,
		host: editorHost(
			() => tl.doc(),
			() => selected,
		),
	});
	tl.historyReset();
	tl.selectKeys(selectAll(doc));
	tl.copyKeys();
	selected = 'bg';
	tl.setTime(0);
	eq('the paste is handled', tl.pasteKeys(), true);
	const cast = tl.doc().stage.cast.find((c) => c.target === 'Reel_Background');
	eq('Reel_Background became a node actor', cast && { kind: cast.kind, actorId: cast.actorId }, { kind: 'node', actorId: 'node_reel_background' }); // prettier-ignore
	const bg = tracks(tl.doc()).find((t) => t.actorId === 'node_reel_background');
	eq('…with a property track of its own', bg?.kind, 'property');
	eq('y: the same keys, times and eases', bg?.channels?.y, tracks(reelIntro())[0].channels?.y);
	eq('scale: the same keys', bg?.channels?.scale, tracks(reelIntro())[0].channels?.scale);
	eq('Reel grid keeps its own keys', tracks(tl.doc())[0].channels, tracks(reelIntro())[0].channels); // prettier-ignore
	eq('the pasted keys are selected, on the new track', [...new Set(tl.selectedKeys().map((k) => k.trackId))], [bg?.id]); // prettier-ignore
	eq('one undo step takes it all back', (tl.undo(), tracks(tl.doc()).length), 1);

	tl.redo();
	tl.selectKeys([{ trackId: 'prop_grid', channel: 'y', time: 1 }]);
	tl.copyKeys();
	tl.setTime(0.5);
	tl.pasteKeys();
	const again = tracks(tl.doc()).find((t) => t.actorId === 'node_reel_background');
	eq('a second paste times from the playhead, onto the same track', again?.channels?.y.map((k) => [k.time, k.value]), [[0, -600], [0.5, 40], [1, 40], [2, 0]]); // prettier-ignore
	eq('…and creates no second actor', tl.doc().stage.cast.length, 2);
	tl.destroy();
}

console.log('2. the same node, no node or no hook pastes as before');
{
	const run = (host?: ReturnType<typeof editorHost>, select?: () => void): string => {
		const doc = reelIntro();
		const tl = mount(null, { doc, ev: EV, ...(host && { host }) });
		tl.historyReset();
		tl.selectKeys([
			{ trackId: 'prop_grid', channel: 'y', time: 1 },
			{ trackId: 'prop_grid', channel: 'scale', time: 2 },
		]);
		tl.copyKeys();
		select?.();
		tl.setTime(0.5);
		tl.pasteKeys();
		const out = JSON.stringify({ doc: tl.doc(), sel: tl.selectedKeys() });
		tl.destroy();
		return out;
	};
	const before = run();
	let selected: string | null = 'grid';
	const docRef = { current: reelIntro() };
	eq('the copied node selected: byte-identical to no hook', run(editorHost(() => docRef.current, () => selected)), before); // prettier-ignore
	selected = null;
	eq('nothing selected: byte-identical', run(editorHost(() => docRef.current, () => selected)), before); // prettier-ignore
	eq('/rigger (no hook): one actor, one track', JSON.parse(before).doc.tracks.length, 1);
}

console.log('3. the ratio being edited, and fields the target cannot key');
{
	const doc = reelIntro();
	let ratio: string | undefined = undefined;
	let selected: string | null = 'grid';
	const tl = mount(null, {
		doc,
		ev: EV,
		propertyLayout: () => ratio,
		host: editorHost(
			() => tl.doc(),
			() => selected,
		),
	});
	tl.historyReset();
	tl.selectKeys(selectAll(doc));
	tl.copyKeys();
	ratio = 'portrait';
	selected = 'bg';
	tl.setTime(0);
	tl.pasteKeys();
	const bg = tracks(tl.doc()).filter((t) => t.actorId === 'node_reel_background');
	eq('pasted in portrait: one portrait track, no default one', bg.map((t) => t.layout ?? null), ['portrait']); // prettier-ignore
	eq('…carrying the keys', Object.keys(bg[0]?.channels ?? {}), ['y', 'scale']);
	tl.destroy();

	const tinted = reelIntro();
	tinted.stage.cast.push({ actorId: 'node_reel_background', kind: 'node', target: 'Reel_Background', place: {} } as CinematicDoc['stage']['cast'][number]); // prettier-ignore
	tinted.tracks.push({ id: 'prop_bg', actorId: 'node_reel_background', kind: 'property', channels: { tint: [{ time: 0, value: 0xff0000 }], x: [{ time: 0, value: 5 }] } } as CinematicDoc['tracks'][number]); // prettier-ignore
	selected = 'bg';
	const t2 = mount(null, {
		doc: tinted,
		ev: EV,
		host: editorHost(
			() => t2.doc(),
			() => selected,
		),
	});
	t2.historyReset();
	t2.selectKeys([
		{ trackId: 'prop_bg', channel: 'tint', time: 0 },
		{ trackId: 'prop_bg', channel: 'x', time: 0 },
	]);
	t2.copyKeys();
	selected = 'grid';
	t2.setTime(1);
	t2.pasteKeys();
	const grid = tracks(t2.doc()).find((t) => t.id === 'prop_grid');
	eq('the reel grid takes x', grid?.channels?.x, [{ time: 1, value: 5 }]);
	eq('…and skips tint, which it cannot key', grid?.channels?.tint, undefined);
	t2.destroy();
}

console.log('4. the editor panel hands the module its pasteTarget');
{
	const panel = readFileSync(
		new URL('../src/routes/(app)/editor/EditorTimelinePanel.svelte', import.meta.url),
		'utf8',
	);
	eq('the host passes pasteTarget', /\bhost: \{[\s\S]*?\n\t\t\t\tpasteTarget,/.test(panel), true);
	eq(
		'…built on ensureNodeActor and keyableChannels',
		/function pasteTarget[\s\S]*?keyableChannels\(to\.node\.kind\)[\s\S]*?ensureNodeActor\(doc, to\.target\)/.test(
			panel,
		),
		true,
	);
}

if (failures) {
	console.error(`\n${failures} check(s) failed.`);
	process.exit(1);
}
console.log('\nAll node-paste checks passed.');
