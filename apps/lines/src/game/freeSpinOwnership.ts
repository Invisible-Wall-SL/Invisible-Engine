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
 * mix. `freeSpinRetrigger` (FS-4, landed) is a first-class optional step like the others — owned
 * only when its screen is placed + its `freeSpinRetrigger` edge is wired + its scene is authored,
 * else stripped so the coded no-op handler runs (parity: an un-authored game shows no retrigger).
 */

import type { FlowDoc } from 'engine-flow';
import {
	excludeCodedComponents,
	resolveOverlayOwnership,
	type OverlayScene,
	type OverlayStep,
} from 'engine-flow';
import type { Scene } from 'engine-layout';

/** A per-step free-spin overlay whose ownership is decided independently. `retrigger` is the FS-4
 *  "extra free spins won" flourish (landed) — optional, owned/stripped per-step like the rest. */
export type FreeSpinStep = 'intro' | 'counter' | 'retrigger' | 'outro';

/** The per-step (screen id, bookEvent type) contract — the owner authors the scene at `screen`
 *  with the id verbatim and wires the `bookEvent` LAYER edge on `event`. */
export const FREE_SPIN_STEPS: Record<FreeSpinStep, { screen: string; event: string }> = {
	intro: { screen: 'freeSpinIntro', event: 'freeSpinTrigger' },
	counter: { screen: 'freeSpinCounter', event: 'updateFreeSpin' },
	retrigger: { screen: 'freeSpinRetrigger', event: 'freeSpinRetrigger' },
	outro: { screen: 'freeSpinOutro', event: 'freeSpinEnd' },
};

const ALL_STEPS: FreeSpinStep[] = ['intro', 'counter', 'retrigger', 'outro'];

/** The coded engine bind-anchor component names + the coded counter component id the reference
 *  FALLBACK fs scenes carry — a node of one of these is coded scaffolding, NOT authored content.
 *  Exported so the headless spike can rebuild an equivalent content rule from the launcher's
 *  serialized lists (the drift cross-check) against the SAME data the game uses.
 *  NOTE — `retrigger` has NO coded visual/anchor (its coded fallback is the present-nothing no-op),
 *  so ANY node in a `freeSpinRetrigger` scene counts as authored content. If a coded retrigger
 *  reference visual is ever introduced, add its component name here so `ownsRetrigger` stays honest. */
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
	ownsRetrigger: boolean;
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
		ownsRetrigger: ownership.owns('retrigger'),
		ownsOutro: ownership.owns('outro'),
		none: ownership.none,
		steps: ownership.ownedKeys,
	};
};

/**
 * FS-6 PER-STEP atomic flip — strip each un-owned step's event + overlay screen + its transitions
 * INDEPENDENTLY, so an un-owned step falls through to its coded handler (byte-identical to a doc that
 * never wired it) while an OWNED step keeps its authored event + screen + transitions. Mixed states
 * are valid. `freeSpinRetrigger` (FS-4) is now one of those steps — stripped iff un-owned. Non-free-spin
 * screens/transitions/events (loading, base, win, reveal, …) are untouched. `basegame` is never
 * stripped even though owned steps' LAYER edges source from it — only the OVERLAY endpoints are
 * matched. So a transition is dropped iff its overlay endpoint belongs to an un-owned/seam step.
 *
 * KEPT VERBATIM (decision 1, parity-by-non-change) — lines does NOT route through the generic
 * `gateOverlayOwnership`; this proven set-filtering body stays byte-identical.
 */
/** The coded outro bind-anchor component names — the reference/driven-seed `freeSpinOutro` scene
 *  carries one of these (`FreeSpinOutro` composer, the bare `FreeSpinOutroGate`, or the split
 *  `FreeSpinOutroVisual`). A node bound to any of them is coded scaffolding, NOT authored content. */
const FS_OUTRO_CODED_ANCHORS = [
	'FreeSpinOutro',
	'FreeSpinOutroGate',
	'FreeSpinOutroVisual',
] as const;

/**
 * FS-7 (design doc §14, outro step) — does the `freeSpinOutro` scene carry AUTHOR-REBUILT content
 * (≥1 top-level node that is NOT a coded outro bind-anchor)? This is the v2-applicable twin of the v1
 * `ownsOutro` content test (`ownsOutro` is a v1-FlowDoc read, inert under v2): when TRUE, the author
 * has rebuilt the outro from primitives (own spine / count text / big-small art / tap), so the engine
 * mounts the HEADLESS `<FreeSpinOutroDriver>` (count-up + state publish + baked fountain only) and lets
 * the authored screen own the dim / tap / hold / art. When FALSE — the driven-seed / reference scene
 * binds only `FreeSpinOutroVisual` (or nothing) — the engine keeps the full `<FreeSpinOutroGate>`
 * (dim + press + fountain), so Book of Borut's proven tap-to-continue outro is byte-identical. Mirrors
 * `hasAuthoredBookReveal`; a game with no `freeSpinOutro` scene ⇒ `false` (parity).
 */
export const hasAuthoredFreeSpinOutro = (scenes: readonly Scene[]): boolean => {
	const scene = scenes.find((s) => s.id === FREE_SPIN_STEPS.outro.screen);
	if (!scene) return false;
	return scene.nodes.some(
		(node) =>
			!(
				node.bind?.component &&
				(FS_OUTRO_CODED_ANCHORS as readonly string[]).includes(node.bind.component)
			),
	);
};

/** What the engine mounts at each of the two free-spin OUTRO bands. `null` = nothing at that band.
 *  `band` is the outro container's OWN z (v2); `top` is the fixed `LAYER_BAND_TOP` (v1 / fallback). */
export interface FreeSpinOutroMount {
	/** v2 (`flowV2DrivesScreens`), the container's band: the headless `driver` when author-rebuilt, the
	 *  full `gate` for the driven-seed / `FreeSpinOutroVisual` path, `null` when Borut's composer owns it. */
	band: 'driver' | 'gate' | null;
	/** v1 / fallback, the top band: the `driver-transfer` when `ownsOutro`, the full `gate` when not
	 *  (and not v2), `null` under v2 (the container band above owns it). */
	top: 'driver-transfer' | 'gate' | null;
}

/**
 * FS-7 (design doc §14, outro step) — the SINGLE decision for which free-spin OUTRO surface mounts,
 * shared by `Game.svelte`'s two mount sites so the markup can't drift from the invariant. It encodes
 * decision B's NON-NEGOTIABLE rule: there is ALWAYS EXACTLY ONE `freeSpinOutroCountUp` subscriber —
 * the mounted `driver` OR `gate` here, OR (when `freeSpinOutroHasCodedGate`) Book of Borut's own
 * composer gate mounted through its container. Two subscribers would each hold the round on
 * `freeSpinOutroCountUp` and HANG it; zero would silently no-op the count-up. `v1` (`ownsOutro`) and
 * `v2` (`flowV2DrivesScreens`) are mutually exclusive, so exactly one band is ever non-null.
 *
 * The `freeSpinOutroCountUp` SUBSCRIBER COUNT for any input is
 * `(band ? 1 : 0) + (top ? 1 : 0) + (flowV2DrivesScreens && freeSpinOutroHasCodedGate ? 1 : 0)`, which
 * this function guarantees is exactly 1 (asserted headlessly, `fs7FreeSpinOutro`).
 */
export const resolveFreeSpinOutroMount = (ctx: {
	flowV2DrivesScreens: boolean;
	freeSpinOutroHasCodedGate: boolean;
	freeSpinOutroAuthored: boolean;
	ownsOutro: boolean;
}): FreeSpinOutroMount => ({
	band:
		ctx.flowV2DrivesScreens && !ctx.freeSpinOutroHasCodedGate
			? ctx.freeSpinOutroAuthored
				? 'driver'
				: 'gate'
			: null,
	top: ctx.ownsOutro ? 'driver-transfer' : ctx.flowV2DrivesScreens ? null : 'gate',
});

export const gateFreeSpinOwnership = (doc: FlowDoc, ownership: FreeSpinOwnership): FlowDoc => {
	// The overlay screen ids to strip: every un-owned step's screen (retrigger included — FS-4).
	const strippedScreens = new Set<string>();
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
