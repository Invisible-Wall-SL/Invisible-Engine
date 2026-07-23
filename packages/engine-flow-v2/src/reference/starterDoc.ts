/**
 * Invisible Flow v2 — the canonical REFERENCE book-of flow, built from the template's canonical
 * `BOOK_OF_CHOREO`. A REAL authored flow that drives the WHOLE game (loading → tap → basegame →
 * win / free-spin choreography) WITHOUT authoring online first.
 *
 * This is the single source of truth for that doc: `apps/lines` re-exports it as
 * `LINES_FLOW_V2_DOC` (the v1→v2 migration artifact loaded via `window.__IE_FLOW_V2_LINES__` /
 * the baked bundle), and the launcher SEEDS it into a fresh project's `/flow-v2` editor so a
 * brand-new project opens on a working, editable, saveable flow instead of a throwaway sample.
 * It lives here (not in a game app) because every ingredient — `BOOK_OF_CHOREO`, `buildChoreo`,
 * `makeChoreoUid`, `enumLit` — already lives in this package, so the launcher can import it
 * without depending on a game app.
 *
 * It authors EVERY presentation book event by BUILDING FROM the canonical choreographies (the SAME
 * source the v1→v2 translator injects), transcribed 1:1 from `bookEventHandlerMap.ts`, so when v2
 * OWNS an event it drives it with NO behaviour change. `finalWin` (a coded no-op) and
 * `createBonusSnapshot` (resume orchestration) are ABSENT from `BOOK_OF_CHOREO`, so they stay on
 * their coded handlers / fall through, exactly as v1 did. Validates 0 issues vs `BOOK_OF_VOCAB`.
 */

import type { DataEdge, ExecEdge, FlowDoc, FunctionLibraryDoc, Node } from '../types';
import { buildChoreo, enumLit, makeChoreoUid, BOOK_OF_CHOREO } from './bookOfChoreo';

// Build the graph: each canonical choreography → an `event` node + its wired subgraph, laid out one
// row per event. A single shared uid generator keeps node ids collision-free across every event.
const nodes: Node[] = [];
const exec: ExecEdge[] = [];
const data: DataEdge[] = [];
const uid = makeChoreoUid();

Object.entries(BOOK_OF_CHOREO).forEach(([event, steps], row) => {
	const eventId = `on_${event}`;
	nodes.push({ id: eventId, kind: 'event', pos: { x: 0, y: row * 160 }, ref: event });
	const body = buildChoreo(steps, uid);
	// Auto-position the linear body along the event's row (cosmetic — layout only).
	body.nodes.forEach((n, i) => (n.pos = { x: (i + 1) * 220, y: row * 160 }));
	nodes.push(...body.nodes);
	exec.push(...body.exec);
	data.push(...body.data);
	if (body.entry)
		exec.push({ from: { node: eventId, pin: 'exec' }, to: { node: body.entry, pin: 'exec' } });
});

// Game Signals — the ONE mechanic-signal source node. Its `onTapToStart` exec-out (the `tapToStart`
// lifecycle pin) fires when the player first taps the loading "tap to continue" prompt: the flow holder
// dispatches `tapToStart` once, on the first screen COMPLETE after `load` (`flowV2InterpreterHolder`).
// Wire it to START the background music, so — under a v2 flow that drives the loading screen — `bgm_main`
// begins on that first interaction, NOT at boot (`Sound.svelte` suppresses its boot autoplay when the
// flow drives screens). This is the flow-authored home for the vocabulary's "unlock audio on tap" note.
const signalsId = 'game_signals';
nodes.push({ id: signalsId, kind: 'gameSignals', pos: { x: 0, y: -160 } });
const tapToStartMusic = buildChoreo(
	[{ k: 'cue', ref: 'soundMusic', inputs: { name: enumLit('MusicName', 'bgm_main') } }],
	uid,
);
tapToStartMusic.nodes.forEach((n, i) => (n.pos = { x: (i + 1) * 220, y: -160 }));
nodes.push(...tapToStartMusic.nodes);
exec.push(...tapToStartMusic.exec);
data.push(...tapToStartMusic.data);
if (tapToStartMusic.entry)
	exec.push({
		from: { node: signalsId, pin: 'tapToStart' },
		to: { node: tapToStartMusic.entry, pin: 'exec' },
	});

/** The canonical reference v2 book-of flow — every presentation event, built from the template's
 *  canonical `BOOK_OF_CHOREO`. Validates 0 issues vs `BOOK_OF_VOCAB`. Treat as IMMUTABLE: seed a
 *  deep clone (`freshBookOfFlowDoc`) before editing so a fresh project owns its own copy. */
export const BOOK_OF_REFERENCE_DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	// The basegame scene persists under everything; overlays (specialBook / win / free-spin intro /
	// counter / outro) are coded-mounted + feed-driven (gated by `visibleSource`), exactly as v1 —
	// the flow fires their cues, it does not mount them as containers.
	containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
};

/** The canonical reference v2 function library (empty — the events are linear/forEach chains). */
export const BOOK_OF_REFERENCE_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

/** A fresh DEEP CLONE of {@link BOOK_OF_REFERENCE_DOC} — the doc a new project is seeded with so it
 *  owns an independent copy the editor can mutate + save without touching the shared reference. */
export function freshBookOfFlowDoc(): FlowDoc {
	return JSON.parse(JSON.stringify(BOOK_OF_REFERENCE_DOC)) as FlowDoc;
}
