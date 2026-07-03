/**
 * Invisible Flow — per-gameType OVERLAY-STEP tables (FS-6 editor diagnostic, design doc §14).
 *
 * The `/flow` editor renders a per-step "Overlay steps" readout (which of screen-placed /
 * edge-wired / scene-authored fails, per step) by running the GENERIC `resolveOverlayOwnership`
 * (`engine-flow`) over the step table for the project's `doc.gameType`. The launcher loads a project
 * from R2 (NOT game source) and can't import a game app, so — exactly like `resolveFlowVocabulary`
 * (`flowVocabularies.ts`) — the step table is passed in as DATA here, keyed by `gameType`.
 *
 * This table MUST agree with the game's own step table (`apps/lines` `FS_OVERLAY_STEPS`): same
 * screen/event per step + the same coded-scaffolding exclusion lists. Drift is caught by the fs6
 * spike's launcher cross-check (`fs6FreeSpinOwnership.ts`), which feeds this serialized table through
 * `excludeCodedComponents` and asserts it produces the SAME `OverlayStep[]` the game uses — no
 * generator script (decision 2), the spike guard is the single source of truth for parity.
 *
 * Unknown `gameType` ⇒ `undefined` ⇒ the editor renders NO overlay-steps section (parity — no false
 * info for a game with no known overlay lifecycle).
 */

import { excludeCodedComponents, type OverlayStep } from 'engine-flow';

/** One serializable step — the screen id + bookEvent type + the coded-scaffolding exclusion lists
 *  (the DATA form of a content rule). Serializable so it can travel through the SvelteKit `load`
 *  payload (a content-rule FUNCTION can't); the editor rebuilds the rule via `excludeCodedComponents`. */
export interface SerializableOverlayStep {
	key: string;
	screen: string;
	event: string;
	/** `bind.component` names that are coded scaffolding (not authored content). */
	excludeBindComponents?: string[];
	/** `componentInstance.componentId`s that are coded scaffolding (not authored content). */
	excludeComponentIds?: string[];
}

/** A per-gameType overlay-step table: the steps + always-stripped seam screens (e.g. the FS-4
 *  `freeSpinRetrigger` seam — placed but never flow-owned until its event exists). */
export interface OverlayStepTable {
	steps: SerializableOverlayStep[];
	seamScreens?: string[];
}

/** The free-spin overlay steps — the SAME screen/event/exclusion data as `apps/lines`
 *  `FS_OVERLAY_STEPS` (kept in agreement by the fs6 spike cross-check). Shared by the `lines` and
 *  `bookOf` gameType entries (both run the lines free-spin lifecycle). */
const FREE_SPIN_STEPS_TABLE: OverlayStepTable = {
	steps: [
		{
			key: 'intro',
			screen: 'freeSpinIntro',
			event: 'freeSpinTrigger',
			excludeBindComponents: ['FreeSpinIntroVisual', 'FreeSpinOutroVisual'],
			excludeComponentIds: ['freeSpinCounter'],
		},
		{
			key: 'counter',
			screen: 'freeSpinCounter',
			event: 'updateFreeSpin',
			excludeBindComponents: ['FreeSpinIntroVisual', 'FreeSpinOutroVisual'],
			excludeComponentIds: ['freeSpinCounter'],
		},
		{
			key: 'outro',
			screen: 'freeSpinOutro',
			event: 'freeSpinEnd',
			excludeBindComponents: ['FreeSpinIntroVisual', 'FreeSpinOutroVisual'],
			excludeComponentIds: ['freeSpinCounter'],
		},
	],
	seamScreens: ['freeSpinRetrigger'],
};

/** Overlay-step tables keyed by LayoutDoc `gameType`. */
export const FLOW_OVERLAY_STEP_TABLES: Record<string, OverlayStepTable> = {
	lines: FREE_SPIN_STEPS_TABLE,
	bookOf: FREE_SPIN_STEPS_TABLE,
};

/** Resolve the overlay-step table for a project's `gameType`; unknown ⇒ `undefined` (no section). */
export const resolveOverlayStepTable = (gameType: string | undefined): OverlayStepTable | undefined =>
	gameType ? FLOW_OVERLAY_STEP_TABLES[gameType] : undefined;

/** Rebuild the runtime `OverlayStep[]` (with live content-rule functions) from a serializable table —
 *  the editor calls this to feed `resolveOverlayOwnership`. Pure; no game import. */
export const overlayStepsFromTable = (table: OverlayStepTable): OverlayStep[] =>
	table.steps.map((s) => ({
		key: s.key,
		screen: s.screen,
		event: s.event,
		contentRule: excludeCodedComponents({
			excludeBindComponents: s.excludeBindComponents,
			excludeComponentIds: s.excludeComponentIds,
		}),
	}));
