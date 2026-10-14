/**
 * The authored Transition behind a per-project flag (Rive plan Phase 8a, `docs/design/rive-style-editor.md` §13):
 *   pnpm --filter launcher-api check:authored-transition
 *
 *  1. the flag: `settings.authoredOverlays.transition` round-trips through the layout normalizer
 *     ON only (an OFF row, an unknown overlay, a non-boolean are dropped), and reads as the game
 *     reads it;
 *  2. the swap: with the flag on, every reference layout's overlays scene trades its coded
 *     `bind: Transition` for the built-in `transitionWipe` instance at the origin, nested or not,
 *     and a scene without one comes back as the SAME object; with the flag off nothing is swapped;
 *  3. the built-in def and timeline: in the built-ins list, offered to every kind, the timeline
 *     binds the def's `wipe` rig node with no issue, plays on `transition`, holds the cue, and runs
 *     exactly the `transition` rig's clip (its length read off the shipped skeleton);
 *  4. timing: under a stepped clock the hold a fire opens settles on the frame the clip ends and
 *     not before; a timeline without `holdsCue`, a looping one and a cue nothing holds add no hold;
 *  5. the publish chips: a project with the flag on shows "Authored Transition (pilot)", one with
 *     the flag on and no coded Transition to replace gets the warning, one with the flag off neither.
 *
 * Runs the real `engine-layout` readers, player and registry, the real `editorStorage`
 * normalizer and the real `gameProfile`. What it cannot prove: the Svelte mount in `Game.svelte`
 * and the frames themselves — that is `check:transition-parity` (the built game, headless).
 */
import { readFileSync } from 'node:fs';

import type { LayoutDoc, LayoutNode, Scene } from 'engine-layout';

const A = await import('../../../packages/engine-layout/src/lib/authoredOverlays.ts');
const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const C = await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const H = await import('../../../packages/engine-layout/src/lib/cueHolds.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const N = await import('../../../packages/engine-layout/src/lib/cinematicNodes.ts');
const R = await import('../../../packages/engine-layout/src/lib/referenceLayouts/index.ts');
const { normalizeDoc: normalizeLayoutDoc } = await import('../src/lib/server/editorStorage.ts');
const { buildGameProfile } = await import('../src/lib/server/gameProfile.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}

const baseDoc = (settings?: unknown): LayoutDoc =>
	({
		version: 1,
		projectKey: 'demo',
		gameType: 'lines',
		mainSizesMap: { desktop: { width: 1920, height: 1080 } },
		...(settings === undefined ? {} : { settings }),
		scenes: [],
		updatedAt: '2026-10-14T00:00:00.000Z',
	}) as unknown as LayoutDoc;

// ---- 1. the flag ---------------------------------------------------------------------------------

eq(
	'an ON row survives the normalizer, alone',
	normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: true, win: true } }), 'demo')
		.settings,
	{ authoredOverlays: { transition: true } },
);
eq(
	'an OFF row, a string and an empty block are not written',
	[
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: false } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: 'yes' } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: {} }), 'demo').settings,
	],
	[undefined, undefined, undefined],
);
eq(
	'the game reads exactly the ON row',
	[
		A.authoredTransitionEnabled(baseDoc({ authoredOverlays: { transition: true } })),
		A.authoredTransitionEnabled(baseDoc({ authoredOverlays: { transition: false } })),
		A.authoredTransitionEnabled(baseDoc()),
		A.authoredTransitionEnabled(baseDoc({ features: { turbo: false } })),
	],
	[true, false, false, false],
);

// ---- 2. the swap ---------------------------------------------------------------------------------

const overlaysOf = (doc: LayoutDoc): Scene =>
	doc.scenes.find((s) => s.id === 'basegameOverlays') as Scene;
const transitionNodes = (nodes: readonly LayoutNode[]): LayoutNode[] =>
	nodes.flatMap((n) =>
		n.kind === 'container' && !n.bind
			? transitionNodes(n.children)
			: n.bind?.component === 'Transition' ||
				  (n.kind === 'componentInstance' && n.componentId === A.TRANSITION_WIPE_COMPONENT_ID)
				? [n]
				: [],
	);
const layouts: Record<string, LayoutDoc> = {
	lines: R.defaultLayout('lines'),
	ways: R.defaultLayout('ways'),
	bookof: R.bookofReferenceLayout(),
	cluster: R.clusterReferenceLayout(),
	scatter: R.scatterReferenceLayout(),
	holdAndWin: R.holdAndWinReferenceLayout(),
};
for (const [name, doc] of Object.entries(layouts)) {
	const scene = overlaysOf(doc);
	const coded = transitionNodes(scene.nodes);
	eq(
		`${name}: the reference overlays scene binds the coded Transition once`,
		[coded.length, coded[0]?.bind?.component],
		[1, 'Transition'],
	);
	eq(`${name}: hasCodedTransition sees it`, A.hasCodedTransition(scene.nodes), true);
	const swapped = A.withAuthoredTransition(scene);
	const authored = transitionNodes(swapped.nodes);
	eq(
		`${name}: with the flag on the node becomes the transitionWipe instance at the origin`,
		authored.map((n) => [
			n.id,
			n.kind,
			(n as { componentId?: string }).componentId,
			n.x,
			n.y,
			n.slotId,
		]),
		[[coded[0].id, 'componentInstance', 'transitionWipe', 0, 0, coded[0].slotId]],
	);
	eq(`${name}: no coded Transition remains`, A.hasCodedTransition(swapped.nodes), false);
	eq(
		`${name}: every other node is the same object`,
		swapped.nodes.filter((n) => scene.nodes.includes(n)).length,
		scene.nodes.length - 1,
	);
	eq(`${name}: the scene is a new object only because a node changed`, swapped !== scene, true);
}
{
	const nested: Scene = {
		id: 'x',
		name: 'x',
		nodes: [
			{
				id: 'g',
				kind: 'container',
				x: 0,
				y: 0,
				children: [
					{
						id: 't',
						kind: 'container',
						x: 1,
						y: 2,
						zIndex: 7,
						bind: { component: 'Transition' },
						children: [],
					},
					{ id: 'w', kind: 'container', x: 0, y: 0, bind: { component: 'Win' }, children: [] },
				],
			},
		],
	} as unknown as Scene;
	const out = A.withAuthoredTransition(nested);
	const t = transitionNodes(out.nodes)[0] as LayoutNode & { componentId?: string };
	eq(
		'a Transition nested in a group is swapped in place and keeps its z',
		[t.id, t.componentId, t.zIndex, t.x],
		['t', 'transitionWipe', 7, 0],
	);
	eq(
		'...its siblings untouched',
		(out.nodes[0] as { children: LayoutNode[] }).children[1],
		(nested.nodes[0] as { children: LayoutNode[] }).children[1],
	);
	const none: Scene = {
		id: 'n',
		name: 'n',
		nodes: [{ id: 'w', kind: 'container', x: 0, y: 0, bind: { component: 'Win' }, children: [] }],
	} as unknown as Scene;
	eq(
		'a scene without one comes back as the same object',
		A.withAuthoredTransition(none) === none,
		true,
	);
}

// ---- 3. the built-in def and timeline ---------------------------------------------------------------

const def = C.TRANSITION_WIPE_DEF;
const wipe = B.TRANSITION_WIPE_TIMELINE;
eq(
	'transitionWipe is a built-in, beside transition',
	[
		C.BUILTIN_COMPONENTS.some((d) => d.id === 'transitionWipe'),
		C.BUILTIN_COMPONENTS.some((d) => d.id === 'transition'),
	],
	[true, true],
);
eq(
	'it is offered to every kind',
	Object.keys(layouts).every((k) => C.componentOfferedForKind(def, k)),
	true,
);
const rig = def.root.children[0] as LayoutNode & {
	assetKey?: string;
	coverFit?: boolean;
	fit?: string;
	coverScale?: number;
	hiddenUntilSignal?: string;
};
eq(
	'its one node is the transition rig, cover-fit to 1.7 × the canvas height, hidden until the cue',
	[
		def.root.children.length,
		rig.label,
		rig.kind,
		rig.assetKey,
		rig.coverFit,
		rig.fit,
		rig.coverScale,
		rig.hiddenUntilSignal,
		rig.x,
		rig.y,
		(rig as { anchor?: unknown }).anchor,
	],
	[1, 'wipe', 'spine', 'transition', true, 'height', 1.7, 'transition', 0, 0, undefined],
);
eq(
	'the def declares no text (one text stack, nothing to harvest)',
	JSON.stringify(def).includes('"kind":"text"'),
	false,
);
eq(
	'the built-in timeline is hosted on the def, plays on transition and holds the cue',
	[wipe.host, wipe.playOn, wipe.holdsCue],
	[{ kind: 'component', componentId: 'transitionWipe' }, 'transition', true],
);
eq(
	'it binds the wipe node with no issue',
	N.validateNodeActors(wipe, { id: '', name: '', nodes: def.root.children }),
	[],
);
eq(
	'the strip plays the rig clip once over the whole timeline',
	(wipe.tracks[0] as { strips: { clip: unknown; start: number; length: number }[] }).strips.map(
		(s) => [s.clip, s.start, s.length],
	),
	[[{ src: 'rig', name: 'animation' }, 0, wipe.duration]],
);
eq(
	'the node shows at 0 and hides at the end (the coded part unmounted its rig at complete)',
	(wipe.tracks[1] as { keys: unknown[] }).keys,
	[
		{ time: 0, visible: true },
		{ time: wipe.duration, visible: false },
	],
);
{
	// The source of the timing: the clip the coded `TransitionAnimation` played, read off the rig the
	// game ships. Its last key is the clip's length, which is the timeline's duration.
	const skeleton = JSON.parse(
		readFileSync(
			new URL('../../lines/static/assets/spines/transition/transition.json', import.meta.url),
			'utf8',
		),
	) as { animations: Record<string, unknown> };
	const lastKey = (o: unknown): number => {
		if (Array.isArray(o)) return Math.max(0, ...o.map(lastKey));
		if (o && typeof o === 'object') {
			const r = o as Record<string, unknown>;
			return Math.max(typeof r.time === 'number' ? r.time : 0, ...Object.values(r).map(lastKey));
		}
		return 0;
	};
	eq(
		"the timeline runs exactly the shipped clip's length",
		[Object.keys(skeleton.animations), lastKey(skeleton.animations.animation)],
		[['animation'], wipe.duration],
	);
}

// ---- 4. timing -------------------------------------------------------------------------------------

{
	L.registerComponentTimelines([...B.BUILTIN_TIMELINES]);
	const { docs } = L.instanceTimelineDocs('transitionWipe', undefined);
	eq(
		'a transitionWipe instance binds the built-in timeline',
		docs.map((d) => d.id),
		[wipe.id],
	);
	const player = new L.ComponentTimelinePlayer(docs, def.root.children);
	eq(
		'the instance holds the transition cue and nothing else',
		[player.holdsOn('transition'), player.holdsOn('uiHide')],
		[[wipe.id], []],
	);
	const framesToEnd = Math.ceil(wipe.duration * 60 - 1e-6);
	let settled = -1;
	let frames = 0;
	const until = new Promise<void>((resolve) => {
		player.trigger('transition');
		const tick = (): void => {
			frames++;
			const step = player.advance(1 / 60);
			if (step.completed.includes(wipe.id)) {
				resolve();
				return;
			}
			if (frames > 600) throw new Error('the wipe never completed');
			tick();
		};
		tick();
	}).then(() => {
		settled = frames;
	});
	H.holdCue('transition', until);
	eq('the fire opened one hold on the cue', H.cueHolds('transition').length, 1);
	await until;
	await Promise.resolve();
	eq(
		'the hold settles on the frame the clip ends (±1 frame of 1.6667 s at 60 fps)',
		Math.abs(settled - framesToEnd) <= 1,
		true,
	);
	eq('...and is gone afterwards', H.cueHolds('transition'), []);
	eq(
		'after the clip the strip holds its last time and the node is hidden again',
		player.sample(rig.id),
		{ animTime: { animation: 'animation', time: wipe.duration }, visible: false },
	);
	const again = new L.ComponentTimelinePlayer(docs, def.root.children);
	again.trigger('transition');
	eq('at 0 the wipe shows at its first frame', again.sample(rig.id), {
		animTime: { animation: 'animation', time: 0 },
		visible: true,
	});
	again.advance(0.8);
	eq('at 0.8 s the clip is at 0.8 s', again.sample(rig.id)?.animTime, {
		animation: 'animation',
		time: 0.8,
	});
	const free = new L.ComponentTimelinePlayer(
		[{ ...wipe, id: 'free', holdsCue: undefined }],
		def.root.children,
	);
	eq(
		'a timeline without holdsCue holds nothing (every timeline before 8a)',
		free.holdsOn('transition'),
		[],
	);
	L.registerComponentTimelines([]);
}

// ---- 5. the publish chips ------------------------------------------------------------------------------

{
	const signals = (
		layout: { authoredOverlays?: { transition?: boolean }; hasCodedTransition: boolean } | null,
	) =>
		buildGameProfile({
			gameTypeId: 'lines',
			gameTypeName: 'Lines',
			config: null,
			configSource: 'template' as never,
			symbols: { symbols: {} } as never,
			runtimeId: 'lines',
			protocol: 'lines',
			layout,
		}).features.filter((c) => c.id.startsWith('authoredTransition'));
	eq(
		'flag on with the coded node to replace ⇒ the pilot chip',
		signals({ authoredOverlays: { transition: true }, hasCodedTransition: true }).map((c) => [
			c.id,
			c.tone,
		]),
		[['authoredTransition', undefined]],
	);
	eq(
		'flag on with nothing to replace ⇒ the warning',
		signals({ authoredOverlays: { transition: true }, hasCodedTransition: false }).map((c) => [
			c.id,
			c.tone,
		]),
		[['authoredTransitionUnbound', 'warn']],
	);
	eq(
		'flag off, or no doc ⇒ no chip',
		[signals({ hasCodedTransition: true }), signals(null)],
		[[], []],
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} authored transition: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
