/**
 * The page's handle on Invisible Shader Graph's node thumbnails (`/shaders`, design §8 step 7): the
 * reactive part (on or off, remembered per browser; the backdrop; why none can draw) over
 * {@link ThumbScheduler}, which decides when each draws, found by the nodes and the preview
 * through the page's context.
 */
import type { ShaderGraphAnalysis, ShaderGraphDoc } from 'engine-shadergraph';
import { getContext, onDestroy, onMount, setContext } from 'svelte';
import type { GraphScope } from './shaderEditor';
import type { PreviewBackground } from './shaderPreview.client';
import { ThumbScheduler, type ThumbView } from './thumbScheduler.client';

const STORAGE_KEY = 'shaders.thumbnails';

export class ShaderThumbs {
	#enabled = $state(true);
	/** The preview's backdrop, behind every thumbnail. */
	background = $state<PreviewBackground>('dark');
	/** Why no thumbnail can draw (no WebGL), else empty. */
	failure = $state('');
	private readonly scheduler = new ThumbScheduler((message) => (this.failure = message));

	/** Thumbnails are drawn (remembered per browser). Off frees the renderer. */
	get enabled(): boolean {
		return this.#enabled;
	}

	set enabled(on: boolean) {
		if (on === this.#enabled) return;
		this.#enabled = on;
		try {
			localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
		} catch {
			// Private mode: the choice lasts this page.
		}
		this.scheduler.setEnabled(on);
	}

	/** Take the choice this browser made last time. */
	restore(): void {
		try {
			if (localStorage.getItem(STORAGE_KEY) !== 'off') return;
		} catch {
			return;
		}
		this.#enabled = false;
		this.scheduler.setEnabled(false);
	}

	/** Node `id`'s thumbnail canvas, drawn into while it is on screen; the result lets it go. */
	mount(id: string, canvas: HTMLCanvasElement): () => void {
		return this.scheduler.mount(id, canvas);
	}

	/** The graph as edited, the analysis of what the canvas shows (`scope`) and the selection. */
	update(
		doc: ShaderGraphDoc | null,
		analysis: ShaderGraphAnalysis | undefined,
		selected: readonly string[],
		scope: GraphScope = null,
	): void {
		this.scheduler.update(doc, analysis, selected, scope);
	}

	/** Follow what the preview shows. */
	setView(view: ThumbView): void {
		this.background = view.background;
		this.scheduler.setView(view);
	}

	destroy(): void {
		this.scheduler.destroy();
	}
}

const KEY = Symbol('shader-thumbs');

/** The page's thumbnails, for its nodes and its preview to find; freed with the page. */
export function provideShaderThumbs(): ShaderThumbs {
	const thumbs = new ShaderThumbs();
	setContext(KEY, thumbs);
	onMount(() => thumbs.restore());
	onDestroy(() => thumbs.destroy());
	return thumbs;
}

export const useShaderThumbs = (): ShaderThumbs | undefined =>
	getContext<ShaderThumbs | undefined>(KEY);
