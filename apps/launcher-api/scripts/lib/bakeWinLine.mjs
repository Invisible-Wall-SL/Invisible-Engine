/**
 * The BAKE half of the Symbols doc's `winLine` (`bake-editor-doc.mjs`) — split out so
 * `check:win-line-style` runs the exact code the bake runs instead of grepping for it.
 *
 * A SHAPE rebuild, not a second normalizer: the server already pruned the block (`pruneWinLine` +
 * `engine-layout` `pruneWinLineStyle`) and the game resolves every field it reads
 * (`bakedWinLineConfig`). This keeps the off switch and the non-empty `line` / `text` objects,
 * verbatim, so an untouched project ships no `winLine`.
 */

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The baked `symbols.winLine`, or undefined (no key) when nothing is authored. */
export function bakeWinLine(raw) {
	if (!isRecord(raw)) return undefined;
	const out = {};
	if (raw.enabled === false) out.enabled = false;
	if (isRecord(raw.line) && Object.keys(raw.line).length) out.line = raw.line;
	if (isRecord(raw.text) && Object.keys(raw.text).length) out.text = raw.text;
	return Object.keys(out).length ? out : undefined;
}

/** Every effect the baked styled payline plays — an effect tip, its burst and the trail — for the
 *  reachable-effects keep-set. Mirrors `engine-layout` `winLineEffectIds` (`check:win-line-style`
 *  proves the two keep the same ids). */
export function bakedWinLineEffectIds(winLine) {
	const ids = new Set();
	const line = isRecord(winLine) && isRecord(winLine.line) ? winLine.line : undefined;
	const tip = line && isRecord(line.tip) ? line.tip : undefined;
	if (tip?.kind === 'effect' && typeof tip.effectId === 'string' && tip.effectId)
		ids.add(tip.effectId);
	if (tip?.atEnd === 'burst' && typeof tip.endEffectId === 'string' && tip.endEffectId)
		ids.add(tip.endEffectId);
	for (const id of Array.isArray(line?.trailFx) ? line.trailFx : [])
		if (typeof id === 'string' && id) ids.add(id);
	return [...ids];
}
