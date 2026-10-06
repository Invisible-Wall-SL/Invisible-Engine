import type { Breakdown } from '../mockups/analyze.ts';
import type { CodedElement } from '../mockups/rules.ts';
import type { EvalElementView, EvalItem } from './report.ts';

/**
 * How close one breakdown of the reference set comes to the expected one (ADR-0007; PLAN 5.4). Pure
 * and deterministic: the same two breakdowns give the same figures, so a fixture can pin them.
 *
 * Elements are matched per image, by file, on where their boxes are, never on what they are called
 * or numbered: two runs of one model name the same plaque differently, and a changed prompt may
 * list the elements in another order. A matched element scores half for the status it ended on (the
 * code rules' verdict, not the model's claim) and half for how much of its region set it got right;
 * an expected element nothing matched scores nothing. A style reference carries no elements and is
 * left out.
 */

/** Two boxes are the same element at or above this overlap. */
export const MATCH_IOU = 0.3;

type Box = CodedElement['box'];

function iou(a: Box, b: Box): number {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	if (w <= 0 || h <= 0) return 0;
	const inter = w * h;
	const union = a.w * a.h + b.w * b.h - inter;
	return union > 0 ? inter / union : 0;
}

/**
 * Expected index → actual index, greedy from the best overlap down, each actual element used once.
 * Ties break on the lower expected index, then the lower actual index, so the pairing never depends
 * on the sort's stability.
 */
function pair(expected: CodedElement[], actual: CodedElement[]): Map<number, number> {
	const candidates: { e: number; a: number; overlap: number }[] = [];
	expected.forEach((el, e) =>
		actual.forEach((got, a) => {
			const overlap = iou(el.box, got.box);
			if (overlap >= MATCH_IOU) candidates.push({ e, a, overlap });
		}),
	);
	candidates.sort((x, y) => y.overlap - x.overlap || x.e - y.e || x.a - y.a);
	const paired = new Map<number, number>();
	const taken = new Set<number>();
	for (const { e, a } of candidates) {
		if (paired.has(e) || taken.has(a)) continue;
		paired.set(e, a);
		taken.add(a);
	}
	return paired;
}

/** Overlap of two region sets as a share of their union; 1 when both are empty. */
function jaccard(a: string[], b: string[]): number {
	const left = new Set(a);
	const right = new Set(b);
	const union = new Set([...left, ...right]);
	if (union.size === 0) return 1;
	let shared = 0;
	for (const region of left) if (right.has(region)) shared++;
	return shared / union.size;
}

/** Nothing expected means nothing missed: an empty mean is 1. */
const mean = (values: number[]): number =>
	values.length === 0 ? 1 : values.reduce((sum, v) => sum + v, 0) / values.length;

const notFound = (): EvalElementView => ({
	found: false,
	name: null,
	status: null,
	regions: [],
	statusMatch: false,
	regionScore: 0,
});

/** The key an expected element's view is stored under: its image's file and its number there. */
export const viewKey = (file: string, n: number): string => `${file}#${n}`;

export interface BreakdownScore {
	/** 0..1: the mean over the expected elements of ½ status agreement + ½ region agreement. */
	score: number;
	statusAgreement: number;
	regionAgreement: number;
	/** Elements found on the scored images that match no expected element. */
	extraElements: number;
	/** One view per expected element of the scored images, by `viewKey`. */
	views: Map<string, EvalElementView>;
}

export function scoreBreakdown(expected: Breakdown, actual: Breakdown): BreakdownScore {
	const views = new Map<string, EvalElementView>();
	const statusParts: number[] = [];
	const regionParts: number[] = [];
	let extraElements = 0;

	for (const image of expected.images) {
		if (image.styleOnly) continue;
		const got = actual.images.find((i) => i.file === image.file)?.elements ?? [];
		const paired = pair(image.elements, got);
		image.elements.forEach((el, e) => {
			const a = paired.get(e);
			let view = notFound();
			if (a !== undefined) {
				const match = got[a];
				view = {
					found: true,
					name: match.name,
					status: match.status,
					regions: [...match.regions],
					statusMatch: match.status === el.status,
					regionScore: jaccard(el.regions, match.regions),
				};
			}
			views.set(viewKey(image.file, el.n), view);
			statusParts.push(view.statusMatch ? 1 : 0);
			regionParts.push(view.regionScore);
		});
		extraElements += got.length - paired.size;
	}

	const statusAgreement = mean(statusParts);
	const regionAgreement = mean(regionParts);
	return {
		score: mean(statusParts.map((status, i) => 0.5 * status + 0.5 * regionParts[i])),
		statusAgreement,
		regionAgreement,
		extraElements,
		views,
	};
}

const regionKey = (regions: string[]): string => [...new Set(regions)].sort().join('\n');

/** The two sides disagree on whether the element was found, the status it got or its regions. */
const differ = (a: EvalElementView, b: EvalElementView): boolean =>
	a.found !== b.found || a.status !== b.status || regionKey(a.regions) !== regionKey(b.regions);

/**
 * Every expected element of the scored images with each side's view of it. A side that did not run
 * (no definition on `main`, or the run stopped first) is null, and an element is `changed` only when
 * both sides ran and disagree.
 */
export function evalItems(
	expected: Breakdown,
	before: Breakdown | null,
	after: Breakdown | null,
): EvalItem[] {
	const beforeViews = before ? scoreBreakdown(expected, before).views : null;
	const afterViews = after ? scoreBreakdown(expected, after).views : null;
	return expected.images
		.filter((image) => !image.styleOnly)
		.flatMap((image) =>
			image.elements.map((el) => {
				const key = viewKey(image.file, el.n);
				const b = beforeViews?.get(key) ?? null;
				const a = afterViews?.get(key) ?? null;
				return {
					image: image.file,
					n: el.n,
					name: el.name,
					expected: { status: el.status, regions: [...el.regions] },
					before: b,
					after: a,
					changed: b !== null && a !== null && differ(b, a),
				};
			}),
		);
}
