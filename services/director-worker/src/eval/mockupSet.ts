import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AdapterCallError, type AdapterClient } from '../adapters.ts';
import type {
	AnalyzeDeps,
	Breakdown,
	MockupListing,
	RegionListing,
	TemplateSummary,
} from '../mockups/analyze.ts';

/**
 * The reference set `mockup-analyst` is evaluated on (ADR-0007; PLAN 5.4): the three mockups we own
 * in `docs/director/eval/mockups/`, served to the REAL `analyzeMockups` by an in-memory launcher, and
 * the snapshot of what a correct analysis of them looks like (`expected-breakdown.json`, which
 * `check:mockups` keeps equal to the code rules' output on the canned answers).
 *
 * The same reference the analysis fixture (`mockups/analyze.fixture.ts`) serves its fake launcher
 * from, kept as a module because the eval needs it outside a fixture. Nothing here writes: the
 * crops the analysis saves are recorded and answered, never stored. Paths resolve from this file,
 * so the set loads from the repo root (the workflow) and from the package alike.
 */

const EVAL_DIR = fileURLToPath(new URL('../../../../docs/director/eval/mockups/', import.meta.url));

interface Reference {
	template: TemplateSummary;
	regions: RegionListing;
	fidelity: MockupListing['fidelity'];
	ownershipConfirmed: MockupListing['ownershipConfirmed'];
	images: (MockupListing['images'][number] & {
		dominantColors: { hex: string; share: number }[];
	})[];
}

interface LoadedSet {
	reference: Reference;
	bytes: Map<string, Buffer>;
}

let loaded: LoadedSet | null = null;

function loadSet(): LoadedSet {
	if (loaded) return loaded;
	const reference = JSON.parse(readFileSync(`${EVAL_DIR}reference.json`, 'utf8')) as Reference;
	const bytes = new Map(
		reference.images.map((img) => [img.id, readFileSync(`${EVAL_DIR}${img.file}`)]),
	);
	loaded = { reference, bytes };
	return loaded;
}

/** The template key the analysis is asked about (`run.templateProjectKey`). */
export const referenceTemplateKey = (): string => loadSet().reference.template.key;

/** What a correct breakdown of the reference set looks like. */
export function expectedBreakdown(): Breakdown {
	return JSON.parse(readFileSync(`${EVAL_DIR}expected-breakdown.json`, 'utf8')) as Breakdown;
}

/** One call the analysis made, for a caller that wants to see them (the crops it asked to save). */
export interface ReferenceCall {
	as: 'analyst' | 'worker';
	tool: string;
	op: string;
	input: unknown;
}

/**
 * A fresh in-memory launcher over the reference set: the analyst's reads and the worker's write, as
 * `analyzeMockups` wants them. Anything the real gate would answer and the set does not — `fonts.list`
 * included, which the live analysis does not call yet — is a 404 `unknown_op`, the answer an
 * unserved op gets. Each call is appended to `calls` when one is given.
 */
export function referenceAdapters(calls: ReferenceCall[] = []): AnalyzeDeps['adapters'] {
	const { reference, bytes } = loadSet();
	const client = (as: ReferenceCall['as']): AdapterClient => ({
		async call<T>(tool: string, op: string, input: unknown) {
			calls.push({ as, tool, op, input });
			switch (`${tool}.${op}`) {
				case 'mockups.list':
					return {
						fidelity: reference.fidelity,
						ownershipConfirmed: reference.ownershipConfirmed,
						images: reference.images.map(({ dominantColors: _colors, ...image }) => image),
					} as T;
				case 'mockups.get_image': {
					const id = (input as { id: string }).id;
					const image = reference.images.find((i) => i.id === id);
					const file = bytes.get(id);
					if (!image || !file) {
						throw new AdapterCallError(tool, op, 404, 'not_found', `no mockup ${id}`, null);
					}
					return {
						id: image.id,
						mediaType: image.mediaType,
						base64: file.toString('base64'),
						w: image.w,
						h: image.h,
						scale: 1,
						dominantColors: image.dominantColors,
					} as T;
				}
				case 'gamemaker.get_template':
					return reference.template as T;
				case 'atlas.list_regions':
					return reference.regions as T;
				case 'mockups.save_crops': {
					const crops = (input as { crops: { region: string; imageId: string }[] }).crops;
					return {
						saved: crops.map((c) => ({
							region: c.region,
							imageId: c.imageId,
							key: `eval/crops/${c.region}.png`,
						})),
						skipped: [],
					} as T;
				}
				default:
					throw new AdapterCallError(
						tool,
						op,
						404,
						'unknown_op',
						'The eval set does not serve this op.',
						null,
					);
			}
		},
	});
	return { analyst: client('analyst'), worker: client('worker') };
}
