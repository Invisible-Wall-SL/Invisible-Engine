/**
 * Invisible Flow v2 — the committed REFERENCE book-of flow for apps/lines (the v1→v2 migration
 * artifact). The v2 analogue of v1's `LINES_FLOW_DOC` (`flowDoc.ts`): a REAL authored flow that
 * drives the WHOLE game WITHOUT authoring online first — loaded via the `window.__IE_FLOW_V2_LINES__`
 * dev global (mirroring v1's `__IE_FLOW_LINES__`) or shipped through the baked bundle
 * (`bakedFlowV2Doc()`).
 *
 * The doc itself now lives in `engine-flow-v2` (`reference/starterDoc`, as `BOOK_OF_REFERENCE_DOC`)
 * so the launcher can seed it into a fresh `/flow-v2` project without depending on this game app.
 * This module re-exports it under the historical `LINES_FLOW_V2_*` names so every existing consumer
 * (the runtime holder, the flow-spike harnesses, the seed script) is unchanged.
 */

export {
	BOOK_OF_REFERENCE_DOC as LINES_FLOW_V2_DOC,
	BOOK_OF_REFERENCE_LIBRARY as LINES_FLOW_V2_LIBRARY,
} from 'engine-flow-v2';
