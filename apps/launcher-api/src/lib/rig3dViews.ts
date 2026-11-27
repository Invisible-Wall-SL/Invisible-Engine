/**
 * Drawings by angle in the Rigger (docs/design/rig-2p5d.md §4.7, §9, P5): a slot's views — the
 * drawing made for each angle of the rig's turnaround, which the bake shows as the card turns — read
 * and edited as the views panel shows them; a slot put on an image bone of its own (a drawing is
 * turned back to face the viewer by turning its bone, so nothing else may hang there), either under
 * the bone it sat on or hung from a steadier bone and following it in 3D; a template's drawings set
 * up when a rig is made 3D; and the sidecar kept in step with a rename or a delete. Pure, so the page
 * (`vendor/rigger-2p5d.js`) and the gates run the same code. The `irig` and `doc` given are edited in
 * place, as the page edits its own.
 */
import { viewAngles, viewFallbacks, type Drawing, type Turnaround } from './rig2p5d';
import type { Rig3dDoc } from './rig3d';
import { rig3dFromTemplate, type Template3d } from './rig3dImport';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);
const num = (v: unknown, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** What each angle of a turnaround is called; − is the card turned toward the picture's right. */
export const VIEW_LABELS: Record<string, string> = {
	'0': 'front',
	'-45': '¾ right',
	'45': '¾ left',
	'-90': 'side right',
	'90': 'side left',
	'-135': '¾ back right',
	'135': '¾ back left',
	'180': 'back',
};

/** The part-name suffix a template gives the drawing for each angle (`torso` → `torso_3q_r`). */
export const VIEW_SUFFIXES: Record<string, string> = {
	'-45': '3q_r',
	'45': '3q_l',
	'-90': 'side_r',
	'90': 'side_l',
	'-135': '3q_back_r',
	'135': '3q_back_l',
	'180': 'back',
};

/** The drawings of `front` at every angle of a full turnaround, named as the templates name them. */
export const angleDrawings = (front: string, base = front): Drawing[] => [
	{ attachment: front, turn: 0 },
	...Object.entries(VIEW_SUFFIXES).map(([turn, suffix]) => ({
		attachment: `${base}_${suffix}`,
		turn: Number(turn),
	})),
];

export interface ViewRow {
	angle: number;
	label: string;
	/** The drawing made for this angle, if the slot has one. */
	drawing?: Drawing;
	/** What shows here: its own drawing, or the one it falls back to toward the front. */
	shown: string[];
}

/** A slot's views as the panel lists them: one row per angle of the rig's turnaround. */
export function viewRows(doc: Rig3dDoc, slot: string): ViewRow[] {
	return viewFallbacks(doc.views?.[slot]?.drawings ?? [], doc.turnaround).map((f) => ({
		angle: f.angle,
		label: VIEW_LABELS[String(f.angle)] ?? `${f.angle}°`,
		...(f.own ? { drawing: f.own } : {}),
		shown: f.shown.map((d) => d.attachment),
	}));
}

/**
 * Set the drawing slot `slot` shows at `angle` (one of its turnaround's): `attachment` made for a turn
 * of `turn` (the angle's own by default), or none (`null`), so the angle falls back toward the front.
 * A slot left with no drawing has no views.
 */
export function setViewDrawing(
	doc: Rig3dDoc,
	slot: string,
	angle: number,
	attachment: string | null,
	turn = angle,
): void {
	const view = doc.views?.[slot];
	const own = viewRows(doc, slot).find((r) => r.angle === angle)?.drawing;
	const drawings = (view?.drawings ?? []).filter((d) => d !== own);
	if (attachment !== null) drawings.push({ attachment, turn });
	const order = viewAngles('full');
	const rank = (d: Drawing) => {
		const i = order.findIndex((a) => Math.abs(a - d.turn) < 1e-9);
		return i < 0 ? order.length : i;
	};
	drawings.sort((a, b) => rank(a) - rank(b) || a.turn - b.turn);
	if (drawings.length) (doc.views ??= {})[slot] = { ...view, drawings };
	else if (doc.views) {
		delete doc.views[slot];
		if (!Object.keys(doc.views).length) delete doc.views;
	}
}

/** A slot's margin and hold; `undefined` clears one back to the bake's default. */
export function setViewTiming(
	doc: Rig3dDoc,
	slot: string,
	field: 'margin' | 'hold',
	value: number | undefined,
): void {
	const view = doc.views?.[slot];
	if (!view) return;
	if (value === undefined || !Number.isFinite(value) || value < 0) delete view[field];
	else view[field] = value;
}

/** What else the bone slot `slot` sits on carries: its child bones, its followers, its other slots. */
export function slotCarries(irig: Json, doc: Rig3dDoc | null, slot: string): string[] {
	const bone = list(irig.slots).find((s) => s.name === slot)?.bone;
	if (typeof bone !== 'string') return [];
	return [
		...list(irig.bones)
			.filter((b) => b.parent === bone)
			.map((b) => String(b.name)),
		...Object.entries(doc?.bones ?? {})
			.filter(([, b]) => b.follow === bone)
			.map(([n]) => n),
		...list(irig.slots)
			.filter((s) => s.bone === bone && s.name !== slot)
			.map((s) => String(s.name)),
	];
}

interface Affine {
	a: number;
	b: number;
	c: number;
	d: number;
	x: number;
	y: number;
}
const RAD = Math.PI / 180;

/** A bone's 2D setup local, as engine-rig composes it under Inherit.Normal. */
function localOf(b: Json): Affine {
	const r = num(b.rotation, 0);
	const sx = num(b.scaleX, 1);
	const sy = num(b.scaleY, 1);
	const rx = (r + num(b.shearX, 0)) * RAD;
	const ry = (r + 90 + num(b.shearY, 0)) * RAD;
	return {
		a: Math.cos(rx) * sx,
		b: Math.cos(ry) * sy,
		c: Math.sin(rx) * sx,
		d: Math.sin(ry) * sy,
		x: num(b.x, 0),
		y: num(b.y, 0),
	};
}
const times = (p: Affine, q: Affine): Affine => ({
	a: p.a * q.a + p.b * q.c,
	b: p.a * q.b + p.b * q.d,
	c: p.c * q.a + p.d * q.c,
	d: p.c * q.b + p.d * q.d,
	x: p.a * q.x + p.b * q.y + p.x,
	y: p.c * q.x + p.d * q.y + p.y,
});
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** The bones from `from` (excluded) down to `to` (included), or null when `from` is not above it. */
function chainBelow(irig: Json, from: string, to: string): Json[] | null {
	const byName = new Map(list(irig.bones).map((b) => [b.name, b]));
	const chain: Json[] = [];
	for (let b = byName.get(to); b; b = byName.get(b.parent)) {
		if (b.name === from) return chain.reverse();
		chain.push(b);
	}
	return null;
}

/** The bones a slot's image bone may hang from: the bone it sits on and every bone above it. */
export function imageBoneHosts(irig: Json, slot: string): string[] {
	const bone = list(irig.slots).find((s) => s.name === slot)?.bone;
	const byName = new Map(list(irig.bones).map((b) => [b.name, b]));
	const out: string[] = [];
	for (let b = byName.get(bone); b; b = byName.get(b.parent)) out.push(String(b.name));
	return out;
}

/**
 * Put slot `slot` on an image bone of its own (§4.7), named `<slot>_image` (numbered if taken), added
 * after every other bone so a weighted mesh's bone indices stay put. By default it hangs from the bone
 * the slot sat on, at its origin: the slot draws exactly where it did, in every 2D clip too. Hung from
 * `hangFrom`, a steadier bone above it, it `follow`s that bone in 3D instead: drawn on it, keyed against
 * the steady one, so its keys do not blow up when the turning bone goes edge-on — but it moves only in
 * 3D clips (the bake keys it there); in a 2D clip it stays where the setup has it. Returns its name.
 */
export function addImageBone(irig: Json, doc: Rig3dDoc, slot: string, hangFrom?: string): string {
	const slots = list(irig.slots);
	const s = slots.find((x) => x.name === slot);
	if (!s || typeof s.bone !== 'string') throw new Error(`no slot ${slot}`);
	const bone = s.bone;
	const bones = Array.isArray(irig.bones) ? (irig.bones as Json[]) : (irig.bones = []);
	const taken = new Set(list(bones).map((b) => b.name));
	let name = `${slot}_image`;
	for (let i = 2; taken.has(name); i++) name = `${slot}_image${i}`;
	if (hangFrom === undefined || hangFrom === bone) {
		bones.push({ name, parent: bone });
	} else {
		const chain = chainBelow(irig, hangFrom, bone);
		if (!chain) throw new Error(`${hangFrom} is not a bone above ${bone}`);
		// Placed where the bone it follows is at setup, so the art draws where it did before any bake
		// (the bake then derives the setup from the 3D pose, §3).
		const m = chain.map(localOf).reduce(times);
		const rotation = Math.atan2(m.c, m.a) / RAD;
		const scaleX = Math.hypot(m.a, m.c);
		const scaleY = (m.a * m.d - m.b * m.c) / (scaleX || 1);
		const setup: Json = { name, parent: hangFrom, x: round(m.x), y: round(m.y) };
		if (Math.abs(rotation) > 1e-6) setup.rotation = round(rotation);
		if (Math.abs(scaleX - 1) > 1e-6) setup.scaleX = round(scaleX);
		if (Math.abs(scaleY - 1) > 1e-6) setup.scaleY = round(scaleY);
		bones.push(setup);
		(doc.bones ??= {})[name] = { follow: bone };
	}
	s.bone = name;
	return name;
}

/**
 * The turnarounds a template's rig may take: the template's own, and a full one when the rig's art
 * has a back drawing for one of the template's views (§11.2: chosen when the rig is made 3D).
 */
export function templateTurnarounds(irig: Json, t: Template3d): Turnaround[] {
	if (t.turnaround === 'full') return ['full'];
	const has = attachmentNames(irig);
	const back = Object.entries(t.views ?? {}).some(([slot, drawings]) =>
		drawings.some((d) => Math.abs(d.turn) > 90 && has.get(slot)?.has(d.attachment)),
	);
	return back ? ['side', 'full'] : ['side'];
}

function attachmentNames(irig: Json): Map<string, Set<string>> {
	const skins = Array.isArray(irig.skins)
		? list(irig.skins)
		: isObj(irig.skins)
			? Object.values(irig.skins).map((attachments) => ({ attachments }))
			: [];
	const out = new Map<string, Set<string>>();
	for (const skin of skins)
		for (const [slot, byName] of Object.entries(isObj(skin.attachments) ? skin.attachments : {}))
			if (isObj(byName))
				for (const a of Object.keys(byName)) out.set(slot, (out.get(slot) ?? new Set()).add(a));
	return out;
}

/**
 * Make a template's rig 3D (§9): its 3D data from the template (`rig3dFromTemplate`) at `turnaround`
 * (the template's own by default), with every slot whose art has drawings by angle put on an image
 * bone of its own where its bone carries more (a hand with its fingers, a bust's body with its neck):
 * a child of that bone, so the rig's 2D clips draw exactly as before. Edits `irig`; returns the data.
 */
export function make3dFromTemplate(
	stem: string,
	irig: Json,
	t: Template3d,
	turnaround: Turnaround = t.turnaround,
): Rig3dDoc {
	const doc = rig3dFromTemplate(stem, irig, t, { turnaround, carrying: true });
	for (const slot of Object.keys(doc.views ?? {}))
		if (slotCarries(irig, doc, slot).length) addImageBone(irig, doc, slot);
	return doc;
}

/**
 * The 3D motion map a rig's import solves with: an image the template keeps square to the viewer
 * (a head's outline) takes its bone's turn instead once the rig has drawings for it, so its drawings
 * by angle show as the head turns.
 */
export function motion3dFor<
	E extends { bone: string; viewer?: string },
	M extends { entries: E[] },
>(bones3d: M, irig: Json, doc: Rig3dDoc | null): M {
	const drawn = new Set(
		list(irig.slots)
			.filter((s) => (doc?.views?.[String(s.name)]?.drawings.length ?? 0) > 1)
			.map((s) => s.bone),
	);
	return { ...bones3d, entries: bones3d.entries.filter((e) => !(e.viewer && drawn.has(e.bone))) };
}

/** Keep the 3D data in step with a bone, slot or attachment renamed in the irig. */
export function rename3d(
	doc: Rig3dDoc,
	kind: 'bone' | 'slot' | 'attachment',
	from: string,
	to: string,
	slot?: string,
): void {
	const move = <T>(rec: Record<string, T> | undefined) => {
		if (!rec || !Object.hasOwn(rec, from) || from === to) return;
		rec[to] = rec[from];
		delete rec[from];
	};
	if (kind === 'bone') {
		move(doc.bones);
		for (const b of Object.values(doc.bones ?? {})) if (b.follow === from) b.follow = to;
		for (const c of Object.values(doc.clips ?? {})) move(c.bones);
		for (const e of doc.ik ?? []) {
			e.bones = e.bones.map((b) => (b === from ? to : b));
			for (const f of ['end', 'target', 'pole'] as const) if (e[f] === from) e[f] = to;
		}
	} else if (kind === 'slot') {
		move(doc.views);
		for (const [l, members] of Object.entries(doc.layers ?? {}))
			doc.layers![l] = members.map((m) => (m === from ? to : m));
		if (doc.locks)
			doc.locks = doc.locks.map(([a, b]): [string, string] => [
				a === from ? to : a,
				b === from ? to : b,
			]);
	} else {
		for (const d of (slot === undefined ? undefined : doc.views?.[slot])?.drawings ?? [])
			if (d.attachment === from) d.attachment = to;
	}
}

/**
 * The 3D data without what names a bone, slot or attachment the irig no longer has (a delete): its
 * depth and keys, a follow of it (the follower becomes a plain bone), its drawings, its place in a
 * layer or a draw-order lock, a 3D IK it is a part of. True when anything went.
 */
export function fit3dToRig(doc: Rig3dDoc, irig: Json): boolean {
	const before = JSON.stringify(doc);
	const bones = new Set(list(irig.bones).map((b) => b.name));
	const slots = new Set(list(irig.slots).map((s) => s.name));
	const has = attachmentNames(irig);
	for (const [n, b] of Object.entries(doc.bones ?? {})) {
		if (b.follow !== undefined && !bones.has(b.follow)) delete b.follow;
		if (!bones.has(n) || !Object.keys(b).length) delete doc.bones![n];
	}
	for (const c of Object.values(doc.clips ?? {}))
		for (const n of Object.keys(c.bones)) if (!bones.has(n)) delete c.bones[n];
	// A 3D IK goes with a bone of its chain or its control (and its clips' mixes with it); its pole
	// alone only stops bending it.
	const iks = (doc.ik ?? []).filter((e) =>
		[...e.bones, e.end, e.target].every((n) => n === undefined || bones.has(n)),
	);
	for (const e of iks) if (e.pole !== undefined && !bones.has(e.pole)) delete e.pole;
	const gone = new Set((doc.ik ?? []).filter((e) => !iks.includes(e)).map((e) => e.name));
	if (doc.ik) {
		if (iks.length) doc.ik = iks;
		else delete doc.ik;
	}
	for (const c of Object.values(doc.clips ?? {})) {
		for (const n of gone) delete c.ik?.[n];
		if (c.ik && !Object.keys(c.ik).length) delete c.ik;
	}
	for (const [slot, view] of Object.entries(doc.views ?? {})) {
		view.drawings = view.drawings.filter((d) => has.get(slot)?.has(d.attachment));
		if (!slots.has(slot) || !view.drawings.length) delete doc.views![slot];
	}
	for (const [l, members] of Object.entries(doc.layers ?? {})) {
		const kept = members.filter((m) => slots.has(m));
		if (kept.length > 1) doc.layers![l] = kept;
		else delete doc.layers![l];
	}
	for (const k of ['bones', 'views', 'layers'] as const)
		if (doc[k] && !Object.keys(doc[k]!).length) delete doc[k];
	if (doc.locks) {
		const kept = doc.locks.filter(([a, b]) => slots.has(a) && slots.has(b));
		if (kept.length) doc.locks = kept;
		else delete doc.locks;
	}
	return JSON.stringify(doc) !== before;
}
