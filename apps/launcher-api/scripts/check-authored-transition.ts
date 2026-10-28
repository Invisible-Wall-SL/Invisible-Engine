/**
 * The authored Transition behind a per-project flag (Rive plan Phase 8a, `docs/design/rive-style-editor.md` §13):
 *   pnpm --filter launcher-api check:authored-transition
 *
 *  1. the flag: `settings.authoredOverlays.transition` round-trips through the layout normalizer
 *     ON only (an OFF row, an unknown overlay, a non-boolean are dropped), and reads as the game
 *     reads it;
 *  2. the swap: with the flag on, every reference layout's overlays scene trades its coded
 *     `bind: Transition` for the built-in `transitionWipe` instance, nested or not, carrying the
 *     node's transform and per-layout overrides; a scene without one comes back as the SAME object;
 *     the doc-level swap reaches every scene; the ONE predicate the runtime and the publish chip
 *     share agrees in every case (an overlays scene of the doc's own, the reference fallback, a
 *     Transition in another scene);
 *  3. the built-in def and timeline: in the built-ins list, internal (no palette offers it), the timeline
 *     binds the def's `wipe` rig node with no issue, plays on `transition`, holds the cue, and runs
 *     exactly the `transition` rig's clip (its length read off the shipped skeleton);
 *  4. timing: under a stepped clock the hold a fire opens settles on the frame the clip ends and
 *     not before, through the instance's own seam (`InstanceCueHolds`: open, release on the step's
 *     completed ids, release-all on unmount); a timeline without `holdsCue`, a zero-length one and a
 *     cue nothing holds add no hold; a `showContainer.durationMs` measures the swapped node as the
 *     coded one; the built-in timelines register on a boot with no bundle and no baked doc; the
 *     localization harvest is unchanged by the flag;
 *  5. the publish chips: a project with the flag on shows "Authored Transition (pilot)", one with
 *     the flag on and no coded Transition to replace gets the warning, one with the flag off neither.
 *  6. the `transition` cue's screen transition (Invisible Shader Graph 8e): the one rule
 *     (`transitionCueStatus`: off / screen / unplayable) the game and the chip share; with the row
 *     off or unplayable the resolution returns the same objects as without it (the wipe, coded or
 *     authored); with it on, the authored swap is not made, the coded part is retired and the cue
 *     is subscribed; with no transition runtime bound the game reads the row as off; the game binds
 *     the runtime before the scenes load and unbinds on destroy; the chips.
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
const { authoredOverlayChips } = await import('../src/lib/server/authoredWinTiers.ts');
const S = await import('../../lines/src/game/screenTransitions.ts');
const { basegameOverlaysSceneOf } = await import('../../lines/src/game/sceneSelection.ts');

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
	'an ON row survives the normalizer, alone (an unknown overlay is dropped; the 8b `win` row is kept)',
	[
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: true, outro: true } }), 'demo')
			.settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: true, win: true } }), 'demo')
			.settings,
	],
	[
		{ authoredOverlays: { transition: true } },
		{ authoredOverlays: { transition: true, win: true } },
	],
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
		['t', 'transitionWipe', 7, 1],
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
{
	// The ONE predicate the runtime swap and the publish chip share.
	const lines = layouts.lines;
	eq('the reference doc has a coded Transition', A.docHasCodedTransition(lines), true);
	const without = { ...lines, scenes: lines.scenes.filter((sc) => sc.id !== 'basegameOverlays') };
	eq(
		'a doc with no overlays scene of its own still has one (the reference fallback)',
		A.docHasCodedTransition(without),
		true,
	);
	const bare = {
		...lines,
		scenes: lines.scenes.map((sc) =>
			sc.id === 'basegameOverlays'
				? { ...sc, nodes: sc.nodes.filter((n) => n.bind?.component !== 'Transition') }
				: sc,
		),
	};
	eq(
		'an overlays scene of its own without the node ⇒ nothing to replace',
		A.docHasCodedTransition(bare),
		false,
	);
	const elsewhere = {
		...bare,
		scenes: bare.scenes.map((sc) =>
			sc.id === 'basegame'
				? {
						...sc,
						nodes: [
							...sc.nodes,
							{
								id: 'moved-t',
								kind: 'container',
								x: 0,
								y: 0,
								bind: { component: 'Transition' },
								children: [],
							} as unknown as LayoutNode,
						],
					}
				: sc,
		),
	};
	eq('a Transition in another scene counts', A.docHasCodedTransition(elsewhere), true);
	const swappedDoc = A.withAuthoredTransitionDoc(elsewhere);
	eq(
		'the doc-level swap reaches a Transition in any scene',
		[
			A.hasCodedTransition(swappedDoc.scenes.flatMap((sc) => sc.nodes)),
			transitionNodes(swappedDoc.scenes.find((sc) => sc.id === 'basegame')!.nodes).map(
				(n) => (n as { componentId?: string }).componentId,
			),
		],
		[false, ['transitionWipe']],
	);
	eq(
		'...and leaves every other scene the same object',
		swappedDoc.scenes.filter((sc, i) => sc === elsewhere.scenes[i]).length,
		elsewhere.scenes.length - 1,
	);
	eq(
		'a doc with nothing to swap is the same doc',
		A.withAuthoredTransitionDoc(bare) === bare,
		true,
	);
	const moved: Scene = {
		id: 'm',
		name: 'm',
		nodes: [
			{
				id: 't',
				kind: 'container',
				x: 40,
				y: -20,
				scale: { x: 1.2, y: 1.2 },
				rotation: 5,
				alpha: 0.8,
				bind: { component: 'Transition' },
				children: [],
				overrides: { portrait: { x: 0, y: 300 } },
			},
		] as unknown as LayoutNode[],
	} as unknown as Scene;
	const mv = A.withAuthoredTransition(moved).nodes[0] as LayoutNode & { componentId?: string };
	eq(
		'a moved Transition keeps x / y / scale / rotation / alpha and its per-layout overrides',
		[mv.componentId, mv.x, mv.y, mv.scale, mv.rotation, mv.alpha, mv.overrides],
		['transitionWipe', 40, -20, { x: 1.2, y: 1.2 }, 5, 0.8, { portrait: { x: 0, y: 300 } }],
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
	'it is internal: the engine places it, no palette offers it',
	[def.internal, Object.keys(layouts).some((k) => C.componentOfferedForKind(def, k))],
	[true, false],
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
	// The instance's own seam: a heard fire opens the holds, the ticker's step releases them.
	const seam = new H.InstanceCueHolds((signal) => player.holdsOn(signal));
	seam.open('uiHide');
	eq('a signal no timeline holds opens nothing', H.cueHolds('uiHide'), []);
	seam.open('transition');
	eq('the fire opened one hold on the cue', H.cueHolds('transition').length, 1);
	let frames = 0;
	let settledAt = -1;
	const [until] = H.cueHolds('transition');
	void until.then(() => {
		settledAt = frames;
	});
	player.trigger('transition');
	let completedOn = -1;
	while (completedOn < 0 && frames < 600) {
		frames++;
		const step = player.advance(1 / 60);
		seam.release(step.completed);
		if (step.completed.includes(wipe.id)) completedOn = frames;
	}
	await until;
	await Promise.resolve();
	eq(
		'the hold settles on the frame the clip ends (±1 frame of 1.6667 s at 60 fps)',
		[Math.abs(completedOn - framesToEnd) <= 1, settledAt === completedOn],
		[true, true],
	);
	eq('...and is gone afterwards', H.cueHolds('transition'), []);
	const gone = new H.InstanceCueHolds(() => [wipe.id]);
	gone.open('transition');
	const [pending] = H.cueHolds('transition');
	let released = false;
	void pending.then(() => {
		released = true;
	});
	gone.releaseAll();
	await pending;
	await Promise.resolve();
	eq(
		'release-all on unmount settles a pending hold',
		[released, H.cueHolds('transition')],
		[true, []],
	);
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
{
	const D = await import('../../../packages/engine-layout/src/lib/sceneDuration.ts');
	L.registerComponentTimelines([...B.BUILTIN_TIMELINES]);
	const clipMs = wipe.duration * 1000;
	const coded = overlaysOf(layouts.lines);
	const resolvers = {
		rigClipMs: () => undefined,
		effectMs: () => undefined,
		resolveComponent: (id: string) => (id === def.id ? { root: def.root } : undefined),
		boundComponentMs: (component: string) => (component === 'Transition' ? clipMs : undefined),
		instanceHoldMs: (id: string) => {
			const held = L.componentTimelinesFor(id).filter((d) => d.holdsCue === true);
			return held.length ? Math.max(...held.map((d) => d.duration * 1000)) : undefined;
		},
	};
	eq(
		'durationMs reads the same for the coded and the swapped overlays scene',
		[
			D.sceneAnimationDurationMs(coded, resolvers as never),
			D.sceneAnimationDurationMs(A.withAuthoredTransition(coded), resolvers as never),
		],
		[clipMs, clipMs],
	);
	L.registerComponentTimelines([]);
}
{
	// A boot with no runtime bundle and no baked doc (the layout-only fallback, the dev pilot) still
	// registers the built-in timelines: `registerGameTimelines`, the one call both boot paths of
	// `apps/lines` `registerBakedComponents` make (the source is checked to make it before its early
	// return), with nothing baked.
	L.registerComponentTimelines([]);
	L.registerGameTimelines(undefined);
	eq(
		'registerGameTimelines with nothing baked registers the built-in timelines',
		L.componentTimelinesFor('transitionWipe').map((d) => d.id),
		[wipe.id],
	);
	L.registerGameTimelines([{ ...wipe, name: 'project copy' }]);
	eq(
		'...and a baked timeline of the same id shadows the built-in',
		L.componentTimelinesFor('transitionWipe').map((d) => d.name),
		['project copy'],
	);
	L.registerComponentTimelines([]);
	const boot = readFileSync(new URL('../../lines/src/editor-scenes.ts', import.meta.url), 'utf8');
	const body = boot.slice(boot.indexOf('export function registerBakedComponents'));
	const early = body.indexOf('registerGameTimelines(undefined)');
	eq(
		'the game boot registers the built-ins before its no-bundle early return',
		early > 0 && early < body.indexOf('return;'),
		true,
	);
}
{
	// The server side of the Game Settings row: a save that FLIPS the pilot switch needs the
	// component-publish capability; one that leaves it as stored is anyone's.
	const { authoredOverlayChangeAllowed } =
		await import('../src/lib/server/authoredOverlayGuard.ts');
	const onDoc = { settings: { authoredOverlays: { transition: true } } };
	const offDoc = { settings: {} };
	eq(
		'a non-publisher may save without touching the switch, never flip it; a publisher may flip it',
		[
			authoredOverlayChangeAllowed({ before: offDoc, after: offDoc, canPublish: false }),
			authoredOverlayChangeAllowed({ before: onDoc, after: onDoc, canPublish: false }),
			authoredOverlayChangeAllowed({ before: offDoc, after: onDoc, canPublish: false }),
			authoredOverlayChangeAllowed({ before: onDoc, after: offDoc, canPublish: false }),
			authoredOverlayChangeAllowed({ before: null, after: onDoc, canPublish: false }),
			authoredOverlayChangeAllowed({ before: offDoc, after: onDoc, canPublish: true }),
		],
		[true, true, false, false, false, true],
	);
	const action = readFileSync(
		new URL('../src/routes/(app)/editor/+page.server.ts', import.meta.url),
		'utf8',
	);
	const save = action.slice(action.indexOf('save: async ('));
	// Since 8b the action reaches `authoredOverlayChangeAllowed` through `authoredOverlaySaveDecision`
	// (the ETag check first); `check:authored-win` drives that decision's truth table.
	eq(
		'the editor save action refuses the flip before it writes',
		save.indexOf('authoredOverlaySaveDecision(') > 0 &&
			save.indexOf('authoredOverlaySaveDecision(') < save.indexOf('await saveDoc('),
		true,
	);
}
{
	// One text stack: the flag changes nothing the localization harvest sees.
	const { harvestSceneText } = await import('../src/lib/server/localizationHarvest.ts');
	const resolveDef = async (id: string) => C.BUILTIN_COMPONENTS.find((d) => d.id === id);
	const off = await harvestSceneText(layouts.lines, resolveDef as never);
	const on = await harvestSceneText(
		A.withAuthoredTransitionDoc({
			...layouts.lines,
			settings: { authoredOverlays: { transition: true } },
		}),
		resolveDef as never,
	);
	eq('the harvest is identical with the flag on and off', JSON.stringify(on), JSON.stringify(off));
}

// ---- 5. the publish chips ------------------------------------------------------------------------------

{
	const signals = (layout: { authoredTransition: A.AuthoredTransitionStatus } | null) =>
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
		'ready ⇒ the pilot chip',
		signals({ authoredTransition: 'ready' }).map((c) => [c.id, c.tone]),
		[['authoredTransition', undefined]],
	);
	eq(
		'nothing to replace ⇒ the warning',
		signals({ authoredTransition: 'nothing-to-replace' }).map((c) => [c.id, c.tone]),
		[['authoredTransitionUnbound', 'warn']],
	);
	eq(
		'a Transition outside canvas space ⇒ the held-back warning',
		signals({ authoredTransition: 'non-canvas-scene' }).map((c) => [c.id, c.tone]),
		[['authoredTransitionNonCanvas', 'warn']],
	);
	eq('off, or no doc ⇒ no chip', [signals({ authoredTransition: 'off' }), signals(null)], [[], []]);
}
{
	// The ONE rule the game's flip and the chips read, case by case.
	const lines = layouts.lines;
	const on = (doc: LayoutDoc): LayoutDoc => ({
		...doc,
		settings: { authoredOverlays: { transition: true } },
	});
	const codedNode = {
		id: 'moved-t',
		kind: 'container',
		x: 0,
		y: 0,
		bind: { component: 'Transition' },
		children: [],
	} as unknown as LayoutNode;
	const strip = (doc: LayoutDoc): LayoutDoc => ({
		...doc,
		scenes: doc.scenes.map((sc) =>
			sc.id === 'basegameOverlays'
				? { ...sc, nodes: sc.nodes.filter((n) => n.bind?.component !== 'Transition') }
				: sc,
		),
	});
	const into = (doc: LayoutDoc, sceneId: string): LayoutDoc => ({
		...doc,
		scenes: doc.scenes.map((sc) =>
			sc.id === sceneId ? { ...sc, nodes: [...sc.nodes, codedNode] } : sc,
		),
	});
	const spaceOf = (id: string) => lines.scenes.find((sc) => sc.id === id)?.space ?? 'game';
	eq(
		'the variant scenes have the spaces the cases assume',
		[spaceOf('hudCorners'), spaceOf('hudBar'), spaceOf('basegame')],
		['canvas', 'standard', 'game'],
	);
	eq(
		'off / ready / nothing to replace / non-canvas, from the one rule',
		[
			A.authoredTransitionStatus(lines),
			A.authoredTransitionStatus(on(lines)),
			A.authoredTransitionStatus(
				on({ ...lines, scenes: lines.scenes.filter((sc) => sc.id !== 'basegameOverlays') }),
			),
			A.authoredTransitionStatus(on(strip(lines))),
			A.authoredTransitionStatus(on(into(strip(lines), 'hudCorners'))),
			A.authoredTransitionStatus(on(into(strip(lines), 'hudBar'))),
			A.authoredTransitionStatus(on(into(strip(lines), 'basegame'))),
			A.authoredTransitionStatus(on(into(lines, 'basegame'))),
		],
		[
			'off',
			'ready',
			'ready',
			'nothing-to-replace',
			'ready',
			'non-canvas-scene',
			'non-canvas-scene',
			'non-canvas-scene',
		],
	);
	const anchored: Scene = {
		id: 'a',
		name: 'a',
		space: 'canvas',
		nodes: [
			{
				id: 't',
				kind: 'container',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				screenAnchor: { x: 0.5, y: 0.5 },
				blendMode: 'add',
				bind: { component: 'Transition' },
				children: [],
			},
		] as unknown as LayoutNode[],
	} as unknown as Scene;
	const an = A.withAuthoredTransition(anchored).nodes[0] as LayoutNode & {
		screenAnchor?: unknown;
		blendMode?: unknown;
	};
	eq(
		'the base-level anchor, screenAnchor and blend mode carry across the swap',
		[an.anchor, an.screenAnchor, an.blendMode],
		[{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 'add'],
	);
	// Both flow interpreters are built from the SWAPPED doc: `Game.svelte` swaps once, into `doc`,
	// and hands that `doc` to `createLinesFlowV2` and `createLinesFlow` (the parity gate's
	// flow-container variant proves the render; this pins the wiring).
	const game = readFileSync(
		new URL('../../lines/src/components/Game.svelte', import.meta.url),
		'utf8',
	);
	const load = game.slice(game.indexOf('void loadEditorScenes().then('));
	const swapAt = load.indexOf('resolveAuthoredOverlays(rawDoc, {');
	const v2At = load.indexOf('createLinesFlowV2(\n\t\t\t\tdoc,');
	const v1At = load.indexOf('createLinesFlow(\n\t\t\t\t\t\tdoc,');
	eq(
		'the game swaps once and builds both flow interpreters from the swapped doc',
		[swapAt > 0, v2At > swapAt, v1At > swapAt, /createLinesFlow(V2)?\(\s*rawDoc/.test(load)],
		[true, true, true, false],
	);
}

// ---- 6. the transition cue's screen transition ---------------------------------------------------

{
	const lines = layouts.lines;
	const withSettings = (doc: LayoutDoc, settings: unknown): LayoutDoc =>
		({ ...doc, settings }) as LayoutDoc;
	const builtin = { kind: 'dissolveOut', durationMs: 900 };
	const custom = { kind: 'custom:swirl' };
	const none = () => false;
	const swirl = (kind: string) => kind === 'custom:swirl';
	eq(
		'off / screen / unplayable, from the one rule',
		[
			A.transitionCueStatus(lines, swirl),
			A.transitionCueStatus(withSettings(lines, { transitionCue: builtin }), none),
			A.transitionCueStatus(withSettings(lines, { transitionCue: custom }), swirl),
			A.transitionCueStatus(withSettings(lines, { transitionCue: custom }), none),
			A.transitionCueStatus(withSettings(lines, { transitionCue: { kind: 'shake' } }), swirl),
			A.transitionCueStatus(withSettings(lines, { transitionCue: { kind: 'custom:' } }), swirl),
		],
		['off', 'screen', 'screen', 'unplayable', 'off', 'off'],
	);
	const win = { status: () => 'off' as const };
	const resolve = (doc: LayoutDoc, transitionCue?: A.TransitionCueStatus) =>
		A.resolveAuthoredOverlays(doc, transitionCue ? { ...win, transitionCue } : win);
	const flagOn = withSettings(lines, { authoredOverlays: { transition: true } });
	for (const [label, doc] of [
		['the flag off', lines],
		['the flag on', flagOn],
	] as const) {
		const today = resolve(doc);
		for (const status of ['off', 'unplayable'] as const) {
			const row = resolve(doc, status);
			eq(
				`${label}, the row ${status}: the same objects as without it`,
				[
					row.doc === today.doc ||
						JSON.stringify(row.doc) === JSON.stringify(today.doc) ||
						'different',
					row.doc.scenes.every((scene, i) => scene === today.doc.scenes[i]) ||
						JSON.stringify(row.doc.scenes) === JSON.stringify(today.doc.scenes),
					row.transition,
					row.transitionCue,
				],
				[true, true, today.transition, status],
			);
		}
	}
	eq(
		'the flag off, the row off: the raw doc itself',
		[resolve(lines).doc === lines, resolve(lines, 'off').doc === lines],
		[true, true],
	);
	const onScreen = resolve(flagOn, 'screen');
	eq(
		'the flag on, the row screen: the authored swap is not made (the coded node stays, retired)',
		[
			onScreen.doc === flagOn,
			onScreen.transition,
			A.authoredTransitionSwapped(onScreen.transition, onScreen.transitionCue),
			transitionNodes(overlaysOf(onScreen.doc).nodes).map((n) => n.bind?.component ?? 'authored'),
		],
		[true, 'ready', false, ['Transition']],
	);
	eq(
		'…where the flag on alone swaps it',
		transitionNodes(overlaysOf(resolve(flagOn, 'off').doc).nodes).map(
			(n) => n.bind?.component ?? 'authored',
		),
		['authored'],
	);
	const bare = withSettings(
		{ ...lines, scenes: lines.scenes.filter((sc) => sc.id !== 'basegameOverlays') },
		{ authoredOverlays: { transition: true } },
	);
	const fallbackOverlays = overlaysOf(lines);
	eq(
		'the reference overlays a doc without its own gets: swapped under the flag, not under the row',
		[
			basegameOverlaysSceneOf(bare, lines, false, 'screen') === fallbackOverlays,
			basegameOverlaysSceneOf(bare, lines, false, 'unplayable') === fallbackOverlays,
			basegameOverlaysSceneOf(bare, lines, false) === fallbackOverlays,
		],
		[true, false, false],
	);

	// The game: no transition runtime bound ⇒ the row reads as off (the wipe, as before 8e); bound ⇒
	// the rule's verdict. On `screen` alone the cue is subscribed.
	eq(
		'no runtime bound ⇒ off, whatever the rule says',
		[S.bootTransitionCueStatus(() => 'screen'), S.bootTransitionCueStatus(() => 'unplayable')],
		['off', 'off'],
	);
	let played = 0;
	S.bindScreenTransitions({
		play: () => {
			played++;
			return { captured: Promise.resolve(), done: Promise.resolve() };
		},
		wait: () => Promise.resolve(),
	});
	eq(
		'a runtime bound ⇒ the rule’s verdict',
		[
			S.bootTransitionCueStatus(() => 'screen'),
			S.bootTransitionCueStatus(() => 'unplayable'),
			S.bootTransitionCueStatus(() => 'off'),
		],
		['screen', 'unplayable', 'off'],
	);
	const subscribed: string[] = [];
	for (const status of ['off', 'unplayable', 'screen'] as const) {
		const stop = S.subscribeTransitionCue(
			status,
			A.readTransitionCue({ settings: { transitionCue: builtin } }),
			(handler) => {
				subscribed.push(status);
				void handler();
				return () => subscribed.push(`${status}:stopped`);
			},
		);
		stop();
	}
	await Promise.resolve();
	eq(
		'the cue is subscribed (and played) on screen alone, and unsubscribed on stop',
		[subscribed, played],
		[['screen', 'screen:stopped'], 1],
	);
	S.bindScreenTransitions(null);

	const game = readFileSync(
		new URL('../../lines/src/components/Game.svelte', import.meta.url),
		'utf8',
	);
	const load = game.slice(game.indexOf('void loadEditorScenes().then('));
	eq(
		'the game reads the rule before the swap, hands it to the resolution and retires on it',
		[
			load.indexOf('bootTransitionCueStatus(() =>') > 0 &&
				load.indexOf('bootTransitionCueStatus(() =>') <
					load.indexOf('resolveAuthoredOverlays(rawDoc, {'),
			load.includes('transitionCueStatus(rawDoc, isPlayableElementFxKind)'),
			load.includes('transitionCue: cueStatus,'),
			load.includes("retireCodedOverlay('transition', authored || screenCue);"),
			load.indexOf('subscribeTransitionCue(cueStatus, readTransitionCue(rawDoc)') > 0,
			game.includes(
				'basegameOverlaysSceneOf(editorDoc, fallbackEditorScenes, authoredWinRuntime.on, transitionCue)',
			),
		],
		[true, true, true, true, true, true],
	);

	// Phase B: the game binds the runtime at setup, before the scenes load (the rule is read once
	// there), and unbinds on destroy; the binding puts the still on its band, on the turbo clock.
	const bindAt = game.indexOf(
		'onDestroy(bindScreenTransitions(screenTransitionsOn(() => stateApp.pixiApplication)));',
	);
	const binding = readFileSync(
		new URL('../../lines/src/game/screenTransitionsBinding.ts', import.meta.url),
		'utf8',
	);
	eq(
		'the game binds the transition runtime before the scenes load, and unbinds on destroy',
		[
			bindAt > 0 && bindAt < game.indexOf('void loadEditorScenes().then('),
			binding.includes('{ ...transition, zIndex: LAYER_BAND_SCREEN_TRANSITION }'),
			binding.includes('elementFxHostFor(stage, particleTimeScale)'),
			binding.includes('return { captured: handle.captured, done: handle.done };'),
			binding.includes('wait: () => waitForScreenTransition(app()),'),
		],
		[true, true, true, true, true],
	);
	const first = {
		play: () => ({ captured: Promise.resolve(), done: Promise.resolve() }),
		wait: () => Promise.resolve(),
	};
	const unbindFirst = S.bindScreenTransitions(first);
	const unbindSecond = S.bindScreenTransitions({ ...first });
	unbindFirst();
	const afterStaleUnbind = S.bootTransitionCueStatus(() => 'screen');
	unbindSecond();
	eq(
		'a stale unbind (a Game destroyed after the next bound) leaves the later binding in place',
		[afterStaleUnbind, S.bootTransitionCueStatus(() => 'screen')],
		['screen', 'off'],
	);

	// The chips: the same rule, against the project's compiled kinds.
	const cueChips = (layout: {
		authoredTransition: A.AuthoredTransitionStatus;
		transitionCue?: A.TransitionCueStatus;
	}) =>
		buildGameProfile({
			gameTypeId: 'lines',
			gameTypeName: 'Lines',
			config: null,
			configSource: 'template' as never,
			symbols: { symbols: {} } as never,
			runtimeId: 'lines',
			protocol: 'lines',
			layout,
		})
			.features.filter((c) => c.id.startsWith('transitionCue'))
			.map((c) => [c.id, c.tone]);
	eq(
		'screen ⇒ the fact chip, unplayable ⇒ the warning, off or absent ⇒ none',
		[
			cueChips({ authoredTransition: 'off', transitionCue: 'screen' }),
			cueChips({ authoredTransition: 'ready', transitionCue: 'unplayable' }),
			cueChips({ authoredTransition: 'off', transitionCue: 'off' }),
			cueChips({ authoredTransition: 'off' }),
		],
		[[['transitionCue', undefined]], [['transitionCueUnplayable', 'warn']], [], []],
	);
	const cueDoc = withSettings(lines, {
		authoredOverlays: { transition: true },
		transitionCue: custom,
	});
	eq(
		'the Game Maker chips judge the row by the compiled kinds, the Transition row unchanged',
		[
			authoredOverlayChips(cueDoc, null, undefined),
			authoredOverlayChips(cueDoc, null, undefined, swirl),
		].map((c) => [c.transitionCue, c.authoredTransition]),
		[
			['unplayable', 'ready'],
			['screen', 'ready'],
		],
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} authored transition: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
