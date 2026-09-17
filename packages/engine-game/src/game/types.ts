import { SYMBOL_STATES, type BlendMode } from 'engine-layout';
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

/**
 * ONE authored presentation LAYER — the shape every layer in the Invisible Symbols State Machine
 * doc shares: the free-spin book VFX (`bookVfx.background`/`foreground`), the explosion → intro
 * transition, and a symbol cell's own {@link SymbolCellInfo.layers}. Kind-tagged, each kind
 * carrying only the field it needs (`sprite`/`spine` ⇒ `assetKey`, `flipbook` ⇒ `clipId`, `fx` ⇒
 * `effectId`), and rendered by the ONE component that knows all four — `SymbolLayer.svelte`.
 *
 * `sizeRatios` (× cell, default 1×1) and `offset` (× cell, default 0) place it against the live
 * cell; for an `fx` layer `sizeRatios` is a SCALE on the authored effect instead (it has no
 * intrinsic size to fit).
 *
 * `blendMode` is how the layer's pixels combine with what is already drawn beneath it. It is
 * honoured for `sprite`/`flipbook`/`fx` ONLY — `engine-layout`'s `canBlendLayerKind()` is the one
 * definition, and `spine` is absent from it because a Pixi blend cannot reach skeleton geometry
 * (`SpinePipe.addRenderable` batches each slot with the SLOT's own blend and never reads
 * `groupBlendMode`). A stored mode on a spine layer is IGNORED rather than honoured, so a doc that
 * somehow carries one renders exactly as the game does.
 *
 * `behind` is read only where a layer has something of its own to sit behind — a symbol cell's
 * layers, where absent/false draws OVER the cell's art and `true` draws UNDER it. The book-VFX
 * slots already say which side they are on by WHICH slot they are, and the transition has nothing
 * beneath it, so both ignore it.
 *
 * `dimWithSymbol` is the win-celebration DIM's per-layer opt-out and, like `behind`, is read only
 * where a layer decorates something — a symbol cell's layers. Absent (or `true`) ⇒ the layer
 * darkens with the symbol it sits on, which is what every layer did before this field existed;
 * `false` ⇒ it keeps full brightness while the rest of the cell dims (a glow that must stay lit).
 * It cannot be expressed as a tint on the layer itself: Pixi v8 computes
 * `groupColor = localColor × parent.groupColor`, so a child under a dimmed container can only
 * darken further, never brighten back — which is why the dim is applied per drawn PIECE inside
 * `Symbol.svelte` instead of once on the wrapper above them all.
 */
export type SymbolLayerSpec = {
	kind: 'sprite' | 'spine' | 'flipbook' | 'fx';
	assetKey?: string;
	animationName?: string;
	clipId?: string;
	effectId?: string;
	sizeRatios?: { width: number; height: number };
	offset?: { x: number; y: number };
	blendMode?: BlendMode;
	behind?: boolean;
	dimWithSymbol?: boolean;
};

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
	/**
	 * EXTRA ART drawn with this state, in ADDITION to the cell's own — a symbol composed of more
	 * than one picture, each able to carry its own blend mode. Array order IS draw order; a layer
	 * with `behind` sits under the cell's art, the rest over it. Absent/empty ⇒ nothing extra is
	 * mounted, byte-identical to before this existed.
	 *
	 * A layer DECORATES a bound cell — it never replaces one. A cell with no usable art draws
	 * nothing at all, layers included (`Symbol.svelte`'s `hasArt` gate, the same rule the win frame
	 * follows): a lone decoration floating where the symbol should be reads as a rendering fault
	 * rather than as the missing binding it is, and `isUsableCell` would have inherited `static`'s
	 * art underneath it anyway.
	 *
	 * A layer NEVER reports beat completion. The base cell owns the round's beat (`ReelSymbol`'s
	 * `oncomplete` → `symbolBeat.ts`); if N animated layers all reported, the wrong one would
	 * settle the state and the round would sit out the runaway cap. Same rule the explosion
	 * transition follows.
	 */
	layers?: SymbolLayerSpec[];
};

/** Symbol name → state → binding. The coded `SYMBOL_INFO_MAP` IS one of these (the
 * default); a baked symbols doc supplies sparse overrides merged over it cell-by-cell. */
export type SymbolInfoMap = Record<string, Record<string, SymbolCellInfo>>;

export type Position = {
	reel: number;
	row: number;
};
