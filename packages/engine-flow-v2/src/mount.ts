/**
 * Invisible Flow v2 — the z-ordered container MOUNT MODEL (Phase 4b).
 *
 * This replaces v1's active-set + transition state machine (design doc §4/§6). A v2 flow owns
 * visibility EXPLICITLY: `showContainer` mounts a container's scene at its author-assigned `z`,
 * `hideContainer` unmounts it. Multiple containers coexist, ordered by `z` (base underneath,
 * overlays on top) — "base persists under an overlay" is just a lower `z` that is never hidden.
 *
 * The model is PURE + rune-free (so it is testable headlessly and the ordering logic has one
 * home). A game mirrors `ordered()` into a `$state` via the `onChange` subscriber so a mounter
 * component re-renders when the shown set changes — exactly how v1 mirrored `onActiveScreensChange`.
 *
 * Robustness mirrors the interpreter's parity-safe stance: showing/hiding an unknown container id
 * is a no-op (never throws), so a partially-authored flow degrades gracefully.
 */

import type { ContainerId, ContainerRef } from './types';

/** A container currently mounted — its backing scene + the z it is stacked at. */
export interface MountedContainer {
	id: ContainerId;
	/** The Scene-Editor scene the game renders (via `<LayoutScene>`). */
	sceneId: string;
	/** The author-assigned stack position (lower = further back). */
	z: number;
}

export interface ContainerMountModel {
	/** Mount the container `id` at its authored `z` (no-op if `id` is unknown or already shown). */
	show(id: ContainerId): void;
	/** Unmount the container `id` (no-op if it is not shown or is unknown). */
	hide(id: ContainerId): void;
	/** Is the container `id` currently mounted? */
	isShown(id: ContainerId): boolean;
	/** The mounted containers, ordered by `z` ASC (base first, overlays on top) — a fresh array
	 *  each call, safe for a game to mirror into a rune. Ties keep the `containers` seed order. */
	ordered(): MountedContainer[];
}

/**
 * Build a container mount model from the flow's declared containers. `onChange` (optional) is
 * called with the new ordered list every time the shown SET actually changes — the game wires it
 * to a `$state` mirror so a `<FlowV2Mount>` re-renders. A redundant show/hide (no set change) does
 * NOT notify, so a re-fired event never churns the render.
 */
export const createContainerMountModel = (
	containers: ContainerRef[],
	onChange?: (ordered: MountedContainer[]) => void,
): ContainerMountModel => {
	// id → its declared ref, so `show(id)` resolves sceneId + z from one source of truth (the
	// flow's `containers`), NOT from the z the interpreter happens to pass — keeps them from drifting.
	const byId = new Map<ContainerId, ContainerRef>();
	for (const c of containers) byId.set(c.id, c);

	// Insertion order of the seed, used as the stable tie-break for equal `z`.
	const seedOrder = new Map<ContainerId, number>();
	containers.forEach((c, i) => seedOrder.set(c.id, i));

	const shown = new Set<ContainerId>();

	const ordered = (): MountedContainer[] =>
		[...shown]
			.map((id) => byId.get(id))
			.filter((c): c is ContainerRef => c !== undefined)
			.sort((a, b) => a.z - b.z || (seedOrder.get(a.id) ?? 0) - (seedOrder.get(b.id) ?? 0))
			.map((c) => ({ id: c.id, sceneId: c.sceneId, z: c.z }));

	const notify = (): void => onChange?.(ordered());

	return {
		show: (id) => {
			if (!byId.has(id) || shown.has(id)) return; // unknown / already shown → no churn.
			shown.add(id);
			notify();
		},
		hide: (id) => {
			if (!shown.delete(id)) return; // wasn't shown → no churn.
			notify();
		},
		isShown: (id) => shown.has(id),
		ordered,
	};
};
