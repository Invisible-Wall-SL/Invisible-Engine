/**
 * Photoshop-style BLEND MODE for a placed node — how its pixels combine with what is
 * already drawn beneath them, instead of simply covering it.
 *
 * Deliberately four modes, not PixiJS's thirty-odd. These four are the ones that exist
 * NATIVELY on all three surfaces the engine has to agree on — the game (PixiJS 8), the
 * editor's 2D canvas (`globalCompositeOperation`) and the editor's WebGL overlays (CSS
 * `mix-blend-mode`) — so every mode an author can pick renders IDENTICALLY in the editor
 * preview and in the shipped game. Pixi's advanced modes (`overlay`, `soft-light`, the
 * `*-light` family, …) are filter-backed backdrop reads with no `mix-blend-mode`
 * equivalent for the overlay path, so offering them would mean a preview that lies.
 *
 * `normal` is the absent value everywhere — a node without `blendMode` is byte-identical
 * to before this existed.
 */
export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';

/** Every blend mode, in the order the editor's dropdown lists them. */
export const BLEND_MODES = [
	'normal',
	'add',
	'multiply',
	'screen',
] as const satisfies readonly BlendMode[];

/** Author-facing label per mode (the Photoshop names, plus what each is FOR). */
export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
	normal: 'Normal',
	add: 'Add (Linear Dodge)',
	multiply: 'Multiply',
	screen: 'Screen',
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
): 'add' | 'multiply' | 'screen' | undefined {
	return mode && mode !== 'normal' ? mode : undefined;
}
