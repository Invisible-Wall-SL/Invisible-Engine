/**
 * Invisible Flow v2 — the committed REFERENCE book-of flow for apps/lines (the v1→v2 migration
 * artifact). The v2 analogue of v1's `LINES_FLOW_DOC` (`flowDoc.ts`): a REAL authored flow, held in
 * the repo so v2 can drive the WHOLE game WITHOUT authoring online first — loaded via the
 * `window.__IE_FLOW_V2_LINES__` dev global (mirroring v1's `__IE_FLOW_LINES__`) or shipped through
 * the baked bundle (`bakedFlowV2Doc()`).
 *
 * It authors EVERY presentation book event by BUILDING FROM the template's canonical choreographies
 * (`BOOK_OF_CHOREO`, engine-flow-v2/reference) — the SAME source the v1→v2 translator injects into a
 * migrated game — so the reference flow and any translated game share one honest presentation. The
 * choreographies are transcribed 1:1 from `bookEventHandlerMap.ts`, so when v2 OWNS an event (event
 * ownership, `game/utils.ts`) it drives it with NO behaviour change (the "make it work like it is
 * now" migration).
 *
 * `finalWin` (a coded no-op) and `createBonusSnapshot` (resume orchestration — re-dispatches reserved
 * events through the play path, not presentation) are ABSENT from `BOOK_OF_CHOREO`, so they stay on
 * their coded handlers / fall through, exactly as v1 did. When every OTHER event is owned + verified,
 * the coded `bookEventHandlerMap` + v1 become dead code — the full-flow-driven end state.
 */

import {
	buildChoreo,
	makeChoreoUid,
	BOOK_OF_CHOREO,
	type DataEdge,
	type ExecEdge,
	type FlowDoc as FlowDocV2,
	type FunctionLibraryDoc,
	type Node,
} from 'engine-flow-v2';

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

/** The committed reference v2 book-of flow — every presentation event, built from the template's
 *  canonical `BOOK_OF_CHOREO`. Validates 0 issues vs `BOOK_OF_VOCAB`. */
export const LINES_FLOW_V2_DOC: FlowDocV2 = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	// The basegame scene persists under everything; overlays (specialBook / win / free-spin intro /
	// counter / outro) are coded-mounted + feed-driven (gated by `visibleSource`), exactly as v1 —
	// the flow fires their cues, it does not mount them as containers.
	containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
};

/** The committed reference v2 function library (empty — the events are linear/forEach chains). */
export const LINES_FLOW_V2_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
