import { Texture, type TextureSource } from 'pixi.js';
import { TextureFilter, TextureWrap, type AtlasPageTexture } from '../atlas';

const scaleMode = (filter: TextureFilter): 'nearest' | 'linear' =>
	filter === TextureFilter.Nearest || filter === TextureFilter.MipMapNearestNearest
		? 'nearest'
		: 'linear';

const usesMipmaps = (filter: TextureFilter): boolean =>
	filter !== TextureFilter.Nearest && filter !== TextureFilter.Linear;

const addressMode = (wrap: TextureWrap): 'repeat' | 'mirror-repeat' | 'clamp-to-edge' =>
	wrap === TextureWrap.Repeat
		? 'repeat'
		: wrap === TextureWrap.MirroredRepeat
			? 'mirror-repeat'
			: 'clamp-to-edge';

/** An atlas page's Pixi texture: the page's `TextureSource`, and a `Texture` covering all of it
 * (attachment UVs are page-relative). */
export class RigPageTexture implements AtlasPageTexture {
	readonly texture: Texture;

	constructor(readonly source: TextureSource) {
		this.texture = new Texture({ source });
	}

	static from(source: TextureSource): RigPageTexture {
		return new RigPageTexture(source);
	}

	setFilters(minFilter: TextureFilter, magFilter: TextureFilter): void {
		const style = this.source.style;
		style.minFilter = scaleMode(minFilter);
		style.magFilter = scaleMode(magFilter);
		if (usesMipmaps(minFilter)) {
			this.source.autoGenerateMipmaps = true;
			style.mipmapFilter = 'linear';
		}
		style.update();
	}

	setWraps(uWrap: TextureWrap, vWrap: TextureWrap): void {
		const style = this.source.style;
		style.addressModeU = addressMode(uWrap);
		style.addressModeV = addressMode(vWrap);
		style.update();
	}

	dispose(): void {
		this.texture.destroy();
		this.source.destroy();
	}
}
