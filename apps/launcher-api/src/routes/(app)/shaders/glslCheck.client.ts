/**
 * Invisible Shader Graph's test-compile of an effect holding Custom GLSL (design §8 step 8c): the
 * effect's shader, exactly as the game's runtime builds it (`graphFilter`, so Pixi's own WebGL1
 * defines, precision and header), compiled and linked by the browser's driver on an offscreen
 * WebGL1 context and an offscreen WebGL2 one. Nothing is drawn, so a bad shader cannot lose the
 * contexts the preview and the thumbnails draw with. The compiler's checker refuses what it can
 * see in the code; this catches what only a driver does (a type it infers, a built-in it lacks).
 * The page reads the verdicts through `shaderEditor.ts` (`driverIssues`), which maps a log's lines
 * back to the node's.
 */
import type { CustomElementFx } from 'constants-shared/elementFx';
import { graphFilter } from 'pixi-svelte/elementFx';

export type GlVersion = 1 | 2;

/** What one driver said of a shader. */
export interface DriverVerdict {
	gl: GlVersion;
	/** The browser gave no such context: nothing was checked there. */
	missing: boolean;
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
		const filter = graphFilter('glsl-check', shader);
		const vertex = filter.glProgram.vertex ?? '';
		const fragment = filter.glProgram.fragment ?? '';
		// The program stays in Pixi's cache, where the preview's filter of the same GLSL finds it.
		filter.destroy();
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
		const verdict = (
			ok: boolean,
			stage: DriverVerdict['stage'] = '',
			log = '',
			missing = false,
		): DriverVerdict => ({ gl: version, missing, ok, log, stage, fragment });
		const gl = this.context(version);
		if (!gl) return verdict(true, '', '', true);
		const made: WebGLShader[] = [];
		const program = gl.createProgram();
		try {
			for (const [stage, type, source] of [
				['vertex', gl.VERTEX_SHADER, vertex],
				['fragment', gl.FRAGMENT_SHADER, fragment],
			] as const) {
				const shader = gl.createShader(type);
				if (!shader || !program) return verdict(true, '', '', true);
				made.push(shader);
				gl.shaderSource(shader, source);
				gl.compileShader(shader);
				if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost())
					return verdict(false, stage, gl.getShaderInfoLog(shader) ?? '');
				gl.attachShader(program, shader);
			}
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost())
				return verdict(false, 'link', gl.getProgramInfoLog(program) ?? '');
			return verdict(true);
		} finally {
			for (const shader of made) gl.deleteShader(shader);
			if (program) gl.deleteProgram(program);
		}
	}
}
