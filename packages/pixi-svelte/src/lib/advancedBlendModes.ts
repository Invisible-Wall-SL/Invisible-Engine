import { BlendModeFilter, ExtensionType, extensions } from 'pixi.js';

/**
 * Pixi's ADVANCED blend modes (`overlay`, `lighten`), corrected so the game draws what the
 * editor previews.
 *
 * Pixi ships these as `pixi.js/advanced-blend-modes`. Its shader samples both the front and the
 * back texture and hands `front.rgb` straight to the blend function — but Pixi's textures are
 * PREMULTIPLIED, so `front.rgb` is `colour × alpha`, not colour. The blend maths is therefore fed
 * a darkened colour wherever the art is not fully opaque, and the result slides back toward the
 * backdrop as alpha drops. Canvas2D and CSS (the editor's two surfaces) blend STRAIGHT colour per
 * the compositing spec, so the two agree only where the art is opaque.
 *
 * Measured on pixi 8.8.1 — an `f0c878` sprite over an opaque `2050a0` backdrop:
 *
 * | mode | alpha | editor (Canvas2D/CSS) | Pixi stock | this file |
 * | --- | --- | --- | --- | --- |
 * | `overlay` | 1.0 | `3c7d9a` | `3c7d9a` | `3c7d9a` |
 * | `overlay` | 0.5 | `2e679d` | `1f4787` ✗ | `2e679d` |
 * | `lighten` | 0.5 | `888ca0` | `4c5aa0` ✗ | `888ca0` |
 *
 * The fix is to un-premultiply both samples, blend, and apply the spec's source-over-with-blending
 * composite (`co = αs·((1−αb)·Cs + αb·B(Cb,Cs)) + (1−αs)·αb·Cb`), then re-premultiply. It reduces
 * to Pixi's own expression when the backdrop is opaque and the front is, which is why the two
 * agree at alpha 1.
 *
 * Registered under the SAME extension names as Pixi's, so these replace them — {@link BLEND_MODES}
 * is the list the editor offers, and `checkAdvancedBlendCoverage` (below) is what stops that list
 * drifting away from this table.
 */

/** The per-mode blend function `B(Cb, Cs)`, in both shading languages Pixi compiles. */
type BlendFormula = { readonly gl: string; readonly wgsl: string };

/**
 * Every ADVANCED mode the editor offers, with its Photoshop formula. A GPU-native mode
 * (`add`/`multiply`/`screen`) must NOT appear here — those never become filters and already agree
 * with the editor at every alpha.
 */
const ADVANCED_BLEND_FORMULAS: Record<string, BlendFormula> = {
	overlay: {
		gl: 'return (b < 0.5) ? (2.0 * b * s) : (1.0 - 2.0 * (1.0 - b) * (1.0 - s));',
		wgsl: 'return select((1.0 - 2.0 * (1.0 - b) * (1.0 - s)), (2.0 * b * s), b < 0.5);',
	},
	lighten: {
		gl: 'return max(b, s);',
		wgsl: 'return max(b, s);',
	},
};

const glMain = `
	vec3 fc = front.a > 0.0 ? front.rgb / front.a : vec3(0.0);
	vec3 bc = back.a > 0.0 ? back.rgb / back.a : vec3(0.0);
	vec3 blended = vec3(blendChannel(bc.r, fc.r), blendChannel(bc.g, fc.g), blendChannel(bc.b, fc.b));
	vec3 cr = mix(fc, blended, back.a);
	vec3 co = front.a * cr + (1.0 - front.a) * back.a * bc;
	finalColor = vec4(co, blendedAlpha) * uBlend;
`;

const wgslMain = `
	let fc = select(vec3<f32>(0.0), front.rgb / front.a, front.a > 0.0);
	let bc = select(vec3<f32>(0.0), back.rgb / back.a, back.a > 0.0);
	let blended = vec3<f32>(blendChannel(bc.r, fc.r), blendChannel(bc.g, fc.g), blendChannel(bc.b, fc.b));
	let cr = mix(fc, blended, back.a);
	let co = front.a * cr + (1.0 - front.a) * back.a * bc;
	out = vec4<f32>(co, blendedAlpha) * blendUniforms.uBlend;
`;

function correctedBlendFilter(formula: BlendFormula) {
	return class extends BlendModeFilter {
		constructor() {
			super({
				gl: { functions: `float blendChannel(float b, float s) { ${formula.gl} }`, main: glMain },
				gpu: {
					functions: `fn blendChannel(b: f32, s: f32) -> f32 { ${formula.wgsl} }`,
					main: wgslMain,
				},
			});
		}
	};
}

/**
 * Register the corrected filters. Call ONCE, before the first render: `BlendModePipe` caches one
 * `FilterEffect` per mode name for the life of a renderer, so a registration that lands after a
 * mode has drawn is ignored for that renderer.
 */
export function registerAdvancedBlendModes(): void {
	for (const [name, formula] of Object.entries(ADVANCED_BLEND_FORMULAS)) {
		const filter = correctedBlendFilter(formula);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(filter as any).extension = { name, type: ExtensionType.BlendMode };
		extensions.add(filter);
	}
}

/** The modes this file registers — the offline guard compares it against the editor's list. */
export const CORRECTED_ADVANCED_BLEND_MODES = Object.keys(ADVANCED_BLEND_FORMULAS);
