import { TextureFilter, TextureWrap, type AtlasPageTexture } from '../atlas';
import { managed, type ContextLike, type ManagedWebGLRenderingContext } from './context';

type Image = TexImageSource;

/** An image uploaded to a WebGL texture. `_image` and `texture` are read by the Rigger tools. */
export class GLTexture implements AtlasPageTexture {
	readonly context: ManagedWebGLRenderingContext;
	texture: WebGLTexture | null = null;
	_image: Image;
	private boundUnit = 0;
	private useMipMaps: boolean;

	constructor(context: ContextLike, image: Image, useMipMaps = false) {
		this.context = managed(context);
		this._image = image;
		this.useMipMaps = useMipMaps;
		this.restore();
		this.context.addRestorable(this);
	}

	getImage(): Image {
		return this._image;
	}

	setFilters(minFilter: TextureFilter, magFilter: TextureFilter): void {
		const gl = this.context.gl;
		this.bind();
		let min: number = minFilter;
		// Mipmapped minification needs mipmaps; without them fall back to linear.
		if (!this.useMipMaps && min !== TextureFilter.Nearest && min !== TextureFilter.Linear) min = gl.LINEAR;
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter === TextureFilter.Nearest ? gl.NEAREST : gl.LINEAR);
	}

	setWraps(uWrap: TextureWrap, vWrap: TextureWrap): void {
		const gl = this.context.gl;
		this.bind();
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, uWrap);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, vWrap);
	}

	update(useMipMaps: boolean): void {
		const gl = this.context.gl;
		if (!this.texture) this.texture = gl.createTexture();
		this.bind();
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._image);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, useMipMaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		if (useMipMaps) gl.generateMipmap(gl.TEXTURE_2D);
	}

	restore(): void {
		this.texture = null;
		this.update(this.useMipMaps);
	}

	bind(unit = 0): void {
		const gl = this.context.gl;
		this.boundUnit = unit;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
	}

	unbind(): void {
		const gl = this.context.gl;
		gl.activeTexture(gl.TEXTURE0 + this.boundUnit);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	dispose(): void {
		this.context.removeRestorable(this);
		this.context.gl.deleteTexture(this.texture);
		this.texture = null;
	}
}

