/**
 * The authored button behind a per-project flag (Rive plan Phase 8d,
 * `docs/design/rive-style-editor.md` §13.8):
 *   pnpm --filter launcher-api check:authored-buttons
 *
 *  1. the flag: `settings.authoredOverlays.buttons` round-trips through the layout normalizer ON
 *     only, beside the 8a–8c rows;
 *  2. the swap, as the game composes it (the shared status rule, then `withAuthoredButtonsDoc`):
 *     every reference layout with the flag off is the SAME doc object; with it on every `button`
 *     instance, at any depth, names `buttonPresentation` and keeps every other field (a pin dropped),
 *     and nothing else changes;
 *  3. the ONE rule the game and the publish chips share (off / ready / nothing-to-replace /
 *     custom-button), the built-in shape check behind `custom-button`, and the chips agreeing;
 *  4. the look: `resolveButtonLook` equals the coded `ButtonFrame`'s own derivation over every flag
 *     combination and every authored-image combination (and `ButtonFrame` is pinned, so a change to
 *     it re-opens this mirror);
 *  5. the def and its machine: internal, offered to no kind, `button`'s params; every state's
 *     timeline is built in and binds only the def's nodes; the machine validates; each look input
 *     enters its look, each look shows exactly its node; the turn is 360° a second, linear, and
 *     loops; the fade waits for `fadeWithUi`; a press sound enters (and re-enters) its state and its
 *     cue crosses at 0 — the bare event the coded body broadcast;
 *  6. the hand-off (`pressSounds.ts`): unclaimed ⇒ the body broadcasts; claimed ⇒ handed over, or
 *     declined back; a throwing press releases its claim;
 *  7. the lock is lifted: a publisher may switch the pilot on, a non-publisher may not, a stale tab
 *     conflicts first; the Game Settings row is enabled for publishers;
 *  8. the wiring, by source: every coded press body broadcasts through `pressFeedback`; the game
 *     swaps before the other overlays and registers the def, the fade signals and the defaults only
 *     in its flag block; the dev pilot is off and there is no URL opt-in; `buttonStates` is read by
 *     one component and set by one def; the press road and the coded parts are byte-identical to
 *     `main` (pinned);
 *  9. NEGATIVE CONTROLS: a swap that copies the doc, and a look rule that drops the grey, are
 *     reported, so a pass is not a check that cannot fail.
 *
 * Runs the real `engine-layout` readers, machine and player, the real `editorStorage` normalizer,
 * `gameProfile` and guard. The frames themselves are `check:button-parity`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { ComponentDef, LayoutDoc, LayoutNode } from 'engine-layout';

const AB = await import('../../../packages/engine-layout/src/lib/authoredButtons.ts');
const BS = await import('../../../packages/engine-layout/src/lib/buttonStateImage.ts');
const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const C = await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const I = await import('../../../packages/engine-layout/src/lib/componentInterface.ts');
const N = await import('../../../packages/engine-layout/src/lib/cinematicNodes.ts');
const P = await import('../../../packages/engine-layout/src/lib/pressSounds.ts');
const R = await import('../../../packages/engine-layout/src/lib/referenceLayouts/index.ts');
const { normalizeDoc: normalizeLayoutDoc } = await import('../src/lib/server/editorStorage.ts');
const { buildGameProfile } = await import('../src/lib/server/gameProfile.ts');
const G = await import('../src/lib/server/authoredOverlayGuard.ts');

/** sha256 on `main` 7bd9131, before 8d: the press road and the coded parts must not move. */
const PINNED: Record<string, string> = {
	'../../../packages/engine-layout/src/lib/registerComponentActions.ts':
		'f0a8d1f629124e598245121316cb5f9ff8729dd43b71da98a89b21a6885b3873', // pragma: allowlist secret
	'../../../packages/engine-layout/src/lib/registerFlowPress.ts':
		'f98bf3a0ae35fde9ca050a3b656efbd3ae876346fcc905a07d4c6885032261d2', // pragma: allowlist secret
	'../../../packages/utils-shared/spinStop.ts':
		'163700b7be0c2a537eb990a5e91e1af3327291d288c077cebee7d820b43ee1ef', // pragma: allowlist secret
	'../../../packages/components-ui-pixi/src/components/ButtonFrame.svelte':
		'7ed4a0eed2d72760fe771353bea0a34e4b259dc3c23e930e29e02a34f1a77dbb', // pragma: allowlist secret
	'../../../packages/components-ui-pixi/src/components/ButtonLabel.svelte':
		'932599e56b151d365c3e5e3c7a4c6c923fa60e41d668dc26a82da24f7daee713', // pragma: allowlist secret
	'../../../packages/components-ui-pixi/src/components/UiFadeContainer.svelte':
		'c91589bc2e470d8bfe37111846eb5ce27741e875afa17ced94af1d7720165566', // pragma: allowlist secret
};

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

const on = <T extends LayoutDoc>(doc: T): T => ({
	...doc,
	settings: {
		...(doc.settings ?? {}),
		authoredOverlays: { ...(doc.settings?.authoredOverlays ?? {}), buttons: true },
	},
});
/** What the game does at load: the shared rule, then the swap. */
const swap = (doc: LayoutDoc, shadowed = false): LayoutDoc =>
	AB.authoredButtonsStatus(doc, { shadowed }) === 'ready' ? AB.withAuthoredButtonsDoc(doc) : doc;

const lines = R.defaultLayout('lines', { buttons: true });
const layouts: Record<string, LayoutDoc> = {
	linesButtons: lines,
	lines: R.defaultLayout('lines'),
	ways: R.defaultLayout('ways'),
	bookof: R.bookofReferenceLayout(),
	cluster: R.clusterReferenceLayout(),
	scatter: R.scatterReferenceLayout(),
	holdAndWin: R.holdAndWinReferenceLayout(),
};
const buttonsOf = (doc: Pick<LayoutDoc, 'scenes'>, id: string) =>
	allNodes(doc).filter((n) => n.kind === 'componentInstance' && n.componentId === id);

// ---- 1. the flag ---------------------------------------------------------------------------------

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
eq(
	'an ON buttons row survives the normalizer, alone and beside the other rows; OFF rows are not written',
	[
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { buttons: true } }), 'demo').settings,
		normalizeLayoutDoc(
			baseDoc({
				authoredOverlays: { transition: true, win: true, freeSpins: true, buttons: true },
			}),
			'demo',
		).settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { buttons: false } }), 'demo').settings,
		normalizeLayoutDoc(baseDoc({ authoredOverlays: { buttons: 'yes' } }), 'demo').settings,
	],
	[
		{ authoredOverlays: { buttons: true } },
		{ authoredOverlays: { transition: true, win: true, freeSpins: true, buttons: true } },
		undefined,
		undefined,
	],
);
eq(
	'the dev pilot option writes the row and nothing else',
	[
		R.defaultLayout('lines', { buttons: true, authoredButtons: true }).settings,
		R.defaultLayout('lines', { buttons: true }).settings,
	],
	[{ authoredOverlays: { buttons: true } }, undefined],
);

// ---- 2. the swap ---------------------------------------------------------------------------------

const offIsIdentity = (compose: (doc: LayoutDoc) => LayoutDoc): boolean =>
	Object.values(layouts).every((doc) => compose(doc) === doc);
eq('flag off: every reference layout is the SAME doc object', offIsIdentity(swap), true);
eq(
	'flag off: the 8a–8c rows alone leave the buttons alone',
	Object.values(layouts).every((doc) => {
		const other = {
			...doc,
			settings: { authoredOverlays: { transition: true, win: true, freeSpins: true } },
		} as LayoutDoc;
		return swap(other) === other;
	}),
	true,
);
const swapped = swap(on(lines));
const before = buttonsOf(lines, 'button');
eq('the apps/lines fallback places the seven-button cluster', before.length >= 7, true);
eq(
	'flag on: every button instance names buttonPresentation, keeping every other field',
	buttonsOf(swapped, C.BUTTON_PRESENTATION_ID),
	before.map((n) => ({ ...n, componentId: C.BUTTON_PRESENTATION_ID })),
);
eq('flag on: no button instance is left', buttonsOf(swapped, 'button').length, 0);
eq(
	'flag on: every scene without a button is the SAME scene object',
	swapped.scenes.every(
		(scene, i) =>
			buttonsOf({ scenes: [lines.scenes[i]] }, 'button').length > 0 || scene === lines.scenes[i],
	),
	true,
);
{
	const nested = on({
		...baseDoc(),
		scenes: [
			{
				id: 'hud_custom',
				name: 'Custom HUD',
				space: 'standard',
				nodes: [
					{
						id: 'group',
						kind: 'container',
						x: 10,
						y: 20,
						children: [
							{
								id: 'my-spin',
								kind: 'componentInstance',
								componentId: 'button',
								componentVersion: 1,
								x: 5,
								y: 6,
								scale: { x: 0.5, y: 0.5 },
								params: { action: 'spin', imageSpinning: 'spin.png' },
								overrides: { portrait: { x: 1, y: 2 } },
							},
						],
					},
				],
			},
		],
	} as unknown as LayoutDoc);
	const out = swap(nested);
	const inner = (out.scenes[0].nodes[0] as { children: LayoutNode[] }).children[0];
	eq(
		'every pinned version a doc resolves is listed (each is checked)',
		AB.docButtonVersions(nested),
		[1],
	);
	eq('a nested, moved, pinned, per-layout button is swapped in place, its pin dropped', inner, {
		id: 'my-spin',
		kind: 'componentInstance',
		componentId: C.BUTTON_PRESENTATION_ID,
		x: 5,
		y: 6,
		scale: { x: 0.5, y: 0.5 },
		params: { action: 'spin', imageSpinning: 'spin.png' },
		overrides: { portrait: { x: 1, y: 2 } },
	});
}

// ---- 3. the status rule and the chips ------------------------------------------------------------

const chipsFor = (status: string | undefined) =>
	buildGameProfile({
		gameTypeId: 'lines',
		gameTypeName: 'Lines',
		config: null,
		configSource: 'default',
		symbols: { highlight: false, boardGlow: false } as never,
		runtimeId: null,
		protocol: null,
		layout: { authoredTransition: 'off', authoredWin: 'off', authoredButtons: status },
	} as never)
		.features.filter((c) => c.id.startsWith('authoredButtons'))
		.map((c) => `${c.id}: ${c.text}`);
const custom: ComponentDef = {
	...C.BUTTON_DEF,
	root: {
		...C.BUTTON_DEF.root,
		children: [
			...(C.BUTTON_DEF.root as { children: LayoutNode[] }).children,
			{ id: 'extra', kind: 'rect', x: 0, y: 0, width: 10, height: 10 },
		],
	} as ComponentDef['root'],
};
const withProps = structuredClone(C.BUTTON_DEF);
(withProps.root as { children: LayoutNode[] }).children[0].bind = {
	component: 'ButtonFrame',
	props: { borderWidth: 4 },
};
const lightDefault = {
	...structuredClone(C.BUTTON_DEF),
	params: (C.BUTTON_DEF.params ?? []).map((p) =>
		p.key === 'variant' ? { ...p, default: 'light' } : p,
	),
};
const withInstanceDefaults = {
	...structuredClone(C.BUTTON_DEF),
	defaultInstanceParams: { tint: 1 },
};
const olderCopy = {
	...structuredClone(C.BUTTON_DEF),
	version: 1,
	params: [{ key: 'action', kind: 'string' }],
};
eq(
	'the built-in shape: the built-in, an older baked copy and no def pass; an extra node or frame props do not',
	[
		AB.isBuiltinButtonShape(C.BUTTON_DEF),
		AB.isBuiltinButtonShape(olderCopy as ComponentDef),
		AB.isBuiltinButtonShape(undefined),
		AB.isBuiltinButtonShape(custom),
		AB.isBuiltinButtonShape(withProps),
		AB.isBuiltinButtonShape(lightDefault as ComponentDef),
		AB.isBuiltinButtonShape(withInstanceDefaults as ComponentDef),
	],
	[true, true, true, false, false, false, false],
);
const statusCases: [string, LayoutDoc, boolean, string][] = [
	['off', lines, false, 'off'],
	['ready', on(lines), false, 'ready'],
	[
		'nothing-to-replace (the coded UiButton binds)',
		on(R.defaultLayout('lines')),
		false,
		'nothing-to-replace',
	],
	['nothing-to-replace (Book of)', on(R.bookofReferenceLayout()), false, 'nothing-to-replace'],
	['custom-button', on(lines), true, 'custom-button'],
];
for (const [label, doc, shadowed, expected] of statusCases) {
	const status = AB.authoredButtonsStatus(doc, { shadowed });
	eq(`status: ${label}`, status, expected);
	eq(
		`status: ${label} — a held-back doc is the SAME object`,
		status === 'ready' || swap(doc, shadowed) === doc,
		true,
	);
}
eq(
	'the chips agree with the rule',
	['off', 'ready', 'nothing-to-replace', 'custom-button', undefined].map(chipsFor),
	[
		[],
		['authoredButtons: Authored buttons (pilot)'],
		['authoredButtonsHeld: Authored buttons on, held back: nothing to replace'],
		[
			"authoredButtonsHeld: Authored buttons on, held back: the project's own Button component draws something else",
		],
		[],
	],
);

// ---- 4. the look ---------------------------------------------------------------------------------

/** `ButtonFrame.svelte`'s own derivation, transcribed (the file is pinned below). */
function codedFrame(
	params: Record<string, unknown>,
	f: Parameters<typeof BS.resolveButtonLook>[1],
) {
	const str = (k: string) =>
		typeof params[k] === 'string' && params[k] !== '' ? (params[k] as string) : undefined;
	const stateImage = BS.resolveButtonStateImage(params, f);
	const frameImage = stateImage ?? str('image');
	const paintDisabled = f.disabled && str('imageDisabled') === undefined;
	const paintActive = f.active && str('imageSelected') === undefined;
	const rotating = f.spinning && str('imageSpinning') !== undefined;
	if (frameImage)
		return { look: paintDisabled ? 'imageDisabled' : 'image', frame: frameImage, rotating };
	const look = `tile${paintDisabled ? 'Disabled' : ''}${paintActive ? 'Active' : ''}`;
	return { look, rotating };
}
const IMAGE_KEYS = BS.BUTTON_STATE_IMAGE_KEYS;
const flagSets = Array.from({ length: 32 }, (_, i) => ({
	hovered: !!(i & 1),
	pressed: !!(i & 2),
	disabled: !!(i & 4),
	active: !!(i & 8),
	spinning: !!(i & 16),
}));
let lookMismatches = 0;
let lookCases = 0;
let greyDropped = 0;
for (let mask = 0; mask < 1 << IMAGE_KEYS.length; mask++) {
	const params: Record<string, unknown> = {};
	IMAGE_KEYS.forEach((key, i) => {
		if (mask & (1 << i)) params[key] = `${key}.png`;
	});
	for (const f of flagSets) {
		lookCases++;
		const a = BS.resolveButtonLook(params, f);
		const e = codedFrame(params, f);
		if (JSON.stringify(a) !== JSON.stringify(e)) lookMismatches++;
		if (a.look === 'imageDisabled' && JSON.stringify({ ...a, look: 'image' }) !== JSON.stringify(e))
			greyDropped++;
	}
}
eq(`the look equals the coded frame's in all ${lookCases} cases`, lookMismatches, 0);
eq(
	'an empty image param is unset (a cleared editor field)',
	BS.resolveButtonLook({ image: '', imageDisabled: '' }, { ...flagSets[0], disabled: true }),
	{ look: 'tileDisabled', rotating: false },
);

// ---- 5. the def and its machine ------------------------------------------------------------------

const def = C.BUTTON_PRESENTATION_DEF;
eq(
	'the def is internal, frame-exact, button-stated, in the built-in list',
	[def.internal, def.frameExact, def.buttonStates, C.BUILTIN_COMPONENTS.includes(def)],
	[true, true, true, true],
);
eq(
	'the def is offered to no kind',
	['lines', 'ways', 'bookOf', 'cluster', 'scatter', 'holdAndWin'].some((kind) =>
		C.componentOfferedForKind(def, kind),
	),
	false,
);
eq(
	"the def carries every one of button's params, then fadeWithUi (off)",
	(def.params ?? []).map((p) => p.key),
	[...(C.BUTTON_DEF.params ?? []).map((p) => p.key), 'fadeWithUi'],
);
eq(
	'buttonStates and frameExact are set by this def alone among the built-ins',
	C.BUILTIN_COMPONENTS.filter((d) => d.buttonStates).map((d) => d.id),
	[C.BUTTON_PRESENTATION_ID],
);
eq('the machine validates', M.validateStateMachine(def.stateMachine!, I.componentInputs(def)), []);
L.registerComponentTimelines(B.BUILTIN_TIMELINES);
const { docs, durations } = L.instanceTimelineDocs(def.id, def.stateMachine);
const named = def.stateMachine!.layers.flatMap((l) => l.states.map((s) => s.timeline));
eq(
	'every state plays a built-in timeline',
	named.filter((id) => !durations.has(id)),
	[],
);
eq(
	'no button timeline plays on a signal of its own (only the machine plays them)',
	B.BUTTON_TIMELINES.filter((d) => d.playOn).map((d) => d.id),
	[],
);
eq(
	'every timeline binds only the def’s nodes',
	B.BUTTON_TIMELINES.flatMap((d) =>
		N.validateNodeActors(d, { id: '', name: '', nodes: def.root.children }).map(
			(issue: { message?: string; code?: string }) => `${d.id}: ${issue.code ?? issue.message}`,
		),
	),
	[],
);
eq(
	'timeline ids are lower-case (a project timeline can shadow one)',
	B.BUTTON_TIMELINES.every((d) => d.id === d.id.toLowerCase()),
	true,
);

const machine = () =>
	new M.ComponentStateMachineRunner(def.stateMachine!, I.componentInputs(def), durations, (key) =>
		key === 'fadeWithUi' ? false : undefined,
	);
const player = () => new L.ComponentTimelinePlayer(docs, def.root.children);
const drive = (
	runner: InstanceType<typeof M.ComponentStateMachineRunner>,
	p: InstanceType<typeof L.ComponentTimelinePlayer>,
) => runner.plays().flatMap((play, index) => p.drive(play.layer, index, play));
const nodeIdOf = (label: string) =>
	nodesOf([def.root]).find((n) => n.label === label)?.id ?? `missing:${label}`;
{
	const runner = machine();
	const p = player();
	drive(runner, p);
	const shown = () => BS.BUTTON_LOOKS.filter((look) => p.sample(nodeIdOf(look))?.visible !== false);
	eq(
		'at mount the look is the plain tile, alone',
		[runner.stateOf('look'), shown()],
		['tile', ['tile']],
	);
	const seen: [string | undefined, string[]][] = [];
	for (const [index, look] of BS.BUTTON_LOOKS.entries()) {
		runner.setInput('look', index);
		runner.advance(0);
		drive(runner, p);
		seen.push([runner.stateOf('look'), shown()]);
		void look;
	}
	eq(
		'each look input enters its look at once (a zero-length step), showing exactly its node',
		seen,
		BS.BUTTON_LOOKS.map((look) => [look, [look]]),
	);
	// The turn.
	const frame = nodeIdOf('frame');
	runner.setInput('rotating', true);
	runner.advance(0);
	drive(runner, p);
	const turn: number[] = [];
	for (let i = 0; i < 4; i++) {
		runner.advance(0.25);
		drive(runner, p);
		turn.push(Math.round(Number(p.sample(frame)?.rotation ?? 0) * 1000) / 1000);
	}
	eq(
		'rotating: 360° a second, linear, looping (90, 180, 270, then 0 at the wrap)',
		turn,
		[90, 180, 270, 0],
	);
	runner.advance(1 / 60);
	drive(runner, p);
	eq(
		'rotating: one frame past the wrap is one frame of turn',
		Math.round(Number(p.sample(frame)?.rotation) * 1000) / 1000,
		6,
	);
	runner.setInput('rotating', false);
	runner.advance(0);
	drive(runner, p);
	eq('stopped: upright at once', [runner.stateOf('spin'), p.sample(frame)?.rotation], ['still', 0]);
	// The fade.
	runner.fire('uiHide');
	runner.advance(0);
	eq(
		'uiHide without fadeWithUi: the button stays shown (the HUD fades it)',
		runner.stateOf('fade'),
		'shown',
	);
	runner.setInput('fadeWithUi', true);
	runner.fire('uiHide');
	runner.advance(0);
	drive(runner, p);
	const fade = nodeIdOf('fade');
	runner.advance(0.2);
	drive(runner, p);
	const mid = Math.round(Number(p.sample(fade)?.alpha) * 100) / 100;
	runner.advance(0.2);
	drive(runner, p);
	eq(
		'uiHide with fadeWithUi: hidden, a 400 ms blend (0.5 at 200 ms, 0 at 400 ms)',
		[runner.stateOf('fade'), mid, p.sample(fade)?.alpha],
		['hidden', 0.5, 0],
	);
	runner.fire('uiShow');
	runner.advance(0);
	eq('uiShow: shown again', runner.stateOf('fade'), 'shown');
	// The sounds.
	const cues: string[] = [];
	for (const sound of ['soundPressBet', 'soundPressBet', 'soundPressStop', 'soundPressGeneral']) {
		runner.fire(sound);
		runner.advance(0);
		cues.push(...drive(runner, p).map((c) => c.cue));
	}
	eq(
		'a press sound enters (and re-enters) its state and crosses its bare event at 0, once per press',
		cues,
		['soundPressBet', 'soundPressBet', 'soundPressStop', 'soundPressGeneral'],
	);
	runner.advance(1);
	eq('a sound crosses once, never again on later ticks', drive(runner, p), []);
	eq(
		'the press sounds are the coded ones',
		[...C.BUTTON_PRESS_SOUNDS],
		['soundPressGeneral', 'soundPressBet', 'soundPressStop'],
	);
}

// ---- 6. the hand-off -----------------------------------------------------------------------------

{
	const handed: string[] = [];
	const outside = P.handOffPressSound('soundPressGeneral');
	let inside = false;
	P.claimPressSound(
		(sound) => {
			handed.push(sound);
			return true;
		},
		() => {
			inside = P.handOffPressSound('soundPressBet');
		},
	);
	let declined = true;
	P.claimPressSound(
		() => false,
		() => {
			declined = P.handOffPressSound('soundPressStop');
		},
	);
	try {
		P.claimPressSound(
			() => true,
			() => {
				throw new Error('press failed');
			},
		);
	} catch {
		// The claim must be released all the same.
	}
	eq(
		'unclaimed ⇒ broadcast; claimed ⇒ handed over; declined ⇒ broadcast; a throw releases the claim',
		[outside, inside, handed, declined, P.handOffPressSound('soundPressGeneral')],
		[false, true, ['soundPressBet'], false, false],
	);
}

// ---- 7. the lock is lifted (owner browser check passed, 2026-10-17) ------------------------------

{
	const off = { settings: {} };
	const onDoc = { settings: { authoredOverlays: { buttons: true } } };
	const decide = (before: object, after: object, canPublish: boolean, stale = false) =>
		G.authoredOverlaySaveDecision({
			before,
			after,
			canPublish,
			baseEtag: stale ? 'old' : 'e1',
			storedEtag: 'e1',
		} as Parameters<typeof G.authoredOverlaySaveDecision>[0]);
	eq(
		'the lock symbols are gone',
		['AUTHORED_BUTTONS_LOCKED' in G, 'submitsButtonsOn' in G, 'lockedOverlaySwitchedOn' in G],
		[false, false, false],
	);
	eq(
		'a publisher may switch it on; a non-publisher may not; off is allowed; stale conflicts first',
		[
			decide(off, onDoc, true),
			decide(off, onDoc, false),
			decide(onDoc, off, true),
			decide(onDoc, onDoc, false),
			decide(off, onDoc, true, true),
		],
		['write', 'forbidden', 'write', 'write', 'conflict'],
	);
	const page = src('../src/routes/(app)/editor/+page.svelte');
	eq(
		'the Game Settings row is enabled for publishers, no "pilot pending"',
		[
			/checked=\{authoredButtons\}\s*disabled=\{!data\.canPublishShared\}/.test(page),
			page.includes('<span>Buttons</span>'),
			page.includes('pilot pending'),
		],
		[true, true, false],
	);
	eq(
		'the save action has no locked decision',
		/locked-|submits\w+On/.test(src('../src/routes/(app)/editor/+page.server.ts')),
		false,
	);
}

// ---- 8. the wiring, by source --------------------------------------------------------------------

{
	const game = src('../../lines/src/components/Game.svelte');
	eq(
		'every coded press body broadcasts its sound through pressFeedback, none directly',
		[
			/eventEmitter\.broadcast\(\{ type: 'soundPressGeneral' \}\)/.test(game),
			(game.match(/pressFeedback\(\{ type: 'soundPressGeneral' \}\)/g) ?? []).length >= 12,
			game.includes('pressFeedback(getSpinPressSound('),
			game.includes('if (!handOffPressSound(event.type)) context.eventEmitter.broadcast(event);'),
		],
		[false, true, true, true],
	);
	const block = game.slice(
		game.indexOf('void loadEditorScenes().then((loadedDoc) => {'),
		game.indexOf('const authored = authoredTransitionStatus(rawDoc)'),
	);
	eq(
		'the game swaps the buttons first and registers the def, the fade signals and the defaults in its flag block only',
		[
			block.includes(
				'const rawDoc = authoredButtons ? withAuthoredButtonsDoc(loadedDoc) : loadedDoc;',
			),
			block.includes('if (authoredButtons) {'),
			(game.match(/BUTTON_PRESENTATION_DEF\.id\]: BUTTON_PRESENTATION_DEF/g) ?? []).length,
			block.includes('BUTTON_PRESENTATION_DEF.id]: BUTTON_PRESENTATION_DEF'),
			block.includes('[BUTTON_STATE_INPUTS.uiHide]'),
			block.includes("getComponentDefaults('button')"),
		],
		[true, true, 1, true, true, true],
	);
	eq(
		'the dev pilot is off, and no URL opts in',
		[
			src('../../lines/src/game/editorFlags.ts').includes('export const AUTHORED_BUTTONS = false;'),
			/authoredButtons|AUTHORED_BUTTONS/.test(src('../../lines/src/game/determinism.ts')),
		],
		[true, false],
	);
	const instance = src('../../../packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		"a buttonStates def's press sounds stay off the open signal bus (only its own press fires them)",
		instance.includes(
			'(s) => !buttonStates || !(BUTTON_PRESS_SOUNDS as readonly string[]).includes(s),',
		),
		true,
	);
	eq(
		'the game checks every pinned button version before the swap; so does the chip',
		[
			game.includes('shadowed: !docButtonVersions(loadedDoc).every((version) =>'),
			src('../src/routes/(app)/game-maker/+page.server.ts').includes(
				'shadowed: !buttonDefs.every(isBuiltinButtonShape)',
			),
		],
		[true, true],
	);
	eq(
		"the authored frame reads the image params per layout, with the coded frame's flags",
		[
			instance.includes('resolveButtonLook(buttonImageParams(), buttonFlags())'),
			instance.includes('get: () => resolveButtonLook(buttonImageParams(), buttonFlags()).frame,'),
		],
		[true, true],
	);
	eq(
		'a settling timeline drive (identity rotation / alpha handed to the node) is set by the def (ComponentDef.settles), which the button sets',
		[
			instance.includes('const settles = allowed && def?.settles === true;'),
			instance.includes('...(settles ? { settles: true as const } : {})'),
			C.BUTTON_PRESENTATION_DEF.settles,
		],
		[true, true, true],
	);
	eq(
		'buttonStates is read by ComponentInstance alone',
		[
			instance.includes('def?.buttonStates === true'),
			src('../../../packages/engine-layout/src/lib/LayoutNodeView.svelte').includes('buttonStates'),
		],
		[true, false],
	);
	eq(
		'the press road and the coded parts are byte-identical to main',
		Object.entries(PINNED)
			.filter(([rel, hash]) => sha(rel) !== hash)
			.map(([rel]) => rel),
		[],
	);
}

// ---- 9. negative controls ------------------------------------------------------------------------

eq(
	'NEGATIVE CONTROL: the flag-off identity check reports a swap that copies the doc',
	offIsIdentity((doc) => ({ ...doc })),
	false,
);
eq(
	'NEGATIVE CONTROL: a doc with the flag on is NOT returned as the same object',
	(() => {
		const flagged = on(lines);
		return swap(flagged) === flagged;
	})(),
	false,
);
eq(
	'NEGATIVE CONTROL: a look rule that drops the grey would be caught by the look check',
	greyDropped > 0,
	true,
);

console.log(
	`\n${failures === 0 ? '✅' : '❌'} authored buttons: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
