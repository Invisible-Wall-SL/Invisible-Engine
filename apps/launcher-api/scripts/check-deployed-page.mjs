/**
 * Guard `pickDeployedPage`'s derived-subtree exclusion + `isDeployedPageStale`'s rule.
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
 *
 * The same file's OTHER half, `isDeployedPageStale`, answers "is that page too old for the
 * manifest's rects?" — and got the third instance of this family anyway (2026-09-16), by rejecting
 * a page that was right. Its cases are pinned at the bottom with the real R2 numbers.
 */
import { isDeployedPageStale, pickDeployedPage } from '../src/lib/server/deployedPage.ts';

const PREFIX = 'client/project/deploy/';
const STEMS = new Set(['sheet1']);

let fails = 0;
let total = 0;
const check = (name, ok) => {
	total++;
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

// --- `isDeployedPageStale` ---------------------------------------------------------------
// The live case that broke it, `invisible_wall/test6` 2026-09-16: an atlas generated in Flipbook
// video mode (which wrote the SOURCE page once, at 08:37, and never again), re-packed in the Atlas
// Maker (which re-wrote the MANIFEST at 09:55) and deployed (09:50). The manifest's own declared
// size, 2047x1173, matches the DEPLOY; the untouched source page is 1934x1612. The old guard read
// only "manifest newer than deploy" and served the 1934x1612 page to /flipbook, /editor and
// /symbols — every frame sliced at the wrong coordinates, unfixable by a hard reload.
const at = (hms) => Date.parse(`2026-09-16T${hms}Z`);
const SOURCE = at('08:37:51'); // sheets/S_New_Squid_Idle/….png            1934x1612
const DEPLOY = at('09:50:20'); // deploy/sprites/S_New_Squid_Idle/….webp   2047x1173
const MANIFEST = at('09:55:47'); // manifests/atlas_manifest_S_New_Squid_Idle.json, declares 2047x1173

check(
	'THE BUG: a manifest re-saved after a deploy does NOT demote a page the source is older than',
	isDeployedPageStale(DEPLOY, SOURCE, MANIFEST) === false,
);
check(
	'an un-shipped re-pack (source page written with the manifest, after the deploy) is rejected',
	isDeployedPageStale(DEPLOY, MANIFEST, MANIFEST) === true,
);
check(
	'a source page missing from R2 (mtime 0) leaves nothing better, so the deploy stands',
	isDeployedPageStale(DEPLOY, 0, MANIFEST) === false,
);
check(
	'a deploy newer than the manifest is never stale',
	isDeployedPageStale(MANIFEST + 1, SOURCE, MANIFEST) === false,
);
check(
	'unknown mtimes (0) disable the guard — manifest',
	isDeployedPageStale(DEPLOY, MANIFEST, 0) === false,
);
check(
	'unknown mtimes (0) disable the guard — deployed page',
	isDeployedPageStale(0, MANIFEST, MANIFEST) === false,
);
check(
	'a source page written in the same second as the deploy is not newer evidence',
	isDeployedPageStale(DEPLOY, DEPLOY, MANIFEST) === false,
);

console.log(`${total - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
