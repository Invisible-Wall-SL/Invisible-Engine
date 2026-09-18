/**
 * Photoshop-style BLEND MODE for a placed node — how its pixels combine with what is
 * already drawn beneath them, instead of simply covering it.
 *
 * Every mode here exists on all three surfaces the engine has to agree on — the game
 * (PixiJS 8), the editor's 2D canvas (`globalCompositeOperation`) and the editor's WebGL
 * overlays (CSS `mix-blend-mode`) — so what an author picks renders IDENTICALLY in the
 * editor preview and in the shipped game. That, not mode count, is the bar: the three-way
 * intersection is 16 modes wide and this list grows into it on demand.
 *
 * `normal`/`add`/`multiply`/`screen` are GPU-native in Pixi. `overlay` and `lighten` are Pixi's
 * ADVANCED blend modes — filters that read the backdrop — and they need TWO things from
 * `<InitialiseApplication>`, both of which fail SILENTLY (the node just renders as `normal`):
 *   1. `import 'pixi.js/advanced-blend-modes'` — without it the mode is not registered at all.
 *   2. `useBackBuffer: true` in `app.init()` — on WebGL the backdrop is only readable from a
 *      non-root render target, so without the back buffer `FilterSystem` skips the filter.
 * Adding another advanced mode means checking BOTH, not just this table. The editor pays
 * neither: it blends through Canvas2D and CSS, which support them outright — which is exactly
 * how an authored `overlay`/`lighten` previewed correctly while doing nothing in game.
 *
 * `normal` is the absent value everywhere — a node without `blendMode` is byte-identical
 * to before this existed.
 */
export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'overlay' | 'lighten';

/** Every blend mode, in the order the editor's dropdown lists them. */
export const BLEND_MODES = [
	'normal',
	'add',
	'multiply',
	'screen',
	'lighten',
	'overlay',
] as const satisfies readonly BlendMode[];

/**
 * The modes Pixi implements as a GPU BLEND STATE. Everything else in {@link BLEND_MODES} is an
 * ADVANCED mode: a backdrop-reading FILTER, which is a different code path with two extra
 * requirements (registration, and a back buffer on the renderer) and its own maths. The split is
 * declared here so the offline guard can assert that every advanced mode the editor offers has a
 * corrected filter registered for it in `pixi-svelte`'s `advancedBlendModes.ts` — a mode added to
 * the list above without one would silently render as `normal` in game.
 */
export const GPU_NATIVE_BLEND_MODES = ['normal', 'add', 'multiply', 'screen'] as const;

/** Author-facing label per mode (the Photoshop names, plus what each is FOR). */
export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
	normal: 'Normal',
	add: 'Add (Linear Dodge)',
	multiply: 'Multiply',
	screen: 'Screen',
	lighten: 'Lighten',
	overlay: 'Overlay',
};

/**
 * The node kinds a blend mode actually applies to — the ONE definition, shared by the editor's
 * properties panel (which offers the control) and its canvas (which resolves the mode), so the
 * two can't disagree about what blends.
 *
 * `spine` is absent deliberately. A Pixi blend cannot reach skeleton geometry:
 * `SpinePipe.addRenderable` batches every slot carrying the SLOT's own blend and never calls
 * `renderPipes.blendMode`, nor reads `groupBlendMode` — so neither `spine.blendMode` nor a blended
 * wrapper container does anything. Verified in a running game: `multiply` on a spine node renders
 * pixel-identical to `normal`. Spine art blends PER SLOT, authored in the Rigger (Spine's format
 * offers normal/additive/multiply/screen only — no `overlay`, no `lighten`).
 *
 * `text`, `rect` and `container` are absent because the editor renders them on surfaces its blend
 * model does not cover, so the preview could not keep the promise.
 */
export const BLENDABLE_KINDS = ['sprite', 'flipbook', 'effect'] as const;

/** True when a node of this kind blends in the GAME — see {@link BLENDABLE_KINDS}. A stored
 * `blendMode` on any other kind is ignored rather than honoured, so an old doc that saved one
 * (e.g. on a spine, when the control was briefly offered there) renders exactly as the game does. */
export function canBlendKind(kind: string | undefined): boolean {
	return (BLENDABLE_KINDS as readonly string[]).includes(kind ?? '');
}

/**
 * The same question for a SYMBOL-DOC layer, whose kind vocabulary says `fx` where the editor's
 * node vocabulary says `effect` (`kind: 'sprite' | 'spine' | 'flipbook' | 'fx'` — the shape the
 * Invisible Symbols State Machine's book VFX, explosion transition and per-cell layers all share).
 *
 * The translation lives HERE, next to {@link BLENDABLE_KINDS}, so the `/symbols` tool (which
 * decides whether to offer the control) and the game's `SymbolLayer.svelte` (which decides whether
 * to honour a stored one) cannot disagree — the same one-definition rule the editor's
 * `supportsBlend` follows. `spine` is excluded here for exactly the reason it is there: a Pixi
 * blend cannot reach skeleton geometry, so a blended spine layer would render identically to an
 * unblended one and the control would be a lie.
 */
export function canBlendLayerKind(kind: string | undefined): boolean {
	return canBlendKind(kind === 'fx' ? 'effect' : kind);
}

/** Narrow an unknown doc value to a {@link BlendMode} (an unknown string ⇒ `undefined`). */
export function isBlendMode(value: unknown): value is BlendMode {
	return (BLEND_MODES as readonly string[]).includes(value as string);
}

/**
 * The CANVAS 2D composite operator for a mode — the editor's sprite/flipbook draw path.
 * `add` is Canvas's `lighter` (plus), which is the same premultiplied sum PixiJS's `add`
 * and CSS's `plus-lighter` perform.
 */
export function canvasCompositeOp(mode: BlendMode | undefined): GlobalCompositeOperation {
	switch (mode) {
		case 'add':
			return 'lighter';
		case 'multiply':
			return 'multiply';
		case 'screen':
			return 'screen';
		case 'overlay':
			return 'overlay';
		case 'lighten':
			return 'lighten';
		default:
			return 'source-over';
	}
}

/**
 * The CSS `mix-blend-mode` value for a mode — how the editor's WebGL overlays (spine, FX)
 * blend against the art beneath them. They render into their own transparent canvas, so
 * blending has to happen at COMPOSITE time on the element, not inside the overlay: a rig
 * set to `add` blended against its own empty backdrop is a no-op, which is exactly the
 * "editor shows nothing, game shows a glow" gap this avoids.
 */
export function cssBlendMode(mode: BlendMode | undefined): string {
	switch (mode) {
		case 'add':
			return 'plus-lighter';
		case 'multiply':
			return 'multiply';
		case 'screen':
			return 'screen';
		case 'overlay':
			return 'overlay';
		case 'lighten':
			return 'lighten';
		default:
			return 'normal';
	}
}

/**
 * The PixiJS `blendMode` for a mode, or `undefined` for `normal` so `propsSyncEffect`
 * skips the prop entirely (an untouched container is the parity path).
 */
export function pixiBlendMode(
	mode: BlendMode | undefined,
): 'add' | 'multiply' | 'screen' | 'overlay' | 'lighten' | undefined {
	return mode && mode !== 'normal' ? mode : undefined;
}
