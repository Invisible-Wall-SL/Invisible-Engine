import {
	bonusSplitOf,
	type AddOnRenames,
	type GameConfigDoc,
	type ImportableFeature,
	type ModeRoute,
} from 'game-config';
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
	/** Rig bundles promoted to `_shared/spines/imported/…` so they ship (CLAUDE.md rule 8). */
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

/** A route "Add a bonus mode…" can point at the new mode, with what it starts now. */
export type ModeRouteOption = { key: string; route: ModeRoute; label: string; now?: string };

const TRIGGERS = [
	['count', 'Coin count'],
	['pattern', 'Pattern'],
	['luckySpin', 'Lucky Spin'],
	['randomMetre', 'Random metre'],
] as const;

/**
 * The routes of `doc` an added bonus mode can take over (`importRespinMode`'s `ModeRoute`): its coin
 * overlay's pots, triggers and symbol-filled meters, and a buy tier on each buy-bonus bet mode.
 * Never scatters (`docs/design/bonus-games.md` §6 decision 6).
 */
export function modeRouteOptions(doc: GameConfigDoc | null): ModeRouteOption[] {
	if (!doc) return [];
	const overlay = bonusSplitOf(doc).coinOverlay;
	const buys = new Map((overlay?.trigger?.buy ?? []).map((t) => [t.betMode, t.mode]));
	return [
		...(overlay?.pots ?? []).map((pot) => ({
			key: `pot:${pot.id}`,
			route: { kind: 'pot' as const, pot: pot.id },
			label: `Pot ${pot.id}`,
			now: pot.bonus.mode,
		})),
		...TRIGGERS.flatMap(([kind, label]) => {
			const slot = overlay?.trigger?.[kind];
			return slot ? [{ key: kind, route: { kind }, label, now: slot.mode }] : [];
		}),
		...(overlay?.meters ?? []).map((meter) => ({
			key: `meter:${meter.id}`,
			route: { kind: 'meter' as const, meter: meter.id },
			label: `Meter ${meter.id}`,
			now: meter.mode,
		})),
		...Object.entries(doc.betModes)
			.filter(([, bet]) => bet.buyBonus)
			.map(([betMode]) => ({
				key: `buy:${betMode}`,
				route: { kind: 'buy' as const, betMode },
				label: `Buy (${betMode})`,
				...(buys.has(betMode) ? { now: buys.get(betMode) } : {}),
			})),
	];
}

/** A `ModeRoute` read off a request body, or `undefined`. */
export function parseModeRoute(raw: unknown): ModeRoute | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const r = raw as Record<string, unknown>;
	const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
	switch (r.kind) {
		case 'pot': {
			const pot = text(r.pot);
			return pot ? { kind: 'pot', pot } : undefined;
		}
		case 'meter': {
			const meter = text(r.meter);
			return meter ? { kind: 'meter', meter } : undefined;
		}
		case 'buy': {
			const betMode = text(r.betMode);
			return betMode ? { kind: 'buy', betMode } : undefined;
		}
		case 'count':
		case 'pattern':
		case 'luckySpin':
		case 'randomMetre':
			return { kind: r.kind };
		default:
			return undefined;
	}
}
