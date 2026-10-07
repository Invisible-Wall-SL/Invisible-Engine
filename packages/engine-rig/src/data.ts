import { Color } from './math';
import { MeshAttachment, type Attachment } from './attachments';
import type { Animation } from './animation';

export enum Inherit {
	Normal = 0,
	OnlyTranslation = 1,
	NoRotationOrReflection = 2,
	NoScale = 3,
	NoScaleOrReflection = 4,
}

export enum BlendMode {
	Normal = 0,
	Additive = 1,
	Multiply = 2,
	Screen = 3,
}

export enum PositionMode {
	Fixed = 0,
	Percent = 1,
}

export enum SpacingMode {
	Length = 0,
	Fixed = 1,
	Percent = 2,
	Proportional = 3,
}

export enum RotateMode {
	Tangent = 0,
	Chain = 1,
	ChainScale = 2,
}

/** Reads a lowercase-first enum name from skeleton JSON (`"noScale"` → `NoScale`). */
export function enumFromName<T extends Record<string, string | number>>(
	type: T,
	name: string,
	fallback: T[keyof T],
): T[keyof T] {
	if (!name) return fallback;
	const key = name.charAt(0).toUpperCase() + name.slice(1);
	const value = type[key as keyof T];
	return value === undefined ? fallback : value;
}

export class BoneData {
	parent: BoneData | null;
	length = 0;
	x = 0;
	y = 0;
	rotation = 0;
	scaleX = 1;
	scaleY = 1;
	shearX = 0;
	shearY = 0;
	inherit = Inherit.Normal;
	skinRequired = false;
	color = new Color();
	icon?: string;
	/** Editor display flag (nonessential data); false unless the file says otherwise. */
	visible = false;

	constructor(
		public index: number,
		public name: string,
		parent: BoneData | null,
	) {
		if (index < 0) throw new Error('index must be >= 0.');
		this.parent = parent;
	}
}

export class SlotData {
	color = new Color(1, 1, 1, 1);
	darkColor: Color | null = null;
	attachmentName: string | null = null;
	blendMode = BlendMode.Normal;
	visible = true;

	constructor(
		public index: number,
		public name: string,
		public boneData: BoneData,
	) {
		if (index < 0) throw new Error('index must be >= 0.');
	}
}

export abstract class ConstraintData {
	constructor(
		public name: string,
		public order: number,
		public skinRequired: boolean,
	) {}
}

export class IkConstraintData extends ConstraintData {
	bones: BoneData[] = [];
	private _target: BoneData | null = null;
	bendDirection = 1;
	compress = false;
	stretch = false;
	uniform = false;
	mix = 1;
	softness = 0;

	constructor(name: string) {
		super(name, 0, false);
	}

	get target(): BoneData {
		if (!this._target) throw new Error('BoneData not set.');
		return this._target;
	}
	set target(value: BoneData) {
		this._target = value;
	}
}

export class TransformConstraintData extends ConstraintData {
	bones: BoneData[] = [];
	private _target: BoneData | null = null;
	mixRotate = 0;
	mixX = 0;
	mixY = 0;
	mixScaleX = 0;
	mixScaleY = 0;
	mixShearY = 0;
	offsetRotation = 0;
	offsetX = 0;
	offsetY = 0;
	offsetScaleX = 0;
	offsetScaleY = 0;
	offsetShearY = 0;
	relative = false;
	local = false;

	constructor(name: string) {
		super(name, 0, false);
	}

	get target(): BoneData {
		if (!this._target) throw new Error('BoneData not set.');
		return this._target;
	}
	set target(value: BoneData) {
		this._target = value;
	}
}

export class PathConstraintData extends ConstraintData {
	bones: BoneData[] = [];
	private _target: SlotData | null = null;
	positionMode = PositionMode.Fixed;
	spacingMode = SpacingMode.Fixed;
	rotateMode = RotateMode.Chain;
	offsetRotation = 0;
	position = 0;
	spacing = 0;
	mixRotate = 0;
	mixX = 0;
	mixY = 0;

	constructor(name: string) {
		super(name, 0, false);
	}

	get target(): SlotData {
		if (!this._target) throw new Error('SlotData not set.');
		return this._target;
	}
	set target(value: SlotData) {
		this._target = value;
	}
}

export class PhysicsConstraintData extends ConstraintData {
	private _bone: BoneData | null = null;
	x = 0;
	y = 0;
	rotate = 0;
	scaleX = 0;
	shearX = 0;
	limit = 0;
	step = 0;
	inertia = 0;
	strength = 0;
	damping = 0;
	massInverse = 0;
	wind = 0;
	gravity = 0;
	mix = 0;
	inertiaGlobal = false;
	strengthGlobal = false;
	dampingGlobal = false;
	massGlobal = false;
	windGlobal = false;
	gravityGlobal = false;
	mixGlobal = false;

	constructor(name: string) {
		super(name, 0, false);
	}

	get bone(): BoneData {
		if (!this._bone) throw new Error('BoneData not set.');
		return this._bone;
	}
	set bone(value: BoneData) {
		this._bone = value;
	}
}

export class EventData {
	intValue = 0;
	floatValue = 0;
	stringValue: string | null = null;
	audioPath: string | null = null;
	volume = 0;
	balance = 0;

	constructor(public name: string) {}
}

export class SkinEntry {
	constructor(
		public slotIndex: number,
		public name: string,
		public attachment: Attachment,
	) {}
}

export class Skin {
	attachments: Array<Record<string, Attachment> | undefined> = [];
	bones: BoneData[] = [];
	constraints: ConstraintData[] = [];
	color = new Color(0.99607843, 0.61960787, 0.30980393, 1);

	constructor(public name: string) {
		if (!name) throw new Error('name cannot be null.');
	}

	setAttachment(slotIndex: number, name: string, attachment: Attachment): void {
		if (!attachment) throw new Error('attachment cannot be null.');
		while (this.attachments.length <= slotIndex) this.attachments.push(undefined);
		const map = (this.attachments[slotIndex] ??= {});
		map[name] = attachment;
	}

	addSkin(skin: Skin): void {
		for (const bone of skin.bones) if (!this.bones.includes(bone)) this.bones.push(bone);
		for (const c of skin.constraints) if (!this.constraints.includes(c)) this.constraints.push(c);
		for (const entry of skin.getAttachments())
			this.setAttachment(entry.slotIndex, entry.name, entry.attachment);
	}

	/** Like `addSkin`, but attachments are copied (meshes become linked meshes of the source). */
	copySkin(skin: Skin): void {
		for (const bone of skin.bones) if (!this.bones.includes(bone)) this.bones.push(bone);
		for (const c of skin.constraints) if (!this.constraints.includes(c)) this.constraints.push(c);
		for (const entry of skin.getAttachments()) {
			const source = entry.attachment;
			const copy = source instanceof MeshAttachment ? source.newLinkedMesh() : source.copy();
			this.setAttachment(entry.slotIndex, entry.name, copy);
		}
	}

	getAttachment(slotIndex: number, name: string): Attachment | null {
		return this.attachments[slotIndex]?.[name] ?? null;
	}

	removeAttachment(slotIndex: number, name: string): void {
		const map = this.attachments[slotIndex];
		if (map) delete map[name];
	}

	getAttachments(): SkinEntry[] {
		const out: SkinEntry[] = [];
		this.attachments.forEach((map, slotIndex) => {
			if (!map) return;
			for (const name of Object.keys(map)) out.push(new SkinEntry(slotIndex, name, map[name]));
		});
		return out;
	}

	getAttachmentsForSlot(slotIndex: number, out: SkinEntry[]): void {
		const map = this.attachments[slotIndex];
		if (!map) return;
		for (const name of Object.keys(map)) out.push(new SkinEntry(slotIndex, name, map[name]));
	}

	clear(): void {
		this.attachments.length = 0;
		this.bones.length = 0;
		this.constraints.length = 0;
	}

	/** Called on a skin change: each slot showing an attachment of `oldSkin` switches to this
	 * skin's attachment under the same name, when it has one. */
	attachAll(
		skeleton: {
			slots: ArrayLike<{
				getAttachment(): Attachment | null;
				setAttachment(a: Attachment | null): void;
			}>;
		},
		oldSkin: Skin,
	): void {
		for (let slotIndex = 0; slotIndex < skeleton.slots.length; slotIndex++) {
			const slot = skeleton.slots[slotIndex];
			const current = slot.getAttachment();
			const oldMap = oldSkin.attachments[slotIndex];
			if (!current || !oldMap) continue;
			for (const name of Object.keys(oldMap)) {
				if (oldMap[name] !== current) continue;
				const replacement = this.getAttachment(slotIndex, name);
				if (replacement) slot.setAttachment(replacement);
				break;
			}
		}
	}
}

export class SkeletonData {
	name: string | null = null;
	bones: BoneData[] = [];
	slots: SlotData[] = [];
	skins: Skin[] = [];
	defaultSkin: Skin | null = null;
	events: EventData[] = [];
	animations: Animation[] = [];
	ikConstraints: IkConstraintData[] = [];
	transformConstraints: TransformConstraintData[] = [];
	pathConstraints: PathConstraintData[] = [];
	physicsConstraints: PhysicsConstraintData[] = [];
	x = 0;
	y = 0;
	width = 0;
	height = 0;
	referenceScale = 100;
	version: string | null = null;
	hash: string | null = null;
	fps = 0;
	imagesPath: string | null = null;
	audioPath: string | null = null;

	findBone(name: string): BoneData | null {
		if (!name) throw new Error('boneName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.bones.find((b) => b.name === key) ?? null;
	}

	findSlot(name: string): SlotData | null {
		if (!name) throw new Error('slotName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.slots.find((s) => s.name === key) ?? null;
	}

	findSkin(name: string): Skin | null {
		if (!name) throw new Error('skinName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.skins.find((s) => s.name === key) ?? null;
	}

	findEvent(name: string): EventData | null {
		if (!name) throw new Error('eventDataName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.events.find((e) => e.name === key) ?? null;
	}

	findAnimation(name: string): Animation | null {
		if (!name) throw new Error('animationName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.animations.find((a) => a.name === key) ?? null;
	}

	findIkConstraint(name: string): IkConstraintData | null {
		if (!name) throw new Error('constraintName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.ikConstraints.find((c) => c.name === key) ?? null;
	}

	findTransformConstraint(name: string): TransformConstraintData | null {
		if (!name) throw new Error('constraintName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.transformConstraints.find((c) => c.name === key) ?? null;
	}

	findPathConstraint(name: string): PathConstraintData | null {
		if (!name) throw new Error('constraintName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.pathConstraints.find((c) => c.name === key) ?? null;
	}

	findPhysicsConstraint(name: string): PhysicsConstraintData | null {
		if (!name) throw new Error('constraintName cannot be null.');
		// Compared as strings: skeleton JSON may name a bone or slot with a number.
		const key = String(name);
		return this.physicsConstraints.find((c) => c.name === key) ?? null;
	}
}
