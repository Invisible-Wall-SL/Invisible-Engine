/** π as the 4.2 data format fixes it (single precision). Degree↔radian conversions and
 * angle wrapping use it so a pose lands on exactly the same values every runtime of the format
 * computes — it decides, for example, which way a constraint turns toward a bone at exactly 180°. */
export const PI = 3.1415927;
export const PI2 = PI * 2;
export const DEG_RAD = PI / 180;
export const RAD_DEG = 180 / PI;

export const MathUtils = {
	PI,
	PI2,
	invPI2: 1 / PI2,
	degRad: DEG_RAD,
	degreesToRadians: DEG_RAD,
	radDeg: RAD_DEG,
	radiansToDegrees: RAD_DEG,
	clamp: (value: number, min: number, max: number): number =>
		value < min ? min : value > max ? max : value,
	cosDeg: (degrees: number): number => Math.cos(degrees * DEG_RAD),
	sinDeg: (degrees: number): number => Math.sin(degrees * DEG_RAD),
	atan2Deg: (y: number, x: number): number => Math.atan2(y, x) * RAD_DEG,
	signum: (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0),
	toInt: (x: number): number => (x > 0 ? Math.floor(x) : Math.ceil(x)),
};

export const signum = MathUtils.signum;

/** Wraps an angle in radians into (-PI, PI] the way a single correction step does. */
export function wrapRadians(r: number): number {
	if (r > PI) return r - PI2;
	if (r < -PI) return r + PI2;
	return r;
}

export class Vector2 {
	constructor(
		public x = 0,
		public y = 0,
	) {}

	set(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	length(): number {
		return Math.sqrt(this.x * this.x + this.y * this.y);
	}

	normalize(): this {
		const len = this.length();
		if (len !== 0) {
			this.x /= len;
			this.y /= len;
		}
		return this;
	}
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Color {
	static WHITE = new Color(1, 1, 1, 1);
	static RED = new Color(1, 0, 0, 1);
	static GREEN = new Color(0, 1, 0, 1);
	static BLUE = new Color(0, 0, 1, 1);
	static MAGENTA = new Color(1, 0, 1, 1);

	constructor(
		public r = 0,
		public g = 0,
		public b = 0,
		public a = 0,
	) {}

	set(r: number, g: number, b: number, a: number): this {
		this.r = r;
		this.g = g;
		this.b = b;
		this.a = a;
		return this.clamp();
	}

	setFromColor(c: Color): this {
		this.r = c.r;
		this.g = c.g;
		this.b = c.b;
		this.a = c.a;
		return this;
	}

	/** Reads `rrggbb` or `rrggbbaa` (alpha 1 when absent). A leading `#` is accepted. */
	setFromString(hex: string): this {
		const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
		this.r = parseInt(h.slice(0, 2), 16) / 255;
		this.g = parseInt(h.slice(2, 4), 16) / 255;
		this.b = parseInt(h.slice(4, 6), 16) / 255;
		this.a = h.length !== 8 ? 1 : parseInt(h.slice(6, 8), 16) / 255;
		return this;
	}

	add(r: number, g: number, b: number, a: number): this {
		this.r += r;
		this.g += g;
		this.b += b;
		this.a += a;
		return this.clamp();
	}

	clamp(): this {
		this.r = clamp01(this.r);
		this.g = clamp01(this.g);
		this.b = clamp01(this.b);
		this.a = clamp01(this.a);
		return this;
	}

	static rgba8888ToColor(color: Color, value: number): void {
		color.r = ((value & 0xff000000) >>> 24) / 255;
		color.g = ((value & 0x00ff0000) >>> 16) / 255;
		color.b = ((value & 0x0000ff00) >>> 8) / 255;
		color.a = (value & 0x000000ff) / 255;
	}

	static rgb888ToColor(color: Color, value: number): void {
		color.r = ((value & 0x00ff0000) >>> 16) / 255;
		color.g = ((value & 0x0000ff00) >>> 8) / 255;
		color.b = (value & 0x000000ff) / 255;
	}

	toRgb888(): number {
		const c = (v: number): number => Math.round(clamp01(v) * 255);
		return (c(this.r) << 16) | (c(this.g) << 8) | c(this.b);
	}

	static fromString(hex: string, out = new Color()): Color {
		return out.setFromString(hex);
	}
}

export type NumberArrayLike = number[] | Float32Array;

/** Grows or shrinks a plain array to `size`, filling new slots with `value`. */
export function setArraySize<T>(array: T[], size: number, value: T): T[] {
	const old = array.length;
	if (old === size) return array;
	array.length = size;
	for (let i = old; i < size; i++) array[i] = value;
	return array;
}
