import { getObjectBytes, putObjectBytes } from '../../r2';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';
import {
	cropImage,
	dominantColors,
	downscaleForModel,
	modelScale,
	unscaleBox,
	type Box,
	type DominantColor,
} from '../mockupPixels';
import {
	MODEL_LONG_EDGE,
	cropKey,
	directorPrefix,
	loadMockupsDoc,
	readMockup,
	type MockupImage,
	type MockupsDoc,
} from '../mockups';

/**
 * Mockup adapters (ADR-0005). The analyst reads the doc and each image's model-sized copy here,
 * with the image's dominant colours alongside so the worker can verify the palette the model
 * proposes without decoding a pixel. The worker's own code — never the model — saves the crops of
 * the elements it matched; the art director reads them back next to a region's variants.
 */

const UPLOAD_ID = '^[a-f0-9]{16}$';
// The same shape Atlas Maker accepts for a region, and a single path segment under `crops/`; `..`
// is refused outright so a crop key can never read as a path escape.
const REGION = '^(?!.*\\.\\.)[A-Za-z0-9_][A-Za-z0-9_.()-]{0,119}$';
const MAX_CROPS = 128;

const scope = (ctx: AdapterContext) => ctx.scope!;

async function loadDoc(ctx: AdapterContext): Promise<MockupsDoc> {
	const { clientKey, projectKey } = scope(ctx);
	return (await loadMockupsDoc(clientKey, projectKey)).doc;
}

function requireImage(doc: MockupsDoc, id: string): MockupImage {
	const image = doc.images.find((img) => img.id === id);
	if (!image) throw new AdapterError(404, 'unknown_mockup', `No mockup "${id}" in this project.`);
	return image;
}

async function requireBytes(ctx: AdapterContext, image: MockupImage): Promise<Uint8Array> {
	const { clientKey, projectKey } = scope(ctx);
	const bytes = await readMockup(clientKey, projectKey, image);
	if (!bytes) {
		throw new AdapterError(502, 'mockup_missing', `The file of mockup "${image.id}" is gone.`);
	}
	return bytes;
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

export interface MockupListing {
	fidelity: MockupsDoc['fidelity'];
	ownershipConfirmed: MockupsDoc['ownershipConfirmed'];
	modelLongEdge: number;
	images: Pick<MockupImage, 'id' | 'file' | 'mediaType' | 'w' | 'h' | 'tag' | 'styleOnly'>[];
}

export const listMockups = defineOp<Record<string, never>, MockupListing>({
	tool: 'mockups',
	name: 'list',
	description:
		"The run's mockups: each image's size, screen tag and whether it is a style reference only, plus the fidelity mode and the recorded ownership check.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['mockup-analyst', 'worker'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const doc = await loadDoc(ctx);
		return {
			fidelity: doc.fidelity,
			ownershipConfirmed: doc.ownershipConfirmed,
			modelLongEdge: MODEL_LONG_EDGE,
			images: doc.images.map(({ id, file, mediaType, w, h, tag, styleOnly }) => ({
				id,
				file,
				mediaType,
				w,
				h,
				tag,
				styleOnly,
			})),
		};
	},
});

export interface MockupImageResult {
	id: string;
	tag: string;
	styleOnly: boolean;
	mediaType: MockupImage['mediaType'];
	/** The copy the model sees: at most `modelLongEdge` on the long side. */
	base64: string;
	w: number;
	h: number;
	/** Model pixels per original pixel; boxes the model returns are divided by it for a crop. */
	scale: number;
	original: { w: number; h: number };
	/** The image's k-means clusters: what a proposed palette colour must be close to. */
	dominantColors: DominantColor[];
}

export const getMockupImage = defineOp<{ id: string }, MockupImageResult>({
	tool: 'mockups',
	name: 'get_image',
	description:
		'One mockup as the model should see it (downscaled to at most 1568 px on the long edge, base64), its scale against the original, and its dominant colours.',
	inputSchema: {
		type: 'object',
		properties: { id: { type: 'string', description: 'The mockup id.', pattern: UPLOAD_ID } },
		required: ['id'],
		additionalProperties: false,
	},
	agents: ['mockup-analyst', 'worker'],
	scope: 'project',
	write: false,
	handler: async (ctx, { id }) => {
		const image = requireImage(await loadDoc(ctx), id);
		const bytes = await requireBytes(ctx, image);
		const [model, colors] = await Promise.all([
			downscaleForModel(bytes, image.mediaType),
			dominantColors(bytes),
		]);
		return {
			id: image.id,
			tag: image.tag,
			styleOnly: image.styleOnly,
			mediaType: model.mediaType,
			base64: toBase64(model.bytes),
			w: model.w,
			h: model.h,
			scale: model.scale,
			original: { w: image.w, h: image.h },
			dominantColors: colors,
		};
	},
});

export const getCrop = defineOp<
	{ region: string },
	{ region: string; mediaType: 'image/png'; base64: string }
>({
	tool: 'mockups',
	name: 'get_crop',
	description: 'The mockup crop the analyst saved for a region in this run, if any.',
	inputSchema: {
		type: 'object',
		properties: { region: { type: 'string', description: 'The region name.', pattern: REGION } },
		required: ['region'],
		additionalProperties: false,
	},
	agents: ['art-director', 'atlas-artist', 'worker'],
	scope: 'project',
	write: false,
	handler: async (ctx, { region }) => {
		const { clientKey, projectKey } = scope(ctx);
		const got = await getObjectBytes(cropKey(clientKey, projectKey, ctx.run.id, region));
		if (!got) throw new AdapterError(404, 'no_crop', `No crop for "${region}" in this run.`);
		return { region, mediaType: 'image/png', base64: toBase64(got.body) };
	},
});

export interface SaveCropsInput {
	crops: { imageId: string; region: string; box: Box }[];
}

export interface SaveCropsResult {
	saved: { region: string; key: string; imageId: string }[];
	skipped: { region: string; imageId: string; reason: string }[];
}

const boxProp = {
	type: 'object',
	description: "The element's box in the pixels of the image the model saw (mockups.get_image).",
	properties: {
		x: { type: 'number', minimum: 0 },
		y: { type: 'number', minimum: 0 },
		w: { type: 'number', minimum: 1 },
		h: { type: 'number', minimum: 1 },
	},
	required: ['x', 'y', 'w', 'h'],
	additionalProperties: false,
} as const;

export const saveCrops = defineOp<SaveCropsInput, SaveCropsResult>({
	tool: 'mockups',
	name: 'save_crops',
	description:
		"Cut each matched element's box out of its ORIGINAL mockup and store it as director/crops/<runId>/<region>.png, for the review panel and the atlas artist's reference.",
	inputSchema: {
		type: 'object',
		properties: {
			crops: {
				type: 'array',
				maxItems: MAX_CROPS,
				items: {
					type: 'object',
					properties: {
						imageId: { type: 'string', pattern: UPLOAD_ID },
						region: { type: 'string', pattern: REGION },
						box: boxProp,
					},
					required: ['imageId', 'region', 'box'],
					additionalProperties: false,
				},
			},
		},
		required: ['crops'],
		additionalProperties: false,
	},
	agents: ['worker'],
	scope: 'project',
	write: true,
	writes: (_input, s) => [`${directorPrefix(s.clientKey, s.projectKey)}/crops/`],
	handler: async (ctx, { crops }) => {
		const { clientKey, projectKey } = scope(ctx);
		const doc = await loadDoc(ctx);
		const originals = new Map<string, Promise<Uint8Array>>();
		const result: SaveCropsResult = { saved: [], skipped: [] };
		for (const crop of crops) {
			const image = doc.images.find((img) => img.id === crop.imageId);
			const skip = (reason: string) =>
				result.skipped.push({ region: crop.region, imageId: crop.imageId, reason });
			if (!image) {
				skip('unknown mockup');
				continue;
			}
			if (!originals.has(image.id)) originals.set(image.id, requireBytes(ctx, image));
			const bytes = await originals.get(image.id)!;
			// The same scale `get_image` applied, from the doc's dimensions: no re-encode per crop.
			const png = await cropImage(bytes, unscaleBox(crop.box, modelScale(image.w, image.h)));
			if (!png) {
				skip('the box is outside the image');
				continue;
			}
			const key = cropKey(clientKey, projectKey, ctx.run.id, crop.region);
			await putObjectBytes(key, png, 'image/png');
			result.saved.push({ region: crop.region, key, imageId: image.id });
		}
		return result;
	},
});

export const MOCKUP_OPS = [listMockups, getMockupImage, getCrop, saveCrops];
