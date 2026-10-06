import { opIdFor, type AdapterClient } from '../adapters.ts';
import type { AgentDefinition } from '../agents.ts';
import {
	applyCodeRules,
	regionIndex,
	verifyPalette,
	type CodedElement,
	type LockedItem,
	type PaletteCheck,
} from './rules.ts';
import type { AnalystFontGap, AnalystSwatch } from './schema.ts';
import { sumUsage, type Usage, type VisionTransport } from './vision.ts';

/**
 * The mockup breakdown (ADR-0005; SPEC §1.2), run by the worker's own code around one Opus vision
 * call per image that is not a style reference. The adapters hand it the mockups, the template's
 * locked items and region catalogue; the model proposes; `rules.ts` decides; the crops of what was
 * matched are saved through `mockups.save_crops`; the caller submits the result as the `breakdown`
 * checkpoint (`checkpoint.ts`). Nothing here touches a GPU queue — rendering waits for the owner.
 *
 * This is the ONLY way a breakdown comes to exist: the driver runs it as the run's breakdown step
 * (`driver.ts` `breakdownStep`) whenever the run has mockups, and no agent tool takes a status —
 * the model's `matched` / `left_out` claims reach the stored breakdown only through
 * `applyCodeRules`.
 */

/** The agent whose model and prompt the analysis runs with; it never takes a tool turn itself. */
export const ANALYST_AGENT = 'mockup-analyst';

// ── What the adapters return (the launcher's `ops/mockups.ts`, `ops/gamemaker.ts`, `ops/atlas.ts`) ──

export interface MockupListing {
	fidelity: 'match' | 'start';
	ownershipConfirmed: { by: { uid: string; name: string }; at: string } | null;
	images: {
		id: string;
		file: string;
		mediaType: 'image/png' | 'image/jpeg';
		w: number;
		h: number;
		tag: string;
		styleOnly: boolean;
	}[];
}

export interface MockupImageResult {
	id: string;
	mediaType: 'image/png' | 'image/jpeg';
	base64: string;
	w: number;
	h: number;
	scale: number;
	dominantColors: { hex: string; share: number }[];
}

export interface TemplateSummary {
	key: string;
	name: string;
	gameTypeName: string;
	lockedItems: LockedItem[];
}

export interface RegionListing {
	atlases: { atlas: string; regions: { name: string; size: { w: number; h: number } | null }[] }[];
}

export interface SaveCropsResult {
	saved: { region: string; key: string; imageId: string }[];
	skipped: { region: string; imageId: string; reason: string }[];
}

// ── The breakdown ────────────────────────────────────────────────────────────

export interface BreakdownImage {
	id: string;
	file: string;
	tag: string;
	styleOnly: boolean;
	/** The size the boxes are in: the model's copy, not the original. */
	w: number;
	h: number;
	elements: CodedElement[];
	/** The model that answered for this image; null for a style reference (no call). */
	model: string | null;
}

export interface Breakdown {
	version: 1;
	fidelity: MockupListing['fidelity'];
	images: BreakdownImage[];
	palette: AnalystSwatch[];
	paletteDropped: PaletteCheck['dropped'];
	fontGaps: (AnalystFontGap & { imageId: string })[];
	/** Template regions no matched element covers: designed from the notes and the palette. */
	uncoveredRegions: string[];
	regionsTotal: number;
	regionsMatched: number;
	crops: SaveCropsResult | null;
	usage: Usage;
}

/** Why the analysis did not run at all. */
export class AnalysisRefused extends Error {
	readonly code: 'ownership' | 'no_mockups';
	constructor(code: 'ownership' | 'no_mockups', message: string) {
		super(message);
		this.name = 'AnalysisRefused';
		this.code = code;
	}
}

/** The same rule as the launcher's `ownershipRefusal`: mockups without the check cannot start. */
export function ownershipRefusal(listing: Pick<MockupListing, 'images' | 'ownershipConfirmed'>) {
	if (listing.images.length === 0 || listing.ownershipConfirmed) return null;
	return 'Confirm that these designs belong to us or to the client before the run starts.';
}

export interface AnalyzeDeps {
	adapters: {
		/** The analyst's reads — the listing, the images, the template, the regions — in its name. */
		analyst: AdapterClient;
		/** The worker's own writes — the crops. The model never saves anything. */
		worker: AdapterClient;
	};
	model: VisionTransport;
	/** The `mockup-analyst` definition: its model, effort and system prompt. */
	agent: AgentDefinition;
	run: { id: string; templateProjectKey: string };
	/**
	 * A number unique to this pass over the run's mockups (a retry after a crash is a new pass): the
	 * crops' write gets a fresh opId per pass, because the model's answers — and so the crops — can
	 * differ between passes, and the gate refuses an opId reused with a different input.
	 */
	pass: number;
	/** The owner's notes from earlier breakdowns of this run (one per "revise"), oldest first. */
	notes?: readonly string[];
}

const FIDELITY_TEXT = {
	match: 'Match the mockups closely: variants must follow each crop’s silhouette and colours.',
	start: 'Use the mockups as a starting point: the artist may reinterpret them.',
};

/** The part of the system prompt that is the same for every image of the run. */
export function catalogueText(template: TemplateSummary, regions: RegionListing): string {
	const lines = [
		`# Template: ${template.name} (${template.key}, ${template.gameTypeName})`,
		'',
		'## Locked items (read-only; an element that depends on one is left out by the worker)',
		...template.lockedItems.map((l) => `- ${l.id} — ${l.label}: ${l.detail}`),
		'',
		'## Template regions (use these names exactly in `regions`)',
	];
	for (const atlas of regions.atlases) {
		lines.push(`### atlas ${atlas.atlas}`);
		for (const r of atlas.regions) {
			lines.push(`- ${r.name}${r.size ? ` (${r.size.w}×${r.size.h})` : ''}`);
		}
	}
	return lines.join('\n');
}

export function imagePrompt(
	image: MockupListing['images'][number],
	model: { w: number; h: number },
	fidelity: MockupListing['fidelity'],
	notes: readonly string[] = [],
): string {
	const parts = [
		`This mockup is tagged "${image.tag}". The image you see is ${model.w}×${model.h} pixels; give every box in these pixel coordinates.`,
		FIDELITY_TEXT[fidelity],
		'List every distinct element you can see, map each to the template regions it would replace (an element may stand for several regions), and give a short reason. Use `left_out` only for an element that depends on a locked item, naming the item’s id in `lockedItem`; the worker verifies that against the template. Propose at most 8 palette colours as hex, and list lettering with no obvious Font Maker match as font gaps.',
	];
	if (notes.length) {
		parts.push(
			[
				'The owner reviewed an earlier breakdown of these mockups and asked:',
				...notes.map((note) => `- ${note}`),
				'Take the notes into account where they bear on this image. The worker still verifies every status against the template.',
			].join('\n'),
		);
	}
	return parts.join('\n\n');
}

export async function analyzeMockups(deps: AnalyzeDeps): Promise<Breakdown> {
	const { model, agent, run } = deps;
	const { analyst, worker } = deps.adapters;

	const listing = await analyst.call<MockupListing>('mockups', 'list', {});
	const refusal = ownershipRefusal(listing);
	if (refusal) throw new AnalysisRefused('ownership', refusal);
	if (listing.images.length === 0) {
		throw new AnalysisRefused('no_mockups', 'This run has no mockups; it takes the style board.');
	}

	const [template, regions] = await Promise.all([
		analyst.call<TemplateSummary>('gamemaker', 'get_template', { key: run.templateProjectKey }),
		analyst.call<RegionListing>('atlas', 'list_regions', {}),
	]);
	const regionNames = regions.atlases.flatMap((a) => a.regions.map((r) => r.name));
	const index = regionIndex(regionNames);
	const system = `${agent.systemPrompt}\n\n${catalogueText(template, regions)}`;

	const images: BreakdownImage[] = [];
	const proposed: AnalystSwatch[] = [];
	const support: { hex: string }[][] = [];
	const fontGaps: Breakdown['fontGaps'] = [];
	const usages: Usage[] = [];
	const crops: { imageId: string; region: string; box: CodedElement['box'] }[] = [];

	for (const image of listing.images) {
		const got = await analyst.call<MockupImageResult>('mockups', 'get_image', { id: image.id });
		support.push(got.dominantColors);
		if (image.styleOnly) {
			images.push({ ...pick(image), w: got.w, h: got.h, elements: [], model: null });
			continue;
		}
		const answer = await model.analyze({
			model: agent.model,
			effort: agent.effort,
			system,
			prompt: imagePrompt(image, got, listing.fidelity, deps.notes),
			image: { id: image.id, mediaType: got.mediaType, base64: got.base64 },
		});
		usages.push(answer.usageSummary);
		const elements = applyCodeRules(answer.output.elements, {
			regions: index,
			locked: template.lockedItems,
			image: { w: got.w, h: got.h },
		});
		for (const el of elements) {
			if (el.status !== 'matched') continue;
			for (const region of el.regions) crops.push({ imageId: image.id, region, box: el.box });
		}
		proposed.push(...answer.output.palette);
		// Reported as the model sees them; the comparison with the Font Maker catalogues (ADR-0005
		// "Fonts") needs the `fonts.list` adapter of PLAN 2.6.
		for (const gap of answer.output.fontGaps) fontGaps.push({ ...gap, imageId: image.id });
		images.push({ ...pick(image), w: got.w, h: got.h, elements, model: answer.model });
	}

	const palette = verifyPalette(proposed, support);
	const matched = new Set(
		images.flatMap((img) =>
			img.elements.filter((e) => e.status === 'matched').flatMap((e) => e.regions),
		),
	);
	const uncoveredRegions = regionNames.filter((r) => !matched.has(r));

	// One crop per region: the first element that matched it wins.
	const firstCrop = new Map<string, (typeof crops)[number]>();
	for (const c of crops) if (!firstCrop.has(c.region)) firstCrop.set(c.region, c);
	const cropList = [...firstCrop.values()];
	const saved =
		cropList.length === 0
			? null
			: await worker.call<SaveCropsResult>(
					'mockups',
					'save_crops',
					{ crops: cropList },
					{ opId: opIdFor(run.id, 'breakdown_crops', deps.pass) },
				);

	return {
		version: 1,
		fidelity: listing.fidelity,
		images,
		palette: palette.kept,
		paletteDropped: palette.dropped,
		fontGaps,
		uncoveredRegions,
		regionsTotal: regionNames.length,
		regionsMatched: matched.size,
		crops: saved,
		usage: sumUsage(usages),
	};
}

const pick = (image: MockupListing['images'][number]) => ({
	id: image.id,
	file: image.file,
	tag: image.tag,
	styleOnly: image.styleOnly,
});
