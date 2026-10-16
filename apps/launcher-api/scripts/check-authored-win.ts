/**
 * The authored Win behind a per-project flag (Rive plan Phase 8b, `docs/design/rive-style-editor.md` §13.6):
 *   pnpm --filter launcher-api check:authored-win
 *
 *  1. the flag: `settings.authoredOverlays.win` round-trips through the layout normalizer ON only,
 *     beside the 8a `transition` row (`{ transition, win }` keeps both; an OFF row, a non-boolean
 *     and an unknown overlay are dropped), and reads as the game reads it;
 *  2. the swap: as the game composes it (the shared status rule, then `withAuthoredWinDoc`), every
 *     reference layout with the flag off is the SAME doc object; with it on every `bind: Win`
 *     becomes its `bind: WinGate` half, a placed `win` instance (nested, moved, with per-layout
 *     overrides and params) becomes a `winPresentation` instance carrying them, and the `winVisual`
 *     scene is synthesized only when none is placed — at the main box's centre per layout type, the
 *     point the split's reference scene places its instance at;
 *  3. the ONE rule the game's flip and the publish chips share, case by case (off / ready /
 *     nothing-to-replace / caption-variable / tier-presentation-unsupported), the launcher's tier
 *     builder (the config's ladder or the coded one, the placed `win` instance's params, the Win
 *     Text captions) feeding it, and the chips agreeing with it in every case;
 *  4. the built-in def and the generated timelines: internal, offered to no kind, every generated
 *     timeline binds only the def's nodes; generation is deterministic; ids are lower-case and a
 *     baked project doc shadows one; the walks hold, the loop never, the outro only with an exit;
 *     the strips name the clips the shipped `bigwin` skeleton carries;
 *  5. timing: under a stepped clock a `winTier.big` fire holds through `InstanceCueHolds` until the
 *     walk's end, `winTierLoop.*` holds nothing, an unmount releases; `awaitFireHolds` resolves on a
 *     synchronous hold, a hold registered a frame late, and with no instance at all; the conductor
 *     replays the escalation fixtures; the play rate rule; `instanceHoldMs` measures the Transition
 *     twin and not the win presentation (symmetric with `boundComponentMs`);
 *  6. the wiring, by source: the game swaps before both flow interpreters are built, the retired
 *     `WinVisual` renders and publishes nothing, `resolveWinMount` is byte-identical to `main`,
 *     the dev pilot is off and there is no URL opt-in; the localization harvest is unchanged by
 *     the flag; the editor save action's decision (the ETag check first, then the flip).
 *
 * Runs the real `engine-layout` / `engine-game` readers, player and registry, the real
 * `editorStorage` normalizer, the real `gameProfile`, tier builder and guard. What it cannot
 * prove: the Svelte mounts and the frames themselves — that is `check:win-parity`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { CinematicDoc, LayoutDoc, LayoutNode, Scene } from 'engine-layout';

const A = await import('../../../packages/engine-layout/src/lib/authoredOverlays.ts');
const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const C = await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const H = await import('../../../packages/engine-layout/src/lib/cueHolds.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const N = await import('../../../packages/engine-layout/src/lib/cinematicNodes.ts');
const P = await import('../../../packages/engine-layout/src/lib/componentPlayRate.ts');
const R = await import('../../../packages/engine-layout/src/lib/referenceLayouts/index.ts');
const D = await import('../../../packages/engine-layout/src/lib/sceneDuration.ts');
const W = await import('../../../packages/engine-game/src/game/winWalk.ts');
const { normalizeDoc: normalizeLayoutDoc } = await import('../src/lib/server/editorStorage.ts');
const { buildGameProfile } = await import('../src/lib/server/gameProfile.ts');
const { authoredWinTiersFor, winPresentationParamsOf } =
	await import('../src/lib/server/authoredWinTiers.ts');
const G = await import('../src/lib/server/authoredOverlayGuard.ts');

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

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const byLabelDeep = (nodes: readonly LayoutNode[], label: string): LayoutNode | undefined => {
	for (const node of nodes) {
		if (node.label === label) return node;
		if (node.kind === 'container') {
			const hit = byLabelDeep(node.children, label);
			if (hit) return hit;
		}
	}
	return undefined;
};

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

// The default tiers as the launcher's builder reads them for an un-authored project.
const CODED_TIERS = authoredWinTiersFor({
	config: null,
	layout: { scenes: [] },
	winText: undefined,
});

// ---- 1. the flag ---------------------------------------------------------------------------------

eq(
	'an ON win row survives the normalizer, alone and beside the transition row',
	[
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { win: true } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: true, win: true } }), 'demo')
			.settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: false, win: true } }), 'demo')
			.settings,
	],
	[
		{ authoredOverlays: { win: true } },
		{ authoredOverlays: { transition: true, win: true } },
		{ authoredOverlays: { win: true } },
	],
);
eq(
	'an OFF row, a non-boolean, an unknown overlay and an empty block are not written',
	[
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { win: false } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { win: 'yes' } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { outro: true } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { transition: true, win: false } }), 'demo')
			.settings,
	],
	[undefined, undefined, undefined, { authoredOverlays: { transition: true } }],
);
eq(
	'the game reads exactly the ON row',
	[
		A.authoredWinEnabled(baseDoc({ authoredOverlays: { win: true } })),
		A.authoredWinEnabled(baseDoc({ authoredOverlays: { win: false } })),
		A.authoredWinEnabled(baseDoc({ authoredOverlays: { transition: true } })),
		A.authoredWinEnabled(baseDoc()),
	],
	[true, false, false, false],
);

// ---- 2. the swap ---------------------------------------------------------------------------------

type Inst = LayoutNode & { componentId?: string; componentVersion?: number; params?: unknown };
const on = (doc: LayoutDoc): LayoutDoc => ({
	...doc,
	settings: { ...(doc.settings ?? {}), authoredOverlays: { win: true } },
});
/** The game's composition (`Game.svelte`): the shared rule, then the swap only when `ready`. */
const asGame = (doc: LayoutDoc, tiers = CODED_TIERS): LayoutDoc =>
	A.authoredWinStatus({ doc, tiers }) === 'ready'
		? A.withAuthoredWinDoc(
				doc,
				tiers[0] ? { winSpine: tiers[0].rigKey, slotName: tiers[0].slotName } : undefined,
			)
		: doc;
const winBinds = (nodes: readonly LayoutNode[], component: string): LayoutNode[] =>
	nodes.flatMap((n) =>
		n.kind === 'container' && n.bind?.component === component
			? [n]
			: n.kind === 'container'
				? winBinds(n.children, component)
				: [],
	);
const instances = (nodes: readonly LayoutNode[], componentId: string): Inst[] =>
	nodes.flatMap((n) =>
		n.kind === 'componentInstance' && (n as Inst).componentId === componentId
			? [n as Inst]
			: n.kind === 'container'
				? instances(n.children, componentId)
				: [],
	);
const allNodes = (doc: Pick<LayoutDoc, 'scenes'>): LayoutNode[] =>
	doc.scenes.flatMap((sc) => sc.nodes);
const layouts: Record<string, LayoutDoc> = {
	lines: R.defaultLayout('lines'),
	ways: R.defaultLayout('ways'),
	bookof: R.bookofReferenceLayout(),
	cluster: R.clusterReferenceLayout(),
	scatter: R.scatterReferenceLayout(),
	holdAndWin: R.holdAndWinReferenceLayout(),
};
for (const [name, doc] of Object.entries(layouts)) {
	eq(`${name}: with the flag off the game renders the SAME doc object`, asGame(doc) === doc, true);
	const coded = winBinds(allNodes(doc), 'Win');
	eq(
		`${name}: the reference layout binds the coded Win composer once, in the overlays scene`,
		[
			coded.length,
			doc.scenes.find((sc) => sc.nodes.includes(coded[0]))?.id,
			instances(allNodes(doc), 'win').length,
		],
		[1, A.OVERLAYS_SCENE_ID, 0],
	);
	const swapped = asGame(on(doc));
	const gate = winBinds(allNodes(swapped), 'WinGate');
	eq(
		`${name}: with the flag on the composer becomes its gate half in place, same id / slot / point`,
		[
			winBinds(allNodes(swapped), 'Win').length,
			gate.map((n) => [n.id, n.slotId, n.x, n.y]),
			A.hasCodedWinGate(allNodes(swapped)),
		],
		[0, [[coded[0].id, coded[0].slotId, coded[0].x, coded[0].y]], true],
	);
	const visual = swapped.scenes.find((sc) => sc.id === A.WIN_VISUAL_SCENE_ID);
	const placed = visual ? (visual.nodes[0] as Inst) : undefined;
	const centre = (t: string) => {
		const size = doc.mainSizesMap[t as keyof typeof doc.mainSizesMap];
		return { x: size.width * 0.5, y: size.height * 0.5 };
	};
	const others = Object.keys(doc.mainSizesMap).filter((t) => t !== 'desktop');
	eq(
		`${name}: the winVisual scene is synthesized game-space with one winPresentation at the main box centre per layout type`,
		[
			swapped.scenes.length - doc.scenes.length,
			visual?.space,
			visual?.nodes.length,
			placed?.kind,
			placed?.componentId,
			[placed?.x, placed?.y],
			others.map((t) => placed?.overrides?.[t]),
			placed?.params,
		],
		[
			1,
			'game',
			1,
			'componentInstance',
			B.WIN_PRESENTATION_COMPONENT_ID,
			[centre('desktop').x, centre('desktop').y],
			others.map(centre),
			{ winSpine: 'bigwin', slotName: 'slot_win_count', fitBoard: true },
		],
	);
	eq(
		`${name}: every scene without a Win is the same object`,
		swapped.scenes.filter((sc) => doc.scenes.includes(sc)).length,
		doc.scenes.length - 1,
	);
}
{
	// The split's own reference scene (`winInstance`) is the shape the synthesized scene reproduces.
	const split = R.defaultLayout('lines', { winInstance: true });
	const ref = split.scenes.find((sc) => sc.id === A.WIN_VISUAL_SCENE_ID)!.nodes[0] as Inst;
	const synth = A.authoredWinVisualScene(split.mainSizesMap).nodes[0] as Inst;
	// The split places its instance at the frame's 1.01-adjusted centre; the synthesized one sits at
	// `boardLayout()`'s point, the main box centre the coded OFF composer self-centred on.
	eq(
		"the synthesized instance carries the split reference's slot and params plus the board fit, at the main box centre (within the frame's 1 %)",
		[
			synth.slotId,
			synth.params,
			Math.abs(synth.x - ref.x) <= split.mainSizesMap.desktop.width * 0.011,
			Math.abs(synth.y - ref.y) <= split.mainSizesMap.desktop.height * 0.011,
		],
		[ref.slotId, { ...ref.params, fitBoard: true }, true, true],
	);
	// A doc that PLACES the hybrid twin (Borut's shape): nested, moved, per-layout overrides, params,
	// a pinned version.
	const placedDoc = on({
		...layouts.lines,
		scenes: [
			...layouts.lines.scenes,
			{
				id: 'celebration',
				name: 'celebration',
				space: 'game',
				nodes: [
					{
						id: 'g',
						kind: 'container',
						x: 10,
						y: 20,
						children: [
							{
								id: 'w',
								kind: 'componentInstance',
								componentId: 'win',
								componentVersion: 3,
								x: 700,
								y: 300,
								scale: { x: 0.8, y: 0.8 },
								rotation: 2,
								alpha: 0.9,
								zIndex: 4,
								overrides: { portrait: { x: 540, y: 900, params: { showCoins: false } } },
								params: { winSpine: 'myRig', slotName: 'slot_x', bigIntro: 'intro_a' },
							},
						],
					},
				],
			} as unknown as Scene,
		],
	});
	const tiers = authoredWinTiersFor({ config: null, layout: placedDoc, winText: undefined });
	const out = asGame(placedDoc, tiers);
	const swappedInst = instances(allNodes(out), B.WIN_PRESENTATION_COMPONENT_ID)[0];
	eq(
		'a placed win instance (nested, moved) becomes winPresentation carrying transform, overrides and params, the pin dropped',
		[
			instances(allNodes(out), 'win').length,
			swappedInst.id,
			swappedInst.componentVersion,
			[swappedInst.x, swappedInst.y, swappedInst.scale, swappedInst.rotation, swappedInst.alpha],
			swappedInst.zIndex,
			swappedInst.overrides,
			swappedInst.params,
		],
		[
			0,
			'w',
			undefined,
			[700, 300, { x: 0.8, y: 0.8 }, 2, 0.9],
			4,
			{ portrait: { x: 540, y: 900, params: { showCoins: false } } },
			{ winSpine: 'myRig', slotName: 'slot_x', bigIntro: 'intro_a' },
		],
	);
	eq(
		'...no winVisual scene is synthesized when one is placed, the composer still degrades, the group keeps its own fields',
		[
			out.scenes.some((sc) => sc.id === A.WIN_VISUAL_SCENE_ID),
			out.scenes.length === placedDoc.scenes.length,
			winBinds(allNodes(out), 'WinGate').length,
			(out.scenes.at(-1)!.nodes[0] as { x: number; y: number }).x,
		],
		[false, true, 1, 10],
	);
	// A doc that carries a `winVisual` scene of its own (already split) gets no second one; a doc
	// with nothing to swap and a visual of its own is the same object.
	const alreadySplit = on(split);
	const splitOut = A.withAuthoredWinDoc(alreadySplit);
	eq(
		'an already-split doc keeps one winVisual scene, its instance swapped',
		[
			splitOut.scenes.filter((sc) => sc.id === A.WIN_VISUAL_SCENE_ID).length,
			instances(allNodes(splitOut), B.WIN_PRESENTATION_COMPONENT_ID).length,
			instances(allNodes(splitOut), 'win').length,
		],
		[1, 1, 0],
	);
	const nothing = {
		...splitOut,
		scenes: splitOut.scenes.map((sc) =>
			sc.id === A.OVERLAYS_SCENE_ID
				? { ...sc, nodes: sc.nodes.filter((n) => n.bind?.component !== 'WinGate') }
				: sc,
		),
	};
	// A placed instance keeps its NATURAL size: the swap never writes `fitBoard`, so only the
	// synthesized instance fits the board (the coded `win` instance rendered unfitted, the coded
	// composer fitted).
	const tierNode = byLabelDeep(
		C.WIN_PRESENTATION_DEF.root.children,
		C.WIN_PRESENTATION_NODES.tier,
	) as { boardFit?: boolean; paramBindings?: Record<string, string> } | undefined;
	eq(
		'a swapped placed instance carries no fitBoard; the synthesized one has it on; the def binds it',
		[
			'fitBoard' in ((splitOut.scenes.at(-1)!.nodes[0] as Inst).params ?? {}),
			(A.authoredWinVisualScene(split.mainSizesMap).nodes[0] as Inst).params?.fitBoard,
			tierNode?.boardFit,
			tierNode?.paramBindings?.boardFit,
			C.WIN_PRESENTATION_DEF.params?.find((pm) => pm.key === 'fitBoard')?.default,
		],
		[false, true, undefined, 'fitBoard', false],
	);
	// A `winVisual` scene whose win was deleted places nothing: the status says `ready` (the
	// overlays composer is still there to replace) and the swap must agree — the empty scene is
	// REPLACED by the synthesized one, never kept beside a second `winVisual`.
	const emptied = {
		...alreadySplit,
		scenes: alreadySplit.scenes.map((sc) =>
			sc.id === A.WIN_VISUAL_SCENE_ID ? { ...sc, nodes: [] } : sc,
		),
	};
	const emptiedOut = A.withAuthoredWinDoc(emptied);
	eq(
		'an emptied winVisual scene is replaced by the synthesized one and the status still says ready',
		[
			A.authoredWinStatus({ doc: emptied, tiers: CODED_TIERS }),
			emptiedOut.scenes.filter((sc) => sc.id === A.WIN_VISUAL_SCENE_ID).length,
			emptiedOut.scenes.length === emptied.scenes.length,
			instances(allNodes(emptiedOut), B.WIN_PRESENTATION_COMPONENT_ID).length,
			(emptiedOut.scenes.find((sc) => sc.id === A.WIN_VISUAL_SCENE_ID)!.nodes[0] as Inst).params
				?.fitBoard,
		],
		['ready', 1, true, 1, true],
	);
	eq(
		'a doc with nothing to swap and a visual of its own is the same doc',
		A.withAuthoredWinDoc(nothing) === nothing,
		true,
	);
}

// ---- 3. the status rule, the tier builder and the chips ----------------------------------------------

{
	const lines = layouts.lines;
	const stripOverlays = (doc: LayoutDoc): LayoutDoc => ({
		...doc,
		scenes: doc.scenes.map((sc) =>
			sc.id === A.OVERLAYS_SCENE_ID
				? { ...sc, nodes: sc.nodes.filter((n) => n.bind?.component !== 'Win') }
				: sc,
		),
	});
	const noOverlays = (doc: LayoutDoc): LayoutDoc => ({
		...doc,
		scenes: doc.scenes.filter((sc) => sc.id !== A.OVERLAYS_SCENE_ID),
	});
	const tiersWith = (patch: Partial<A.AuthoredWinTier>, alias = 'mega') =>
		CODED_TIERS.map((t) => (t.alias === alias ? { ...t, ...patch } : t));
	eq(
		'off / ready / nothing-to-replace / caption-variable / tier-presentation-unsupported, from the one rule',
		[
			A.authoredWinStatus({ doc: lines, tiers: CODED_TIERS }),
			A.authoredWinStatus({ doc: on(lines), tiers: CODED_TIERS }),
			A.authoredWinStatus({ doc: on(noOverlays(lines)), tiers: CODED_TIERS }),
			A.authoredWinStatus({ doc: on(stripOverlays(lines)), tiers: CODED_TIERS }),
			A.authoredWinStatus({
				doc: on(stripOverlays(R.defaultLayout('lines', { winInstance: true }))),
				tiers: CODED_TIERS,
			}),
			A.authoredWinStatus({ doc: on(lines), tiers: tiersWith({ caption: 'MEGA {amount}' }) }),
			A.authoredWinStatus({ doc: on(lines), tiers: tiersWith({ caption: 'You {did} it' }) }),
			A.authoredWinStatus({ doc: on(lines), tiers: tiersWith({ caption: 'MEGA WIN' }) }),
			A.authoredWinStatus({ doc: on(lines), tiers: tiersWith({ rigKey: 'other' }) }),
			A.authoredWinStatus({ doc: on(lines), tiers: tiersWith({ slotName: 'slot_other' }) }),
			A.authoredWinStatus({ doc: on(lines), tiers: [] }),
		],
		[
			'off',
			'ready',
			'ready',
			'nothing-to-replace',
			'ready',
			'caption-variable',
			'caption-variable',
			'ready',
			'tier-presentation-unsupported',
			'tier-presentation-unsupported',
			'ready',
		],
	);
	eq(
		'nothing-to-replace outranks the caption and the tiers; a caption variable outranks the tiers',
		[
			A.authoredWinStatus({
				doc: on(stripOverlays(lines)),
				tiers: tiersWith({ caption: '{amount}', rigKey: 'o' }),
			}),
			A.authoredWinStatus({
				doc: on(lines),
				tiers: tiersWith({ caption: '{amount}', rigKey: 'o' }),
			}),
		],
		['nothing-to-replace', 'caption-variable'],
	);
	// The launcher's tier builder, fed as the page feeds it.
	eq(
		'an un-authored project presents the coded ladder: the five big tiers on the shared rig and slot, no caption',
		CODED_TIERS,
		['big', 'superwin', 'mega', 'epic', 'max'].map((alias) => ({
			alias,
			rigKey: 'bigwin',
			slotName: 'slot_win_count',
		})),
	);
	const { gameConfigDefaultFor } = await import('../src/lib/server/gameConfigDefaults.ts');
	const template = gameConfigDefaultFor('lines');
	eq(
		"the lines template config's tiers resolve to the same list as the coded ladder",
		authoredWinTiersFor({ config: template, layout: { scenes: [] }, winText: undefined }),
		CODED_TIERS,
	);
	const authoredConfig = {
		...template!,
		winLevels: [
			{ alias: 'small', name: 'Small', threshold: 0, type: 'small' },
			{
				alias: 'big',
				name: 'Big',
				threshold: 10,
				type: 'big',
				animation: { intro: 'b_in', idle: 'b_idle', outro: 'b_out' },
			},
			{ alias: 'huge', name: 'Huge', threshold: 50, type: 'big', spineKey: 'hugeRig' },
			{
				alias: 'plain',
				name: 'Plain',
				threshold: 90,
				type: 'big',
			},
		],
	} as unknown as NonNullable<typeof template>;
	eq(
		'an authored ladder: big rows only, ascending, a tier with no animation anywhere is not a tier of the presentation',
		authoredWinTiersFor({ config: authoredConfig, layout: { scenes: [] }, winText: undefined }),
		[{ alias: 'big', rigKey: 'bigwin', slotName: 'slot_win_count' }],
	);
	const winLayout = {
		scenes: [
			{
				id: 's',
				name: 's',
				nodes: [
					{
						id: 'g',
						kind: 'container',
						x: 0,
						y: 0,
						children: [
							{
								id: 'w',
								kind: 'componentInstance',
								componentId: 'win',
								x: 0,
								y: 0,
								params: { winSpine: 'shared', hugeSlot: 'slot_h', introAnimation: 'in' },
							},
						],
					},
				],
			},
		],
	} as unknown as Pick<LayoutDoc, 'scenes'>;
	eq(
		"the placed win instance's params (first instance, nested) drive each tier's rig and slot through the engine's precedence",
		[
			winPresentationParamsOf(winLayout),
			authoredWinTiersFor({ config: authoredConfig, layout: winLayout, winText: undefined }),
		],
		[
			{ winSpine: 'shared', hugeSlot: 'slot_h', introAnimation: 'in' },
			[
				{ alias: 'big', rigKey: 'shared', slotName: 'slot_win_count' },
				{ alias: 'huge', rigKey: 'hugeRig', slotName: 'slot_h' },
				{ alias: 'plain', rigKey: 'shared', slotName: 'slot_win_count' },
			],
		],
	);
	eq(
		'the Win Text captions ride along per alias; an empty caption is none',
		authoredWinTiersFor({
			config: null,
			layout: { scenes: [] },
			winText: { version: 1, winLevels: { big: 'BIG WIN', mega: 'MEGA {amount}', epic: '' } },
		}).map((t) => t.caption),
		['BIG WIN', undefined, 'MEGA {amount}', undefined, undefined],
	);
	eq(
		'...so a project whose caption interpolates a token is held back, and one whose tiers split rigs too',
		[
			A.authoredWinStatus({
				doc: on(lines),
				tiers: authoredWinTiersFor({
					config: null,
					layout: { scenes: [] },
					winText: { version: 1, winLevels: { mega: 'MEGA {amount}' } },
				}),
			}),
			A.authoredWinStatus({
				doc: on(lines),
				tiers: authoredWinTiersFor({
					config: authoredConfig,
					layout: winLayout,
					winText: undefined,
				}),
			}),
		],
		['caption-variable', 'tier-presentation-unsupported'],
	);
	// The chips, from the same rule.
	const chips = (layout: { authoredWin: A.AuthoredWinStatus } | null) =>
		buildGameProfile({
			gameTypeId: 'lines',
			gameTypeName: 'Lines',
			config: null,
			configSource: 'template' as never,
			symbols: { symbols: {} } as never,
			runtimeId: 'lines',
			protocol: 'lines',
			layout: layout ? { authoredTransition: 'off', ...layout } : null,
		}).features.filter((c) => c.id.startsWith('authoredWin'));
	const expectedChip: Record<A.AuthoredWinStatus, [string, string | undefined, string][]> = {
		off: [],
		ready: [['authoredWin', undefined, 'Authored Win (pilot)']],
		'nothing-to-replace': [['authoredWinUnbound', 'warn', 'Authored Win on, nothing to replace']],
		'caption-variable': [
			['authoredWinCaption', 'warn', 'Authored Win on, held back: a win caption uses {amount}'],
		],
		'tier-presentation-unsupported': [
			[
				'authoredWinTier',
				'warn',
				'Authored Win on, held back: the tiers use more than one rig or count slot',
			],
		],
	};
	for (const status of Object.keys(expectedChip) as A.AuthoredWinStatus[]) {
		eq(
			`${status} ⇒ ${expectedChip[status][0]?.[0] ?? 'no chip'}`,
			chips({ authoredWin: status }).map((c) => [c.id, c.tone, c.text]),
			expectedChip[status],
		);
	}
	eq('no doc ⇒ no chip', chips(null), []);
	// The chips agree with the rule in every case: drive the rule's cases through the chips.
	const cases: [string, LayoutDoc, A.AuthoredWinTier[]][] = [
		['off', lines, CODED_TIERS],
		['ready', on(lines), CODED_TIERS],
		['unbound', on(stripOverlays(lines)), CODED_TIERS],
		['caption', on(lines), tiersWith({ caption: '{amount}' })],
		['tiers', on(lines), tiersWith({ rigKey: 'o' })],
	];
	eq(
		'the chips agree with the status in every case',
		cases.map(([, doc, tiers]) => {
			const status = A.authoredWinStatus({ doc, tiers });
			return chips({ authoredWin: status }).map((c) => c.id);
		}),
		[[], ['authoredWin'], ['authoredWinUnbound'], ['authoredWinCaption'], ['authoredWinTier']],
	);
	// The Game Maker page feeds the rule from the launcher's builder (one more read, flag on only).
	const page = src('../src/routes/(app)/game-maker/+page.server.ts');
	eq(
		'the Game Maker page computes the status from the builder, reading Win Text only with the flag on',
		[
			page.includes('authoredOverlayChips(buttoned, config.doc, winText)') &&
				/status: \(doc\) => authoredWinStatus\(\{ doc, tiers \}\)/.test(
					src('../src/lib/server/authoredWinTiers.ts'),
				),
			src('../src/lib/server/authoredWinTiers.ts').includes(
				'const tiers = authoredWinTiersFor({ config, layout, winText });',
			),
			/authoredWinEnabled\(layout\)\s*\?\s*await loadWinTextDoc\(/.test(page),
		],
		[true, true, true],
	);
}

// ---- 4. the def and the generated timelines ---------------------------------------------------------

// The clips the game ships, each measured as the game's loaded `SkeletonData` reports it (its
// last key is the clip's duration — the 8a gate's read of the transition rig).
const skeleton = JSON.parse(src('../../lines/static/assets/spines/bigwin/mm_bigwin.json')) as {
	animations: Record<string, unknown>;
};
const lastKey = (o: unknown): number => {
	if (Array.isArray(o)) return Math.max(0, ...o.map(lastKey));
	if (o && typeof o === 'object') {
		const r = o as Record<string, unknown>;
		return Math.max(typeof r.time === 'number' ? r.time : 0, ...Object.values(r).map(lastKey));
	}
	return 0;
};
const CLIP_NAMES = Object.keys(skeleton.animations).sort();
const CLIP_MS = Object.fromEntries(
	CLIP_NAMES.map((name) => [name, Math.round(lastKey(skeleton.animations[name]) * 1000)]),
);
const { winLevelMap } = await import('../../../packages/engine-game/src/game/winLevelMap.ts');
const TIERS: B.WinTierTimelineTier[] = Object.values(winLevelMap)
	.filter((t) => t.type === 'big')
	.map((t) => ({
		alias: t.alias,
		intro: t.animation.intro,
		idle: t.animation.idle,
		outro: t.animation.outro,
	}));
const def = C.winPresentationDef();
const generated = B.winTierTimelines(TIERS, CLIP_MS);
{
	eq(
		'winPresentation is a built-in beside the win twin, internal, offered to no kind',
		[
			C.BUILTIN_COMPONENTS.some((d) => d.id === B.WIN_PRESENTATION_COMPONENT_ID),
			C.BUILTIN_COMPONENTS.some((d) => d.id === 'win'),
			def.internal,
			C.WIN_PRESENTATION_DEF.internal,
			Object.keys(layouts).some((k) => C.componentOfferedForKind(def, k)),
			Object.keys(layouts).some((k) => C.componentOfferedForKind(C.WIN_PRESENTATION_DEF, k)),
		],
		[true, true, true, true, false, false],
	);
	const withCaptions = C.winPresentationDef([
		{ alias: 'big', name: 'Big', caption: 'BIG WIN' },
		{ alias: 'mega', name: 'Mega', caption: 'MEGA WIN' },
	]);
	eq(
		'a generated def with captions is internal too and offered to no kind',
		[
			withCaptions.internal,
			Object.keys(layouts).some((k) => C.componentOfferedForKind(withCaptions, k)),
		],
		[true, false],
	);
	eq(
		'every generated timeline binds only nodes the def has (cinematicNodes issues empty)',
		generated.flatMap((d) =>
			N.validateNodeActors(d, { id: '', name: '', nodes: def.root.children }).map(
				(i) => `${d.id}:${i.code}`,
			),
		),
		[],
	);
	const captioned = B.winTierTimelines([{ ...TIERS[0], caption: 'BIG WIN' }], CLIP_MS);
	eq(
		'...and with a caption the text track binds the caption node of the captioned def',
		captioned.flatMap((d) =>
			N.validateNodeActors(d, { id: '', name: '', nodes: withCaptions.root.children }).map(
				(i) => `${d.id}:${i.code}`,
			),
		),
		[],
	);
	eq(
		'generation is deterministic: same inputs ⇒ deep-equal docs; other clip lengths ⇒ other strips',
		[
			JSON.stringify(B.winTierTimelines(TIERS, CLIP_MS)) === JSON.stringify(generated),
			JSON.stringify(B.winTierTimelines(TIERS, { ...CLIP_MS, big_win_idle: 6000 })) !==
				JSON.stringify(generated),
		],
		[true, true],
	);
	eq(
		'every generated id is lower-case (a project timeline can shadow it) and hosted on the def',
		[
			generated.every((d) => /^[a-z0-9_]+$/.test(d.id)),
			generated.every(
				(d) =>
					d.host?.kind === 'component' && d.host.componentId === B.WIN_PRESENTATION_COMPONENT_ID,
			),
		],
		[true, true],
	);
	const walks = generated.filter((d) => d.id.endsWith('_walk'));
	const idles = generated.filter((d) => d.id.endsWith('_idle'));
	const loops = generated.filter((d) => d.id.endsWith('_loop'));
	const outros = generated.filter((d) => d.id.endsWith('_outro'));
	eq(
		'per tier: a walk and an idle cycle that hold, a loop that never holds, an outro that holds; plain / hide / rest hold nothing',
		[
			walks.map((d) => [d.playOn, d.holdsCue === true]),
			idles.map((d) => [d.playOn, d.holdsCue === true]),
			loops.map((d) => [d.playOn, d.holdsCue === true]),
			outros.map((d) => [d.playOn, d.holdsCue === true]),
			generated
				.filter((d) => !/_(walk|idle|loop|outro)$/.test(d.id))
				.some((d) => d.holdsCue === true),
			[
				[B.WIN_REST_TIMELINE_ID, 'enter'],
				[B.WIN_PLAIN_TIMELINE_ID, B.WIN_PLAIN_SIGNAL],
				[B.WIN_HIDE_TIMELINE_ID, B.WIN_HIDE_SIGNAL],
			].map(([id, playOn]) => generated.find((d) => d.id === id)?.playOn === playOn),
		],
		[
			TIERS.map((t) => [B.winTierSignal(t.alias), true]),
			TIERS.map((t) => [B.winTierIdleSignal(t.alias), true]),
			TIERS.map((t) => [B.winTierLoopSignal(t.alias), false]),
			TIERS.map((t) => [B.winTierOutroSignal(t.alias), true]),
			false,
			[true, true, true],
		],
	);
	const noExit = B.winTierTimelines(
		[
			{ alias: 'big', intro: 'big_win_intro', idle: 'big_win_idle' },
			{ alias: 'mega', intro: 'mega_win_intro', idle: 'mega_win_idle', outro: 'mega_win_exit' },
		],
		CLIP_MS,
	);
	eq(
		'the outro exists only for a tier with an exit',
		noExit.filter((d) => d.id.endsWith('_outro')).map((d) => d.id),
		[B.winTierOutroTimelineId('mega')],
	);
	const stripClips = (d: CinematicDoc): string[] =>
		(d.tracks as { kind: string; strips?: { clip: { name: string } }[] }[])
			.filter((t) => t.kind === 'animation')
			.flatMap((t) => (t.strips ?? []).map((s) => s.clip.name));
	eq(
		'the strips name exactly the clips the shipped bigwin skeleton carries for the default tiers',
		[
			generated.flatMap(stripClips).every((clip) => clip in CLIP_MS),
			[...new Set(generated.flatMap(stripClips))].sort(),
		],
		[true, CLIP_NAMES],
	);
	eq(
		"each hold is its one clip, off the measured clips: a walk's the intro, an idle cycle's one idle, an outro's the exit",
		[
			walks.map((d) => Math.round(d.duration * 1000)),
			idles.map((d) => Math.round(d.duration * 1000)),
			outros.map((d) => Math.round(d.duration * 1000)),
		],
		[
			TIERS.map((t) => Math.round(CLIP_MS[t.intro])),
			TIERS.map((t) => Math.round(CLIP_MS[t.idle])),
			TIERS.map((t) => Math.round(CLIP_MS[t.outro!])),
		],
	);
	// Registration order and shadowing through the one call the game makes.
	L.registerComponentTimelines([]);
	L.registerGameTimelines(undefined, generated);
	eq(
		'registerGameTimelines registers the generated docs on the def',
		L.componentTimelinesFor(B.WIN_PRESENTATION_COMPONENT_ID).map((d) => d.id),
		generated.filter((d) => d.playOn).map((d) => d.id),
	);
	const bigWalk = generated.find((d) => d.id === B.winTierWalkTimelineId('big'))!;
	L.registerGameTimelines([{ ...bigWalk, name: 'project copy' }], generated);
	eq(
		'...and a baked project doc with the same id shadows the generated one',
		[
			L.componentTimelinesFor(B.WIN_PRESENTATION_COMPONENT_ID).find((d) => d.id === bigWalk.id)
				?.name,
			L.componentTimelinesFor(B.WIN_PRESENTATION_COMPONENT_ID).length,
		],
		['project copy', generated.filter((d) => d.playOn).length],
	);
	L.registerComponentTimelines([]);
}

// ---- 5. timing -------------------------------------------------------------------------------------

{
	L.registerComponentTimelines([]);
	L.registerGameTimelines(undefined, generated);
	const { docs } = L.instanceTimelineDocs(B.WIN_PRESENTATION_COMPONENT_ID, undefined);
	const player = new L.ComponentTimelinePlayer(docs, def.root.children);
	const walkId = B.winTierWalkTimelineId('big');
	eq(
		'an instance holds the walk, the idle cycle and the outro signals, never the loop, the plain number or the hide',
		[
			player.holdsOn(B.winTierSignal('big')),
			player.holdsOn(B.winTierIdleSignal('big')),
			player.holdsOn(B.winTierOutroSignal('big')),
			player.holdsOn(B.winTierLoopSignal('big')),
			player.holdsOn(B.WIN_PLAIN_SIGNAL),
			player.holdsOn(B.WIN_HIDE_SIGNAL),
		],
		[[walkId], [B.winTierIdleTimelineId('big')], [B.winTierOutroTimelineId('big')], [], [], []],
	);
	const seam = new H.InstanceCueHolds((signal) => player.holdsOn(signal));
	seam.open(B.winTierLoopSignal('big'));
	eq('a winTierLoop fire opens nothing', H.cueHolds(B.winTierLoopSignal('big')), []);
	seam.open(B.winTierSignal('big'));
	eq('a winTier.big fire opens one hold', H.cueHolds(B.winTierSignal('big')).length, 1);
	const [until] = H.cueHolds(B.winTierSignal('big'));
	let frames = 0;
	let settledAt = -1;
	void until.then(() => {
		settledAt = frames;
	});
	player.trigger(B.winTierSignal('big'));
	let completedOn = -1;
	while (completedOn < 0 && frames < 2000) {
		frames++;
		const step = player.advance(1 / 60);
		seam.release(step.completed);
		if (step.completed.includes(walkId)) completedOn = frames;
	}
	await until;
	await Promise.resolve();
	const walkFrames = Math.ceil((CLIP_MS.big_win_intro / 1000) * 60 - 1e-6);
	eq(
		'the hold settles on the frame the walk ends (the intro, ±1 frame) and is gone',
		[
			Math.abs(completedOn - walkFrames) <= 1,
			settledAt === completedOn,
			H.cueHolds(B.winTierSignal('big')),
		],
		[true, true, []],
	);
	const byLabel = (nodes: readonly LayoutNode[], label: string): LayoutNode | undefined => {
		for (const n of nodes) {
			if (n.label === label) return n;
			if (n.kind === 'container') {
				const hit = byLabel(n.children, label);
				if (hit) return hit;
			}
		}
		return undefined;
	};
	const tier = byLabel(def.root.children, C.WIN_PRESENTATION_NODES.tier);
	eq(
		"at the walk's end the tier rig (one spine node, boardFit, on the shared bundle) holds the intro at its last time",
		[
			tier?.kind,
			(tier as { paramBindings?: Record<string, string> } | undefined)?.paramBindings?.boardFit,
			player.sample(tier!.id)?.animTime,
		],
		['spine', 'fitBoard', { animation: 'big_win_intro', time: CLIP_MS.big_win_intro / 1000 }],
	);
	// An unmount releases a pending hold.
	const gone = new H.InstanceCueHolds((signal) => player.holdsOn(signal));
	gone.open(B.winTierOutroSignal('big'));
	const [pending] = H.cueHolds(B.winTierOutroSignal('big'));
	let released = false;
	void pending.then(() => {
		released = true;
	});
	gone.releaseAll();
	await pending;
	await Promise.resolve();
	eq(
		'an unmount releases a pending outro hold',
		[released, H.cueHolds(B.winTierOutroSignal('big'))],
		[true, []],
	);
	L.registerComponentTimelines([]);
}
{
	// `awaitFireHolds`: the three readings the gate makes.
	const settled = Promise.resolve();
	let reads = 0;
	eq(
		'a hold registered synchronously is awaited',
		await W.awaitFireHolds(
			() => {
				reads++;
				return [settled];
			},
			async () => {
				throw new Error('no defer needed');
			},
		),
		'held',
	);
	let late: Promise<void>[] = [];
	let deferred = 0;
	eq(
		'a hold registered a frame late is found on the one deferred re-read',
		[
			await W.awaitFireHolds(
				() => late,
				async () => {
					deferred++;
					late = [settled];
				},
			),
			deferred,
		],
		['held', 1],
	);
	let noneReads = 0;
	let fell: 'held' | 'empty' | 'hang' = 'hang';
	void W.awaitFireHolds(
		() => {
			noneReads++;
			return [];
		},
		async () => undefined,
	).then((r) => {
		fell = r;
	});
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	eq(
		'with no instance at all the step falls through at once after exactly two reads — never hangs',
		[fell, noneReads, reads],
		['empty', 2, 1],
	);
}
{
	// The conductor replays the escalation fixtures step for step.
	const signals: W.WinWalkSignals = {
		tier: B.winTierSignal,
		cycle: B.winTierIdleSignal,
		loop: B.winTierLoopSignal,
		outro: B.winTierOutroSignal,
		plain: B.WIN_PLAIN_SIGNAL,
	};
	const drive = (tiers: W.WinWalkTier[], escalating: boolean) => {
		let walk = W.createWinWalk(tiers, escalating, signals);
		const log: string[] = [];
		const held: { signal: string; step: number }[] = [];
		const apply = (event: W.WinWalkEvent) => {
			const next = W.nextStep(walk, event);
			walk = next.walk;
			for (const e of next.effects) {
				if (e.kind === 'fire') {
					log.push(e.signal);
					if (e.holds) held.push(e);
				} else log.push(e.kind === 'stepIndex' ? `index:${e.index}` : e.kind);
			}
		};
		const holdEnds = () => apply({ type: 'holdEnd', step: held[held.length - 1].step });
		return { apply, holdEnds, log, held, phase: () => walk.phase };
	};
	const t = (alias: string, hasExit = true): W.WinWalkTier => ({
		alias,
		hasExit,
		boundaryAmount: 0,
	});
	const single = drive([t('big')], false);
	single.apply({ type: 'start' });
	single.holdEnds();
	single.apply({ type: 'countUpComplete' });
	eq(
		'a single un-escalating tier: intro (held), then the loop; the count landing adds no outro',
		[single.log, single.phase()],
		[['index:0', 'winTier.big', 'winTierLoop.big'], 'loop'],
	);
	const one = drive([t('big')], true);
	one.apply({ type: 'start' });
	one.holdEnds();
	one.apply({ type: 'countUpComplete' });
	one.holdEnds();
	eq(
		'a single escalating tier: intro, loop, countUpComplete ⇒ outro (held), its end concludes',
		[one.log, one.phase()],
		[['index:0', 'winTier.big', 'winTierLoop.big', 'winTierOutro.big', 'outroComplete'], 'done'],
	);
	const chain = drive([t('big'), t('superwin'), t('mega')], true);
	chain.apply({ type: 'start' });
	for (let i = 0; i < 5; i++) chain.holdEnds();
	chain.apply({ type: 'countUpComplete' });
	chain.holdEnds();
	eq(
		'an escalating chain walks each tier once (intro, one idle cycle), loops the last, the landing plays its outro',
		chain.log,
		[
			'index:0',
			'winTier.big',
			'winTierIdle.big',
			'index:1',
			'winTier.superwin',
			'winTierIdle.superwin',
			'index:2',
			'winTier.mega',
			'winTierLoop.mega',
			'winTierOutro.mega',
			'outroComplete',
		],
	);
	const tap = drive([t('big'), t('superwin'), t('mega')], true);
	tap.apply({ type: 'start' });
	tap.apply({ type: 'tap', toTier: 1 });
	tap.apply({ type: 'holdEnd', step: tap.held[0].step });
	tap.apply({ type: 'tap', toTier: 0 });
	tap.holdEnds();
	tap.holdEnds();
	eq(
		"a tap bumps the walk forward (never back); the bumped tier's stale hold is ignored",
		tap.log,
		[
			'index:0',
			'winTier.big',
			'index:1',
			'winTier.superwin',
			'winTierIdle.superwin',
			'index:2',
			'winTier.mega',
		],
	);
	const hold = drive([t('big'), t('mega')], true);
	hold.apply({ type: 'start' });
	for (let i = 0; i < 3; i++) hold.holdEnds();
	hold.apply({ type: 'holdOutro', on: true });
	hold.apply({ type: 'countUpComplete' });
	const kept = [...hold.log];
	hold.apply({ type: 'holdOutro', on: false });
	eq(
		'holdOutro keeps the loop through the count landing; its release runs the outro',
		[kept.at(-1), hold.log.at(-1)],
		['winTierLoop.mega', 'winTierOutro.mega'],
	);
	const noExit = drive([t('big', false)], true);
	noExit.apply({ type: 'start' });
	noExit.holdEnds();
	noExit.apply({ type: 'countUpComplete' });
	eq(
		'a final tier without an exit concludes at once',
		[noExit.log.at(-1), noExit.phase()],
		['outroComplete', 'done'],
	);
	const plain = drive([], false);
	plain.apply({ type: 'start' });
	eq('no tier ⇒ the plain number, unheld', [plain.log, plain.held.length], [['winPlain'], 0]);
}
{
	// The play rate rule: `max(speedScale, 1)` while escalating and the count runs, 1 otherwise —
	// the pure rule read off the gate, and the registry every instance reads.
	const gate = src('../../lines/src/components/WinGate.svelte');
	const rule = gate.match(
		/show && winState\.escalationActive && !winState\.countUpComplete\s*\?\s*Math\.max\(winState\.escalationSpeedScale, 1\)\s*:\s*1/,
	);
	eq('the gate sets the rate by the coded ramp rule', !!rule, true);
	eq(
		'...through setComponentPlayRate on the presentation component',
		/setComponentPlayRate\(WIN_PRESENTATION_COMPONENT_ID, rate\)/.test(gate),
		true,
	);
	const playRate = (active: boolean, complete: boolean, scale: number, shown = true) =>
		shown && active && !complete ? Math.max(scale, 1) : 1;
	eq(
		'the rule: ≥ 1 while escalating and counting, 1 once landed, 1 un-escalating, never below 1, 1 once hidden',
		[
			playRate(true, false, 2.5),
			playRate(true, true, 2.5),
			playRate(false, false, 2.5),
			playRate(true, false, 0.4),
			// The hide resets the count latch while a held pointer keeps its speed.
			playRate(true, false, 2.5, false),
		],
		[2.5, 1, 1, 1, 1],
	);
	P.clearComponentPlayRates();
	P.setComponentPlayRate(B.WIN_PRESENTATION_COMPONENT_ID, 2);
	const two = P.componentPlayRate(B.WIN_PRESENTATION_COMPONENT_ID);
	P.setComponentPlayRate(B.WIN_PRESENTATION_COMPONENT_ID, 1);
	eq(
		'the registry: a rate is read by component, 1 clears it, nothing else is touched',
		[
			two,
			P.componentPlayRate(B.WIN_PRESENTATION_COMPONENT_ID),
			P.componentPlayRate('transitionWipe'),
		],
		[2, 1, 1],
	);
	const player = new L.ComponentTimelinePlayer(
		generated.filter((d) => d.id === B.winTierWalkTimelineId('big')),
		def.root.children,
	);
	player.trigger(B.winTierSignal('big'));
	player.playRate = 2;
	player.advance(0.5);
	eq('the player advances by dt × playRate', player.timeOf(B.winTierWalkTimelineId('big')), 1);
}
{
	// `instanceHoldMs`: every `holdsCue` timeline of a def measures (a project's own 2 s entrance
	// included — the 8a contract), with ONE exemption read off the source: the win presentation,
	// whose holds are walk timing and whose coded twin measured 0. Drive the real duration walk.
	const runtime = src('../../lines/src/game/flowV2Runtime.svelte.ts');
	eq(
		'the game exempts exactly the win presentation from instanceHoldMs',
		[
			/instanceHoldMs: \(defId\) => \{\s*if \(defId === WIN_PRESENTATION_COMPONENT_ID\) return undefined;/.test(
				runtime,
			),
			runtime.includes('MEASURED_BIND_TWINS'),
		],
		[true, false],
	);
	const nodeView = src('../../../packages/engine-layout/src/lib/LayoutNodeView.svelte');
	eq(
		'a rig with boardFit bound OFF divides the load scale out (the coded natural size); no other rig does',
		[
			/boundBoardFit === false && !hasExplicitSize \? EDITOR_RIG_LOAD_SCALE : undefined/.test(
				nodeView,
			),
			(nodeView.match(/loadScaleBase=\{naturalRigLoadScale\}/g) ?? []).length,
		],
		[true, 1],
	);
	const gate = src('../../lines/src/components/WinGate.svelte');
	eq(
		'the gate releases the walk holds on winHide and the play-rate effect resets to 1 on teardown',
		[
			/winHide: \(\) => \{\s*show = false;\s*if \(authoredWin\) endWalk\(\);/.test(gate),
			/const endWalk = \(\): void => \{[^}]*releaseAuthoredWinHolds\(\);\s*if \(rewind\) fireAuthoredWinRewind\(rewind\);\s*\};/.test(
				gate,
			),
			/setComponentPlayRate\(WIN_PRESENTATION_COMPONENT_ID, rate\);[^}]*return \(\) => setComponentPlayRate\(WIN_PRESENTATION_COMPONENT_ID, 1\);/.test(
				gate,
			),
		],
		[true, true, true],
	);
	const entrance = {
		...generated[0],
		id: 'c_project_entrance',
		name: 'entrance',
		duration: 2,
		playOn: 'enter',
		holdsCue: true,
		host: { kind: 'component', componentId: 'projectCard' },
		stage: { sceneId: null, cast: [] },
		tracks: [],
	} as CinematicDoc;
	L.registerComponentTimelines([]);
	L.registerGameTimelines([entrance], generated);
	const resolvers = {
		rigClipMs: () => undefined,
		effectMs: () => undefined,
		resolveComponent: (id: string) =>
			id === def.id
				? { root: def.root }
				: id === C.TRANSITION_WIPE_DEF.id
					? { root: C.TRANSITION_WIPE_DEF.root }
					: id === 'projectCard'
						? { root: { id: 'card-root', kind: 'container', x: 0, y: 0, children: [] } }
						: undefined,
		boundComponentMs: () => undefined,
		instanceHoldMs: (id: string) => {
			if (id === B.WIN_PRESENTATION_COMPONENT_ID) return undefined;
			const held = L.componentTimelinesFor(id).filter((d) => d.holdsCue === true);
			return held.length
				? Math.max(...held.map((d) => Math.max(d.duration || 0, 0) * 1000))
				: undefined;
		},
	};
	const wipeScene = A.withAuthoredTransition(
		layouts.lines.scenes.find((sc) => sc.id === A.OVERLAYS_SCENE_ID)!,
	);
	const winScene = A.authoredWinVisualScene(layouts.lines.mainSizesMap);
	const cardScene = {
		id: 'card',
		name: 'card',
		space: 'canvas',
		nodes: [
			{
				id: 'card-1',
				kind: 'componentInstance',
				componentId: 'projectCard',
				x: 0,
				y: 0,
				params: {},
			},
		],
	} as unknown as Scene;
	eq(
		'instanceHoldMs: the Transition twin 1667, the win presentation undefined (though it holds), a project 2 s holdsCue timeline 2000',
		[
			D.sceneAnimationDurationMs(wipeScene, resolvers as never),
			D.sceneAnimationDurationMs(winScene, resolvers as never),
			D.sceneAnimationDurationMs(cardScene, resolvers as never),
			L.componentTimelinesFor(B.WIN_PRESENTATION_COMPONENT_ID).some((d) => d.holdsCue === true),
		],
		[B.TRANSITION_WIPE_TIMELINE.duration * 1000, 0, 2000, true],
	);
	L.registerComponentTimelines([]);
}
{
	// Stale holds: a `winHide` mid-walk releases the walk's hold (`releaseCueHolds`), so the next
	// win's first read sees only its own; a missing tier rig registers length-less walks that hold
	// nothing (the fall-through), never a `ready` that never comes.
	const player = new L.ComponentTimelinePlayer(generated, def.root.children);
	const instance = new H.InstanceCueHolds((signal) => player.holdsOn(signal));
	const walkSignal = B.winTierSignal('big');
	instance.open(walkSignal);
	const [stale] = H.cueHolds(walkSignal);
	let staleSettled = false;
	void stale.then(() => {
		staleSettled = true;
	});
	H.releaseCueHolds(walkSignal);
	await Promise.resolve();
	await Promise.resolve();
	eq(
		'after the release the map holds nothing for the signal and the awaiter settled',
		[H.cueHolds(walkSignal).length, H.pendingCueHolds().includes(walkSignal), staleSettled],
		[0, false, true],
	);
	instance.open(walkSignal);
	eq("the next win's first read sees exactly its own hold", H.cueHolds(walkSignal).length, 1);
	instance.releaseAll();
	// An unmount's release settles through `Promise.all` → `then` → the race → the drop: a macrotask.
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	eq('released again by the unmount', H.pendingCueHolds(), []);
	const lengthless = B.winTierTimelines(TIERS, {});
	const bare = new L.ComponentTimelinePlayer(lengthless, def.root.children);
	eq(
		'with no clip lengths no walk or outro holds, so every tier falls through',
		[
			lengthless.filter((d) => d.holdsCue === true).length,
			TIERS.map((t) => bare.holdsOn(B.winTierSignal(t.alias)).length),
			TIERS.map((t) => bare.holdsOn(B.winTierOutroSignal(t.alias)).length),
		],
		[0, TIERS.map(() => 0), TIERS.map(() => 0)],
	);
}

// ---- 6. the wiring ---------------------------------------------------------------------------------

{
	const game = src('../../lines/src/components/Game.svelte');
	const load = game.slice(game.indexOf('void loadEditorScenes().then('));
	// The swaps run in the shared resolution (`resolveAuthoredOverlays`), the one the launcher's
	// chips read: Transition first, then the Win's status on the transitioned doc, then its swap.
	const overlays = src('../../../packages/engine-layout/src/lib/authoredOverlays.ts');
	const resolver = overlays.slice(overlays.indexOf('export function resolveAuthoredOverlays<'));
	const swapAt = load.indexOf('resolveAuthoredOverlays(rawDoc, {');
	const v2At = load.indexOf('createLinesFlowV2(\n\t\t\t\tdoc,');
	const v1At = load.indexOf('createLinesFlow(\n\t\t\t\t\t\tdoc,');
	eq(
		'the game swaps the win (after the transition) and builds both flow interpreters from the swapped doc; no raw doc reaches them',
		[
			swapAt > 0,
			resolver.indexOf('win.status(transitioned)') >
				resolver.indexOf('withAuthoredTransitionDoc(raw)'),
			v2At > swapAt,
			v1At > swapAt,
			/createLinesFlow(V2)?\(\s*(rawDoc|transitioned)/.test(load),
			/status: resolveAuthoredWinStatus,/.test(load),
		],
		[true, true, true, true, false, true],
	);
	eq(
		'the game retires the coded visual only when ready, and still routes the gate through resolveWinMount with basegameOverlaysHasCodedWinGate',
		[
			/retireCodedOverlay\('win', authoredWin\)/.test(load),
			/resolveWinMount\(\{ flowV2DrivesScreens, flowOwnsSetWin, basegameOverlaysHasCodedWinGate \}\)/.test(
				game,
			),
		],
		[true, true],
	);
	const visual = src('../../lines/src/components/WinVisual.svelte');
	eq(
		'WinVisual reads the retire once, renders nothing, subscribes to nothing and publishes nothing when retired',
		[
			/const retired = isCodedOverlayRetired\('win'\);/.test(visual),
			/\{#if winLevelData && !retired\}/.test(visual),
			/if \(!retired\) \{\s*context\.eventEmitter\.subscribeOnMount/.test(visual),
			/\$effect\(\(\) => \{\s*if \(retired\) return;\s*winState\.escalationActive/.test(visual),
		],
		[true, true, true, true],
	);
	eq(
		'resolveWinMount is byte-identical to main (the one-subscriber invariant, fs7Win)',
		createHash('sha256')
			.update(src('../../../packages/engine-game/src/game/winOwnership.ts'))
			.digest('hex'),
		'bc8e9eeaf0d40c7ce521a7b5f86f48dc9b1c1551a93f8417bbe190ddb6d6c87b', // pragma: allowlist secret (sha256 pin of main's winOwnership.ts)
	);
	const flags = src('../../lines/src/game/editorFlags.ts');
	eq('the dev pilot is off', /export const AUTHORED_WIN = false;/.test(flags), true);
	const { execSync } = await import('node:child_process');
	const linesSrc = new URL('../../lines/src/', import.meta.url).pathname;
	const mentions = execSync(
		`grep -rln "authoredOverlays\\|AUTHORED_WIN\\|authoredWin" "${linesSrc}" --include=*.ts --include=*.svelte || true`,
		{ encoding: 'utf8' },
	)
		.split('\n')
		.filter(Boolean);
	const urlRead = mentions.filter((file) => {
		const text = readFileSync(file, 'utf8');
		return text
			.split('\n')
			.some(
				(line) =>
					/authoredOverlays|AUTHORED_WIN|authoredWin/.test(line) &&
					/location\.|searchParams|URLSearchParams|\?ie_|\?flowV2/.test(line),
			);
	});
	eq(
		'no URL opt-in: no line of the game reads the win flag off location / URL params',
		[mentions.length > 0, urlRead],
		[true, []],
	);
	eq(
		'the flag reaches the dev doc only from AUTHORED_WIN',
		/authoredWin: AUTHORED_WIN,/.test(src('../../lines/src/editor-scenes.ts')),
		true,
	);
}
{
	// One text stack: the flag changes nothing the localization harvest sees, for every layout.
	const { harvestSceneText } = await import('../src/lib/server/localizationHarvest.ts');
	const resolveDef = async (id: string) => C.BUILTIN_COMPONENTS.find((d) => d.id === id);
	for (const [name, doc] of Object.entries(layouts)) {
		const off = await harvestSceneText(doc, resolveDef as never);
		const flagged = await harvestSceneText(asGame(on(doc)), resolveDef as never);
		eq(
			`${name}: the harvest is identical with the flag on and off`,
			JSON.stringify(flagged),
			JSON.stringify(off),
		);
	}
}
{
	// The server side of the Game Settings rows: a save that FLIPS either pilot switch needs the
	// component-publish capability; one that leaves both as stored is anyone's.
	const docOf = (overlays?: Record<string, boolean>) => ({
		settings: overlays ? { authoredOverlays: overlays } : {},
	});
	const off = docOf();
	const win = docOf({ win: true });
	const both = docOf({ transition: true, win: true });
	eq(
		'authoredOverlayChangeAllowed covers both rows',
		[
			G.authoredOverlayChangeAllowed({ before: off, after: off, canPublish: false }),
			G.authoredOverlayChangeAllowed({ before: win, after: win, canPublish: false }),
			G.authoredOverlayChangeAllowed({ before: off, after: win, canPublish: false }),
			G.authoredOverlayChangeAllowed({ before: win, after: off, canPublish: false }),
			G.authoredOverlayChangeAllowed({ before: win, after: both, canPublish: false }),
			G.authoredOverlayChangeAllowed({ before: both, after: win, canPublish: false }),
			G.authoredOverlayChangeAllowed({ before: null, after: win, canPublish: false }),
			G.authoredOverlayChangeAllowed({
				before: win,
				after: docOf({ win: false }),
				canPublish: false,
			}),
			G.authoredOverlayChangeAllowed({ before: off, after: both, canPublish: true }),
		],
		[true, true, false, false, false, false, false, false, true],
	);
	// The decision, (stale, flip) × (publisher, non-publisher): the ETag check first.
	const decide = (stale: boolean, flip: boolean, canPublish: boolean) =>
		G.authoredOverlaySaveDecision({
			before: off,
			after: flip ? win : off,
			canPublish,
			baseEtag: stale ? '"old"' : '"current"',
			storedEtag: '"current"',
		});
	eq(
		'stale ⇒ conflict whoever saves and whatever flips; fresh ⇒ switching Win on is locked for everyone',
		[
			decide(true, true, true),
			decide(true, true, false),
			decide(true, false, true),
			decide(true, false, false),
			decide(false, true, true),
			decide(false, true, false),
			decide(false, false, true),
			decide(false, false, false),
		],
		['conflict', 'conflict', 'conflict', 'conflict', 'locked', 'locked', 'write', 'write'],
	);
	eq(
		'force is never stale (switching Win on is still refused); the create path compares null to null',
		[
			G.authoredOverlaySaveDecision({
				before: off,
				after: win,
				canPublish: false,
				baseEtag: undefined,
				storedEtag: '"x"',
			}),
			G.authoredOverlaySaveDecision({
				before: off,
				after: off,
				canPublish: false,
				baseEtag: undefined,
				storedEtag: '"x"',
			}),
			G.authoredOverlaySaveDecision({
				before: null,
				after: off,
				canPublish: false,
				baseEtag: null,
				storedEtag: null,
			}),
			G.authoredOverlaySaveDecision({
				before: null,
				after: off,
				canPublish: false,
				baseEtag: null,
				storedEtag: '"x"',
			}),
			G.authoredOverlaySaveDecision({
				before: off,
				after: off,
				canPublish: false,
				baseEtag: '"x"',
				storedEtag: null,
			}),
		],
		['locked', 'write', 'write', 'conflict', 'conflict'],
	);
	const action = src('../src/routes/(app)/editor/+page.server.ts');
	const save = action.slice(action.indexOf('save: async ('));
	const decisionAt = save.indexOf('authoredOverlaySaveDecision(');
	eq(
		'the save action reads the base ETag, decides, and only then writes — a publisher reads only to switch Win on',
		[
			save.indexOf('const baseEtag = writeBaseEtagForm(form)') < decisionAt,
			decisionAt < save.indexOf('await saveDoc('),
			/if \(\s*!canPublishShared \|\|\s*submitsWinOn\(parsed as Partial<LayoutDoc>\)(?:\s*\|\|\s*submits\w+On\(parsed as Partial<LayoutDoc>\))*\s*\) \{\s*const stored = await loadDocWithEtag\(/.test(
				save,
			),
			(save.match(/await loadDocWithEtag\(/g) ?? []).length,
			/if \(decision === 'conflict'\) return conflict\(\);/.test(save),
			/if \(decision === 'forbidden'\) \{\s*return fail\(403/.test(save),
			/if \(decision === 'locked'\) \{\s*return fail\(403/.test(save),
			/canPublish: canPublishShared,/.test(save),
			/if \(e instanceof ConflictError\) return conflict\(\);/.test(save),
		],
		[true, true, true, 1, true, true, true, true, true],
	);
	eq(
		'the Win pilot is locked OFF until its follow-up merges: on is refused for a publisher, off is allowed',
		[
			G.AUTHORED_WIN_LOCKED,
			G.submitsWinOn(win),
			G.submitsWinOn(off),
			G.authoredOverlaySaveDecision({
				before: win,
				after: off,
				canPublish: true,
				baseEtag: '"c"',
				storedEtag: '"c"',
			}),
			G.authoredOverlaySaveDecision({
				before: win,
				after: win,
				canPublish: true,
				baseEtag: '"c"',
				storedEtag: '"c"',
			}),
		],
		[true, true, false, 'write', 'write'],
	);
	const page = src('../src/routes/(app)/editor/+page.svelte');
	eq(
		'the Game Settings Win row sits beside Transition, locked off (pilot pending), written sparse',
		[
			/let authoredWin = \$state<boolean>\(data\.doc\.settings\?\.authoredOverlays\?\.win === true\);/.test(
				page,
			),
			/checked=\{authoredWin\}\s*disabled=\{!data\.canPublishShared \|\| !authoredWin\}/.test(page),
			page.includes('pilot pending — parity follow-up'),
			/\.\.\.\(authoredWin \? \{ win: true \} : \{\}\)/.test(page),
			/!bootLoader && !authoredOverlays\) return undefined/.test(page),
		],
		[true, true, true, true, true],
	);
}

// ---- 7. the #1194 review's flag-on fixes -------------------------------------------------------------

{
	// (a) A cascade's running total (`winLevel: 0`, no `winLevelData`) mounts no coded visual; the
	// authored side starts no walk and no fade for it.
	const handlers = src('../../lines/src/game/bookEventHandlerMap.ts');
	const gate = src('../../lines/src/components/WinGate.svelte');
	const cascades = handlers.match(/type: 'winUpdate',\s*amount: [^,]+,\s*winLevel: 0,\s*\}/g) ?? [];
	eq(
		'(a) the cascade winUpdates carry no tier data; the gate walks only when it has some',
		[
			cascades.length >= 3,
			/if \(authoredWin && emitterEvent\.winLevelData !== undefined\) \{\s*startWalk\(emitterEvent\.winLevelData\);/.test(
				gate,
			),
			/const startWalk = \(data: WinLevelData\): void =>/.test(gate),
			(gate.match(/startWalk\(/g) ?? []).length,
			(gate.match(/fireAuthoredWinFade\(\)/g) ?? []).length,
		],
		[true, true, true, 1, 2],
	);
	// (e) The late-mount re-read waits a FRAME (the next animation frame), not a zero timeout.
	eq(
		'(e) the late-mount re-read is the next animation frame',
		[
			/awaitFireHolds\(\s*\(\) => cueHolds\(effect\.signal\),\s*\(\) => new Promise<void>\(\(resolve\) => requestAnimationFrame\(\(\) => resolve\(\)\)\),\s*\)/.test(
				gate,
			),
			gate.includes('waitForTimeout(0)'),
		],
		[true, false],
	);
}
{
	// (b) Events before the deferred `start` fire nothing and fold into it; a second start is ignored.
	const drive = (tiers: Parameters<typeof W.createWinWalk>[0], escalating: boolean) => {
		let walk = W.createWinWalk(tiers, escalating, {
			tier: B.winTierSignal,
			cycle: B.winTierIdleSignal,
			loop: B.winTierLoopSignal,
			outro: B.winTierOutroSignal,
			plain: B.WIN_PLAIN_SIGNAL,
		});
		const log: string[] = [];
		const apply = (event: Parameters<typeof W.nextStep>[1]) => {
			const next = W.nextStep(walk, event);
			walk = next.walk;
			for (const e of next.effects) log.push(e.kind === 'fire' ? e.signal : e.kind);
		};
		return { apply, log };
	};
	const chain = ['big', 'superwin', 'max'].map((alias, i) => ({
		alias,
		hasExit: true,
		boundaryAmount: i,
	}));
	const instant = drive(chain, true);
	instant.apply({ type: 'countUpComplete' });
	instant.apply({ type: 'start' });
	instant.apply({ type: 'start' });
	const tapped = drive(chain, true);
	tapped.apply({ type: 'tap', toTier: 1 });
	tapped.apply({ type: 'start' });
	eq(
		'(b) an instant count collapses the start to the final outro once; an early tap starts on its tier',
		[instant.log, tapped.log],
		[
			['stepIndex', 'winTierOutro.max'],
			['stepIndex', 'winTier.superwin'],
		],
	);
}
{
	// The coded walk's REWIND under the fade-out: `winHide` clears the count latch and `WinAnimation`
	// restarts an escalating chain's first-tier intro while the overlay fades. The authored side fires
	// `winTierRewind.<first>`, whose timeline replays that intro on the tier rig alone (never the
	// `visual` node the hide owns), holds nothing, and only for an escalating walk whose count landed.
	const gate = src('../../lines/src/components/WinGate.svelte');
	const rewind = generated.find((d) => d.id === B.winTierRewindTimelineId('big'))!;
	eq(
		'the rewind replays the intro on the tier alone, unheld, and the gate fires it on the coded rule',
		[
			rewind.playOn,
			rewind.holdsCue === true,
			rewind.stage!.cast.map((c) => c.actorId),
			(
				rewind.tracks.find((t) => t.kind === 'animation') as {
					strips: { clip: { name: string } }[];
				}
			).strips[0].clip.name,
			/walk\?\.escalating && walk\.tiers\.length && winState\.countUpComplete\s*\?\s*walk\.tiers\[0\]\.alias/.test(
				gate,
			),
			// endWalk runs in the winHide handler before it clears the latch.
			gate.indexOf('if (authoredWin) endWalk();') <
				gate.indexOf('winState.countUpComplete = false;\n\t\t},'),
		],
		['winTierRewind.big', false, ['tier'], 'big_win_intro', true, true],
	);
}
{
	// (c) A tier rig other than the def's default is WRITTEN into the swapped instance: the def's tier
	// node reads `winSpine`, its riders `slotName`, so the presentation draws the rig the tiers name.
	const lines = layouts.lines;
	const rigTiers = CODED_TIERS.map((t) => ({ ...t, rigKey: 'hugeRig', slotName: 'slot_h' }));
	const synthesized = asGame(on(lines), rigTiers).scenes.find(
		(sc) => sc.id === A.WIN_VISUAL_SCENE_ID,
	)?.nodes[0] as Inst | undefined;
	const placedDoc = on(R.defaultLayout('lines', { winInstance: true }));
	const placedParams = (doc: LayoutDoc) =>
		instances(allNodes(doc), B.WIN_PRESENTATION_COMPONENT_ID).map((n) => n.params);
	const withParams = {
		...placedDoc,
		scenes: placedDoc.scenes.map((sc) => ({
			...sc,
			nodes: sc.nodes.map((n) =>
				n.kind === 'componentInstance' && (n as Inst).componentId === 'win'
					? { ...n, params: { ...((n as Inst).params as object), introAnimation: 'in' } }
					: n,
			),
		})),
	} as LayoutDoc;
	eq(
		'(c) the synthesized and the placed instance carry the resolved rig and slot; the defaults write nothing',
		[
			synthesized?.params,
			placedParams(asGame(withParams, rigTiers)),
			placedParams(asGame(withParams)),
		],
		[
			{ winSpine: 'hugeRig', slotName: 'slot_h', fitBoard: true },
			[{ winSpine: 'hugeRig', slotName: 'slot_h', introAnimation: 'in' }],
			[{ winSpine: 'bigwin', slotName: 'slot_win_count', introAnimation: 'in' }],
		],
	);
	const clips = { intro: 'h_in', idle: 'h_idle', outro: 'h_out' };
	const authoredConfig = {
		winLevels: [
			{
				alias: 'big',
				name: 'Big',
				threshold: 10,
				type: 'big',
				spineKey: 'hugeRig',
				animation: clips,
			},
			{
				alias: 'mega',
				name: 'Mega',
				threshold: 40,
				type: 'big',
				spineKey: 'hugeRig',
				animation: clips,
			},
		],
	};
	const { gameConfigDefaultFor } = await import('../src/lib/server/gameConfigDefaults.ts');
	const config = { ...gameConfigDefaultFor('lines')!, ...authoredConfig } as unknown as Parameters<
		typeof authoredWinTiersFor
	>[0]['config'];
	const tiers = authoredWinTiersFor({ config, layout: { scenes: [] }, winText: undefined });
	eq(
		"(c) a config whose every tier names its own rig is ready, and the swap draws that rig, not the def's",
		[
			tiers.map((t) => t.rigKey),
			A.authoredWinStatus({ doc: on(lines), tiers }),
			(
				asGame(on(lines), tiers).scenes.find((sc) => sc.id === A.WIN_VISUAL_SCENE_ID)
					?.nodes[0] as Inst
			).params,
		],
		[
			['hugeRig', 'hugeRig'],
			'ready',
			{ winSpine: 'hugeRig', slotName: 'slot_win_count', fitBoard: true },
		],
	);
	const game = src('../../lines/src/components/Game.svelte');
	const authoredWinSrc = src('../../lines/src/game/authoredWin.svelte.ts');
	eq(
		'(c) the game hands the swap the rig and slot its tiers resolve to',
		[
			game.includes('presentation: authoredWinPresentation,') &&
				src('../../../packages/engine-layout/src/lib/authoredOverlays.ts').includes(
					'withAuthoredWinDoc(transitioned, win.presentation?.())',
				),
			/const first = authoredWinTiers\(\)\[0\];\s*return first \? \{ winSpine: first\.rigKey, slotName: first\.slotName \} : undefined;/.test(
				authoredWinSrc,
			),
		],
		[true, true],
	);
}
{
	// (d) Every spins mode's captions: scanned by the status rule, generated as the mode's own walk,
	// and the walk the conductor fires follows the mode on top, as the coded caption does.
	const winText = {
		version: 1,
		winLevels: { big: 'BIG WIN' },
		modes: {
			bonus: { winLevels: { big: 'BONUS BIG', mega: 'BONUS MEGA {amount}' } },
			same: { winLevels: { big: 'BIG WIN' } },
		},
	} as unknown as Parameters<typeof authoredWinTiersFor>[0]['winText'];
	const tiers = authoredWinTiersFor({ config: null, layout: { scenes: [] }, winText });
	eq(
		'(d) the builder carries each mode caption that differs from the base game',
		tiers.map((t) => [t.alias, t.caption, t.modeCaptions]),
		[
			['big', 'BIG WIN', { bonus: 'BONUS BIG' }],
			['superwin', undefined, undefined],
			['mega', undefined, { bonus: 'BONUS MEGA {amount}' }],
			['epic', undefined, undefined],
			['max', undefined, undefined],
		],
	);
	eq(
		'(d) a token in ANY mode caption holds the project back; a mode caption without one does not',
		[
			A.authoredWinStatus({ doc: on(layouts.lines), tiers }),
			A.authoredWinStatus({
				doc: on(layouts.lines),
				tiers: tiers.map((t) => (t.alias === 'mega' ? { ...t, modeCaptions: undefined } : t)),
			}),
		],
		['caption-variable', 'ready'],
	);
	const modeTier = {
		...TIERS[0],
		caption: 'BIG WIN',
		modeCaptions: { bonus: 'BONUS BIG', quiet: '' },
	};
	const docs = B.winTierTimelines([modeTier], CLIP_MS);
	const walkOf = (mode?: string) => docs.find((d) => d.id === B.winTierWalkTimelineId('big', mode));
	const captionKey = (d: CinematicDoc | undefined) =>
		(d?.tracks.find((t) => (t as { kind: string }).kind === 'text') as { keys?: { key: string }[] })
			?.keys?.[0]?.key;
	const modeDef = C.winPresentationDef([{ alias: 'big', name: 'Big', ...modeTier }]);
	eq(
		"(d) each mode with its own caption walks the tier under the mode's signal, keyed to its caption ('' clears it)",
		[
			[walkOf()?.playOn, captionKey(walkOf())],
			[walkOf('bonus')?.playOn, captionKey(walkOf('bonus'))],
			[walkOf('quiet')?.playOn, captionKey(walkOf('quiet'))],
			walkOf('bonus')?.duration === walkOf()?.duration && walkOf('bonus')?.holdsCue,
			docs.flatMap((d) =>
				N.validateNodeActors(d, { id: '', name: '', nodes: modeDef.root.children }).map(
					(i) => `${d.id}:${i.code}`,
				),
			),
			(byLabelDeep(modeDef.root.children, 'caption') as { switchKeys?: string[] }).switchKeys,
		],
		[
			['winTier.big', 'BIG WIN'],
			['winTier.big@bonus', 'BONUS BIG'],
			['winTier.big@quiet', ''],
			true,
			[],
			['BIG WIN', 'BONUS BIG'],
		],
	);
	eq(
		'(d) no mode caption ⇒ the generated timelines are exactly the base set',
		B.winTierTimelines(TIERS, CLIP_MS).map((d) => d.id),
		generated.map((d) => d.id),
	);
	const textKeys = (docs: CinematicDoc[]) =>
		docs.filter((d) => d.id.endsWith('_walk')).map((d) => [d.id, captionKey(d) ?? null]);
	eq(
		"(d) no caption anywhere ⇒ no walk keys the caption; any caption ⇒ a captionless walk keys '' (clears it)",
		[
			textKeys(B.winTierTimelines(TIERS.slice(0, 2), CLIP_MS)),
			textKeys(B.winTierTimelines([TIERS[0], { ...TIERS[1], caption: 'SUPER WIN' }], CLIP_MS)),
		],
		[
			[
				[B.winTierWalkTimelineId('big'), null],
				[B.winTierWalkTimelineId('superwin'), null],
			],
			[
				[B.winTierWalkTimelineId('big'), ''],
				[B.winTierWalkTimelineId('superwin'), 'SUPER WIN'],
			],
		],
	);
	const authoredWinSrc = src('../../lines/src/game/authoredWin.svelte.ts');
	const gate = src('../../lines/src/components/WinGate.svelte');
	eq(
		"(d) the game reads every mode's captions and the conductor fires the mode's own walk",
		[
			authoredWinSrc.includes('const modeCaptions = winTierModeCaptions(doc, alias);'),
			/const mode = activeSpinsGame\(\)\?\.mode;/.test(authoredWinSrc),
			/tier: authoredWinTierSignal,/.test(gate),
			authoredWinSrc.includes("from './boardWinText'"),
		],
		[true, true, true, false],
	);
}

{
	// Engine-wide effects stay off the default path (Phase 8b review): `frameExact` is the win
	// presentation's alone; a strip poses from the setup pose only on a trackless rig; timelines
	// end by the pre-#1194 rule for every def, the win's included (a held clip ends on the rig's
	// clock, so the snap-to-end #1194 gave a `frameExact` def is gone).
	const instance = src('../../../packages/engine-layout/src/lib/ComponentInstance.svelte');
	const nodeView = src('../../../packages/engine-layout/src/lib/LayoutNodeView.svelte');
	eq(
		'only the win presentation is frameExact; the instance gates advance-at-fire on it, and nothing snaps',
		[
			C.winPresentationDef().frameExact,
			C.WIN_DEF.frameExact,
			/if \(!def\?\.frameExact\) return;\s*const step = stateMachineRunner\.advance\(0\);/.test(
				instance,
			),
			instance.includes('snapEnds'),
		],
		[true, undefined, true, false],
	);
	const strip = { animation: 'big_win_idle', time: 1 };
	const V = await import('../../../packages/engine-layout/src/lib/valueBindings.ts');
	eq(
		'a strip poses from the setup pose on a trackless rig only; over a track it layers (main)',
		[
			V.withTimelineScrub([], strip, true).at(-1)?.fromSetup,
			'fromSetup' in (V.withTimelineScrub([], strip).at(-1) ?? {}),
			nodeView.includes('scrubs={withTimelineScrub(ownScrubs, timelineStrip, !anim)}'),
		],
		[true, false, true],
	);
	const snapDoc = { ...generated[0], id: 'c_snap', playOn: 'snapTest', duration: 0.1 };
	const p = new L.ComponentTimelinePlayer([snapDoc], def.root.children);
	p.trigger('snapTest');
	let done = false;
	for (let i = 0; i < 6; i++) done ||= p.advance(1 / 60).completed.includes('c_snap');
	eq(
		"a 0.1 s timeline after six 1/60 s steps (1.4e-17 short) is not done: the end rule is main's",
		[done, 'snapEnds' in p],
		[false, false],
	);
}
console.log(`\n${failures === 0 ? '✅' : '❌'} authored win: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
