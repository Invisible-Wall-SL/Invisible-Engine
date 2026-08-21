/**
 * Guard `pickDeployedPage`'s derived-subtree exclusion.
 *
 * Run: `node apps/launcher-api/scripts/check-deployed-page.mjs`
 *
 * WHY. `pickDeployedPage` answers "which deployed page IS this sheet?" by basename stem,
 * newest-first. Anything we ourselves wrote FROM that page is therefore a trap: it shares
 * the stem, it is newer (we just wrote it), so it wins — and the caller reads our own
 * output back as the source of truth.
 *
 * That has now bitten twice, in two different ways:
 *   - `editor-symbols/` bakes shadowed the real page and rendered regions EMPTY;
 *   - `_boot/` (the boot-splash mirror) holds a page ALREADY reoriented 180° for Spine, so
 *     `⟳ Re-sync atlas` re-derived from it and reoriented AGAIN — every rotated region came
 *     back upside down on a rig that had rendered correctly.
 *
 * The second one shipped and reached a live rig. This exists so the third one cannot.
 */
import { pickDeployedPage } from '../src/lib/server/deployedPage.ts';

const PREFIX = 'client/project/deploy/';
const STEMS = new Set(['sheet1']);

let fails = 0;
const check = (name, ok) => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};

/** `lastModified` ascending = older; the real page is deliberately the OLDEST so any
 * failure to exclude a derived twin shows up as that twin winning. */
const realPage = { key: `${PREFIX}sprites/sheet1.webp`, lastModified: 1000, size: 500_000 };

function pick(...derived) {
	return pickDeployedPage([realPage, ...derived], STEMS, PREFIX);
}

check('the real page is picked when nothing else matches', pick() === realPage.key);

// Every derived subtree, each NEWER and LARGER than the real page so it would win on
// every ranking criterion if it were not excluded.
for (const rel of [
	'editor-art/sheet1.webp',
	'editor-symbols/sheet1.webp',
	'editor-anything/sheet1.webp',
	'_boot/engine/sheet1.webp',
	'_boot/game/sheet1.webp',
	'_pages/sheet1.webp',
]) {
	const twin = { key: `${PREFIX}${rel}`, lastModified: 9999, size: 900_000 };
	check(`derived twin '${rel}' does not shadow the real page`, pick(twin) === realPage.key);
}

// A NON-derived subtree must still be eligible — the exclusion has to be surgical, or a
// legitimate re-deploy stops being picked up and the editor silently shows stale art.
// Well outside SAME_BATCH_MS (10s), or this lands in the real page's own deploy batch,
// where `.webp` legitimately outranks `.png` and the assertion would test the wrong thing.
const newerReal = { key: `${PREFIX}sprites/sheet1.png`, lastModified: 500_000, size: 900_000 };
check('a newer page in a real subtree still wins', pick(newerReal) === newerReal.key);

// A folder merely STARTING with the excluded names must not be swept up.
const lookalike = { key: `${PREFIX}_bootcamp/sheet1.webp`, lastModified: 9999, size: 900_000 };
check('a look-alike folder (_bootcamp) is NOT excluded', pick(lookalike) === lookalike.key);

console.log(`${9 - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
