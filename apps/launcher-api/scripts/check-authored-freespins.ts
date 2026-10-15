/**
 * The authored free-spin intro / outro behind a per-project flag (Rive plan Phase 8c,
 * `docs/design/rive-style-editor.md` §13.7):
 *   pnpm --filter launcher-api check:authored-freespins
 *
 *  1. the flag: `settings.authoredOverlays.freeSpins` round-trips through the layout normalizer ON
 *     only, beside the 8a / 8b rows, and reads as the game reads it;
 *  2. the swap: as the game composes it (the shared status rule, then `withAuthoredFreeSpinsDoc`),
 *     every reference layout with the flag off is the SAME doc object; with it on every
 *     `bind: FreeSpinIntroVisual / FreeSpinOutroVisual` becomes its presentation instance carrying
 *     the node's transform, wherever it sits, and nothing else changes;
 *  3. the ONE rule the game's flip and the publish chips share, case by case (off / ready /
 *     nothing-to-replace / non-canvas-scene / placed-visual / custom-presentation), and the chips
 *     agreeing with it;
 *  4. the built-in defs and timelines: internal, offered to no kind, board-anchored; sized off the
 *     board as the coded `FreeSpinAnimation` is, the sprites in the boot's language; every timeline
 *     binds only its def's nodes; none holds a cue; the strips name the clips the shipped `fsIntro*`
 *     skeletons carry, at their lengths; ids lower-case, so a project doc shadows one;
 *  5. the lock: switching the pilot on is refused for everyone (a publisher included), off is
 *     allowed, an already-on save writes; the Game Settings row is disabled, "pilot pending";
 *  6. the wiring, by source: the game swaps before both flows are built and registers everything
 *     the path needs only in its flag block; the retired coded visuals subscribe and draw nothing;
 *     the outro driver, the screens' taps and the free-spin holds are byte-identical to `main`
 *     (pinned); the dev pilot is off and there is no URL opt-in; `boardAnchored` is read by one
 *     place and only these defs set it;
 *  7. a NEGATIVE CONTROL: the identity check above is run against a deliberately wrong swap (one
 *     that always copies the doc) and must report it, so a pass is not a check that cannot fail.
 *
 * Runs the real `engine-layout` readers, registry and player, the real `editorStorage`
 * normalizer, `gameProfile` and guard. The frames themselves are `check:freespin-parity`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { LayoutDoc, LayoutNode, Scene } from 'engine-layout';

const A = await import('../../../packages/engine-layout/src/lib/authoredOverlays.ts');
const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const C = await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const N = await import('../../../packages/engine-layout/src/lib/cinematicNodes.ts');
const R = await import('../../../packages/engine-layout/src/lib/referenceLayouts/index.ts');
const { normalizeDoc: normalizeLayoutDoc } = await import('../src/lib/server/editorStorage.ts');
const { buildGameProfile } = await import('../src/lib/server/gameProfile.ts');
const G = await import('../src/lib/server/authoredOverlayGuard.ts');

/** sha256 of each file on `main` c773a78, before 8c: what holds the round must not move. */
const PINNED = [
	'479dae5bb6359279f3319db09e63a36f30f4220e6d94570f84dded9baf165483', // pragma: allowlist secret
	'7dd3210babd5d462fe768db2e59dc39300ca0066d44863e45972f6e0be78ca0a', // pragma: allowlist secret
	'0825a395ed07f094c07f7119e9f2f1218ab3b8b3a95cb233a3bb16df3a393125', // pragma: allowlist secret
	'e08a8e4a7c470dfe8261319bb553424cc9b51a68e42d5566e4fda162edd57c26', // pragma: allowlist secret
	'3bfe8005429caf31bec13098254b77c8d788190f38938d7cdb562cfbef531682', // pragma: allowlist secret
];

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
const sha = (rel: string): string => createHash('sha256').update(src(rel)).digest('hex');
const nodesOf = (nodes: readonly LayoutNode[]): LayoutNode[] =>
	nodes.flatMap((n) => [n, ...(n.kind === 'container' ? nodesOf(n.children) : [])]);
const allNodes = (doc: Pick<LayoutDoc, 'scenes'>): LayoutNode[] =>
	nodesOf(doc.scenes.flatMap((scene) => scene.nodes));

const baseDoc = (settings?: unknown): LayoutDoc =>
	({
		version: 1,
		projectKey: 'demo',
		gameType: 'lines',
		mainSizesMap: { desktop: { width: 1920, height: 1080 } },
		...(settings === undefined ? {} : { settings }),
		scenes: [],
		updatedAt: '2026-10-15T00:00:00.000Z',
	}) as unknown as LayoutDoc;

const on = <T extends LayoutDoc>(doc: T): T => ({
	...doc,
	settings: {
		...(doc.settings ?? {}),
		authoredOverlays: { ...(doc.settings?.authoredOverlays ?? {}), freeSpins: true },
	},
});
/** What the game does at load: the shared rule, then the swap. */
const swap = (doc: LayoutDoc): LayoutDoc =>
	A.authoredFreeSpinsStatus(doc) === 'ready' ? A.withAuthoredFreeSpinsDoc(doc) : doc;

const layouts: Record<string, LayoutDoc> = {
	lines: R.defaultLayout('lines'),
	ways: R.defaultLayout('ways'),
	bookof: R.bookofReferenceLayout(),
	cluster: R.clusterReferenceLayout(),
	scatter: R.scatterReferenceLayout(),
	holdAndWin: R.holdAndWinReferenceLayout(),
};
const CODED = ['FreeSpinIntroVisual', 'FreeSpinOutroVisual'];
const PRESENTATION = {
	FreeSpinIntroVisual: C.FREE_SPIN_INTRO_PRESENTATION_ID,
	FreeSpinOutroVisual: C.FREE_SPIN_OUTRO_PRESENTATION_ID,
} as Record<string, string>;
const codedBinds = (doc: Pick<LayoutDoc, 'scenes'>) =>
	allNodes(doc).filter((n) => n.bind && CODED.includes(n.bind.component));

// ---- 1. the flag ---------------------------------------------------------------------------------

eq(
	'an ON freeSpins row survives the normalizer, alone and beside the transition / win rows',
	[
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { freeSpins: true } }), 'demo').settings,
		normalizeLayoutDoc(
			baseDoc({ authoredOverlays: { transition: true, win: true, freeSpins: true } }),
			'demo',
		).settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { win: false, freeSpins: true } }), 'demo')
			.settings,
	],
	[
		{ authoredOverlays: { freeSpins: true } },
		{ authoredOverlays: { transition: true, win: true, freeSpins: true } },
		{ authoredOverlays: { freeSpins: true } },
	],
);
eq(
	'an OFF row and a non-boolean are not written',
	[
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { freeSpins: false } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { freeSpins: 1 } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { win: true, freeSpins: false } }), 'demo')
			.settings,
	],
	[undefined, undefined, { authoredOverlays: { win: true } }],
);
eq(
	'the game reads exactly the ON row',
	[
		A.authoredFreeSpinsEnabled(baseDoc({ authoredOverlays: { freeSpins: true } })),
		A.authoredFreeSpinsEnabled(baseDoc({ authoredOverlays: { freeSpins: false } })),
		A.authoredFreeSpinsEnabled(baseDoc({ authoredOverlays: { win: true } })),
		A.authoredFreeSpinsEnabled(baseDoc()),
	],
	[true, false, false, false],
);

// ---- 2. the swap ---------------------------------------------------------------------------------

/** The flag-off identity check, as a function of the swap, so the negative control can reuse it. */
const offIsIdentity = (compose: (doc: LayoutDoc) => LayoutDoc): boolean =>
	Object.values(layouts).every((doc) => compose(doc) === doc);
eq('flag off: every reference layout is the SAME doc object', offIsIdentity(swap), true);
eq(
	'flag off: the 8a / 8b rows alone leave the free-spin screens alone',
	Object.values(layouts).every((doc) => {
		const other = { ...doc, settings: { authoredOverlays: { transition: true, win: true } } };
		return swap(other as LayoutDoc) === other;
	}),
	true,
);
eq(
	'every reference layout with free spins seeds both coded visuals in canvas-space screens (Hold and Win has none)',
	Object.entries(layouts).map(([kind, doc]) => [
		kind,
		codedBinds(doc).map((n) => n.bind?.component),
		doc.scenes
			.filter((s) => s.nodes.some((n) => n.bind && CODED.includes(n.bind.component)))
			.every((s) => s.space === 'canvas'),
	]),
	Object.keys(layouts).map((kind) => [kind, kind === 'holdAndWin' ? [] : CODED, true]),
);
for (const [kind, doc] of Object.entries(layouts)) {
	const swapped = swap(on(doc));
	const before = codedBinds(doc);
	const after = allNodes(swapped);
	eq(
		`flag on (${kind}): every coded visual becomes its presentation, carrying its transform`,
		before.map((coded) => {
			const node = after.find((n) => n.id === coded.id);
			return node && node.kind === 'componentInstance'
				? [node.componentId, node.x, node.y, node.slotId, node.params]
				: null;
		}),
		before.map((coded) => [
			PRESENTATION[coded.bind!.component],
			coded.x,
			coded.y,
			coded.slotId,
			{},
		]),
	);
	eq(`flag on (${kind}): no coded visual is left`, codedBinds(swapped).length, 0);
	eq(
		`flag on (${kind}): every scene without a coded visual is the SAME object`,
		swapped.scenes.every(
			(scene, i) => codedBinds({ scenes: [doc.scenes[i]] }).length > 0 || scene === doc.scenes[i],
		),
		true,
	);
}
{
	// Moved, scaled, per-layout and nested: the coded node's own transform rides the instance.
	const lines = on(layouts.lines);
	const moved = {
		...lines,
		scenes: lines.scenes.map((scene) =>
			scene.id !== 'freeSpinIntro'
				? scene
				: {
						...scene,
						nodes: [
							{
								id: 'wrap',
								kind: 'container',
								x: 0,
								y: 0,
								children: scene.nodes.map((n) =>
									n.bind?.component === 'FreeSpinIntroVisual'
										? {
												...n,
												x: 40,
												y: -20,
												scale: { x: 1.1, y: 1.1 },
												overrides: { portrait: { x: 10 } },
											}
										: n,
								),
							} as LayoutNode,
						],
					},
		),
	} as LayoutDoc;
	const node = allNodes(swap(moved)).find((n) => n.id === 'fs-intro');
	eq(
		'a nested, moved, scaled, per-layout coded visual keeps all of it',
		node && node.kind === 'componentInstance'
			? [node.componentId, node.x, node.y, node.scale, node.overrides]
			: null,
		[C.FREE_SPIN_INTRO_PRESENTATION_ID, 40, -20, { x: 1.1, y: 1.1 }, { portrait: { x: 10 } }],
	);
}

// ---- 3. the shared rule and the chips ------------------------------------------------------------

const lines = layouts.lines;
const mapScenes = (doc: LayoutDoc, fn: (scene: Scene) => Scene): LayoutDoc => ({
	...doc,
	scenes: doc.scenes.map(fn),
});
const withoutVisuals = mapScenes(lines, (scene) => ({
	...scene,
	nodes: scene.nodes.filter((n) => !(n.bind && CODED.includes(n.bind.component))),
}));
const gameSpace = mapScenes(lines, (scene) =>
	scene.id === 'freeSpinOutro' ? { ...scene, space: 'game' } : scene,
);
const placed = mapScenes(lines, (scene) =>
	scene.id === 'basegame'
		? {
				...scene,
				nodes: [
					...scene.nodes,
					{
						id: 'placed-intro',
						kind: 'componentInstance',
						componentId: 'freeSpinIntroVisual',
						x: 0,
						y: 0,
						params: {},
					} as LayoutNode,
				],
			}
		: scene,
);
const custom = mapScenes(lines, (scene) => ({
	...scene,
	nodes: scene.nodes.map((n) =>
		n.bind?.component === 'FreeSpinOutroVisual'
			? { ...n, bind: { ...n.bind, props: { ...n.bind.props, outroSpine: 'myRig' } } }
			: n,
	),
}));
const defaultProps = mapScenes(lines, (scene) => ({
	...scene,
	nodes: scene.nodes.map((n) =>
		n.bind?.component === 'FreeSpinIntroVisual'
			? { ...n, bind: { ...n.bind, props: { ...n.bind.props, introSpine: 'fsIntroNumber' } } }
			: n,
	),
}));
const STATUS_CASES: [string, LayoutDoc, string][] = [
	['off', lines, 'off'],
	['ready', on(lines), 'ready'],
	['the default props spelled out', on(defaultProps), 'ready'],
	['no coded visual', on(withoutVisuals), 'nothing-to-replace'],
	['a visual in a game-space screen', on(gameSpace), 'non-canvas-scene'],
	['a placed visual instance', on(placed), 'placed-visual'],
	['a custom rig on a visual', on(custom), 'custom-presentation'],
];
eq(
	'the status rule, case by case',
	STATUS_CASES.map(([label, doc]) => [label, A.authoredFreeSpinsStatus(doc)]),
	STATUS_CASES.map(([label, , status]) => [label, status]),
);
eq(
	'held back ⇒ the SAME doc object (the coded path for both screens)',
	STATUS_CASES.filter(([, , status]) => status !== 'ready').every(([, doc]) => swap(doc) === doc),
	true,
);
{
	const chips = (status: A.AuthoredFreeSpinsStatus | undefined) =>
		buildGameProfile({
			gameTypeId: 'lines',
			gameTypeName: 'Lines',
			config: null,
			configSource: 'default',
			symbols: { highlight: false, boardGlow: false } as never,
			runtimeId: null,
			protocol: null,
			layout: { authoredTransition: 'off', authoredWin: 'off', authoredFreeSpins: status },
		} as never)
			.features.filter((c) => c.id.startsWith('authoredFreeSpins'))
			.map((c) => [c.id, c.tone ?? null, c.text]);
	eq(
		'the publish chips agree with the rule in every case',
		[
			chips(undefined),
			chips('off'),
			chips('ready'),
			chips('nothing-to-replace'),
			chips('non-canvas-scene'),
			chips('placed-visual'),
			chips('custom-presentation'),
		],
		[
			[],
			[],
			[['authoredFreeSpins', null, 'Authored free spins (pilot)']],
			[['authoredFreeSpinsHeld', 'warn', 'Authored free spins on, held back: nothing to replace']],
			[
				[
					'authoredFreeSpinsHeld',
					'warn',
					'Authored free spins on, held back: a free-spin visual sits outside canvas space',
				],
			],
			[
				[
					'authoredFreeSpinsHeld',
					'warn',
					'Authored free spins on, held back: a screen places a free-spin visual instance',
				],
			],
			[
				[
					'authoredFreeSpinsHeld',
					'warn',
					'Authored free spins on, held back: a free-spin visual names a custom rig, clip or slot',
				],
			],
		],
	);
	const page = src('../src/routes/(app)/game-maker/+page.server.ts');
	eq(
		'the Game Maker page builds the chip from the same rule',
		page.includes('authoredFreeSpins: authoredFreeSpinsStatus(layout),'),
		true,
	);
}

// ---- 4. the defs and the timelines ----------------------------------------------------------------

const { intro, outro } = C.freeSpinPresentationDefs({
	symbolSize: 120,
	boardColumns: 5,
	lang: 'de',
});
const labelsOf = (def: typeof intro): Map<string, LayoutNode> =>
	new Map(nodesOf([def.root]).map((n) => [n.label ?? n.id, n]));
eq(
	'internal, frameExact, board-anchored, registered among the built-ins with the defaults',
	[
		[intro.internal, intro.frameExact, intro.boardAnchored],
		[outro.internal, outro.frameExact, outro.boardAnchored],
		C.BUILTIN_COMPONENTS.filter((d) => d.boardAnchored).map((d) => d.id),
		C.BUILTIN_COMPONENTS.filter((d) => d.frameExact).map((d) => d.id),
	],
	[
		[true, true, true],
		[true, true, true],
		[C.FREE_SPIN_INTRO_PRESENTATION_ID, C.FREE_SPIN_OUTRO_PRESENTATION_ID],
		[
			'buttonPresentation',
			'winPresentation',
			C.FREE_SPIN_INTRO_PRESENTATION_ID,
			C.FREE_SPIN_OUTRO_PRESENTATION_ID,
		],
	],
);
{
	// The coded `FreeSpinAnimation` + visuals: the frame fitted to SYMBOL_SIZE × columns, at the
	// authoring box's residue; the number rigs at 0.3 / 0.4 of it; the counts at 0.1 / 0.08.
	const w = 600;
	const I = labelsOf(intro);
	const O = labelsOf(outro);
	const num = (n: LayoutNode | undefined, key: string) =>
		n ? (n as unknown as Record<string, number>)[key] : undefined;
	const font = (n: LayoutNode | undefined) =>
		n && n.kind === 'text' ? [n.style?.fontFamily, n.style?.fontSize, n.style?.fontWeight] : null;
	eq(
		'sized off the board as the coded part is',
		[
			num(I.get('frame'), 'width'),
			Math.round((num(I.get('frame'), 'y') ?? 0) * 1000) / 1000,
			num(I.get('number'), 'width'),
			num(O.get('number'), 'width'),
			font(I.get('count')),
			font(O.get('count')),
			I.get('content')?.rigSlot,
			I.get('count')?.rigSlot,
		],
		[
			w,
			5.217,
			w * 0.3,
			w * 0.4,
			['gold', 60, 'bold'],
			['gold', 48, undefined],
			'slot_text_placeholder',
			'slot_number',
		],
	);
	const keys = (def: typeof intro) =>
		nodesOf([def.root])
			.filter((n) => n.kind === 'sprite')
			.map((n) => [n.label, n.kind === 'sprite' ? n.assetKey : '']);
	eq(
		'the sprites carry the boot language where the coded keys did',
		[keys(intro), keys(outro)],
		[
			[
				['caption', 'freespins_de.png'],
				['footer', 'freespins.png'],
			],
			[
				['captionBig', 'freespins_de.png'],
				['captionSmall', 'winsmall_de.png'],
				['footerBig', 'totalwin.png'],
				['footerSmall', 'totalwin.png'],
			],
		],
	);
	eq(
		'offered to no kind (internal)',
		['lines', 'bookOf', 'ways', 'cluster', 'scatter', 'holdAndWin'].some((kind) =>
			C.BUILTIN_COMPONENTS.some(
				(d) =>
					(d.id === C.FREE_SPIN_INTRO_PRESENTATION_ID ||
						d.id === C.FREE_SPIN_OUTRO_PRESENTATION_ID) &&
					!d.internal &&
					C.componentOfferedForKind(d, kind as never),
			),
		),
		false,
	);
}
{
	const docs = B.FREE_SPIN_TIMELINES;
	const byDef = (id: string) =>
		docs.filter((d) => d.host?.kind === 'component' && d.host.componentId === id);
	eq(
		'every free-spin timeline is a built-in, registered first; none holds a cue; ids lower-case',
		[
			docs.every((d) => B.BUILTIN_TIMELINES.includes(d)),
			docs.some((d) => d.holdsCue),
			docs.every((d) => d.id === d.id.toLowerCase()),
			byDef(C.FREE_SPIN_INTRO_PRESENTATION_ID).map((d) => [d.id, d.playOn ?? null]),
			byDef(C.FREE_SPIN_OUTRO_PRESENTATION_ID).map((d) => [d.id, d.playOn ?? null]),
		],
		[
			true,
			false,
			true,
			[
				['c_freespinintropresentation_rest', 'enter'],
				['c_freespinintropresentation_show', 'freeSpinIntroShown'],
				['c_freespinintropresentation_hide', 'freeSpinIntroHidden'],
				['c_freespinintropresentation_fade_hidden', null],
				['c_freespinintropresentation_fade_shown', null],
			],
			[
				['c_freespinoutropresentation_rest', 'enter'],
				['c_freespinoutropresentation_show_big', 'freeSpinOutroShownBig'],
				['c_freespinoutropresentation_show_small', 'freeSpinOutroShownSmall'],
				['c_freespinoutropresentation_hide', 'freeSpinOutroHidden'],
				['c_freespinoutropresentation_fade_hidden', null],
				['c_freespinoutropresentation_fade_shown', null],
			],
		],
	);
	eq(
		'every timeline binds only its def’s nodes (no cinematicNodes issue)',
		[intro, outro].flatMap((def) =>
			byDef(def.id).flatMap((doc) =>
				N.validateNodeActors(doc, { id: '', name: '', nodes: def.root.children }).map(
					(i) => `${doc.id}:${i.code}`,
				),
			),
		),
		[],
	);
	eq(
		'the fade machine plays the two pose timelines it names',
		[intro, outro].map((def) =>
			def.stateMachine?.layers[0].states.map((s) => docs.some((d) => d.id === s.timeline)),
		),
		[
			[true, true],
			[true, true],
		],
	);
	// The strips name the shipped skeletons' clips at their lengths (their last key).
	const lastKey = (file: string, clip: string): number => {
		const skel = JSON.parse(src(`../../lines/static/assets/spines/fsIntro/${file}`)) as {
			animations: Record<string, unknown>;
		};
		let max = 0;
		const walk = (o: unknown): void => {
			if (Array.isArray(o)) o.forEach(walk);
			else if (o && typeof o === 'object') {
				const t = (o as { time?: unknown }).time;
				if (typeof t === 'number') max = Math.max(max, t);
				Object.values(o).forEach(walk);
			}
		};
		walk(skel.animations[clip]);
		return max;
	};
	eq(
		'the clip lengths are the shipped skeletons’ (fs_screen, fs_screen_number, fs_total_number)',
		['fs_screen.json', 'fs_screen_number.json', 'fs_total_number.json'].map((f) => [
			lastKey(f, 'intro'),
			lastKey(f, 'idle'),
		]),
		[0, 1, 2].map(() => [B.FREE_SPIN_INTRO_CLIP_SECONDS, B.FREE_SPIN_IDLE_CLIP_SECONDS]),
	);
	const show = docs.find((d) => d.id === 'c_freespinintropresentation_show')!;
	eq(
		'the show walk: intro once, then the idle looping from the frame the coded track switches on',
		show.tracks
			.filter((t) => t.kind === 'animation')
			.map((t) => [
				t.actorId,
				(t as { strips: { clip: { name: string }; start: number; loop?: unknown }[] }).strips.map(
					(s) => [s.clip.name, Math.round(s.start * 60), !!s.loop],
				),
			]),
		[
			[
				'frame',
				[
					['intro', 0, false],
					['idle', 41, true],
				],
			],
			[
				'number',
				[
					['intro', 0, false],
					['idle', 41, true],
				],
			],
		],
	);
	// A baked project doc of the same id shadows a built-in one.
	L.registerGameTimelines([{ ...show, name: 'project' }]);
	eq(
		'a project timeline of the same id shadows the built-in',
		L.componentTimelinesFor(C.FREE_SPIN_INTRO_PRESENTATION_ID)
			.filter((d) => d.id === show.id)
			.map((d) => d.name),
		['project'],
	);
	L.registerGameTimelines(undefined);
	const player = new L.ComponentTimelinePlayer(
		L.componentTimelinesFor(C.FREE_SPIN_INTRO_PRESENTATION_ID),
		intro.root.children,
	);
	eq(
		'a free-spin signal opens no hold',
		[player.holdsOn('freeSpinIntroShown'), player.holdsOn('freeSpinIntroHidden')],
		[[], []],
	);
}

// ---- 5. the lock ---------------------------------------------------------------------------------

{
	const off = baseDoc();
	const fsOn = baseDoc({ authoredOverlays: { freeSpins: true } });
	const decide = (before: LayoutDoc, after: LayoutDoc, canPublish: boolean) =>
		G.authoredOverlaySaveDecision({
			before,
			after,
			canPublish,
			baseEtag: '"c"',
			storedEtag: '"c"',
		});
	eq(
		'locked OFF until the owner pilots it: on is refused for a publisher, off and already-on write',
		[
			G.AUTHORED_FREE_SPINS_LOCKED,
			G.submitsFreeSpinsOn(fsOn),
			G.submitsFreeSpinsOn(off),
			decide(off, fsOn, true),
			decide(off, fsOn, false),
			decide(fsOn, off, true),
			decide(fsOn, fsOn, true),
			decide(fsOn, off, false),
			G.authoredOverlaySaveDecision({
				before: off,
				after: fsOn,
				canPublish: true,
				baseEtag: '"a"',
				storedEtag: '"b"',
			}),
		],
		[
			true,
			true,
			false,
			'locked-free-spins',
			'locked-free-spins',
			'write',
			'write',
			'forbidden',
			'conflict',
		],
	);
	const save = src('../src/routes/(app)/editor/+page.server.ts');
	eq(
		'the save action reads the store for a doc with the pilot on and refuses the switch',
		[
			/submitsFreeSpinsOn\(parsed as Partial<LayoutDoc>\)(?:\s*\|\|\s*submits\w+On\(parsed as Partial<LayoutDoc>\))*\s*\)\s*\{\s*const stored = await loadDocWithEtag\(/.test(
				save,
			),
			/if \(decision === 'locked-free-spins'\) \{\s*return fail\(403/.test(save),
		],
		[true, true],
	);
	const page = src('../src/routes/(app)/editor/+page.svelte');
	eq(
		'the Game Settings row is locked off (pilot pending), written sparse',
		[
			/let authoredFreeSpins = \$state<boolean>\(\s*data\.doc\.settings\?\.authoredOverlays\?\.freeSpins === true,?\s*\);/.test(
				page,
			),
			/checked=\{authoredFreeSpins\}\s*disabled=\{!data\.canPublishShared \|\| !authoredFreeSpins\}/.test(
				page,
			),
			page.includes('Free spins <em class="gs-pending">pilot pending</em>'),
			/\.\.\.\(authoredFreeSpins \? \{ freeSpins: true \} : \{\}\)/.test(page),
		],
		[true, true, true, true],
	);
}

// ---- 6. the wiring, by source ---------------------------------------------------------------------

{
	const game = src('../../lines/src/components/Game.svelte');
	const block = game.slice(
		game.indexOf('if (authoredFreeSpins) {'),
		game.indexOf('editorDoc = doc;'),
	);
	eq(
		'the game swaps under the shared rule before both flows are built, then retires the coded visuals',
		[
			/const authoredFreeSpins = authoredFreeSpinsStatus\(won\) === 'ready';\s*const doc = authoredFreeSpins \? withAuthoredFreeSpinsDoc\(won\) : won;/.test(
				game,
			),
			game.indexOf("retireCodedOverlay('freeSpins', authoredFreeSpins)") <
				game.indexOf('const flowV2 = createLinesFlowV2('),
			game.indexOf('const doc = authoredFreeSpins') <
				game.indexOf('const flowV2 = createLinesFlowV2('),
		],
		[true, true, true],
	);
	eq(
		'everything the path registers is registered in its flag block alone',
		[
			block.includes('authoredFreeSpinSignals('),
			block.includes('authoredFreeSpinValues('),
			block.includes('authoredFreeSpinDefs('),
			game.split('authoredFreeSpinSignals(').length - 1,
			game.split('authoredFreeSpinValues(').length - 1,
			game.split('authoredFreeSpinDefs(').length - 1,
		],
		[true, true, true, 1, 1, 1],
	);
	for (const file of ['FreeSpinIntroVisual', 'FreeSpinOutroVisual']) {
		const part = src(`../../lines/src/components/${file}.svelte`);
		eq(
			`the retired ${file} subscribes nothing and draws nothing`,
			[
				part.includes("const retired = isCodedOverlayRetired('freeSpins');"),
				/if \(!retired\) \{\s*context\.eventEmitter\.subscribeOnMount\(/.test(part),
				/\{#if \w+ && !retired\}/.test(part),
			],
			[true, true, true],
		);
	}
	// Pinned: what holds the round stays byte-identical to `main` (c773a78).
	eq(
		'the outro driver, the state latch, the screens and the free-spin holds are pinned',
		[
			sha('../../lines/src/components/FreeSpinOutroDriver.svelte'),
			sha('../../lines/src/game/freeSpinOutroState.svelte.ts'),
			sha('../../../packages/engine-layout/src/lib/freeSpinScenes.ts'),
			sha('../../../packages/engine-flow-v2/src/reference/drivenSeed.ts'),
			sha('../../../packages/engine-flow-v2/src/reference/bookOfChoreo.ts'),
		],
		PINNED,
	);
	const fs = src('../../lines/src/game/authoredFreeSpins.svelte.ts');
	eq(
		'every show / hide signal fires one animation frame after its emitter event (the coded tween’s tick)',
		[(fs.match(/requestAnimationFrame\(/g) ?? []).length, /const nextFrame = /.test(fs)],
		[3, true],
	);
	const flags = src('../../lines/src/game/editorFlags.ts');
	eq('the dev pilot is off', /export const AUTHORED_FREE_SPINS = false;/.test(flags), true);
	eq(
		'the flag reaches the dev doc only from AUTHORED_FREE_SPINS; no URL opt-in',
		[
			/authoredFreeSpins: AUTHORED_FREE_SPINS,/.test(src('../../lines/src/editor-scenes.ts')),
			/searchParams|URLSearchParams|location\./.test(
				src('../../lines/src/game/authoredFreeSpins.svelte.ts'),
			),
		],
		[true, false],
	);
	const view = src('../../../packages/engine-layout/src/lib/LayoutNodeView.svelte');
	eq(
		'`boardAnchored` is read in one place, behind the def field',
		[
			(view.match(/boardAnchored/g) ?? []).length,
			view.includes('const boardAnchored = $derived(hostedDef?.boardAnchored === true);'),
		],
		[5, true],
	);
}

// ---- 7. the negative control ----------------------------------------------------------------------

eq(
	'NEGATIVE CONTROL: the flag-off identity check reports a swap that copies the doc',
	offIsIdentity((doc) => ({ ...doc })),
	false,
);
eq(
	'NEGATIVE CONTROL: a doc with the flag on is NOT returned as the same object',
	swap(on(lines)) === on(lines),
	false,
);

console.log(
	`\n${failures === 0 ? '✅' : '❌'} authored free spins: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
