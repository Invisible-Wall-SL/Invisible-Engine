import {
	REPEATER_COUNT_DEFAULT_MAX,
	REPEATER_COUNT_HARD_MAX,
	REPEATER_COUNT_PARAM,
	REPEATER_INDEX_PARAM,
	type ComponentDef,
	type LayoutNode,
	type LayoutType,
	type RepeaterCount,
	type RepeaterNode,
	type RepeaterVariants,
} from './types';
import { componentDesignSize } from './componentDesignSize';
import { bindingNumber } from './valueBindings';

/**
 * COUNT-MODE REPEATER geometry and wiring (segmented counters, `RepeaterNode.count`), pure and
 * Svelte-free so the game's `<Repeater>` and the editor canvas draw the same segments at the same
 * offsets. The source-list repeater does not use any of this.
 */

export type CountRepeaterNode = RepeaterNode & { count: RepeaterCount };

export const isCountRepeater = (node: LayoutNode): node is CountRepeaterNode =>
	node.kind === 'repeater' && node.count !== undefined && node.count !== null;

/** The most segments `count` draws: its `max` (else the default), never above the hard cap. */
export function repeaterCountCap(count: RepeaterCount): number {
	const max = bindingNumber(count.max);
	const cap = max === undefined ? REPEATER_COUNT_DEFAULT_MAX : Math.floor(max);
	return Math.min(Math.max(cap, 1), REPEATER_COUNT_HARD_MAX);
}

/**
 * N for `node` when its count reads `value` (the live source's value, or `count.preview` when the
 * node names no source): rounded and clamped to `0..cap`. A value that is not a finite number
 * (numeric strings and booleans count) ⇒ 0, as does a node with no `count`.
 */
export function repeaterCount(node: RepeaterNode, value: unknown): number {
	if (!node.count) return 0;
	const n = bindingNumber(value);
	if (n === undefined) return 0;
	return Math.min(Math.max(Math.round(n), 0), repeaterCountCap(node.count));
}

/**
 * The component segment `index` (0-based) of `n` draws: `variants.first` for the first, `last` for
 * the last of two or more, `middle` for the rest — each unset variant falling back to `middle`, then
 * to the node's `componentId`.
 */
export function repeaterSegmentComponent(node: RepeaterNode, index: number, n: number): string {
	const v: RepeaterVariants = node.variants ?? {};
	const middle = v.middle || node.componentId;
	if (index === 0 && v.first) return v.first;
	if (index === n - 1 && n > 1 && v.last) return v.last;
	return middle;
}

/** Every component a count-mode node can draw (its `componentId`, then each variant not already
 *  listed) — what the bake/pull walks ship. A source-list node draws only its `componentId`. */
export function repeaterComponentIds(node: RepeaterNode): string[] {
	const ids = [node.componentId];
	if (!isCountRepeater(node)) return ids;
	const v = node.variants ?? {};
	for (const id of [v.first, v.middle, v.last]) {
		if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
	}
	return ids;
}

/** What segment `index` (0-based) of `n` is handed, as params and as the number inputs of those ids. */
export const repeaterSegmentValues = (index: number, n: number): Record<string, number> => ({
	[REPEATER_INDEX_PARAM]: index + 1,
	[REPEATER_COUNT_PARAM]: n,
});

export interface RepeaterItemSize {
	width: number;
	height: number;
}

/**
 * A segment's size as a count-mode repeater lays it out: its ROOT box when the def declares both
 * `width` and `height` (the Component Editor's **Size**), measured from its origin right and down;
 * else the union of what it draws (`componentDesignSize`, no textures). A segment drawn only from
 * rigs and text measures nothing without its box, so such segments stack.
 */
export function repeaterSegmentSize(
	def: ComponentDef,
	layoutType: LayoutType,
): RepeaterItemSize | null {
	const { width, height } = def.root;
	const side = (v?: number): v is number => v !== undefined && Number.isFinite(v) && v > 0;
	if (side(width) && side(height)) return { width, height };
	return componentDesignSize(def, () => null, layoutType);
}

export interface RepeaterCountLayout {
	/** Each segment's origin, before the group anchor. */
	offsets: { x: number; y: number }[];
	/** The whole group's footprint, which the node's `anchor` is read against. */
	width: number;
	height: number;
}

/**
 * Where `n` segments of `node` sit. `row` / `column` lay them end to end along +x / +y, each by ITS
 * own size (`sizeOf` its component — an end cap may be wider than a middle segment), with
 * `layout.gap` between; the cross axis is the tallest / widest. `grid` keeps the source-list
 * repeater's uniform pitch, the size of the node's `componentId`. An unsizable component counts as
 * 0 × 0.
 */
export function repeaterCountOffsets(
	node: RepeaterNode,
	n: number,
	sizeOf: (componentId: string) => RepeaterItemSize | null | undefined,
): RepeaterCountLayout {
	const gap = node.layout.gap;
	if (n <= 0) return { offsets: [], width: 0, height: 0 };
	if (node.layout.direction === 'grid') {
		const size = sizeOf(node.componentId);
		const w = size?.width ?? 0;
		const h = size?.height ?? 0;
		const columns = Math.max(1, node.layout.columns ?? 1);
		const offsets = Array.from({ length: n }, (_, i) => ({
			x: (i % columns) * (w + gap),
			y: Math.floor(i / columns) * (h + gap),
		}));
		const cols = Math.max(1, Math.min(columns, n));
		const rows = Math.max(1, Math.ceil(n / cols));
		return { offsets, width: cols * w + (cols - 1) * gap, height: rows * h + (rows - 1) * gap };
	}
	const vertical = node.layout.direction === 'column';
	const offsets: { x: number; y: number }[] = [];
	let along = 0;
	let across = 0;
	for (let i = 0; i < n; i++) {
		const size = sizeOf(repeaterSegmentComponent(node, i, n));
		const w = size?.width ?? 0;
		const h = size?.height ?? 0;
		if (i > 0) along += gap;
		offsets.push(vertical ? { x: 0, y: along } : { x: along, y: 0 });
		along += vertical ? h : w;
		across = Math.max(across, vertical ? w : h);
	}
	return vertical
		? { offsets, width: across, height: along }
		: { offsets, width: along, height: across };
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The count-mode fields of a stored repeater node as this build reads them, for the component
 * normalizer: `count` kept only with a finite `preview` (rounded, clamped to `0..`
 * {@link REPEATER_COUNT_HARD_MAX}), its `source` only when a non-empty string and its `max` only
 * when a finite number (rounded, clamped to `1..` the hard cap) — anything else drops the whole
 * `count`, so the node reads as a source-list repeater; `variants` keeps its non-empty strings,
 * `passInputs` its non-empty string values, `previewInputs` its finite numbers, each dropped when
 * nothing is left. Returns `node` itself when it is already clean (a node without them included).
 */
export function normalizeRepeaterCountFields(node: RepeaterNode): RepeaterNode {
	const raw = node as RepeaterNode & Record<string, unknown>;
	if (!COUNT_FIELDS.some((field) => field in raw)) return node;
	const count = readCount(raw.count);
	// The other three only mean something in count mode: without a readable `count` they go too.
	const read: Record<(typeof COUNT_FIELDS)[number], unknown> = count
		? {
				count,
				variants: readEntries(
					raw.variants,
					(key, v) => (VARIANT_KEYS as readonly string[]).includes(key) && nonEmpty(v),
				),
				passInputs: readEntries(raw.passInputs, (key, v) => key !== '' && nonEmpty(v)),
				previewInputs: readEntries(
					raw.previewInputs,
					(key, v) => key !== '' && typeof v === 'number' && Number.isFinite(v),
				),
			}
		: { count, variants: undefined, passInputs: undefined, previewInputs: undefined };
	// Rebuilt in the stored key order, so a clean node keeps its bytes.
	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!(COUNT_FIELDS as readonly string[]).includes(key)) next[key] = value;
		else if (read[key as (typeof COUNT_FIELDS)[number]] !== undefined)
			next[key] = read[key as (typeof COUNT_FIELDS)[number]];
	}
	return JSON.stringify(next) === JSON.stringify(node) ? node : (next as unknown as RepeaterNode);
}

const COUNT_FIELDS = ['count', 'variants', 'passInputs', 'previewInputs'] as const;
const VARIANT_KEYS = ['first', 'middle', 'last'] as const;

function readCount(count: unknown): RepeaterCount | undefined {
	if (!isRecord(count) || typeof count.preview !== 'number' || !Number.isFinite(count.preview))
		return undefined;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(count)) {
		if (key === 'source' && nonEmpty(value)) out.source = value.trim();
		else if (key === 'preview')
			out.preview = Math.min(Math.max(Math.round(value as number), 0), REPEATER_COUNT_HARD_MAX);
		else if (key === 'max' && typeof value === 'number' && Number.isFinite(value))
			out.max = Math.min(Math.max(Math.round(value), 1), REPEATER_COUNT_HARD_MAX);
	}
	return out as unknown as RepeaterCount;
}

function readEntries(
	input: unknown,
	keep: (key: string, value: unknown) => boolean,
): Record<string, unknown> | undefined {
	if (!isRecord(input)) return undefined;
	const out = Object.fromEntries(Object.entries(input).filter(([key, v]) => keep(key, v)));
	return Object.keys(out).length ? out : undefined;
}
