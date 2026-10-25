/**
 * The page's handle on the driver test-compile of Custom GLSL (`glslCheck.client.ts`): which shader
 * was last checked and what WebGL1 and WebGL2 said of it, reactive. Only an effect holding Custom
 * GLSL is checked (the compiler's own GLSL is compiled on both in CI), a short while after its
 * shader last changed, and only when it changed.
 */
import type { CustomElementFx } from 'constants-shared/elementFx';
import type { ShaderGraphDoc } from 'engine-shadergraph';
import { onDestroy } from 'svelte';
import { DriverCompiler, type DriverVerdict } from './glslCheck.client';

const CHECK_DEBOUNCE_MS = 400;

type Shader = CustomElementFx['shader'];

const keyOf = (shader: Shader | undefined): string =>
	shader ? JSON.stringify([shader.body, shader.uniforms]) : '';

export class GlslCheck {
	/** What each driver said of the shader {@link checked}. */
	verdicts = $state.raw<DriverVerdict[]>([]);
	/** The doc that shader was compiled from: its code is what the verdicts' lines are of. */
	doc = $state.raw<ShaderGraphDoc | null>(null);
	/** The shader the verdicts are of ('' none). */
	checked = $state('');
	/** The shader to check ('' none). */
	wanted = $state('');
	private next: { shader: Shader; doc: ShaderGraphDoc } | undefined;
	private compiler: DriverCompiler | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** A check is due: the verdicts are of another shader, or of none yet. */
	get pending(): boolean {
		return this.wanted !== this.checked;
	}

	/** Check `shader` (`doc`'s compiled effect's, while it holds Custom GLSL), or nothing. */
	update(shader: Shader | undefined, doc: ShaderGraphDoc | null): void {
		const key = keyOf(shader);
		if (key === this.wanted) return;
		this.wanted = key;
		this.next = shader && doc ? { shader, doc } : undefined;
		clearTimeout(this.timer);
		if (shader) this.timer = setTimeout(() => this.run(), CHECK_DEBOUNCE_MS);
		else this.run();
	}

	/** Check what waits now (a compile is synchronous): the verdicts are then of the last shader. */
	checkNow(): void {
		if (!this.pending) return;
		clearTimeout(this.timer);
		this.run();
	}

	destroy(): void {
		clearTimeout(this.timer);
		this.compiler?.destroy();
		this.compiler = undefined;
	}

	private run(): void {
		const next = this.next;
		const key = this.wanted;
		this.doc = next?.doc ?? null;
		if (!next) {
			this.verdicts = [];
			this.checked = key;
			return;
		}
		this.compiler ??= new DriverCompiler();
		try {
			this.verdicts = this.compiler.compile(next.shader);
		} catch (err) {
			const log = err instanceof Error ? err.message : String(err);
			this.verdicts = ([1, 2] as const).map((gl) => ({
				gl,
				missing: true,
				ok: true,
				log,
				stage: '' as const,
				fragment: '',
			}));
		}
		this.checked = key;
	}
}

/** The page's check, freed with it. */
export function provideGlslCheck(): GlslCheck {
	const check = new GlslCheck();
	onDestroy(() => check.destroy());
	return check;
}
