/**
 * Invisible Flow v2 — the FULLY FLOW-DRIVEN starter seed for a NEW project.
 *
 * Unlike `BOOK_OF_REFERENCE_DOC` (the `apps/lines` book-events-only reference, which leaves screen
 * mounting to the coded path), this doc OWNS `load` (a wired `gameSignals.load` pin), so at runtime
 * `flowV2DrivesScreens` is true and `<FlowV2Mount>` becomes the SOLE screen renderer. A driven flow
 * therefore MUST `showContainer` every screen that must be visible — the coded HUD / free-spin /
 * special-book mounts all go inert under `flowV2DrivesScreens`. This seed does exactly that, using
 * ONLY the CANONICAL scaffold scene ids a fresh book-of project has (no Borut-specific custom ids):
 *
 *   `loading`, `basegame`, `hudBar`, `hudCorners`, `specialBook`,
 *   `freeSpinCounter`, `freeSpinIntro`, `freeSpinOutro`
 *
 * (`background` is engine-drawn `space:'background'` — NOT a flow container; `basegameOverlays` — the
 * win line + transition — renders UNCONDITIONALLY in `Game.svelte`, so it is deliberately NOT shown.)
 *
 * Structure (modelled on Book of Borut's PROVEN live driven flow, canonicalised):
 *   - `gameSignals.load`            → show `loading`.
 *   - `event complete:loading`      → hide `loading` + show the game (fired by the loading bar's
 *     `completeOnLoaded` auto-advance OR a tap — the robust trigger that does not require a tap).
 *   - `gameSignals.tapToStart`      → unlock audio (`soundMusic bgm_main`) + the SAME show set again
 *     (idempotent belt-and-suspenders for a tap-to-start loading screen).
 *   - every book event (`reveal`/`winInfo`/`setTotalWin`/`setExpandingSymbol`/`expandBookColumns`/
 *     `freeSpinTrigger`/`updateFreeSpin`/`freeSpinEnd`/`setWin`) → its canonical `BOOK_OF_CHOREO`
 *     choreography, wired off the matching `gameSignals` pin.
 *
 * OVERLAY VISIBILITY MODEL (mirrors the coded path, avoids the show-then-cue race —
 * see gotcha "reveal cue before host screen"): the free-spin + special-book screens are MOUNTED
 * once (on start) and their internal visibility is toggled by the book-event cues their bound
 * components already subscribe to (`freeSpinCounterShow`, `specialBookReveal`, `freeSpinIntroShow`,
 * `freeSpinOutroShow`, …). So there is no per-event show/hide timing to get wrong: a mounted-but-idle
 * overlay renders nothing until its cue fires. The HUD BUTTONS are NOT wired to flow intents — the
 * canonical bind-based `hudBar` buttons carry no universal `action` param, so they surface no fused
 * pins; their coded `onpress` fires when `hudBar` is mounted (parity), which is what makes Spin work.
 *
 * ⚠️ Needs a runtime release + LIVE owner verification before it is trusted, since it becomes the
 * default for EVERY new project. Legs to verify live: the free-spin OUTRO COUNT-UP in particular
 * (`freeSpinEnd` fires `freeSpinOutroCountUp`, whose subscriber historically lived in the coded
 * `FreeSpinOutroGate` that is suppressed under a driven flow — Borut renders it, but whether the
 * CANONICAL `freeSpinOutro` scene's bound `FreeSpinOutro` component carries the count-up is unproven
 * headlessly).
 */

import { REPEATER_SELECT_EVENT, REPEATER_SELECTED_KEY } from 'constants-shared/repeater';

import { buildConfirmGate } from '../builders/confirmGate';
import {
	componentSignalConfiguredEvents,
	containerEventDeclId,
	deriveContainerEvents,
	repeaterSelectConfiguredEvent,
} from '../containerEvents';
import type {
	ContainerEventDecl,
	DataEdge,
	ExecEdge,
	FlowDoc,
	FunctionLibraryDoc,
	Node,
} from '../types';
import {
	BOOK_OF_CHOREO,
	buildChoreo,
	enumLit,
	makeChoreoUid,
	type ChoreoStep,
} from './bookOfChoreo';

// Canonical scaffold container ids (a fresh book-of project's scenes).
const LOADING = 'loading';
const BASEGAME = 'basegame';
const HUD_BAR = 'hudBar';
const HUD_CORNERS = 'hudCorners';
const SPECIAL_BOOK = 'specialBook';
const FS_COUNTER = 'freeSpinCounter';
const FS_INTRO = 'freeSpinIntro';
const FS_OUTRO = 'freeSpinOutro';

/** Every screen the driven game shows once play begins (mounted; cue-driven internal visibility). */
const GAME_SCREENS = [
	BASEGAME,
	HUD_BAR,
	HUD_CORNERS,
	SPECIAL_BOOK,
	FS_COUNTER,
	FS_INTRO,
	FS_OUTRO,
] as const;

const GS_NODE = 'game_signals';
const uid = makeChoreoUid();
const nodes: Node[] = [{ id: GS_NODE, kind: 'gameSignals', pos: { x: 0, y: -200 } }];
const exec: ExecEdge[] = [];
const data: DataEdge[] = [];

/** One linear beat: mount/unmount a container, or run a choreography fragment. */
type Beat = { k: 'show' | 'hide'; id: string } | { k: 'steps'; steps: ChoreoStep[] };

interface BuiltBeat {
	entry: string;
	tail: { node: string; pin: string };
}

const buildBeat = (beat: Beat, row: number): BuiltBeat => {
	if (beat.k === 'steps') {
		const sub = buildChoreo(beat.steps, uid);
		sub.nodes.forEach((n, i) => (n.pos = { x: 0, y: row * 40 + i * 20 }));
		nodes.push(...sub.nodes);
		exec.push(...sub.exec);
		data.push(...sub.data);
		// Every step list here is linear, so it has exactly one entry + one tail.
		return { entry: sub.entry!, tail: sub.tails[0] };
	}
	const id = uid(beat.k);
	nodes.push({
		id,
		kind: beat.k === 'show' ? 'showContainer' : 'hideContainer',
		pos: { x: 0, y: row * 40 },
		ref: beat.id,
	});
	return { entry: id, tail: { node: id, pin: 'exec' } };
};

/** Chain `beats` linearly and wire the run's entry off `fromPin` of `fromNode`. */
const wireChain = (fromNode: string, fromPin: string, beats: Beat[], row: number): void => {
	let firstEntry: string | null = null;
	let prevTail: { node: string; pin: string } | null = null;
	for (const beat of beats) {
		const built = buildBeat(beat, row);
		if (!firstEntry) firstEntry = built.entry;
		if (prevTail) exec.push({ from: prevTail, to: { node: built.entry, pin: 'exec' } });
		prevTail = built.tail;
	}
	if (firstEntry)
		exec.push({ from: { node: fromNode, pin: fromPin }, to: { node: firstEntry, pin: 'exec' } });
};

/** Mount every game screen (basegame reel + HUD + free-spin/special overlays). Idempotent. */
const showGame = (): Beat[] => GAME_SCREENS.map((id) => ({ k: 'show', id }) as Beat);

// --- Lifecycle chains -------------------------------------------------------

// load → show the loading splash. (`gameSignals.load` wired ⇒ `flowV2DrivesScreens` is true.)
wireChain(GS_NODE, 'load', [{ k: 'show', id: LOADING }], 0);

// complete:loading → the real loading→game transition. Fired by the loading bar's `completeOnLoaded`
// auto-advance OR a tap-to-continue (both route through `dispatchFlowV2Complete`). An `event` node
// (not a gameSignals pin — `complete:<id>` is not a vocab signal); validates as a real container id.
const completeLoading = 'ev_complete_loading';
nodes.push({
	id: completeLoading,
	kind: 'event',
	pos: { x: 0, y: 40 },
	ref: `complete:${LOADING}`,
});
wireChain(completeLoading, 'exec', [{ k: 'hide', id: LOADING }, ...showGame()], 1);

// tapToStart → unlock audio + (idempotently) mount the game, for a tap-to-start loading screen.
wireChain(
	GS_NODE,
	'tapToStart',
	[
		{
			k: 'steps',
			steps: [{ k: 'cue', ref: 'soundMusic', inputs: { name: enumLit('MusicName', 'bgm_main') } }],
		},
		{ k: 'hide', id: LOADING },
		...showGame(),
	],
	2,
);

// --- Book-event choreography (canonical BOOK_OF_CHOREO, wired off each gameSignals pin) ----------
// The overlays are already mounted (above), so these choreos' cues toggle the components' internal
// visibility — no per-event showContainer needed. `reveal` is wired SEPARATELY below (its chain is
// prefixed with the "Good luck" message flash), so skip it here — an exec-out fans to only ONE edge,
// so the message show + the choreo cannot both hang off `gameSignals.reveal` directly.
Object.entries(BOOK_OF_CHOREO).forEach(([event, steps], i) => {
	if (event === 'reveal') return;
	wireChain(GS_NODE, event, [{ k: 'steps', steps }], 4 + i);
});

// --- §6.3 In-game Text Messages (the two editable, auto-localized defaults) -----------------------
// These are the "generic text message" primitive the owner asked for: a line of authored text drawn
// on the game canvas, its text harvested into Invisible Localization, its VISIBILITY driven either by
// a reactive STATE-GATE or by the flow graph. Both are editable/removable in the /flow-v2 inspector.
const MSG_CLICK_SPIN = 'msg_click_spin';
const MSG_GOOD_LUCK = 'msg_good_luck';

// (1) "Click spin button to start" — ALWAYS visible while the reels are idle. Pure state-gate
// (`visibleWhile:'idle'`), NO wiring: the game shows it whenever `stateXstateDerived.isIdle()` and
// hides it the instant a spin leaves idle. This is the sustained-state case flow events can't express.
nodes.push({
	id: MSG_CLICK_SPIN,
	kind: 'textMessage',
	pos: { x: 320, y: -140 },
	text: 'Click spin button to start',
	place: { x: 0.5, y: 0.86 },
	visibleWhile: 'idle',
});

// (2) "Good luck" — a BRIEF flash at the start of each spin. Flow-driven: shown when the round's
// first book event (`reveal`) fires, auto-hidden after ~1.2s (turbo-scaled). Prefixed onto the reveal
// choreo so it flashes as the reels start, then the normal reveal presentation runs. `reveal` fires
// every spin (manual + autoplay), so the flash is not limited to manual presses.
nodes.push({
	id: MSG_GOOD_LUCK,
	kind: 'textMessage',
	pos: { x: 320, y: -80 },
	text: 'Good luck',
	place: { x: 0.5, y: 0.45 },
	visibleWhile: 'none',
	autoHideMs: 1200,
});

// Build the reveal choreo as its own linear chain, then wire: gameSignals.reveal ▶ goodLuck.show ▶
// (goodLuck continues immediately — show is non-blocking) ▶ the reveal choreo entry.
const revealSub = buildChoreo(BOOK_OF_CHOREO.reveal, uid);
revealSub.nodes.forEach((n, i) => (n.pos = { x: 0, y: 4 * 40 + i * 20 }));
nodes.push(...revealSub.nodes);
exec.push(...revealSub.exec);
data.push(...revealSub.data);
exec.push(
	{ from: { node: GS_NODE, pin: 'reveal' }, to: { node: MSG_GOOD_LUCK, pin: 'show' } },
	{ from: { node: MSG_GOOD_LUCK, pin: 'exec' }, to: { node: revealSub.entry!, pin: 'exec' } },
);

// --- Buy-bonus subgraph (Phase 3 Step 5 — the buy flow authored end-to-end in Flow) --------------
// OPT-IN ONLY: this doc is loaded by `apps/lines` solely via `?flowV2=lines` / `__IE_FLOW_V2_LINES__`
// / the baked bundle, and is the seed for a NEW driven project. The DEFAULT apps/lines (no flow mode)
// has no baked doc ⇒ v2 inert ⇒ the imperative `stateModal` buy path runs unchanged; coded games
// never load this doc. Owning `buyBonus` here makes `routeActionThroughFlow('buyBonus', …)` dispatch
// the intent into the flow (the imperative `stateModal` buy modal is never opened), and the two
// container-event pins own the repeater's `onSelect` + the confirm dialog's `onConfirm`/`onCancel`, so
// the repeater/confirm press gates route those presses to the flow ALONE and the imperative
// `<BuyFeatureScreen>`/`<ConfirmDialog>` mounts stay suppressed.
//
// Macro shape:
//   event buyBonus ▶ Show(buyFeature)
//   buyFeature.<repeater>.onSelect(betModeKey) ▶ selectBetMode(betModeKey) ▶ Hide(buyFeature) ▶ Show(buyConfirm)
//   buyConfirm.<confirmDialog>.onConfirm ▶ commitBuyBonus ▶ Hide(buyConfirm)
//   buyConfirm.<confirmDialog>.onCancel ▶ Hide(buyConfirm) ▶ Show(buyFeature)  (a SECOND show node — an
//     exec-in takes at most one predecessor, so the cancel path re-mounts buyFeature via its own node;
//     the runtime keys `onSelect` ownership by componentId, so a card press still routes to the FIRST
//     node's wired `onSelect` edge whichever show node re-mounted the menu.)
const BUY_FEATURE = 'buyFeature';
const BUY_CONFIRM = 'buyConfirm';
// The scene-node ids of the two takeovers' interactive components (the DEFAULT `buyFeatureScene` /
// `confirmScene` ids every reference layout seeds verbatim). These are the container-event pins'
// `componentId`s — the SAME id the runtime's press gate passes (`node.id` of the placed instance).
const FEATURE_REPEATER = 'buy-feature-cards';
const CONFIRM_DIALOG = 'confirm-dialog';
const SELECT_PIN = containerEventDeclId(FEATURE_REPEATER, REPEATER_SELECT_EVENT);
const SELECT_KEY_PIN = `${SELECT_PIN}.${REPEATER_SELECTED_KEY}`;

// The PRE-GATE part (intent ▶ show the select menu; a card press arms the mode + swaps to confirm).
const BUY = {
	event: 'buy_event',
	showFeature: 'buy_showFeature',
	arm: 'buy_selectBetMode',
	hideFeature: 'buy_hideFeature',
} as const;

nodes.push(
	{ id: BUY.event, kind: 'event', pos: { x: 500, y: 0 }, ref: 'buyBonus' },
	{ id: BUY.showFeature, kind: 'showContainer', pos: { x: 500, y: 40 }, ref: BUY_FEATURE },
	{ id: BUY.arm, kind: 'action', pos: { x: 500, y: 80 }, ref: 'selectBetMode' },
	{ id: BUY.hideFeature, kind: 'hideContainer', pos: { x: 500, y: 120 }, ref: BUY_FEATURE },
);

// The confirm-gate PORTION is the reusable `ConfirmGatedAction` unit (Phase 3 Step 6): Show(buyConfirm)
// → confirm ▶ commitBuyBonus ▶ Hide(buyConfirm); cancel ▶ Hide(buyConfirm) ▶ Show(buyFeature). It is
// spliced in as TOP-LEVEL nodes/edges (NOT a `group`: `flowOwnsContainerEvent` reads the RAW graph, so a
// grouped confirm dialog's `onConfirm`/`onCancel` would be invisible to the ownership predicate and the
// coded press would double-fire). See `builders/confirmGate.ts` for the mechanism decision.
const buyConfirmGate = buildConfirmGate({
	idPrefix: 'buy',
	promptContainerId: BUY_FEATURE,
	confirmContainerId: BUY_CONFIRM,
	confirmComponentId: CONFIRM_DIALOG,
	onConfirmedActionRef: 'commitBuyBonus',
	pos: { x: 500, y: 160 },
});
nodes.push(...buyConfirmGate.nodes);

exec.push(
	// intent ▶ show the select menu.
	{ from: { node: BUY.event, pin: 'exec' }, to: { node: BUY.showFeature, pin: 'exec' } },
	// a card press (fused onSelect) ▶ arm the picked mode ▶ swap select → confirm (the gate's entry).
	{ from: { node: BUY.showFeature, pin: SELECT_PIN }, to: { node: BUY.arm, pin: 'exec' } },
	{ from: { node: BUY.arm, pin: 'exec' }, to: { node: BUY.hideFeature, pin: 'exec' } },
	{ from: { node: BUY.hideFeature, pin: 'exec' }, to: buyConfirmGate.entry },
	// confirm ▶ commit ▶ Hide; cancel ▶ Hide ▶ re-Show buyFeature — all from the reusable confirm gate.
	...buyConfirmGate.exec,
);

// The pressed card's key flows through the fused data-out into `selectBetMode`'s `betModeKey` data-in.
data.push({
	from: { node: BUY.showFeature, pin: SELECT_KEY_PIN },
	to: { node: BUY.arm, pin: REPEATER_SELECTED_KEY },
});

/**
 * The container-event surface the driven seed's BUY subgraph wires its fused pins against — the
 * `buyFeature` repeater's `onSelect` (+ `betModeKey` payload) and the `buyConfirm` dialog's
 * `onConfirm`/`onCancel`. `validateFlowDoc` needs this map to resolve those fused-pin exec/data edges
 * as REAL endpoints (the `/flow-v2` editor derives the equivalent map from the Scene Editor's
 * `buyFeature`/`buyConfirm` scenes). Keyed by ContainerId; the componentIds are the DEFAULT scene-node
 * ids every reference layout seeds. Exported so the seed-validation callers (seed-flow-v2, the driven
 * harness) share ONE source of the buy pins rather than re-deriving them.
 */
export const BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS: Record<string, ContainerEventDecl[]> = {
	[BUY_FEATURE]: deriveContainerEvents([repeaterSelectConfiguredEvent(FEATURE_REPEATER)]),
	[BUY_CONFIRM]: deriveContainerEvents(
		componentSignalConfiguredEvents(CONFIRM_DIALOG, ['confirm', 'cancel']),
	),
};

/** The fully flow-driven new-project starter flow. Owns `load` ⇒ drives every screen. */
export const BOOK_OF_DRIVEN_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	// z is a fallback tiebreak only — the runtime re-stamps each container's z from the Scene-Editor
	// order (`layeredContainers`). Base low, overlays high, splash on top.
	containers: [
		{ id: BASEGAME, sceneId: BASEGAME, z: 0 },
		{ id: FS_COUNTER, sceneId: FS_COUNTER, z: 30 },
		{ id: SPECIAL_BOOK, sceneId: SPECIAL_BOOK, z: 40 },
		{ id: FS_INTRO, sceneId: FS_INTRO, z: 50 },
		{ id: FS_OUTRO, sceneId: FS_OUTRO, z: 50 },
		{ id: HUD_BAR, sceneId: HUD_BAR, z: 60 },
		{ id: HUD_CORNERS, sceneId: HUD_CORNERS, z: 60 },
		// The buy takeovers sit above the HUD (modal) and below the loading splash; the runtime
		// re-stamps the real z from the Scene-Editor screen order, so this is only a fallback tiebreak.
		{ id: BUY_FEATURE, sceneId: BUY_FEATURE, z: 90 },
		{ id: BUY_CONFIRM, sceneId: BUY_CONFIRM, z: 95 },
		{ id: LOADING, sceneId: LOADING, z: 100 },
	],
};

/** The driven seed's function library — empty (the choreographies are linear/forEach chains). */
export const BOOK_OF_DRIVEN_SEED_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

/** A fresh DEEP CLONE of {@link BOOK_OF_DRIVEN_SEED_DOC} — the doc a new project is seeded with so it
 *  owns an independent copy the editor can mutate + save without touching the shared reference. */
export function freshBookOfDrivenSeedDoc(): FlowDoc {
	return JSON.parse(JSON.stringify(BOOK_OF_DRIVEN_SEED_DOC)) as FlowDoc;
}
