/**
 * The renderer behind Invisible Shader Graph's node thumbnails (`docs/design/invisible-shader-graph.md`
 * §8 step 7). ONE small offscreen WebGL renderer draws every node's probe (`probeDoc`) on the
 * element the preview shows, through the filter the game plays a custom kind with (`graphFilter`),
 * and copies each picture into the node's own 2-D canvas. A browser allows a page about 16 WebGL
 * contexts and drops the oldest past that, so a context per node would blank the preview on a
 * large graph. `ShaderThumbs` decides what to draw and when.
 */
import {
	elementFxParamUniform,
	type CustomElementFxUniform,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import { graphFilter, type ElementFxFilter } from 'pixi-svelte/elementFx';
import { CanvasSource, Container, Rectangle, Sprite, Texture, WebGLRenderer } from 'pixi.js';
import { RegionArt, drawSampleCard } from './shaderPreview.client';

/** A thumbnail's side in CSS px. */
export const THUMB_PX = 72;

/** The seed every thumbnail reads, as one element would: fixed, so pictures hold still. */
const THUMB_SEED = 41;

/** Distinct programs one renderer compiles before it is replaced: the GPU keeps each for the
 *  renderer's life, so a long session would otherwise grow without bound. */
const RECYCLE_AFTER = 320;

/** Filters kept, by GLSL: a node drawn again with the same program reuses its filter. */
const FILTERS_KEPT = 120;

/** A compiled probe: the pass body and uniforms `compileShaderEffect` gives. */
export interface ThumbProgram {
	body: string;
	uniforms: readonly CustomElementFxUniform[];
}

/** The moment a thumbnail shows: the preview's playhead and strength, the params at defaults. */
export interface ThumbMoment {
	t: number;
	seconds: number;
	intensity: number;
	params: ReadonlyMap<string, ElementFxParamSpec>;
}

export class ThumbRenderer {
	private readonly root = new Container();
	private readonly element = new Sprite();
	private readonly card: Texture;
	private readonly art = new RegionArt();
	private region: Texture | undefined;
	private artToken = 0;
	private readonly filters = new Map<string, ElementFxFilter>();
	/** `uElement`: the element's box as a share of the filter's area. */
	private box: [number, number, number, number] = [0, 0, 1, 1];
	private padding = 0;
	private compiled = 0;
	private destroyed = false;

	private constructor(
		private readonly renderer: WebGLRenderer,
		/** Device px per CSS px. */
		readonly resolution: number,
	) {
		// In eighths: Pixi works the card's pixel size back from its scale, and a scale such as 0.6
		// leaves it fractional (115.00000000000001), which uploads nothing.
		const scale = Math.max(0.25, Math.ceil(((THUMB_PX * resolution) / 240) * 8) / 8);
		this.card = new Texture({
			source: new CanvasSource({ resource: drawSampleCard(scale), resolution: scale }),
			label: 'shader-thumb-card',
		});
		this.element.anchor.set(0.5);
		this.element.texture = this.card;
		this.root.addChild(this.element);
		this.layout();
	}

	/** A renderer drawing `THUMB_PX` thumbnails at `resolution`; rejects without WebGL. */
	static async create(resolution: number): Promise<ThumbRenderer> {
		const renderer = new WebGLRenderer();
		try {
			await renderer.init({
				width: THUMB_PX,
				height: THUMB_PX,
				resolution,
				antialias: false,
				backgroundAlpha: 0,
				powerPreference: 'low-power',
			});
		} catch (err) {
			try {
				renderer.destroy();
			} catch {
				// Half-built: there may be nothing to tear down.
			}
			throw err;
		}
		return new ThumbRenderer(renderer, resolution);
	}

	/** It has compiled enough programs to be replaced by a fresh one. */
	get worn(): boolean {
		return this.compiled > RECYCLE_AFTER;
	}

	/** The element as the sample card. Cancels a region still loading. */
	useSampleCard(): void {
		this.artToken++;
		this.setTexture(this.card);
	}

	/**
	 * The element as an atlas region once it has loaded. False when a later choice overtook it;
	 * rejects when it cannot load, the element back on the sample card.
	 */
	async useRegion(manifestKey: string, name: string): Promise<boolean> {
		const token = ++this.artToken;
		let texture: Texture;
		try {
			texture = await this.art.texture(manifestKey, name);
		} catch (err) {
			if (token !== this.artToken || this.destroyed) return false;
			this.setTexture(this.card);
			throw err;
		}
		if (token !== this.artToken || this.destroyed) {
			texture.destroy();
			return false;
		}
		this.setTexture(texture);
		return true;
	}

	/** Room drawn around the element, as a share of its larger side (the effect's `padding`). */
	setPadding(padding: number): void {
		const next = Number.isFinite(padding) ? Math.max(0, padding) : 0;
		if (next === this.padding) return;
		this.padding = next;
		this.layout();
	}

	/** Draw `program` at `moment` and copy the picture into `target`. */
	draw(program: ThumbProgram, moment: ThumbMoment, target: HTMLCanvasElement): void {
		if (this.destroyed) return;
		const filter = this.filterFor(program);
		filter.set('uElement', ...this.box);
		filter.set('uPad', 0);
		for (const u of program.uniforms) {
			if (u.source.kind === 'time') {
				filter.set(u.name, moment.t, moment.seconds, moment.intensity, 0);
			} else if (u.source.kind === 'seed') {
				filter.set(u.name, THUMB_SEED);
			} else {
				const spec = moment.params.get(u.source.id);
				if (spec) filter.set(u.name, ...elementFxParamUniform(spec, undefined));
			}
		}
		if (this.element.filters?.[0] !== filter) this.element.filters = [filter];
		this.renderer.render({ container: this.root, clear: true });
		// Read in the same task as the render: the drawing buffer is not kept past it.
		const ctx = target.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, target.width, target.height);
		const source = this.renderer.canvas;
		ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, target.width, target.height);
	}

	/** Free the context and everything drawn with it. */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.artToken++;
		// Each in turn lets go of what the next frees: the filters hold the renderer's textures, and
		// the renderer the element's.
		this.element.filters = null;
		for (const filter of this.filters.values()) filter.destroy();
		this.filters.clear();
		this.root.destroy({ children: true });
		this.renderer.destroy();
		this.region?.destroy();
		this.region = undefined;
		this.card.destroy(true);
		this.art.destroy();
	}

	private filterFor(program: ThumbProgram): ElementFxFilter {
		const hit = this.filters.get(program.body);
		if (hit) {
			this.filters.delete(program.body);
			this.filters.set(program.body, hit);
			return hit;
		}
		const filter = graphFilter('thumb', { body: program.body, uniforms: [...program.uniforms] });
		this.filters.set(program.body, filter);
		this.compiled += 1;
		if (this.filters.size > FILTERS_KEPT) {
			const [oldest, dropped] = this.filters.entries().next().value as [string, ElementFxFilter];
			this.filters.delete(oldest);
			if (this.element.filters?.[0] === dropped) this.element.filters = null;
			dropped.destroy();
		}
		return filter;
	}

	private setTexture(texture: Texture): void {
		if (this.destroyed || this.element.texture === texture) return;
		this.element.texture = texture;
		const previous = this.region;
		this.region = texture === this.card ? undefined : texture;
		if (previous !== this.region) previous?.destroy();
		this.layout();
	}

	/** The element and its room fitted to the thumbnail, the filter bounded to that room. */
	private layout(): void {
		this.element.scale.set(1);
		const box = this.element.getLocalBounds().rectangle;
		const room = this.padding * Math.max(box.width, box.height);
		const area = new Rectangle(
			box.x - room,
			box.y - room,
			box.width + 2 * room,
			box.height + 2 * room,
		);
		const side = Math.max(area.width, area.height);
		this.element.scale.set(side > 0 ? THUMB_PX / side : 1);
		this.element.position.set(THUMB_PX / 2, THUMB_PX / 2);
		this.element.filterArea = area;
		this.box =
			area.width > 0 && area.height > 0
				? [
						(box.x - area.x) / area.width,
						(box.y - area.y) / area.height,
						box.width / area.width,
						box.height / area.height,
					]
				: [0, 0, 1, 1];
	}
}
