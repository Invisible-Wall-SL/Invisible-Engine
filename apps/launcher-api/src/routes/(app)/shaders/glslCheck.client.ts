/**
 * Invisible Shader Graph's test-compile of an effect holding Custom GLSL (design §8 step 8c): the
 * effect's shader, exactly as the game's runtime builds it (`graphFilter`, so Pixi's own WebGL1
 * defines, precision and header), compiled and linked by the browser's driver on an offscreen
 * WebGL1 context and an offscreen WebGL2 one. Nothing is drawn, so a bad shader cannot lose the
 * contexts the preview and the thumbnails draw with. The compiler's checker refuses what it can
 * see in the code; this catches what only a driver does (a type it infers, a built-in it lacks).
 * The page reads the verdicts through `shaderEditor.ts` (`driverIssues`), which maps a log's lines
 * back to the node's. A check leaves nothing behind: its program is built outside Pixi's program
 * cache (which keeps every program it builds for the page's life) and its GL objects are deleted.
 */
import type { CustomElementFx } from 'constants-shared/elementFx';
import { graphFilter } from 'pixi-svelte/elementFx';
import { GlProgram } from 'pixi.js';

export type GlVersion = 1 | 2;

/** What one driver said of a shader. */
export interface DriverVerdict {
	gl: GlVersion;
	/** Nothing was checked there: the browser gave no such context, or it was lost meanwhile. */
	missing: boolean;
	/** The context was lost during the check: it is made again for the next one. */
	lost: boolean;
	/** The driver compiled and linked it. Never true for a check that did not happen. */
	ok: boolean;
	/** The compile log of the shader that failed, else the link log. */
	log: string;
	/** Which shader the log is about. */
	stage: 'fragment' | 'vertex' | 'link' | '';
	/** The fragment shader as compiled, whose lines the log names. */
	fragment: string;
}

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

const KINDS: Record<GlVersion, 'webgl' | 'webgl2'> = { 1: 'webgl', 2: 'webgl2' };

/** Two offscreen contexts, made on first use and kept: a context per check would run out. */
export class DriverCompiler {
	private readonly contexts = new Map<GlVersion, Gl | null>();

	/** `shader` compiled and linked on WebGL1 and on WebGL2. */
	compile(shader: CustomElementFx['shader']): DriverVerdict[] {
		const { vertex, fragment } = programSources(shader);
		return ([1, 2] as const).map((gl) => this.check(gl, vertex, fragment));
	}

	/** Let the contexts go. */
	destroy(): void {
		for (const gl of this.contexts.values()) gl?.getExtension('WEBGL_lose_context')?.loseContext();
		this.contexts.clear();
	}

	private context(version: GlVersion): Gl | null {
		const kept = this.contexts.get(version);
		if (kept && !kept.isContextLost()) return kept;
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const gl = canvas.getContext(KINDS[version], {
			antialias: false,
			depth: false,
			stencil: false,
			powerPreference: 'low-power',
		}) as Gl | null;
		this.contexts.set(version, gl);
		return gl;
	}

	private check(version: GlVersion, vertex: string, fragment: string): DriverVerdict {
		const base = { gl: version, ok: false, missing: false, lost: false, log: '', fragment };
		/** Not checked: no context, or (`lost`) it went while checking, so its answers mean nothing. */
		const unchecked = (lost: boolean): DriverVerdict => ({
			...base,
			missing: true,
			lost,
			stage: '',
		});
		const gl = this.context(version);
		if (!gl) return unchecked(false);
		const made: WebGLShader[] = [];
		const program = gl.createProgram();
		try {
			for (const [stage, type, source] of [
				['vertex', gl.VERTEX_SHADER, vertex],
				['fragment', gl.FRAGMENT_SHADER, fragment],
			] as const) {
				const shader = gl.createShader(type);
				if (!shader || !program) return unchecked(gl.isContextLost());
				made.push(shader);
				gl.shaderSource(shader, source);
				gl.compileShader(shader);
				const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true;
				if (gl.isContextLost()) return unchecked(true);
				if (!compiled) return { ...base, stage, log: gl.getShaderInfoLog(shader) ?? '' };
				gl.attachShader(program, shader);
			}
			gl.linkProgram(program);
			const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
			if (gl.isContextLost()) return unchecked(true);
			if (!linked) return { ...base, stage: 'link', log: gl.getProgramInfoLog(program) ?? '' };
			return { ...base, ok: true, stage: '' };
		} finally {
			for (const shader of made) gl.deleteShader(shader);
			if (program) gl.deleteProgram(program);
		}
	}
}

/**
 * The vertex and fragment shaders the runtime's filter for `shader` compiles (`graphFilter`, with
 * Pixi's WebGL1 defines and precision), its program built outside Pixi's program cache: the filter
 * asks `GlProgram.from`, which would keep it for the page's life, so for the one synchronous
 * construction that asks for a program of its own instead. Nothing of it is kept.
 */
function programSources(shader: CustomElementFx['shader']): { vertex: string; fragment: string } {
	const cached = GlProgram.from;
	GlProgram.from = (options) => new GlProgram(options);
	let filter: ReturnType<typeof graphFilter>;
	try {
		filter = graphFilter('glsl-check', shader);
	} finally {
		GlProgram.from = cached;
	}
	const sources = {
		vertex: filter.glProgram.vertex ?? '',
		fragment: filter.glProgram.fragment ?? '',
	};
	filter.destroy();
	return sources;
}
