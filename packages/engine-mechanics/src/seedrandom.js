/**
 * SEEDRANDOM'S ARC4 STREAM, PORTED (`docs/design/salmons-levels.md` §2 a): the PRNG the original
 * Salmons (`GuiltyForever/Salmon-`) builds its map with, `seedrandom` 3.0.5's default
 * `seedrandom(seed)` (ARC4, RC4-drop[256], 52-bit doubles), so a seed makes the very map the original
 * made. Only the string-seed path is ported: a number is used as its decimal string, as the original's
 * own seeds are strings. `check:salmons-levels` holds it to streams recorded from the real package.
 * Plain, dependency-free ESM like the rest of the package.
 */

const WIDTH = 256;
const MASK = WIDTH - 1;
const CHUNKS = 6;
const START_DENOM = WIDTH ** CHUNKS;
const SIGNIFICANCE = 2 ** 52;
const OVERFLOW = SIGNIFICANCE * 2;

/** seedrandom's `mixkey`: the key bytes a seed string smears into. */
function mixKey(seed) {
	const key = [];
	let smear = 0;
	for (let j = 0; j < seed.length; j++) {
		smear ^= (key[MASK & j] ?? 0) * 19;
		key[MASK & j] = MASK & (smear + seed.charCodeAt(j));
	}
	return key;
}

/** An ARC4 keystream on `key`, its first 256 bytes dropped; `g(n)` reads n bytes as one number. */
function arc4(key) {
	const s = [];
	const k = key.length ? key : [0];
	let j = 0;
	for (let i = 0; i < WIDTH; i++) s[i] = i;
	for (let i = 0; i < WIDTH; i++) {
		const t = s[i];
		j = MASK & (j + k[i % k.length] + t);
		s[i] = s[j];
		s[j] = t;
	}
	let i = 0;
	j = 0;
	const g = (count) => {
		let r = 0;
		for (let n = count; n > 0; n--) {
			i = MASK & (i + 1);
			const t = s[i];
			j = MASK & (j + t);
			s[i] = s[j];
			s[j] = t;
			r = r * WIDTH + s[MASK & (s[i] + s[j])];
		}
		return r;
	};
	g(WIDTH);
	return g;
}

/** `seedrandom(seed)`: a function returning doubles in [0, 1), the same stream for the same seed. */
export function seedRandom(seed) {
	const g = arc4(mixKey(String(seed)));
	return () => {
		let n = g(CHUNKS);
		let d = START_DENOM;
		let x = 0;
		while (n < SIGNIFICANCE) {
			n = (n + x) * WIDTH;
			d *= WIDTH;
			x = g(1);
		}
		while (n >= OVERFLOW) {
			n /= 2;
			d /= 2;
			x >>>= 1;
		}
		return (n + x) / d;
	};
}
