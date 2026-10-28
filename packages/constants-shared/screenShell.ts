/**
 * The SCREEN SHELL (Invisible Shader Graph step 8e, `docs/design/shader-graph-screens.md` §6.4 and
 * §7): a compiled Shader Graph effect drawn as a screen transition's In route, one filter on the
 * whole stage. The filter's input is the live stage, the NEW screen; a still of the OLD screen,
 * frozen when the transition started, is the filter's second texture.
 *
 * A compiled body's whole contract with its shell is the pass header's helpers
 * (`EFX_HEADER_FUNCTIONS`), the uniforms it declares and `finalColor`, so the body
 * `ElementFxFilter` runs on an element (`pixi-svelte/src/lib/elementFx/shaders.ts`) runs here with
 * the same meanings over the whole screen:
 *  - the unit square is the filter's frame (the viewport), with no padding: the element's
 *    `uElement` = (0, 0, 1, 1) and `uPad` = 0, so neither is declared;
 *  - `efxSample` and `efxScreenTo` read the filter's input, the new screen, and `efxScreenFrom` the
 *    still, both across the frame and 0 outside it: the frame's edge pixels read the screen's, where
 *    the element pass's half-texel clamp would land on them exactly and read 0 or not by rounding;
 *    `efxScreenReverse` is 1 when the transition plays reversed;
 *  - the body's time, seed and params stay uniforms: one transition is one element;
 *  - the Particle node's helpers read white, 0 and 0, as on an element.
 *
 * THE COMPOSITE (§6.4): the body is drawn over the old screen, premultiplied:
 * `finalColor = body + still × (1 − body.a)`. An enter graph, clear at progress 0, starts on the
 * old screen; an emphasis graph, opaque at rest, plays as a cut and a flourish on the new one.
 *
 * Its vertex stage is the element pass's (`VERTEX` in `shaders.ts`): a filter is a filter. The
 * filter binds the still under {@link SCREEN_FROM_TEXTURE} and writes {@link SCREEN_REVERSE}.
 *
 * Dependency-free, like `glslLibrary.ts`, so the launcher and the headless gates read it without
 * Pixi. Written for GLSL ES 1.00 and 3.00 alike through Pixi's `GlProgram`.
 */

import type { CustomElementFx } from './elementFx';
import { linkGlsl } from './glslLibrary';
import { ELEMENT_PASS_NAMES, shellBody, shellDeclarations, withoutComments } from './shellBody';

/**
 * The still of the old screen: the filter's second texture. `efxScreenFrom` reads it 0…1 across the
 * filter's frame, so it must be a texture of its own whose whole UV square is that frame: it is
 * bound as its source, which drops any frame, so an atlas region or a pooled sub-texture would
 * squeeze or shift the old screen.
 */
export const SCREEN_FROM_TEXTURE = 'uFromTexture';
/** 1 when the transition plays reversed, else 0. */
export const SCREEN_REVERSE = 'uEfxReverse';

/**
 * The screen fragment header: the pass header's helpers (`EFX_HEADER_FUNCTIONS`) with their screen
 * meanings, in front of every screen body. Its origin is the frame's top left, its area the frame.
 * The frame is the viewport only while the filter's `filterArea` is: without one Pixi shrinks it to
 * the stage's content bounds, and the still, read across it, would shrink with it.
 */
export const SCREEN_HEADER = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform sampler2D ${SCREEN_FROM_TEXTURE};
uniform float ${SCREEN_REVERSE};

const float PI = 3.14159265358979;

vec2 efxPx() { return vTextureCoord * uInputSize.xy; }
vec2 efxArea() { return max(uOutputFrame.zw, vec2(1.0)); }
vec2 efxSize() { return efxArea(); }
vec2 efxOrigin() { return vec2(0.0); }
vec2 efxCenter() { return 0.5 * efxSize(); }
vec2 efxToUnit(vec2 px) { return px / efxSize(); }
vec2 efxFromUnit(vec2 u) { return u * efxSize(); }

vec4 efxSample(vec2 px)
{
    vec2 uv = px * uInputSize.zw;
    vec2 edge = uOutputFrame.zw * uInputSize.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > edge.x || uv.y > edge.y)
    {
        return vec4(0.0);
    }
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

bool efxInside(vec2 px)
{
    vec2 u = efxToUnit(px);
    return u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0;
}

vec4 efxParticleColor() { return vec4(1.0); }
float efxParticleWave() { return 0.0; }
float efxParticleOrder() { return 0.0; }

vec4 efxScreenFrom(vec2 px)
{
    vec2 u = px / efxArea();
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0)
    {
        return vec4(0.0);
    }
    return texture(${SCREEN_FROM_TEXTURE}, u);
}

vec4 efxScreenTo(vec2 px) { return efxSample(px); }
float efxScreenReverse() { return ${SCREEN_REVERSE}; }
`;

/** A call of a Screens helper: a graph that reads the Screens node. */
const READS_SCREENS = /\befxScreen(?:From|To|Reverse)\s*\(/;

/**
 * A custom graph's route as a screen transition (§5): an exit graph whose body (comments aside)
 * reads no Screens helper plays on the still (Out); every other graph plays in the screen shell
 * (In), a graph that reads the Screens node drawing both screens itself. The one rule the runtime
 * plays by and `/shaders` shows.
 */
export function screenTransitionRoute(
	effect: Pick<CustomElementFx, 'spec' | 'shader'>,
): 'in' | 'out' {
	if (effect.spec.phase !== 'exit') return 'in';
	const code = withoutComments(effect.shader.body) ?? effect.shader.body;
	return READS_SCREENS.test(code) ? 'in' : 'out';
}

/** What the body's own `main` is renamed to: the shell's `main` calls it, then composites. */
const BODY_MAIN = 'efxScreenBody';

/**
 * Every global name the screen shell's fragment declares (its varying, output and uniforms) and
 * the name the body's `main` takes: the Custom GLSL checker keeps them from ports and locals, and a
 * body naming one is not converted.
 */
export const SCREEN_SHELL_NAMES: readonly string[] = [
	...new Set([
		...(['in', 'out', 'uniform'] as const).flatMap((q) =>
			shellDeclarations(SCREEN_HEADER, q).map((d) => d.name),
		),
		BODY_MAIN,
	]),
];

/**
 * The screen fragment for a compiled effect's pass body: the screen header, the body with its
 * `main` renamed, a `main` drawing it over the old screen, and the library entries it calls linked
 * in as `ElementFxFilter` links them. Undefined for a body it cannot convert surely (`shellBody`),
 * which then plays the transition's fallback; a body may read none of the shell's names but
 * `finalColor`, and none of the element pass's.
 */
export function screenShellSource(effect: Pick<CustomElementFx, 'shader'>): string | undefined {
	const body = shellBody(effect.shader, {
		varyings: false,
		reserved: [...SCREEN_SHELL_NAMES, ...ELEMENT_PASS_NAMES],
		main: BODY_MAIN,
	});
	if (!body) return undefined;
	return (
		SCREEN_HEADER +
		linkGlsl(
			[
				body.code,
				'void main(void)',
				'{',
				`    ${BODY_MAIN}();`,
				'    finalColor += efxScreenFrom(efxPx()) * (1.0 - finalColor.a);',
				'}',
				'',
			].join('\n'),
		)
	);
}
