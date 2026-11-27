import {
	GlProgram,
	RendererType,
	Shader,
	UniformGroup,
	compileHighShaderGl,
	fragmentGlTemplate,
	globalUniformsBitGl,
	localUniformBitGl,
	roundPixelsBitGl,
	vertexGlTemplate,
	type Application,
	type HighShaderBit,
	type Renderer,
	type Texture,
	type WebGLRenderer,
} from 'pixi.js';
import { programLinks } from 'pixi-svelte/elementFx';

/**
 * THE RIVERBED'S RIPPLE, IN THE BED'S OWN PROGRAM: the old client's moving displacement map
 * (`river.ts` `displacementTexture`) read by the program the riverbed's meshes are drawn with, so
 * the bed takes no render target of its own and no pass over the screen.
 *
 * What the full-screen `DisplacementFilter` did to a pixel of the bed, the step does to a pixel of
 * a bed tile: the map is read at the pixel's place in the river's container (its `aInto`, less the
 * map's offset, a 256 px repeat), and the tile's picture is read that far off, the map's red and
 * green each pushing ±½ of {@link RIPPLE_SCALE} screen px, as the filter pushed them. The push is
 * turned from screen px to the atlas's UVs by the mesh's own transform (`uUvPerPx`: the bed's
 * px to UVs, the same for every tile; the screen's px to the bed's from the drawn transform).
 *
 * One difference: the filter read the whole bed, so a tile's edge took its neighbour's pixels; a
 * tile reads only its own picture, so a push that would leave its diamond (past
 * {@link RIPPLE_EDGE} of the way from its middle to its rim, where the picture is plain sand) reads
 * the pixel unpushed, and a pixel outside its diamond (the quad's clear corners) is never pushed in.
 * The seams between two sands stand still; the pebbles ripple as before. The push is in screen
 * axes; the filter turned it with its map sprite, which differs only for a turned container.
 */

/** How far the map pushes, screen px (the filter's `scale`). */
export const RIPPLE_SCALE = Object.freeze({ x: 6, y: 4 });
/** The map's repeat, px. */
export const RIPPLE_REPEAT = 256;
/** How far out of a tile's middle a pushed read may land, as a share of the way to its rim: the
 *  old client's pebbles lie within 0.9 of it (`river.ts` `paintRiverbed`). */
export const RIPPLE_EDGE = 0.9;

/** `HP`: `highp` where the fragment stage has it, else the best there is. */
const HP = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define HP highp
#else
#define HP mediump
#endif
`;

const rippleBit: HighShaderBit = {
	name: 'salmons-bed-ripple-bit',
	vertex: {
		header: /* glsl */ `
			in vec2 aInto;
			uniform vec2 uOffset;
			uniform mat2 uUvPerPx;
			out highp vec2 vNoise;
			out highp vec4 vToUv;
		`,
		main: /* glsl */ `
			vNoise = (aInto - uOffset) / ${RIPPLE_REPEAT.toFixed(1)};
		`,
		end: /* glsl */ `
			// A screen px in the atlas's UVs: back through the drawn transform to the bed's px, then
			// to the atlas.
			mat3 screen = worldTransformMatrix * modelMatrix;
			highp float det = screen[0][0] * screen[1][1] - screen[1][0] * screen[0][1];
			mat2 back = mat2(screen[1][1], -screen[0][1], -screen[1][0], screen[0][0]) / det;
			mat2 toUv = uUvPerPx * back;
			vToUv = vec4(toUv[0], toUv[1]);
		`,
	},
	fragment: {
		header: /* glsl */ `
			${HP}
			in HP vec2 vNoise;
			in HP vec4 vToUv;
			uniform sampler2D uTexture;
			uniform sampler2D uNoise;
			uniform vec2 uScale;
			uniform HP vec4 uSlot;
			uniform HP vec2 uSlotSize;
		`,
		main: /* glsl */ `
			HP vec2 base = vUV;
			vec4 map = texture(uNoise, vNoise);
			HP vec2 push = (map.xy - 0.5) * uScale;
			HP vec2 uv = base + mat2(vToUv.xy, vToUv.zw) * push;
			// The tile's own diamond in the atlas: its slot, found from the unpushed read.
			HP vec2 slot = floor(base / uSlot.xy) * uSlot.xy + uSlot.zw;
			HP vec2 st = (uv - slot) / uSlotSize - 0.5;
			HP vec2 st0 = (base - slot) / uSlotSize - 0.5;
			// Outside the diamond (the quad's clear corners) stays clear: no push reads the tile in.
			if (abs(st.x) + abs(st.y) > ${(RIPPLE_EDGE / 2).toFixed(3)} || abs(st0.x) + abs(st0.y) > 0.5) uv = base;
			outColor = texture(uTexture, uv);
		`,
	},
};

let program: GlProgram | undefined;
const programOf = () =>
	(program ??= new GlProgram({
		name: 'salmons-bed-ripple',
		...compileHighShaderGl({
			template: { vertex: vertexGlTemplate, fragment: fragmentGlTemplate },
			bits: [globalUniformsBitGl, localUniformBitGl, roundPixelsBitGl, rippleBit],
		}),
		preferredFragmentPrecision: 'highp',
	}));

const isWebGL = (renderer: Renderer): renderer is WebGLRenderer =>
	renderer.type === RendererType.WEBGL;

let refused = false;

/** Where the bed's tiles are on its atlas: the step of its slots, the margin round each picture,
 *  and a picture's size, all in UVs. */
export type BedAtlasLayout = {
	slot: { u: number; v: number };
	pad: { u: number; v: number };
	size: { u: number; v: number };
};

/** The ripple the riverbed is drawn with: one program for every bed mesh. */
export type BedRipple = {
	readonly shader: Shader;
	/** The map moved to (x, y), px in the river's container. */
	move(x: number, y: number): void;
	destroy(): void;
};

/**
 * The ripple for a bed drawn from `atlas` (laid out as `layout`; `uvPerPx` the bed's px to its UVs,
 * column by column) with the displacement map `noise`; none on a renderer that is not WebGL or
 * whose GPU refuses the program: the bed is then drawn plain, with no ripple and no pass.
 */
export function bedRipple(
	app: Application,
	atlas: Texture,
	noise: Texture,
	layout: BedAtlasLayout,
	uvPerPx: readonly [number, number, number, number],
): BedRipple | undefined {
	const { renderer } = app;
	if (!isWebGL(renderer) || !programLinks(renderer, programOf())) {
		if (!refused) console.warn('[salmons-art] the riverbed ripple is not drawn on this renderer');
		refused = true;
		return undefined;
	}
	const uniforms = new UniformGroup({
		uOffset: { value: new Float32Array(2), type: 'vec2<f32>' },
		uUvPerPx: { value: new Float32Array(uvPerPx), type: 'mat2x2<f32>' },
		uScale: { value: new Float32Array([RIPPLE_SCALE.x, RIPPLE_SCALE.y]), type: 'vec2<f32>' },
		uSlot: {
			value: new Float32Array([layout.slot.u, layout.slot.v, layout.pad.u, layout.pad.v]),
			type: 'vec4<f32>',
		},
		uSlotSize: { value: new Float32Array([layout.size.u, layout.size.v]), type: 'vec2<f32>' },
	});
	const shader = new Shader({
		glProgram: programOf(),
		resources: { uTexture: atlas.source, uNoise: noise.source, rippleUniforms: uniforms },
	});
	const offset = (uniforms.uniforms as { uOffset: Float32Array }).uOffset;
	const wrap = (v: number) => ((v % RIPPLE_REPEAT) + RIPPLE_REPEAT) % RIPPLE_REPEAT;
	return {
		shader,
		move: (x, y) => {
			offset[0] = wrap(x);
			offset[1] = wrap(y);
			uniforms.update();
		},
		destroy: () => shader.destroy(),
	};
}
