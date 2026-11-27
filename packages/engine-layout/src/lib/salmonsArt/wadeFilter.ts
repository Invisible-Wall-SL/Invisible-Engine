import {
	Filter,
	GlProgram,
	Matrix,
	RendererType,
	Sprite,
	type Application,
	type Container,
	type FilterSystem,
	type RenderSurface,
	type Renderer,
	type Texture,
	type WebGLRenderer,
} from 'pixi.js';
import { FILTER_VERTEX, programLinks } from 'pixi-svelte/elementFx';

import { WADE, type WadeSurface, type Waterline } from './wade';

/**
 * NOT PUT ON ANY BODY BY THE GAME (owner, 2026-11-27: no pass per body; `index.ts` gives the wading
 * no surface): kept as the pass the code look's own step (`bodyShaders.ts`) was drawn to, which the
 * checks and the pixel harness (`scripts/salmons/bodies-pixels.mjs`) still read it as.
 *
 * THE PASS THAT DRAWS A WADER'S WATER (`wade.ts`), written for the WebGL renderer the game forces,
 * as the Element FX passes are (`pixi-svelte` `elementFx/shaders.ts`, whose vertex stage it draws
 * with), in GLSL both WebGL 1 and 2 take. One pass over the look's own pixels, premultiplied as
 * Pixi hands them:
 * - `uFeet` takes a pixel of the pass to px about the character's place, upright (x right, y
 *   down), at the size the look was made, whatever the camera's zoom and the screen's resolution
 *   (`highp`: a place is hundreds of px, read to a fraction of one);
 * - below the waterline (`uLine`: its level, its sag, its half-width; `wade.ts` `waterlineAt`) a
 *   pixel is `(1 − a) · c + a · T`, alpha kept: `uUnder` is that colour matrix's own numbers
 *   (`leap.ts` `underTint`), so it is the colour the swimming salmon is drawn in;
 * - the line's edge is smoothed over one pixel of the screen (`uLine.w`, its size in those px),
 *   and a white band fading `uRim.x` px to each side of it is mixed in at `uRim.y`, only where the
 *   look has pixels.
 *
 * `uFeet` and the pixel's size are written as the pass is drawn ({@link WadeFilter.apply}): only
 * then is it known where on the screen Pixi put the pass's frame, and the look's place has this
 * frame's camera in it. A look under a container cached as a texture is not placed (nothing caches
 * the players' layer).
 */
const FRAGMENT = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform mat3 uFeet;
uniform vec4 uLine;
uniform vec4 uUnder;
uniform vec2 uRim;

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    vec2 at = (uFeet * vec3(vTextureCoord, 1.0)).xy;
    float across = min(abs(at.x) / uLine.z, 1.0);
    float below = at.y - (uLine.x + uLine.y * sqrt(1.0 - across * across));
    float edge = 0.5 * uLine.w;
    vec3 under = color.rgb * uUnder.a + uUnder.rgb * color.a;
    vec3 rgb = mix(color.rgb, under, smoothstep(-edge, edge, below));
    float rim = uRim.y * (1.0 - smoothstep(0.0, uRim.x, abs(below)));
    finalColor = vec4(mix(rgb, vec3(color.a), rim), color.a);
}
`;

const program = (): GlProgram =>
	GlProgram.from({ vertex: FILTER_VERTEX, fragment: FRAGMENT, name: 'salmons-wade' });

type WadeUniforms = { uFeet: Matrix; uLine: Float32Array; uUnder: Float32Array };

/** A sprite that is nowhere: mapped to it, a pass's frame is mapped to the screen. */
const SCREEN = new Sprite();

class WadeFilter extends Filter {
	/** The container the pass is on: its place on the screen is the character's. */
	look: Container | undefined;
	readonly wade: WadeUniforms;

	constructor() {
		super({
			glProgram: program(),
			resources: {
				wadeUniforms: {
					uFeet: { value: new Matrix(), type: 'mat3x3<f32>' },
					uLine: { value: new Float32Array(4), type: 'vec4<f32>' },
					uUnder: { value: new Float32Array(4), type: 'vec4<f32>' },
					uRim: {
						value: new Float32Array([WADE.rim.width, WADE.rim.alpha]),
						type: 'vec2<f32>',
					},
				},
			},
			// At the screen's own resolution and smoothing, as the look is drawn without the pass.
			resolution: 'inherit',
			antialias: 'inherit',
		});
		this.wade = (this.resources.wadeUniforms as { uniforms: WadeUniforms }).uniforms;
	}

	override apply(
		filterManager: FilterSystem,
		input: Texture,
		output: RenderSurface,
		clearMode: boolean,
	): void {
		const world = this.look?.worldTransform;
		if (world) {
			const across = 1 / (Math.hypot(world.a, world.b) || 1);
			const down = 1 / (Math.hypot(world.c, world.d) || 1);
			filterManager
				.calculateSpriteMatrix(this.wade.uFeet, SCREEN)
				.translate(-world.tx, -world.ty)
				.scale(across, down);
			this.wade.uLine[3] = down / input.source.resolution;
		}
		filterManager.applyFilter(this, input, output, clearMode);
	}
}

const isWebGL = (renderer: Renderer): renderer is WebGLRenderer =>
	renderer.type === RendererType.WEBGL;

let refused = false;

/** Ask the driver for the pass's program as the river mounts, not as the first bear steps in. */
export function warmWade(app: Application): void {
	if (isWebGL(app.renderer)) programLinks(app.renderer, program());
}

/**
 * The filter that draws one wader's water, or none on a renderer that is not WebGL or whose GPU
 * refuses the program (asked of the driver before the pass is ever on a look, so no look vanishes
 * with it): the wader is then drawn as it is on land.
 */
export function wadeSurface(app: Application): WadeSurface | undefined {
	const { renderer } = app;
	if (!isWebGL(renderer)) return undefined;
	if (!programLinks(renderer, program())) {
		if (!refused) console.warn('[salmons-art] the wading pass did not compile on this GPU');
		refused = true;
		return undefined;
	}
	const filter = new WadeFilter();
	const { uLine, uUnder } = filter.wade;
	return {
		filter,
		draw: (look: Container, line: Waterline, under: readonly number[]) => {
			filter.look = look;
			uLine[0] = line.level;
			uLine[1] = line.sag;
			uLine[2] = line.reach;
			// `underTint`'s rows: what is kept of a channel, and what the tint adds to each.
			uUnder[0] = under[4];
			uUnder[1] = under[9];
			uUnder[2] = under[14];
			uUnder[3] = under[0];
		},
		destroy: () => {
			filter.look = undefined;
			filter.destroy();
		},
	};
}
