// The BAKE path's rebuild of the Hold and Win coin value label (`symbols.coinLabel`), a leaf of
// `bake-editor-doc.mjs` so `check-coin-label.ts` can run the real thing on a real export result.
//
// Rebuilt by TYPE only. The ranges and defaults live in `engine-layout/coinLabel.ts`, which a
// standalone game build cannot import (it never installs the engine's node_modules), and the server
// has already pruned and clamped the doc through it — this only refuses a value of the wrong type
// that a hand-edited doc could smuggle into the game. Node builtins only, like `appSrc.js`.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const pick = (v, fields) => {
	if (!isObj(v)) return undefined;
	const out = {};
	for (const [key, type] of Object.entries(fields)) {
		const value = v[key];
		if (type === 'number' ? Number.isFinite(value) : typeof value === type) out[key] = value;
	}
	return Object.keys(out).length ? out : undefined;
};

const STYLE = { font: 'string', size: 'number', tint: 'string' };
const POP = { enabled: 'boolean', scale: 'number', ms: 'number' };

/** The `coinLabel` an export result carries, or undefined when there is none to bake. */
export function bakeCoinLabel(c) {
	if (!isObj(c)) return undefined;
	const out = {};
	const style = pick(c.style, STYLE);
	if (style) out.style = style;
	const cash = pick(c.cash, { format: 'string', decimals: 'number', trimZeros: 'boolean' });
	if (cash) out.cash = cash;
	if (isObj(c.jackpots)) {
		const jackpots = {};
		for (const [tier, entry] of Object.entries(c.jackpots)) {
			if (!isObj(entry)) continue;
			const kept = {};
			if (typeof entry.text === 'string' && entry.text) kept.text = entry.text;
			const tierStyle = pick(entry.style, STYLE);
			if (tierStyle) kept.style = tierStyle;
			if (Object.keys(kept).length) jackpots[tier] = kept;
		}
		if (Object.keys(jackpots).length) out.jackpots = jackpots;
	}
	const placement = pick(c.placement, {
		x: 'number',
		y: 'number',
		scale: 'number',
		maxWidth: 'number',
	});
	if (placement) out.placement = placement;
	if (isObj(c.animation)) {
		const animation = {};
		const landPop = pick(c.animation.landPop, POP);
		if (landPop) animation.landPop = landPop;
		if (Number.isFinite(c.animation.countMs)) animation.countMs = c.animation.countMs;
		const boostPop = pick(c.animation.boostPop, POP);
		if (boostPop) animation.boostPop = boostPop;
		if (Object.keys(animation).length) out.animation = animation;
	}
	return Object.keys(out).length ? out : undefined;
}
