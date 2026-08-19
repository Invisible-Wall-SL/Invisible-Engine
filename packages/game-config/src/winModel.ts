import { WIN_MODEL_TYPES, type GameConfigDoc, type WinModel, type WinModelType } from './types';

/**
 * The win model a doc actually runs, with the default spelled out ONCE.
 *
 * Absent ⇒ `{ type: 'lines' }`. Every config authored before Phase C of
 * `docs/design/game-type-templates.md` omits the field and means exactly that, so this is a
 * default rather than a migration — nothing stored is rewritten.
 *
 * Callers must go through here instead of reading `doc.winModel`, otherwise the "absent means
 * lines" rule gets re-implemented (and eventually mis-implemented) at each site.
 */
export function resolveWinModel(doc: Pick<GameConfigDoc, 'winModel'> | undefined): WinModel {
	return doc?.winModel ?? { type: 'lines' };
}

/** Convenience for the common branch — `true` for an un-authored doc. */
export function isLinesWinModel(doc: Pick<GameConfigDoc, 'winModel'> | undefined): boolean {
	return resolveWinModel(doc).type === 'lines';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const posInt = (value: unknown, fallback: number): number => {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

/**
 * Normalize an authored `winModel`, or `undefined` when there is nothing worth storing.
 *
 * Returns `undefined` for `lines` as well as for garbage: `lines` is the default, so persisting it
 * would add a field to every existing doc and break the round-trip parity this schema change is
 * built to preserve. The invariant is "store only what departs from the default".
 *
 * Unknown discriminants fall through to `undefined` rather than throwing — same posture as the rest
 * of this normalizer, which drops what it cannot read instead of destroying a half-authored doc.
 */
export function normalizeWinModel(raw: unknown): WinModel | undefined {
	if (!isRecord(raw)) return undefined;
	const type = raw.type;
	if (typeof type !== 'string' || !(WIN_MODEL_TYPES as readonly string[]).includes(type)) {
		return undefined;
	}

	switch (type as WinModelType) {
		case 'lines':
			return undefined;
		case 'ways':
			return {
				type: 'ways',
				direction: raw.direction === 'both' ? 'both' : 'ltr',
				minKind: posInt(raw.minKind, 3),
			};
		case 'cluster':
			return {
				type: 'cluster',
				minCluster: posInt(raw.minCluster, 5),
				adjacency: raw.adjacency === 'diagonal' ? 'diagonal' : 'orthogonal',
			};
		case 'scatter':
			return { type: 'scatter', minCount: posInt(raw.minCount, 8) };
	}
}
