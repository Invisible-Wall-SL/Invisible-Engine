import {
	GlProgram,
	Matrix,
	RendererType,
	Shader,
	UniformGroup,
	colorBitGl,
	compileHighShaderGl,
	fragmentGlTemplate,
	generateTextureBatchBitGl,
	getBatchSamplersUniformGroup,
	globalUniformsBitGl,
	localUniformBitGl,
	roundPixelsBitGl,
	textureBitGl,
	vertexGlTemplate,
	type Application,
	type HighShaderBit,
	type Renderer,
	type RopeGeometry,
	type Texture,
	type TextureShader,
	type WebGLRenderer,
} from 'pixi.js';
import { programLinks } from 'pixi-svelte/elementFx';

import { WADE, type Waterline } from './wade';

/**
 * THE WATER A BODY IS DRAWN UNDER, IN ITS OWN SHADER (performance plan T5,
 * `docs/design/salmons-performance.md` §3 cause 2): what a pass per body drew, the salmon's
 * `ColorMatrixFilter` and the bear's wading pass (`wadeFilter.ts`), drawn by the body's own mesh
 * as it is drawn, so no body takes a render target and nothing toggles `filters`: going under or
 * out of the water changes a uniform.
 *
 * Each program is Pixi's own mesh (or graphics) program, with a step after its colour that does
 * what the pass did to the pixel it read:
 * - the pass read its target, which kept each pixel to 8 bits, so the step rounds the colour to 8
 *   bits first ({@link Q});
 * - the salmon's step is `ColorMatrixFilter`'s fragment line for line (its matrix is `leap.ts`
 *   `underTint`'s); its glint, which the pass drew additively into the same target before the
 *   matrix, is found per pixel from the glint's own rope strip ({@link SalmonShader.glint}) and
 *   added there, clamped and rounded as the target did, so the matrix still sees it;
 * - the bear's step is the wading pass's fragment (`wadeFilter.ts`), its place about the
 *   character's own (`uFeetMatrix`, the drawable's transform into the container its look is
 *   mounted in).
 * Where a drawable is not under the water the step is skipped: the pixel is the plain program's.
 */

/** A colour as the pass's 8-bit target kept it. */
const Q = /* glsl */ `
vec4 q8(vec4 c) { return floor(c * 255.0 + 0.5) / 255.0; }
`;

/** `HP`: `highp` where the fragment stage has it (places are hundreds of px, read to a fraction of
 *  one), else the best there is, so no GPU refuses a program over it. */
const HP = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define HP highp
#else
#define HP mediump
#endif
`;

/** How many points the salmon's glint rope has (`looks.ts` `GLINT_POINTS`). */
export const GLINT_STRIP_POINTS = 7;

const salmonBit: HighShaderBit = {
	name: 'salmons-under-bit',
	vertex: {
		header: /* glsl */ `
			uniform float uGlintAlpha;
			out highp vec2 vLocal;
			out vec4 vGlint;
		`,
		main: /* glsl */ `
			vLocal = aPosition;
		`,
		end: /* glsl */ `
			// The glint mesh's alpha as Pixi packed it: its own times its ancestors' (the rope's
			// \`uColor.a\`), clamped, cut to a byte.
			float glintAlpha = floor(clamp(uGlintAlpha * uColor.a, 0.0, 1.0) * 255.0) / 255.0;
			vGlint = vec4(glintAlpha) * uWorldColorAlpha;
		`,
	},
	fragment: {
		header: /* glsl */ `
			${HP}
			in HP vec2 vLocal;
			in vec4 vGlint;
			uniform sampler2D uGlintTexture;
			uniform float uUnder;
			uniform float uGlintOn;
			uniform float uColorMatrix[20];
			uniform float uMatrixAlpha;
			uniform HP vec2 uGlintStrip[${GLINT_STRIP_POINTS * 2}];
			${Q}
			vec4 glintIn(HP vec2 p, HP vec2 a, HP vec2 b, HP vec2 c, HP vec2 ua, HP vec2 ub, HP vec2 uc)
			{
				HP vec2 v0 = b - a;
				HP vec2 v1 = c - a;
				HP vec2 v2 = p - a;
				HP float d = v0.x * v1.y - v1.x * v0.y;
				if (d == 0.0) return vec4(0.0);
				HP float wb = (v2.x * v1.y - v1.x * v2.y) / d;
				HP float wc = (v0.x * v2.y - v2.x * v0.y) / d;
				HP float wa = 1.0 - wb - wc;
				if (wa < 0.0 || wb < 0.0 || wc < 0.0) return vec4(0.0);
				return texture(uGlintTexture, wa * ua + wb * ub + wc * uc) * vGlint;
			}
			// The glint rope's strip as \`RopeGeometry\` builds it: point i's two vertices (2i over the
			// line, 2i + 1 under it) at u = i / (points - 1), v 0 and 1; segment i the triangles
			// (2i, 2i + 1, 2i + 2) and (2i + 2, 2i + 1, 2i + 3), each adding as the additive mesh did.
			vec4 glintAt(HP vec2 p)
			{
				vec4 sum = vec4(0.0);
				HP float n = ${(GLINT_STRIP_POINTS - 1).toFixed(1)};
				for (int i = 0; i < ${GLINT_STRIP_POINTS - 1}; i++)
				{
					HP float u0 = float(i) / n;
					HP float u1 = float(i + 1) / n;
					HP vec2 a = uGlintStrip[i * 2];
					HP vec2 b = uGlintStrip[i * 2 + 1];
					HP vec2 c = uGlintStrip[i * 2 + 2];
					HP vec2 d = uGlintStrip[i * 2 + 3];
					sum += glintIn(p, a, b, c, vec2(u0, 0.0), vec2(u0, 1.0), vec2(u1, 0.0));
					sum += glintIn(p, c, b, d, vec2(u1, 0.0), vec2(u0, 1.0), vec2(u1, 1.0));
				}
				return sum;
			}
		`,
		end: /* glsl */ `
			if (uUnder < 0.5)
			{
				if (uGlintOn > 0.5) finalColor.rgb = min(finalColor.rgb + glintAt(vLocal).rgb, 1.0);
			}
			else
			{
				vec4 color = q8(finalColor);
				if (uGlintOn > 0.5) color = q8(min(color + glintAt(vLocal), 1.0));

				if (color.a > 0.0) {
					color.rgb /= color.a;
				}

				vec4 result;

				result.r = (uColorMatrix[0] * color.r);
					result.r += (uColorMatrix[1] * color.g);
					result.r += (uColorMatrix[2] * color.b);
					result.r += (uColorMatrix[3] * color.a);
					result.r += uColorMatrix[4];

				result.g = (uColorMatrix[5] * color.r);
					result.g += (uColorMatrix[6] * color.g);
					result.g += (uColorMatrix[7] * color.b);
					result.g += (uColorMatrix[8] * color.a);
					result.g += uColorMatrix[9];

				result.b = (uColorMatrix[10] * color.r);
					result.b += (uColorMatrix[11] * color.g);
					result.b += (uColorMatrix[12] * color.b);
					result.b += (uColorMatrix[13] * color.a);
					result.b += uColorMatrix[14];

				result.a = (uColorMatrix[15] * color.r);
					result.a += (uColorMatrix[16] * color.g);
					result.a += (uColorMatrix[17] * color.b);
					result.a += (uColorMatrix[18] * color.a);
					result.a += uColorMatrix[19];

				vec3 rgb = mix(color.rgb, result.rgb, uMatrixAlpha);

				rgb *= result.a;

				finalColor = vec4(rgb, result.a);
			}
		`,
	},
};

const wadeBit: HighShaderBit = {
	name: 'salmons-wade-bit',
	vertex: {
		header: /* glsl */ `
			uniform mat3 uFeetMatrix;
			uniform float uScreenResolution;
			out highp vec2 vFeet;
			out highp float vPixel;
		`,
		main: /* glsl */ `
			vFeet = (uFeetMatrix * vec3(aPosition, 1.0)).xy;
		`,
		end: /* glsl */ `
			// One pixel of the screen in px about the place: the container the look is mounted in
			// maps those px to the screen by the drawable's transform less its own (\`uFeetMatrix\`).
			mat3 screen = worldTransformMatrix * modelMatrix;
			highp float det = uFeetMatrix[0][0] * uFeetMatrix[1][1] - uFeetMatrix[1][0] * uFeetMatrix[0][1];
			highp vec2 feetDown = vec2(-uFeetMatrix[1][0], uFeetMatrix[0][0]) / det;
			highp vec2 down = screen[0].xy * feetDown.x + screen[1].xy * feetDown.y;
			vPixel = 1.0 / (length(down) * uScreenResolution);
		`,
	},
	fragment: {
		header: /* glsl */ `
			${HP}
			in HP vec2 vFeet;
			in HP float vPixel;
			uniform float uWading;
			uniform vec4 uLine;
			uniform vec4 uUnder;
			uniform vec2 uRim;
			${Q}
		`,
		end: /* glsl */ `
			if (uWading > 0.5)
			{
				vec4 color = q8(finalColor);
				vec2 at = vFeet;
				float across = min(abs(at.x) / uLine.z, 1.0);
				float below = at.y - (uLine.x + uLine.y * sqrt(1.0 - across * across));
				float edge = 0.5 * vPixel;
				vec3 under = color.rgb * uUnder.a + uUnder.rgb * color.a;
				vec3 rgb = mix(color.rgb, under, smoothstep(-edge, edge, below));
				float rim = uRim.y * (1.0 - smoothstep(0.0, uRim.x, abs(below)));
				finalColor = vec4(mix(rgb, vec3(color.a), rim), color.a);
			}
		`,
	},
};

const programOf = (name: string, bits: HighShaderBit[], precision: 'mediump' | 'highp') =>
	new GlProgram({
		name,
		...compileHighShaderGl({
			template: { vertex: vertexGlTemplate, fragment: fragmentGlTemplate },
			bits: [globalUniformsBitGl, ...bits],
		}),
		preferredFragmentPrecision: precision,
	});

// The colour step runs at the precision the passes ran at: `ColorMatrixFilter` at Pixi's default,
// the wading pass at `highp` (`wadeFilter.ts`).
let programs: { salmon: GlProgram; wadeMesh: GlProgram; wadeGraphics: GlProgram } | undefined;
const programsOf = () =>
	(programs ??= {
		salmon: programOf(
			'salmons-salmon',
			[localUniformBitGl, textureBitGl, roundPixelsBitGl, salmonBit],
			'mediump',
		),
		wadeMesh: programOf(
			'salmons-wade-mesh',
			[localUniformBitGl, textureBitGl, roundPixelsBitGl, wadeBit],
			'highp',
		),
		wadeGraphics: programOf(
			'salmons-wade-graphics',
			[colorBitGl, generateTextureBatchBitGl(1), localUniformBitGl, roundPixelsBitGl, wadeBit],
			'highp',
		),
	});

const isWebGL = (renderer: Renderer): renderer is WebGLRenderer =>
	renderer.type === RendererType.WEBGL;

const refused = new Set<string>();
/** Whether the GPU takes `programs` (asked of the driver once each); `false` on a renderer that is
 *  not WebGL. */
const links = (app: Application, name: string, programs: GlProgram[]): boolean => {
	const { renderer } = app;
	if (!isWebGL(renderer)) return false;
	const ok = programs.every((program) => programLinks(renderer, program));
	if (!ok && !refused.has(name))
		console.warn(`[salmons-art] the ${name} program did not compile on this GPU`);
	if (!ok) refused.add(name);
	return ok;
};

/** Whether the salmon's program can draw it; refused, it is drawn by Pixi's own: crisp, as out of
 *  the water, with no glint. */
export const salmonLinks = (app: Application): boolean =>
	links(app, 'salmon', [programsOf().salmon]);

/** Whether a wading body's programs can draw it; refused, the wading pass draws it (`wade.ts`). */
export const wadeLinks = (app: Application): boolean => {
	const { wadeMesh, wadeGraphics } = programsOf();
	return links(app, 'wading', [wadeMesh, wadeGraphics]);
};

/** Ask the driver for the programs as the river mounts, not as the first body is drawn. */
export const warmBodyShaders = (app: Application): void => {
	salmonLinks(app);
	wadeLinks(app);
};

/** A mesh's program that draws its texture: a mesh hands it each texture it is given, and it
 *  points the program at the texture's page and where its frame is on it. */
class TexturedShader extends Shader implements TextureShader {
	private drawing: Texture;
	private readonly frame: UniformGroup;

	constructor(glProgram: GlProgram, texture: Texture, resources: Record<string, unknown>) {
		const frame = new UniformGroup({
			uTextureMatrix: { value: new Matrix(), type: 'mat3x3<f32>' },
		});
		super({
			glProgram,
			resources: { ...resources, uTexture: texture.source, textureUniforms: frame },
		});
		this.frame = frame;
		this.drawing = texture;
		this.texture = texture;
	}

	get texture(): Texture {
		return this.drawing;
	}

	set texture(texture: Texture) {
		this.drawing = texture;
		texture.textureMatrix.update();
		this.resources.uTexture = texture.source;
		this.frame.uniforms.uTextureMatrix = texture.textureMatrix.mapCoord;
		this.frame.update();
	}
}

export type SalmonUnder = {
	readonly shader: TextureShader;
	/** Under the water: drawn under the colour matrix `matrix` (`underTint`); `undefined`: crisp. */
	under(matrix: readonly number[] | undefined): void;
	/**
	 * The glint over the rope this frame: its strip (`RopeGeometry` of the glint rope) and how the
	 * strip's px are taken to the rope's (`scale`), at `alpha` (the glint mesh's own); 0 ⇒ none.
	 */
	glint(strip: RopeGeometry, scale: number, alpha: number): void;
	destroy(): void;
};

type SalmonUniforms = {
	uUnder: number;
	uGlintOn: number;
	uGlintAlpha: number;
	uColorMatrix: Float32Array;
	uGlintStrip: Float32Array;
};

/** The program a salmon's rope is drawn by, with the glint's texture `glint` (a whole canvas: it is
 *  sampled with the strip's own UVs, no frame). */
export function salmonUnder(texture: Texture, glint: Texture): SalmonUnder {
	const uniforms = new UniformGroup({
		uUnder: { value: 0, type: 'f32' },
		uGlintOn: { value: 0, type: 'f32' },
		uGlintAlpha: { value: 0, type: 'f32' },
		uColorMatrix: { value: new Float32Array(20), type: 'f32', size: 20 },
		uMatrixAlpha: { value: 1, type: 'f32' },
		uGlintStrip: {
			value: new Float32Array(GLINT_STRIP_POINTS * 4),
			type: 'vec2<f32>',
			size: GLINT_STRIP_POINTS * 2,
		},
	});
	const shader = new TexturedShader(programsOf().salmon, texture, {
		uGlintTexture: glint.source,
		salmonUniforms: uniforms,
	});
	const u = uniforms.uniforms as SalmonUniforms;
	return {
		shader,
		under: (matrix) => {
			u.uUnder = matrix ? 1 : 0;
			if (matrix) u.uColorMatrix.set(matrix);
			uniforms.update();
		},
		glint: (strip, scale, alpha) => {
			u.uGlintOn = alpha > 0 ? 1 : 0;
			u.uGlintAlpha = alpha;
			if (alpha > 0) {
				const at = strip.positions;
				for (let i = 0; i < u.uGlintStrip.length; i++) u.uGlintStrip[i] = at[i] * scale;
			}
			uniforms.update();
		},
		destroy: () => shader.destroy(),
	};
}

export type WadeUnder = {
	readonly shader: Shader;
	/**
	 * Under `line` (about the character's place), mixed to the colour matrix `under` below it, with
	 * `feet` the drawable's transform into the container its look is mounted in and `resolution`
	 * the screen's; `undefined`: as on land.
	 */
	water(
		wading:
			{ line: Waterline; under: readonly number[]; feet: Matrix; resolution: number } | undefined,
	): void;
	destroy(): void;
};

type WadeUniforms = {
	uWading: number;
	uFeetMatrix: Matrix;
	uScreenResolution: number;
	uLine: Float32Array;
	uUnder: Float32Array;
};

const wadeUniformsOf = () =>
	new UniformGroup({
		uWading: { value: 0, type: 'f32' },
		uFeetMatrix: { value: new Matrix(), type: 'mat3x3<f32>' },
		uScreenResolution: { value: 1, type: 'f32' },
		uLine: { value: new Float32Array(4), type: 'vec4<f32>' },
		uUnder: { value: new Float32Array(4), type: 'vec4<f32>' },
		uRim: { value: new Float32Array([WADE.rim.width, WADE.rim.alpha]), type: 'vec2<f32>' },
	});

const waterOf =
	(uniforms: UniformGroup): WadeUnder['water'] =>
	(wading) => {
		const u = uniforms.uniforms as WadeUniforms;
		u.uWading = wading ? 1 : 0;
		if (wading) {
			const { line, under, feet, resolution } = wading;
			u.uFeetMatrix.copyFrom(feet);
			u.uScreenResolution = resolution;
			u.uLine[0] = line.level;
			u.uLine[1] = line.sag;
			u.uLine[2] = line.reach;
			// `underTint`'s rows: what is kept of a channel, and what the tint adds to each.
			u.uUnder[0] = under[4];
			u.uUnder[1] = under[9];
			u.uUnder[2] = under[14];
			u.uUnder[3] = under[0];
		}
		uniforms.update();
	};

/** The program a wading body's textured mesh is drawn by (the bear's picture). */
export function wadeMeshUnder(texture: Texture): WadeUnder & { readonly shader: TextureShader } {
	const uniforms = wadeUniformsOf();
	const shader = new TexturedShader(programsOf().wadeMesh, texture, { wadeUniforms: uniforms });
	return {
		shader,
		water: waterOf(uniforms),
		destroy: () => shader.destroy(),
	};
}

/** The program a wading body's `Graphics` is drawn by (`GraphicsContext.customShader`). */
export function wadeGraphicsUnder(): WadeUnder {
	const uniforms = wadeUniformsOf();
	const shader = new Shader({
		glProgram: programsOf().wadeGraphics,
		resources: {
			localUniforms: new UniformGroup({
				uTransformMatrix: { value: new Matrix(), type: 'mat3x3<f32>' },
				uColor: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
				uRound: { value: 0, type: 'f32' },
			}),
			batchSamplers: getBatchSamplersUniformGroup(1),
			wadeUniforms: uniforms,
		},
	});
	return { shader, water: waterOf(uniforms), destroy: () => shader.destroy() };
}
