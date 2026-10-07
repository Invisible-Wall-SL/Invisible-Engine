/** A 3-component vector (the third component is carried through 2D projections). */
export class Vector3 {
	constructor(
		public x = 0,
		public y = 0,
		public z = 0,
	) {}

	set(x: number, y: number, z: number): this {
		this.x = x;
		this.y = y;
		this.z = z;
		return this;
	}

	setFrom(v: Vector3): this {
		return this.set(v.x, v.y, v.z);
	}

	add(v: Vector3): this {
		return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
	}

	sub(v: Vector3): this {
		return this.set(this.x - v.x, this.y - v.y, this.z - v.z);
	}

	scale(s: number): this {
		return this.set(this.x * s, this.y * s, this.z * s);
	}

	length(): number {
		return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
	}

	normalize(): this {
		const len = this.length();
		return len === 0 ? this : this.scale(1 / len);
	}

	dot(v: Vector3): number {
		return this.x * v.x + this.y * v.y + this.z * v.z;
	}

	cross(v: Vector3): this {
		return this.set(
			this.y * v.z - this.z * v.y,
			this.z * v.x - this.x * v.z,
			this.x * v.y - this.y * v.x,
		);
	}

	distance(v: Vector3): number {
		const dx = v.x - this.x;
		const dy = v.y - this.y;
		const dz = v.z - this.z;
		return Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
}

/**
 * Orthographic 2D camera looking down -z. `position` is the world point at the viewport centre,
 * `zoom` the world units per pixel, `up` the world direction drawn as screen-up (rotation/flip).
 */
export class OrthoCamera {
	position = new Vector3(0, 0, 0);
	direction = new Vector3(0, 0, -1);
	up = new Vector3(0, 1, 0);
	near = 0;
	far = 100;
	zoom = 1;
	/** Column-major 4×4 world → clip matrix, refreshed by `update`. */
	projectionView = new Float32Array(16);
	private ax = 1;
	private ay = 0;
	private bx = 0;
	private by = 1;

	constructor(
		public viewportWidth: number,
		public viewportHeight: number,
	) {
		this.update();
	}

	update(): void {
		const len = Math.hypot(this.up.x, this.up.y) || 1;
		// Screen-right is up rotated a quarter turn clockwise.
		this.bx = this.up.x / len;
		this.by = this.up.y / len;
		this.ax = this.by;
		this.ay = -this.bx;
		const sx = 2 / (this.zoom * this.viewportWidth);
		const sy = 2 / (this.zoom * this.viewportHeight);
		const sz = -2 / (this.far - this.near);
		const px = this.position.x;
		const py = this.position.y;
		const pz = this.position.z;
		const m = this.projectionView;
		m.fill(0);
		m[0] = this.ax * sx;
		m[4] = this.ay * sx;
		m[12] = -(this.ax * px + this.ay * py) * sx;
		m[1] = this.bx * sy;
		m[5] = this.by * sy;
		m[13] = -(this.bx * px + this.by * py) * sy;
		m[10] = sz;
		m[14] = -pz * sz - (this.far + this.near) / (this.far - this.near);
		m[15] = 1;
	}

	/** Canvas pixels (y down) → world. */
	screenToWorld(screen: Vector3, screenWidth: number, screenHeight: number): Vector3 {
		const nx = (2 * screen.x) / screenWidth - 1;
		const ny = (2 * (screenHeight - screen.y - 1)) / screenHeight - 1;
		const vx = (nx * this.zoom * this.viewportWidth) / 2;
		const vy = (ny * this.zoom * this.viewportHeight) / 2;
		screen.x = this.position.x + vx * this.ax + vy * this.bx;
		screen.y = this.position.y + vx * this.ay + vy * this.by;
		screen.z = this.position.z;
		return screen;
	}

	/** World → canvas pixels with y UP (0 at the bottom edge). */
	worldToScreen(world: Vector3, screenWidth: number, screenHeight: number): Vector3 {
		const m = this.projectionView;
		const nx = m[0] * world.x + m[4] * world.y + m[12];
		const ny = m[1] * world.x + m[5] * world.y + m[13];
		const nz = m[10] * world.z + m[14];
		world.x = (screenWidth * (nx + 1)) / 2;
		world.y = (screenHeight * (ny + 1)) / 2;
		world.z = (nz + 1) / 2;
		return world;
	}

	setViewport(width: number, height: number): void {
		this.viewportWidth = width;
		this.viewportHeight = height;
	}
}
