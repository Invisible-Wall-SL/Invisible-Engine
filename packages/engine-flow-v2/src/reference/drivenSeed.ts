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

import type { DataEdge, ExecEdge, FlowDoc, FunctionLibraryDoc, Node } from '../types';
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
// visibility — no per-event showContainer needed.
Object.entries(BOOK_OF_CHOREO).forEach(([event, steps], i) => {
	wireChain(GS_NODE, event, [{ k: 'steps', steps }], 4 + i);
});

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
