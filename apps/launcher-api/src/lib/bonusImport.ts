import type { AddOnRenames, ImportableFeature } from 'game-config';
import type { AddOnPart } from '$lib/potsOverlayAddOn';

/**
 * What the Game Maker's bonus import reports (`$lib/server/projectBonusImport.ts`), shared with the
 * page that shows it. Each part reports as the pots overlay add-on's do (`AddOnPart`).
 */
export type BonusImportParts = {
	symbols: AddOnPart;
	layout: AddOnPart;
	flow: AddOnPart;
	winText: AddOnPart;
	/** Spine bundles promoted to `_shared/spines/imported/…` so they ship (CLAUDE.md rule 8). */
	spines: AddOnPart;
};

export type BonusImportOutcome =
	| {
			ok: true;
			/** The mode id it is in this project. */
			mode: string;
			resynced: boolean;
			replaced: boolean;
			renamed: AddOnRenames;
			leftOut: string[];
			droppedActivates: string[];
			parts: BonusImportParts;
	  }
	| { ok: false; status: 400 | 403 | 404 | 409; error: string };

/** A same-client project a bonus can be imported from, with what it offers. */
export type BonusImportSource = { project: string; features: ImportableFeature[] };
