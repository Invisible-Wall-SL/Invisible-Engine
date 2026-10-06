import { signum } from './math';
import { VertexAttachment, SequenceModeValues, SequenceMode, type Attachment } from './attachments';
import type { Inherit } from './data';
import type { Skeleton } from './skeleton';
import type { Slot } from './slot';
import type { Event } from './event';
import type { PhysicsConstraint } from './constraints';
import type { PhysicsConstraintData } from './data';

/** How a timeline's value combines with the current pose. */
export enum MixBlend {
	/** Mix from the setup pose; keys before the first frame show the setup pose. */
	setup = 0,
	/** Like `replace`, but keys before the first frame mix toward the setup pose. */
	first = 1,
	/** Mix from the current pose. */
	replace = 2,
	/** Add the keyed offset from setup to the current pose. */
	add = 3,
}

export enum MixDirection {
	mixIn = 0,
	mixOut = 1,
}

export enum Property {
	rotate = 0,
	x = 1,
	y = 2,
	scaleX = 3,
	scaleY = 4,
	shearX = 5,
	shearY = 6,
	inherit = 7,
	rgb = 8,
	alpha = 9,
	rgb2 = 10,
	attachment = 11,
	deform = 12,
	event = 13,
	drawOrder = 14,
	ikConstraint = 15,
	transformConstraint = 16,
	pathConstraintPosition = 17,
	pathConstraintSpacing = 18,
	pathConstraintMix = 19,
	physicsConstraintInertia = 20,
	physicsConstraintStrength = 21,
	physicsConstraintDamping = 22,
	physicsConstraintMass = 23,
	physicsConstraintWind = 24,
	physicsConstraintGravity = 25,
	physicsConstraintMix = 26,
	physicsConstraintReset = 27,
	sequence = 28,
}

const id = (...parts: Array<number | string>): string => parts.join('|');

export class Animation {
	timelines: Timeline[] = [];
	timelineIds = new Set<string>();

	constructor(
		public name: string,
		timelines: Timeline[],
		public duration: number,
	) {
		if (!name) throw new Error('name cannot be null.');
		this.setTimelines(timelines);
	}

	setTimelines(timelines: Timeline[]): void {
		this.timelines = timelines;
		this.timelineIds.clear();
		for (const t of timelines) for (const pid of t.getPropertyIds()) this.timelineIds.add(pid);
	}

	hasTimeline(ids: string[]): boolean {
		return ids.some((pid) => this.timelineIds.has(pid));
	}

	/** Poses the skeleton at `time`, firing events keyed in (`lastTime`, `time`] into `events`. */
	apply(
		skeleton: Skeleton,
		lastTime: number,
		time: number,
		loop: boolean,
		events: Event[] | null,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		if (!skeleton) throw new Error('skeleton cannot be null.');
		if (loop && this.duration !== 0) {
			time %= this.duration;
			if (lastTime > 0) lastTime %= this.duration;
		}
		for (const timeline of this.timelines)
			timeline.apply(skeleton, lastTime, time, events, alpha, blend, direction);
	}
}

export abstract class Timeline {
	/** Frame times and values. Single precision, so keys land on the same instants as the data's
	 * other readers place them. */
	frames: Float32Array;

	constructor(
		frameCount: number,
		public propertyIds: string[],
	) {
		this.frames = new Float32Array(frameCount * this.getFrameEntries());
	}

	protected put(offset: number, ...values: number[]): void {
		for (let k = 0; k < values.length; k++) this.frames[offset + k] = values[k];
	}

	getPropertyIds(): string[] {
		return this.propertyIds;
	}

	getFrameEntries(): number {
		return 1;
	}

	getFrameCount(): number {
		return this.frames.length / this.getFrameEntries();
	}

	getDuration(): number {
		return this.frames[this.frames.length - this.getFrameEntries()];
	}

	abstract apply(
		skeleton: Skeleton,
		lastTime: number,
		time: number,
		events: Event[] | null,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void;

	/** Index of the last frame whose time is <= `time` (frames hold one entry each). */
	static search1(frames: ArrayLike<number>, time: number): number {
		const n = frames.length;
		for (let i = 1; i < n; i++) if (frames[i] > time) return i - 1;
		return n - 1;
	}

	/** Entry offset of the last frame whose time is <= `time`. */
	static search(frames: ArrayLike<number>, time: number, step: number): number {
		const n = frames.length;
		for (let i = step; i < n; i += step) if (frames[i] > time) return i - step;
		return n - step;
	}
}

const LINEAR = 0;
const STEPPED = 1;
const BEZIER = 2;
/** Samples per bezier segment (t = 0.1 … 0.9); the curve is linear between samples. */
const BEZIER_POINTS = 9;

/** A timeline whose values interpolate between frames, linearly, stepped, or along a bezier. */
export abstract class CurveTimeline extends Timeline {
	/** Per frame: LINEAR, STEPPED or BEZIER. */
	curveTypes: number[];
	/** Per frame and value: the sampled bezier as `x, y` pairs, when the frame is BEZIER. */
	beziers: Array<Float32Array | undefined> = [];

	constructor(frameCount: number, _bezierCount: number, propertyIds: string[]) {
		super(frameCount, propertyIds);
		this.curveTypes = new Array<number>(frameCount).fill(LINEAR);
		// Nothing follows the last frame, so it holds its value.
		if (frameCount > 0) this.curveTypes[frameCount - 1] = STEPPED;
	}

	/** Number of interpolated values per frame. */
	protected valueCount(): number {
		return this.getFrameEntries() - 1;
	}

	setLinear(frame: number): void {
		this.curveTypes[frame] = LINEAR;
	}

	setStepped(frame: number): void {
		this.curveTypes[frame] = STEPPED;
	}

	/** Kept for API compatibility; curve storage is allocated per frame. */
	shrink(_bezierCount: number): void {}

	/** Samples the cubic (time1,value1) (cx1,cy1) (cx2,cy2) (time2,value2) for one value of a frame. */
	setBezier(
		_bezier: number,
		frame: number,
		value: number,
		time1: number,
		value1: number,
		cx1: number,
		cy1: number,
		cx2: number,
		cy2: number,
		time2: number,
		value2: number,
	): void {
		this.curveTypes[frame] = BEZIER;
		const samples = new Float32Array(BEZIER_POINTS * 2);
		for (let k = 1; k <= BEZIER_POINTS; k++) {
			const t = k / 10;
			const u = 1 - t;
			const b0 = u * u * u;
			const b1 = 3 * u * u * t;
			const b2 = 3 * u * t * t;
			const b3 = t * t * t;
			samples[(k - 1) * 2] = b0 * time1 + b1 * cx1 + b2 * cx2 + b3 * time2;
			samples[(k - 1) * 2 + 1] = b0 * value1 + b1 * cy1 + b2 * cy2 + b3 * value2;
		}
		this.beziers[frame * Math.max(1, this.valueCount()) + value] = samples;
	}

	/** Value `value` (0-based) at `time`, given `i`, the entry offset of the frame at or before it. */
	protected valueAt(time: number, i: number, value: number): number {
		const frames = this.frames;
		const entries = this.getFrameEntries();
		const frame = i / entries;
		const v0 = frames[i + 1 + value];
		switch (this.curveTypes[frame]) {
			case LINEAR: {
				const t0 = frames[i];
				const t = (time - t0) / (frames[i + entries] - t0);
				return v0 + (frames[i + entries + 1 + value] - v0) * t;
			}
			case STEPPED:
				return v0;
		}
		return this.bezierValue(time, i, frames[i + 1 + value], frames[i + entries + 1 + value], value);
	}

	protected bezierValue(time: number, i: number, v0: number, v1: number, value: number): number {
		const frames = this.frames;
		const entries = this.getFrameEntries();
		const frame = i / entries;
		const s = this.beziers[frame * Math.max(1, this.valueCount()) + value];
		if (!s) return v0;
		if (s[0] > time) {
			const x = frames[i];
			return v0 + ((time - x) / (s[0] - x)) * (s[1] - v0);
		}
		const n = BEZIER_POINTS * 2;
		for (let k = 2; k < n; k += 2) {
			if (s[k] >= time) {
				const x = s[k - 2];
				const y = s[k - 1];
				return y + ((time - x) / (s[k] - x)) * (s[k + 1] - y);
			}
		}
		const x = s[n - 2];
		const y = s[n - 1];
		return y + ((time - x) / (frames[i + entries] - x)) * (v1 - y);
	}
}

/** One interpolated value per frame. */
export abstract class CurveTimeline1 extends CurveTimeline {
	getFrameEntries(): number {
		return 2;
	}

	setFrame(frame: number, time: number, value: number): void {
		frame <<= 1;
		this.frames[frame] = time;
		this.frames[frame + 1] = value;
	}

	getCurveValue(time: number): number {
		return this.valueAt(time, Timeline.search(this.frames, time, 2), 0);
	}

	/** For values keyed as an offset from setup (rotation, translation, shear). */
	getRelativeValue(
		time: number,
		alpha: number,
		blend: MixBlend,
		current: number,
		setup: number,
	): number {
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) return setup;
			if (blend === MixBlend.first) return current + (setup - current) * alpha;
			return current;
		}
		let value = this.getCurveValue(time);
		if (blend === MixBlend.setup) return setup + value * alpha;
		if (blend === MixBlend.first || blend === MixBlend.replace) value += setup - current;
		return current + value * alpha;
	}

	/** For values keyed as absolutes (mixes, path position/spacing, physics settings). */
	getAbsoluteValue(
		time: number,
		alpha: number,
		blend: MixBlend,
		current: number,
		setup: number,
		value?: number,
	): number {
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) return setup;
			if (blend === MixBlend.first) return current + (setup - current) * alpha;
			return current;
		}
		const v = value === undefined ? this.getCurveValue(time) : value;
		if (blend === MixBlend.setup) return setup + (v - setup) * alpha;
		return current + (v - current) * alpha;
	}

	/** For scale, keyed as a multiple of setup; mixing keeps the sign of the side mixed from. */
	getScaleValue(
		time: number,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
		current: number,
		setup: number,
	): number {
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) return setup;
			if (blend === MixBlend.first) return current + (setup - current) * alpha;
			return current;
		}
		const value = this.getCurveValue(time) * setup;
		if (alpha === 1) return blend === MixBlend.add ? current + value - setup : value;
		if (direction === MixDirection.mixOut) {
			if (blend === MixBlend.setup)
				return setup + (Math.abs(value) * signum(setup) - setup) * alpha;
			if (blend === MixBlend.first || blend === MixBlend.replace)
				return current + (Math.abs(value) * signum(current) - current) * alpha;
		} else {
			if (blend === MixBlend.setup) {
				const s = Math.abs(setup) * signum(value);
				return s + (value - s) * alpha;
			}
			if (blend === MixBlend.first || blend === MixBlend.replace) {
				const s = Math.abs(current) * signum(value);
				return s + (value - s) * alpha;
			}
		}
		return current + (value - setup) * alpha;
	}
}

/** Two interpolated values per frame. */
export abstract class CurveTimeline2 extends CurveTimeline {
	getFrameEntries(): number {
		return 3;
	}

	setFrame(frame: number, time: number, value1: number, value2: number): void {
		frame *= 3;
		this.frames[frame] = time;
		this.frames[frame + 1] = value1;
		this.frames[frame + 2] = value2;
	}

	protected values2(time: number): [number, number] {
		const i = Timeline.search(this.frames, time, 3);
		return [this.valueAt(time, i, 0), this.valueAt(time, i, 1)];
	}
}

export interface BoneTimeline {
	boneIndex: number;
}

export interface SlotTimeline {
	slotIndex: number;
}

export class RotateTimeline extends CurveTimeline1 implements BoneTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public boneIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.rotate, boneIndex)]);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const bone = skeleton.bones[this.boneIndex];
		if (bone.active)
			bone.rotation = this.getRelativeValue(time, alpha, blend, bone.rotation, bone.data.rotation);
	}
}

/** Offset-from-setup pair: translate (x, y) or shear (x, y). */
abstract class RelativePairTimeline extends CurveTimeline2 implements BoneTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public boneIndex: number,
		propertyIds: string[],
		private readonly fields: ['x', 'y'] | ['shearX', 'shearY'],
	) {
		super(frameCount, bezierCount, propertyIds);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const bone = skeleton.bones[this.boneIndex];
		if (!bone.active) return;
		const [fx, fy] = this.fields;
		const setupX = bone.data[fx];
		const setupY = bone.data[fy];
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) {
				bone[fx] = setupX;
				bone[fy] = setupY;
			} else if (blend === MixBlend.first) {
				bone[fx] += (setupX - bone[fx]) * alpha;
				bone[fy] += (setupY - bone[fy]) * alpha;
			}
			return;
		}
		const [x, y] = this.values2(time);
		switch (blend) {
			case MixBlend.setup:
				bone[fx] = setupX + x * alpha;
				bone[fy] = setupY + y * alpha;
				break;
			case MixBlend.first:
			case MixBlend.replace:
				bone[fx] += (setupX + x - bone[fx]) * alpha;
				bone[fy] += (setupY + y - bone[fy]) * alpha;
				break;
			case MixBlend.add:
				bone[fx] += x * alpha;
				bone[fy] += y * alpha;
		}
	}
}

export class TranslateTimeline extends RelativePairTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(frameCount, bezierCount, boneIndex, [id(Property.x, boneIndex), id(Property.y, boneIndex)], ['x', 'y']);
	}
}

export class ShearTimeline extends RelativePairTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(
			frameCount,
			bezierCount,
			boneIndex,
			[id(Property.shearX, boneIndex), id(Property.shearY, boneIndex)],
			['shearX', 'shearY'],
		);
	}
}

type BoneField = 'x' | 'y' | 'shearX' | 'shearY' | 'scaleX' | 'scaleY';

abstract class BoneValueTimeline extends CurveTimeline1 implements BoneTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public boneIndex: number,
		property: Property,
		protected readonly field: BoneField,
	) {
		super(frameCount, bezierCount, [id(property, boneIndex)]);
	}
}

abstract class RelativeValueTimeline extends BoneValueTimeline {
	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const bone = skeleton.bones[this.boneIndex];
		if (bone.active)
			bone[this.field] = this.getRelativeValue(time, alpha, blend, bone[this.field], bone.data[this.field]);
	}
}

export class TranslateXTimeline extends RelativeValueTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(frameCount, bezierCount, boneIndex, Property.x, 'x');
	}
}

export class TranslateYTimeline extends RelativeValueTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(frameCount, bezierCount, boneIndex, Property.y, 'y');
	}
}

export class ShearXTimeline extends RelativeValueTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(frameCount, bezierCount, boneIndex, Property.shearX, 'shearX');
	}
}

export class ShearYTimeline extends RelativeValueTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(frameCount, bezierCount, boneIndex, Property.shearY, 'shearY');
	}
}

export class ScaleTimeline extends CurveTimeline2 implements BoneTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public boneIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.scaleX, boneIndex), id(Property.scaleY, boneIndex)]);
	}

	apply(
		skeleton: Skeleton,
		_l: number,
		time: number,
		_e: Event[] | null,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		const bone = skeleton.bones[this.boneIndex];
		if (!bone.active) return;
		const data = bone.data;
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) {
				bone.scaleX = data.scaleX;
				bone.scaleY = data.scaleY;
			} else if (blend === MixBlend.first) {
				bone.scaleX += (data.scaleX - bone.scaleX) * alpha;
				bone.scaleY += (data.scaleY - bone.scaleY) * alpha;
			}
			return;
		}
		const [kx, ky] = this.values2(time);
		const x = kx * data.scaleX;
		const y = ky * data.scaleY;
		if (alpha === 1) {
			if (blend === MixBlend.add) {
				bone.scaleX += x - data.scaleX;
				bone.scaleY += y - data.scaleY;
			} else {
				bone.scaleX = x;
				bone.scaleY = y;
			}
			return;
		}
		if (blend === MixBlend.add) {
			bone.scaleX += (x - data.scaleX) * alpha;
			bone.scaleY += (y - data.scaleY) * alpha;
			return;
		}
		if (direction === MixDirection.mixOut) {
			const bx = blend === MixBlend.setup ? data.scaleX : bone.scaleX;
			const by = blend === MixBlend.setup ? data.scaleY : bone.scaleY;
			bone.scaleX = bx + (Math.abs(x) * signum(bx) - bx) * alpha;
			bone.scaleY = by + (Math.abs(y) * signum(by) - by) * alpha;
		} else {
			const fromX = blend === MixBlend.setup ? data.scaleX : bone.scaleX;
			const fromY = blend === MixBlend.setup ? data.scaleY : bone.scaleY;
			const bx = Math.abs(fromX) * signum(x);
			const by = Math.abs(fromY) * signum(y);
			bone.scaleX = bx + (x - bx) * alpha;
			bone.scaleY = by + (y - by) * alpha;
		}
	}
}

abstract class ScaleValueTimeline extends BoneValueTimeline {
	apply(
		skeleton: Skeleton,
		_l: number,
		time: number,
		_e: Event[] | null,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		const bone = skeleton.bones[this.boneIndex];
		if (bone.active)
			bone[this.field] = this.getScaleValue(
				time,
				alpha,
				blend,
				direction,
				bone[this.field],
				bone.data[this.field],
			);
	}
}

export class ScaleXTimeline extends ScaleValueTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(frameCount, bezierCount, boneIndex, Property.scaleX, 'scaleX');
	}
}

export class ScaleYTimeline extends ScaleValueTimeline {
	constructor(frameCount: number, bezierCount: number, boneIndex: number) {
		super(frameCount, bezierCount, boneIndex, Property.scaleY, 'scaleY');
	}
}

export class InheritTimeline extends Timeline implements BoneTimeline {
	constructor(
		frameCount: number,
		public boneIndex: number,
	) {
		super(frameCount, [id(Property.inherit, boneIndex)]);
	}

	getFrameEntries(): number {
		return 2;
	}

	setFrame(frame: number, time: number, inherit: Inherit): void {
		frame *= 2;
		this.frames[frame] = time;
		this.frames[frame + 1] = inherit;
	}

	apply(
		skeleton: Skeleton,
		_l: number,
		time: number,
		_e: Event[] | null,
		_alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		const bone = skeleton.bones[this.boneIndex];
		if (!bone.active) return;
		if (direction === MixDirection.mixOut) {
			if (blend === MixBlend.setup) bone.inherit = bone.data.inherit;
			return;
		}
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup || blend === MixBlend.first) bone.inherit = bone.data.inherit;
			return;
		}
		bone.inherit = this.frames[Timeline.search(this.frames, time, 2) + 1] as Inherit;
	}
}

/** Light color as r, g, b, a. */
export class RGBATimeline extends CurveTimeline implements SlotTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public slotIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.rgb, slotIndex), id(Property.alpha, slotIndex)]);
	}

	getFrameEntries(): number {
		return 5;
	}

	setFrame(frame: number, time: number, r: number, g: number, b: number, a: number): void {
		frame *= 5;
		this.put(frame, time, r, g, b, a);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		const color = slot.color;
		const setup = slot.data.color;
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) color.setFromColor(setup);
			else if (blend === MixBlend.first)
				color.add(
					(setup.r - color.r) * alpha,
					(setup.g - color.g) * alpha,
					(setup.b - color.b) * alpha,
					(setup.a - color.a) * alpha,
				);
			return;
		}
		const i = Timeline.search(this.frames, time, 5);
		const r = this.valueAt(time, i, 0);
		const g = this.valueAt(time, i, 1);
		const b = this.valueAt(time, i, 2);
		const a = this.valueAt(time, i, 3);
		if (alpha === 1) color.set(r, g, b, a);
		else {
			if (blend === MixBlend.setup) color.setFromColor(setup);
			color.add((r - color.r) * alpha, (g - color.g) * alpha, (b - color.b) * alpha, (a - color.a) * alpha);
		}
	}
}

/** Light color as r, g, b (alpha untouched). */
export class RGBTimeline extends CurveTimeline implements SlotTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public slotIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.rgb, slotIndex)]);
	}

	getFrameEntries(): number {
		return 4;
	}

	setFrame(frame: number, time: number, r: number, g: number, b: number): void {
		frame *= 4;
		this.put(frame, time, r, g, b);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		const color = slot.color;
		const setup = slot.data.color;
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) {
				color.r = setup.r;
				color.g = setup.g;
				color.b = setup.b;
			} else if (blend === MixBlend.first) {
				color.r += (setup.r - color.r) * alpha;
				color.g += (setup.g - color.g) * alpha;
				color.b += (setup.b - color.b) * alpha;
			}
			return;
		}
		const i = Timeline.search(this.frames, time, 4);
		const r = this.valueAt(time, i, 0);
		const g = this.valueAt(time, i, 1);
		const b = this.valueAt(time, i, 2);
		if (alpha === 1) {
			color.r = r;
			color.g = g;
			color.b = b;
		} else {
			if (blend === MixBlend.setup) {
				color.r = setup.r;
				color.g = setup.g;
				color.b = setup.b;
			}
			color.r += (r - color.r) * alpha;
			color.g += (g - color.g) * alpha;
			color.b += (b - color.b) * alpha;
		}
	}
}

export class AlphaTimeline extends CurveTimeline1 implements SlotTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public slotIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.alpha, slotIndex)]);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		const color = slot.color;
		const setup = slot.data.color;
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) color.a = setup.a;
			else if (blend === MixBlend.first) color.a += (setup.a - color.a) * alpha;
			return;
		}
		const a = this.getCurveValue(time);
		if (alpha === 1) color.a = a;
		else {
			if (blend === MixBlend.setup) color.a = setup.a;
			color.a += (a - color.a) * alpha;
		}
	}
}

/** Light r, g, b, a plus dark r, g, b (two-color tint). */
export class RGBA2Timeline extends CurveTimeline implements SlotTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public slotIndex: number,
	) {
		super(frameCount, bezierCount, [
			id(Property.rgb, slotIndex),
			id(Property.alpha, slotIndex),
			id(Property.rgb2, slotIndex),
		]);
	}

	getFrameEntries(): number {
		return 8;
	}

	setFrame(
		frame: number,
		time: number,
		r: number,
		g: number,
		b: number,
		a: number,
		r2: number,
		g2: number,
		b2: number,
	): void {
		frame *= 8;
		this.put(frame, time, r, g, b, a, r2, g2, b2);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		const light = slot.color;
		const dark = slot.darkColor;
		const setupLight = slot.data.color;
		const setupDark = slot.data.darkColor;
		if (!dark || !setupDark) return;
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) {
				light.setFromColor(setupLight);
				dark.r = setupDark.r;
				dark.g = setupDark.g;
				dark.b = setupDark.b;
			} else if (blend === MixBlend.first) {
				light.add(
					(setupLight.r - light.r) * alpha,
					(setupLight.g - light.g) * alpha,
					(setupLight.b - light.b) * alpha,
					(setupLight.a - light.a) * alpha,
				);
				dark.r += (setupDark.r - dark.r) * alpha;
				dark.g += (setupDark.g - dark.g) * alpha;
				dark.b += (setupDark.b - dark.b) * alpha;
			}
			return;
		}
		const i = Timeline.search(this.frames, time, 8);
		const v = [0, 1, 2, 3, 4, 5, 6].map((k) => this.valueAt(time, i, k));
		if (alpha === 1) {
			light.set(v[0], v[1], v[2], v[3]);
			dark.r = v[4];
			dark.g = v[5];
			dark.b = v[6];
		} else {
			if (blend === MixBlend.setup) {
				light.setFromColor(setupLight);
				dark.r = setupDark.r;
				dark.g = setupDark.g;
				dark.b = setupDark.b;
			}
			light.add((v[0] - light.r) * alpha, (v[1] - light.g) * alpha, (v[2] - light.b) * alpha, (v[3] - light.a) * alpha);
			dark.r += (v[4] - dark.r) * alpha;
			dark.g += (v[5] - dark.g) * alpha;
			dark.b += (v[6] - dark.b) * alpha;
		}
	}
}

/** Light r, g, b plus dark r, g, b. */
export class RGB2Timeline extends CurveTimeline implements SlotTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public slotIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.rgb, slotIndex), id(Property.rgb2, slotIndex)]);
	}

	getFrameEntries(): number {
		return 7;
	}

	setFrame(frame: number, time: number, r: number, g: number, b: number, r2: number, g2: number, b2: number): void {
		frame *= 7;
		this.put(frame, time, r, g, b, r2, g2, b2);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		const light = slot.color;
		const dark = slot.darkColor;
		const setupLight = slot.data.color;
		const setupDark = slot.data.darkColor;
		if (!dark || !setupDark) return;
		const assignSetup = (): void => {
			light.r = setupLight.r;
			light.g = setupLight.g;
			light.b = setupLight.b;
			dark.r = setupDark.r;
			dark.g = setupDark.g;
			dark.b = setupDark.b;
		};
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) assignSetup();
			else if (blend === MixBlend.first) {
				light.r += (setupLight.r - light.r) * alpha;
				light.g += (setupLight.g - light.g) * alpha;
				light.b += (setupLight.b - light.b) * alpha;
				dark.r += (setupDark.r - dark.r) * alpha;
				dark.g += (setupDark.g - dark.g) * alpha;
				dark.b += (setupDark.b - dark.b) * alpha;
			}
			return;
		}
		const i = Timeline.search(this.frames, time, 7);
		const v = [0, 1, 2, 3, 4, 5].map((k) => this.valueAt(time, i, k));
		if (alpha === 1) {
			light.r = v[0];
			light.g = v[1];
			light.b = v[2];
			dark.r = v[3];
			dark.g = v[4];
			dark.b = v[5];
		} else {
			if (blend === MixBlend.setup) assignSetup();
			light.r += (v[0] - light.r) * alpha;
			light.g += (v[1] - light.g) * alpha;
			light.b += (v[2] - light.b) * alpha;
			dark.r += (v[3] - dark.r) * alpha;
			dark.g += (v[4] - dark.g) * alpha;
			dark.b += (v[5] - dark.b) * alpha;
		}
	}
}

export class AttachmentTimeline extends Timeline implements SlotTimeline {
	attachmentNames: Array<string | null>;

	constructor(
		frameCount: number,
		public slotIndex: number,
	) {
		super(frameCount, [id(Property.attachment, slotIndex)]);
		this.attachmentNames = new Array<string | null>(frameCount).fill(null);
	}

	setFrame(frame: number, time: number, attachmentName: string | null): void {
		this.frames[frame] = time;
		this.attachmentNames[frame] = attachmentName;
	}

	apply(
		skeleton: Skeleton,
		_l: number,
		time: number,
		_e: Event[] | null,
		_alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		if (direction === MixDirection.mixOut) {
			if (blend === MixBlend.setup) this.setAttachment(skeleton, slot, slot.data.attachmentName);
			return;
		}
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup || blend === MixBlend.first)
				this.setAttachment(skeleton, slot, slot.data.attachmentName);
			return;
		}
		this.setAttachment(skeleton, slot, this.attachmentNames[Timeline.search1(this.frames, time)]);
	}

	setAttachment(skeleton: Skeleton, slot: Slot, name: string | null): void {
		slot.setAttachment(name ? skeleton.getAttachment(this.slotIndex, name) : null);
	}
}

/** Keyed vertex positions of one vertex attachment. */
export class DeformTimeline extends CurveTimeline implements SlotTimeline {
	vertices: NumberArray[];

	constructor(
		frameCount: number,
		bezierCount: number,
		public slotIndex: number,
		public attachment: VertexAttachment,
	) {
		super(frameCount, bezierCount, [id(Property.deform, slotIndex, attachment.id)]);
		this.vertices = new Array<NumberArray>(frameCount);
	}

	getFrameCount(): number {
		return this.frames.length;
	}

	protected valueCount(): number {
		return 1;
	}

	setFrame(frame: number, time: number, vertices: NumberArray): void {
		this.frames[frame] = time;
		this.vertices[frame] = vertices;
	}

	/** Interpolation fraction between `frame` and the next, through the frame's curve. */
	getCurvePercent(time: number, frame: number): number {
		const frames = this.frames;
		switch (this.curveTypes[frame]) {
			case LINEAR: {
				const x = frames[frame];
				return (time - x) / (frames[frame + 1] - x);
			}
			case STEPPED:
				return 0;
		}
		const s = this.beziers[frame];
		if (!s) return 0;
		if (s[0] > time) {
			const x = frames[frame];
			return (s[1] * (time - x)) / (s[0] - x);
		}
		const n = BEZIER_POINTS * 2;
		for (let k = 2; k < n; k += 2) {
			if (s[k] >= time) {
				const x = s[k - 2];
				const y = s[k - 1];
				return y + ((time - x) / (s[k] - x)) * (s[k + 1] - y);
			}
		}
		const x = s[n - 2];
		const y = s[n - 1];
		return y + ((1 - y) * (time - x)) / (frames[frame + 1] - x);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		const current = slot.getAttachment();
		if (!(current instanceof VertexAttachment) || current.timelineAttachment !== this.attachment) return;
		const deform = slot.deform;
		if (deform.length === 0) blend = MixBlend.setup;
		const keyed = this.vertices;
		const count = keyed[0].length;
		const frames = this.frames;
		const setupVertices = current.bones ? null : current.vertices;

		if (time < frames[0]) {
			if (blend === MixBlend.setup) deform.length = 0;
			else if (blend === MixBlend.first) {
				if (alpha === 1) {
					deform.length = 0;
					return;
				}
				deform.length = count;
				if (setupVertices)
					for (let i = 0; i < count; i++) deform[i] += (setupVertices[i] - deform[i]) * alpha;
				else {
					const keep = 1 - alpha;
					for (let i = 0; i < count; i++) deform[i] *= keep;
				}
			}
			return;
		}

		deform.length = count;
		let sample: (i: number) => number;
		if (time >= frames[frames.length - 1]) {
			const last = keyed[frames.length - 1];
			sample = (i) => last[i];
		} else {
			const frame = Timeline.search1(frames, time);
			const percent = this.getCurvePercent(time, frame);
			const prev = keyed[frame];
			const next = keyed[frame + 1];
			sample = (i) => prev[i] + (next[i] - prev[i]) * percent;
		}

		if (alpha === 1) {
			if (blend === MixBlend.add) {
				if (setupVertices) for (let i = 0; i < count; i++) deform[i] += sample(i) - setupVertices[i];
				else for (let i = 0; i < count; i++) deform[i] += sample(i);
			} else for (let i = 0; i < count; i++) deform[i] = sample(i);
			return;
		}
		switch (blend) {
			case MixBlend.setup:
				if (setupVertices)
					for (let i = 0; i < count; i++) {
						const s = setupVertices[i];
						deform[i] = s + (sample(i) - s) * alpha;
					}
				else for (let i = 0; i < count; i++) deform[i] = sample(i) * alpha;
				break;
			case MixBlend.first:
			case MixBlend.replace:
				for (let i = 0; i < count; i++) deform[i] += (sample(i) - deform[i]) * alpha;
				break;
			case MixBlend.add:
				if (setupVertices)
					for (let i = 0; i < count; i++) deform[i] += (sample(i) - setupVertices[i]) * alpha;
				else for (let i = 0; i < count; i++) deform[i] += sample(i) * alpha;
		}
	}
}

type NumberArray = number[] | Float32Array;

/** Which image of a sequence shows, and how it advances. */
export class SequenceTimeline extends Timeline implements SlotTimeline {
	constructor(
		frameCount: number,
		public slotIndex: number,
		public attachment: Attachment & { sequence: { id: number; regions: unknown[] } | null },
	) {
		super(frameCount, [id(Property.sequence, slotIndex, attachment.sequence?.id ?? -1)]);
	}

	getFrameEntries(): number {
		return 3;
	}

	getSlotIndex(): number {
		return this.slotIndex;
	}

	getAttachment(): Attachment {
		return this.attachment;
	}

	setFrame(frame: number, time: number, mode: SequenceMode, index: number, delay: number): void {
		frame *= 3;
		this.frames[frame] = time;
		this.frames[frame + 1] = mode | (index << 4);
		this.frames[frame + 2] = delay;
	}

	apply(
		skeleton: Skeleton,
		_l: number,
		time: number,
		_e: Event[] | null,
		_alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		const slot = skeleton.slots[this.slotIndex];
		if (!slot.bone.active) return;
		const current = slot.attachment;
		const attachment = this.attachment;
		if (
			current !== attachment &&
			(!(current instanceof VertexAttachment) || current.timelineAttachment !== attachment)
		)
			return;
		if (direction === MixDirection.mixOut) {
			if (blend === MixBlend.setup) slot.sequenceIndex = -1;
			return;
		}
		const frames = this.frames;
		if (time < frames[0]) {
			if (blend === MixBlend.setup || blend === MixBlend.first) slot.sequenceIndex = -1;
			return;
		}
		const i = Timeline.search(frames, time, 3);
		const before = frames[i];
		const modeAndIndex = frames[i + 1];
		const delay = frames[i + 2];
		const sequence = attachment.sequence;
		if (!sequence) return;
		let index = modeAndIndex >> 4;
		const count = sequence.regions.length;
		const mode = SequenceModeValues[modeAndIndex & 0xf];
		if (mode !== SequenceMode.hold) {
			index += ((time - before) / delay + 0.00001) | 0;
			const span = (count << 1) - 2;
			switch (mode) {
				case SequenceMode.once:
					index = Math.min(count - 1, index);
					break;
				case SequenceMode.loop:
					index %= count;
					break;
				case SequenceMode.pingpong:
					index = span === 0 ? 0 : index % span;
					if (index >= count) index = span - index;
					break;
				case SequenceMode.onceReverse:
					index = Math.max(count - 1 - index, 0);
					break;
				case SequenceMode.loopReverse:
					index = count - 1 - (index % count);
					break;
				case SequenceMode.pingpongReverse:
					index = span === 0 ? 0 : (index + count - 1) % span;
					if (index >= count) index = span - index;
			}
		}
		slot.sequenceIndex = index;
	}
}

export class EventTimeline extends Timeline {
	events: Event[];

	constructor(frameCount: number) {
		super(frameCount, [String(Property.event)]);
		this.events = new Array<Event>(frameCount);
	}

	setFrame(frame: number, event: Event): void {
		this.frames[frame] = event.time;
		this.events[frame] = event;
	}

	/** Fires the events keyed in (`lastTime`, `time`]; a wrapped loop fires the tail, then the head. */
	apply(
		skeleton: Skeleton,
		lastTime: number,
		time: number,
		firedEvents: Event[] | null,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		if (!firedEvents) return;
		const frames = this.frames;
		const count = frames.length;
		if (lastTime > time) {
			this.apply(skeleton, lastTime, Number.MAX_VALUE, firedEvents, alpha, blend, direction);
			lastTime = -1;
		} else if (lastTime >= frames[count - 1]) return;
		if (time < frames[0]) return;
		let i: number;
		if (lastTime < frames[0]) i = 0;
		else {
			i = Timeline.search1(frames, lastTime) + 1;
			const frameTime = frames[i];
			while (i > 0 && frames[i - 1] === frameTime) i--;
		}
		for (; i < count && time >= frames[i]; i++) firedEvents.push(this.events[i]);
	}
}

export class DrawOrderTimeline extends Timeline {
	/** Per frame: draw order position → slot index, or null for the setup order. */
	drawOrders: Array<number[] | null>;

	constructor(frameCount: number) {
		super(frameCount, [String(Property.drawOrder)]);
		this.drawOrders = new Array<number[] | null>(frameCount).fill(null);
	}

	setFrame(frame: number, time: number, drawOrder: number[] | null): void {
		this.frames[frame] = time;
		this.drawOrders[frame] = drawOrder;
	}

	apply(
		skeleton: Skeleton,
		_l: number,
		time: number,
		_e: Event[] | null,
		_alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		const setupOrder = (): void => {
			for (let i = 0; i < skeleton.slots.length; i++) skeleton.drawOrder[i] = skeleton.slots[i];
		};
		if (direction === MixDirection.mixOut) {
			if (blend === MixBlend.setup) setupOrder();
			return;
		}
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup || blend === MixBlend.first) setupOrder();
			return;
		}
		const order = this.drawOrders[Timeline.search1(this.frames, time)];
		if (!order) setupOrder();
		else for (let i = 0; i < order.length; i++) skeleton.drawOrder[i] = skeleton.slots[order[i]];
	}
}

export interface ConstraintTimeline {
	constraintIndex: number;
}

export class IkConstraintTimeline extends CurveTimeline implements ConstraintTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public constraintIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.ikConstraint, constraintIndex)]);
	}

	getFrameEntries(): number {
		return 6;
	}

	/** Two of the five values (mix, softness) interpolate; the rest are held. */
	protected valueCount(): number {
		return 2;
	}

	setFrame(
		frame: number,
		time: number,
		mix: number,
		softness: number,
		bendDirection: number,
		compress: boolean,
		stretch: boolean,
	): void {
		frame *= 6;
		this.put(frame, time, mix, softness, bendDirection, compress ? 1 : 0, stretch ? 1 : 0);
	}

	apply(
		skeleton: Skeleton,
		_l: number,
		time: number,
		_e: Event[] | null,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		const c = skeleton.ikConstraints[this.constraintIndex];
		if (!c.active) return;
		const data = c.data;
		const frames = this.frames;
		if (time < frames[0]) {
			if (blend === MixBlend.setup) {
				c.mix = data.mix;
				c.softness = data.softness;
				c.bendDirection = data.bendDirection;
				c.compress = data.compress;
				c.stretch = data.stretch;
			} else if (blend === MixBlend.first) {
				c.mix += (data.mix - c.mix) * alpha;
				c.softness += (data.softness - c.softness) * alpha;
				c.bendDirection = data.bendDirection;
				c.compress = data.compress;
				c.stretch = data.stretch;
			}
			return;
		}
		const i = Timeline.search(frames, time, 6);
		const mix = this.valueAt6(time, i, 0);
		const softness = this.valueAt6(time, i, 1);
		if (blend === MixBlend.setup) {
			c.mix = data.mix + (mix - data.mix) * alpha;
			c.softness = data.softness + (softness - data.softness) * alpha;
			if (direction === MixDirection.mixOut) {
				c.bendDirection = data.bendDirection;
				c.compress = data.compress;
				c.stretch = data.stretch;
			} else {
				c.bendDirection = frames[i + 3];
				c.compress = frames[i + 4] !== 0;
				c.stretch = frames[i + 5] !== 0;
			}
		} else {
			c.mix += (mix - c.mix) * alpha;
			c.softness += (softness - c.softness) * alpha;
			if (direction === MixDirection.mixIn) {
				c.bendDirection = frames[i + 3];
				c.compress = frames[i + 4] !== 0;
				c.stretch = frames[i + 5] !== 0;
			}
		}
	}

	private valueAt6(time: number, i: number, value: number): number {
		return this.valueAt(time, i, value);
	}
}

export class TransformConstraintTimeline extends CurveTimeline implements ConstraintTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public constraintIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.transformConstraint, constraintIndex)]);
	}

	getFrameEntries(): number {
		return 7;
	}

	setFrame(
		frame: number,
		time: number,
		mixRotate: number,
		mixX: number,
		mixY: number,
		mixScaleX: number,
		mixScaleY: number,
		mixShearY: number,
	): void {
		frame *= 7;
		this.put(frame, time, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const c = skeleton.transformConstraints[this.constraintIndex];
		if (!c.active) return;
		const data = c.data;
		const keys = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'] as const;
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) for (const k of keys) c[k] = data[k];
			else if (blend === MixBlend.first) for (const k of keys) c[k] += (data[k] - c[k]) * alpha;
			return;
		}
		const i = Timeline.search(this.frames, time, 7);
		keys.forEach((k, v) => {
			const value = this.valueAt(time, i, v);
			if (blend === MixBlend.setup) c[k] = data[k] + (value - data[k]) * alpha;
			else c[k] += (value - c[k]) * alpha;
		});
	}
}

export class PathConstraintPositionTimeline extends CurveTimeline1 implements ConstraintTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public constraintIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.pathConstraintPosition, constraintIndex)]);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const c = skeleton.pathConstraints[this.constraintIndex];
		if (c.active) c.position = this.getAbsoluteValue(time, alpha, blend, c.position, c.data.position);
	}
}

export class PathConstraintSpacingTimeline extends CurveTimeline1 implements ConstraintTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public constraintIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.pathConstraintSpacing, constraintIndex)]);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const c = skeleton.pathConstraints[this.constraintIndex];
		if (c.active) c.spacing = this.getAbsoluteValue(time, alpha, blend, c.spacing, c.data.spacing);
	}
}

export class PathConstraintMixTimeline extends CurveTimeline implements ConstraintTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public constraintIndex: number,
	) {
		super(frameCount, bezierCount, [id(Property.pathConstraintMix, constraintIndex)]);
	}

	getFrameEntries(): number {
		return 4;
	}

	setFrame(frame: number, time: number, mixRotate: number, mixX: number, mixY: number): void {
		frame *= 4;
		this.put(frame, time, mixRotate, mixX, mixY);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		const c = skeleton.pathConstraints[this.constraintIndex];
		if (!c.active) return;
		const data = c.data;
		const keys = ['mixRotate', 'mixX', 'mixY'] as const;
		if (time < this.frames[0]) {
			if (blend === MixBlend.setup) for (const k of keys) c[k] = data[k];
			else if (blend === MixBlend.first) for (const k of keys) c[k] += (data[k] - c[k]) * alpha;
			return;
		}
		const i = Timeline.search(this.frames, time, 4);
		keys.forEach((k, v) => {
			const value = this.valueAt(time, i, v);
			if (blend === MixBlend.setup) c[k] = data[k] + (value - data[k]) * alpha;
			else c[k] += (value - c[k]) * alpha;
		});
	}
}

type PhysicsField = 'inertia' | 'strength' | 'damping' | 'wind' | 'gravity' | 'mix' | 'mass';

/** Keys one physics setting of one constraint, or (index -1) of every constraint that has the
 * setting marked global. */
export abstract class PhysicsConstraintTimeline extends CurveTimeline1 implements ConstraintTimeline {
	constructor(
		frameCount: number,
		bezierCount: number,
		public constraintIndex: number,
		property: Property,
		private readonly field: PhysicsField,
	) {
		super(frameCount, bezierCount, [id(property, constraintIndex)]);
	}

	apply(skeleton: Skeleton, _l: number, time: number, _e: Event[] | null, alpha: number, blend: MixBlend): void {
		if (this.constraintIndex === -1) {
			const value = time >= this.frames[0] ? this.getCurveValue(time) : 0;
			for (const c of skeleton.physicsConstraints)
				if (c.active && this.global(c.data))
					this.set(c, this.getAbsoluteValue(time, alpha, blend, this.get(c), this.setup(c), value));
			return;
		}
		const c = skeleton.physicsConstraints[this.constraintIndex];
		if (c.active) this.set(c, this.getAbsoluteValue(time, alpha, blend, this.get(c), this.setup(c)));
	}

	private get(c: PhysicsConstraint): number {
		return this.field === 'mass' ? 1 / c.massInverse : c[this.field];
	}

	private set(c: PhysicsConstraint, value: number): void {
		if (this.field === 'mass') c.massInverse = 1 / value;
		else c[this.field] = value;
	}

	private setup(c: PhysicsConstraint): number {
		return this.field === 'mass' ? 1 / c.data.massInverse : c.data[this.field];
	}

	private global(data: PhysicsConstraintData): boolean {
		return data[`${this.field}Global`];
	}
}

export class PhysicsConstraintInertiaTimeline extends PhysicsConstraintTimeline {
	constructor(frameCount: number, bezierCount: number, constraintIndex: number) {
		super(frameCount, bezierCount, constraintIndex, Property.physicsConstraintInertia, 'inertia');
	}
}

export class PhysicsConstraintStrengthTimeline extends PhysicsConstraintTimeline {
	constructor(frameCount: number, bezierCount: number, constraintIndex: number) {
		super(frameCount, bezierCount, constraintIndex, Property.physicsConstraintStrength, 'strength');
	}
}

export class PhysicsConstraintDampingTimeline extends PhysicsConstraintTimeline {
	constructor(frameCount: number, bezierCount: number, constraintIndex: number) {
		super(frameCount, bezierCount, constraintIndex, Property.physicsConstraintDamping, 'damping');
	}
}

export class PhysicsConstraintMassTimeline extends PhysicsConstraintTimeline {
	constructor(frameCount: number, bezierCount: number, constraintIndex: number) {
		super(frameCount, bezierCount, constraintIndex, Property.physicsConstraintMass, 'mass');
	}
}

export class PhysicsConstraintWindTimeline extends PhysicsConstraintTimeline {
	constructor(frameCount: number, bezierCount: number, constraintIndex: number) {
		super(frameCount, bezierCount, constraintIndex, Property.physicsConstraintWind, 'wind');
	}
}

export class PhysicsConstraintGravityTimeline extends PhysicsConstraintTimeline {
	constructor(frameCount: number, bezierCount: number, constraintIndex: number) {
		super(frameCount, bezierCount, constraintIndex, Property.physicsConstraintGravity, 'gravity');
	}
}

export class PhysicsConstraintMixTimeline extends PhysicsConstraintTimeline {
	constructor(frameCount: number, bezierCount: number, constraintIndex: number) {
		super(frameCount, bezierCount, constraintIndex, Property.physicsConstraintMix, 'mix');
	}
}

export class PhysicsConstraintResetTimeline extends Timeline implements ConstraintTimeline {
	constructor(
		frameCount: number,
		public constraintIndex: number,
	) {
		super(frameCount, [String(Property.physicsConstraintReset)]);
	}

	setFrame(frame: number, time: number): void {
		this.frames[frame] = time;
	}

	apply(
		skeleton: Skeleton,
		lastTime: number,
		time: number,
		firedEvents: Event[] | null,
		alpha: number,
		blend: MixBlend,
		direction: MixDirection,
	): void {
		let constraint: PhysicsConstraint | null = null;
		if (this.constraintIndex !== -1) {
			constraint = skeleton.physicsConstraints[this.constraintIndex];
			if (!constraint.active) return;
		}
		const frames = this.frames;
		if (lastTime > time) {
			this.apply(skeleton, lastTime, Number.MAX_VALUE, [], alpha, blend, direction);
			lastTime = -1;
		} else if (lastTime >= frames[frames.length - 1]) return;
		if (time < frames[0]) return;
		if (lastTime < frames[0] || time >= frames[Timeline.search1(frames, lastTime) + 1]) {
			if (constraint) constraint.reset();
			else for (const c of skeleton.physicsConstraints) if (c.active) c.reset();
		}
	}
}
