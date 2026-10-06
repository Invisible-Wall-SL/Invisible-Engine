import { DEG_RAD, RAD_DEG, PI, PI2, Vector2, signum, wrapRadians } from './math';
import {
	Inherit,
	PositionMode,
	RotateMode,
	SpacingMode,
	type IkConstraintData,
	type PathConstraintData,
	type PhysicsConstraintData,
	type TransformConstraintData,
} from './data';
import { PathAttachment } from './attachments';
import { Physics } from './physics';
import type { Bone } from './bone';
import type { Slot } from './slot';
import type { Skeleton } from './skeleton';

export interface Updatable {
	isActive(): boolean;
	update(physics: Physics): void;
}

const wrapDegrees = (r: number): number => (r > 180 ? r - 360 : r < -180 ? r + 360 : r);

export class IkConstraint implements Updatable {
	bones: Bone[];
	target: Bone;
	bendDirection = 0;
	compress = false;
	stretch = false;
	mix = 1;
	softness = 0;
	active = false;

	constructor(
		public data: IkConstraintData,
		skeleton: Skeleton,
	) {
		this.bones = data.bones.map((b) => skeleton.bones[b.index]);
		this.target = skeleton.bones[data.target.index];
		this.setToSetupPose();
	}

	isActive(): boolean {
		return this.active;
	}

	setToSetupPose(): void {
		const d = this.data;
		this.mix = d.mix;
		this.softness = d.softness;
		this.bendDirection = d.bendDirection;
		this.compress = d.compress;
		this.stretch = d.stretch;
	}

	update(_physics: Physics): void {
		if (this.mix === 0) return;
		const { target, bones } = this;
		if (bones.length === 1)
			this.apply1(
				bones[0],
				target.worldX,
				target.worldY,
				this.compress,
				this.stretch,
				this.data.uniform,
				this.mix,
			);
		else if (bones.length === 2)
			this.apply2(
				bones[0],
				bones[1],
				target.worldX,
				target.worldY,
				this.bendDirection,
				this.stretch,
				this.data.uniform,
				this.softness,
				this.mix,
			);
	}

	/** Rotates one bone to point at the target. */
	apply1(
		bone: Bone,
		targetX: number,
		targetY: number,
		compress: boolean,
		stretch: boolean,
		uniform: boolean,
		alpha: number,
	): void {
		const p = bone.parent;
		if (!p) throw new Error('IK bone must have parent.');
		const skeleton = bone.skeleton;
		let pa = p.a;
		let pb = p.b;
		const pc = p.c;
		let pd = p.d;
		let rotationIK = -bone.ashearX - bone.arotation;
		let tx = 0;
		let ty = 0;
		if (bone.inherit === Inherit.OnlyTranslation) {
			tx = (targetX - bone.worldX) * signum(skeleton.scaleX);
			ty = (targetY - bone.worldY) * signum(skeleton.scaleY);
		} else {
			if (bone.inherit === Inherit.NoRotationOrReflection) {
				const s = Math.abs(pa * pd - pb * pc) / Math.max(0.0001, pa * pa + pc * pc);
				const sa = pa / skeleton.scaleX;
				const sc = pc / skeleton.scaleY;
				pb = -sc * s * skeleton.scaleX;
				pd = sa * s * skeleton.scaleY;
				rotationIK += Math.atan2(sc, sa) * RAD_DEG;
			}
			const x = targetX - p.worldX;
			const y = targetY - p.worldY;
			const det = pa * pd - pb * pc;
			if (Math.abs(det) > 0.0001) {
				tx = (x * pd - y * pb) / det - bone.ax;
				ty = (y * pa - x * pc) / det - bone.ay;
			}
		}
		rotationIK += Math.atan2(ty, tx) * RAD_DEG;
		if (bone.ascaleX < 0) rotationIK += 180;
		rotationIK = wrapDegrees(rotationIK);
		let sx = bone.ascaleX;
		let sy = bone.ascaleY;
		if (compress || stretch) {
			if (bone.inherit === Inherit.NoScale || bone.inherit === Inherit.NoScaleOrReflection) {
				tx = targetX - bone.worldX;
				ty = targetY - bone.worldY;
			}
			const b = bone.data.length * sx;
			if (b > 0.0001) {
				const dd = tx * tx + ty * ty;
				if ((compress && dd < b * b) || (stretch && dd > b * b)) {
					const s = (Math.sqrt(dd) / b - 1) * alpha + 1;
					sx *= s;
					if (uniform) sy *= s;
				}
			}
		}
		bone.updateWorldTransformWith(
			bone.ax,
			bone.ay,
			bone.arotation + rotationIK * alpha,
			sx,
			sy,
			bone.ashearX,
			bone.ashearY,
		);
	}

	/** Bends a parent/child chain so the child's tip reaches the target. */
	apply2(
		parent: Bone,
		child: Bone,
		targetX: number,
		targetY: number,
		bendDir: number,
		stretch: boolean,
		uniform: boolean,
		softness: number,
		alpha: number,
	): void {
		if (parent.inherit !== Inherit.Normal || child.inherit !== Inherit.Normal) return;
		const px = parent.ax;
		const py = parent.ay;
		let psx = parent.ascaleX;
		let psy = parent.ascaleY;
		let sx = psx;
		let sy = psy;
		let csx = child.ascaleX;
		let os1: number;
		let os2: number;
		let s2: number;
		if (psx < 0) {
			psx = -psx;
			os1 = 180;
			s2 = -1;
		} else {
			os1 = 0;
			s2 = 1;
		}
		if (psy < 0) {
			psy = -psy;
			s2 = -s2;
		}
		if (csx < 0) {
			csx = -csx;
			os2 = 180;
		} else os2 = 0;
		const cx = child.ax;
		let cy: number;
		let cwx: number;
		let cwy: number;
		let a = parent.a;
		let b = parent.b;
		let c = parent.c;
		let d = parent.d;
		const uniformParent = Math.abs(psx - psy) <= 0.0001;
		if (!uniformParent || stretch) {
			cy = 0;
			cwx = a * cx + parent.worldX;
			cwy = c * cx + parent.worldY;
		} else {
			cy = child.ay;
			cwx = a * cx + b * cy + parent.worldX;
			cwy = c * cx + d * cy + parent.worldY;
		}
		const pp = parent.parent;
		if (!pp) throw new Error('IK parent must itself have a parent.');
		a = pp.a;
		b = pp.b;
		c = pp.c;
		d = pp.d;
		let id = a * d - b * c;
		let x = cwx - pp.worldX;
		let y = cwy - pp.worldY;
		id = Math.abs(id) <= 0.0001 ? 0 : 1 / id;
		const dx = (x * d - y * b) * id - px;
		const dy = (y * a - x * c) * id - py;
		const l1 = Math.sqrt(dx * dx + dy * dy);
		let l2 = child.data.length * csx;
		let a1: number;
		let a2: number;
		if (l1 < 0.0001) {
			this.apply1(parent, targetX, targetY, false, stretch, false, alpha);
			child.updateWorldTransformWith(
				cx,
				cy,
				0,
				child.ascaleX,
				child.ascaleY,
				child.ashearX,
				child.ashearY,
			);
			return;
		}
		x = targetX - pp.worldX;
		y = targetY - pp.worldY;
		let tx = (x * d - y * b) * id - px;
		let ty = (y * a - x * c) * id - py;
		let dd = tx * tx + ty * ty;
		if (softness !== 0) {
			softness *= (psx * (csx + 1)) * 0.5;
			const td = Math.sqrt(dd);
			const sd = td - l1 - l2 * psx + softness;
			if (sd > 0) {
				let p = Math.min(1, sd / (softness * 2)) - 1;
				p = (sd - softness * (1 - p * p)) / td;
				tx -= p * tx;
				ty -= p * ty;
				dd = tx * tx + ty * ty;
			}
		}
		solve: if (uniformParent) {
			l2 *= psx;
			let cos = (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2);
			if (cos < -1) {
				cos = -1;
				a2 = PI * bendDir;
			} else if (cos > 1) {
				cos = 1;
				a2 = 0;
				if (stretch) {
					const s = (Math.sqrt(dd) / (l1 + l2) - 1) * alpha + 1;
					sx *= s;
					if (uniform) sy *= s;
				}
			} else a2 = Math.acos(cos) * bendDir;
			const ca = l1 + l2 * cos;
			const cb = l2 * Math.sin(a2);
			a1 = Math.atan2(ty * ca - tx * cb, tx * ca + ty * cb);
		} else {
			// Non-uniform parent scale: the child's reach is an ellipse; solve the quartic's
			// useful root, else fall back to the nearest/farthest reachable point.
			const ea = psx * l2;
			const eb = psy * l2;
			const aa = ea * ea;
			const bb = eb * eb;
			const ta = Math.atan2(ty, tx);
			let k = bb * l1 * l1 + aa * dd - aa * bb;
			const c1 = -2 * bb * l1;
			const c2 = bb - aa;
			const disc = c1 * c1 - 4 * c2 * k;
			if (disc >= 0) {
				let q = Math.sqrt(disc);
				if (c1 < 0) q = -q;
				q = -(c1 + q) * 0.5;
				const r0 = q / c2;
				const r1 = k / q;
				const r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
				const rr = dd - r * r;
				if (rr >= 0) {
					y = Math.sqrt(rr) * bendDir;
					a1 = ta - Math.atan2(y, r);
					a2 = Math.atan2(y / psy, (r - l1) / psx);
					break solve;
				}
			}
			let minAngle = PI;
			let minX = l1 - ea;
			let minDist = minX * minX;
			let minY = 0;
			let maxAngle = 0;
			let maxX = l1 + ea;
			let maxDist = maxX * maxX;
			let maxY = 0;
			k = (-ea * l1) / (aa - bb);
			if (k >= -1 && k <= 1) {
				k = Math.acos(k);
				x = ea * Math.cos(k) + l1;
				y = eb * Math.sin(k);
				const dist = x * x + y * y;
				if (dist < minDist) {
					minAngle = k;
					minDist = dist;
					minX = x;
					minY = y;
				}
				if (dist > maxDist) {
					maxAngle = k;
					maxDist = dist;
					maxX = x;
					maxY = y;
				}
			}
			if (dd <= (minDist + maxDist) * 0.5) {
				a1 = ta - Math.atan2(minY * bendDir, minX);
				a2 = minAngle * bendDir;
			} else {
				a1 = ta - Math.atan2(maxY * bendDir, maxX);
				a2 = maxAngle * bendDir;
			}
		}
		const os = Math.atan2(cy, cx) * s2;
		let rotation = parent.arotation;
		a1 = wrapDegrees((a1 - os) * RAD_DEG + os1 - rotation);
		parent.updateWorldTransformWith(px, py, rotation + a1 * alpha, sx, sy, 0, 0);
		rotation = child.arotation;
		a2 = wrapDegrees(((a2 + os) * RAD_DEG - child.ashearX) * s2 + os2 - rotation);
		child.updateWorldTransformWith(
			cx,
			cy,
			rotation + a2 * alpha,
			child.ascaleX,
			child.ascaleY,
			child.ashearX,
			child.ashearY,
		);
	}
}

export class TransformConstraint implements Updatable {
	bones: Bone[];
	target: Bone;
	mixRotate = 0;
	mixX = 0;
	mixY = 0;
	mixScaleX = 0;
	mixScaleY = 0;
	mixShearY = 0;
	temp = new Vector2();
	active = false;

	constructor(
		public data: TransformConstraintData,
		skeleton: Skeleton,
	) {
		this.bones = data.bones.map((b) => skeleton.bones[b.index]);
		this.target = skeleton.bones[data.target.index];
		this.setToSetupPose();
	}

	isActive(): boolean {
		return this.active;
	}

	setToSetupPose(): void {
		const d = this.data;
		this.mixRotate = d.mixRotate;
		this.mixX = d.mixX;
		this.mixY = d.mixY;
		this.mixScaleX = d.mixScaleX;
		this.mixScaleY = d.mixScaleY;
		this.mixShearY = d.mixShearY;
	}

	update(_physics: Physics): void {
		if (
			this.mixRotate === 0 &&
			this.mixX === 0 &&
			this.mixY === 0 &&
			this.mixScaleX === 0 &&
			this.mixScaleY === 0 &&
			this.mixShearY === 0
		)
			return;
		if (this.data.local) {
			if (this.data.relative) this.applyRelativeLocal();
			else this.applyAbsoluteLocal();
		} else if (this.data.relative) this.applyRelativeWorld();
		else this.applyAbsoluteWorld();
	}

	private applyAbsoluteWorld(): void {
		const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
		const translate = mixX !== 0 || mixY !== 0;
		const { a: ta, b: tb, c: tc, d: td } = target;
		const reflect = ta * td - tb * tc > 0 ? DEG_RAD : -DEG_RAD;
		const offsetRotation = data.offsetRotation * reflect;
		const offsetShearY = data.offsetShearY * reflect;
		for (const bone of this.bones) {
			if (mixRotate !== 0) {
				const r =
					wrapRadians(Math.atan2(tc, ta) - Math.atan2(bone.c, bone.a) + offsetRotation) *
					mixRotate;
				rotateBoneWorld(bone, r);
			}
			if (translate) {
				const t = target.localToWorld(this.temp.set(data.offsetX, data.offsetY));
				bone.worldX += (t.x - bone.worldX) * mixX;
				bone.worldY += (t.y - bone.worldY) * mixY;
			}
			if (mixScaleX !== 0) {
				let s = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
				if (s !== 0)
					s = (s + (Math.sqrt(ta * ta + tc * tc) - s + data.offsetScaleX) * mixScaleX) / s;
				bone.a *= s;
				bone.c *= s;
			}
			if (mixScaleY !== 0) {
				let s = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
				if (s !== 0)
					s = (s + (Math.sqrt(tb * tb + td * td) - s + data.offsetScaleY) * mixScaleY) / s;
				bone.b *= s;
				bone.d *= s;
			}
			if (mixShearY > 0) {
				const b = bone.b;
				const d = bone.d;
				const by = Math.atan2(d, b);
				const r = wrapRadians(
					Math.atan2(td, tb) - Math.atan2(tc, ta) - (by - Math.atan2(bone.c, bone.a)),
				);
				const angle = by + (r + offsetShearY) * mixShearY;
				const s = Math.sqrt(b * b + d * d);
				bone.b = Math.cos(angle) * s;
				bone.d = Math.sin(angle) * s;
			}
			bone.updateAppliedTransform();
		}
	}

	private applyRelativeWorld(): void {
		const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
		const translate = mixX !== 0 || mixY !== 0;
		const { a: ta, b: tb, c: tc, d: td } = target;
		const reflect = ta * td - tb * tc > 0 ? DEG_RAD : -DEG_RAD;
		const offsetRotation = data.offsetRotation * reflect;
		const offsetShearY = data.offsetShearY * reflect;
		for (const bone of this.bones) {
			if (mixRotate !== 0)
				rotateBoneWorld(bone, wrapRadians(Math.atan2(tc, ta) + offsetRotation) * mixRotate);
			if (translate) {
				const t = target.localToWorld(this.temp.set(data.offsetX, data.offsetY));
				bone.worldX += t.x * mixX;
				bone.worldY += t.y * mixY;
			}
			if (mixScaleX !== 0) {
				const s = (Math.sqrt(ta * ta + tc * tc) - 1 + data.offsetScaleX) * mixScaleX + 1;
				bone.a *= s;
				bone.c *= s;
			}
			if (mixScaleY !== 0) {
				const s = (Math.sqrt(tb * tb + td * td) - 1 + data.offsetScaleY) * mixScaleY + 1;
				bone.b *= s;
				bone.d *= s;
			}
			if (mixShearY > 0) {
				const r = wrapRadians(Math.atan2(td, tb) - Math.atan2(tc, ta));
				const b = bone.b;
				const d = bone.d;
				const angle = Math.atan2(d, b) + (r - PI / 2 + offsetShearY) * mixShearY;
				const s = Math.sqrt(b * b + d * d);
				bone.b = Math.cos(angle) * s;
				bone.d = Math.sin(angle) * s;
			}
			bone.updateAppliedTransform();
		}
	}

	private applyAbsoluteLocal(): void {
		const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
		for (const bone of this.bones) {
			let rotation = bone.arotation;
			if (mixRotate !== 0)
				rotation += (target.arotation - rotation + data.offsetRotation) * mixRotate;
			let x = bone.ax;
			let y = bone.ay;
			x += (target.ax - x + data.offsetX) * mixX;
			y += (target.ay - y + data.offsetY) * mixY;
			let scaleX = bone.ascaleX;
			let scaleY = bone.ascaleY;
			if (mixScaleX !== 0 && scaleX !== 0)
				scaleX = (scaleX + (target.ascaleX - scaleX + data.offsetScaleX) * mixScaleX) / scaleX;
			if (mixScaleY !== 0 && scaleY !== 0)
				scaleY = (scaleY + (target.ascaleY - scaleY + data.offsetScaleY) * mixScaleY) / scaleY;
			let shearY = bone.ashearY;
			if (mixShearY !== 0)
				shearY += (target.ashearY - shearY + data.offsetShearY) * mixShearY;
			bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
		}
	}

	private applyRelativeLocal(): void {
		const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
		for (const bone of this.bones) {
			const rotation = bone.arotation + (target.arotation + data.offsetRotation) * mixRotate;
			const x = bone.ax + (target.ax + data.offsetX) * mixX;
			const y = bone.ay + (target.ay + data.offsetY) * mixY;
			const scaleX = bone.ascaleX * ((target.ascaleX - 1 + data.offsetScaleX) * mixScaleX + 1);
			const scaleY = bone.ascaleY * ((target.ascaleY - 1 + data.offsetScaleY) * mixScaleY + 1);
			const shearY = bone.ashearY + (target.ashearY + data.offsetShearY) * mixShearY;
			bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
		}
	}
}

/** Rotates a bone's world axes by `r` radians. */
function rotateBoneWorld(bone: Bone, r: number): void {
	const cos = Math.cos(r);
	const sin = Math.sin(r);
	const { a, b, c, d } = bone;
	bone.a = cos * a - sin * c;
	bone.b = cos * b - sin * d;
	bone.c = sin * a + cos * c;
	bone.d = sin * b + cos * d;
}

/** Cubic bezier point at parameter t. */
function bezierAt(t: number, p0: number, p1: number, p2: number, p3: number): number {
	const u = 1 - t;
	return p0 * u * u * u + 3 * p1 * u * u * t + 3 * p2 * u * t * t + p3 * t * t * t;
}

/** Cumulative chord lengths of a cubic sampled at `steps` uniform parameter steps. */
function chordLengths(
	steps: number,
	x1: number,
	y1: number,
	cx1: number,
	cy1: number,
	cx2: number,
	cy2: number,
	x2: number,
	y2: number,
	out: number[],
): number {
	let px = x1;
	let py = y1;
	let total = 0;
	for (let k = 1; k <= steps; k++) {
		const t = k / steps;
		const x = bezierAt(t, x1, cx1, cx2, x2);
		const y = bezierAt(t, y1, cy1, cy2, y2);
		total += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
		out[k - 1] = total;
		px = x;
		py = y;
	}
	return total;
}

const BEFORE = -2;
const AFTER = -3;
const EPSILON = 0.00001;
const NONE = -1;

export class PathConstraint implements Updatable {
	bones: Bone[];
	target: Slot;
	position = 0;
	spacing = 0;
	mixRotate = 0;
	mixX = 0;
	mixY = 0;
	spaces: number[] = [];
	positions: number[] = [];
	world: number[] = [];
	curves: number[] = [];
	lengths: number[] = [];
	segments: number[] = [];
	active = false;

	constructor(
		public data: PathConstraintData,
		skeleton: Skeleton,
	) {
		this.bones = data.bones.map((b) => skeleton.bones[b.index]);
		this.target = skeleton.slots[data.target.index];
		this.setToSetupPose();
	}

	isActive(): boolean {
		return this.active;
	}

	setToSetupPose(): void {
		const d = this.data;
		this.position = d.position;
		this.spacing = d.spacing;
		this.mixRotate = d.mixRotate;
		this.mixX = d.mixX;
		this.mixY = d.mixY;
	}

	update(_physics: Physics): void {
		const attachment = this.target.getAttachment();
		if (!(attachment instanceof PathAttachment)) return;
		const { mixRotate, mixX, mixY, data, bones } = this;
		if (mixRotate === 0 && mixX === 0 && mixY === 0) return;
		const tangents = data.rotateMode === RotateMode.Tangent;
		const scale = data.rotateMode === RotateMode.ChainScale;
		const boneCount = bones.length;
		const spacesCount = tangents ? boneCount : boneCount + 1;
		const spaces = this.spaces;
		spaces.length = spacesCount;
		const lengths = this.lengths;
		if (scale) lengths.length = boneCount;
		const spacing = this.spacing;
		const boneLength = (bone: Bone): number => {
			const l = bone.data.length;
			const x = l * bone.a;
			const y = l * bone.c;
			return Math.sqrt(x * x + y * y);
		};

		spaces[0] = 0;
		switch (data.spacingMode) {
			case SpacingMode.Percent:
				if (scale) for (let i = 0; i < spacesCount - 1; i++) lengths[i] = boneLength(bones[i]);
				for (let i = 1; i < spacesCount; i++) spaces[i] = spacing;
				break;
			case SpacingMode.Proportional: {
				let sum = 0;
				for (let i = 0; i < spacesCount - 1; i++) {
					const bone = bones[i];
					if (bone.data.length < EPSILON) {
						if (scale) lengths[i] = 0;
						spaces[i + 1] = spacing;
					} else {
						const length = boneLength(bone);
						if (scale) lengths[i] = length;
						spaces[i + 1] = length;
						sum += length;
					}
				}
				if (sum > 0) {
					const f = (spacesCount / sum) * spacing;
					for (let i = 1; i < spacesCount; i++) spaces[i] *= f;
				}
				break;
			}
			default: {
				const lengthSpacing = data.spacingMode === SpacingMode.Length;
				for (let i = 0; i < spacesCount - 1; i++) {
					const bone = bones[i];
					const setupLength = bone.data.length;
					if (setupLength < EPSILON) {
						if (scale) lengths[i] = 0;
						spaces[i + 1] = spacing;
					} else {
						const length = boneLength(bone);
						if (scale) lengths[i] = length;
						spaces[i + 1] = ((lengthSpacing ? setupLength + spacing : spacing) * length) / setupLength;
					}
				}
			}
		}

		const positions = this.computeWorldPositions(attachment, spacesCount, tangents);
		let boneX = positions[0];
		let boneY = positions[1];
		let offsetRotation = data.offsetRotation;
		let tip: boolean;
		if (offsetRotation === 0) tip = data.rotateMode === RotateMode.Chain;
		else {
			tip = false;
			const p = this.target.bone;
			offsetRotation *= p.a * p.d - p.b * p.c > 0 ? DEG_RAD : -DEG_RAD;
		}
		for (let i = 0, p = 3; i < boneCount; i++, p += 3) {
			const bone = bones[i];
			bone.worldX += (boneX - bone.worldX) * mixX;
			bone.worldY += (boneY - bone.worldY) * mixY;
			const x = positions[p];
			const y = positions[p + 1];
			const dx = x - boneX;
			const dy = y - boneY;
			if (scale) {
				const length = lengths[i];
				if (length !== 0) {
					const s = (Math.sqrt(dx * dx + dy * dy) / length - 1) * mixRotate + 1;
					bone.a *= s;
					bone.c *= s;
				}
			}
			boneX = x;
			boneY = y;
			if (mixRotate > 0) {
				const { a, c } = bone;
				let r: number;
				if (tangents) r = positions[p - 1];
				else if (spaces[i + 1] === 0) r = positions[p + 2];
				else r = Math.atan2(dy, dx);
				r -= Math.atan2(c, a);
				if (tip) {
					const cos = Math.cos(r);
					const sin = Math.sin(r);
					const length = bone.data.length;
					boneX += (length * (cos * a - sin * c) - dx) * mixRotate;
					boneY += (length * (sin * a + cos * c) - dy) * mixRotate;
				} else r += offsetRotation;
				rotateBoneWorld(bone, wrapRadians(r) * mixRotate);
			}
			bone.updateAppliedTransform();
		}
	}

	computeWorldPositions(path: PathAttachment, spacesCount: number, tangents: boolean): number[] {
		const target = this.target;
		let position = this.position;
		const spaces = this.spaces;
		const out = this.positions;
		out.length = spacesCount * 3 + 2;
		const closed = path.closed;
		let verticesLength = path.worldVerticesLength;
		let curveCount = verticesLength / 6;
		let prevCurve = NONE;
		const data = this.data;

		if (!path.constantSpeed) {
			const lengths = path.lengths;
			curveCount -= closed ? 1 : 2;
			const pathLength = lengths[curveCount];
			if (data.positionMode === PositionMode.Percent) position *= pathLength;
			const multiplier =
				data.spacingMode === SpacingMode.Percent
					? pathLength
					: data.spacingMode === SpacingMode.Proportional
						? pathLength / spacesCount
						: 1;
			const world = this.world;
			world.length = 8;
			for (let i = 0, o = 0, curve = 0; i < spacesCount; i++, o += 3) {
				const space = spaces[i] * multiplier;
				position += space;
				let p = position;
				if (closed) {
					p %= pathLength;
					if (p < 0) p += pathLength;
					curve = 0;
				} else if (p < 0) {
					if (prevCurve !== BEFORE) {
						prevCurve = BEFORE;
						path.computeWorldVertices(target, 2, 4, world, 0, 2);
					}
					addBeforePosition(p, world, 0, out, o);
					continue;
				} else if (p > pathLength) {
					if (prevCurve !== AFTER) {
						prevCurve = AFTER;
						path.computeWorldVertices(target, verticesLength - 6, 4, world, 0, 2);
					}
					addAfterPosition(p - pathLength, world, 0, out, o);
					continue;
				}
				for (;; curve++) {
					const length = lengths[curve];
					if (p > length) continue;
					if (curve === 0) p /= length;
					else {
						const prev = lengths[curve - 1];
						p = (p - prev) / (length - prev);
					}
					break;
				}
				if (curve !== prevCurve) {
					prevCurve = curve;
					if (closed && curve === curveCount) {
						path.computeWorldVertices(target, verticesLength - 4, 4, world, 0, 2);
						path.computeWorldVertices(target, 0, 4, world, 4, 2);
					} else path.computeWorldVertices(target, curve * 6 + 2, 8, world, 0, 2);
				}
				addCurvePosition(
					p,
					world[0],
					world[1],
					world[2],
					world[3],
					world[4],
					world[5],
					world[6],
					world[7],
					out,
					o,
					tangents || (i > 0 && space === 0),
				);
			}
			return out;
		}

		const world = this.world;
		if (closed) {
			verticesLength += 2;
			world.length = verticesLength;
			path.computeWorldVertices(target, 2, verticesLength - 4, world, 0, 2);
			path.computeWorldVertices(target, 0, 2, world, verticesLength - 4, 2);
			world[verticesLength - 2] = world[0];
			world[verticesLength - 1] = world[1];
		} else {
			curveCount--;
			verticesLength -= 4;
			world.length = verticesLength;
			path.computeWorldVertices(target, 2, verticesLength, world, 0, 2);
		}

		// Arc length per curve, approximated by four chords each.
		const curves = this.curves;
		curves.length = curveCount;
		const scratch: number[] = [];
		let pathLength = 0;
		for (let i = 0, w = 0; i < curveCount; i++, w += 6) {
			pathLength += chordLengths(
				4,
				world[w],
				world[w + 1],
				world[w + 2],
				world[w + 3],
				world[w + 4],
				world[w + 5],
				world[w + 6],
				world[w + 7],
				scratch,
			);
			curves[i] = pathLength;
		}
		if (data.positionMode === PositionMode.Percent) position *= pathLength;
		const multiplier =
			data.spacingMode === SpacingMode.Percent
				? pathLength
				: data.spacingMode === SpacingMode.Proportional
					? pathLength / spacesCount
					: 1;

		const segments = this.segments;
		let curveLength = 0;
		let x1 = 0;
		let y1 = 0;
		let cx1 = 0;
		let cy1 = 0;
		let cx2 = 0;
		let cy2 = 0;
		let x2 = 0;
		let y2 = 0;
		for (let i = 0, o = 0, curve = 0, segment = 0; i < spacesCount; i++, o += 3) {
			const space = spaces[i] * multiplier;
			position += space;
			let p = position;
			if (closed) {
				p %= pathLength;
				if (p < 0) p += pathLength;
				curve = 0;
			} else if (p < 0) {
				addBeforePosition(p, world, 0, out, o);
				continue;
			} else if (p > pathLength) {
				addAfterPosition(p - pathLength, world, verticesLength - 4, out, o);
				continue;
			}
			for (;; curve++) {
				const length = curves[curve];
				if (p > length) continue;
				if (curve === 0) p /= length;
				else {
					const prev = curves[curve - 1];
					p = (p - prev) / (length - prev);
				}
				break;
			}
			if (curve !== prevCurve) {
				prevCurve = curve;
				const ii = curve * 6;
				x1 = world[ii];
				y1 = world[ii + 1];
				cx1 = world[ii + 2];
				cy1 = world[ii + 3];
				cx2 = world[ii + 4];
				cy2 = world[ii + 5];
				x2 = world[ii + 6];
				y2 = world[ii + 7];
				// Ten chords per curve reparameterize it by arc length.
				curveLength = chordLengths(10, x1, y1, cx1, cy1, cx2, cy2, x2, y2, segments);
				segment = 0;
			}
			p *= curveLength;
			for (;; segment++) {
				const length = segments[segment];
				if (p > length) continue;
				if (segment === 0) p /= length;
				else {
					const prev = segments[segment - 1];
					p = segment + (p - prev) / (length - prev);
				}
				break;
			}
			addCurvePosition(
				p * 0.1,
				x1,
				y1,
				cx1,
				cy1,
				cx2,
				cy2,
				x2,
				y2,
				out,
				o,
				tangents || (i > 0 && space === 0),
			);
		}
		return out;
	}
}

function addBeforePosition(p: number, temp: number[], i: number, out: number[], o: number): void {
	const x1 = temp[i];
	const y1 = temp[i + 1];
	const r = Math.atan2(temp[i + 3] - y1, temp[i + 2] - x1);
	out[o] = x1 + p * Math.cos(r);
	out[o + 1] = y1 + p * Math.sin(r);
	out[o + 2] = r;
}

function addAfterPosition(p: number, temp: number[], i: number, out: number[], o: number): void {
	const x1 = temp[i + 2];
	const y1 = temp[i + 3];
	const r = Math.atan2(y1 - temp[i + 1], x1 - temp[i]);
	out[o] = x1 + p * Math.cos(r);
	out[o + 1] = y1 + p * Math.sin(r);
	out[o + 2] = r;
}

function addCurvePosition(
	p: number,
	x1: number,
	y1: number,
	cx1: number,
	cy1: number,
	cx2: number,
	cy2: number,
	x2: number,
	y2: number,
	out: number[],
	o: number,
	tangents: boolean,
): void {
	if (p === 0 || isNaN(p)) {
		out[o] = x1;
		out[o + 1] = y1;
		out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
		return;
	}
	const x = bezierAt(p, x1, cx1, cx2, x2);
	const y = bezierAt(p, y1, cy1, cy2, y2);
	out[o] = x;
	out[o + 1] = y;
	if (!tangents) return;
	if (p < 0.001) {
		out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
		return;
	}
	// Direction from the de Casteljau point one level up (the quadratic through the first
	// three control points) to the curve point.
	const u = 1 - p;
	const qx = x1 * u * u + cx1 * u * p * 2 + cx2 * p * p;
	const qy = y1 * u * u + cy1 * u * p * 2 + cy2 * p * p;
	out[o + 2] = Math.atan2(y - qy, x - qx);
}

export class PhysicsConstraint implements Updatable {
	bone: Bone;
	inertia = 0;
	strength = 0;
	damping = 0;
	massInverse = 0;
	wind = 0;
	gravity = 0;
	mix = 0;
	private needsReset = true;
	ux = 0;
	uy = 0;
	cx = 0;
	cy = 0;
	tx = 0;
	ty = 0;
	xOffset = 0;
	xVelocity = 0;
	yOffset = 0;
	yVelocity = 0;
	rotateOffset = 0;
	rotateVelocity = 0;
	scaleOffset = 0;
	scaleVelocity = 0;
	active = false;
	remaining = 0;
	lastTime = 0;

	constructor(
		public data: PhysicsConstraintData,
		public skeleton: Skeleton,
	) {
		this.bone = skeleton.bones[data.bone.index];
		this.setToSetupPose();
	}

	isActive(): boolean {
		return this.active;
	}

	reset(): void {
		this.remaining = 0;
		this.lastTime = this.skeleton.time;
		this.needsReset = true;
		this.xOffset = 0;
		this.xVelocity = 0;
		this.yOffset = 0;
		this.yVelocity = 0;
		this.rotateOffset = 0;
		this.rotateVelocity = 0;
		this.scaleOffset = 0;
		this.scaleVelocity = 0;
	}

	setToSetupPose(): void {
		const d = this.data;
		this.inertia = d.inertia;
		this.strength = d.strength;
		this.damping = d.damping;
		this.massInverse = d.massInverse;
		this.wind = d.wind;
		this.gravity = d.gravity;
		this.mix = d.mix;
	}

	/** Moves the simulation as if the skeleton moved by (x, y) in world space. */
	translate(x: number, y: number): void {
		this.ux -= x;
		this.uy -= y;
		this.cx -= x;
		this.cy -= y;
	}

	/** Rotates the simulation as if the skeleton rotated around (x, y). */
	rotate(x: number, y: number, degrees: number): void {
		const r = degrees * DEG_RAD;
		const cos = Math.cos(r);
		const sin = Math.sin(r);
		const dx = this.cx - x;
		const dy = this.cy - y;
		this.translate(dx * cos - dy * sin - dx, dx * sin + dy * cos - dy);
	}

	update(physics: Physics): void {
		const mix = this.mix;
		if (mix === 0) return;
		const data = this.data;
		const doX = data.x > 0;
		const doY = data.y > 0;
		const rotateOrShearX = data.rotate > 0 || data.shearX > 0;
		const doScaleX = data.scaleX > 0;
		const bone = this.bone;
		const l = bone.data.length;
		const skeleton = this.skeleton;

		switch (physics) {
			case Physics.none:
				return;
			case Physics.reset:
			case Physics.update: {
				if (physics === Physics.reset) this.reset();
				const delta = Math.max(skeleton.time - this.lastTime, 0);
				this.remaining += delta;
				this.lastTime = skeleton.time;
				const bx = bone.worldX;
				const by = bone.worldY;
				if (this.needsReset) {
					this.needsReset = false;
					this.ux = bx;
					this.uy = by;
				} else {
					let a = this.remaining;
					const inertia = this.inertia;
					const step = data.step;
					const f = skeleton.data.referenceScale;
					let damp = -1;
					let qx = data.limit * delta;
					const qy = qx * Math.abs(skeleton.scaleY);
					qx *= Math.abs(skeleton.scaleX);
					if (doX || doY) {
						if (doX) {
							const u = (this.ux - bx) * inertia;
							this.xOffset += u > qx ? qx : u < -qx ? -qx : u;
							this.ux = bx;
						}
						if (doY) {
							const u = (this.uy - by) * inertia;
							this.yOffset += u > qy ? qy : u < -qy ? -qy : u;
							this.uy = by;
						}
						if (a >= step) {
							damp = Math.pow(this.damping, 60 * step);
							const m = this.massInverse * step;
							const e = this.strength;
							const w = this.wind * f * skeleton.scaleX;
							const g = this.gravity * f * skeleton.scaleY;
							do {
								if (doX) {
									this.xVelocity += (w - this.xOffset * e) * m;
									this.xOffset += this.xVelocity * step;
									this.xVelocity *= damp;
								}
								if (doY) {
									this.yVelocity -= (g + this.yOffset * e) * m;
									this.yOffset += this.yVelocity * step;
									this.yVelocity *= damp;
								}
								a -= step;
							} while (a >= step);
						}
						if (doX) bone.worldX += this.xOffset * mix * data.x;
						if (doY) bone.worldY += this.yOffset * mix * data.y;
					}
					if (rotateOrShearX || doScaleX) {
						const ca = Math.atan2(bone.c, bone.a);
						let c = 0;
						let s = 0;
						let mr = 0;
						let dx = this.cx - bone.worldX;
						let dy = this.cy - bone.worldY;
						if (dx > qx) dx = qx;
						else if (dx < -qx) dx = -qx;
						if (dy > qy) dy = qy;
						else if (dy < -qy) dy = -qy;
						if (rotateOrShearX) {
							mr = (data.rotate + data.shearX) * mix;
							let r = Math.atan2(dy + this.ty, dx + this.tx) - ca - this.rotateOffset * mr;
							this.rotateOffset += (r - Math.ceil(r / PI2 - 0.5) * PI2) * inertia;
							r = this.rotateOffset * mr + ca;
							c = Math.cos(r);
							s = Math.sin(r);
							if (doScaleX) {
								r = l * bone.getWorldScaleX();
								if (r > 0) this.scaleOffset += ((dx * c + dy * s) * inertia) / r;
							}
						} else {
							c = Math.cos(ca);
							s = Math.sin(ca);
							const r = l * bone.getWorldScaleX();
							if (r > 0) this.scaleOffset += ((dx * c + dy * s) * inertia) / r;
						}
						a = this.remaining;
						if (a >= step) {
							if (damp === -1) damp = Math.pow(this.damping, 60 * step);
							const m = this.massInverse * step;
							const e = this.strength;
							const w = this.wind;
							const g = skeleton.yDown ? -this.gravity : this.gravity;
							const h = l / f;
							for (;;) {
								a -= step;
								if (doScaleX) {
									this.scaleVelocity += (w * c - g * s - this.scaleOffset * e) * m;
									this.scaleOffset += this.scaleVelocity * step;
									this.scaleVelocity *= damp;
								}
								if (rotateOrShearX) {
									this.rotateVelocity -= ((w * s + g * c) * h + this.rotateOffset * e) * m;
									this.rotateOffset += this.rotateVelocity * step;
									this.rotateVelocity *= damp;
									if (a < step) break;
									const r = this.rotateOffset * mr + ca;
									c = Math.cos(r);
									s = Math.sin(r);
								} else if (a < step) break;
							}
						}
					}
					this.remaining = a;
				}
				this.cx = bone.worldX;
				this.cy = bone.worldY;
				break;
			}
			case Physics.pose:
				if (doX) bone.worldX += this.xOffset * mix * data.x;
				if (doY) bone.worldY += this.yOffset * mix * data.y;
		}

		if (rotateOrShearX) {
			let o = this.rotateOffset * mix;
			if (data.shearX > 0) {
				let r = 0;
				if (data.rotate > 0) {
					r = o * data.rotate;
					const s = Math.sin(r);
					const c = Math.cos(r);
					const b = bone.b;
					bone.b = c * b - s * bone.d;
					bone.d = s * b + c * bone.d;
				}
				r += o * data.shearX;
				const s = Math.sin(r);
				const c = Math.cos(r);
				const a = bone.a;
				bone.a = c * a - s * bone.c;
				bone.c = s * a + c * bone.c;
			} else {
				o *= data.rotate;
				rotateBoneWorld(bone, o);
			}
		}
		if (doScaleX) {
			const s = 1 + this.scaleOffset * mix * data.scaleX;
			bone.a *= s;
			bone.c *= s;
		}
		if (physics !== Physics.pose) {
			this.tx = l * bone.a;
			this.ty = l * bone.c;
		}
		bone.updateAppliedTransform();
	}
}
