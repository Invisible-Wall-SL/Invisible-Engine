/**
 * Invisible Flow v2 — `ConfirmGatedAction`, a reusable DOC-BUILDER unit (Phase 3, Step 6).
 *
 * A confirm gate is the "are you sure?" fold: a `showContainer(confirm)` whose fused `onConfirm` /
 * `onCancel` exec-outs branch into "run the confirmed action, then close" vs "close and re-show the
 * prompt". The BUY flow uses it (Show buyConfirm → confirm ▶ commitBuyBonus ▶ Hide; cancel ▶ Hide ▶
 * Show buyFeature), but the SHAPE is generic — parameterise the three containers/refs and it drops
 * into any flow.
 *
 * WHY A BUILDER, NOT A `group` (the runtime decision — schema §5.2):
 *  A `group` is FLATTENED (`flattenGroups`) before the runtime/validator walk, so a grouped
 *  `showContainer`'s `onConfirm`/`onCancel` WOULD still DISPATCH (`runContainerEvent` reads the
 *  flattened graph). BUT the game-side ownership predicates — `flowOwnsContainerEvent`,
 *  `flowOwnsSignal`, `flowScreenDrivingStatus` — read `doc.graph` RAW (un-flattened), because they
 *  are pure static reads a game calls to SUPPRESS the coded press. A `showContainer` buried in a
 *  `group.body` is therefore INVISIBLE to `flowOwnsContainerEvent`, so the coded confirm/cancel press
 *  would NOT be suppressed and would DOUBLE-FIRE — breaking ownership/parity. Making the predicate
 *  flatten would change ownership semantics (out of scope). And a `group` is INLINE + non-reusable by
 *  design (§5.2) anyway — not a reuse primitive. So the confirm gate must stay TOP-LEVEL: this builder
 *  RETURNS top-level nodes + exec edges, which a doc author splices into `doc.graph` verbatim. Dispatch
 *  AND ownership both work with zero engine change.
 *
 * The returned unit is the confirm-gate PORTION only: it starts at `Show(confirm)`. The caller wires
 * their upstream chain (e.g. the buy flow's `Hide(prompt)`) into {@link ConfirmGate.entry}.
 */

import { containerEventDeclId } from '../containerEvents';
import type { ContainerId, ExecEdge, Node, PinPath } from '../types';

export interface ConfirmGateParams {
	/** Namespaces this gate's node ids. MUST be unique per instance so two gates never collide. */
	idPrefix: string;
	/** The prompt/select container re-shown when the player CANCELS (e.g. `buyFeature`). */
	promptContainerId: ContainerId;
	/** The confirm-dialog container the gate mounts; its component fires `onConfirm`/`onCancel`. */
	confirmContainerId: ContainerId;
	/** The scene-node id of the confirm dialog component whose signals fuse `onConfirm`/`onCancel`
	 *  (the container-event pins' `componentId` — the same id the runtime's press gate passes). */
	confirmComponentId: string;
	/** The action ref run when the player CONFIRMS (e.g. `commitBuyBonus`). */
	onConfirmedActionRef: string;
	/** Canvas anchor for the gate's nodes; each is laid out below/right of it. Defaults to origin. */
	pos?: { x: number; y: number };
}

export interface ConfirmGate {
	/** The gate's TOP-LEVEL nodes: Show(confirm), the confirmed action, the two Hides, re-Show(prompt). */
	nodes: Node[];
	/** The gate's INTERNAL exec edges (the confirm + cancel branches off the fused pins). */
	exec: ExecEdge[];
	/** Wire the upstream chain INTO here to arm the gate (the `Show(confirm)` exec-in). */
	entry: PinPath;
	/** The `Show(confirm)` node id — the ownership-bearing node (its fused pins carry the presses). */
	showConfirmId: string;
	/** The confirmed-action node id — a caller may wire data into it if the action takes params. */
	onConfirmedId: string;
}

/**
 * Build a reusable confirm gate as TOP-LEVEL nodes + exec edges (see the module doc for why not a
 * `group`). The shape is:
 *
 *   Show(confirm)
 *     ├─ onConfirm ▶ <onConfirmedAction> ▶ Hide(confirm)
 *     └─ onCancel  ▶ Hide(confirm) ▶ Show(prompt)
 *
 * Splice `nodes`/`exec` into `doc.graph` and wire your upstream chain into {@link ConfirmGate.entry}.
 */
export const buildConfirmGate = (params: ConfirmGateParams): ConfirmGate => {
	const {
		idPrefix,
		promptContainerId,
		confirmContainerId,
		confirmComponentId,
		onConfirmedActionRef,
		pos = { x: 0, y: 0 },
	} = params;

	const confirmPin = containerEventDeclId(confirmComponentId, 'confirm');
	const cancelPin = containerEventDeclId(confirmComponentId, 'cancel');

	const showConfirmId = `${idPrefix}_showConfirm`;
	const onConfirmedId = `${idPrefix}_onConfirmed`;
	const hideAfterConfirmId = `${idPrefix}_hideConfirm_confirmed`;
	const hideAfterCancelId = `${idPrefix}_hideConfirm_cancelled`;
	const showPromptAfterCancelId = `${idPrefix}_showPrompt_cancelled`;

	// Confirm branch runs down the anchor column; the cancel branch offsets to a parallel column.
	const CANCEL_X = pos.x + 280;

	const nodes: Node[] = [
		{
			id: showConfirmId,
			kind: 'showContainer',
			pos: { x: pos.x, y: pos.y },
			ref: confirmContainerId,
		},
		{
			id: onConfirmedId,
			kind: 'action',
			pos: { x: pos.x, y: pos.y + 40 },
			ref: onConfirmedActionRef,
		},
		{
			id: hideAfterConfirmId,
			kind: 'hideContainer',
			pos: { x: pos.x, y: pos.y + 80 },
			ref: confirmContainerId,
		},
		{
			id: hideAfterCancelId,
			kind: 'hideContainer',
			pos: { x: CANCEL_X, y: pos.y + 40 },
			ref: confirmContainerId,
		},
		{
			id: showPromptAfterCancelId,
			kind: 'showContainer',
			pos: { x: CANCEL_X, y: pos.y + 80 },
			ref: promptContainerId,
		},
	];

	const exec: ExecEdge[] = [
		// confirm ▶ run the confirmed action ▶ close the dialog.
		{ from: { node: showConfirmId, pin: confirmPin }, to: { node: onConfirmedId, pin: 'exec' } },
		{ from: { node: onConfirmedId, pin: 'exec' }, to: { node: hideAfterConfirmId, pin: 'exec' } },
		// cancel ▶ close the dialog ▶ re-enter the prompt (idempotent re-show).
		{ from: { node: showConfirmId, pin: cancelPin }, to: { node: hideAfterCancelId, pin: 'exec' } },
		{
			from: { node: hideAfterCancelId, pin: 'exec' },
			to: { node: showPromptAfterCancelId, pin: 'exec' },
		},
	];

	return {
		nodes,
		exec,
		entry: { node: showConfirmId, pin: 'exec' },
		showConfirmId,
		onConfirmedId,
	};
};
