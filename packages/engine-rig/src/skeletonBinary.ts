import { Color } from './math';
import {
	BoneData,
	EventData,
	IkConstraintData,
	PathConstraintData,
	PhysicsConstraintData,
	PositionMode,
	SkeletonData,
	Skin,
	SlotData,
	SpacingMode,
	TransformConstraintData,
	type Inherit,
	type BlendMode,
	type RotateMode,
} from './data';
import {
	MeshAttachment,
	Sequence,
	SequenceModeValues,
	VertexAttachment,
	type Attachment,
	type HasTextureRegion,
} from './attachments';
import {
	AlphaTimeline,
	Animation,
	AttachmentTimeline,
	CurveTimeline,
	CurveTimeline1,
	CurveTimeline2,
	DeformTimeline,
	DrawOrderTimeline,
	EventTimeline,
	IkConstraintTimeline,
	InheritTimeline,
	PathConstraintMixTimeline,
	PathConstraintPositionTimeline,
	PathConstraintSpacingTimeline,
	PhysicsConstraintDampingTimeline,
	PhysicsConstraintGravityTimeline,
	PhysicsConstraintInertiaTimeline,
	PhysicsConstraintMassTimeline,
	PhysicsConstraintMixTimeline,
	PhysicsConstraintResetTimeline,
	PhysicsConstraintStrengthTimeline,
	PhysicsConstraintWindTimeline,
	RGB2Timeline,
	RGBA2Timeline,
	RGBATimeline,
	RGBTimeline,
	RotateTimeline,
	ScaleTimeline,
	ScaleXTimeline,
	ScaleYTimeline,
	SequenceTimeline,
	ShearTimeline,
	ShearXTimeline,
	ShearYTimeline,
	TransformConstraintTimeline,
	TranslateTimeline,
	TranslateXTimeline,
	TranslateYTimeline,
	type Timeline,
} from './animation';
import { Event } from './event';
import type { AttachmentLoader } from './atlas';

/** Big-endian reader for the Spine binary format: varints, length-prefixed UTF-8 and a string table. */
class BinaryInput {
	private view: DataView;
	private index = 0;
	strings: string[] = [];

	constructor(data: Uint8Array | ArrayBuffer) {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	readByte(): number {
		return this.view.getInt8(this.index++);
	}

	readUnsignedByte(): number {
		return this.view.getUint8(this.index++);
	}

	readInt32(): number {
		const v = this.view.getInt32(this.index);
		this.index += 4;
		return v;
	}

	/** Variable-length int, 7 bits per byte; zigzag-decoded unless `optimizePositive`. */
	readInt(optimizePositive: boolean): number {
		let result = 0;
		for (let shift = 0; shift <= 28; shift += 7) {
			const b = this.readByte();
			result |= (b & 0x7f) << shift;
			if ((b & 0x80) === 0) break;
		}
		return optimizePositive ? result : (result >>> 1) ^ -(result & 1);
	}

	readStringRef(): string | null {
		const index = this.readInt(true);
		return index === 0 ? null : this.strings[index - 1];
	}

	/** Length + 1 (0 = null), then UTF-8 bytes. */
	readString(): string | null {
		let byteCount = this.readInt(true);
		if (byteCount === 0) return null;
		if (byteCount === 1) return '';
		byteCount--;
		let chars = '';
		for (let i = 0; i < byteCount; ) {
			const b = this.readUnsignedByte();
			switch (b >> 4) {
				case 12:
				case 13:
					chars += String.fromCharCode(((b & 0x1f) << 6) | (this.readByte() & 0x3f));
					i += 2;
					break;
				case 14:
					chars += String.fromCharCode(
						((b & 0x0f) << 12) | ((this.readByte() & 0x3f) << 6) | (this.readByte() & 0x3f),
					);
					i += 3;
					break;
				default:
					chars += String.fromCharCode(b);
					i++;
			}
		}
		return chars;
	}

	readFloat(): number {
		const v = this.view.getFloat32(this.index);
		this.index += 4;
		return v;
	}

	readBoolean(): boolean {
		return this.readByte() !== 0;
	}
}

const ATTACHMENT_REGION = 0;
const ATTACHMENT_BOUNDINGBOX = 1;
const ATTACHMENT_MESH = 2;
const ATTACHMENT_LINKEDMESH = 3;
const ATTACHMENT_PATH = 4;
const ATTACHMENT_POINT = 5;
const ATTACHMENT_CLIPPING = 6;

const CURVE_STEPPED = 1;
const CURVE_BEZIER = 2;

class LinkedMesh {
	constructor(
		public mesh: MeshAttachment,
		public skinIndex: number,
		public slotIndex: number,
		public parent: string | null,
		public inheritTimelines: boolean,
	) {}
}

interface Vertices {
	length: number;
	bones: number[] | null;
	vertices: Float32Array;
}

const required = (s: string | null, what: string): string => {
	if (s === null) throw new Error(`${what} must not be null.`);
	return s;
};

/** Reads Spine 4.2 binary skeletons (`.skel`) into `SkeletonData`. */
export class SkeletonBinary {
	/** Multiplies every length and position as it is read. */
	scale = 1;
	private linkedMeshes: LinkedMesh[] = [];

	constructor(public attachmentLoader: AttachmentLoader) {}

	readSkeletonData(binary: Uint8Array | ArrayBuffer): SkeletonData {
		const scale = this.scale;
		const data = new SkeletonData();
		data.name = '';
		const input = new BinaryInput(binary);

		const lowHash = input.readInt32();
		const highHash = input.readInt32();
		data.hash = highHash === 0 && lowHash === 0 ? null : highHash.toString(16) + lowHash.toString(16);
		data.version = input.readString();
		data.x = input.readFloat();
		data.y = input.readFloat();
		data.width = input.readFloat();
		data.height = input.readFloat();
		data.referenceScale = input.readFloat() * scale;
		const nonessential = input.readBoolean();
		if (nonessential) {
			data.fps = input.readFloat();
			data.imagesPath = input.readString();
			data.audioPath = input.readString();
		}

		for (let i = 0, n = input.readInt(true); i < n; i++)
			input.strings.push(required(input.readString(), 'String in string table'));

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const name = required(input.readString(), 'Bone name');
			const parent = i === 0 ? null : data.bones[input.readInt(true)];
			const bone = new BoneData(i, name, parent);
			bone.rotation = input.readFloat();
			bone.x = input.readFloat() * scale;
			bone.y = input.readFloat() * scale;
			bone.scaleX = input.readFloat();
			bone.scaleY = input.readFloat();
			bone.shearX = input.readFloat();
			bone.shearY = input.readFloat();
			bone.length = input.readFloat() * scale;
			bone.inherit = input.readByte() as Inherit;
			bone.skinRequired = input.readBoolean();
			if (nonessential) {
				Color.rgba8888ToColor(bone.color, input.readInt32());
				bone.icon = input.readString() ?? undefined;
				bone.visible = input.readBoolean();
			}
			data.bones.push(bone);
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const name = required(input.readString(), 'Slot name');
			const slot = new SlotData(i, name, data.bones[input.readInt(true)]);
			Color.rgba8888ToColor(slot.color, input.readInt32());
			const dark = input.readInt32();
			if (dark !== -1) Color.rgb888ToColor((slot.darkColor = new Color(0, 0, 0, 1)), dark);
			slot.attachmentName = input.readStringRef();
			slot.blendMode = input.readInt(true) as BlendMode;
			if (nonessential) slot.visible = input.readBoolean();
			data.slots.push(slot);
		}

		const readBones = (): BoneData[] => {
			const out: BoneData[] = [];
			for (let i = 0, n = input.readInt(true); i < n; i++) out.push(data.bones[input.readInt(true)]);
			return out;
		};

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const c = new IkConstraintData(required(input.readString(), 'IK constraint name'));
			c.order = input.readInt(true);
			c.bones = readBones();
			c.target = data.bones[input.readInt(true)];
			const flags = input.readByte();
			c.skinRequired = (flags & 1) !== 0;
			c.bendDirection = (flags & 2) !== 0 ? 1 : -1;
			c.compress = (flags & 4) !== 0;
			c.stretch = (flags & 8) !== 0;
			c.uniform = (flags & 16) !== 0;
			// Bit 32 marks a nonzero mix (1 unless bit 64 says it is stored).
			c.mix = (flags & 32) !== 0 ? ((flags & 64) !== 0 ? input.readFloat() : 1) : 0;
			if ((flags & 128) !== 0) c.softness = input.readFloat() * scale;
			data.ikConstraints.push(c);
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const c = new TransformConstraintData(required(input.readString(), 'Transform constraint name'));
			c.order = input.readInt(true);
			c.bones = readBones();
			c.target = data.bones[input.readInt(true)];
			let flags = input.readByte();
			c.skinRequired = (flags & 1) !== 0;
			c.local = (flags & 2) !== 0;
			c.relative = (flags & 4) !== 0;
			if ((flags & 8) !== 0) c.offsetRotation = input.readFloat();
			if ((flags & 16) !== 0) c.offsetX = input.readFloat() * scale;
			if ((flags & 32) !== 0) c.offsetY = input.readFloat() * scale;
			if ((flags & 64) !== 0) c.offsetScaleX = input.readFloat();
			if ((flags & 128) !== 0) c.offsetScaleY = input.readFloat();
			flags = input.readByte();
			if ((flags & 1) !== 0) c.offsetShearY = input.readFloat();
			if ((flags & 2) !== 0) c.mixRotate = input.readFloat();
			if ((flags & 4) !== 0) c.mixX = input.readFloat();
			if ((flags & 8) !== 0) c.mixY = input.readFloat();
			if ((flags & 16) !== 0) c.mixScaleX = input.readFloat();
			if ((flags & 32) !== 0) c.mixScaleY = input.readFloat();
			if ((flags & 64) !== 0) c.mixShearY = input.readFloat();
			data.transformConstraints.push(c);
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const c = new PathConstraintData(required(input.readString(), 'Path constraint name'));
			c.order = input.readInt(true);
			c.skinRequired = input.readBoolean();
			c.bones = readBones();
			c.target = data.slots[input.readInt(true)];
			const flags = input.readByte();
			c.positionMode = (flags & 1) as PositionMode;
			c.spacingMode = ((flags >> 1) & 3) as SpacingMode;
			c.rotateMode = ((flags >> 3) & 3) as RotateMode;
			if ((flags & 128) !== 0) c.offsetRotation = input.readFloat();
			c.position = input.readFloat();
			if (c.positionMode === PositionMode.Fixed) c.position *= scale;
			c.spacing = input.readFloat();
			if (c.spacingMode === SpacingMode.Length || c.spacingMode === SpacingMode.Fixed) c.spacing *= scale;
			c.mixRotate = input.readFloat();
			c.mixX = input.readFloat();
			c.mixY = input.readFloat();
			data.pathConstraints.push(c);
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const c = new PhysicsConstraintData(required(input.readString(), 'Physics constraint name'));
			c.order = input.readInt(true);
			c.bone = data.bones[input.readInt(true)];
			let flags = input.readByte();
			c.skinRequired = (flags & 1) !== 0;
			if ((flags & 2) !== 0) c.x = input.readFloat();
			if ((flags & 4) !== 0) c.y = input.readFloat();
			if ((flags & 8) !== 0) c.rotate = input.readFloat();
			if ((flags & 16) !== 0) c.scaleX = input.readFloat();
			if ((flags & 32) !== 0) c.shearX = input.readFloat();
			c.limit = ((flags & 64) !== 0 ? input.readFloat() : 5000) * scale;
			c.step = 1 / input.readUnsignedByte();
			c.inertia = input.readFloat();
			c.strength = input.readFloat();
			c.damping = input.readFloat();
			c.massInverse = (flags & 128) !== 0 ? input.readFloat() : 1;
			c.wind = input.readFloat();
			c.gravity = input.readFloat();
			flags = input.readByte();
			c.inertiaGlobal = (flags & 1) !== 0;
			c.strengthGlobal = (flags & 2) !== 0;
			c.dampingGlobal = (flags & 4) !== 0;
			c.massGlobal = (flags & 8) !== 0;
			c.windGlobal = (flags & 16) !== 0;
			c.gravityGlobal = (flags & 32) !== 0;
			c.mixGlobal = (flags & 64) !== 0;
			c.mix = (flags & 128) !== 0 ? input.readFloat() : 1;
			data.physicsConstraints.push(c);
		}

		const defaultSkin = this.readSkin(input, data, true, nonessential);
		if (defaultSkin) {
			data.defaultSkin = defaultSkin;
			data.skins.push(defaultSkin);
		}
		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const skin = this.readSkin(input, data, false, nonessential);
			if (skin) data.skins.push(skin);
		}

		for (const linked of this.linkedMeshes) {
			const skin = data.skins[linked.skinIndex];
			const parent = linked.parent ? skin.getAttachment(linked.slotIndex, linked.parent) : null;
			if (!(parent instanceof MeshAttachment)) throw new Error(`Parent mesh not found: ${linked.parent}`);
			linked.mesh.timelineAttachment = linked.inheritTimelines ? parent : linked.mesh;
			linked.mesh.setParentMesh(parent);
			if (linked.mesh.region) linked.mesh.updateRegion();
		}
		this.linkedMeshes.length = 0;

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const event = new EventData(required(input.readString(), 'Event name'));
			event.intValue = input.readInt(false);
			event.floatValue = input.readFloat();
			event.stringValue = input.readString();
			event.audioPath = input.readString();
			if (event.audioPath) {
				event.volume = input.readFloat();
				event.balance = input.readFloat();
			}
			data.events.push(event);
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const name = required(input.readString(), 'Animation name');
			data.animations.push(this.readAnimation(input, name, data));
		}
		return data;
	}

	private readSkin(input: BinaryInput, data: SkeletonData, isDefault: boolean, nonessential: boolean): Skin | null {
		let skin: Skin;
		let slotCount: number;
		if (isDefault) {
			slotCount = input.readInt(true);
			if (slotCount === 0) return null;
			skin = new Skin('default');
		} else {
			skin = new Skin(required(input.readString(), 'Skin name'));
			if (nonessential) Color.rgba8888ToColor(skin.color, input.readInt32());
			for (let i = 0, n = input.readInt(true); i < n; i++) skin.bones.push(data.bones[input.readInt(true)]);
			for (let i = 0, n = input.readInt(true); i < n; i++) skin.constraints.push(data.ikConstraints[input.readInt(true)]);
			for (let i = 0, n = input.readInt(true); i < n; i++)
				skin.constraints.push(data.transformConstraints[input.readInt(true)]);
			for (let i = 0, n = input.readInt(true); i < n; i++) skin.constraints.push(data.pathConstraints[input.readInt(true)]);
			for (let i = 0, n = input.readInt(true); i < n; i++)
				skin.constraints.push(data.physicsConstraints[input.readInt(true)]);
			slotCount = input.readInt(true);
		}
		for (let i = 0; i < slotCount; i++) {
			const slotIndex = input.readInt(true);
			for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
				const name = required(input.readStringRef(), 'Attachment name');
				const attachment = this.readAttachment(input, data, skin, slotIndex, name, nonessential);
				if (attachment) skin.setAttachment(slotIndex, name, attachment);
			}
		}
		return skin;
	}

	private readSequence(input: BinaryInput): Sequence {
		const sequence = new Sequence(input.readInt(true));
		sequence.start = input.readInt(true);
		sequence.digits = input.readInt(true);
		sequence.setupIndex = input.readInt(true);
		return sequence;
	}

	private readAttachment(
		input: BinaryInput,
		data: SkeletonData,
		skin: Skin,
		slotIndex: number,
		attachmentName: string,
		nonessential: boolean,
	): Attachment | null {
		const scale = this.scale;
		const loader = this.attachmentLoader;
		const flags = input.readByte();
		const name = required((flags & 8) !== 0 ? input.readStringRef() : attachmentName, 'Attachment name');
		switch (flags & 0b111) {
			case ATTACHMENT_REGION: {
				let path = (flags & 16) !== 0 ? input.readStringRef() : null;
				const color = (flags & 32) !== 0 ? input.readInt32() : 0xffffffff;
				const sequence = (flags & 64) !== 0 ? this.readSequence(input) : null;
				const rotation = (flags & 128) !== 0 ? input.readFloat() : 0;
				const x = input.readFloat();
				const y = input.readFloat();
				const scaleX = input.readFloat();
				const scaleY = input.readFloat();
				const width = input.readFloat();
				const height = input.readFloat();
				if (!path) path = name;
				const region = loader.newRegionAttachment(skin, name, path, sequence);
				if (!region) return null;
				region.path = path;
				region.x = x * scale;
				region.y = y * scale;
				region.scaleX = scaleX;
				region.scaleY = scaleY;
				region.rotation = rotation;
				region.width = width * scale;
				region.height = height * scale;
				Color.rgba8888ToColor(region.color, color);
				region.sequence = sequence;
				if (!sequence) region.updateRegion();
				return region;
			}
			case ATTACHMENT_BOUNDINGBOX: {
				const vertices = this.readVertices(input, (flags & 16) !== 0);
				const color = nonessential ? input.readInt32() : 0;
				const box = loader.newBoundingBoxAttachment(skin, name);
				if (!box) return null;
				box.worldVerticesLength = vertices.length;
				box.vertices = vertices.vertices;
				box.bones = vertices.bones;
				if (nonessential) Color.rgba8888ToColor(box.color, color);
				return box;
			}
			case ATTACHMENT_MESH: {
				let path = (flags & 16) !== 0 ? input.readStringRef() : name;
				const color = (flags & 32) !== 0 ? input.readInt32() : 0xffffffff;
				const sequence = (flags & 64) !== 0 ? this.readSequence(input) : null;
				const hullLength = input.readInt(true);
				const vertices = this.readVertices(input, (flags & 128) !== 0);
				const uvs = this.readFloats(input, vertices.length, 1);
				const triangles = this.readShorts(input, (vertices.length - hullLength - 2) * 3);
				let edges: number[] = [];
				let width = 0;
				let height = 0;
				if (nonessential) {
					edges = this.readShorts(input, input.readInt(true));
					width = input.readFloat();
					height = input.readFloat();
				}
				if (!path) path = name;
				const mesh = loader.newMeshAttachment(skin, name, path, sequence);
				if (!mesh) return null;
				mesh.path = path;
				Color.rgba8888ToColor(mesh.color, color);
				mesh.bones = vertices.bones;
				mesh.vertices = vertices.vertices;
				mesh.worldVerticesLength = vertices.length;
				mesh.triangles = triangles;
				mesh.regionUVs = uvs;
				if (!sequence) mesh.updateRegion();
				mesh.hullLength = hullLength << 1;
				mesh.sequence = sequence;
				if (nonessential) {
					mesh.edges = edges;
					mesh.width = width * scale;
					mesh.height = height * scale;
				}
				return mesh;
			}
			case ATTACHMENT_LINKEDMESH: {
				const path = required((flags & 16) !== 0 ? input.readStringRef() : name, 'Linked mesh path');
				const color = (flags & 32) !== 0 ? input.readInt32() : 0xffffffff;
				const sequence = (flags & 64) !== 0 ? this.readSequence(input) : null;
				const inheritTimelines = (flags & 128) !== 0;
				const skinIndex = input.readInt(true);
				const parent = input.readStringRef();
				let width = 0;
				let height = 0;
				if (nonessential) {
					width = input.readFloat();
					height = input.readFloat();
				}
				const mesh = loader.newMeshAttachment(skin, name, path, sequence);
				if (!mesh) return null;
				mesh.path = path;
				Color.rgba8888ToColor(mesh.color, color);
				mesh.sequence = sequence;
				if (nonessential) {
					mesh.width = width * scale;
					mesh.height = height * scale;
				}
				this.linkedMeshes.push(new LinkedMesh(mesh, skinIndex, slotIndex, parent, inheritTimelines));
				return mesh;
			}
			case ATTACHMENT_PATH: {
				const closed = (flags & 16) !== 0;
				const constantSpeed = (flags & 32) !== 0;
				const vertices = this.readVertices(input, (flags & 64) !== 0);
				const lengths = new Array<number>(vertices.length / 6);
				for (let i = 0; i < lengths.length; i++) lengths[i] = input.readFloat() * scale;
				const color = nonessential ? input.readInt32() : 0;
				const path = loader.newPathAttachment(skin, name);
				if (!path) return null;
				path.closed = closed;
				path.constantSpeed = constantSpeed;
				path.worldVerticesLength = vertices.length;
				path.vertices = vertices.vertices;
				path.bones = vertices.bones;
				path.lengths = lengths;
				if (nonessential) Color.rgba8888ToColor(path.color, color);
				return path;
			}
			case ATTACHMENT_POINT: {
				const rotation = input.readFloat();
				const x = input.readFloat();
				const y = input.readFloat();
				const color = nonessential ? input.readInt32() : 0;
				const point = loader.newPointAttachment(skin, name);
				if (!point) return null;
				point.x = x * scale;
				point.y = y * scale;
				point.rotation = rotation;
				if (nonessential) Color.rgba8888ToColor(point.color, color);
				return point;
			}
			case ATTACHMENT_CLIPPING: {
				const endSlotIndex = input.readInt(true);
				const vertices = this.readVertices(input, (flags & 16) !== 0);
				const color = nonessential ? input.readInt32() : 0;
				const clip = loader.newClippingAttachment(skin, name);
				if (!clip) return null;
				clip.endSlot = data.slots[endSlotIndex];
				clip.worldVerticesLength = vertices.length;
				clip.vertices = vertices.vertices;
				clip.bones = vertices.bones;
				if (nonessential) Color.rgba8888ToColor(clip.color, color);
				return clip;
			}
		}
		return null;
	}

	private readVertices(input: BinaryInput, weighted: boolean): Vertices {
		const scale = this.scale;
		const vertexCount = input.readInt(true);
		const length = vertexCount << 1;
		if (!weighted) return { length, bones: null, vertices: new Float32Array(this.readFloats(input, length, scale)) };
		const weights: number[] = [];
		const bones: number[] = [];
		for (let i = 0; i < vertexCount; i++) {
			const boneCount = input.readInt(true);
			bones.push(boneCount);
			for (let ii = 0; ii < boneCount; ii++) {
				bones.push(input.readInt(true));
				weights.push(input.readFloat() * scale, input.readFloat() * scale, input.readFloat());
			}
		}
		return { length, bones, vertices: new Float32Array(weights) };
	}

	private readFloats(input: BinaryInput, n: number, scale: number): number[] {
		const out = new Array<number>(n);
		for (let i = 0; i < n; i++) out[i] = input.readFloat() * scale;
		return out;
	}

	private readShorts(input: BinaryInput, n: number): number[] {
		const out = new Array<number>(n);
		for (let i = 0; i < n; i++) out[i] = input.readInt(true);
		return out;
	}

	private readAnimation(input: BinaryInput, name: string, data: SkeletonData): Animation {
		input.readInt(true); // Timeline count, a capacity hint.
		const timelines: Timeline[] = [];
		const scale = this.scale;

		/** One curve per frame transition: stepped, or a bezier for each value. */
		const readCurve = (timeline: CurveTimeline, frame: number, time1: number, time2: number, from: number[], to: number[], scales: number[]): void => {
			switch (input.readByte()) {
				case CURVE_STEPPED:
					timeline.setStepped(frame);
					break;
				case CURVE_BEZIER:
					for (let v = 0; v < from.length; v++) this.setBezier(input, timeline, frame, v, time1, time2, from[v], to[v], scales[v]);
			}
		};
		/** Frames of `values` floats (or unsigned bytes / 255 for colors), each followed by a curve. */
		const readFrames = (
			timeline: CurveTimeline & { setFrame(frame: number, time: number, ...v: number[]): void },
			read: () => number[],
			scales: number[],
		): void => {
			const last = timeline.getFrameCount() - 1;
			let time = input.readFloat();
			let values = read();
			for (let frame = 0; ; frame++) {
				timeline.setFrame(frame, time, ...values);
				if (frame === last) break;
				const time2 = input.readFloat();
				const values2 = read();
				readCurve(timeline, frame, time, time2, values, values2, scales);
				time = time2;
				values = values2;
			}
		};
		const floats = (n: number, s = 1): (() => number[]) => () => Array.from({ length: n }, () => input.readFloat() * s);
		const bytes = (n: number): (() => number[]) => () => Array.from({ length: n }, () => input.readUnsignedByte() / 255);
		const timeline1 = (t: CurveTimeline1, s: number): Timeline => {
			readFrames(t, floats(1, s), [s]);
			return t;
		};
		const timeline2 = (t: CurveTimeline2, s: number): Timeline => {
			readFrames(t, floats(2, s), [s, s]);
			return t;
		};

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const slotIndex = input.readInt(true);
			for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
				const type = input.readByte();
				const frameCount = input.readInt(true);
				if (type === 0) {
					const t = new AttachmentTimeline(frameCount, slotIndex);
					for (let f = 0; f < frameCount; f++) t.setFrame(f, input.readFloat(), input.readStringRef());
					timelines.push(t);
					continue;
				}
				const bezierCount = input.readInt(true);
				switch (type) {
					case 1: {
						const t = new RGBATimeline(frameCount, bezierCount, slotIndex);
						readFrames(t, bytes(4), [1, 1, 1, 1]);
						timelines.push(t);
						break;
					}
					case 2: {
						const t = new RGBTimeline(frameCount, bezierCount, slotIndex);
						readFrames(t, bytes(3), [1, 1, 1]);
						timelines.push(t);
						break;
					}
					case 3: {
						const t = new RGBA2Timeline(frameCount, bezierCount, slotIndex);
						readFrames(t, bytes(7), [1, 1, 1, 1, 1, 1, 1]);
						timelines.push(t);
						break;
					}
					case 4: {
						const t = new RGB2Timeline(frameCount, bezierCount, slotIndex);
						readFrames(t, bytes(6), [1, 1, 1, 1, 1, 1]);
						timelines.push(t);
						break;
					}
					case 5: {
						const t = new AlphaTimeline(frameCount, bezierCount, slotIndex);
						readFrames(t, bytes(1), [1]);
						timelines.push(t);
						break;
					}
				}
			}
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const boneIndex = input.readInt(true);
			for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
				const type = input.readByte();
				const frameCount = input.readInt(true);
				if (type === 10) {
					const t = new InheritTimeline(frameCount, boneIndex);
					for (let f = 0; f < frameCount; f++) t.setFrame(f, input.readFloat(), input.readByte() as Inherit);
					timelines.push(t);
					continue;
				}
				const bezierCount = input.readInt(true);
				switch (type) {
					case 0:
						timelines.push(timeline1(new RotateTimeline(frameCount, bezierCount, boneIndex), 1));
						break;
					case 1:
						timelines.push(timeline2(new TranslateTimeline(frameCount, bezierCount, boneIndex), scale));
						break;
					case 2:
						timelines.push(timeline1(new TranslateXTimeline(frameCount, bezierCount, boneIndex), scale));
						break;
					case 3:
						timelines.push(timeline1(new TranslateYTimeline(frameCount, bezierCount, boneIndex), scale));
						break;
					case 4:
						timelines.push(timeline2(new ScaleTimeline(frameCount, bezierCount, boneIndex), 1));
						break;
					case 5:
						timelines.push(timeline1(new ScaleXTimeline(frameCount, bezierCount, boneIndex), 1));
						break;
					case 6:
						timelines.push(timeline1(new ScaleYTimeline(frameCount, bezierCount, boneIndex), 1));
						break;
					case 7:
						timelines.push(timeline2(new ShearTimeline(frameCount, bezierCount, boneIndex), 1));
						break;
					case 8:
						timelines.push(timeline1(new ShearXTimeline(frameCount, bezierCount, boneIndex), 1));
						break;
					case 9:
						timelines.push(timeline1(new ShearYTimeline(frameCount, bezierCount, boneIndex), 1));
						break;
				}
			}
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const index = input.readInt(true);
			const frameCount = input.readInt(true);
			const last = frameCount - 1;
			const t = new IkConstraintTimeline(frameCount, input.readInt(true), index);
			let flags = input.readByte();
			const mixOf = (f: number): number => ((f & 1) !== 0 ? ((f & 2) !== 0 ? input.readFloat() : 1) : 0);
			let time = input.readFloat();
			let mix = mixOf(flags);
			let softness = (flags & 4) !== 0 ? input.readFloat() * scale : 0;
			for (let frame = 0; ; frame++) {
				t.setFrame(frame, time, mix, softness, (flags & 8) !== 0 ? 1 : -1, (flags & 16) !== 0, (flags & 32) !== 0);
				if (frame === last) break;
				flags = input.readByte();
				const time2 = input.readFloat();
				const mix2 = mixOf(flags);
				const softness2 = (flags & 4) !== 0 ? input.readFloat() * scale : 0;
				if ((flags & 64) !== 0) t.setStepped(frame);
				else if ((flags & 128) !== 0) {
					this.setBezier(input, t, frame, 0, time, time2, mix, mix2, 1);
					this.setBezier(input, t, frame, 1, time, time2, softness, softness2, scale);
				}
				time = time2;
				mix = mix2;
				softness = softness2;
			}
			timelines.push(t);
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const index = input.readInt(true);
			const frameCount = input.readInt(true);
			const t = new TransformConstraintTimeline(frameCount, input.readInt(true), index);
			readFrames(t, floats(6), [1, 1, 1, 1, 1, 1]);
			timelines.push(t);
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const index = input.readInt(true);
			const constraint = data.pathConstraints[index];
			for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
				const type = input.readByte();
				const frameCount = input.readInt(true);
				const bezierCount = input.readInt(true);
				switch (type) {
					case 0:
						timelines.push(
							timeline1(
								new PathConstraintPositionTimeline(frameCount, bezierCount, index),
								constraint.positionMode === PositionMode.Fixed ? scale : 1,
							),
						);
						break;
					case 1:
						timelines.push(
							timeline1(
								new PathConstraintSpacingTimeline(frameCount, bezierCount, index),
								constraint.spacingMode === SpacingMode.Length || constraint.spacingMode === SpacingMode.Fixed
									? scale
									: 1,
							),
						);
						break;
					case 2: {
						const t = new PathConstraintMixTimeline(frameCount, bezierCount, index);
						readFrames(t, floats(3), [1, 1, 1]);
						timelines.push(t);
						break;
					}
				}
			}
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const index = input.readInt(true) - 1;
			for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
				const type = input.readByte();
				const frameCount = input.readInt(true);
				if (type === 8) {
					const t = new PhysicsConstraintResetTimeline(frameCount, index);
					for (let f = 0; f < frameCount; f++) t.setFrame(f, input.readFloat());
					timelines.push(t);
					continue;
				}
				const bezierCount = input.readInt(true);
				const make = [
					PhysicsConstraintInertiaTimeline,
					PhysicsConstraintStrengthTimeline,
					PhysicsConstraintDampingTimeline,
					null,
					PhysicsConstraintMassTimeline,
					PhysicsConstraintWindTimeline,
					PhysicsConstraintGravityTimeline,
					PhysicsConstraintMixTimeline,
				][type];
				if (make) timelines.push(timeline1(new make(frameCount, bezierCount, index), 1));
			}
		}

		for (let i = 0, n = input.readInt(true); i < n; i++) {
			const skin = data.skins[input.readInt(true)];
			for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
				const slotIndex = input.readInt(true);
				for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
					const attachmentName = required(input.readStringRef(), 'Attachment name');
					const attachment = skin.getAttachment(slotIndex, attachmentName);
					const type = input.readByte();
					const frameCount = input.readInt(true);
					const last = frameCount - 1;
					if (type === 0) {
						if (!(attachment instanceof VertexAttachment))
							throw new Error(`Deform attachment not found: ${attachmentName}`);
						const weighted = !!attachment.bones;
						const setup = attachment.vertices;
						const length = weighted ? (setup.length / 3) * 2 : setup.length;
						const t = new DeformTimeline(frameCount, input.readInt(true), slotIndex, attachment);
						let time = input.readFloat();
						for (let frame = 0; ; frame++) {
							let deform: Float32Array;
							let end = input.readInt(true);
							if (end === 0) deform = weighted ? new Float32Array(length) : (setup as Float32Array);
							else {
								deform = new Float32Array(length);
								const start = input.readInt(true);
								end += start;
								for (let v = start; v < end; v++) deform[v] = input.readFloat() * scale;
								if (!weighted) for (let v = 0; v < length; v++) deform[v] += setup[v];
							}
							t.setFrame(frame, time, deform);
							if (frame === last) break;
							const time2 = input.readFloat();
							readCurve(t, frame, time, time2, [0], [1], [1]);
							time = time2;
						}
						timelines.push(t);
					} else if (type === 1) {
						if (!attachment) throw new Error(`Sequence attachment not found: ${attachmentName}`);
						const t = new SequenceTimeline(frameCount, slotIndex, attachment as Attachment & HasTextureRegion);
						for (let f = 0; f < frameCount; f++) {
							const time = input.readFloat();
							const modeAndIndex = input.readInt32();
							t.setFrame(f, time, SequenceModeValues[modeAndIndex & 0xf], modeAndIndex >> 4, input.readFloat());
						}
						timelines.push(t);
					}
				}
			}
		}

		const drawOrderCount = input.readInt(true);
		if (drawOrderCount > 0) {
			const t = new DrawOrderTimeline(drawOrderCount);
			const slotCount = data.slots.length;
			for (let i = 0; i < drawOrderCount; i++) {
				const time = input.readFloat();
				const offsetCount = input.readInt(true);
				const order = new Array<number>(slotCount).fill(-1);
				const unchanged = new Array<number>(slotCount - offsetCount).fill(0);
				let original = 0;
				let u = 0;
				for (let ii = 0; ii < offsetCount; ii++) {
					const slotIndex = input.readInt(true);
					while (original !== slotIndex) unchanged[u++] = original++;
					order[original + input.readInt(true)] = original++;
				}
				while (original < slotCount) unchanged[u++] = original++;
				for (let ii = slotCount - 1; ii >= 0; ii--) if (order[ii] === -1) order[ii] = unchanged[--u];
				t.setFrame(i, time, order);
			}
			timelines.push(t);
		}

		const eventCount = input.readInt(true);
		if (eventCount > 0) {
			const t = new EventTimeline(eventCount);
			for (let i = 0; i < eventCount; i++) {
				const time = input.readFloat();
				const eventData = data.events[input.readInt(true)];
				const event = new Event(time, eventData);
				event.intValue = input.readInt(false);
				event.floatValue = input.readFloat();
				event.stringValue = input.readString() ?? eventData.stringValue;
				if (eventData.audioPath) {
					event.volume = input.readFloat();
					event.balance = input.readFloat();
				}
				t.setFrame(i, event);
			}
			timelines.push(t);
		}

		let duration = 0;
		for (const t of timelines) duration = Math.max(duration, t.getDuration());
		return new Animation(name, timelines, duration);
	}

	private setBezier(
		input: BinaryInput,
		timeline: CurveTimeline,
		frame: number,
		value: number,
		time1: number,
		time2: number,
		value1: number,
		value2: number,
		scale: number,
	): void {
		const cx1 = input.readFloat();
		const cy1 = input.readFloat() * scale;
		const cx2 = input.readFloat();
		const cy2 = input.readFloat() * scale;
		timeline.setBezier(0, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2);
	}
}
