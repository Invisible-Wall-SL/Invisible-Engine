import { SYMBOL_STATES } from 'engine-layout';
import { type SpinningReelSymbolState } from 'utils-slots';

export { SYMBOL_STATES };

/**
 * A symbol id. WIDE (`string`) on purpose, and this is a deliberate loss of a guarantee.
 *
 * It used to be `keyof typeof config.symbols` — a compile-time union derived from the compiled
 * template — so naming a symbol the game could not draw was a build error. Since Phase 3 of
 * `docs/design/invisible-game-config.md` the config is authored per project and known only at
 * RUNTIME, so that union became a lie: it would describe the sample game while the project runs
 * its own, and would have REJECTED a correct symbol id from an authored config. The check moves to
 * `warnOnGameConfigIssues()`, which compares the active config's in-play set against the symbol map
 * at boot and reports a symbol with no art as an error.
 */
export type SymbolName = string;

export type RawSymbol = {
	name: SymbolName;
	multiplier?: number;
	scatter?: boolean;
	wild?: boolean;
};

export type SymbolState = SpinningReelSymbolState | (typeof SYMBOL_STATES)[number];

/** A single symbol×state binding: the sprite frame or spine animation that renders it.
 * Structural twin of a `SYMBOL_INFO_MAP` cell — authored by the Invisible Symbols State
 * Machine (docs/design/invisible-symbols-state-machine.md). */
export type SymbolCellInfo = {
	type: 'sprite' | 'spine' | 'flipbook';
	assetKey: string;
	animationName?: string;
	/** `flipbook` cells only: the authored Invisible Flipbook clip this state plays. The clip
	 * names its own sheet(s), so `assetKey` merely holds its primary one. */
	clipId?: string;
	/** Per-cell size. Optional on a baked OVERRIDE cell (absent = inherit the global
	 *  `defaultSizeRatios`); the coded `SYMBOL_INFO_MAP` always supplies it. Render code
	 *  reads the resolved size via `getSymbolInfo` (see `resolveSymbolSizeRatios`). */
	sizeRatios?: { width: number; height: number };
	/**
	 * Repeat this state's animation instead of holding on its last frame. Absent ⇒ **loop**, which
	 * is what a symbol state almost always wants and what a flipbook cell has always done
	 * (`clip.loop ?? true`).
	 *
	 * SPINE cells had no way to say this at all: nothing authored it and the board passed no `loop`,
	 * so every spine state was a one-shot that froze on its final frame. The give-away was a resting
	 * symbol that appeared to "play twice and stop" — once on the unmasked animate layer as `land`,
	 * then again after `SymbolWrap` re-mounted it on the masked layer as `static`.
	 *
	 * FLIPBOOK cells could loop, but only per CLIP, so one clip used by two states could not loop in
	 * one and hold in the other. Setting it here overrides the clip for this state only.
	 *
	 * Safe on the states the game AWAITS (`land`, `win`, `explosion`): spine queues `complete` once
	 * per loop iteration, not only at the end of a non-looping clip, so those still advance on their
	 * first cycle — they just keep animating while they wait.
	 */
	loop?: boolean;
	/**
	 * `flipbook` cells only — PER-STATE playback overrides of the bound clip's own values.
	 * Absent ⇒ the clip decides, which is what every cell authored before these existed did.
	 *
	 * The same block a placed `FlipbookNode` carries. One clip legitimately serves several states,
	 * and how it is WALKED is a per-use decision: a symbol that assembles on `land` and comes apart
	 * on `explosion` is one authored animation played forwards and then backwards. Saying that with
	 * a second clip forks the frame list — and with it the referential integrity a clip exists to
	 * hold, since a renamed region then has to be repaired in both.
	 *
	 * `direction` and mirroring MUST be folded into the clip object passed to `<Flipbook>` rather
	 * than passed beside it (the component says so): the walk decides the texture ARRAY, so there
	 * can only be one answer per rendered clip. `loop` above is the exception — it is a live
	 * sprite property with its own caller-override chain.
	 */
	fps?: number;
	direction?: 'forward' | 'reverse' | 'pingpong';
	flipX?: boolean;
	flipY?: boolean;
};

/** Symbol name → state → binding. The coded `SYMBOL_INFO_MAP` IS one of these (the
 * default); a baked symbols doc supplies sparse overrides merged over it cell-by-cell. */
export type SymbolInfoMap = Record<string, Record<string, SymbolCellInfo>>;

export type Position = {
	reel: number;
	row: number;
};
