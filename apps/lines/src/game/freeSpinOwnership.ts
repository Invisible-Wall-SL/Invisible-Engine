/**
 * Invisible Flow — FS-6 (design doc §14) the AUTO-DERIVED free-spin ownership predicate + doc gate.
 *
 * PURE + dependency-light (types only from `engine-flow`/`engine-layout`), so it is the SINGLE source
 * of truth shared by `flowRuntime.svelte.ts` (which builds the interpreter + resolves the mount-gate)
 * AND a headless spike — no rune/state imports, so it runs identically in a Node harness and in the
 * game boot. This is what makes the FS-6 flip ATOMIC: event-authoring (dispatch) and coded-mount
 * suppression (`Game.svelte`) both read the SAME `flowOwnsFreeSpins` value.
 *
 * `flowOwnsFreeSpins` is a CONJUNCTION (both must hold), so ownership can NEVER flip on wiring-alone
 * or a stray node alone:
 *   (i)  the ACTIVE authored FlowDoc WIRES the free-spin lifecycle — the three `bookEvent` LAYER
 *        edges (`freeSpinTrigger`/`updateFreeSpin`/`freeSpinEnd` → the overlays) AND places the
 *        backing overlay SCREENS (`freeSpinIntro`/`freeSpinCounter`/`freeSpinOutro`);
 *   (ii) the four backing SCENES resolve to REAL AUTHORED CONTENT beyond the empty coded fallback —
 *        each present in the LIVE editor doc with ≥1 author-placed node that is NOT a coded engine
 *        bind-anchor (`FreeSpinIntroVisual`/`FreeSpinOutroVisual`) nor the coded `freeSpinCounter`
 *        componentInstance (so the reference fallback can never satisfy (ii)).
 * `freeSpinRetrigger` is EXCLUDED from (i)/(ii) — its `retrigger` event is the FS-4 seam (never fires
 * yet), so requiring it would keep ownership permanently OFF; it joins the predicate when FS-4 lands.
 */

import type { FlowDoc } from 'engine-flow';
import type { LayoutNode, Scene } from 'engine-layout';

/** The three free-spin overlay screen ids whose wiring + content gate FS-6 ownership. */
export const FREE_SPIN_OWNERSHIP_SCREENS = [
	'freeSpinIntro',
	'freeSpinCounter',
	'freeSpinOutro',
] as const;

/** The three `bookEvent` types whose LAYER edges must be wired for FS-6 condition (i). */
export const FREE_SPIN_OWNERSHIP_EVENTS = [
	'freeSpinTrigger',
	'updateFreeSpin',
	'freeSpinEnd',
] as const;

/** The full overlay screen set (incl. the FS-4 `freeSpinRetrigger` seam) stripped when OFF. */
export const FREE_SPIN_OVERLAY_SCREENS = [
	'freeSpinIntro',
	'freeSpinCounter',
	'freeSpinRetrigger',
	'freeSpinOutro',
] as const;

/** The free-spin book events stripped from the doc when ownership is OFF (fall through to coded). */
const FREE_SPIN_STRIPPED_EVENTS = new Set<string>(FREE_SPIN_OWNERSHIP_EVENTS);

/** The coded engine bind-anchor component names the reference FALLBACK fs scenes carry — a node of
 *  one of these is coded scaffolding, NOT owner-authored content. */
const CODED_FS_ANCHOR_COMPONENTS = new Set(['FreeSpinIntroVisual', 'FreeSpinOutroVisual']);
const CODED_FS_COUNTER_COMPONENT_ID = 'freeSpinCounter';

/** True when a node is coded engine scaffolding (a bind-anchor visual or the coded counter
 *  instance), NOT owner-authored content. */
const isCodedFsAnchor = (node: LayoutNode): boolean => {
	if (node.bind && CODED_FS_ANCHOR_COMPONENTS.has(node.bind.component)) return true;
	if (node.kind === 'componentInstance' && node.componentId === CODED_FS_COUNTER_COMPONENT_ID) {
		return true;
	}
	return false;
};

/** True when a scene carries ≥1 author-placed node beyond the coded fs scaffolding (recursing into
 *  containers — a container that only WRAPS coded anchors is not itself content). */
const hasAuthoredContent = (nodes: readonly LayoutNode[]): boolean =>
	nodes.some((node) => {
		if (!isCodedFsAnchor(node)) return true;
		const children = (node as { children?: LayoutNode[] }).children;
		return Array.isArray(children) && hasAuthoredContent(children);
	});

/**
 * FS-6 — whether the authored Flow OWNS the free-spin presentation (the conjunction above).
 * `flowDoc` is the ACTIVE resolved doc (what the interpreter is built from); `scenes` is the LIVE
 * editor doc's scenes. Returns false for any un-authored / partial state, so the coded path stays
 * authoritative until the owner has BOTH wired the edges AND authored content.
 */
export const flowOwnsFreeSpins = (
	flowDoc: FlowDoc | undefined,
	scenes: readonly Scene[],
): boolean => {
	if (!flowDoc) return false;
	// (i) — the doc wires every free-spin LAYER edge AND places every backing screen.
	const placed = new Set(flowDoc.screens.map((s) => s.id));
	const screensPlaced = FREE_SPIN_OWNERSHIP_SCREENS.every((id) => placed.has(id));
	const wiredEvents = new Set(
		flowDoc.transitions
			.filter((t) => t.trigger.kind === 'bookEvent')
			.map((t) => (t.trigger.kind === 'bookEvent' ? t.trigger.event : '')),
	);
	const edgesWired = FREE_SPIN_OWNERSHIP_EVENTS.every((event) => wiredEvents.has(event));
	if (!screensPlaced || !edgesWired) return false;
	// (ii) — every backing scene resolves to real authored content in the live editor doc.
	const sceneById = new Map(scenes.map((s) => [s.id, s]));
	return FREE_SPIN_OWNERSHIP_SCREENS.every((id) => {
		const scene = sceneById.get(id);
		return scene !== undefined && hasAuthoredContent(scene.nodes);
	});
};

/**
 * FS-6 atomic flip — when ownership is OFF, STRIP the free-spin lifecycle from the doc so the
 * free-spin book events fall through to the coded handlers and the overlay transitions/screens never
 * fire (byte-identical to a doc that never wired free spins). When ON, return the doc unchanged (the
 * full choreographies drive the overlays; `Game.svelte` mount-gates the coded scenes off in lockstep).
 * Non-free-spin screens/transitions/events (loading, base, win, reveal, …) are untouched either way.
 */
export const gateFreeSpinOwnership = (doc: FlowDoc, owns: boolean): FlowDoc => {
	if (owns) return doc;
	const overlay = new Set<string>(FREE_SPIN_OVERLAY_SCREENS);
	return {
		...doc,
		screens: doc.screens.filter((s) => !overlay.has(s.id)),
		transitions: doc.transitions.filter((t) => !overlay.has(t.from) && !overlay.has(t.to)),
		events: (doc.events ?? []).filter((e) => !FREE_SPIN_STRIPPED_EVENTS.has(e.event)),
	};
};
