import { resolveSymbolState } from './symbolCell.ts';
import type { SymbolMapApi } from './symbolMap';
import type { RawSymbol, SymbolState } from './types';

/**
 * WHAT A CELL DRAWS — the resolver every symbol renderer reads through, lifted out of
 * `apps/lines/src/game/utils.ts` by Phase A of `docs/design/game-type-templates.md`.
 *
 * Its only dependency is the game's symbol MAP, so the seam is that one API object rather than a
 * list of loose functions: the memo below is keyed by the map's generation counter, and passing
 * the two apart is how they would eventually be wired to different instances.
 */
export interface SymbolInfoDeps {
	symbolMap: SymbolMapApi;
}

/** Derived from the factory's return type rather than re-declared — same rule as `SymbolMapApi`. */
export type SymbolInfoApi = ReturnType<typeof createSymbolInfo>;

export function createSymbolInfo({ symbolMap }: SymbolInfoDeps) {
	const { getActiveSymbolInfoMap, resolveSymbolSizeRatios, symbolMapGeneration } = symbolMap;

	/** Symbols already reported as having no art — one warning each, not one per frame. */
	const warnedMissingArt = new Set<string>();

	/**
	 * Did this symbol AUTHOR art for this state, or is it borrowing someone else's?
	 *
	 * Asked by the emerge arrival, and the reason is a timing one rather than a rendering one. A beat
	 * that waits on an animation is capped so a cell that can never report cannot hang the round — but
	 * an INHERITED state is exactly such a cell much of the time (it falls back to `land`, or to the
	 * resting `static` art, neither of which need report anything), so an un-authored intro pays the
	 * WHOLE cap on every arrival. Sized for authored art, that cap then stops being a guard and becomes
	 * the pace: it cost an un-authored cascade step 2650 ms where the shipped slide cost 1500 ms.
	 *
	 * So the caller spends the long cap only on art someone actually made, and gives everything else
	 * the ordinary transit cap. Reuses `resolveSymbolState` rather than re-deciding inheritance, so
	 * "authored" here means precisely what the renderer means by it.
	 */
	const hasAuthoredSymbolState = (symbolName: string, state: SymbolState): boolean =>
		resolveSymbolState(getActiveSymbolInfoMap()[symbolName], state) === state;

	/**
	 * THE RESOLVED CELL IS MEMOISED, AND THE MEMO IS ABOUT IDENTITY RATHER THAN SPEED.
	 *
	 * `Symbol.svelte`/`TumbleSymbol.svelte` hold this behind a `$derived`, and every renderer
	 * downstream keys work off the OBJECT it returns: `SymbolFlipbook` re-arms the beat that decides
	 * how long a state is held (`$effect(() => { props.symbolInfo; setTimeout(oncomplete, cycleMs) })`)
	 * and re-folds the clip it plays. Returning a fresh object for an unchanged symbol therefore does
	 * not cost a comparison — it restarts the animation the player is watching.
	 *
	 * That is not hypothetical. Measured on a live cascading board: ONE spin re-armed the flipbook beat
	 * 99 times across ~20 symbols, in five board-wide bursts spaced exactly one explosion-pattern step
	 * apart — every column's explode step re-derived every symbol on the board, so each symbol's emerge
	 * restarted five times over. Nothing was remounted (zero display objects were created), and the
	 * symbol's STATE was assigned exactly once; only the identity churned.
	 *
	 * The result is a pure function of `(name, state)` — the map is memoised and immutable, the size
	 * resolver reads the same baked doc, and nothing mutates what comes back (asserted before this was
	 * added). So caching it is safe, and it makes the whole render path immune to upstream churn by
	 * construction rather than by every consumer remembering to compare.
	 *
	 * Keyed by the map GENERATION too, so the live runtime bundle's arrival (`resetSymbolMapCache`)
	 * invalidates this in the same breath — otherwise an online game would render the coded template
	 * art forever, which is the exact bug that reset exists to prevent.
	 */
	const symbolInfoMemo = new Map<string, ReturnType<typeof resolveSymbolInfo>>();
	let symbolInfoMemoGeneration = -1;

	const getSymbolInfo = ({ rawSymbol, state }: { rawSymbol: RawSymbol; state: SymbolState }) => {
		const generation = symbolMapGeneration();
		if (generation !== symbolInfoMemoGeneration) {
			symbolInfoMemo.clear();
			symbolInfoMemoGeneration = generation;
		}
		// `JSON.stringify` rather than a joined string: a symbol name is author-supplied, and any
		// separator character it might legally contain would let two different (name, state) pairs
		// collide onto one another's art.
		const key = JSON.stringify([rawSymbol.name, state]);
		const memoised = symbolInfoMemo.get(key);
		if (memoised) return memoised;
		const resolved = resolveSymbolInfo({ rawSymbol, state });
		symbolInfoMemo.set(key, resolved);
		return resolved;
	};

	const resolveSymbolInfo = ({
		rawSymbol,
		state,
	}: {
		rawSymbol: RawSymbol;
		state: SymbolState;
	}) => {
		// Overlay the globally-resolved size (per-cell override > global default > coded), so render
		// components always read a present, resolved `sizeRatios` regardless of the sparse override.
		// `symbolFit` carries the resolver's provenance: `'contain'` (reel-override bounding box) or
		// `'stretch'` (every other path — today's direct width/height).
		// Special-Book states inherit the symbol's EFFECTIVE win binding (which includes any
		// authored Symbols-State-Machine override) unless a book binding is explicitly authored,
		// so the reveal/idle always mirrors the live win art rather than a stale coded default.
		const map = getActiveSymbolInfoMap();

		/**
		 * A symbol the map has never heard of RENDERS NOTHING — it does not take the game down.
		 *
		 * Every lookup below indexes `map[name][state]`, so an unknown name used to throw
		 * "Cannot read properties of undefined" from inside a render, which unmounts the whole board:
		 * the player loses the reels, not one cell. That is a catastrophic response to a cosmetic gap,
		 * and the gap is REACHABLE by ordinary authoring — a config can name a symbol (a multiplier, a
		 * new picture) before anyone binds art for it in the Symbols tool, and the merge in
		 * `getActiveSymbolInfoMap` unions BOTH key sets, so the name exists everywhere except the art.
		 *
		 * `warnOnGameConfigIssues` already reports this at boot as an error. It was detected and not
		 * survivable, which is the worst of both.
		 */
		if (!map[rawSymbol.name]) {
			if (!warnedMissingArt.has(rawSymbol.name)) {
				warnedMissingArt.add(rawSymbol.name);
				console.warn(
					`[symbols] "${rawSymbol.name}" is dealt but has no art bound in /symbols — rendering nothing for it`,
				);
			}
			const resolved = resolveSymbolSizeRatios(rawSymbol.name, state);
			return {
				missingArt: true as const,
				type: undefined,
				assetKey: undefined,
				sizeRatios: { width: resolved.width, height: resolved.height },
				symbolFit: resolved.fit,
			};
		}

		// WHICH STATE this symbol actually draws. The rule lives in `symbolCell.ts`, import-free so it
		// can be exercised offline — see the reasoning there. The short version: an unauthored state
		// used to spread as nothing, and `Symbol.svelte`'s last arm is the SPINE renderer, so it fell
		// through and handed `SpineProvider` an undefined key. `key.match(...)` then threw mid-render and
		// took the board with it. `explosion` is where it bites, because the cascade is the only caller
		// and a project-only symbol (a multiplier) has no coded cell to inherit.
		const resolveState = resolveSymbolState(map[rawSymbol.name], state);
		if (!resolveState) {
			if (!warnedMissingArt.has(rawSymbol.name)) {
				warnedMissingArt.add(rawSymbol.name);
				console.warn(
					`[symbols] "${rawSymbol.name}" has no usable art for "${state}" (and none for "static") — rendering nothing for it`,
				);
			}
			const fallback = resolveSymbolSizeRatios(rawSymbol.name, state);
			return {
				missingArt: true as const,
				type: undefined,
				assetKey: undefined,
				sizeRatios: { width: fallback.width, height: fallback.height },
				symbolFit: fallback.fit,
			};
		}
		const cell = map[rawSymbol.name][resolveState];
		const resolved = resolveSymbolSizeRatios(rawSymbol.name, resolveState);
		return {
			missingArt: false as const,
			...cell,
			sizeRatios: { width: resolved.width, height: resolved.height },
			symbolFit: resolved.fit,
		};
	};

	return { getSymbolInfo, hasAuthoredSymbolState };
}
