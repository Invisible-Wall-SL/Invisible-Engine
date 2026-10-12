import type { LegacyBonusKeys } from 'game-config';

/**
 * `doc` without the top-level `holdAndWin` / `potsOverlay` pair `main`'s normalized docs mirrored
 * (bonus-games Phase 7b dropped it), so a pinned doc digest measures the same on either tree. A
 * shallow copy; anything not an object passes through.
 */
export function withoutMirror<T>(doc: T): T {
	if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
	const { holdAndWin: _h, potsOverlay: _p, ...rest } = doc as T & LegacyBonusKeys;
	return rest as T;
}
