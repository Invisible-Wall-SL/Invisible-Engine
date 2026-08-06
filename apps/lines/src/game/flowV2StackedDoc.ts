/**
 * Invisible Flow v2 — a ready-made verify fixture for the STACKED-PICTURE reel mode
 * (docs/design/stacked-picture-mode.md). It is the canonical book-events-only reference flow
 * (`BOOK_OF_REFERENCE_DOC`, built from `BOOK_OF_CHOREO`) with ONE addition: an `enableStackedPictures`
 * effect node PREPENDED to the `reveal` choreography, so the mode is turned on THROUGH THE REAL FLOW
 * INTERPRETER (an authored effect node → `flowEffect('enableStackedPictures')`) — the actual
 * activation path, not the local default flag.
 *
 * DEV-ONLY: loaded solely via `?flowV2=stacked` / `window.__IE_FLOW_V2_STACKED__` (see
 * `flowV2Runtime.svelte.ts#loadFlowV2Doc`). It owns only the book events (like the reference), NOT
 * `load`, so coded screens still mount (`flowV2DrivesScreens` = false) — the flow just fires the
 * effect + the normal reveal on every spin. The apps/lines DEFAULT (no opt-in) is unaffected.
 */

import type { DataEdge, ExecEdge, FlowDoc, FunctionLibraryDoc, Node } from 'engine-flow-v2';
import {
	buildChoreo,
	enumLit,
	makeChoreoUid,
	BOOK_OF_CHOREO,
	type ChoreoStep,
} from 'engine-flow-v2';

// The effect step that flips the mode on. Empty inputs ⇒ the effect's defaults (high pays + Wild,
// minRun 2). Prepended to `reveal` so the mode is on before the board settles; idempotent, so firing
// it every spin is harmless.
const ENABLE_STACKED: ChoreoStep = { k: 'action', ref: 'enableStackedPictures', inputs: {} };

const nodes: Node[] = [];
const exec: ExecEdge[] = [];
const data: DataEdge[] = [];
const uid = makeChoreoUid();

// Every canonical book-event choreography → an `event` node + its wired subgraph (mirrors
// starterDoc.ts). `reveal` gets the enable step prepended; every other event is byte-identical to the
// reference, so the game behaves exactly as the reference flow plus the mode toggle.
Object.entries(BOOK_OF_CHOREO).forEach(([event, steps], row) => {
	const eventId = `on_${event}`;
	nodes.push({ id: eventId, kind: 'event', pos: { x: 0, y: row * 160 }, ref: event });
	const augmented = event === 'reveal' ? [ENABLE_STACKED, ...steps] : steps;
	const body = buildChoreo(augmented, uid);
	body.nodes.forEach((node, i) => (node.pos = { x: (i + 1) * 220, y: row * 160 }));
	nodes.push(...body.nodes);
	exec.push(...body.exec);
	data.push(...body.data);
	if (body.entry)
		exec.push({ from: { node: eventId, pin: 'exec' }, to: { node: body.entry, pin: 'exec' } });
});

// Game Signals + tap-to-start music, verbatim from the reference (so boot music behaves the same).
const signalsId = 'game_signals';
nodes.push({ id: signalsId, kind: 'gameSignals', pos: { x: 0, y: -160 } });
const tapMusic = buildChoreo(
	[{ k: 'cue', ref: 'soundMusic', inputs: { name: enumLit('MusicName', 'bgm_main') } }],
	uid,
);
tapMusic.nodes.forEach((node, i) => (node.pos = { x: (i + 1) * 220, y: -160 }));
nodes.push(...tapMusic.nodes);
exec.push(...tapMusic.exec);
data.push(...tapMusic.data);
if (tapMusic.entry)
	exec.push({
		from: { node: signalsId, pin: 'tapToStart' },
		to: { node: tapMusic.entry, pin: 'exec' },
	});

/** The stacked-picture verify flow — the reference book-of flow + an `enableStackedPictures` node on
 *  `reveal`. Loaded via `?flowV2=stacked`. */
export const LINES_FLOW_V2_STACKED_DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
};

/** Empty library — the flow is linear/forEach chains only (matches the reference). */
export const LINES_FLOW_V2_STACKED_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
