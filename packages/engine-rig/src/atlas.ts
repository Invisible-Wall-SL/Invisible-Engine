import {
	BoundingBoxAttachment,
	ClippingAttachment,
	MeshAttachment,
	PathAttachment,
	PointAttachment,
	RegionAttachment,
	TextureAtlasRegionBase,
	type Sequence,
} from './attachments';
import type { Skin } from './data';

export enum TextureFilter {
	Nearest = 9728,
	Linear = 9729,
	MipMapNearestNearest = 9984,
	MipMapLinearNearest = 9985,
	MipMapNearestLinear = 9986,
	MipMapLinearLinear = 9987,
}

export enum TextureWrap {
	MirroredRepeat = 33648,
	ClampToEdge = 33071,
	Repeat = 10497,
}

/** What a renderer's page texture may implement so the atlas can pass its sampling settings on. */
export interface AtlasPageTexture {
	setFilters?(minFilter: TextureFilter, magFilter: TextureFilter): void;
	setWraps?(uWrap: TextureWrap, vWrap: TextureWrap): void;
	dispose?(): void;
}

export class TextureAtlasPage {
	minFilter = TextureFilter.Nearest;
	magFilter = TextureFilter.Nearest;
	uWrap = TextureWrap.ClampToEdge;
	vWrap = TextureWrap.ClampToEdge;
	texture: unknown = null;
	width = 0;
	height = 0;
	pma = false;
	scale = 1;
	regions: TextureAtlasRegion[] = [];

	constructor(public name: string) {}

	setTexture(texture: unknown): void {
		this.texture = texture;
		const t = texture as AtlasPageTexture | null;
		t?.setFilters?.(this.minFilter, this.magFilter);
		t?.setWraps?.(this.uWrap, this.vWrap);
		for (const region of this.regions) region.texture = texture;
	}
}

export class TextureAtlasRegion extends TextureAtlasRegionBase {
	declare page: TextureAtlasPage;
	x = 0;
	y = 0;
	index = -1;
	names: string[] | null = null;
	values: number[][] | null = null;

	/** Joins `page.regions` on construction, which tools that build regions by hand rely on. */
	constructor(
		page: TextureAtlasPage,
		public name: string,
	) {
		super(page);
		page.regions.push(this);
	}
}

const filterByName: Record<string, TextureFilter> = {
	nearest: TextureFilter.Nearest,
	linear: TextureFilter.Linear,
	mipmap: TextureFilter.MipMapLinearLinear,
	mipmapnearestnearest: TextureFilter.MipMapNearestNearest,
	mipmaplinearnearest: TextureFilter.MipMapLinearNearest,
	mipmapnearestlinear: TextureFilter.MipMapNearestLinear,
	mipmaplinearlinear: TextureFilter.MipMapLinearLinear,
};

const parseFilter = (name: string | undefined): TextureFilter =>
	filterByName[(name ?? '').toLowerCase()] ?? TextureFilter.Nearest;

/** Splits `key: a, b, c` into `[key, a, b, c]` (at most four values, like the format allows). */
function readEntry(line: string | null): string[] | null {
	if (line === null) return null;
	const trimmed = line.trim();
	if (!trimmed) return null;
	const colon = trimmed.indexOf(':');
	if (colon === -1) return null;
	const out = [trimmed.slice(0, colon).trim()];
	const rest = trimmed.slice(colon + 1).split(',');
	for (let i = 0; i < rest.length; i++) {
		if (out.length === 4 && i < rest.length - 1) {
			out.push(rest.slice(i).join(',').trim());
			break;
		}
		out.push(rest[i].trim());
	}
	return out;
}

/** The libGDX/Spine text atlas: pages separated by blank lines, each a name line plus
 * `key: values` lines, followed by its regions (a name line plus `key: values` lines). */
export class TextureAtlas {
	pages: TextureAtlasPage[] = [];
	regions: TextureAtlasRegion[] = [];

	constructor(atlasText: string) {
		const lines = atlasText.split(/\r\n|\r|\n/);
		let i = 0;
		const next = (): string | null => (i < lines.length ? lines[i++] : null);
		let line = next();
		while (line !== null && !line.trim()) line = next();
		// Optional atlas-wide header entries before the first page (ignored).
		while (line !== null && line.trim() && readEntry(line)) line = next();

		let page: TextureAtlasPage | null = null;
		while (line !== null) {
			if (!line.trim()) {
				page = null;
				line = next();
				continue;
			}
			if (!page) {
				page = new TextureAtlasPage(line.trim());
				for (;;) {
					line = next();
					const e = readEntry(line);
					if (!e) break;
					this.readPageField(page, e);
				}
				this.pages.push(page);
				continue;
			}
			const region = new TextureAtlasRegion(page, line.trim());
			page.regions.pop();
			let names: string[] | null = null;
			let values: number[][] | null = null;
			for (;;) {
				line = next();
				const e = readEntry(line);
				if (!e) break;
				if (!this.readRegionField(region, e)) {
					(names ??= []).push(e[0]);
					(values ??= []).push(e.slice(1).map((v) => parseInt(v, 10)));
				}
			}
			if (region.originalWidth === 0 && region.originalHeight === 0) {
				region.originalWidth = region.width;
				region.originalHeight = region.height;
			}
			if (names && values) {
				region.names = names;
				region.values = values;
			}
			region.u = region.x / page.width;
			region.v = region.y / page.height;
			const packedW = region.degrees === 90 ? region.height : region.width;
			const packedH = region.degrees === 90 ? region.width : region.height;
			region.u2 = (region.x + packedW) / page.width;
			region.v2 = (region.y + packedH) / page.height;
			page.regions.push(region);
			this.regions.push(region);
		}
	}

	private readPageField(page: TextureAtlasPage, e: string[]): void {
		switch (e[0]) {
			case 'size':
				page.width = parseInt(e[1], 10);
				page.height = parseInt(e[2], 10);
				break;
			case 'filter':
				page.minFilter = parseFilter(e[1]);
				page.magFilter = parseFilter(e[2]);
				break;
			case 'repeat':
				if (e[1].includes('x')) page.uWrap = TextureWrap.Repeat;
				if (e[1].includes('y')) page.vWrap = TextureWrap.Repeat;
				break;
			case 'pma':
				page.pma = e[1] === 'true';
				break;
			case 'scale':
				page.scale = parseFloat(e[1]);
				break;
		}
	}

	private readRegionField(r: TextureAtlasRegion, e: string[]): boolean {
		const n = (k: number): number => parseInt(e[k], 10);
		switch (e[0]) {
			case 'xy':
				r.x = n(1);
				r.y = n(2);
				return true;
			case 'size':
				r.width = n(1);
				r.height = n(2);
				return true;
			case 'bounds':
				r.x = n(1);
				r.y = n(2);
				r.width = n(3);
				r.height = n(4);
				return true;
			case 'offset':
				r.offsetX = n(1);
				r.offsetY = n(2);
				return true;
			case 'orig':
				r.originalWidth = n(1);
				r.originalHeight = n(2);
				return true;
			case 'offsets':
				r.offsetX = n(1);
				r.offsetY = n(2);
				r.originalWidth = n(3);
				r.originalHeight = n(4);
				return true;
			case 'rotate':
				if (e[1] === 'true') r.degrees = 90;
				else if (e[1] !== 'false') r.degrees = n(1);
				return true;
			case 'index':
				r.index = n(1);
				return true;
		}
		return false;
	}

	findRegion(name: string): TextureAtlasRegion | null {
		for (const region of this.regions) if (region.name === name) return region;
		return null;
	}

	setTextures(textureFor: (page: TextureAtlasPage) => unknown): void {
		for (const page of this.pages) page.setTexture(textureFor(page));
	}

	dispose(): void {
		for (const page of this.pages) (page.texture as AtlasPageTexture | null)?.dispose?.();
	}
}

export interface AttachmentLoader {
	newRegionAttachment(
		skin: Skin,
		name: string,
		path: string,
		sequence: Sequence | null,
	): RegionAttachment | null;
	newMeshAttachment(
		skin: Skin,
		name: string,
		path: string,
		sequence: Sequence | null,
	): MeshAttachment | null;
	newBoundingBoxAttachment(skin: Skin, name: string): BoundingBoxAttachment | null;
	newPathAttachment(skin: Skin, name: string): PathAttachment | null;
	newPointAttachment(skin: Skin, name: string): PointAttachment | null;
	newClippingAttachment(skin: Skin, name: string): ClippingAttachment | null;
}

/** Resolves region and mesh art against a texture atlas. */
export class AtlasAttachmentLoader implements AttachmentLoader {
	constructor(public atlas: TextureAtlas) {}

	loadSequence(name: string, basePath: string, sequence: Sequence): void {
		for (let i = 0; i < sequence.regions.length; i++) {
			const path = sequence.getPath(basePath, i);
			const region = this.atlas.findRegion(path);
			if (!region) throw new Error(`Region not found in atlas: ${path} (sequence: ${name})`);
			sequence.regions[i] = region;
		}
	}

	newRegionAttachment(
		skin: Skin,
		name: string,
		path: string,
		sequence: Sequence | null,
	): RegionAttachment {
		const attachment = new RegionAttachment(name, path);
		if (sequence) {
			this.loadSequence(name, path, sequence);
			return attachment;
		}
		const region = this.atlas.findRegion(path);
		if (!region) throw new Error(`Region not found in atlas: ${path} (region attachment: ${name})`);
		attachment.region = region;
		return attachment;
	}

	newMeshAttachment(
		skin: Skin,
		name: string,
		path: string,
		sequence: Sequence | null,
	): MeshAttachment {
		const attachment = new MeshAttachment(name, path);
		if (sequence) {
			this.loadSequence(name, path, sequence);
			return attachment;
		}
		const region = this.atlas.findRegion(path);
		if (!region) throw new Error(`Region not found in atlas: ${path} (mesh attachment: ${name})`);
		attachment.region = region;
		return attachment;
	}

	newBoundingBoxAttachment(skin: Skin, name: string): BoundingBoxAttachment {
		return new BoundingBoxAttachment(name);
	}

	newPathAttachment(skin: Skin, name: string): PathAttachment {
		return new PathAttachment(name);
	}

	newPointAttachment(skin: Skin, name: string): PointAttachment {
		return new PointAttachment(name);
	}

	newClippingAttachment(skin: Skin, name: string): ClippingAttachment {
		return new ClippingAttachment(name);
	}
}
