/**
 * Invisible Flow — the book-reveal AUTO-DERIVED ownership + doc gate (book-reveal authoring),
 * the single-step sibling of `freeSpinOwnership.ts`. PURE + dependency-light (types only), so it
 * is the SINGLE source of truth shared by `flowRuntime.svelte.ts` (which builds the interpreter)
 * AND `Game.svelte` (the `hasAuthoredBookReveal` coded-mount suppression), both reading the SAME
 * ownership so event-authoring and coded-mount suppression flip together (atomic).
 *
 * The book reveal is ONE overlay step: `reveal` (screen `specialBook`, event `setExpandingSymbol`).
 * It is flow-owned iff ALL THREE hold — its `specialBook` screen is placed in the active FlowDoc,
 * its `setExpandingSymbol` bookEvent LAYER edge is wired, AND its `specialBook` scene resolves to
 * REAL AUTHORED CONTENT (≥1 author-placed node that is NOT the coded `SpecialBook` bind anchor).
 * Owned ⇒ the authored choreography runs (`effect('setSpecialSymbol')` + the `specialBookReveal`
 * broadcast) and the coded `SpecialBook` shuffle is suppressed; un-owned ⇒ the `setExpandingSymbol`
 * event is STRIPPED and falls through to the coded handler (reference parity preserved). This is the
 * generic `resolveOverlayOwnership`/`gateOverlayOwnership` core, exactly as free spins uses it — no
 * game literals leak into `engine-flow`.
 */

import type { FlowDoc } from 'engine-flow';
import {
	excludeCodedComponents,
	gateOverlayOwnership,
	resolveOverlayOwnership,
	type OverlayScene,
	type OverlayStep,
} from 'engine-flow';
import type { Scene } from 'engine-layout';

/** The single book-reveal overlay step. */
export type BookStep = 'reveal';

/** The (screen id, bookEvent type) contract — the owner authors the `specialBook` scene and wires
 *  the `setExpandingSymbol` LAYER edge. */
export const BOOK_STEPS: Record<BookStep, { screen: string; event: string }> = {
	reveal: { screen: 'specialBook', event: 'setExpandingSymbol' },
};

/** The coded engine bind-anchor the reference FALLBACK `specialBook` scene carries — a node of this
 *  is coded scaffolding, NOT authored content (so the fallback can never satisfy §iii). */
export const BOOK_EXCLUDE_BIND_COMPONENTS = ['SpecialBook'] as const;

/** The lines book-reveal CONTENT RULE (§iii) — a node is coded scaffolding iff it is the coded
 *  `SpecialBook` bind anchor; every other node counts as authored content. */
const BOOK_CONTENT_RULE = excludeCodedComponents({
	excludeBindComponents: BOOK_EXCLUDE_BIND_COMPONENTS,
});

/** The lines book-reveal STEP TABLE the generic resolver reads. */
export const BOOK_OVERLAY_STEPS: OverlayStep<BookStep>[] = [
	{
		key: 'reveal',
		screen: BOOK_STEPS.reveal.screen,
		event: BOOK_STEPS.reveal.event,
		contentRule: BOOK_CONTENT_RULE,
	},
];

/**
 * Resolve whether the authored Flow OWNS the book reveal. `flowDoc` is the ACTIVE resolved doc
 * (what the interpreter is built from); `scenes` is the LIVE editor doc's scenes. Defaults OFF
 * (coded) — flips ON only when all three conditions hold, so the coded shuffle stays authoritative
 * until the owner has wired the edge AND authored the scene.
 */
export const resolveBookOwnership = (flowDoc: FlowDoc | undefined, scenes: readonly Scene[]) =>
	resolveOverlayOwnership<BookStep>(flowDoc, scenes as readonly OverlayScene[], BOOK_OVERLAY_STEPS);

/**
 * Strip the `setExpandingSymbol` event + `specialBook` overlay screen/transitions when the reveal
 * is NOT flow-owned, so an un-owned reveal falls through to the coded `SpecialBook` handler
 * (byte-identical to a doc that never wired it); an OWNED reveal keeps its authored event + screen.
 * Delegates to the generic `gateOverlayOwnership` (parity with the free-spin gate's logic).
 */
export const gateBookOwnership = (
	doc: FlowDoc,
	ownership: ReturnType<typeof resolveBookOwnership>,
): FlowDoc => gateOverlayOwnership(doc, ownership, BOOK_OVERLAY_STEPS);
