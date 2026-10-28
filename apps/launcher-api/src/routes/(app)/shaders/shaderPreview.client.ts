/**
 * The live preview of Invisible Shader Graph (`docs/design/invisible-shader-graph.md` §8 step 5):
 * the graph being edited, compiled and registered as its custom Element FX kind, POSED on one
 * element through the runtime the game plays it with (`pixi-svelte/elementFx`). Posed, never
 * played: the stage shows the effect's look at the playhead's `t`, and a posed effect never ends on
 * its own. `ShaderPreview.svelte` owns the controls and the playhead; this module owns the stage.
 */
import {
	ELEMENT_FX_LIMITS,
	customElementFx,
	customElementFxList,
	setCustomElementFx,
	type CustomElementFx,
} from 'constants-shared/elementFx';
import {
	elementFxHostFor,
	playElementFx,
	type ElementFxHandle,
	type ElementFxPose,
} from 'pixi-svelte/elementFx';
import {
	CanvasSource,
	ImageSource,
	Rectangle,
	Sprite,
	Texture,
	groupD8,
	type Application,
	type TextureSource,
} from 'pixi.js';
import { fetchRegions, regionAssetUrl, type EditorRegion } from '../editor/editorRegions.client';

/** The share of the stage's smaller side the element's larger side fills; the rest is room for
 *  what an effect draws outside the element and for its motion. */
export const PREVIEW_FIT = 0.58;

export const PREVIEW_BACKGROUNDS = [
	{ id: 'dark', label: 'Dark' },
	{ id: 'light', label: 'Light' },
	{ id: 'checker', label: 'Checker' },
] as const;

export type PreviewBackground = (typeof PREVIEW_BACKGROUNDS)[number]['id'];

export interface Playhead {
	t: number;
	/** It reached the end without looping: the transport pauses. */
	ended: boolean;
}

/** The playhead `deltaMs` of play after `t`: at 1 it wraps when looping, else it stops there. */
export function advancePlayhead(
	t: number,
	deltaMs: number,
	durationMs: number,
	loop: boolean,
): Playhead {
	const step = durationMs > 0 && Number.isFinite(deltaMs) ? Math.max(0, deltaMs) / durationMs : 0;
	const next = (Number.isFinite(t) ? t : 0) + step;
	if (next < 1) return { t: next, ended: false };
	return loop ? { t: next % 1, ended: false } : { t: 1, ended: true };
}

/** One play of `effect`, as the runtime clamps it. */
export function previewDurationMs(effect: CustomElementFx): number {
	const { min, max } = ELEMENT_FX_LIMITS.durationMs;
	const ms = effect.spec.durationMs;
	return Number.isFinite(ms) ? Math.min(max, Math.max(min, ms)) : min;
}

/** The scale that fits a `width`×`height` element to {@link PREVIEW_FIT} of the view. */
export function fitScale(
	width: number,
	height: number,
	viewWidth: number,
	viewHeight: number,
	share = PREVIEW_FIT,
): number {
	const scale = (share * Math.min(viewWidth, viewHeight)) / Math.max(width, height);
	return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** The sample card in CSS px: rounded corners and a border for edge effects, colour and a face. */
const CARD = { width: 192, height: 240, radius: 22, border: 6 };

/** The sample card drawn at `resolution` device px per CSS px. */
export function drawSampleCard(resolution: number): HTMLCanvasElement {
	const { width, height, radius, border } = CARD;
	const canvas = document.createElement('canvas');
	canvas.width = width * resolution;
	canvas.height = height * resolution;
	const ctx = canvas.getContext('2d');
	if (!ctx) return canvas;
	ctx.scale(resolution, resolution);

	const face = new Path2D();
	face.roundRect(border / 2, border / 2, width - border, height - border, radius);
	const fill = ctx.createLinearGradient(0, 0, width, height);
	fill.addColorStop(0, '#ff4d6d');
	fill.addColorStop(0.5, '#ffb703');
	fill.addColorStop(1, '#3a86ff');
	ctx.fillStyle = fill;
	ctx.fill(face);
	ctx.lineWidth = border;
	ctx.strokeStyle = '#ffffff';
	ctx.stroke(face);

	const cx = width / 2;
	const cy = height * 0.42;
	ctx.beginPath();
	for (let i = 0; i < 10; i++) {
		const r = i % 2 ? 26 : 62;
		const a = -Math.PI / 2 + (i * Math.PI) / 5;
		ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
	}
	ctx.closePath();
	// Shadows ignore the context's transform: they are given in device px.
	ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
	ctx.shadowBlur = 10 * resolution;
	ctx.shadowOffsetY = 4 * resolution;
	ctx.fillStyle = '#ffffff';
	ctx.fill();
	ctx.shadowColor = 'transparent';

	const strip = { x: cx - 58, y: height * 0.75, w: 116, h: 26 };
	ctx.fillStyle = '#111111';
	ctx.beginPath();
	ctx.roundRect(strip.x, strip.y, strip.w, strip.h, 6);
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 15px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('SAMPLE', cx, strip.y + strip.h / 2 + 1);
	return canvas;
}

/** The sample card as a texture, {@link CARD} px in size whatever its resolution. */
export function sampleCardTexture(resolution: number): Texture {
	const res = Math.min(3, Math.max(1, Math.ceil(resolution)));
	return new Texture({
		source: new CanvasSource({ resource: drawSampleCard(res), resolution: res }),
		label: 'shader-preview-card',
	});
}

/**
 * `region` of an atlas page as a texture, the way Pixi's own spritesheet parser builds a frame: a
 * rotated frame is packed 90° clockwise (h × w on the page, as every producer stores it — see
 * `RegionThumb.svelte`), and a trimmed one sits at its offset in its untrimmed size.
 */
export function regionTexture(source: TextureSource, region: EditorRegion): Texture {
	const { x, y, w, h } = region;
	const rotated = region.rotated === true;
	const packedW = rotated ? h : w;
	const packedH = rotated ? w : h;
	if (
		!(w > 0 && h > 0) ||
		x < 0 ||
		y < 0 ||
		x + packedW > source.width ||
		y + packedH > source.height
	) {
		throw new Error('its rect lies outside the atlas page');
	}
	const origW = region.origW ?? w;
	const origH = region.origH ?? h;
	const offX = region.offX ?? 0;
	const offY = region.offY ?? 0;
	const trimmed = origW !== w || origH !== h || offX !== 0 || offY !== 0;
	return new Texture({
		source,
		frame: new Rectangle(x, y, packedW, packedH),
		orig: new Rectangle(0, 0, origW, origH),
		trim: trimmed ? new Rectangle(offX, offY, w, h) : undefined,
		rotate: rotated ? groupD8.S : groupD8.E,
		label: region.name,
	});
}

/** An atlas page through the editor's gated asset route (`/api/editor/asset`). */
async function loadPage(url: string): Promise<TextureSource> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`the atlas page answered HTTP ${res.status}`);
	// An ImageBitmap ignores WebGL's premultiply-on-upload; it has to be premultiplied here.
	const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'premultiply' });
	return new ImageSource({ resource: bitmap, label: url });
}

/** The project's atlas regions as textures, their pages loaded once (`/api/editor/regions`). */
export class RegionArt {
	private readonly pages = new Map<string, Promise<TextureSource>>();

	async texture(manifestKey: string, name: string): Promise<Texture> {
		const set = await fetchRegions(manifestKey);
		const region = set.regions.find((r) => r.name === name);
		if (!region) throw new Error('it is not in the atlas');
		if (!set.pageKey) throw new Error('the atlas has no page image');
		return regionTexture(await this.page(regionAssetUrl(set.pageKey, set.pageVersion)), region);
	}

	/** Free every page, those still loading included. */
	destroy(): void {
		for (const page of this.pages.values()) {
			void page.then(
				(source) => source.destroy(),
				() => {},
			);
		}
		this.pages.clear();
	}

	private page(url: string): Promise<TextureSource> {
		const hit = this.pages.get(url);
		if (hit) return hit;
		const page = loadPage(url);
		this.pages.set(url, page);
		page.catch(() => {
			if (this.pages.get(url) === page) this.pages.delete(url);
		});
		return page;
	}
}

/**
 * The preview's Pixi side: one element centred on `app`'s stage, the edited effect posed on it
 * through `playElementFx`, read from `pose` every frame. The effect starts again whenever it or the
 * element's art changes; the runtime puts the element back at rest in between.
 */
export class ShaderPreviewStage {
	readonly element = new Sprite();
	/** The project's atlas pages, loaded once for the element and the Particles element alike. */
	readonly art = new RegionArt();
	private readonly sample: Texture;
	/** The atlas region on the element, which this stage owns; the sample card stays. */
	private region: Texture | undefined;
	private artToken = 0;
	private shown: { effect: CustomElementFx } | undefined;
	/** What {@link show} registered: taken out again at {@link destroy} if still the only one. */
	private registered: CustomElementFx | undefined;
	private handle: ElementFxHandle | undefined;
	private destroyed = false;

	constructor(
		private readonly app: Application,
		private readonly pose: () => ElementFxPose,
	) {
		this.sample = sampleCardTexture(app.renderer.resolution);
		this.element.anchor.set(0.5);
		this.element.texture = this.sample;
		app.stage.addChild(this.element);
		this.layout();
	}

	/**
	 * Pose `effect` from now on, its params at their defaults, registered as the only custom effect
	 * (on this page only the edited graph plays), or nothing (`undefined`: the element at rest).
	 * False when it cannot play: the registry refused it, or the runtime did not start it.
	 */
	show(effect: CustomElementFx | undefined): boolean {
		this.stopPlay();
		this.shown = undefined;
		if (!effect || this.destroyed) return true;
		const [registered] = setCustomElementFx([effect]);
		this.registered = registered;
		if (!registered) return false;
		this.shown = { effect: registered };
		this.startPlay();
		return this.handle?.active ?? false;
	}

	/** The effect {@link show} registered and poses, if any. */
	get current(): CustomElementFx | undefined {
		return this.shown?.effect;
	}

	/** Show the element, or hide it while the preview draws on particles (it keeps posing). */
	setElementVisible(visible: boolean): void {
		this.element.visible = visible;
	}

	/** Draw the effect on the sample card. Cancels a region still loading. */
	useSampleCard(): void {
		this.artToken++;
		this.setTexture(this.sample);
	}

	/**
	 * Draw the effect on an atlas region once it has loaded (the current art stays until then).
	 * Resolves false when a later choice, or the stage's end, overtook it. When it cannot load it
	 * rejects, and the element falls back to the sample card.
	 */
	async useRegion(manifestKey: string, name: string): Promise<boolean> {
		const token = ++this.artToken;
		let texture: Texture;
		try {
			texture = await this.art.texture(manifestKey, name);
		} catch (err) {
			if (token !== this.artToken || this.destroyed) return false;
			this.setTexture(this.sample);
			throw err;
		}
		if (token !== this.artToken || this.destroyed) {
			texture.destroy();
			return false;
		}
		this.setTexture(texture);
		return true;
	}

	/** Follow the stage's new size (CSS px). */
	resize(width: number, height: number): void {
		if (this.destroyed || width <= 0 || height <= 0) return;
		const { screen } = this.app;
		if (screen.width !== width || screen.height !== height) this.app.renderer.resize(width, height);
		this.layout();
	}

	/** Stop the effect, take it out of the registry if it is still the only one, free the art. */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.artToken++;
		this.stopPlay();
		const mine = this.registered;
		const list = customElementFxList();
		if (mine && list.length === 1 && customElementFx(mine.spec.kind) === mine) {
			setCustomElementFx([]);
		}
		this.element.destroy();
		this.region?.destroy();
		this.region = undefined;
		this.sample.destroy(true);
		this.art.destroy();
	}

	/** Centred, fitted. While an effect moves the element the runtime takes this as its new rest. */
	private layout(): void {
		const { width, height } = this.app.screen;
		const { orig } = this.element.texture;
		this.element.scale.set(fitScale(orig.width, orig.height, width, height));
		this.element.position.set(width / 2, height / 2);
	}

	/** The element's art, the effect started again on it: the runtime measures the element once. */
	private setTexture(texture: Texture): void {
		if (this.destroyed || this.element.texture === texture) return;
		this.stopPlay();
		this.element.texture = texture;
		const previous = this.region;
		this.region = texture === this.sample ? undefined : texture;
		previous?.destroy();
		this.layout();
		this.startPlay();
	}

	private startPlay(): void {
		if (!this.shown) return;
		const { effect } = this.shown;
		this.handle = playElementFx(
			this.element,
			{ kind: effect.spec.kind, durationMs: effect.spec.durationMs, pose: this.pose },
			elementFxHostFor(this.app),
		);
	}

	private stopPlay(): void {
		this.handle?.stop();
		this.handle = undefined;
	}
}
