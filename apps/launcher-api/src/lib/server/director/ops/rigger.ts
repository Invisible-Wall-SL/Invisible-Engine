import { SUB, projectPrefix } from '../../projectPaths';
import { ConflictError, getObjectTextWithEtag, listAllKeys } from '../../r2';
import { irigDocProblem } from '../../riggerIrig';
import { irigTarget, writeIrig } from '../../riggerIrigWrite';
import { stampSavedBy } from '../../savedBy';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf } from './docs';

/**
 * Invisible Rigger adapters (PLAN 2.6), through `riggerIrigWrite.ts`: the Rigger's own `.irig`
 * write (backup before the PUT, `If-Match`, then the `skeletons.json` re-index). A rig that has
 * only its artist's source `.json` is saved as its `.irig` beside it, as the Rigger saves it.
 *
 * Rebinding re-points a skin attachment at another region of the rig's own atlas, and that is
 * all: bones, slots, timelines and timings are never touched (no re-timing), and an attachment
 * with no region (bounding box, path, point, clipping) is refused and listed.
 */

const SEGMENT = '[A-Za-z0-9_-][A-Za-z0-9_. -]{0,119}';
const DIR = `^(${SEGMENT}(/${SEGMENT}){0,7})?$`;
const STEM = `^${SEGMENT}$`;
const NAME = { type: 'string', minLength: 1, maxLength: 200 } as const;

/** Attachment types drawn from an atlas region; Spine reads an absent type as `region`. */
const REGION_TYPES = new Set(['region', 'mesh', 'linkedmesh']);
const MAX_RIGS = 100;

type Attachment = { type?: string; path?: string; [k: string]: unknown };
interface Skin {
	name: string;
	attachments?: Record<string, Record<string, Attachment>>;
}
interface Rig {
	skins?: Skin[];
	animations?: Record<string, unknown>;
	[k: string]: unknown;
}

const spines = (ctx: AdapterContext) => {
	const { clientKey, projectKey } = projectOf(ctx);
	return SUB.spines(clientKey, projectKey);
};
const folderOf = (spinesPrefix: string, dir: string) =>
	dir ? `${spinesPrefix}/${dir}` : spinesPrefix;

/** The rig at `<dir>/<stem>`: its `.irig` when it has one, else its source `.json`. */
async function loadRig(spinesPrefix: string, dir: string, stem: string) {
	const folder = folderOf(spinesPrefix, dir);
	for (const ext of ['irig', 'json'] as const) {
		const got = await getObjectTextWithEtag(`${folder}/${stem}.${ext}`);
		if (!got) continue;
		let rig: unknown;
		try {
			rig = JSON.parse(got.text);
		} catch {
			rig = null;
		}
		if (irigDocProblem(rig) !== null) {
			if (ext === 'irig') {
				throw new AdapterError(409, 'unreadable_rig', `"${stem}.irig" does not load as a rig.`);
			}
			continue;
		}
		return { rig: rig as Rig, file: `${stem}.${ext}`, irigEtag: ext === 'irig' ? got.etag : null };
	}
	return null;
}

/** Region names in a libGDX / Spine `.atlas`: each page's header line, then its regions. */
function atlasRegions(text: string): Set<string> {
	const out = new Set<string>();
	let pageNext = true;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) {
			pageNext = true;
		} else if (pageNext) {
			pageNext = false;
		} else if (!line.includes(':')) {
			out.add(line);
		}
	}
	return out;
}

/** The rig's atlas, matched as the skeleton index matches it: same stem, else the folder's first. */
async function loadAtlasRegions(spinesPrefix: string, dir: string, stem: string) {
	const folder = `${folderOf(spinesPrefix, dir)}/`;
	const atlases = (await listAllKeys(folder))
		.map((k) => k.slice(folder.length))
		.filter((n) => !n.includes('/') && n.toLowerCase().endsWith('.atlas'));
	const atlas = atlases.find((n) => n.slice(0, -'.atlas'.length) === stem) ?? atlases[0];
	const text = atlas ? await getObjectTextWithEtag(`${folder}${atlas}`) : null;
	return text ? { atlas, regions: atlasRegions(text.text) } : null;
}

const attachmentsOf = (rig: Rig) =>
	(rig.skins ?? []).flatMap((skin) =>
		Object.entries(skin.attachments ?? {}).flatMap(([slot, byName]) =>
			Object.entries(byName).map(([attachment, a]) => ({
				skin: skin.name,
				slot,
				attachment,
				type: a.type ?? 'region',
				region: REGION_TYPES.has(a.type ?? 'region') ? (a.path ?? attachment) : null,
			})),
		),
	);

export const listRigs = defineOp<
	Record<string, never>,
	{
		rigs: {
			dir: string;
			stem: string;
			file: string;
			hasIrig: boolean;
			atlas: string | null;
			animations: string[];
			attachments: ReturnType<typeof attachmentsOf>;
			baseEtag: string;
		}[];
	}
>({
	tool: 'rigger',
	name: 'list_rigs',
	description:
		"The project's Spine rigs: each one's folder (`dir`) and `stem`, its atlas, its animations, and every skin attachment with the atlas region it draws. Plus the baseEtag to hand back to rigger.rebind_attachments.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['animator'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const prefix = spines(ctx);
		const seen = new Map<string, { dir: string; stem: string }>();
		for (const key of await listAllKeys(`${prefix}/`)) {
			const rel = key.slice(prefix.length + 1);
			const m = /^(?:(.*)\/)?([^/]+)\.(irig|json)$/.exec(rel);
			if (!m || rel === 'skeletons.json') continue;
			const dir = m[1] ?? '';
			if (!seen.has(`${dir}/${m[2]}`)) seen.set(`${dir}/${m[2]}`, { dir, stem: m[2] });
		}
		const rigs = [];
		for (const { dir, stem } of seen.values()) {
			const loaded = await loadRig(prefix, dir, stem).catch((e: unknown) => {
				if (e instanceof AdapterError) return null;
				throw e;
			});
			if (!loaded) continue;
			const atlas = await loadAtlasRegions(prefix, dir, stem);
			rigs.push({
				dir,
				stem,
				file: loaded.file,
				hasIrig: loaded.irigEtag !== null,
				atlas: atlas?.atlas ?? null,
				animations: Object.keys(loaded.rig.animations ?? {}),
				attachments: attachmentsOf(loaded.rig),
				baseEtag: baseOf(loaded.irigEtag),
			});
			if (rigs.length === MAX_RIGS) break;
		}
		return { rigs };
	},
});

interface Rebind {
	skin?: string;
	slot: string;
	attachment: string;
	region: string;
}

export const rebindAttachments = defineOp<
	{ dir: string; stem: string; rebinds: Rebind[]; baseEtag: string },
	{
		dir: string;
		stem: string;
		applied: Required<Rebind>[];
		refused: (Rebind & { reason: string })[];
		indexed: boolean;
		message?: string;
		baseEtag: string;
	}
>({
	tool: 'rigger',
	name: 'rebind_attachments',
	description:
		"Re-point skin attachments at other regions of the rig's own atlas (new art, same rig). Only the attachment's region changes: no bone, slot, animation or timing is touched. Attachments that draw no region, and regions the atlas lacks, are refused and listed.",
	inputSchema: {
		type: 'object',
		properties: {
			dir: {
				type: 'string',
				description: 'The rig folder, as rigger.list_rigs gave it.',
				pattern: DIR,
			},
			stem: { type: 'string', pattern: STEM },
			rebinds: {
				type: 'array',
				maxItems: 200,
				items: {
					type: 'object',
					properties: {
						skin: { ...NAME, description: 'Defaults to "default".' },
						slot: NAME,
						attachment: NAME,
						region: NAME,
					},
					required: ['slot', 'attachment', 'region'],
					additionalProperties: false,
				},
			},
			baseEtag: baseEtagProp,
		},
		required: ['dir', 'stem', 'rebinds', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['animator'],
	scope: 'project',
	write: true,
	// The `.irig`, the re-derived skeleton index (and any atlas it rebuilds), and the rig's backups.
	writes: (_input, scope) => [
		`${SUB.spines(scope.clientKey, scope.projectKey)}/`,
		`${projectPrefix(scope.clientKey, scope.projectKey)}/rigger-backups/`,
	],
	handler: async (ctx, { dir, stem, rebinds, baseEtag }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const prefix = spines(ctx);
		const loaded = await loadRig(prefix, dir, stem);
		if (!loaded) throw new AdapterError(404, 'unknown_rig', `No rig "${stem}" in "${dir}".`);
		const atlas = await loadAtlasRegions(prefix, dir, stem);
		if (!atlas) {
			throw new AdapterError(409, 'no_atlas', `The rig "${stem}" has no atlas to re-point into.`);
		}
		const { rig } = loaded;
		const applied: Required<Rebind>[] = [];
		const refused: (Rebind & { reason: string })[] = [];
		for (const rebind of rebinds) {
			const skin = rebind.skin ?? 'default';
			const found = rig.skins?.find((s) => s.name === skin)?.attachments?.[rebind.slot]?.[
				rebind.attachment
			];
			if (!found) {
				const reason = `no attachment "${rebind.attachment}" in slot "${rebind.slot}" of skin "${skin}"`;
				refused.push({ ...rebind, reason });
				continue;
			}
			const type = found.type ?? 'region';
			const reason = !REGION_TYPES.has(type)
				? `a ${type} attachment draws no region`
				: !atlas.regions.has(rebind.region)
					? `"${rebind.region}" is not a region of ${atlas.atlas}`
					: null;
			if (reason) {
				refused.push({ ...rebind, reason });
				continue;
			}
			if (rebind.region === rebind.attachment) delete found.path;
			else found.path = rebind.region;
			applied.push({ ...rebind, skin });
		}
		if (applied.length === 0) {
			return { dir, stem, applied, refused, indexed: true, baseEtag: baseOf(loaded.irigEtag) };
		}
		const target = irigTarget(
			clientKey,
			projectKey,
			Buffer.from(dir, 'utf8').toString('base64url'),
			stem,
		);
		const text = JSON.stringify(stampSavedBy(rig, ctx.savedBy));
		const res = await writeIrig(clientKey, projectKey, target, text, preconditionOf(baseEtag));
		if (res.ok) {
			return { dir, stem, applied, refused, indexed: true, baseEtag: baseOf(res.etag) };
		}
		const body = (await res.response.json()) as {
			error?: string;
			saved?: boolean;
			etag?: string | null;
			message?: string;
		};
		if (body.error === 'conflict') throw new ConflictError(target.key);
		if (!body.saved) {
			throw new AdapterError(502, 'rigger_refused', body.message ?? 'The Rigger refused the save.');
		}
		// Saved, but the index could not list it: reporting failure would release the opId, and the
		// retry would then conflict with this very write.
		return {
			dir,
			stem,
			applied,
			refused,
			indexed: false,
			message: body.message,
			baseEtag: baseOf(body.etag),
		};
	},
});

export const RIGGER_OPS = [listRigs, rebindAttachments];
