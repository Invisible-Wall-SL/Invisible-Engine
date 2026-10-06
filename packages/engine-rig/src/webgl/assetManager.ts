import { TextureAtlas } from '../atlas';
import { managed, type ContextLike, type ManagedWebGLRenderingContext } from './context';
import { GLTexture } from './texture';

type Done<T> = ((path: string, asset: T) => void) | undefined;
type Failed = ((path: string, message: string) => void) | undefined;

/**
 * Loads atlases (with their page images), JSON, binaries and textures by path, all relative to
 * `pathPrefix`. Poll `isLoadingComplete()`, then `require(path)`.
 */
export class AssetManager {
	readonly context: ManagedWebGLRenderingContext;
	private assets: Record<string, unknown> = {};
	private errors: Record<string, string> = {};
	private toLoad = 0;
	private loaded = 0;

	constructor(
		context: ContextLike,
		public pathPrefix = '',
	) {
		this.context = managed(context);
	}

	private start(path: string): string {
		this.toLoad++;
		return this.pathPrefix + path;
	}

	private succeed<T>(callback: Done<T>, path: string, asset: T): void {
		this.toLoad--;
		this.loaded++;
		this.assets[path] = asset;
		callback?.(path, asset);
	}

	private fail(callback: Failed, path: string, message: string): void {
		this.toLoad--;
		this.loaded++;
		this.errors[path] = message;
		callback?.(path, message);
	}

	private async fetchOk(url: string): Promise<Response> {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Couldn't load ${url}: status ${res.status}, ${res.statusText}`);
		return res;
	}

	loadText(path: string, success?: Done<string>, error?: Failed): void {
		const url = this.start(path);
		this.fetchOk(url)
			.then((r) => r.text())
			.then((t) => this.succeed(success, url, t), (e: Error) => this.fail(error, url, e.message));
	}

	loadJson(path: string, success?: Done<unknown>, error?: Failed): void {
		const url = this.start(path);
		this.fetchOk(url)
			.then((r) => r.text())
			.then(
				(t) => this.succeed(success, url, JSON.parse(t)),
				(e: Error) => this.fail(error, url, e.message),
			);
	}

	loadBinary(path: string, success?: Done<Uint8Array>, error?: Failed): void {
		const url = this.start(path);
		this.fetchOk(url)
			.then((r) => r.arrayBuffer())
			.then(
				(b) => this.succeed(success, url, new Uint8Array(b)),
				(e: Error) => this.fail(error, url, e.message),
			);
	}

	private image(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error(`Couldn't load image ${url}`));
			img.src = url;
		});
	}

	loadTexture(path: string, success?: Done<GLTexture>, error?: Failed): void {
		const url = this.start(path);
		this.image(url).then(
			(img) => this.succeed(success, url, new GLTexture(this.context, img)),
			(e: Error) => this.fail(error, url, e.message),
		);
	}

	/** Loads the atlas text, then each page image from the atlas's folder (or `fileAlias`). */
	loadTextureAtlas(
		path: string,
		success?: Done<TextureAtlas>,
		error?: Failed,
		fileAlias?: Record<string, string>,
	): void {
		const slash = path.lastIndexOf('/');
		const parent = slash >= 0 ? path.substring(0, slash + 1) : '';
		const url = this.start(path);
		this.fetchOk(url)
			.then((r) => r.text())
			.then(async (text) => {
				const atlas = new TextureAtlas(text);
				await Promise.all(
					atlas.pages.map(async (page) => {
						const imagePath = this.pathPrefix + (fileAlias ? fileAlias[page.name] : parent + page.name);
						const img = await this.image(imagePath).catch(() => {
							throw new Error(`Couldn't load texture atlas ${url} page image: ${imagePath}`);
						});
						page.setTexture(new GLTexture(this.context, img));
					}),
				);
				this.succeed(success, url, atlas);
			})
			.catch((e: Error) => this.fail(error, url, e.message));
	}

	get(path: string): unknown {
		return this.assets[this.pathPrefix + path];
	}

	require(path: string): unknown {
		const full = this.pathPrefix + path;
		const asset = this.assets[full];
		if (asset !== undefined) return asset;
		const error = this.errors[full];
		throw new Error(`Asset not found: ${path}${error ? '\n' + error : ''}`);
	}

	remove(path: string): unknown {
		const full = this.pathPrefix + path;
		const asset = this.assets[full] as { dispose?(): void } | undefined;
		asset?.dispose?.();
		delete this.assets[full];
		return asset;
	}

	removeAll(): void {
		for (const key of Object.keys(this.assets)) (this.assets[key] as { dispose?(): void })?.dispose?.();
		this.assets = {};
	}

	isLoadingComplete(): boolean {
		return this.toLoad === 0;
	}

	getToLoad(): number {
		return this.toLoad;
	}

	getLoaded(): number {
		return this.loaded;
	}

	hasErrors(): boolean {
		return Object.keys(this.errors).length > 0;
	}

	getErrors(): Record<string, string> {
		return this.errors;
	}

	dispose(): void {
		this.removeAll();
	}
}
