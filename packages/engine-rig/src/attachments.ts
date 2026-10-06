import { Color, DEG_RAD, type NumberArrayLike } from './math';
import type { SlotData } from './data';
import type { Bone } from './bone';
import type { Slot } from './slot';

/** A rectangle of a texture page. Pages carry an opaque renderer texture. */
export class TextureRegion {
	/** Renderer-specific texture for this region's page (set by the renderer). */
	texture: unknown = null;
	renderObject: unknown = null;
	u = 0;
	v = 0;
	u2 = 0;
	v2 = 0;
	width = 0;
	height = 0;
	degrees = 0;
	offsetX = 0;
	offsetY = 0;
	originalWidth = 0;
	originalHeight = 0;
}

let nextVertexAttachmentId = 0;
let nextSequenceId = 0;

export type AttachmentKind = 'region' | 'mesh' | 'boundingbox' | 'path' | 'point' | 'clipping';

export abstract class Attachment {
	abstract readonly kind: AttachmentKind;

	constructor(public name: string) {
		if (!name) throw new Error('name cannot be null.');
	}

	abstract copy(): Attachment;
}

export enum SequenceMode {
	hold = 0,
	once = 1,
	loop = 2,
	pingpong = 3,
	onceReverse = 4,
	loopReverse = 5,
	pingpongReverse = 6,
}

export const SequenceModeValues: SequenceMode[] = [
	SequenceMode.hold,
	SequenceMode.once,
	SequenceMode.loop,
	SequenceMode.pingpong,
	SequenceMode.onceReverse,
	SequenceMode.loopReverse,
	SequenceMode.pingpongReverse,
];

export interface HasTextureRegion {
	path: string;
	region: TextureRegion | null;
	color: Color;
	sequence: Sequence | null;
	updateRegion(): void;
}

/** A numbered run of atlas images shown one at a time on a region or mesh. */
export class Sequence {
	id = nextSequenceId++;
	regions: Array<TextureRegion | null>;
	start = 0;
	digits = 0;
	setupIndex = 0;

	constructor(count: number) {
		this.regions = new Array<TextureRegion | null>(count).fill(null);
	}

	copy(): Sequence {
		const copy = new Sequence(this.regions.length);
		copy.regions = this.regions.slice();
		copy.start = this.start;
		copy.digits = this.digits;
		copy.setupIndex = this.setupIndex;
		return copy;
	}

	apply(slot: Slot, attachment: HasTextureRegion): void {
		let index = slot.sequenceIndex;
		if (index === -1) index = this.setupIndex;
		if (index >= this.regions.length) index = this.regions.length - 1;
		const region = this.regions[index];
		if (attachment.region !== region) {
			attachment.region = region;
			attachment.updateRegion();
		}
	}

	getPath(basePath: string, index: number): string {
		const frame = String(this.start + index);
		const pad = Math.max(0, this.digits - frame.length);
		return basePath + '0'.repeat(pad) + frame;
	}
}

export abstract class VertexAttachment extends Attachment {
	id = nextVertexAttachmentId++;
	/** Weighted: per vertex `count, boneIndex × count`. Null for unweighted geometry. */
	bones: number[] | null = null;
	/** Unweighted: `x, y` pairs in bone space. Weighted: `x, y, weight` per influence. */
	vertices: NumberArrayLike = [];
	worldVerticesLength = 0;
	/** The attachment whose deform/sequence timelines drive this one (itself, or a linked mesh's parent). */
	timelineAttachment: Attachment = this;

	/** Transforms `count` world-vertex components starting at component `start` into
	 * `worldVertices`, writing `x, y` every `stride` entries from `offset`. */
	computeWorldVertices(
		slot: Slot,
		start: number,
		count: number,
		worldVertices: NumberArrayLike,
		offset: number,
		stride: number,
	): void {
		const end = offset + (count >> 1) * stride;
		const deform = slot.deform;
		const weights = this.bones;
		if (!weights) {
			const source = deform.length > 0 ? deform : this.vertices;
			const bone = slot.bone;
			const { a, b, c, d, worldX, worldY } = bone;
			for (let v = start, w = offset; w < end; v += 2, w += stride) {
				const x = source[v];
				const y = source[v + 1];
				worldVertices[w] = x * a + y * b + worldX;
				worldVertices[w + 1] = x * c + y * d + worldY;
			}
			return;
		}
		// Skip the weighted records of the vertices before `start`.
		let cursor = 0;
		let influencesBefore = 0;
		for (let i = 0; i < start; i += 2) {
			const n = weights[cursor];
			cursor += n + 1;
			influencesBefore += n;
		}
		const skeletonBones = slot.bone.skeleton.bones;
		const vertices = this.vertices;
		const deformed = deform.length > 0;
		let vi = influencesBefore * 3;
		let di = influencesBefore << 1;
		for (let w = offset; w < end; w += stride) {
			let wx = 0;
			let wy = 0;
			const n = weights[cursor++];
			for (let k = 0; k < n; k++, cursor++, vi += 3, di += 2) {
				const bone = skeletonBones[weights[cursor]];
				let x = vertices[vi];
				let y = vertices[vi + 1];
				if (deformed) {
					x += deform[di];
					y += deform[di + 1];
				}
				const weight = vertices[vi + 2];
				wx += (x * bone.a + y * bone.b + bone.worldX) * weight;
				wy += (x * bone.c + y * bone.d + bone.worldY) * weight;
			}
			worldVertices[w] = wx;
			worldVertices[w + 1] = wy;
		}
	}

	copyTo(target: VertexAttachment): void {
		target.bones = this.bones ? this.bones.slice() : null;
		target.vertices = this.vertices.slice();
		target.worldVerticesLength = this.worldVerticesLength;
		target.timelineAttachment = this.timelineAttachment;
	}
}

export class RegionAttachment extends Attachment implements HasTextureRegion {
	readonly kind = 'region' as const;
	x = 0;
	y = 0;
	scaleX = 1;
	scaleY = 1;
	rotation = 0;
	width = 0;
	height = 0;
	color = new Color(1, 1, 1, 1);
	path: string;
	region: TextureRegion | null = null;
	sequence: Sequence | null = null;
	/** Local corner positions: BL, UL, UR, BR. */
	offset = new Float32Array(8);
	uvs = new Float32Array(8);
	tempColor = new Color(1, 1, 1, 1);

	constructor(name: string, path: string) {
		super(name);
		this.path = path;
	}

	updateRegion(): void {
		const region = this.region;
		if (!region) throw new Error('Region not set.');
		const sx = (this.width / region.originalWidth) * this.scaleX;
		const sy = (this.height / region.originalHeight) * this.scaleY;
		const left = (-this.width / 2) * this.scaleX + region.offsetX * sx;
		const bottom = (-this.height / 2) * this.scaleY + region.offsetY * sy;
		const right = left + region.width * sx;
		const top = bottom + region.height * sy;
		const cos = Math.cos(this.rotation * DEG_RAD);
		const sin = Math.sin(this.rotation * DEG_RAD);
		const corner = (i: number, lx: number, ly: number): void => {
			this.offset[i] = lx * cos - ly * sin + this.x;
			this.offset[i + 1] = lx * sin + ly * cos + this.y;
		};
		corner(0, left, bottom);
		corner(2, left, top);
		corner(4, right, top);
		corner(6, right, bottom);
		const { u, v, u2, v2 } = region;
		const uvs = this.uvs;
		// A 90° atlas pack is the only rotation a region undoes (meshes undo all four).
		if (region.degrees === 90) uvs.set([u2, v2, u, v2, u, v, u2, v]);
		else uvs.set([u, v2, u, v, u2, v, u2, v2]);
	}

	computeWorldVertices(
		slot: Slot,
		worldVertices: NumberArrayLike,
		offset: number,
		stride: number,
	): void {
		if (this.sequence) this.sequence.apply(slot, this);
		const { a, b, c, d, worldX, worldY } = slot.bone;
		const o = this.offset;
		for (let i = 0; i < 8; i += 2, offset += stride) {
			const x = o[i];
			const y = o[i + 1];
			worldVertices[offset] = x * a + y * b + worldX;
			worldVertices[offset + 1] = x * c + y * d + worldY;
		}
	}

	copy(): RegionAttachment {
		const copy = new RegionAttachment(this.name, this.path);
		copy.region = this.region;
		copy.x = this.x;
		copy.y = this.y;
		copy.scaleX = this.scaleX;
		copy.scaleY = this.scaleY;
		copy.rotation = this.rotation;
		copy.width = this.width;
		copy.height = this.height;
		copy.uvs.set(this.uvs);
		copy.offset.set(this.offset);
		copy.color.setFromColor(this.color);
		copy.sequence = this.sequence ? this.sequence.copy() : null;
		return copy;
	}
}

export class MeshAttachment extends VertexAttachment implements HasTextureRegion {
	readonly kind = 'mesh' as const;
	region: TextureRegion | null = null;
	path: string;
	regionUVs: NumberArrayLike = [];
	uvs: NumberArrayLike = [];
	triangles: number[] = [];
	color = new Color(1, 1, 1, 1);
	width = 0;
	height = 0;
	hullLength = 0;
	edges: number[] = [];
	sequence: Sequence | null = null;
	tempColor = new Color(0, 0, 0, 0);
	private parentMesh: MeshAttachment | null = null;

	constructor(name: string, path: string) {
		super(name);
		this.path = path;
	}

	/** Maps the [0,1] region UVs onto the page, undoing the region's pack rotation and trim. */
	updateRegion(): void {
		const region = this.region;
		if (!region) throw new Error('Region not set.');
		const regionUVs = this.regionUVs;
		const n = regionUVs.length;
		if (this.uvs.length !== n) this.uvs = new Float32Array(n);
		const uvs = this.uvs;
		const page = region instanceof TextureAtlasRegionBase ? region.page : null;
		if (!page) {
			const w = region.u2 - region.u;
			const h = region.v2 - region.v;
			for (let i = 0; i < n; i += 2) {
				uvs[i] = region.u + regionUVs[i] * w;
				uvs[i + 1] = region.v + regionUVs[i + 1] * h;
			}
			return;
		}
		const pw = page.width;
		const ph = page.height;
		const { offsetX, offsetY, originalWidth: ow, originalHeight: oh } = region;
		// Distance from the untrimmed image's edges to the packed (trimmed) rectangle.
		const trimRight = ow - offsetX - region.width;
		const trimTop = oh - offsetY - region.height;
		switch (region.degrees) {
			case 90: {
				const u = region.u - trimTop / pw;
				const v = region.v - trimRight / ph;
				for (let i = 0; i < n; i += 2) {
					uvs[i] = u + regionUVs[i + 1] * (oh / pw);
					uvs[i + 1] = v + (1 - regionUVs[i]) * (ow / ph);
				}
				return;
			}
			case 180: {
				const u = region.u - trimRight / pw;
				const v = region.v - offsetY / ph;
				for (let i = 0; i < n; i += 2) {
					uvs[i] = u + (1 - regionUVs[i]) * (ow / pw);
					uvs[i + 1] = v + (1 - regionUVs[i + 1]) * (oh / ph);
				}
				return;
			}
			case 270: {
				const u = region.u - offsetY / pw;
				const v = region.v - offsetX / ph;
				for (let i = 0; i < n; i += 2) {
					uvs[i] = u + (1 - regionUVs[i + 1]) * (oh / pw);
					uvs[i + 1] = v + regionUVs[i] * (ow / ph);
				}
				return;
			}
		}
		const u = region.u - offsetX / pw;
		const v = region.v - trimTop / ph;
		for (let i = 0; i < n; i += 2) {
			uvs[i] = u + regionUVs[i] * (ow / pw);
			uvs[i + 1] = v + regionUVs[i + 1] * (oh / ph);
		}
	}

	getParentMesh(): MeshAttachment | null {
		return this.parentMesh;
	}

	setParentMesh(parent: MeshAttachment | null): void {
		this.parentMesh = parent;
		if (!parent) return;
		this.bones = parent.bones;
		this.vertices = parent.vertices;
		this.worldVerticesLength = parent.worldVerticesLength;
		this.regionUVs = parent.regionUVs;
		this.triangles = parent.triangles;
		this.hullLength = parent.hullLength;
	}

	computeWorldVertices(
		slot: Slot,
		start: number,
		count: number,
		worldVertices: NumberArrayLike,
		offset: number,
		stride: number,
	): void {
		if (this.sequence) this.sequence.apply(slot, this);
		super.computeWorldVertices(slot, start, count, worldVertices, offset, stride);
	}

	copy(): MeshAttachment {
		if (this.parentMesh) return this.newLinkedMesh();
		const copy = new MeshAttachment(this.name, this.path);
		copy.region = this.region;
		copy.color.setFromColor(this.color);
		this.copyTo(copy);
		copy.regionUVs = this.regionUVs.slice();
		copy.uvs = this.uvs.slice();
		copy.triangles = this.triangles.slice();
		copy.hullLength = this.hullLength;
		copy.sequence = this.sequence ? this.sequence.copy() : null;
		copy.edges = this.edges.slice();
		copy.width = this.width;
		copy.height = this.height;
		return copy;
	}

	newLinkedMesh(): MeshAttachment {
		const copy = new MeshAttachment(this.name, this.path);
		copy.region = this.region;
		copy.color.setFromColor(this.color);
		copy.timelineAttachment = this.timelineAttachment;
		copy.setParentMesh(this.parentMesh ?? this);
		if (copy.region) copy.updateRegion();
		return copy;
	}
}

export class BoundingBoxAttachment extends VertexAttachment {
	readonly kind = 'boundingbox' as const;
	color = new Color(1, 1, 1, 1);

	copy(): BoundingBoxAttachment {
		const copy = new BoundingBoxAttachment(this.name);
		this.copyTo(copy);
		copy.color.setFromColor(this.color);
		return copy;
	}
}

export class ClippingAttachment extends VertexAttachment {
	readonly kind = 'clipping' as const;
	/** The slot after which clipping stops; null clips to the end of the draw order. */
	endSlot: SlotData | null = null;
	color = new Color(0.2275, 0.2275, 0.8078, 1);

	copy(): ClippingAttachment {
		const copy = new ClippingAttachment(this.name);
		this.copyTo(copy);
		copy.endSlot = this.endSlot;
		copy.color.setFromColor(this.color);
		return copy;
	}
}

export class PathAttachment extends VertexAttachment {
	readonly kind = 'path' as const;
	/** Cumulative length at the end of each curve (used when not constant speed). */
	lengths: number[] = [];
	closed = false;
	constantSpeed = false;
	color = new Color(1, 1, 1, 1);

	copy(): PathAttachment {
		const copy = new PathAttachment(this.name);
		this.copyTo(copy);
		copy.lengths = this.lengths.slice();
		copy.closed = this.closed;
		copy.constantSpeed = this.constantSpeed;
		copy.color.setFromColor(this.color);
		return copy;
	}
}

export class PointAttachment extends Attachment {
	readonly kind = 'point' as const;
	x = 0;
	y = 0;
	rotation = 0;
	color = new Color(0.38, 0.94, 0, 1);

	computeWorldPosition(bone: Bone, point: { x: number; y: number }): { x: number; y: number } {
		point.x = this.x * bone.a + this.y * bone.b + bone.worldX;
		point.y = this.x * bone.c + this.y * bone.d + bone.worldY;
		return point;
	}

	computeWorldRotation(bone: Bone): number {
		const r = this.rotation * DEG_RAD;
		const cos = Math.cos(r);
		const sin = Math.sin(r);
		const x = cos * bone.a + sin * bone.b;
		const y = cos * bone.c + sin * bone.d;
		return Math.atan2(y, x) / DEG_RAD;
	}

	copy(): PointAttachment {
		const copy = new PointAttachment(this.name);
		copy.x = this.x;
		copy.y = this.y;
		copy.rotation = this.rotation;
		copy.color.setFromColor(this.color);
		return copy;
	}
}

/** Shape of an atlas page as far as UV math needs it (the atlas module extends this). */
export interface AtlasPageLike {
	width: number;
	height: number;
}

/** Base for atlas regions so mesh UV math can see the page without importing the atlas module. */
export class TextureAtlasRegionBase extends TextureRegion {
	constructor(public page: AtlasPageLike) {
		super();
	}
}
