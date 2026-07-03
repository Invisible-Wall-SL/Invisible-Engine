/**
 * Invisible Flow — FS-6 (design doc §14) the AUTO-DERIVED, PER-STEP free-spin ownership + doc gate.
 *
 * PURE + dependency-light (types only from `engine-flow`/`engine-layout`), so it is the SINGLE source
 * of truth shared by `flowRuntime.svelte.ts` (which builds the interpreter + resolves the mount-gate)
 * AND a headless spike — no rune/state imports, so it runs identically in a Node harness and in the
 * game boot. This is what keeps the FS-6 flip ATOMIC: event-authoring (dispatch) and coded-mount
 * suppression (`Game.svelte`) both read the SAME per-step ownership.
 *
 * FS-6 (2026-07-03) — this file is now a THIN, LINES-SPECIFIC WRAPPER over the GENERIC per-step
 * overlay-ownership core in `engine-flow` (`overlayOwnership.ts`): it hands the generic resolver a
 * lines-specific STEP TABLE (`FS_OVERLAY_STEPS`) + the coded-scaffolding CONTENT RULE, and adapts the
 * generic `OverlayOwnership` back to the legacy `FreeSpinOwnership` shape every consumer already reads.
 * NO behaviour changed — the generic core reproduces the former `resolveFreeSpinOwnership`/
 * `hasAuthoredContent`/`isCodedFsAnchor` logic exactly (proven byte-identical by `fs6FreeSpinOwnership`).
 * `gateFreeSpinOwnership` KEEPS its proven ~20-line body VERBATIM (parity-by-non-change; the generic
 * `gateOverlayOwnership` exists for the equivalence test + future adoption, but lines does not route
 * through it).
 *
 * PER-STEP (owner direction 2026-07-03) — ownership is decided independently for EACH overlay step,
 * so each can be authored on its own (and a future flow-first game can simply omit a step). A step is
 * flow-owned iff ALL THREE of ITS conditions hold — so ownership can never flip on wiring-alone or a
 * stray node alone, per step:
 *   (i)   its overlay SCREEN is placed in the active FlowDoc;
 *   (ii)  its `bookEvent` LAYER edge is wired in the active FlowDoc;
 *   (iii) its backing SCENE resolves to REAL AUTHORED CONTENT — ≥1 author-placed node that is NOT a
 *         coded engine bind-anchor (`FreeSpinIntroVisual`/`FreeSpinOutroVisual`) nor the coded
 *         `freeSpinCounter` componentInstance (so the reference fallback can never satisfy (iii)).
 * The steps are `intro` (screen `freeSpinIntro`, event `freeSpinTrigger`), `counter`
 * (`freeSpinCounter`, `updateFreeSpin`), `outro` (`freeSpinOutro`, `freeSpinEnd`). MIXED states are
 * valid: an owned step runs its authored event + mounts its authored overlay while an un-owned step
 * falls through to its coded handler + mounts its coded scene. The load-bearing state (gameType /
 * counter number / sounds) runs regardless, because each event runs EITHER its full authored
 * choreography OR its coded handler — each of which does THAT step's own state (self-contained per
 * event), so the cross-event chain (intro sets gameType=freegame, outro sets it back) holds under any
 * mix. `freeSpinRetrigger` is the FS-4 seam — never flow-owned yet (its `retrigger` event never
 * fires), so its screen/transitions are ALWAYS stripped; it joins the step set when FS-4 lands.
 */

import type { FlowDoc } from 'engine-flow';
import {
	excludeCodedComponents,
	resolveOverlayOwnership,
	type OverlayScene,
	type OverlayStep,
} from 'engine-flow';
import type { Scene } from 'engine-layout';

/** A per-step free-spin overlay whose ownership is decided independently. */
export type FreeSpinStep = 'intro' | 'counter' | 'outro';

/** The per-step (screen id, bookEvent type) contract — the owner authors the scene at `screen`
 *  with the id verbatim and wires the `bookEvent` LAYER edge on `event`. */
export const FREE_SPIN_STEPS: Record<FreeSpinStep, { screen: string; event: string }> = {
	intro: { screen: 'freeSpinIntro', event: 'freeSpinTrigger' },
	counter: { screen: 'freeSpinCounter', event: 'updateFreeSpin' },
	outro: { screen: 'freeSpinOutro', event: 'freeSpinEnd' },
};

const ALL_STEPS: FreeSpinStep[] = ['intro', 'counter', 'outro'];

/** The FS-4 seam overlay — always stripped (never flow-owned until the `retrigger` event exists). */
const FREE_SPIN_SEAM_SCREEN = 'freeSpinRetrigger';

/** The coded engine bind-anchor component names + the coded counter component id the reference
 *  FALLBACK fs scenes carry — a node of one of these is coded scaffolding, NOT authored content.
 *  Exported so the headless spike can rebuild an equivalent content rule from the launcher's
 *  serialized lists (the drift cross-check) against the SAME data the game uses. */
export const FS_EXCLUDE_BIND_COMPONENTS = ['FreeSpinIntroVisual', 'FreeSpinOutroVisual'] as const;
export const FS_EXCLUDE_COMPONENT_IDS = ['freeSpinCounter'] as const;

/**
 * The lines CONTENT RULE (§iii) — the DATA form of the former `isCodedFsAnchor`: a node is coded
 * scaffolding (NOT authored content) iff it is a coded bind-anchor visual (`FreeSpinIntroVisual`/
 * `FreeSpinOutroVisual`) OR the coded `freeSpinCounter` componentInstance. Every other node counts
 * as authored content. `excludeCodedComponents` recurses into `children` exactly as before (a
 * container that only WRAPS coded anchors is not itself content), so a `freeSpinIntro`
 * componentInstance (the owner's authored intro) IS content — the reference FALLBACK can never
 * satisfy (iii). Reproduces the previous behaviour byte-for-byte.
 */
const FS_CONTENT_RULE = excludeCodedComponents({
	excludeBindComponents: FS_EXCLUDE_BIND_COMPONENTS,
	excludeComponentIds: FS_EXCLUDE_COMPONENT_IDS,
});

/**
 * The lines free-spin STEP TABLE the generic resolver reads — one `OverlayStep` per free-spin overlay
 * step, each naming its screen id + bookEvent type + the shared content rule. Exported so the headless
 * spike can cross-check the launcher's serializable table (drift guard) against the SAME table the
 * game uses.
 */
export const FS_OVERLAY_STEPS: OverlayStep<FreeSpinStep>[] = ALL_STEPS.map((key) => ({
	key,
	screen: FREE_SPIN_STEPS[key].screen,
	event: FREE_SPIN_STEPS[key].event,
	contentRule: FS_CONTENT_RULE,
}));

/** The per-step ownership result — a Set of the flow-owned steps + ergonomic accessors. */
export interface FreeSpinOwnership {
	/** True iff `step` is flow-owned (its screen placed + edge wired + scene authored). */
	owns: (step: FreeSpinStep) => boolean;
	ownsIntro: boolean;
	ownsCounter: boolean;
	ownsOutro: boolean;
	/** True iff NO step is flow-owned (the whole free-spin lifecycle is coded — byte-parity). */
	none: boolean;
	/** The set of owned steps (for iteration / diagnostics). */
	steps: ReadonlySet<FreeSpinStep>;
}

/**
 * FS-6 PER-STEP — resolve which free-spin steps the authored Flow OWNS. `flowDoc` is the ACTIVE
 * resolved doc (what the interpreter is built from); `scenes` is the LIVE editor doc's scenes. Every
 * step defaults OFF (coded), flipping ON only when ALL THREE of its conditions hold, so the coded path
 * stays authoritative per step until the owner has wired the edge AND authored that scene.
 *
 * Thin wrapper: delegates to the GENERIC `resolveOverlayOwnership` over the lines step table, then
 * adapts the generic `OverlayOwnership` into the legacy `FreeSpinOwnership` shape every consumer reads.
 */
export const resolveFreeSpinOwnership = (
	flowDoc: FlowDoc | undefined,
	scenes: readonly Scene[],
): FreeSpinOwnership => {
	const ownership = resolveOverlayOwnership<FreeSpinStep>(
		flowDoc,
		scenes as readonly OverlayScene[],
		FS_OVERLAY_STEPS,
	);
	return {
		owns: (step) => ownership.owns(step),
		ownsIntro: ownership.owns('intro'),
		ownsCounter: ownership.owns('counter'),
		ownsOutro: ownership.owns('outro'),
		none: ownership.none,
		steps: ownership.ownedKeys,
	};
};

/**
 * FS-6 PER-STEP atomic flip — strip each un-owned step's event + overlay screen + its transitions
 * INDEPENDENTLY, so an un-owned step falls through to its coded handler (byte-identical to a doc that
 * never wired it) while an OWNED step keeps its authored event + screen + transitions. Mixed states
 * are valid. The `freeSpinRetrigger` seam screen/transitions are ALWAYS stripped (FS-4). Non-free-spin
 * screens/transitions/events (loading, base, win, reveal, …) are untouched. `basegame` is never
 * stripped even though owned steps' LAYER edges source from it — only the OVERLAY endpoints are
 * matched. So a transition is dropped iff its overlay endpoint belongs to an un-owned/seam step.
 *
 * KEPT VERBATIM (decision 1, parity-by-non-change) — lines does NOT route through the generic
 * `gateOverlayOwnership`; this proven set-filtering body stays byte-identical.
 */
export const gateFreeSpinOwnership = (doc: FlowDoc, ownership: FreeSpinOwnership): FlowDoc => {
	// The overlay screen ids to strip: every un-owned step's screen + the FS-4 seam.
	const strippedScreens = new Set<string>([FREE_SPIN_SEAM_SCREEN]);
	const strippedEvents = new Set<string>();
	for (const step of ALL_STEPS) {
		if (!ownership.owns(step)) {
			strippedScreens.add(FREE_SPIN_STEPS[step].screen);
			strippedEvents.add(FREE_SPIN_STEPS[step].event);
		}
	}
	return {
		...doc,
		screens: doc.screens.filter((s) => !strippedScreens.has(s.id)),
		// Drop a transition iff EITHER endpoint is a stripped overlay screen (its LAYER edge from
		// basegame or its complete-return to basegame). `basegame` itself is never in the set.
		transitions: doc.transitions.filter(
			(t) => !strippedScreens.has(t.from) && !strippedScreens.has(t.to),
		),
		events: (doc.events ?? []).filter((e) => !strippedEvents.has(e.event)),
	};
};
