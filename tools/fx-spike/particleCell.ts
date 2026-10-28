/**
 * One particle of the shader sheets (`shaderParticles.entry.ts`, `shaderScreens.entry.ts`): the test
 * card in an atlas, drawn as one quad of a Pixi `Mesh` with a compiled effect as its material through
 * the particle shell (`constants-shared/particleShell`), trimmed, padded, tinted and faded.
 */
import {
	Container,
	FillGradient,
	Geometry,
	GlProgram,
	Graphics,
	Mesh,
	RenderTexture,
	Shader,
	UniformGroup,
} from 'pixi.js';
import {
	elementFxParamUniform,
	type CustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	PARTICLE_ATTRIBUTES,
	PARTICLE_VERTEX,
	particleShellSource,
} from '@fxroot/packages/constants-shared/particleShell';

/** The atlas: the test card drawn in a 256 × 256 texture. */
export const ATLAS = 256;
/** The particle's frame: untrimmed 140 × 170, its 124 × 144 trimmed box 8, 13 in, at 66, 56. */
export const ORIG = { w: 140, h: 170 };
export const TRIM = { x: 8, y: 13, w: 124, h: 144 };
export const FRAME = { x: 66, y: 56 };
/** Drawn at 0.8, padded by 0.1 of its larger side. */
export const SIZE = { w: ORIG.w * 0.8, h: ORIG.h * 0.8 };
export const PAD = 0.1 * Math.max(SIZE.w, SIZE.h);
/** What the particle carries: its seed, wave index and spawn order, its colour and its time. */
export const SEED = 41;
export const WAVE = 0.5;
export const ORDER = 0.25;
export const TINT = [1, 0.8, 0.6];
export const ALPHA = 0.9;
export const COLOR = [...TINT.map((c) => c * ALPHA), ALPHA];
export const TIME = [0.5, 0.5, 1, 0];

export const makeCard = (): Container => {
	const card = new Container();
	const fill = new FillGradient(0, 0, 120, 140);
	fill.addColorStop(0, 0xff4d6d);
	fill.addColorStop(0.5, 0xffb703);
	fill.addColorStop(1, 0x3a86ff);
	card.addChild(
		new Graphics()
			.roundRect(-60, -70, 120, 140, 18)
			.fill(fill)
			.stroke({ width: 4, color: 0xffffff }),
		new Graphics().star(0, -10, 5, 34, 16).fill(0xffffff),
		new Graphics().rect(-40, 30, 80, 16).fill(0x111111),
	);
	return card;
};

/** Each attribute's four values, one particle's quad, in the vertex shader's layout. */
export const quad = (): Record<string, number[][]> => {
	const pad = { x: PAD / SIZE.w, y: PAD / SIZE.h };
	const units = [
		[-pad.x, -pad.y],
		[1 + pad.x, -pad.y],
		[1 + pad.x, 1 + pad.y],
		[-pad.x, 1 + pad.y],
	];
	const at = (values: number[]): number[][] => units.map(() => values);
	return {
		aPosition: units.map(([u, v]) => [(u - 0.5) * SIZE.w, (v - 0.5) * SIZE.h, u, v]),
		aEfxFrame: at([SIZE.w, SIZE.h, SEED]),
		aEfxMap: at([(FRAME.x - TRIM.x) / ATLAS, (FRAME.y - TRIM.y) / ATLAS, ORIG.w / ATLAS, 0]),
		aEfxMap2: at([0, ORIG.h / ATLAS, WAVE, ORDER]),
		aEfxTrim: at([
			TRIM.x / ORIG.w,
			TRIM.y / ORIG.h,
			(TRIM.x + TRIM.w) / ORIG.w,
			(TRIM.y + TRIM.h) / ORIG.h,
		]),
		aEfxColor: at(COLOR),
		aEfxTime: at(TIME),
	};
};

export const FORMATS: Record<number, 'float32x2' | 'float32x3' | 'float32x4'> = {
	2: 'float32x2',
	3: 'float32x3',
	4: 'float32x4',
};

/** One particle drawn with `effect` as its material, or why it cannot be. */
export const particleMesh = (
	name: string,
	effect: CustomElementFx,
	atlas: RenderTexture,
): Mesh<Geometry, Shader> | string => {
	const fragment = particleShellSource(effect);
	if (!fragment) return 'the particle shell refuses its body';
	const values = quad();
	const missing = PARTICLE_ATTRIBUTES.filter((a) => values[a.name]?.[0]?.length !== a.size);
	if (missing.length) return `the page gives no ${missing.map((a) => a.name).join(', ')}`;
	const geometry = new Geometry({
		attributes: Object.fromEntries(
			PARTICLE_ATTRIBUTES.map((a) => [
				a.name,
				{ buffer: new Float32Array(values[a.name].flat()), format: FORMATS[a.size] },
			]),
		),
		indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
	});
	const params = new Map(effect.spec.params.map((p) => [p.id, p]));
	const uniforms: ConstructorParameters<typeof UniformGroup>[0] = {};
	for (const u of effect.shader.uniforms) {
		if (u.source.kind !== 'param') continue;
		const spec = params.get(u.source.id);
		const value = spec ? elementFxParamUniform(spec, spec.default) : [0];
		uniforms[u.name] =
			u.type === 'float'
				? { value: value[0], type: 'f32' as const }
				: { value: new Float32Array(value), type: `${u.type}<f32>` as const };
	}
	const shader = new Shader({
		glProgram: GlProgram.from({
			vertex: PARTICLE_VERTEX,
			fragment,
			name: `particle-${name.replace(/\W/g, '-')}`,
		}),
		resources: {
			uTexture: atlas.source,
			...(Object.keys(uniforms).length ? { efxParams: new UniformGroup(uniforms) } : {}),
		},
	});
	return new Mesh({ geometry, shader, texture: atlas });
};
