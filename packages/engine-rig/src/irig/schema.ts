/**
 * The irig v1 schema, written once as data: the importer, the reader and the TypeScript types all
 * come from this table, so a field cannot be typed one way and checked another.
 *
 * v1 is the 4.2-format skeleton JSON's meaning, field for field (`SkeletonJson` reads exactly these
 * keys), plus our extensions: a region's `pivot` and an animation event's `fx` / `flipbook` binding.
 * Design: docs/design/irig-format.md.
 */

interface Num {
	kind: 'num';
}
interface Str {
	kind: 'str';
}
interface Bool {
	kind: 'bool';
}
interface Lit<V extends string> {
	kind: 'lit';
	values: readonly V[];
}
interface Arr<E extends Field> {
	kind: 'arr';
	of: E;
	/** Exactly this many elements. */
	length?: number;
}
interface MapOf<E extends Field> {
	kind: 'map';
	of: E;
}
interface Curve {
	kind: 'curve';
}
type Fields = Record<string, Field>;
interface Obj<F extends Fields, R extends keyof F> {
	kind: 'obj';
	fields: F;
	required: readonly R[];
}
type Cases = Record<string, Obj<Fields, string>>;
interface Variant<C extends Cases> {
	kind: 'variant';
	/** The case a value with no `type` key is. */
	fallback: keyof C & string;
	cases: C;
}
export type Field =
	| Num
	| Str
	| Bool
	| Lit<string>
	| Arr<Field>
	| MapOf<Field>
	| Curve
	| Obj<Fields, string>
	| Variant<Cases>;

export type Infer<T> = T extends Num
	? number
	: T extends Str
		? string
		: T extends Bool
			? boolean
			: T extends Lit<infer V>
				? V
				: T extends Arr<infer E>
					? Infer<E>[]
					: T extends MapOf<infer E>
						? Record<string, Infer<E>>
						: T extends Curve
							? 'stepped' | number[]
							: T extends Obj<infer F, infer R>
								? { [K in R]: Infer<F[K]> } & { [K in Exclude<keyof F, R>]?: Infer<F[K]> }
								: T extends Variant<infer C>
									? { [K in keyof C]: Infer<C[K]> & { type?: K } }[keyof C]
									: never;

const num: Num = { kind: 'num' };
const str: Str = { kind: 'str' };
const bool: Bool = { kind: 'bool' };
const curve: Curve = { kind: 'curve' };
const lit = <V extends string>(...values: V[]): Lit<V> => ({ kind: 'lit', values });
const arr = <E extends Field>(of: E, length?: number): Arr<E> => ({ kind: 'arr', of, length });
const map = <E extends Field>(of: E): MapOf<E> => ({ kind: 'map', of });
const obj = <F extends Fields, R extends keyof F & string = never>(
	fields: F,
	required: readonly R[] = [],
): Obj<F, R> => ({ kind: 'obj', fields, required });
const variant = <C extends Cases>(fallback: keyof C & string, cases: C): Variant<C> => ({
	kind: 'variant',
	fallback,
	cases,
});

const strings = arr(str);
const numbers = arr(num);

const header = obj({
	hash: str,
	/** The 4.2 header's `spine` version, kept for provenance; nothing reads it. */
	importedFrom: str,
	x: num,
	y: num,
	width: num,
	height: num,
	fps: num,
	referenceScale: num,
	images: str,
	audio: str,
});

const bone = obj(
	{
		name: str,
		parent: str,
		length: num,
		x: num,
		y: num,
		rotation: num,
		scaleX: num,
		scaleY: num,
		shearX: num,
		shearY: num,
		inherit: lit(
			'normal',
			'onlyTranslation',
			'noRotationOrReflection',
			'noScale',
			'noScaleOrReflection',
		),
		skin: bool,
		color: str,
	},
	['name'],
);

const slot = obj(
	{
		name: str,
		bone: str,
		color: str,
		dark: str,
		attachment: str,
		blend: lit('normal', 'additive', 'multiply', 'screen'),
		visible: bool,
	},
	['name', 'bone'],
);

const constraintBase = { name: str, order: num, skin: bool, bones: strings };

const ik = obj(
	{
		...constraintBase,
		target: str,
		mix: num,
		softness: num,
		bendPositive: bool,
		compress: bool,
		stretch: bool,
		uniform: bool,
	},
	['name', 'bones', 'target'],
);

const transform = obj(
	{
		...constraintBase,
		target: str,
		local: bool,
		relative: bool,
		rotation: num,
		x: num,
		y: num,
		scaleX: num,
		scaleY: num,
		shearY: num,
		mixRotate: num,
		mixX: num,
		mixY: num,
		mixScaleX: num,
		mixScaleY: num,
		mixShearY: num,
	},
	['name', 'bones', 'target'],
);

const path = obj(
	{
		...constraintBase,
		target: str,
		positionMode: lit('fixed', 'percent'),
		spacingMode: lit('length', 'fixed', 'percent', 'proportional'),
		rotateMode: lit('tangent', 'chain', 'chainScale'),
		rotation: num,
		position: num,
		spacing: num,
		mixRotate: num,
		mixX: num,
		mixY: num,
	},
	['name', 'bones', 'target'],
);

const physics = obj(
	{
		name: str,
		order: num,
		skin: bool,
		bone: str,
		x: num,
		y: num,
		rotate: num,
		scaleX: num,
		shearX: num,
		limit: num,
		fps: num,
		inertia: num,
		strength: num,
		damping: num,
		mass: num,
		wind: num,
		gravity: num,
		mix: num,
		inertiaGlobal: bool,
		strengthGlobal: bool,
		dampingGlobal: bool,
		massGlobal: bool,
		windGlobal: bool,
		gravityGlobal: bool,
		mixGlobal: bool,
	},
	['name', 'bone'],
);

const sequence = obj({ count: num, start: num, digits: num, setup: num });

const vertexFields = { name: str, color: str, vertexCount: num, vertices: numbers };

const mesh = obj({
	name: str,
	color: str,
	path: str,
	width: num,
	height: num,
	sequence,
	parent: str,
	skin: str,
	timelines: bool,
	uvs: numbers,
	triangles: numbers,
	vertices: numbers,
	hull: num,
	edges: numbers,
});

const attachment = variant('region', {
	region: obj({
		name: str,
		color: str,
		path: str,
		x: num,
		y: num,
		scaleX: num,
		scaleY: num,
		rotation: num,
		width: num,
		height: num,
		sequence,
		/** Extension: the image's anchor as `[u, v]` across / down, 0..1; centred when absent. */
		pivot: arr(num, 2),
	}),
	mesh,
	linkedmesh: mesh,
	boundingbox: obj(vertexFields),
	path: obj({ ...vertexFields, closed: bool, constantSpeed: bool, lengths: numbers }),
	point: obj({ name: str, color: str, x: num, y: num, rotation: num }),
	clipping: obj({ ...vertexFields, end: str }),
});

const skin = obj(
	{
		name: str,
		bones: strings,
		ik: strings,
		transform: strings,
		path: strings,
		physics: strings,
		attachments: map(map(attachment)),
	},
	['name'],
);

const eventDef = obj({ int: num, float: num, string: str, audio: str, volume: num, balance: num });

const key1 = arr(obj({ time: num, value: num, curve }));
const key2 = arr(obj({ time: num, x: num, y: num, curve }));

/** Extension: content an event plays on a bone; read by `rigFxExport.ts` / `rigFlipbookExport.ts`. */
const fxBinding = obj({
	effectId: str,
	bone: str,
	slot: str,
	continuous: bool,
	alpha: num,
	scale: num,
	delay: num,
	duration: num,
	speed: num,
});
const flipbookBinding = obj({
	clipId: str,
	bone: str,
	slot: str,
	continuous: bool,
	loop: bool,
	flipX: bool,
	flipY: bool,
	direction: lit('forward', 'reverse', 'pingpong'),
	alpha: num,
	scale: num,
	delay: num,
	duration: num,
	fps: num,
});

const animation = obj({
	slots: map(
		obj({
			attachment: arr(obj({ time: num, name: str })),
			rgba: arr(obj({ time: num, color: str, curve })),
			rgb: arr(obj({ time: num, color: str, curve })),
			alpha: key1,
			rgba2: arr(obj({ time: num, light: str, dark: str, curve })),
			rgb2: arr(obj({ time: num, light: str, dark: str, curve })),
		}),
	),
	bones: map(
		obj({
			rotate: key1,
			translate: key2,
			translatex: key1,
			translatey: key1,
			scale: key2,
			scalex: key1,
			scaley: key1,
			shear: key2,
			shearx: key1,
			sheary: key1,
			inherit: arr(obj({ time: num, inherit: bone.fields.inherit })),
		}),
	),
	ik: map(
		arr(
			obj({
				time: num,
				mix: num,
				softness: num,
				bendPositive: bool,
				compress: bool,
				stretch: bool,
				curve,
			}),
		),
	),
	transform: map(
		arr(
			obj({
				time: num,
				mixRotate: num,
				mixX: num,
				mixY: num,
				mixScaleX: num,
				mixScaleY: num,
				mixShearY: num,
				curve,
			}),
		),
	),
	path: map(
		obj({
			position: key1,
			spacing: key1,
			mix: arr(obj({ time: num, mixRotate: num, mixX: num, mixY: num, curve })),
		}),
	),
	physics: map(
		obj({
			inertia: key1,
			strength: key1,
			damping: key1,
			mass: key1,
			wind: key1,
			gravity: key1,
			mix: key1,
			reset: arr(obj({ time: num })),
		}),
	),
	attachments: map(
		map(
			map(
				obj({
					deform: arr(obj({ time: num, offset: num, vertices: numbers, curve })),
					sequence: arr(
						obj({
							time: num,
							delay: num,
							index: num,
							mode: lit(
								'hold',
								'once',
								'loop',
								'pingpong',
								'onceReverse',
								'loopReverse',
								'pingpongReverse',
							),
						}),
					),
				}),
			),
		),
	),
	drawOrder: arr(
		obj({ time: num, offsets: arr(obj({ slot: str, offset: num }, ['slot', 'offset'])) }),
	),
	events: arr(
		obj(
			{
				time: num,
				name: str,
				int: num,
				float: num,
				string: str,
				volume: num,
				balance: num,
				fx: fxBinding,
				flipbook: flipbookBinding,
			},
			['name'],
		),
	),
});

/** The fields every format shares: what a 4.2 file holds, renamed nowhere but the header. */
export const RIG_FIELDS = {
	skeleton: header,
	bones: arr(bone),
	slots: arr(slot),
	ik: arr(ik),
	transform: arr(transform),
	path: arr(path),
	physics: arr(physics),
	skins: arr(skin),
	events: map(eventDef),
	animations: map(animation),
};

export const IRIG_VERSION = 1;

export const IRIG_V1 = obj({ irig: num, ...RIG_FIELDS }, ['irig', 'bones']);

export type IrigDoc = Infer<typeof IRIG_V1>;
export type IrigAttachment = Infer<typeof attachment>;
export type IrigAnimation = Infer<typeof animation>;
