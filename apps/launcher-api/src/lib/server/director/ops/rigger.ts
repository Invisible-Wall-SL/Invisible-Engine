import { mapWithConcurrency } from '../../concurrency';
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
// No `..` anywhere: `irigTarget` refuses one with a SvelteKit error, which is not an adapter answer.
const DIR = `^(?!.*\\.\\.)(${SEGMENT}(/${SEGMENT}){0,7})?$`;
const STEM = `^(?!.*\\.\\.)${SEGMENT}$`;
const DIR_RE = new RegExp(DIR);
const STEM_RE = new RegExp(STEM);
const NAME = { type: 'string', minLength: 1, maxLength: 200 } as const;

/** Attachment types drawn from an atlas region; rig reads an absent type as `region`. */
const REGION_TYPES = new Set(['region', 'mesh', 'linkedmesh']);
const MAX_RIGS = 100;
/** Skeleton-shaped files read per listing; past this the list is truncated rather than slow. */
const MAX_CANDIDATES = 400;
const RIG_READ_CONCURRENCY = 8;

type Attachment = {
	type?: string;
	name?: string;
	path?: string;
	sequence?: unknown;
	[k: string]: unknown;
};
interface Skin {
	name: string;
	attachments?: Record<string, Record<string, Attachment>>;
}
interface Rig {
	skins?: Skin[];
	animations?: Record<string, unknown>;
	[k: string]: unknown;
}

const rigBundlesPrefix = (ctx: AdapterContext) => {
	const { clientKey, projectKey } = projectOf(ctx);
	return SUB.spines(clientKey, projectKey);
};
const folderOf = (rigsPrefix: string, dir: string) => (dir ? `${rigsPrefix}/${dir}` : rigsPrefix);

/** The rig at `<dir>/<stem>`: its `.irig` when it has one, else its source `.json`. */
async function loadRig(rigsPrefix: string, dir: string, stem: string) {
	const folder = folderOf(rigsPrefix, dir);
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

/** Region names in a libGDX / Spine-format `.atlas`: each page's header line, then its regions. */
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

/**
 * The rig's atlas among its folder's `.atlas` files, matched as the skeleton index matches it: same
 * stem, else the folder's first.
 */
async function loadAtlasRegions(rigsPrefix: string, dir: string, stem: string, atlases: string[]) {
	const atlas = atlases.find((n) => n.slice(0, -'.atlas'.length) === stem) ?? atlases[0];
	const text = atlas ? await getObjectTextWithEtag(`${folderOf(rigsPrefix, dir)}/${atlas}`) : null;
	return text ? { atlas, regions: atlasRegions(text.text) } : null;
}

/** The `.atlas` file names directly in each folder of a `spines/` listing, by folder. */
function atlasesByDir(rigsPrefix: string, keys: string[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const key of keys) {
		const m = /^(?:(.*)\/)?([^/]+\.atlas)$/i.exec(key.slice(rigsPrefix.length + 1));
		if (!m) continue;
		const dir = m[1] ?? '';
		out.set(dir, [...(out.get(dir) ?? []), m[2]]);
	}
	return out;
}

/** The region an attachment draws, as rig resolves it: `path`, else `name`, else its key. */
const drawnRegion = (a: Attachment, key: string) => a.path ?? a.name ?? key;

const attachmentsOf = (rig: Rig) =>
	(rig.skins ?? []).flatMap((skin) =>
		Object.entries(skin.attachments ?? {}).flatMap(([slot, byName]) =>
			Object.entries(byName).map(([attachment, a]) => ({
				skin: skin.name,
				slot,
				attachment,
				type: a.type ?? 'region',
				region: REGION_TYPES.has(a.type ?? 'region') ? drawnRegion(a, attachment) : null,
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
		/** Rigs whose folder or file name rigger.rebind_attachments cannot address. */
		unsupported: string[];
		truncated: boolean;
	}
>({
	tool: 'rigger',
	name: 'list_rigs',
	description:
		"The project's rigs: each one's folder (`dir`) and `stem`, its atlas, its animations, and every skin attachment with the atlas region it draws. Plus the baseEtag to hand back to rigger.rebind_attachments.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['animator'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const prefix = rigBundlesPrefix(ctx);
		const keys = await listAllKeys(`${prefix}/`);
		const atlases = atlasesByDir(prefix, keys);
		const seen = new Map<string, { dir: string; stem: string }>();
		const unsupported = new Set<string>();
		for (const key of keys) {
			const rel = key.slice(prefix.length + 1);
			const m = /^(?:(.*)\/)?([^/]+)\.(irig|json)$/.exec(rel);
			if (!m || rel === 'skeletons.json') continue;
			const dir = m[1] ?? '';
			const name = dir ? `${dir}/${m[2]}` : m[2];
			if (!DIR_RE.test(dir) || !STEM_RE.test(m[2])) unsupported.add(name);
			else if (!seen.has(name)) seen.set(name, { dir, stem: m[2] });
		}
		const candidates = [...seen.values()];
		const read = await mapWithConcurrency(
			candidates.slice(0, MAX_CANDIDATES),
			RIG_READ_CONCURRENCY,
			async ({ dir, stem }) => {
				const loaded = await loadRig(prefix, dir, stem).catch((e: unknown) => {
					if (e instanceof AdapterError) return null;
					throw e;
				});
				if (!loaded) return null;
				const atlas = await loadAtlasRegions(prefix, dir, stem, atlases.get(dir) ?? []);
				return {
					dir,
					stem,
					file: loaded.file,
					hasIrig: loaded.irigEtag !== null,
					atlas: atlas?.atlas ?? null,
					animations: Object.keys(loaded.rig.animations ?? {}),
					attachments: attachmentsOf(loaded.rig),
					baseEtag: baseOf(loaded.irigEtag),
				};
			},
		);
		const rigs = read.filter((rig) => rig !== null);
		return {
			rigs: rigs.slice(0, MAX_RIGS),
			unsupported: [...unsupported],
			truncated: candidates.length > MAX_CANDIDATES || rigs.length > MAX_RIGS,
		};
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
		/** Already drawing the region asked for: nothing to write. */
		unchanged: Required<Rebind>[];
		refused: (Rebind & { reason: string })[];
		indexed: boolean;
		message?: string;
		baseEtag: string;
	}
>({
	tool: 'rigger',
	name: 'rebind_attachments',
	description:
		"Re-point skin attachments at other regions of the rig's own atlas (new art, same rig). Only the attachment's region changes: no bone, slot, animation or timing is touched. Attachments that draw no region, sequences, and regions the atlas lacks are refused and listed; one already drawing the region asked for is listed as unchanged.",
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
		const prefix = rigBundlesPrefix(ctx);
		const loaded = await loadRig(prefix, dir, stem);
		if (!loaded) throw new AdapterError(404, 'unknown_rig', `No rig "${stem}" in "${dir}".`);
		const folder = `${folderOf(prefix, dir)}/`;
		const atlases = (await listAllKeys(folder))
			.map((k) => k.slice(folder.length))
			.filter((n) => !n.includes('/') && n.toLowerCase().endsWith('.atlas'));
		const atlas = await loadAtlasRegions(prefix, dir, stem, atlases);
		if (!atlas) {
			throw new AdapterError(409, 'no_atlas', `The rig "${stem}" has no atlas to re-point into.`);
		}
		const { rig } = loaded;
		const applied: Required<Rebind>[] = [];
		const unchanged: Required<Rebind>[] = [];
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
				: found.sequence !== undefined
					? 'a sequence attachment names a run of regions, not one'
					: !atlas.regions.has(rebind.region)
						? `"${rebind.region}" is not a region of ${atlas.atlas}`
						: null;
			if (reason) {
				refused.push({ ...rebind, reason });
				continue;
			}
			if (drawnRegion(found, rebind.attachment) === rebind.region) {
				unchanged.push({ ...rebind, skin });
				continue;
			}
			// Rig falls back from `path` to `name` to the key: set `path` only where it is needed.
			if (rebind.region === (found.name ?? rebind.attachment)) delete found.path;
			else found.path = rebind.region;
			applied.push({ ...rebind, skin });
		}
		if (applied.length === 0) {
			return { dir, stem, applied, unchanged, refused, indexed: true, baseEtag };
		}
		const target = irigTarget(
			clientKey,
			projectKey,
			Buffer.from(dir, 'utf8').toString('base64url'),
			stem,
		);
		// The `.irig` ships verbatim in game bundles (as the bundle's skeleton), so its stamp names the
		// run and the agent but not the owner: the run leads back to them inside the launcher.
		const { tool, agent, runId, at, rev } = ctx.savedBy;
		const text = JSON.stringify(stampSavedBy(rig, { tool, agent, runId, at, rev }));
		const res = await writeIrig(clientKey, projectKey, target, text, preconditionOf(baseEtag));
		if (res.ok) {
			return { dir, stem, applied, unchanged, refused, indexed: true, baseEtag: baseOf(res.etag) };
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
			unchanged,
			refused,
			indexed: false,
			message: body.message,
			baseEtag: baseOf(body.etag),
		};
	},
});

export const RIGGER_OPS = [listRigs, rebindAttachments];
