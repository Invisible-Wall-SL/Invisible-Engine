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
 * ADVANCED blend modes — filters that read the backdrop — and they work ONLY once
 * `pixi.js/advanced-blend-modes` has been imported, which `<InitialiseApplication>` does.
 * Without that import Pixi silently renders them as `normal`, so adding another advanced
 * mode means checking that registration, not just this table. The editor pays none of
 * that: it blends through Canvas2D and CSS, which support both outright.
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

/** Author-facing label per mode (the Photoshop names, plus what each is FOR). */
export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
	normal: 'Normal',
	add: 'Add (Linear Dodge)',
	multiply: 'Multiply',
	screen: 'Screen',
	lighten: 'Lighten',
	overlay: 'Overlay',
};

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
