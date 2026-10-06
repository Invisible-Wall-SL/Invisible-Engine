import { Color } from './math';
import {
	BoneData,
	BlendMode,
	EventData,
	IkConstraintData,
	Inherit,
	PathConstraintData,
	PhysicsConstraintData,
	PositionMode,
	RotateMode,
	SkeletonData,
	Skin,
	SlotData,
	SpacingMode,
	TransformConstraintData,
	enumFromName,
} from './data';
import {
	MeshAttachment,
	Sequence,
	SequenceMode,
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
	TranslateTimeline,
	TranslateXTimeline,
	TranslateYTimeline,
	TransformConstraintTimeline,
	type PhysicsConstraintTimeline,
	type Timeline,
} from './animation';
import { Event } from './event';
import type { AttachmentLoader } from './atlas';

// The reader walks untyped JSON; every value is checked or defaulted where it is read.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

function get<T>(map: Json, key: string, fallback: T): T {
	const value = map?.[key];
	return value === undefined ? fallback : (value as T);
}

class LinkedMesh {
	constructor(
		public mesh: MeshAttachment,
		public skin: string | null,
		public slotIndex: number,
		public parent: string,
		public inheritTimelines: boolean,
	) {}
}

/** Reads Spine 4.x skeleton JSON (and so `.irig`) into `SkeletonData`. */
export class SkeletonJson {
	/** Multiplies every length and position as it is read. */
	scale = 1;
	private linkedMeshes: LinkedMesh[] = [];

	constructor(public attachmentLoader: AttachmentLoader) {}

	readSkeletonData(json: string | object): SkeletonData {
		const scale = this.scale;
		const data = new SkeletonData();
		const root: Json = typeof json === 'string' ? JSON.parse(json) : json;

		const skeletonMap = root.skeleton;
		if (skeletonMap) {
			data.hash = skeletonMap.hash ?? null;
			data.version = skeletonMap.spine ?? null;
			data.x = get(skeletonMap, 'x', 0);
			data.y = get(skeletonMap, 'y', 0);
			data.width = get(skeletonMap, 'width', 0);
			data.height = get(skeletonMap, 'height', 0);
			data.referenceScale = get(skeletonMap, 'referenceScale', 100) * scale;
			data.fps = get(skeletonMap, 'fps', 0);
			data.imagesPath = get(skeletonMap, 'images', null);
			data.audioPath = get(skeletonMap, 'audio', null);
		}

		for (const boneMap of root.bones ?? []) {
			let parent: BoneData | null = null;
			const parentName = get<string | null>(boneMap, 'parent', null);
			if (parentName) {
				parent = data.findBone(parentName);
				if (!parent) throw new Error(`Parent bone not found: ${parentName}`);
			}
			const bone = new BoneData(data.bones.length, boneMap.name, parent);
			bone.length = get(boneMap, 'length', 0) * scale;
			bone.x = get(boneMap, 'x', 0) * scale;
			bone.y = get(boneMap, 'y', 0) * scale;
			bone.rotation = get(boneMap, 'rotation', 0);
			bone.scaleX = get(boneMap, 'scaleX', 1);
			bone.scaleY = get(boneMap, 'scaleY', 1);
			bone.shearX = get(boneMap, 'shearX', 0);
			bone.shearY = get(boneMap, 'shearY', 0);
			bone.inherit = enumFromName(Inherit, get(boneMap, 'inherit', 'normal'), Inherit.Normal);
			bone.skinRequired = get(boneMap, 'skin', false);
			const color = get<string | null>(boneMap, 'color', null);
			if (color) bone.color.setFromString(color);
			bone.icon = get(boneMap, 'icon', undefined);
			bone.visible = get(boneMap, 'visible', true);
			data.bones.push(bone);
		}

		for (const slotMap of root.slots ?? []) {
			const boneData = data.findBone(slotMap.bone);
			if (!boneData) throw new Error(`Couldn't find slot bone: ${slotMap.bone}`);
			const slot = new SlotData(data.slots.length, slotMap.name, boneData);
			const color = get<string | null>(slotMap, 'color', null);
			if (color) slot.color.setFromString(color);
			const dark = get<string | null>(slotMap, 'dark', null);
			if (dark) slot.darkColor = Color.fromString(dark);
			slot.attachmentName = get(slotMap, 'attachment', null);
			slot.blendMode = enumFromName(BlendMode, get(slotMap, 'blend', 'normal'), BlendMode.Normal);
			slot.visible = get(slotMap, 'visible', true);
			data.slots.push(slot);
		}

		const bonesOf = (names: string[] | undefined, what: string): BoneData[] =>
			(names ?? []).map((name) => {
				const bone = data.findBone(name);
				if (!bone) throw new Error(`Couldn't find bone ${name} for ${what}`);
				return bone;
			});

		for (const map of root.ik ?? []) {
			const c = new IkConstraintData(map.name);
			c.order = get(map, 'order', 0);
			c.skinRequired = get(map, 'skin', false);
			c.bones = bonesOf(map.bones, `IK constraint ${map.name}`);
			const target = data.findBone(map.target);
			if (!target) throw new Error(`Couldn't find target bone ${map.target} for IK constraint ${map.name}.`);
			c.target = target;
			c.mix = get(map, 'mix', 1);
			c.softness = get(map, 'softness', 0) * scale;
			c.bendDirection = get(map, 'bendPositive', true) ? 1 : -1;
			c.compress = get(map, 'compress', false);
			c.stretch = get(map, 'stretch', false);
			c.uniform = get(map, 'uniform', false);
			data.ikConstraints.push(c);
		}

		for (const map of root.transform ?? []) {
			const c = new TransformConstraintData(map.name);
			c.order = get(map, 'order', 0);
			c.skinRequired = get(map, 'skin', false);
			c.bones = bonesOf(map.bones, `transform constraint ${map.name}`);
			const target = data.findBone(map.target);
			if (!target)
				throw new Error(`Couldn't find target bone ${map.target} for transform constraint ${map.name}.`);
			c.target = target;
			c.local = get(map, 'local', false);
			c.relative = get(map, 'relative', false);
			c.offsetRotation = get(map, 'rotation', 0);
			c.offsetX = get(map, 'x', 0) * scale;
			c.offsetY = get(map, 'y', 0) * scale;
			c.offsetScaleX = get(map, 'scaleX', 0);
			c.offsetScaleY = get(map, 'scaleY', 0);
			c.offsetShearY = get(map, 'shearY', 0);
			c.mixRotate = get(map, 'mixRotate', 1);
			c.mixX = get(map, 'mixX', 1);
			c.mixY = get(map, 'mixY', c.mixX);
			c.mixScaleX = get(map, 'mixScaleX', 1);
			c.mixScaleY = get(map, 'mixScaleY', c.mixScaleX);
			c.mixShearY = get(map, 'mixShearY', 1);
			data.transformConstraints.push(c);
		}

		for (const map of root.path ?? []) {
			const c = new PathConstraintData(map.name);
			c.order = get(map, 'order', 0);
			c.skinRequired = get(map, 'skin', false);
			c.bones = bonesOf(map.bones, `path constraint ${map.name}`);
			const target = data.findSlot(map.target);
			if (!target) throw new Error(`Couldn't find target slot ${map.target} for path constraint ${map.name}.`);
			c.target = target;
			c.positionMode = enumFromName(PositionMode, get(map, 'positionMode', 'percent'), PositionMode.Percent);
			c.spacingMode = enumFromName(SpacingMode, get(map, 'spacingMode', 'length'), SpacingMode.Length);
			c.rotateMode = enumFromName(RotateMode, get(map, 'rotateMode', 'tangent'), RotateMode.Tangent);
			c.offsetRotation = get(map, 'rotation', 0);
			c.position = get(map, 'position', 0);
			if (c.positionMode === PositionMode.Fixed) c.position *= scale;
			c.spacing = get(map, 'spacing', 0);
			if (c.spacingMode === SpacingMode.Length || c.spacingMode === SpacingMode.Fixed)
				c.spacing *= scale;
			c.mixRotate = get(map, 'mixRotate', 1);
			c.mixX = get(map, 'mixX', 1);
			c.mixY = get(map, 'mixY', c.mixX);
			data.pathConstraints.push(c);
		}

		for (const map of root.physics ?? []) {
			const c = new PhysicsConstraintData(map.name);
			c.order = get(map, 'order', 0);
			c.skinRequired = get(map, 'skin', false);
			const bone = data.findBone(map.bone);
			if (!bone) throw new Error(`Physics bone not found: ${map.bone}`);
			c.bone = bone;
			c.x = get(map, 'x', 0);
			c.y = get(map, 'y', 0);
			c.rotate = get(map, 'rotate', 0);
			c.scaleX = get(map, 'scaleX', 0);
			c.shearX = get(map, 'shearX', 0);
			c.limit = get(map, 'limit', 5000) * scale;
			c.step = 1 / get(map, 'fps', 60);
			c.inertia = get(map, 'inertia', 1);
			c.strength = get(map, 'strength', 100);
			c.damping = get(map, 'damping', 1);
			c.massInverse = 1 / get(map, 'mass', 1);
			c.wind = get(map, 'wind', 0);
			c.gravity = get(map, 'gravity', 0);
			c.mix = get(map, 'mix', 1);
			c.inertiaGlobal = get(map, 'inertiaGlobal', false);
			c.strengthGlobal = get(map, 'strengthGlobal', false);
			c.dampingGlobal = get(map, 'dampingGlobal', false);
			c.massGlobal = get(map, 'massGlobal', false);
			c.windGlobal = get(map, 'windGlobal', false);
			c.gravityGlobal = get(map, 'gravityGlobal', false);
			c.mixGlobal = get(map, 'mixGlobal', false);
			data.physicsConstraints.push(c);
		}

		const skins: Json[] = Array.isArray(root.skins)
			? root.skins
			: Object.entries(root.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
		for (const skinMap of skins) {
			const skin = new Skin(skinMap.name);
			skin.bones.push(...bonesOf(skinMap.bones, `skin ${skinMap.name}`));
			const constraint = <T>(names: string[] | undefined, find: (n: string) => T | null, kind: string): T[] =>
				(names ?? []).map((n) => {
					const c = find(n);
					if (!c) throw new Error(`Skin ${kind} constraint not found: ${n}`);
					return c;
				});
			skin.constraints.push(
				...constraint(skinMap.ik, (n) => data.findIkConstraint(n), 'IK'),
				...constraint(skinMap.transform, (n) => data.findTransformConstraint(n), 'transform'),
				...constraint(skinMap.path, (n) => data.findPathConstraint(n), 'path'),
				...constraint(skinMap.physics, (n) => data.findPhysicsConstraint(n), 'physics'),
			);
			for (const slotName of Object.keys(skinMap.attachments ?? {})) {
				const slot = data.findSlot(slotName);
				if (!slot) throw new Error(`Slot not found: ${slotName}`);
				const slotMap = skinMap.attachments[slotName];
				for (const entryName of Object.keys(slotMap)) {
					const attachment = this.readAttachment(slotMap[entryName], skin, slot.index, entryName, data);
					if (attachment) skin.setAttachment(slot.index, entryName, attachment);
				}
			}
			data.skins.push(skin);
			if (skin.name === 'default') data.defaultSkin = skin;
		}

		for (const linked of this.linkedMeshes) {
			const skin = linked.skin ? data.findSkin(linked.skin) : data.defaultSkin;
			if (!skin) throw new Error(`Skin not found: ${linked.skin}`);
			const parent = skin.getAttachment(linked.slotIndex, linked.parent);
			if (!(parent instanceof MeshAttachment)) throw new Error(`Parent mesh not found: ${linked.parent}`);
			linked.mesh.timelineAttachment = linked.inheritTimelines ? parent : linked.mesh;
			linked.mesh.setParentMesh(parent);
			if (linked.mesh.region) linked.mesh.updateRegion();
		}
		this.linkedMeshes.length = 0;

		for (const name of Object.keys(root.events ?? {})) {
			const map = root.events[name];
			const event = new EventData(name);
			event.intValue = get(map, 'int', 0);
			event.floatValue = get(map, 'float', 0);
			event.stringValue = get(map, 'string', '');
			event.audioPath = get(map, 'audio', null);
			if (event.audioPath) {
				event.volume = get(map, 'volume', 1);
				event.balance = get(map, 'balance', 0);
			}
			data.events.push(event);
		}

		for (const name of Object.keys(root.animations ?? {}))
			this.readAnimation(root.animations[name], name, data);

		return data;
	}

	private readSequence(map: Json): Sequence | null {
		if (map === null || map === undefined) return null;
		const sequence = new Sequence(get(map, 'count', 0));
		sequence.start = get(map, 'start', 1);
		sequence.digits = get(map, 'digits', 0);
		sequence.setupIndex = get(map, 'setup', 0);
		return sequence;
	}

	private readAttachment(
		map: Json,
		skin: Skin,
		slotIndex: number,
		entryName: string,
		data: SkeletonData,
	): Attachment | null {
		const scale = this.scale;
		const name = get(map, 'name', entryName);
		const loader = this.attachmentLoader;
		const setColor = (target: { color: Color }): void => {
			const color = get<string | null>(map, 'color', null);
			if (color) target.color.setFromString(color);
		};
		switch (get<string>(map, 'type', 'region')) {
			case 'region': {
				const path = get(map, 'path', name);
				const sequence = this.readSequence(get(map, 'sequence', null));
				const region = loader.newRegionAttachment(skin, name, path, sequence);
				if (!region) return null;
				region.path = path;
				region.x = get(map, 'x', 0) * scale;
				region.y = get(map, 'y', 0) * scale;
				region.scaleX = get(map, 'scaleX', 1);
				region.scaleY = get(map, 'scaleY', 1);
				region.rotation = get(map, 'rotation', 0);
				region.width = map.width * scale;
				region.height = map.height * scale;
				region.sequence = sequence;
				setColor(region);
				if (region.region) region.updateRegion();
				return region;
			}
			case 'boundingbox': {
				const box = loader.newBoundingBoxAttachment(skin, name);
				if (!box) return null;
				this.readVertices(map, box, map.vertexCount << 1);
				setColor(box);
				return box;
			}
			case 'mesh':
			case 'linkedmesh': {
				const path = get(map, 'path', name);
				const sequence = this.readSequence(get(map, 'sequence', null));
				const mesh = loader.newMeshAttachment(skin, name, path, sequence);
				if (!mesh) return null;
				mesh.path = path;
				setColor(mesh);
				mesh.width = get(map, 'width', 0) * scale;
				mesh.height = get(map, 'height', 0) * scale;
				mesh.sequence = sequence;
				const parent = get<string | null>(map, 'parent', null);
				if (parent) {
					this.linkedMeshes.push(
						new LinkedMesh(mesh, get(map, 'skin', null), slotIndex, parent, get(map, 'timelines', true)),
					);
					return mesh;
				}
				const uvs: number[] = map.uvs;
				this.readVertices(map, mesh, uvs.length);
				mesh.triangles = map.triangles;
				mesh.regionUVs = uvs;
				if (mesh.region) mesh.updateRegion();
				mesh.edges = get(map, 'edges', null) as unknown as number[];
				mesh.hullLength = get(map, 'hull', 0) * 2;
				return mesh;
			}
			case 'path': {
				const path = loader.newPathAttachment(skin, name);
				if (!path) return null;
				path.closed = get(map, 'closed', false);
				path.constantSpeed = get(map, 'constantSpeed', true);
				const vertexCount: number = map.vertexCount;
				this.readVertices(map, path, vertexCount << 1);
				const lengths = new Array<number>(vertexCount / 3).fill(0);
				(map.lengths as number[]).forEach((l, i) => (lengths[i] = l * scale));
				path.lengths = lengths;
				setColor(path);
				return path;
			}
			case 'point': {
				const point = loader.newPointAttachment(skin, name);
				if (!point) return null;
				point.x = get(map, 'x', 0) * scale;
				point.y = get(map, 'y', 0) * scale;
				point.rotation = get(map, 'rotation', 0);
				setColor(point);
				return point;
			}
			case 'clipping': {
				const clip = loader.newClippingAttachment(skin, name);
				if (!clip) return null;
				const end = get<string | null>(map, 'end', null);
				if (end) clip.endSlot = data.findSlot(end);
				this.readVertices(map, clip, map.vertexCount << 1);
				setColor(clip);
				return clip;
			}
		}
		return null;
	}

	/** Unweighted when the array holds exactly `x, y` per vertex; otherwise per vertex
	 * `boneCount, (bone, x, y, weight) × boneCount`. */
	private readVertices(map: Json, attachment: VertexAttachment, verticesLength: number): void {
		const scale = this.scale;
		attachment.worldVerticesLength = verticesLength;
		const vertices: number[] = map.vertices;
		if (verticesLength === vertices.length) {
			const out = new Float32Array(vertices.length);
			for (let i = 0; i < vertices.length; i++) out[i] = vertices[i] * scale;
			attachment.vertices = out;
			return;
		}
		const weights: number[] = [];
		const bones: number[] = [];
		for (let i = 0; i < vertices.length; ) {
			const boneCount = vertices[i++];
			bones.push(boneCount);
			for (const end = i + boneCount * 4; i < end; i += 4) {
				bones.push(vertices[i]);
				weights.push(vertices[i + 1] * scale, vertices[i + 2] * scale, vertices[i + 3]);
			}
		}
		attachment.bones = bones;
		attachment.vertices = new Float32Array(weights);
	}

	private readAnimation(map: Json, name: string, data: SkeletonData): void {
		const scale = this.scale;
		const timelines: Timeline[] = [];

		for (const slotName of Object.keys(map.slots ?? {})) {
			const slotMap = map.slots[slotName];
			const slot = data.findSlot(slotName);
			if (!slot) throw new Error(`Slot not found: ${slotName}`);
			const slotIndex = slot.index;
			for (const timelineName of Object.keys(slotMap)) {
				const keys: Json[] = slotMap[timelineName];
				if (!keys) continue;
				const frames = keys.length;
				switch (timelineName) {
					case 'attachment': {
						const t = new AttachmentTimeline(frames, slotIndex);
						keys.forEach((k, f) => t.setFrame(f, get(k, 'time', 0), get(k, 'name', null)));
						timelines.push(t);
						break;
					}
					case 'rgba':
						timelines.push(
							readColors(keys, new RGBATimeline(frames, frames << 2, slotIndex), (k) => {
								const c = Color.fromString(k.color);
								return [c.r, c.g, c.b, c.a];
							}),
						);
						break;
					case 'rgb':
						timelines.push(
							readColors(keys, new RGBTimeline(frames, frames * 3, slotIndex), (k) => {
								const c = Color.fromString(k.color);
								return [c.r, c.g, c.b];
							}),
						);
						break;
					case 'alpha':
						timelines.push(readTimeline1(keys, new AlphaTimeline(frames, frames, slotIndex), 0, 1));
						break;
					case 'rgba2':
						timelines.push(
							readColors(keys, new RGBA2Timeline(frames, frames * 7, slotIndex), (k) => {
								const l = Color.fromString(k.light);
								const d = Color.fromString(k.dark);
								return [l.r, l.g, l.b, l.a, d.r, d.g, d.b];
							}),
						);
						break;
					case 'rgb2':
						timelines.push(
							readColors(keys, new RGB2Timeline(frames, frames * 6, slotIndex), (k) => {
								const l = Color.fromString(k.light);
								const d = Color.fromString(k.dark);
								return [l.r, l.g, l.b, d.r, d.g, d.b];
							}),
						);
						break;
				}
			}
		}

		for (const boneName of Object.keys(map.bones ?? {})) {
			const boneMap = map.bones[boneName];
			const bone = data.findBone(boneName);
			if (!bone) throw new Error(`Bone not found: ${boneName}`);
			const b = bone.index;
			for (const timelineName of Object.keys(boneMap)) {
				const keys: Json[] = boneMap[timelineName];
				const frames = keys.length;
				if (frames === 0) continue;
				switch (timelineName) {
					case 'rotate':
						timelines.push(readTimeline1(keys, new RotateTimeline(frames, frames, b), 0, 1));
						break;
					case 'translate':
						timelines.push(readTimeline2(keys, new TranslateTimeline(frames, frames << 1, b), 'x', 'y', 0, scale));
						break;
					case 'translatex':
						timelines.push(readTimeline1(keys, new TranslateXTimeline(frames, frames, b), 0, scale));
						break;
					case 'translatey':
						timelines.push(readTimeline1(keys, new TranslateYTimeline(frames, frames, b), 0, scale));
						break;
					case 'scale':
						timelines.push(readTimeline2(keys, new ScaleTimeline(frames, frames << 1, b), 'x', 'y', 1, 1));
						break;
					case 'scalex':
						timelines.push(readTimeline1(keys, new ScaleXTimeline(frames, frames, b), 1, 1));
						break;
					case 'scaley':
						timelines.push(readTimeline1(keys, new ScaleYTimeline(frames, frames, b), 1, 1));
						break;
					case 'shear':
						timelines.push(readTimeline2(keys, new ShearTimeline(frames, frames << 1, b), 'x', 'y', 0, 1));
						break;
					case 'shearx':
						timelines.push(readTimeline1(keys, new ShearXTimeline(frames, frames, b), 0, 1));
						break;
					case 'sheary':
						timelines.push(readTimeline1(keys, new ShearYTimeline(frames, frames, b), 0, 1));
						break;
					case 'inherit': {
						const t = new InheritTimeline(frames, b);
						keys.forEach((k, f) =>
							t.setFrame(f, get(k, 'time', 0), enumFromName(Inherit, get(k, 'inherit', 'normal'), Inherit.Normal)),
						);
						timelines.push(t);
						break;
					}
				}
			}
		}

		for (const constraintName of Object.keys(map.ik ?? {})) {
			const keys: Json[] = map.ik[constraintName];
			if (!keys[0]) continue;
			const constraint = data.findIkConstraint(constraintName);
			if (!constraint) throw new Error(`IK Constraint not found: ${constraintName}`);
			const t = new IkConstraintTimeline(keys.length, keys.length << 1, data.ikConstraints.indexOf(constraint));
			keys.forEach((k, f) =>
				t.setFrame(
					f,
					get(k, 'time', 0),
					get(k, 'mix', 1),
					get(k, 'softness', 0) * scale,
					get(k, 'bendPositive', true) ? 1 : -1,
					get(k, 'compress', false),
					get(k, 'stretch', false),
				),
			);
			readCurves(keys, t, [(k) => get(k, 'mix', 1), (k) => get(k, 'softness', 0) * scale], [1, scale]);
			timelines.push(t);
		}

		for (const constraintName of Object.keys(map.transform ?? {})) {
			const keys: Json[] = map.transform[constraintName];
			if (!keys[0]) continue;
			const constraint = data.findTransformConstraint(constraintName);
			if (!constraint) throw new Error(`Transform constraint not found: ${constraintName}`);
			const t = new TransformConstraintTimeline(
				keys.length,
				keys.length * 6,
				data.transformConstraints.indexOf(constraint),
			);
			const values = (k: Json): number[] => {
				const mixX = get(k, 'mixX', 1);
				const mixScaleX = get(k, 'mixScaleX', 1);
				return [
					get(k, 'mixRotate', 1),
					mixX,
					get(k, 'mixY', mixX),
					mixScaleX,
					get(k, 'mixScaleY', mixScaleX),
					get(k, 'mixShearY', 1),
				];
			};
			keys.forEach((k, f) => {
				const v = values(k);
				t.setFrame(f, get(k, 'time', 0), v[0], v[1], v[2], v[3], v[4], v[5]);
			});
			readCurves(keys, t, [0, 1, 2, 3, 4, 5].map((i) => (k: Json) => values(k)[i]), [1, 1, 1, 1, 1, 1]);
			timelines.push(t);
		}

		for (const constraintName of Object.keys(map.path ?? {})) {
			const constraintMap = map.path[constraintName];
			const constraint = data.findPathConstraint(constraintName);
			if (!constraint) throw new Error(`Path constraint not found: ${constraintName}`);
			const index = data.pathConstraints.indexOf(constraint);
			for (const timelineName of Object.keys(constraintMap)) {
				const keys: Json[] = constraintMap[timelineName];
				if (!keys[0]) continue;
				const frames = keys.length;
				if (timelineName === 'position') {
					const s = constraint.positionMode === PositionMode.Fixed ? scale : 1;
					timelines.push(readTimeline1(keys, new PathConstraintPositionTimeline(frames, frames, index), 0, s));
				} else if (timelineName === 'spacing') {
					const s =
						constraint.spacingMode === SpacingMode.Length || constraint.spacingMode === SpacingMode.Fixed
							? scale
							: 1;
					timelines.push(readTimeline1(keys, new PathConstraintSpacingTimeline(frames, frames, index), 0, s));
				} else if (timelineName === 'mix') {
					const t = new PathConstraintMixTimeline(frames, frames * 3, index);
					const values = (k: Json): number[] => {
						const mixX = get(k, 'mixX', 1);
						return [get(k, 'mixRotate', 1), mixX, get(k, 'mixY', mixX)];
					};
					keys.forEach((k, f) => {
						const v = values(k);
						t.setFrame(f, get(k, 'time', 0), v[0], v[1], v[2]);
					});
					readCurves(keys, t, [0, 1, 2].map((i) => (k: Json) => values(k)[i]), [1, 1, 1]);
					timelines.push(t);
				}
			}
		}

		for (const constraintName of Object.keys(map.physics ?? {})) {
			const constraintMap = map.physics[constraintName];
			let index = -1;
			if (constraintName.length > 0) {
				const constraint = data.findPhysicsConstraint(constraintName);
				if (!constraint) throw new Error(`Physics constraint not found: ${constraintName}`);
				index = data.physicsConstraints.indexOf(constraint);
			}
			for (const timelineName of Object.keys(constraintMap)) {
				const keys: Json[] = constraintMap[timelineName];
				if (!keys[0]) continue;
				const frames = keys.length;
				if (timelineName === 'reset') {
					const t = new PhysicsConstraintResetTimeline(frames, index);
					keys.forEach((k, f) => t.setFrame(f, get(k, 'time', 0)));
					timelines.push(t);
					continue;
				}
				const make: Record<string, new (f: number, b: number, i: number) => PhysicsConstraintTimeline> = {
					inertia: PhysicsConstraintInertiaTimeline,
					strength: PhysicsConstraintStrengthTimeline,
					damping: PhysicsConstraintDampingTimeline,
					mass: PhysicsConstraintMassTimeline,
					wind: PhysicsConstraintWindTimeline,
					gravity: PhysicsConstraintGravityTimeline,
					mix: PhysicsConstraintMixTimeline,
				};
				const Ctor = make[timelineName];
				if (Ctor) timelines.push(readTimeline1(keys, new Ctor(frames, frames, index), 0, 1));
			}
		}

		for (const skinName of Object.keys(map.attachments ?? {})) {
			const skinMap = map.attachments[skinName];
			const skin = data.findSkin(skinName);
			if (!skin) throw new Error(`Skin not found: ${skinName}`);
			for (const slotName of Object.keys(skinMap)) {
				const slotMap = skinMap[slotName];
				const slot = data.findSlot(slotName);
				if (!slot) throw new Error(`Slot not found: ${slotName}`);
				for (const attachmentName of Object.keys(slotMap)) {
					const attachmentMap = slotMap[attachmentName];
					const attachment = skin.getAttachment(slot.index, attachmentName);
					for (const timelineName of Object.keys(attachmentMap)) {
						const keys: Json[] = attachmentMap[timelineName];
						if (!keys[0]) continue;
						if (timelineName === 'deform') {
							if (!(attachment instanceof VertexAttachment))
								throw new Error(`Deform attachment not found: ${attachmentName}`);
							timelines.push(this.readDeform(keys, slot.index, attachment));
						} else if (timelineName === 'sequence') {
							if (!attachment) throw new Error(`Sequence attachment not found: ${attachmentName}`);
							const t = new SequenceTimeline(
								keys.length,
								slot.index,
								attachment as Attachment & HasTextureRegion,
							);
							let lastDelay = 0;
							keys.forEach((k, f) => {
								const delay = get(k, 'delay', lastDelay);
								const mode = SequenceMode[get(k, 'mode', 'hold') as keyof typeof SequenceMode];
								t.setFrame(f, get(k, 'time', 0), mode, get(k, 'index', 0), delay);
								lastDelay = delay;
							});
							timelines.push(t);
						}
					}
				}
			}
		}

		if (map.drawOrder) {
			const keys: Json[] = map.drawOrder;
			const t = new DrawOrderTimeline(keys.length);
			const slotCount = data.slots.length;
			keys.forEach((k, f) => {
				const offsets = get<Json[] | null>(k, 'offsets', null);
				let order: number[] | null = null;
				if (offsets) {
					order = new Array<number>(slotCount).fill(-1);
					const unchanged = new Array<number>(slotCount - offsets.length).fill(0);
					let original = 0;
					let u = 0;
					for (const offset of offsets) {
						const slot = data.findSlot(offset.slot);
						if (!slot) throw new Error(`Slot not found: ${offset.slot}`);
						while (original !== slot.index) unchanged[u++] = original++;
						order[original + offset.offset] = original++;
					}
					while (original < slotCount) unchanged[u++] = original++;
					for (let i = slotCount - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged[--u];
				}
				t.setFrame(f, get(k, 'time', 0), order);
			});
			timelines.push(t);
		}

		if (map.events) {
			const keys: Json[] = map.events;
			const t = new EventTimeline(keys.length);
			keys.forEach((k, f) => {
				const eventData = data.findEvent(k.name);
				if (!eventData) throw new Error(`Event not found: ${k.name}`);
				const event = new Event(Math.fround(get(k, 'time', 0)), eventData);
				event.intValue = get(k, 'int', eventData.intValue);
				event.floatValue = get(k, 'float', eventData.floatValue);
				event.stringValue = get(k, 'string', eventData.stringValue);
				if (eventData.audioPath) {
					event.volume = get(k, 'volume', 1);
					event.balance = get(k, 'balance', 0);
				}
				t.setFrame(f, event);
			});
			timelines.push(t);
		}

		let duration = 0;
		for (const t of timelines) duration = Math.max(duration, t.getDuration());
		data.animations.push(new Animation(name, timelines, duration));
	}

	private readDeform(keys: Json[], slotIndex: number, attachment: VertexAttachment): DeformTimeline {
		const scale = this.scale;
		const weighted = !!attachment.bones;
		const setup = attachment.vertices;
		const length = weighted ? (setup.length / 3) * 2 : setup.length;
		const t = new DeformTimeline(keys.length, keys.length, slotIndex, attachment);
		keys.forEach((k, f) => {
			const values = get<number[] | null>(k, 'vertices', null);
			let deform: Float32Array;
			if (!values) deform = weighted ? new Float32Array(length) : (setup as Float32Array);
			else {
				deform = new Float32Array(length);
				const start = get(k, 'offset', 0);
				for (let i = 0; i < values.length; i++) deform[start + i] = values[i] * scale;
				if (!weighted) for (let i = 0; i < length; i++) deform[i] += setup[i];
			}
			t.setFrame(f, get(k, 'time', 0), deform);
		});
		readCurves(keys, t, [() => 0], [1], () => [0, 1]);
		return t;
	}
}

/** Applies each key's `curve` (stepped, or four bezier numbers per value) to frame `f` → `f + 1`. */
function readCurves(
	keys: Json[],
	timeline: CurveTimeline,
	valueOf: Array<(k: Json) => number>,
	scales: number[],
	fixedEnds?: () => [number, number],
): void {
	for (let f = 0; f < keys.length - 1; f++) {
		const curve = keys[f].curve;
		if (!curve) continue;
		if (curve === 'stepped') {
			timeline.setStepped(f);
			continue;
		}
		const time1 = get(keys[f], 'time', 0);
		const time2 = get(keys[f + 1], 'time', 0);
		valueOf.forEach((value, v) => {
			const [v1, v2] = fixedEnds ? fixedEnds() : [value(keys[f]), value(keys[f + 1])];
			const i = v << 2;
			timeline.setBezier(
				0,
				f,
				v,
				time1,
				v1,
				curve[i],
				curve[i + 1] * scales[v],
				curve[i + 2],
				curve[i + 3] * scales[v],
				time2,
				v2,
			);
		});
	}
}

function readTimeline1(keys: Json[], timeline: CurveTimeline1, defaultValue: number, scale: number): CurveTimeline1 {
	const value = (k: Json): number => get(k, 'value', defaultValue) * scale;
	keys.forEach((k, f) => timeline.setFrame(f, get(k, 'time', 0), value(k)));
	readCurves(keys, timeline, [value], [scale]);
	return timeline;
}

function readTimeline2(
	keys: Json[],
	timeline: CurveTimeline2,
	name1: string,
	name2: string,
	defaultValue: number,
	scale: number,
): CurveTimeline2 {
	const v1 = (k: Json): number => get(k, name1, defaultValue) * scale;
	const v2 = (k: Json): number => get(k, name2, defaultValue) * scale;
	keys.forEach((k, f) => timeline.setFrame(f, get(k, 'time', 0), v1(k), v2(k)));
	readCurves(keys, timeline, [v1, v2], [scale, scale]);
	return timeline;
}

function readColors(
	keys: Json[],
	timeline: CurveTimeline & { setFrame(frame: number, time: number, ...values: number[]): void },
	values: (k: Json) => number[],
): CurveTimeline {
	keys.forEach((k, f) => timeline.setFrame(f, get(k, 'time', 0), ...values(k)));
	const count = values(keys[0]).length;
	readCurves(
		keys,
		timeline,
		Array.from({ length: count }, (_, i) => (k: Json) => values(k)[i]),
		new Array<number>(count).fill(1),
	);
	return timeline;
}
