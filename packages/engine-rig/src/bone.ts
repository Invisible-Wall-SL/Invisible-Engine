import { DEG_RAD, RAD_DEG, PI, type Vector2 } from './math';
import { Inherit, type BoneData } from './data';
import type { Skeleton } from './skeleton';
import type { Physics } from './physics';

/** A bone's local pose (`x`…`shearY`), the pose last applied (`ax`…`ashearY`) and the world
 * transform `[a b worldX; c d worldY]` it resolves to. */
export class Bone {
	children: Bone[] = [];
	x = 0;
	y = 0;
	rotation = 0;
	scaleX = 0;
	scaleY = 0;
	shearX = 0;
	shearY = 0;
	ax = 0;
	ay = 0;
	arotation = 0;
	ascaleX = 0;
	ascaleY = 0;
	ashearX = 0;
	ashearY = 0;
	a = 0;
	b = 0;
	c = 0;
	d = 0;
	worldX = 0;
	worldY = 0;
	inherit = Inherit.Normal;
	sorted = false;
	active = false;

	constructor(
		public data: BoneData,
		public skeleton: Skeleton,
		public parent: Bone | null,
	) {
		this.setToSetupPose();
	}

	isActive(): boolean {
		return this.active;
	}

	update(_physics: Physics | null): void {
		this.updateWorldTransformWith(
			this.ax,
			this.ay,
			this.arotation,
			this.ascaleX,
			this.ascaleY,
			this.ashearX,
			this.ashearY,
		);
	}

	updateWorldTransform(): void {
		this.updateWorldTransformWith(
			this.x,
			this.y,
			this.rotation,
			this.scaleX,
			this.scaleY,
			this.shearX,
			this.shearY,
		);
	}

	updateWorldTransformWith(
		x: number,
		y: number,
		rotation: number,
		scaleX: number,
		scaleY: number,
		shearX: number,
		shearY: number,
	): void {
		this.ax = x;
		this.ay = y;
		this.arotation = rotation;
		this.ascaleX = scaleX;
		this.ascaleY = scaleY;
		this.ashearX = shearX;
		this.ashearY = shearY;

		const skeleton = this.skeleton;
		const sx = skeleton.scaleX;
		const sy = skeleton.scaleY;
		const parent = this.parent;
		if (!parent) {
			const rx = (rotation + shearX) * DEG_RAD;
			const ry = (rotation + 90 + shearY) * DEG_RAD;
			this.a = Math.cos(rx) * scaleX * sx;
			this.b = Math.cos(ry) * scaleY * sx;
			this.c = Math.sin(rx) * scaleX * sy;
			this.d = Math.sin(ry) * scaleY * sy;
			this.worldX = x * sx + skeleton.x;
			this.worldY = y * sy + skeleton.y;
			return;
		}

		let pa = parent.a;
		let pb = parent.b;
		let pc = parent.c;
		let pd = parent.d;
		this.worldX = pa * x + pb * y + parent.worldX;
		this.worldY = pc * x + pd * y + parent.worldY;

		switch (this.inherit) {
			case Inherit.Normal: {
				const rx = (rotation + shearX) * DEG_RAD;
				const ry = (rotation + 90 + shearY) * DEG_RAD;
				const la = Math.cos(rx) * scaleX;
				const lb = Math.cos(ry) * scaleY;
				const lc = Math.sin(rx) * scaleX;
				const ld = Math.sin(ry) * scaleY;
				this.a = pa * la + pb * lc;
				this.b = pa * lb + pb * ld;
				this.c = pc * la + pd * lc;
				this.d = pc * lb + pd * ld;
				return;
			}
			case Inherit.OnlyTranslation: {
				const rx = (rotation + shearX) * DEG_RAD;
				const ry = (rotation + 90 + shearY) * DEG_RAD;
				this.a = Math.cos(rx) * scaleX;
				this.b = Math.cos(ry) * scaleY;
				this.c = Math.sin(rx) * scaleX;
				this.d = Math.sin(ry) * scaleY;
				break;
			}
			case Inherit.NoRotationOrReflection: {
				let s = pa * pa + pc * pc;
				let prx: number;
				if (s > 0.0001) {
					s = Math.abs(pa * pd - pb * pc) / s;
					pa /= sx;
					pc /= sy;
					pb = pc * s;
					pd = pa * s;
					prx = Math.atan2(pc, pa) * RAD_DEG;
				} else {
					pa = 0;
					pc = 0;
					prx = 90 - Math.atan2(pd, pb) * RAD_DEG;
				}
				const rx = (rotation + shearX - prx) * DEG_RAD;
				const ry = (rotation + shearY - prx + 90) * DEG_RAD;
				const la = Math.cos(rx) * scaleX;
				const lb = Math.cos(ry) * scaleY;
				const lc = Math.sin(rx) * scaleX;
				const ld = Math.sin(ry) * scaleY;
				this.a = pa * la - pb * lc;
				this.b = pa * lb - pb * ld;
				this.c = pc * la + pd * lc;
				this.d = pc * lb + pd * ld;
				break;
			}
			case Inherit.NoScale:
			case Inherit.NoScaleOrReflection: {
				const r = rotation * DEG_RAD;
				const cos = Math.cos(r);
				const sin = Math.sin(r);
				let za = (pa * cos + pb * sin) / sx;
				let zc = (pc * cos + pd * sin) / sy;
				let s = Math.sqrt(za * za + zc * zc);
				if (s > 0.00001) s = 1 / s;
				za *= s;
				zc *= s;
				s = Math.sqrt(za * za + zc * zc);
				if (
					this.inherit === Inherit.NoScale &&
					pa * pd - pb * pc < 0 !== (sx < 0 !== sy < 0)
				)
					s = -s;
				const zr = PI / 2 + Math.atan2(zc, za);
				const zb = Math.cos(zr) * s;
				const zd = Math.sin(zr) * s;
				const rx = shearX * DEG_RAD;
				const ry = (90 + shearY) * DEG_RAD;
				const la = Math.cos(rx) * scaleX;
				const lb = Math.cos(ry) * scaleY;
				const lc = Math.sin(rx) * scaleX;
				const ld = Math.sin(ry) * scaleY;
				this.a = za * la + zb * lc;
				this.b = za * lb + zb * ld;
				this.c = zc * la + zd * lc;
				this.d = zc * lb + zd * ld;
				break;
			}
		}
		this.a *= sx;
		this.b *= sx;
		this.c *= sy;
		this.d *= sy;
	}

	setToSetupPose(): void {
		const data = this.data;
		this.x = data.x;
		this.y = data.y;
		this.rotation = data.rotation;
		this.scaleX = data.scaleX;
		this.scaleY = data.scaleY;
		this.shearX = data.shearX;
		this.shearY = data.shearY;
		this.inherit = data.inherit;
	}

	/** Re-derives the applied local pose from the current world transform, after a constraint
	 * edited the world transform directly. */
	updateAppliedTransform(): void {
		const parent = this.parent;
		const skeleton = this.skeleton;
		if (!parent) {
			this.ax = this.worldX - skeleton.x;
			this.ay = this.worldY - skeleton.y;
			this.arotation = Math.atan2(this.c, this.a) * RAD_DEG;
			this.ascaleX = Math.sqrt(this.a * this.a + this.c * this.c);
			this.ascaleY = Math.sqrt(this.b * this.b + this.d * this.d);
			this.ashearX = 0;
			this.ashearY =
				Math.atan2(this.a * this.b + this.c * this.d, this.a * this.d - this.b * this.c) *
				RAD_DEG;
			return;
		}
		let pa = parent.a;
		let pb = parent.b;
		let pc = parent.c;
		let pd = parent.d;
		let pid = 1 / (pa * pd - pb * pc);
		let ia = pd * pid;
		let ib = pb * pid;
		let ic = pc * pid;
		let id = pa * pid;
		const dx = this.worldX - parent.worldX;
		const dy = this.worldY - parent.worldY;
		this.ax = dx * ia - dy * ib;
		this.ay = dy * id - dx * ic;

		let ra: number;
		let rb: number;
		let rc: number;
		let rd: number;
		if (this.inherit === Inherit.OnlyTranslation) {
			ra = this.a;
			rb = this.b;
			rc = this.c;
			rd = this.d;
		} else {
			if (this.inherit === Inherit.NoRotationOrReflection) {
				const s = Math.abs(pa * pd - pb * pc) / (pa * pa + pc * pc);
				const sa = pa / skeleton.scaleX;
				const sc = pc / skeleton.scaleY;
				pb = -sc * s * skeleton.scaleX;
				pd = sa * s * skeleton.scaleY;
				pid = 1 / (pa * pd - pb * pc);
				ia = pd * pid;
				ib = pb * pid;
			} else if (
				this.inherit === Inherit.NoScale ||
				this.inherit === Inherit.NoScaleOrReflection
			) {
				const cos = Math.cos(this.rotation * DEG_RAD);
				const sin = Math.sin(this.rotation * DEG_RAD);
				pa = (pa * cos + pb * sin) / skeleton.scaleX;
				pc = (pc * cos + pd * sin) / skeleton.scaleY;
				let s = Math.sqrt(pa * pa + pc * pc);
				if (s > 0.00001) s = 1 / s;
				pa *= s;
				pc *= s;
				s = Math.sqrt(pa * pa + pc * pc);
				if (
					this.inherit === Inherit.NoScale &&
					pid < 0 !== (skeleton.scaleX < 0 !== skeleton.scaleY < 0)
				)
					s = -s;
				const r = PI / 2 + Math.atan2(pc, pa);
				pb = Math.cos(r) * s;
				pd = Math.sin(r) * s;
				pid = 1 / (pa * pd - pb * pc);
				ia = pd * pid;
				ib = pb * pid;
				ic = pc * pid;
				id = pa * pid;
			}
			ra = ia * this.a - ib * this.c;
			rb = ia * this.b - ib * this.d;
			rc = id * this.c - ic * this.a;
			rd = id * this.d - ic * this.b;
		}

		this.ashearX = 0;
		this.ascaleX = Math.sqrt(ra * ra + rc * rc);
		if (this.ascaleX > 0.0001) {
			const det = ra * rd - rb * rc;
			this.ascaleY = det / this.ascaleX;
			this.ashearY = -Math.atan2(ra * rb + rc * rd, det) * RAD_DEG;
			this.arotation = Math.atan2(rc, ra) * RAD_DEG;
		} else {
			this.ascaleX = 0;
			this.ascaleY = Math.sqrt(rb * rb + rd * rd);
			this.ashearY = 0;
			this.arotation = 90 - Math.atan2(rd, rb) * RAD_DEG;
		}
	}

	getWorldRotationX(): number {
		return Math.atan2(this.c, this.a) * RAD_DEG;
	}

	getWorldRotationY(): number {
		return Math.atan2(this.d, this.b) * RAD_DEG;
	}

	getWorldScaleX(): number {
		return Math.sqrt(this.a * this.a + this.c * this.c);
	}

	getWorldScaleY(): number {
		return Math.sqrt(this.b * this.b + this.d * this.d);
	}

	worldToLocal(world: Vector2): Vector2 {
		const invDet = 1 / (this.a * this.d - this.b * this.c);
		const x = world.x - this.worldX;
		const y = world.y - this.worldY;
		world.x = x * this.d * invDet - y * this.b * invDet;
		world.y = y * this.a * invDet - x * this.c * invDet;
		return world;
	}

	localToWorld(local: Vector2): Vector2 {
		const x = local.x;
		const y = local.y;
		local.x = x * this.a + y * this.b + this.worldX;
		local.y = x * this.c + y * this.d + this.worldY;
		return local;
	}

	worldToParent(world: Vector2): Vector2 {
		if (!world) throw new Error('world cannot be null.');
		return this.parent ? this.parent.worldToLocal(world) : world;
	}

	parentToWorld(world: Vector2): Vector2 {
		if (!world) throw new Error('world cannot be null.');
		return this.parent ? this.parent.localToWorld(world) : world;
	}

	worldToLocalRotation(worldRotation: number): number {
		const sin = Math.sin(worldRotation * DEG_RAD);
		const cos = Math.cos(worldRotation * DEG_RAD);
		return (
			Math.atan2(this.a * sin - this.c * cos, this.d * cos - this.b * sin) * RAD_DEG +
			this.rotation -
			this.shearX
		);
	}

	localToWorldRotation(localRotation: number): number {
		localRotation -= this.rotation - this.shearX;
		const sin = Math.sin(localRotation * DEG_RAD);
		const cos = Math.cos(localRotation * DEG_RAD);
		return Math.atan2(cos * this.c + sin * this.d, cos * this.a + sin * this.b) * RAD_DEG;
	}

	rotateWorld(degrees: number): void {
		const r = degrees * DEG_RAD;
		const sin = Math.sin(r);
		const cos = Math.cos(r);
		const { a, b, c, d } = this;
		this.a = cos * a - sin * c;
		this.b = cos * b - sin * d;
		this.c = sin * a + cos * c;
		this.d = sin * b + cos * d;
	}
}
