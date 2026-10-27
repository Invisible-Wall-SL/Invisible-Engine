/**
 * Invisible FX — the `/fx` EXPOSED-PARAMETER editing model (`invisible-fx.md` §"Direction
 * (2026-10-15)", Step 1). Pure, like `fxModel.client.ts`: the page wraps these in runes and the
 * `tools/fx-spike` gate runs them headlessly.
 *
 * ⚡ Expose works on any inspector row without a hand-written path list: the page runs the row's own
 * setter on a scratch copy of the layer at the row's two ends (and its middle), and
 * {@link rowExposure} diffs the leaves that changed. A row that writes several leaves exposes all of
 * them; a leaf that does not move linearly with the row (a clamp's side effect) is dropped, and a row
 * with no linear leaf at all is exposed through its own leaf instead. The path grammar, the mapping
 * and the defaults-in-config writer are `engine-fx`'s.
 */

import type { ElementFxParamSpec } from 'constants-shared/elementFx';
import {
	applyEffectParamDefaults,
	canonicalEffectParamPath,
	effectParamValue,
	isHexColor,
	listEffectLayerLeaves,
	validateEffectParams,
	type EffectDoc,
	type EffectParam,
	type EffectParamDrive,
	type EffectParamIssue,
	type EffectParamKind,
	type EffectParamLeaf,
	type EffectParamValue,
	type EmitterLayer,
} from 'engine-fx';

/** One leaf an inspector row writes, with its value at the row's two ends. */
export interface RowLeaf {
	path: string;
	kind: EffectParamKind;
	low: EffectParamValue;
	high: EffectParamValue;
	/** The leaf holds the row's own value at both ends — the row writes it as is. */
	identity: boolean;
}

/** What exposing one inspector row (or one raw leaf) means. */
export interface RowExposure {
	label: string;
	/** The kind of value the row holds. */
	kind: EffectParamKind;
	/** The row's current value and its two ends (number: the slider's range; bool: off / on). */
	value: EffectParamValue;
	low: EffectParamValue;
	high: EffectParamValue;
	/** Every leaf the row writes — what marks the row as driven. */
	writes: string[];
	/** The leaves a parameter made from this row drives. Empty ⇒ the row cannot be exposed. */
	leaves: RowLeaf[];
	/** The leaf the row writes as is, if any (editing a row driven through it edits the default). */
	ownLeaf?: string;
	/** A non-linear row exposed through its own leaf: the parameter takes the leaf's range. */
	range?: { min: number; max: number; value: number };
	/** Some leaf exists only away from the row's current value (e.g. a behaviour present at non-zero
	 * spin only), so the row must be moved off its default before it can be exposed. */
	missing: boolean;
}

/**
 * A material param is a leaf even before the material holds a value for it (it plays the compiled
 * effect's default): a drive's first write puts the value in (`engine-fx` `driveLeafKind`), so a
 * row on one is never "missing".
 */
const MATERIAL_PARAM_PATH = 'material.param.';

const leafMap = (layer: EmitterLayer | undefined): Map<string, EffectParamLeaf> =>
	new Map(layer ? listEffectLayerLeaves(layer).map((l) => [l.path, l]) : []);

const near = (a: number, b: number, span: number): boolean =>
	Math.abs(a - b) <= 1e-9 + Math.abs(span) * 1e-3;

function same(a: EffectParamValue | undefined, b: EffectParamValue | undefined): boolean {
	if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
	return a === b;
}

/** Where a number row is probed, as fractions of its range: inside both ends (a setter may wrap or
 * clamp exactly at an end) and off-centre (a default — 0, centred — often sits mid-range, where a
 * behaviour can drop out). The middle one checks the leaf moves linearly with the row. */
const PROBE = [0.02, 0.37, 0.98] as const;

/** Drop float noise from an extrapolated end so a mapping reads as the number it means. */
const tidyEnd = (v: number): number => Math.round(v * 1e9) / 1e9;

/**
 * Diff the leaves a row writes by running its setter on a scratch copy of `current` (`run`). A colour
 * or bool row is run at its two ends; a number row at three interior points, its leaves' values at
 * the row's ends extrapolated from them, so the drive reproduces the row across its whole range.
 */
export function rowExposure(options: {
	label: string;
	kind: EffectParamKind;
	current: EmitterLayer;
	value: EffectParamValue;
	low: EffectParamValue;
	high: EffectParamValue;
	run: (v: EffectParamValue) => EmitterLayer | undefined;
}): RowExposure {
	const { label, kind, current, value, low, high, run } = options;
	const base = leafMap(current);
	const result = (
		writes: string[],
		leaves: RowLeaf[],
		extra: Partial<Pick<RowExposure, 'ownLeaf' | 'range'>> = {},
	): RowExposure => ({
		label,
		kind,
		value,
		low,
		high,
		writes,
		leaves,
		ownLeaf: extra.ownLeaf ?? leaves.find((l) => l.identity)?.path,
		...(extra.range ? { range: extra.range } : {}),
		missing: leaves.some((l) => !base.has(l.path) && !l.path.startsWith(MATERIAL_PARAM_PATH)),
	});
	const diff = (a: Map<string, EffectParamLeaf>, b: Map<string, EffectParamLeaf>) =>
		[...a.values()].filter((l) => {
			const other = b.get(l.path);
			return !!other && other.kind === l.kind && !same(l.value, other.value);
		});

	if (kind !== 'number') {
		const lo = leafMap(run(low));
		const hi = leafMap(run(high));
		const changed = diff(lo, hi);
		const leaves = changed
			.filter((l) => l.kind === kind)
			.map((l) => {
				const h = hi.get(l.path)!.value;
				return {
					path: l.path,
					kind: l.kind,
					low: l.value,
					high: h,
					identity: same(l.value, low) && same(h, high),
				};
			});
		return result(
			changed.map((l) => l.path),
			leaves,
		);
	}

	const a = Number(low);
	const b = Number(high);
	const span = b - a;
	const [v1, v2, v3] = PROBE.map((t) => a + span * t);
	const p1 = leafMap(run(v1));
	const p2 = leafMap(run(v2));
	const p3 = leafMap(run(v3));
	const changed = diff(p1, p3).filter((l) => l.kind === 'number');
	const writes = changed.map((l) => l.path);
	const leaves: RowLeaf[] = [];
	for (const l of changed) {
		const l1 = Number(l.value);
		const l3 = Number(p3.get(l.path)!.value);
		const mid = p2.get(l.path);
		const slope = (l3 - l1) / (v3 - v1);
		if (mid?.kind !== 'number' || !near(Number(mid.value), l1 + slope * (v2 - v1), l3 - l1))
			continue;
		const at0 = tidyEnd(l1 + slope * (a - v1));
		const at1 = tidyEnd(l1 + slope * (b - v1));
		const identity = near(at0, a, span) && near(at1, b, span);
		leaves.push({
			path: l.path,
			kind: 'number',
			low: identity ? a : at0,
			high: identity ? b : at1,
			identity,
		});
	}
	if (leaves.length > 0 || changed.length === 0) return result(writes, leaves);

	// No leaf follows the row linearly (a clamp): expose the row's own leaf, as is, over the range
	// it really spans — read at the row's exact ends.
	const own =
		changed.find((l) => {
			const now = base.get(l.path);
			return now?.kind === 'number' && near(Number(now.value), Number(value), 1);
		}) ?? changed[0];
	const atEnd = (v: number, fallback: EffectParamLeaf | undefined): number => {
		const leaf = leafMap(run(v)).get(own.path);
		return Number((leaf?.kind === 'number' ? leaf : fallback)?.value ?? 0);
	};
	const e0 = atEnd(a, own);
	const e1 = atEnd(b, p3.get(own.path));
	const now = base.get(own.path);
	return result(writes, [{ path: own.path, kind: 'number', low: e0, high: e1, identity: true }], {
		ownLeaf: own.path,
		range: {
			min: Math.min(e0, e1),
			max: Math.max(e0, e1),
			value: now?.kind === 'number' ? Number(now.value) : Number(value),
		},
	});
}

/**
 * The layer's leaves (`listEffectLayerLeaves`) and, on a layer with a material, every number, colour
 * and switch param of its compiled effect it holds no value for yet, at the effect's default: what
 * the "All parameters" tree lists, so ⚡ reaches every param of the spec, not only the stored ones.
 * A choice param is not a leaf a parameter can drive.
 */
export function layerLeavesWithMaterial(
	layer: EmitterLayer,
	specParams: readonly ElementFxParamSpec[] | undefined,
): EffectParamLeaf[] {
	const leaves = listEffectLayerLeaves(layer);
	if (!layer.material || !specParams) return leaves;
	const held = new Set(leaves.map((l) => l.path));
	for (const spec of specParams) {
		const path = `${MATERIAL_PARAM_PATH}${spec.id}`;
		if (spec.kind === 'choice' || held.has(path)) continue;
		leaves.push({ path, kind: spec.kind, value: spec.default });
	}
	return leaves;
}

/** A raw leaf from the "All parameters" tree, exposed as itself. */
export function leafExposure(leaf: EffectParamLeaf): RowExposure {
	let low: EffectParamValue = leaf.value;
	let high: EffectParamValue = leaf.value;
	if (leaf.kind === 'number') {
		const v = Number(leaf.value);
		low = v < 0 ? v * 2 : 0;
		high = v > 0 ? v * 2 : v < 0 ? 0 : 1;
	} else if (leaf.kind === 'bool') {
		low = false;
		high = true;
	}
	return {
		label: leaf.path,
		kind: leaf.kind,
		value: leaf.value,
		low,
		high,
		writes: [leaf.path],
		leaves: [{ path: leaf.path, kind: leaf.kind, low, high, identity: true }],
		ownLeaf: leaf.path,
		missing: false,
	};
}

/** `'Frequency (s)'` → `'frequency'`, `'Spin min (°/s)'` → `'spinMin'`. */
export function paramIdFromLabel(label: string): string {
	const words = label
		.replace(/\(.*?\)/g, ' ')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
	const id = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
	return /^[a-z]/.test(id) ? id : `p${id}`;
}

/** `wanted`, or `wanted2`, `wanted3`, … — unique among the doc's parameters. */
export function uniqueParamId(doc: EffectDoc, wanted: string): string {
	const used = new Set((doc.params ?? []).map((p) => p.id));
	const base = wanted.trim() || 'param';
	if (!used.has(base)) return base;
	let n = 2;
	while (used.has(`${base}${n}`)) n++;
	return `${base}${n}`;
}

const nextDriveId = (param: EffectParam): string => {
	const used = new Set(param.drives.map((d) => d.id));
	let n = param.drives.length + 1;
	while (used.has(`d${n}`)) n++;
	return `d${n}`;
};

/** A colour far from `hex`, so a fresh number → colour drive visibly moves. */
const contrast = (hex: EffectParamValue): string =>
	typeof hex === 'string' && hex.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff';

/** A parameter in the key order the normalizer stores, so an edit and a save agree byte for byte. */
const canonical = (p: EffectParam): EffectParam => ({
	id: p.id,
	kind: p.kind,
	default: p.default,
	...(p.min !== undefined ? { min: p.min } : {}),
	...(p.max !== undefined ? { max: p.max } : {}),
	...(p.note ? { note: p.note } : {}),
	drives: p.drives.map((d) => ({
		id: d.id,
		...(d.layer !== undefined ? { layer: d.layer } : {}),
		path: d.path,
		...(d.from !== undefined && d.to !== undefined ? { from: d.from, to: d.to } : {}),
	})),
});

/** The doc with `params` replaced (an empty list removes the key) and the defaults re-written. */
function withParams(doc: EffectDoc, params: EffectParam[]): EffectDoc {
	const next: EffectDoc = { ...doc, params: params.map(canonical) };
	if (!params.length) delete next.params;
	return applyEffectParamDefaults(next);
}

const updateParam = (doc: EffectDoc, id: string, fn: (p: EffectParam) => EffectParam): EffectDoc =>
	withParams(
		doc,
		(doc.params ?? []).map((p) => (p.id === id ? fn(p) : p)),
	);

/** The drive a `param` would add for one leaf of an exposure, or `undefined` when it cannot. */
function driveFor(
	param: EffectParam,
	layerKey: string,
	exposure: RowExposure,
	leaf: RowLeaf,
	id: string,
): EffectParamDrive | undefined {
	const at = { id, layer: layerKey, path: leaf.path };
	if (param.kind === 'color') return leaf.kind === 'color' ? at : undefined;
	if (leaf.kind === 'bool') return param.kind === 'bool' ? at : undefined;
	if (leaf.kind === 'color') {
		const now = exposure.kind === 'color' ? exposure.value : leaf.low;
		return isHexColor(now) ? { ...at, from: now, to: contrast(now) } : undefined;
	}
	if (
		param.kind === 'number' &&
		leaf.identity &&
		exposure.kind === 'number' &&
		param.min === Number(exposure.low) &&
		param.max === Number(exposure.high)
	) {
		return at;
	}
	return { ...at, from: Number(leaf.low), to: Number(leaf.high) };
}

/**
 * Add a parameter made from a row: it drives every leaf the row exposes, at the row's look. `wanted`
 * is the id the author typed (made unique); absent ⇒ one derived from the row label.
 */
export function exposeAsNewParam(
	doc: EffectDoc,
	layerKey: string,
	exposure: RowExposure,
	wanted?: string,
): { doc: EffectDoc; id: string } {
	const id = uniqueParamId(doc, wanted?.trim() || paramIdFromLabel(exposure.label));
	if (exposure.kind !== 'number') {
		const drives = exposure.leaves.map((leaf, i) => ({
			id: `d${i + 1}`,
			layer: layerKey,
			path: leaf.path,
		}));
		const param: EffectParam = { id, kind: exposure.kind, default: exposure.value, drives };
		return { doc: withParams(doc, [...(doc.params ?? []), param]), id };
	}
	const r = exposure.range ?? {
		min: Number(exposure.low),
		max: Number(exposure.high),
		value: Number(exposure.value),
	};
	// A value outside the row's range (typed into a number box) widens the parameter's range rather
	// than being clamped into it — exposing a row must never change the look. A mapped leaf is
	// extended along the same line, so it still reproduces the row.
	const min = Math.min(r.min, r.value);
	const max = Math.max(r.max, r.value);
	const along = (a: number, b: number, v: number): number => {
		if (v === r.min) return a;
		if (v === r.max || !(r.max > r.min)) return b;
		return tidyEnd(a + ((b - a) * (v - r.min)) / (r.max - r.min));
	};
	const drives = exposure.leaves.map((leaf, i): EffectParamDrive => {
		const at = { id: `d${i + 1}`, layer: layerKey, path: leaf.path };
		const { low, high } = leaf;
		// An on/off leaf is only ever written as is (a bool row exposes it that way).
		if (leaf.identity || typeof low === 'boolean' || typeof high === 'boolean') return at;
		if (typeof low !== 'number' || typeof high !== 'number') return { ...at, from: low, to: high };
		return { ...at, from: along(low, high, min), to: along(low, high, max) };
	});
	const param: EffectParam = { id, kind: 'number', default: r.value, min, max, drives };
	return { doc: withParams(doc, [...(doc.params ?? []), param]), id };
}

/** Whether `param` can drive at least one leaf of `exposure`. */
export function canDrive(param: EffectParam, exposure: RowExposure): boolean {
	return exposure.leaves.some((leaf) => !!driveFor(param, '', exposure, leaf, ''));
}

/** Drive the row's leaves with an existing parameter (its range spans the row's). */
export function driveWithParam(
	doc: EffectDoc,
	paramId: string,
	layerKey: string,
	exposure: RowExposure,
): EffectDoc {
	return updateParam(doc, paramId, (p) => {
		const drives = [...p.drives];
		for (const leaf of exposure.leaves) {
			if (drives.some((d) => d.layer === layerKey && d.path === leaf.path)) continue;
			const drive = driveFor(p, layerKey, exposure, leaf, nextDriveId({ ...p, drives }));
			if (drive) drives.push(drive);
		}
		return { ...p, drives };
	});
}

export function removeParam(doc: EffectDoc, id: string): EffectDoc {
	return withParams(
		doc,
		(doc.params ?? []).filter((p) => p.id !== id),
	);
}

export function removeDrive(doc: EffectDoc, paramId: string, driveId: string): EffectDoc {
	return updateParam(doc, paramId, (p) => ({
		...p,
		drives: p.drives.filter((d) => d.id !== driveId),
	}));
}

/** Set a parameter's default (clamped / normalised to its kind) and re-write the configs. */
export function setParamDefault(doc: EffectDoc, id: string, value: EffectParamValue): EffectDoc {
	return updateParam(doc, id, (p) => ({ ...p, default: effectParamValue(p, value) }));
}

/** Set a number parameter's range (ordered) and pull its default inside it. */
export function setParamRange(doc: EffectDoc, id: string, min: number, max: number): EffectDoc {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return doc;
	const [lo, hi] = min <= max ? [min, max] : [max, min];
	return updateParam(doc, id, (p) => {
		if (p.kind !== 'number') return p;
		const next = { ...p, min: lo, max: hi };
		return { ...next, default: effectParamValue(next, p.default) };
	});
}

/** Rename a parameter; refused (doc unchanged) when the id is empty or taken. */
export function renameParam(doc: EffectDoc, id: string, next: string): EffectDoc {
	const clean = next.trim();
	if (!clean || clean === id || (doc.params ?? []).some((p) => p.id === clean)) return doc;
	return updateParam(doc, id, (p) => ({ ...p, id: clean }));
}

export function setParamNote(doc: EffectDoc, id: string, note: string): EffectDoc {
	return updateParam(doc, id, (p) => ({ ...p, note: note.trim() || undefined }));
}

/** Change a parameter's kind — only while it drives nothing (a drive's from → to is kind-bound). */
export function setParamKind(doc: EffectDoc, id: string, kind: EffectParamKind): EffectDoc {
	return updateParam(doc, id, (p) => {
		if (p.drives.length || p.kind === kind) return p;
		if (kind === 'number') return { id: p.id, kind, default: 0, min: 0, max: 1, drives: [] };
		return { id: p.id, kind, default: kind === 'bool' ? false : '#ffffff', drives: [] };
	});
}

/** Set one end of a mapped drive (a number box or a colour field in the panel). */
export function setDriveEnd(
	doc: EffectDoc,
	paramId: string,
	driveId: string,
	end: 'from' | 'to',
	value: number | string,
): EffectDoc {
	if (typeof value === 'number' ? !Number.isFinite(value) : !isHexColor(value)) return doc;
	return updateParam(doc, paramId, (p) => ({
		...p,
		drives: p.drives.map((d) =>
			d.id === driveId && d.from !== undefined && d.to !== undefined
				? { ...d, [end]: typeof value === 'string' ? value.toLowerCase() : value }
				: d,
		),
	}));
}

/**
 * A layer was deleted: drop every drive that names it (a parameter left with none stays). A drive on
 * a removed BEHAVIOUR is kept on purpose — switching that section back on restores it.
 */
export function removeLayerDrives(doc: EffectDoc, layerKey: string): EffectDoc {
	if (!doc.params?.some((p) => p.drives.some((d) => d.layer === layerKey))) return doc;
	return withParams(
		doc,
		doc.params.map((p) => ({ ...p, drives: p.drives.filter((d) => d.layer !== layerKey) })),
	);
}

/** Follow a layer rename in every drive. */
export function renameLayerInParams(doc: EffectDoc, from: string, to: string): EffectDoc {
	if (!doc.params?.some((p) => p.drives.some((d) => d.layer === from))) return doc;
	return {
		...doc,
		params: doc.params.map((p) => ({
			...p,
			drives: p.drives.map((d) => (d.layer === from ? { ...d, layer: to } : d)),
		})),
	};
}

/** The drive of `doc` on each driven leaf of a layer, keyed by canonical path. */
export function layerDrives(
	doc: EffectDoc,
	layerKey: string,
): Map<string, { param: EffectParam; drive: EffectParamDrive }> {
	const out = new Map<string, { param: EffectParam; drive: EffectParamDrive }>();
	for (const param of doc.params ?? []) {
		for (const drive of param.drives) {
			if (drive.layer !== layerKey) continue;
			out.set(canonicalEffectParamPath(drive.path) ?? drive.path, { param, drive });
		}
	}
	return out;
}

/** How a row reads when a parameter drives it. `editable` ⇔ it is driven through its own leaf as
 * is, so editing the row edits that parameter's default; otherwise the row is read-only. */
export interface RowDriveState {
	param: EffectParam;
	editable: boolean;
}

export function rowDriveState(
	drives: Map<string, { param: EffectParam; drive: EffectParamDrive }>,
	exposure: Pick<RowExposure, 'writes' | 'ownLeaf'>,
): RowDriveState | undefined {
	const own = exposure.ownLeaf ? drives.get(exposure.ownLeaf) : undefined;
	if (own && own.drive.from === undefined && own.drive.to === undefined) {
		return { param: own.param, editable: true };
	}
	for (const path of exposure.writes) {
		const hit = drives.get(path);
		if (hit) return { param: hit.param, editable: false };
	}
	return undefined;
}

/** Validation issues keyed by `<paramId>/<driveId>` (a drive that does nothing wins over a shared one). */
export function driveIssues(doc: EffectDoc): Map<string, EffectParamIssue> {
	const out = new Map<string, EffectParamIssue>();
	for (const issue of validateEffectParams(doc)) {
		const key = `${issue.param}/${issue.drive}`;
		if (!out.has(key) || issue.code === 'unresolved') out.set(key, issue);
	}
	return out;
}
