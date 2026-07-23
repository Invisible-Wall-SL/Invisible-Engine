/**
 * Invisible Flow v2 — the committed REFERENCE book-of flow for apps/lines. A REAL authored flow that
 * DRIVES THE WHOLE GAME (loading → basegame → HUD + free-spins) WITHOUT authoring online first —
 * loaded via the `window.__IE_FLOW_V2_LINES__` dev global / `?flowV2=lines` (mirroring v1's
 * `__IE_FLOW_LINES__`) or shipped through the baked bundle (`bakedFlowV2Doc()`).
 *
 * The lines reference is now the fully FLOW-DRIVEN doc (owns `load`), the SAME artifact new projects
 * are seeded with — so "loading a lines game" (via `?flowV2=lines`) exercises the driven flow the
 * owner ships, not a book-events-only variant. It lives in `engine-flow-v2`
 * (`reference/drivenSeed`, as `BOOK_OF_DRIVEN_SEED_DOC`) so the launcher can seed it without
 * depending on this game app; re-exported here under the historical `LINES_FLOW_V2_*` names so every
 * existing consumer (the runtime holder, `seed-flow-v2.ts`) is unchanged.
 *
 * BLAST RADIUS (safe): `loadFlowV2Doc()` uses this ONLY via the `__IE_FLOW_V2_LINES__` / `?flowV2=lines`
 * dev-verify hooks; the apps/lines DEFAULT resolves `bakedFlowV2Doc()` (undefined in dev ⇒ v2 inert ⇒
 * coded path), and each ONLINE game runs its OWN baked `flow-v2.json` (`runtimeBundle.flowV2`), never
 * this reference — so making the reference driven changes NEITHER the apps/lines default NOR any
 * existing online game.
 */

export {
	BOOK_OF_DRIVEN_SEED_DOC as LINES_FLOW_V2_DOC,
	BOOK_OF_DRIVEN_SEED_LIBRARY as LINES_FLOW_V2_LIBRARY,
} from 'engine-flow-v2';
