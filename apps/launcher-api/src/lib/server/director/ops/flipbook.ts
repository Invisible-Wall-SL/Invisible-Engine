import type { FlipbookClip } from 'engine-flipbook';
import { listClips, loadClip, saveClip, type FlipbookClipRow } from '../../flipbookStorage';
import { clipDocKey } from '../../projectPaths';
import { headObject } from '../../r2';
import { AdapterError, defineOp } from '../adapter';
import { NEW_DOC, baseEtagProp, baseOf, preconditionOf, projectOf } from './docs';

/**
 * Invisible Flipbook adapters (PLAN 2.6), through `flipbookStorage.ts`: the tool's own listing,
 * `loadClip` and `saveClip` (normalized by `engine-flipbook`, one `If-Match` per clip doc). A clip
 * is an ordered, timed run of atlas frames; a frame named twice in a row is a hold.
 */

/** A clip's file stem, as `r2Slug` writes it. */
const CLIP_ID = '^[a-z0-9_]{1,60}$';

export const listClipsOp = defineOp<
	{ id?: string },
	{ clips: (FlipbookClipRow & { baseEtag: string })[]; clip?: FlipbookClip }
>({
	tool: 'flipbook',
	name: 'list_clips',
	description:
		"The project's Flipbook clips (id, name, frame count, sheet, playback) with each one's baseEtag. Name an `id` to also get that clip's full frame list.",
	inputSchema: {
		type: 'object',
		properties: { id: { type: 'string', pattern: CLIP_ID } },
		additionalProperties: false,
	},
	agents: ['animator'],
	scope: 'project',
	write: false,
	handler: async (ctx, { id }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const rows = await listClips(clientKey, projectKey);
		const clips = await Promise.all(
			rows.map(async (row) => {
				const head = await headObject(clipDocKey(clientKey, projectKey, row.id));
				return { ...row, baseEtag: baseOf(head?.etag) };
			}),
		);
		if (!id) return { clips };
		const { clip } = await loadClip(clientKey, projectKey, id);
		if (!clip) throw new AdapterError(404, 'unknown_clip', `No clip "${id}" in this project.`);
		return { clips, clip };
	},
});

export const saveClipOp = defineOp<
	{
		id: string;
		name?: string;
		assetKey: string;
		frames: string[];
		fps?: number;
		loop?: boolean;
		direction?: 'forward' | 'reverse' | 'pingpong';
		baseEtag: string;
	},
	{ id: string; clip: FlipbookClip; baseEtag: string }
>({
	tool: 'flipbook',
	name: 'save_clip',
	description:
		'Save a whole clip: its sheet (`assetKey`), its ordered frames (repeat a frame to hold it), fps, loop and direction. A new clip takes baseEtag "new"; an existing one the baseEtag flipbook.list_clips returned. Fields not given keep the stored clip\'s values.',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'string', pattern: CLIP_ID },
			name: { type: 'string', minLength: 1, maxLength: 120 },
			assetKey: { type: 'string', minLength: 1, maxLength: 400 },
			frames: {
				type: 'array',
				maxItems: 512,
				items: { type: 'string', minLength: 1, maxLength: 400 },
			},
			fps: { type: 'number', minimum: 1, maximum: 240 },
			loop: { type: 'boolean' },
			direction: { type: 'string', enum: ['forward', 'reverse', 'pingpong'] },
			baseEtag: baseEtagProp,
		},
		required: ['id', 'assetKey', 'frames', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['animator'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [clipDocKey(scope.clientKey, scope.projectKey, input.id)],
	handler: async (ctx, { baseEtag, ...input }) => {
		if (input.frames.length === 0) {
			throw new AdapterError(400, 'invalid_input', 'A clip needs at least one frame.');
		}
		const { clientKey, projectKey } = projectOf(ctx);
		const stored =
			baseEtag === NEW_DOC ? null : (await loadClip(clientKey, projectKey, input.id)).clip;
		const saved = await saveClip(
			clientKey,
			projectKey,
			{ ...stored, name: stored?.name ?? input.id, ...input },
			preconditionOf(baseEtag),
			ctx.savedBy,
		);
		return { id: saved.id, clip: saved.clip, baseEtag: baseOf(saved.etag) };
	},
});

export const FLIPBOOK_OPS = [listClipsOp, saveClipOp];
