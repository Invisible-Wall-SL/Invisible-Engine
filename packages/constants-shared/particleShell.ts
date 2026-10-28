/**
 * The PARTICLE SHELL (Invisible Shader Graph step 8d, `docs/design/shader-graph-particles.md` §6–7):
 * a compiled Shader Graph effect drawn as a particle MATERIAL, each particle of an emitter layer one
 * quad of a single Pixi `Mesh`.
 *
 * A compiled body's whole contract with its shell is the pass header's helpers
 * (`EFX_HEADER_FUNCTIONS`), the uniforms it declares and `finalColor`, so the body `ElementFxFilter`
 * runs on an element (`pixi-svelte/src/lib/elementFx/shaders.ts`) runs here with the same meanings:
 *  - this header defines the same helpers over the particle: its unit square is the particle's frame
 *    (its untrimmed box), its size that frame on screen in device pixels, and `efxSample` reads the
 *    particle's texture at its current frame through the atlas, 0 outside the trimmed box;
 *  - the body's time (`uFx`) and seed (`uSeed`) become varyings, one value per particle; its params
 *    (`uP<n>`) stay uniforms, one set per layer;
 *  - the Particle node's helpers read the particle's own colour and indexes;
 *  - the Screens node's read the particle as both screens, and 0 for Reverse.
 *
 * THE COLOUR RULE (§7): a body that calls `efxParticleColor` owns the particle's colour and alpha;
 * any other is tinted and faded after, as a sprite is. Either way the mesh's own colour (the tint and
 * alpha it inherits from its parents) multiplies last, as Pixi's own mesh shader does.
 *
 * Dependency-free, like `glslLibrary.ts`, so the launcher and the headless gates read it without Pixi.
 * Written, as the element's pass is, for GLSL ES 1.00 and 3.00 alike through Pixi's `GlProgram`
 * (`in` / `out` / `texture` / `finalColor` are its macros on WebGL1).
 */

import type { CustomElementFx } from './elementFx';
import { linkGlsl } from './glslLibrary';
import { ELEMENT_PASS_NAMES, shellBody, shellDeclarations } from './shellBody';

/**
 * The particle vertex shader, for a Pixi 8 `Mesh` drawn with this shell's program. Pixi binds its
 * globals (`uProjectionMatrix`, `uWorldTransformMatrix`, `uWorldColorAlpha`, `uResolution`) and the
 * mesh's own (`uTransformMatrix`, `uColor`, `uRound`) to any mesh shader that declares them, by name
 * (`GlMeshAdaptor`, `MeshPipe`). Four vertices a particle, each with seven attributes (WebGL1
 * guarantees eight):
 *  - `aPosition`: .xy the corner, in the mesh's own pixels; .zw where it is on the frame, 0…1 across
 *    and down, past the frame by the effect's padding;
 *  - `aEfxFrame`: .xy the frame's size in the mesh's own pixels (its untrimmed size × the particle's
 *    scale); .z the particle's seed, 0…97;
 *  - `aEfxMap`: .xy the texture coordinate at the frame's top left; .zw its step across the frame;
 *  - `aEfxMap2`: .xy the texture coordinate's step down the frame (a frame the atlas turned has both
 *    steps turned); .z the wave index; .w the spawn order;
 *  - `aEfxTrim`: the trimmed box on the frame (left, top, right, bottom, 0…1);
 *  - `aEfxColor`: the particle's tint × alpha, premultiplied;
 *  - `aEfxTime`: the body's `uFx` for the particle (progress, seconds, strength, looping).
 *
 * It hands the fragment seven varying rows (WebGL1 guarantees eight): the unit position and the size
 * in device pixels (the frame's size × how many device pixels a mesh pixel spans, read off the
 * matrices by area, so exact unless the mesh is stretched more one way than the other), the two
 * mapping rows, the trimmed box, the colour, `uFx` and `uSeed`.
 */
export const PARTICLE_VERTEX = `in vec4 aPosition;
in vec3 aEfxFrame;
in vec4 aEfxMap;
in vec4 aEfxMap2;
in vec4 aEfxTrim;
in vec4 aEfxColor;
in vec4 aEfxTime;

out vec4 vEfxUnit;
out vec4 vEfxMap;
out vec4 vEfxMap2;
out vec4 vEfxTrim;
out vec4 vEfxColor;
out vec4 uFx;
out float uSeed;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform float uRound;

void main(void)
{
    mat3 m = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((m * vec3(aPosition.xy, 1.0)).xy, 0.0, 1.0);
    if (uRound == 1.0)
    {
        gl_Position.xy = (floor((gl_Position.xy * 0.5 + 0.5) * uResolution + 0.5) / uResolution) * 2.0 - 1.0;
    }
    vec2 across = m[0].xy * uResolution * 0.5;
    vec2 down = m[1].xy * uResolution * 0.5;
    vEfxUnit = vec4(aPosition.zw, aEfxFrame.xy * sqrt(abs(across.x * down.y - across.y * down.x)));
    vEfxMap = aEfxMap;
    vEfxMap2 = aEfxMap2;
    vEfxTrim = aEfxTrim;
    vEfxColor = aEfxColor;
    uFx = aEfxTime;
    uSeed = aEfxFrame.z;
}
`;

/**
 * The particle fragment header: the pass header's helpers (`EFX_HEADER_FUNCTIONS`) with their
 * particle meanings, in front of every particle body. Its origin is the frame's top left, its area
 * the frame itself.
 */
export const PARTICLE_HEADER = `precision highp float;
in vec4 vEfxUnit;
in vec4 vEfxMap;
in vec4 vEfxMap2;
in vec4 vEfxTrim;
in vec4 vEfxColor;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

const float PI = 3.14159265358979;

vec2 efxSize() { return max(vEfxUnit.zw, vec2(1.0)); }
vec2 efxArea() { return efxSize(); }
vec2 efxOrigin() { return vec2(0.0); }
vec2 efxPx() { return vEfxUnit.xy * efxSize(); }
vec2 efxCenter() { return 0.5 * efxSize(); }
vec2 efxToUnit(vec2 px) { return px / efxSize(); }
vec2 efxFromUnit(vec2 u) { return u * efxSize(); }

vec4 efxSample(vec2 px)
{
    vec2 u = efxToUnit(px);
    if (u.x < vEfxTrim.x || u.y < vEfxTrim.y || u.x > vEfxTrim.z || u.y > vEfxTrim.w)
    {
        return vec4(0.0);
    }
    return texture(uTexture, vEfxMap.xy + u.x * vEfxMap.zw + u.y * vEfxMap2.xy);
}

bool efxInside(vec2 px)
{
    vec2 u = efxToUnit(px);
    return u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0;
}

vec4 efxParticleColor() { return vEfxColor; }
float efxParticleWave() { return vEfxMap2.z; }
float efxParticleOrder() { return vEfxMap2.w; }

vec4 efxScreenFrom(vec2 px) { return efxSample(px); }
vec4 efxScreenTo(vec2 px) { return efxSample(px); }
float efxScreenReverse() { return 0.0; }
`;

/** What the body's own `main` is renamed to: the shell's `main` calls it, then applies the colour rule. */
const BODY_MAIN = 'efxParticleBody';

const SIZES: Readonly<Record<string, number>> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

/** The vertex shader's attributes in order, each with its size in floats: what a geometry gives. */
export const PARTICLE_ATTRIBUTES: readonly { name: string; size: number }[] = shellDeclarations(
	PARTICLE_VERTEX,
	'in',
).map(({ type, name }) => ({ name, size: SIZES[type] }));

/**
 * Every global name the particle shell declares (its attributes, varyings and uniforms, in both
 * stages) and the name the body's `main` takes: the Custom GLSL checker keeps them from ports and
 * locals, and a body naming one is not converted.
 */
export const PARTICLE_SHELL_NAMES: readonly string[] = [
	...new Set([
		...(['in', 'out', 'uniform'] as const).flatMap((q) =>
			[PARTICLE_VERTEX, PARTICLE_HEADER].flatMap((s) => shellDeclarations(s, q).map((d) => d.name)),
		),
		BODY_MAIN,
	]),
];

/**
 * The particle fragment for a compiled effect's pass body: the particle header, the body with its
 * time and seed uniforms made varyings and its `main` renamed, a `main` applying the colour rule,
 * and the library entries it calls linked in as `ElementFxFilter` links them. Undefined for a body
 * it cannot convert surely (`shellBody`), which then draws as plain sprites; a body may read none of
 * the shell's names but `finalColor`, and none only the element's pass declares.
 */
export function particleShellSource(effect: Pick<CustomElementFx, 'shader'>): string | undefined {
	const body = shellBody(effect.shader, {
		varyings: true,
		reserved: [...PARTICLE_SHELL_NAMES, ...ELEMENT_PASS_NAMES],
		main: BODY_MAIN,
	});
	if (!body) return undefined;
	const owned = /\befxParticleColor\s*\(/.test(body.live);
	return (
		PARTICLE_HEADER +
		linkGlsl(
			[
				body.code,
				'void main(void)',
				'{',
				`    ${BODY_MAIN}();`,
				`    finalColor *= ${owned ? '' : 'efxParticleColor() * '}uColor * uWorldColorAlpha;`,
				'}',
				'',
			].join('\n'),
		)
	);
}
