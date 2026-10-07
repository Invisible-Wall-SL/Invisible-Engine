import { Color, DEG_RAD, type Vector2 } from './math';
import {
	ClippingAttachment,
	MeshAttachment,
	PathAttachment,
	RegionAttachment,
	type Attachment,
} from './attachments';
import type { ConstraintData, SkeletonData, Skin } from './data';
import { Bone } from './bone';
import { Slot } from './slot';
import {
	IkConstraint,
	PathConstraint,
	PhysicsConstraint,
	TransformConstraint,
	type Updatable,
} from './constraints';
import { Physics } from './physics';
import type { SkeletonClipping } from './clipping';

interface PointLike {
	x: number;
	y: number;
	set?(x: number, y: number): unknown;
}

const QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];

export class Skeleton {
	static quadTriangles = QUAD_TRIANGLES;
	/** Default y direction for new skeletons: true for y-down renderers (Pixi), false for y-up. */
	static yDown = false;

	bones: Bone[] = [];
	slots: Slot[] = [];
	drawOrder: Slot[] = [];
	ikConstraints: IkConstraint[] = [];
	transformConstraints: TransformConstraint[] = [];
	pathConstraints: PathConstraint[] = [];
	physicsConstraints: PhysicsConstraint[] = [];
	_updateCache: Updatable[] = [];
	skin: Skin | null = null;
	color = new Color(1, 1, 1, 1);
	scaleX = 1;
	private _scaleY = 1;
	x = 0;
	y = 0;
	/** Seconds of simulated time, advanced by `update`; drives physics. */
	time = 0;
	/** Flips world y so the skeleton draws upright in a y-down coordinate system. */
	yDown = Skeleton.yDown;

	constructor(public data: SkeletonData) {
		if (!data) throw new Error('data cannot be null.');
		for (const boneData of data.bones) {
			const parent = boneData.parent ? this.bones[boneData.parent.index] : null;
			const bone = new Bone(boneData, this, parent);
			parent?.children.push(bone);
			this.bones.push(bone);
		}
		for (const slotData of data.slots) {
			const slot = new Slot(slotData, this.bones[slotData.boneData.index]);
			this.slots.push(slot);
			this.drawOrder.push(slot);
		}
		for (const c of data.ikConstraints) this.ikConstraints.push(new IkConstraint(c, this));
		for (const c of data.transformConstraints)
			this.transformConstraints.push(new TransformConstraint(c, this));
		for (const c of data.pathConstraints) this.pathConstraints.push(new PathConstraint(c, this));
		for (const c of data.physicsConstraints)
			this.physicsConstraints.push(new PhysicsConstraint(c, this));
		this.updateCache();
	}

	get scaleY(): number {
		return this.yDown ? -this._scaleY : this._scaleY;
	}

	set scaleY(value: number) {
		this._scaleY = value;
	}

	/** Orders bones and constraints so each is updated after everything it depends on. */
	updateCache(): void {
		const cache: Updatable[] = [];
		this._updateCache = cache;
		for (const bone of this.bones) {
			bone.sorted = bone.data.skinRequired;
			bone.active = !bone.sorted;
		}
		if (this.skin) {
			for (const boneData of this.skin.bones) {
				let bone: Bone | null = this.bones[boneData.index];
				while (bone) {
					bone.sorted = false;
					bone.active = true;
					bone = bone.parent;
				}
			}
		}

		const sortBone = (bone: Bone | null): void => {
			if (!bone || bone.sorted) return;
			sortBone(bone.parent);
			bone.sorted = true;
			cache.push(bone);
		};
		const sortReset = (bones: Bone[]): void => {
			for (const bone of bones) {
				if (!bone.active) continue;
				if (bone.sorted) sortReset(bone.children);
				bone.sorted = false;
			}
		};
		const inSkin = (c: ConstraintData): boolean =>
			!c.skinRequired || (!!this.skin && this.skin.constraints.includes(c));
		const sortPathAttachment = (
			attachment: Attachment | null | undefined,
			slotBone: Bone,
		): void => {
			if (!(attachment instanceof PathAttachment)) return;
			const pathBones = attachment.bones;
			if (!pathBones) {
				sortBone(slotBone);
				return;
			}
			for (let i = 0; i < pathBones.length;) {
				const n = pathBones[i++];
				for (const end = i + n; i < end; i++) sortBone(this.bones[pathBones[i]]);
			}
		};
		const sortPathSkin = (skin: Skin, slotIndex: number, slotBone: Bone): void => {
			const map = skin.attachments[slotIndex];
			if (!map) return;
			for (const key of Object.keys(map)) sortPathAttachment(map[key], slotBone);
		};

		const sortIk = (c: IkConstraint): void => {
			c.active = c.target.isActive() && inSkin(c.data);
			if (!c.active) return;
			sortBone(c.target);
			const parent = c.bones[0];
			sortBone(parent);
			if (c.bones.length === 1) {
				cache.push(c);
				sortReset(parent.children);
			} else {
				const child = c.bones[c.bones.length - 1];
				sortBone(child);
				cache.push(c);
				sortReset(parent.children);
				child.sorted = true;
			}
		};
		const sortTransform = (c: TransformConstraint): void => {
			c.active = c.target.isActive() && inSkin(c.data);
			if (!c.active) return;
			sortBone(c.target);
			if (c.data.local) {
				for (const child of c.bones) {
					sortBone(child.parent);
					sortBone(child);
				}
			} else for (const bone of c.bones) sortBone(bone);
			cache.push(c);
			for (const bone of c.bones) sortReset(bone.children);
			for (const bone of c.bones) bone.sorted = true;
		};
		const sortPath = (c: PathConstraint): void => {
			c.active = c.target.bone.isActive() && inSkin(c.data);
			if (!c.active) return;
			const slot = c.target;
			const slotIndex = slot.data.index;
			const slotBone = slot.bone;
			if (this.skin) sortPathSkin(this.skin, slotIndex, slotBone);
			if (this.data.defaultSkin && this.data.defaultSkin !== this.skin)
				sortPathSkin(this.data.defaultSkin, slotIndex, slotBone);
			for (const skin of this.data.skins) sortPathSkin(skin, slotIndex, slotBone);
			sortPathAttachment(slot.getAttachment(), slotBone);
			for (const bone of c.bones) sortBone(bone);
			cache.push(c);
			for (const bone of c.bones) sortReset(bone.children);
			for (const bone of c.bones) bone.sorted = true;
		};
		const sortPhysics = (c: PhysicsConstraint): void => {
			const bone = c.bone;
			c.active = bone.active && inSkin(c.data);
			if (!c.active) return;
			sortBone(bone);
			cache.push(c);
			sortReset(bone.children);
			bone.sorted = true;
		};

		const total =
			this.ikConstraints.length +
			this.transformConstraints.length +
			this.pathConstraints.length +
			this.physicsConstraints.length;
		for (let order = 0; order < total; order++) {
			const ik = this.ikConstraints.find((c) => c.data.order === order);
			if (ik) {
				sortIk(ik);
				continue;
			}
			const transform = this.transformConstraints.find((c) => c.data.order === order);
			if (transform) {
				sortTransform(transform);
				continue;
			}
			const path = this.pathConstraints.find((c) => c.data.order === order);
			if (path) {
				sortPath(path);
				continue;
			}
			const physics = this.physicsConstraints.find((c) => c.data.order === order);
			if (physics) sortPhysics(physics);
		}
		for (const bone of this.bones) sortBone(bone);
	}

	updateWorldTransform(physics: Physics): void {
		if (physics === undefined || physics === null) throw new Error('physics is undefined');
		for (const bone of this.bones) {
			bone.ax = bone.x;
			bone.ay = bone.y;
			bone.arotation = bone.rotation;
			bone.ascaleX = bone.scaleX;
			bone.ascaleY = bone.scaleY;
			bone.ashearX = bone.shearX;
			bone.ashearY = bone.shearY;
		}
		for (const updatable of this._updateCache) updatable.update(physics);
	}

	/** Updates the world transform as if `parent` were the root's parent. */
	updateWorldTransformWith(physics: Physics, parent: Bone): void {
		const root = this.getRootBone();
		if (!root) return;
		const { a: pa, b: pb, c: pc, d: pd } = parent;
		root.worldX = pa * this.x + pb * this.y + parent.worldX;
		root.worldY = pc * this.x + pd * this.y + parent.worldY;
		const rx = (root.rotation + root.shearX) * DEG_RAD;
		const ry = (root.rotation + 90 + root.shearY) * DEG_RAD;
		const la = Math.cos(rx) * root.scaleX;
		const lb = Math.cos(ry) * root.scaleY;
		const lc = Math.sin(rx) * root.scaleX;
		const ld = Math.sin(ry) * root.scaleY;
		root.a = (pa * la + pb * lc) * this.scaleX;
		root.b = (pa * lb + pb * ld) * this.scaleX;
		root.c = (pc * la + pd * lc) * this.scaleY;
		root.d = (pc * lb + pd * ld) * this.scaleY;
		for (const updatable of this._updateCache) if (updatable !== root) updatable.update(physics);
	}

	setToSetupPose(): void {
		this.setBonesToSetupPose();
		this.setSlotsToSetupPose();
	}

	setBonesToSetupPose(): void {
		for (const bone of this.bones) bone.setToSetupPose();
		for (const c of this.ikConstraints) c.setToSetupPose();
		for (const c of this.transformConstraints) c.setToSetupPose();
		for (const c of this.pathConstraints) c.setToSetupPose();
		for (const c of this.physicsConstraints) c.setToSetupPose();
	}

	setSlotsToSetupPose(): void {
		this.drawOrder.length = 0;
		for (const slot of this.slots) this.drawOrder.push(slot);
		for (const slot of this.slots) slot.setToSetupPose();
	}

	getRootBone(): Bone | null {
		return this.bones.length ? this.bones[0] : null;
	}

	findBone(name: string): Bone | null {
		if (!name) throw new Error('boneName cannot be null.');
		return this.bones.find((b) => b.data.name === name) ?? null;
	}

	findSlot(name: string): Slot | null {
		if (!name) throw new Error('slotName cannot be null.');
		return this.slots.find((s) => s.data.name === name) ?? null;
	}

	setSkinByName(name: string): void {
		const skin = this.data.findSkin(name);
		if (!skin) throw new Error('Skin not found: ' + name);
		this.setSkin(skin);
	}

	/** Switches skin. Slots showing an attachment of the old skin take the new skin's attachment of
	 * the same name; with no old skin, slots take the new skin's setup attachment when it has one. */
	setSkin(newSkin: Skin | null): void {
		if (newSkin === this.skin) return;
		if (newSkin) {
			if (this.skin) newSkin.attachAll(this, this.skin);
			else {
				this.slots.forEach((slot, i) => {
					const name = slot.data.attachmentName;
					if (!name) return;
					const attachment = newSkin.getAttachment(i, name);
					if (attachment) slot.setAttachment(attachment);
				});
			}
		}
		this.skin = newSkin;
		this.updateCache();
	}

	getAttachmentByName(slotName: string, attachmentName: string): Attachment | null {
		const slot = this.data.findSlot(slotName);
		if (!slot) throw new Error(`Can't find slot with name ${slotName}`);
		return this.getAttachment(slot.index, attachmentName);
	}

	getAttachment(slotIndex: number, attachmentName: string): Attachment | null {
		if (!attachmentName) throw new Error('attachmentName cannot be null.');
		if (this.skin) {
			const attachment = this.skin.getAttachment(slotIndex, attachmentName);
			if (attachment) return attachment;
		}
		return this.data.defaultSkin?.getAttachment(slotIndex, attachmentName) ?? null;
	}

	setAttachment(slotName: string, attachmentName: string | null): void {
		if (!slotName) throw new Error('slotName cannot be null.');
		const index = this.slots.findIndex((s) => s.data.name === slotName);
		if (index === -1) throw new Error('Slot not found: ' + slotName);
		let attachment: Attachment | null = null;
		if (attachmentName) {
			attachment = this.getAttachment(index, attachmentName);
			if (!attachment)
				throw new Error(`Attachment not found: ${attachmentName}, for slot: ${slotName}`);
		}
		this.slots[index].setAttachment(attachment);
	}

	findIkConstraint(name: string): IkConstraint | null {
		return this.ikConstraints.find((c) => c.data.name === name) ?? null;
	}

	findTransformConstraint(name: string): TransformConstraint | null {
		return this.transformConstraints.find((c) => c.data.name === name) ?? null;
	}

	findPathConstraint(name: string): PathConstraint | null {
		return this.pathConstraints.find((c) => c.data.name === name) ?? null;
	}

	findPhysicsConstraint(name: string): PhysicsConstraint | null {
		return this.physicsConstraints.find((c) => c.data.name === name) ?? null;
	}

	getBoundsRect(clipper?: SkeletonClipping): {
		x: number;
		y: number;
		width: number;
		height: number;
	} {
		const offset = { x: 0, y: 0 };
		const size = { x: 0, y: 0 };
		this.getBounds(offset, size, [], clipper ?? null);
		return { x: offset.x, y: offset.y, width: size.x, height: size.y };
	}

	/** Axis-aligned bounds of every visible region and mesh in the current pose. */
	getBounds(
		offset: PointLike | Vector2,
		size: PointLike | Vector2,
		temp: number[] = [],
		clipper: SkeletonClipping | null = null,
	): void {
		if (!offset) throw new Error('offset cannot be null.');
		if (!size) throw new Error('size cannot be null.');
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const slot of this.drawOrder) {
			if (!slot.bone.active) continue;
			let vertices: number[] | null = null;
			let count = 0;
			let triangles: number[] | null = null;
			const attachment = slot.getAttachment();
			if (attachment instanceof RegionAttachment) {
				count = 8;
				temp.length = 8;
				attachment.computeWorldVertices(slot, temp, 0, 2);
				vertices = temp;
				triangles = QUAD_TRIANGLES;
			} else if (attachment instanceof MeshAttachment) {
				count = attachment.worldVerticesLength;
				temp.length = count;
				attachment.computeWorldVertices(slot, 0, count, temp, 0, 2);
				vertices = temp;
				triangles = attachment.triangles;
			} else if (attachment instanceof ClippingAttachment && clipper) {
				clipper.clipStart(slot, attachment);
				continue;
			}
			if (vertices && triangles) {
				if (clipper && clipper.isClipping()) {
					clipper.clipTriangles(vertices, triangles, triangles.length);
					vertices = clipper.clippedVertices;
					count = clipper.clippedVertices.length;
				}
				for (let i = 0; i < count; i += 2) {
					const x = vertices[i];
					const y = vertices[i + 1];
					if (x < minX) minX = x;
					if (y < minY) minY = y;
					if (x > maxX) maxX = x;
					if (y > maxY) maxY = y;
				}
			}
			clipper?.clipEndWithSlot(slot);
		}
		clipper?.clipEnd();
		setPoint(offset, minX, minY);
		setPoint(size, maxX - minX, maxY - minY);
	}

	/** Advances the skeleton clock used by physics. */
	update(delta: number): void {
		this.time += delta;
	}

	physicsTranslate(x: number, y: number): void {
		for (const c of this.physicsConstraints) c.translate(x, y);
	}

	physicsRotate(x: number, y: number, degrees: number): void {
		for (const c of this.physicsConstraints) c.rotate(x, y, degrees);
	}
}

function setPoint(p: PointLike, x: number, y: number): void {
	if (typeof p.set === 'function') p.set(x, y);
	else {
		p.x = x;
		p.y = y;
	}
}
