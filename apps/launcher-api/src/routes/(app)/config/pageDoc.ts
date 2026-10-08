import { splitFormOf, type GameConfigDoc } from 'game-config';

/**
 * How `/config` shapes the doc it edits and the doc it saves. The page is a writer of the SPLIT FORM
 * (`docs/design/bonus-games.md` §2.1): it never holds or sends the legacy `holdAndWin` /
 * `potsOverlay` keys, because a stale copy of them would win over its edits on save. The server
 * regenerates them. `check:config-bonus-modes` runs these, so the page's own shaping is what is
 * gated.
 */

/** The live doc for a stored, preset, template or pasted config. */
export const openDoc = (doc: GameConfigDoc): GameConfigDoc => splitFormOf(doc);

/** The doc a save PUTs: the live doc, with no legacy key whatever an edit left on it. */
export const bodyFor = (live: GameConfigDoc): GameConfigDoc => splitFormOf(live);

/** The live doc after a save, from the doc the server stored (which carries the mirror again). */
export const adoptSaved = (saved: GameConfigDoc): GameConfigDoc => splitFormOf(saved);
