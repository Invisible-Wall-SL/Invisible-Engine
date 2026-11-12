import { Color } from 'engine-rig';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const keysOf = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);

/** The oldest 3.x export the upgrader reads: 3.8 is the last 3.x format and the one it is built on. */
export const OLDEST_UPGRADABLE = [3, 8] as const;

/** `skeleton.spine`'s major.minor, or null when the file does not say. */
export function exportVersion(doc: Json): [number, number] | null {
	const v = isObject(doc.skeleton) ? doc.skeleton.spine : undefined;
	const m = typeof v === 'string' ? /^(\d+)\.(\d+)/.exec(v) : null;
	return m ? [Number(m[1]), Number(m[2])] : null;
}

/** True for an export the upgrader takes: 3.8 or a later 3.x. */
export function isUpgradableSpine3(doc: Json): boolean {
	const v = exportVersion(doc);
	return !!v && v[0] === 3 && v[1] >= OLDEST_UPGRADABLE[1];
}

type Curve = 'linear' | 'stepped' | [number, number, number, number];

/** A 3.x key's curve: `"stepped"`, a number `cx1` with `c2`–`c4` (3.8), or `[cx1, cy1, cx2, cy2]`. */
function curveOf(key: Json): Curve {
	const c = key.curve;
	if (c === 'stepped') return 'stepped';
	if (typeof c === 'number') return [c, num(key.c2, 0), num(key.c3, 1), num(key.c4, 1)];
	if (Array.isArray(c) && c.length >= 4 && c.every((n) => typeof n === 'number'))
		return [c[0], c[1], c[2], c[3]];
	return 'linear';
}

/**
 * Rewrite a timeline's 3.x curves as 4.x ones. A 3.x Bézier is one shape shared by every value of
 * the key, normalised to the segment (0–1 in time and in value); a 4.x key has one Bézier per value,
 * in absolute time and value. `values` reads each value of a key the way the 4.2 reader does,
 * `ends` fixes the value range where the reader does (deform: 0 to 1). Must run after the keys'
 * fields are renamed, since it reads them by their 4.x names.
 */
function convertCurves(
	keys: Json[],
	values: Array<(k: Json) => number>,
	ends?: [number, number],
): void {
	const curves = keys.map(curveOf);
	keys.forEach((k, f) => {
		delete k.curve;
		delete k.c2;
		delete k.c3;
		delete k.c4;
		const c = curves[f];
		if (f === keys.length - 1 || c === 'linear') return;
		if (c === 'stepped') {
			k.curve = 'stepped';
			return;
		}
		const next = keys[f + 1];
		const t1 = num(k.time, 0);
		const t2 = num(next.time, 0);
		const out: number[] = [];
		for (const value of values) {
			const [v1, v2] = ends ?? [value(k), value(next)];
			out.push(
				t1 + c[0] * (t2 - t1),
				v1 + c[1] * (v2 - v1),
				t1 + c[2] * (t2 - t1),
				v1 + c[3] * (v2 - v1),
			);
		}
		k.curve = out;
	});
}

function rename(obj: Json, from: string, to: string): void {
	if (!(from in obj)) return;
	if (!(to in obj)) obj[to] = obj[from];
	delete obj[from];
}

/** 3.x mix names → 4.x: `translateMix` is now `mixX` (and `mixY` defaults to it), and so on. */
function renameMixes(obj: Json): void {
	rename(obj, 'rotateMix', 'mixRotate');
	rename(obj, 'translateMix', 'mixX');
	rename(obj, 'scaleMix', 'mixScaleX');
	rename(obj, 'shearMix', 'mixShearY');
}

const rgba = (hex: unknown): number[] => {
	const c = Color.fromString(typeof hex === 'string' ? hex : 'ffffffff');
	return [c.r, c.g, c.b, c.a];
};

/**
 * 3.x rotated a bone between two keys the SHORT way round (the difference wrapped into ±180°); 4.x
 * interpolates the numbers as written. Each key is moved by whole turns so the step from the
 * previous key is the one 3.x took — the same poses, with the in-betweens 3.x played.
 */
function unwrapRotation(keys: Json[]): void {
	let prev: number | null = null;
	for (const k of keys) {
		let v = num(k.angle, 0);
		delete k.angle;
		if (prev !== null) v = prev + (v - prev - 360 * Math.round((v - prev) / 360));
		k.value = v;
		prev = v;
	}
}

function upgradeBoneTimelines(bones: Json): void {
	for (const timelines of Object.values(bones).filter(isObject)) {
		for (const [name, raw] of Object.entries(timelines)) {
			const keys = keysOf(raw);
			if (name === 'rotate') {
				unwrapRotation(keys);
				convertCurves(keys, [(k) => num(k.value, 0)]);
			} else if (name === 'translate' || name === 'shear' || name === 'scale') {
				const d = name === 'scale' ? 1 : 0;
				convertCurves(keys, [(k) => num(k.x, d), (k) => num(k.y, d)]);
			}
		}
	}
}

function upgradeSlotTimelines(slots: Json): void {
	for (const timelines of Object.values(slots).filter(isObject)) {
		if (Array.isArray(timelines.color)) {
			const keys = keysOf(timelines.color);
			convertCurves(
				keys,
				[0, 1, 2, 3].map((i) => (k: Json) => rgba(k.color)[i]),
			);
			timelines.rgba = keys;
			delete timelines.color;
		}
		if (Array.isArray(timelines.twoColor)) {
			const keys = keysOf(timelines.twoColor);
			const values = (k: Json): number[] => [...rgba(k.light), ...rgba(k.dark).slice(0, 3)];
			convertCurves(
				keys,
				[0, 1, 2, 3, 4, 5, 6].map((i) => (k: Json) => values(k)[i]),
			);
			timelines.rgba2 = keys;
			delete timelines.twoColor;
		}
	}
}

function upgradeAnimation(anim: Json): void {
	if (isObject(anim.bones)) upgradeBoneTimelines(anim.bones);
	if (isObject(anim.slots)) upgradeSlotTimelines(anim.slots);

	for (const raw of Object.values(isObject(anim.ik) ? anim.ik : {})) {
		convertCurves(keysOf(raw), [(k) => num(k.mix, 1), (k) => num(k.softness, 0)]);
	}
	for (const raw of Object.values(isObject(anim.transform) ? anim.transform : {})) {
		const keys = keysOf(raw);
		keys.forEach(renameMixes);
		const values = (k: Json): number[] => {
			const x = num(k.mixX, 1);
			const sx = num(k.mixScaleX, 1);
			return [
				num(k.mixRotate, 1),
				x,
				num(k.mixY, x),
				sx,
				num(k.mixScaleY, sx),
				num(k.mixShearY, 1),
			];
		};
		convertCurves(
			keys,
			[0, 1, 2, 3, 4, 5].map((i) => (k: Json) => values(k)[i]),
		);
	}
	for (const timelines of Object.values(isObject(anim.path) ? anim.path : {}).filter(isObject)) {
		for (const name of ['position', 'spacing'] as const) {
			const keys = keysOf(timelines[name]);
			keys.forEach((k) => rename(k, name, 'value'));
			convertCurves(keys, [(k) => num(k.value, 0)]);
		}
		const mix = keysOf(timelines.mix);
		mix.forEach(renameMixes);
		const values = (k: Json): number[] => {
			const x = num(k.mixX, 1);
			return [num(k.mixRotate, 1), x, num(k.mixY, x)];
		};
		convertCurves(
			mix,
			[0, 1, 2].map((i) => (k: Json) => values(k)[i]),
		);
	}
	// Deform moved under `attachments.<skin>.<slot>.<attachment>.deform`.
	const deform = isObject(anim.deform) ? anim.deform : null;
	delete anim.deform;
	if (deform) {
		const attachments = (isObject(anim.attachments) ? anim.attachments : {}) as Json;
		for (const [skin, slots] of Object.entries(deform).filter(([, v]) => isObject(v))) {
			const skinOut = (attachments[skin] ??= {}) as Json;
			for (const [slot, atts] of Object.entries(slots as Json).filter(([, v]) => isObject(v))) {
				const slotOut = (skinOut[slot] ??= {}) as Json;
				for (const [att, raw] of Object.entries(atts as Json)) {
					const keys = keysOf(raw);
					convertCurves(keys, [() => 0], [0, 1]);
					slotOut[att] = { ...(isObject(slotOut[att]) ? slotOut[att] : {}), deform: keys };
				}
			}
		}
		anim.attachments = attachments;
	}
	rename(anim, 'draworder', 'drawOrder');
}

/**
 * Upgrade a 3.8 skeleton export to the 4.2 JSON format, so it imports like any 4.x export.
 * Every change is a renaming or reshaping with the same meaning, nothing is guessed:
 * bone `transform` → `inherit`; constraint mixes (`rotateMix` → `mixRotate`, `translateMix` →
 * `mixX`, `scaleMix` → `mixScaleX`, `shearMix` → `mixShearY`); linked mesh `deform` → `timelines`;
 * skins keyed by name → a list; slot `color` / `twoColor` keys → `rgba` / `rgba2`; rotate `angle`
 * → `value` (unwrapped, see `unwrapRotation`); path `position` / `spacing` keys → `value`;
 * animation `deform` → `attachments.….deform`; and every curve → per-value absolute Béziers
 * (`convertCurves`). The atlas needs nothing: the atlas reader reads the 3.x region fields.
 * Returns a new document; the input is not changed.
 */
export function upgradeSpine38Json(input: Json): Json {
	const doc = JSON.parse(JSON.stringify(input)) as Json;
	if (isObject(doc.skeleton)) doc.skeleton.spine = '4.2';

	for (const bone of keysOf(doc.bones)) rename(bone, 'transform', 'inherit');
	for (const c of keysOf(doc.transform)) renameMixes(c);
	for (const c of keysOf(doc.path)) renameMixes(c);

	if (isObject(doc.skins))
		doc.skins = Object.entries(doc.skins).map(([name, attachments]) => ({ name, attachments }));
	for (const skin of keysOf(doc.skins)) {
		for (const slot of Object.values(isObject(skin.attachments) ? skin.attachments : {})) {
			for (const att of Object.values(isObject(slot) ? slot : {}).filter(isObject)) {
				if (att.type === 'linkedmesh') rename(att, 'deform', 'timelines');
			}
		}
	}

	for (const anim of Object.values(isObject(doc.animations) ? doc.animations : {}).filter(isObject))
		upgradeAnimation(anim);
	return doc;
}
