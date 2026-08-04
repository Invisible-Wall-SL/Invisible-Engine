import type { Scene } from './types';

/** The generic confirm-dialog componentId (the built-in {@link import('./builtinComponents').CONFIRM_DIALOG_DEF}). */
export const CONFIRM_DIALOG_COMPONENT_ID = 'confirmDialog';

/**
 * The scene NODE id of the single `confirmDialog` instance in {@link defaultConfirmScene} (the id
 * every reference layout seeds as its `buyConfirm` scene's dialog node). Exported so the state-coupled
 * `engineProvided`-values feed (`registerInstanceValues`, in `components-ui-html`) can key its source
 * to THIS instance — the flow path's supplier of the per-mode title/message/labels a `<ConfirmDialog>`
 * mount can't reach. Kept in one place so the scene node id and the feed key can never drift apart.
 */
export const CONFIRM_DIALOG_NODE_ID = 'confirm-dialog';

/**
 * The engine-default CONFIRM scene — the in-canvas twin of the retired HTML `ModalBuyBonusConfirm`,
 * and the generic "are you sure?" surface. A `canvas`-space takeover: a dimmed backdrop rect behind
 * one `componentInstance` of the built-in `confirmDialog` (panel + title + message + confirm/cancel
 * buttons), both window-anchored (`screenAnchor {0.5,0.5}`) so the dialog centres on the real
 * viewport regardless of the design box. `<ConfirmDialog>` renders THIS scene when a game passes no
 * authored scene, and injects the mount's per-instance values + button callbacks into the
 * `confirmDialog` instance (a scene node can't carry runtime callbacks) via the instance-binding
 * context. Every reference layout seeds a copy of it (`buyConfirm`) so a fresh editor project ships
 * an authorable confirm page.
 *
 * NOTHING here is buy-specific — buy-bonus is just the first consumer.
 */
export function defaultConfirmScene(): Scene {
	return {
		id: 'buyConfirm',
		name: 'Confirm Dialog',
		space: 'canvas',
		nodes: [
			{
				id: 'confirm-dim',
				label: 'Backdrop',
				kind: 'rect',
				screenAnchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 0,
				// Oversized so it covers any viewport; the {0.5,0.5} rect anchor keeps it centred
				// on the window via `screenAnchor`.
				width: 4000,
				height: 4000,
				color: 0x000000,
				alpha: 0.7,
			},
			{
				id: CONFIRM_DIALOG_NODE_ID,
				label: 'Confirm dialog',
				kind: 'componentInstance',
				screenAnchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 0,
				componentId: CONFIRM_DIALOG_COMPONENT_ID,
			},
		],
	};
}
