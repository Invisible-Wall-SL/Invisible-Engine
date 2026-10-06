import { createHash } from 'node:crypto';
import { CHARSET_LABELS, type CharsetPreset } from '../../../../routes/(app)/fonts/charsets.client';
import type { FontRecipeDoc } from '../../../../routes/(app)/fonts/fonts.client';
import { defaultGradientStops } from '../../../gradient';
import { etagDiffers } from '../../docBackups';
import { loadRenderableFonts } from '../../fonts';
import { projectPrefix } from '../../projectPaths';
import {
	ConflictError,
	copyObject,
	getObjectBytes,
	getObjectTextWithEtag,
	headObject,
	listAllKeys,
	precondition,
	putObjectText,
} from '../../r2';
import { stampSavedBy, type SavedByStamp } from '../../savedBy';
import { allowedPrefixes, isKeyAllowed } from '../../toolScope';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf } from './docs';

/**
 * Invisible Font Maker adapters (PLAN 2.6). Fonts are read from the catalogs the game renders
 * (`fonts.ts` `loadRenderableFonts`: the project's `fonts.json` plus the shared library).
 *
 * A font Director asks for is never shipped by Director. The Font Maker bakes a bitmap font in the
 * browser (Canvas 2D), so `fonts.bake_from_ttf` stages the bake: the source TTF/OTF and the SAME
 * re-bake recipe the Font Maker saves beside every font it generates (`FontRecipeDoc`), in a
 * request at `<client>/<project>/director/fonts/<folder>/request.json` with status
 * `awaiting_owner`. Nothing is added to `fonts.json`, so nothing reaches the game until the owner
 * opens the request in the Font Maker, bakes it and saves it.
 */

const FOLDER = '^[a-z0-9][a-z0-9_-]{0,59}$';
const HEX = '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$';
const PRESETS = Object.keys(CHARSET_LABELS) as CharsetPreset[];
const MAX_FONT_BYTES = 20 * 1024 * 1024;

/** The sfnt signatures a TTF / OTF opens with: TrueType (2), CFF-flavoured OpenType. */
const SFNT_SIGNATURES = ['00010000', '74727565', '4f54544f'];
const isSfnt = (bytes: Uint8Array) =>
	SFNT_SIGNATURES.includes(Buffer.from(bytes.subarray(0, 4)).toString('hex'));

/** `awaiting_owner` until the owner bakes the font in Font Maker and marks the request done. */
export type FontRequestStatus = 'awaiting_owner' | 'done';

/** The pending request a bake leaves for the owner. */
export interface FontBakeRequest {
	version: 1;
	status: FontRequestStatus;
	folder: string;
	/** The copied source font, beside this request. */
	sourceFile: string;
	/** Where the source was copied from. */
	sourceKey: string;
	/** The Font Maker's own re-bake recipe. */
	recipe: FontRecipeDoc;
	/** Who marked it done, and when (`fontRequests.ts`). */
	done?: { by: { uid: string; name: string }; at: string };
	/** Which run and agent staged it, kept when the owner's mark replaces `saved_by`. */
	requested?: { agent?: string; runId?: string; at?: string };
	saved_by?: SavedByStamp;
}

/** Where a project's staged font requests live: `<folder>/request.json` under it. */
export const fontRequestsRoot = (scope: { clientKey: string; projectKey: string }) =>
	`${projectPrefix(scope.clientKey, scope.projectKey)}/director/fonts/`;

async function listRequests(ctx: AdapterContext) {
	const root = fontRequestsRoot(projectOf(ctx));
	const keys = (await listAllKeys(root)).filter((k) => k.endsWith('/request.json'));
	const out = [];
	for (const key of keys) {
		const got = await getObjectTextWithEtag(key);
		if (!got) continue;
		try {
			const doc = JSON.parse(got.text) as FontBakeRequest;
			out.push({
				folder: doc.folder,
				face: doc.recipe.face,
				status: doc.status,
				preset: doc.recipe.preset,
				bakeSize: doc.recipe.bakeSize,
				baseEtag: baseOf(got.etag),
			});
		} catch {
			continue;
		}
	}
	return out;
}

export const listFonts = defineOp<
	Record<string, never>,
	{
		fonts: { id: string; name: string; kind: string; folder: string; shared: boolean }[];
		pending: Awaited<ReturnType<typeof listRequests>>;
	}
>({
	tool: 'fonts',
	name: 'list',
	description:
		"The fonts the project's game can render (its own Font Maker fonts, then the shared library's), and the bakes Director has staged that wait for the owner, each with the baseEtag to restage it.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['builder', 'mockup-analyst'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const fonts = (await loadRenderableFonts(clientKey, projectKey)) ?? [];
		return {
			fonts: fonts.map(({ font, shared }) => ({
				id: font.id,
				name: font.name,
				kind: font.kind,
				folder: font.folder,
				shared,
			})),
			pending: await listRequests(ctx),
		};
	},
});

interface BakeInput {
	folder: string;
	face: string;
	source: string;
	preset: CharsetPreset;
	custom?: string;
	bakeSize: number;
	kerning?: boolean;
	fillColor?: string;
	outlineColor?: string;
	outlineWidth?: number;
	baseEtag: string;
}

export const bakeFromTtf = defineOp<
	BakeInput,
	{ folder: string; status: FontRequestStatus; request: string; baseEtag: string }
>({
	tool: 'fonts',
	name: 'bake_from_ttf',
	description:
		'Stage a bitmap-font bake from a TTF/OTF in the project (or the shared font library) for the owner to approve: face name, character set, size and colours. The font is NOT added to the game; it waits for the owner, who bakes and saves it in Invisible Font Maker. A new request takes baseEtag "new".',
	inputSchema: {
		type: 'object',
		properties: {
			folder: { type: 'string', description: 'The new font id / folder.', pattern: FOLDER },
			face: { type: 'string', description: 'The font family name.', pattern: '\\S', maxLength: 80 },
			source: {
				type: 'string',
				description: "R2 key of a .ttf/.otf in the run's project or under _shared/fonts/.",
				pattern: '^[A-Za-z0-9_./ -]{1,400}\\.(ttf|otf|TTF|OTF)$',
			},
			preset: { type: 'string', enum: PRESETS },
			custom: {
				type: 'string',
				description: 'The characters, for preset custom.',
				maxLength: 2000,
			},
			bakeSize: { type: 'integer', minimum: 8, maximum: 256 },
			kerning: { type: 'boolean' },
			fillColor: { type: 'string', pattern: HEX },
			outlineColor: { type: 'string', pattern: HEX },
			outlineWidth: { type: 'integer', minimum: 1, maximum: 32 },
			baseEtag: baseEtagProp,
		},
		required: ['folder', 'face', 'source', 'preset', 'bakeSize', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [`${fontRequestsRoot(scope)}${input.folder}/`],
	handler: async (ctx, input) => {
		const scope = projectOf(ctx);
		const sources = allowedPrefixes(scope.clientKey, scope.projectKey, {
			includeSharedFonts: true,
		});
		if (!isKeyAllowed(input.source, sources)) {
			throw new AdapterError(
				403,
				'out_of_scope',
				`${input.source} is outside the run's project and the shared font library.`,
			);
		}
		if (input.preset === 'custom' && !input.custom?.trim()) {
			throw new AdapterError(400, 'invalid_input', 'A custom preset needs its characters.');
		}
		const catalog = (await loadRenderableFonts(scope.clientKey, scope.projectKey)) ?? [];
		if (catalog.some(({ font }) => font.id === input.folder || font.folder === input.folder)) {
			throw new AdapterError(409, 'font_exists', `A font "${input.folder}" already exists.`);
		}

		const sourceHead = await headObject(input.source);
		if (!sourceHead) throw new AdapterError(404, 'unknown_source', `No font at ${input.source}.`);
		if (sourceHead.size > MAX_FONT_BYTES) {
			throw new AdapterError(413, 'too_large', 'The source font is over 20 MB.');
		}
		const bytes = await getObjectBytes(input.source);
		if (!bytes) throw new AdapterError(404, 'unknown_source', `No font at ${input.source}.`);
		if (bytes.body.length > MAX_FONT_BYTES) {
			throw new AdapterError(413, 'too_large', 'The source font is over 20 MB.');
		}
		if (!isSfnt(bytes.body)) {
			throw new AdapterError(
				400,
				'bad_font',
				`${input.source} is not a TrueType or OpenType font.`,
			);
		}

		const ext = input.source.slice(input.source.lastIndexOf('.') + 1).toLowerCase();
		const hash = createHash('sha256').update(bytes.body).digest('hex').slice(0, 12);
		// Named by its bytes, so restaging another font in this folder never replaces a source an
		// earlier request still names.
		const sourceFile = `_src-${hash}.${ext}`;
		const folderKey = `${fontRequestsRoot(scope)}${input.folder}/`;
		const key = `${folderKey}request.json`;
		// Settle the precondition before anything is written, so a conflict leaves nothing behind. A
		// save racing in after this still loses at the PUT; it then leaves only an unreferenced copy.
		const base = preconditionOf(input.baseEtag);
		const head = await headObject(key);
		const stale = base === null ? head !== null : !head?.etag || etagDiffers(head.etag, base);
		if (stale) throw new ConflictError(key);
		if (!(await copyObject(input.source, `${folderKey}${sourceFile}`, `font/${ext}`))) {
			throw new AdapterError(404, 'unknown_source', `No font at ${input.source}.`);
		}

		const request: FontBakeRequest = {
			version: 1,
			status: 'awaiting_owner',
			folder: input.folder,
			sourceFile,
			sourceKey: input.source,
			recipe: {
				version: 1,
				face: input.face.trim(),
				sourceFileName: input.source.slice(input.source.lastIndexOf('/') + 1),
				preset: input.preset,
				custom: input.custom ?? '',
				bakeSize: input.bakeSize,
				pageMaxWidth: 1024,
				pageMaxHeight: 2048,
				kerning: input.kerning ?? true,
				effects: {
					fill: {
						enabled: true,
						mode: 'solid',
						color: input.fillColor ?? '#ffffff',
						stops: defaultGradientStops(),
					},
					outline: {
						enabled: input.outlineColor !== undefined,
						width: input.outlineWidth ?? 3,
						color: input.outlineColor ?? '#000000',
					},
					shadow: { enabled: false, offsetX: 0, offsetY: 2, blur: 4, color: '#000000cc' },
				},
			},
		};
		const etag = await putObjectText(
			key,
			JSON.stringify(stampSavedBy(request, ctx.savedBy), null, 2),
			'application/json',
			precondition(base),
		);
		return {
			folder: input.folder,
			status: 'awaiting_owner',
			request: key,
			baseEtag: baseOf(etag),
		};
	},
});

export const FONTS_OPS = [listFonts, bakeFromTtf];
