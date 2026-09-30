import { error, json } from '@sveltejs/kit';
import { SUB } from './projectPaths';
import { ConflictError, headObject, precondition, putObjectText } from './r2';
import { backupIrigBeforeOverwrite, irigBackupsPrefix, pruneIrigBackups } from './riggerIrig';
import { reindexProjectSkeletons, writeSkeletonsIndex } from './spineReindex';

/**
 * Decode + path-guard the `{ dir, stem }` pair every `.irig` endpoint takes. `dir` is the
 * base64url bundle folder ('' = the spines root); `stem` is a single file-name segment.
 */
export function irigTarget(
	clientKey: string,
	projectKey: string,
	dirB64: unknown,
	stemRaw: unknown,
): { dir: string; stem: string; key: string; backupsPrefix: string; spinesPrefix: string } {
	const stem = typeof stemRaw === 'string' ? stemRaw : '';
	if (!stem) throw error(400, 'missing stem');
	let dir = '';
	if (typeof dirB64 === 'string' && dirB64) {
		try {
			dir = Buffer.from(dirB64, 'base64url').toString('utf8');
		} catch {
			throw error(400, 'bad dir');
		}
	}
	if (dir.includes('..') || stem.includes('..') || stem.includes('/'))
		throw error(403, 'forbidden');
	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${spinesPrefix}/${dir}` : spinesPrefix;
	return {
		dir,
		stem,
		key: `${bundlePrefix}/${stem}.irig`,
		backupsPrefix: irigBackupsPrefix(clientKey, projectKey, dir, stem),
		spinesPrefix,
	};
}

/**
 * The 409 a Rigger write answers when the tab's project is no longer the session's. The project
 * comes from the SESSION here, so a project switch in another tab would otherwise land this rig
 * in an unrelated project. Never bypassable by `force`.
 */
export function scopeMismatch(tabProject: string, projectKey: string): Response {
	return json(
		{
			ok: false,
			error: 'scope-mismatch',
			message:
				`This tab is editing "${tabProject}" but your active project is now ` +
				`"${projectKey}". Reload to continue — saving here would write to the wrong project.`,
		},
		{ status: 409 },
	);
}

/** Create a brand-new rig's `.irig` only if nothing is there yet. False = the name was taken. */
export async function claimNewIrig(key: string, text: string): Promise<boolean> {
	try {
		await putObjectText(key, text, 'application/json', precondition(null));
		return true;
	} catch (e) {
		if (e instanceof ConflictError) return false;
		throw e;
	}
}

export type IrigWriteResult =
	| { ok: true; etag: string | null; backupId: string | null; count: number }
	| { ok: false; response: Response };

/**
 * Back up the current `.irig`, write `text` under the caller's precondition, prune old backups,
 * and re-derive `skeletons.json`. `baseEtag` follows `precondition()`: a string = CAS update,
 * `null` = create (`If-None-Match: *`), `undefined` = the author's explicit force.
 */
export async function writeIrig(
	clientKey: string,
	projectKey: string,
	target: ReturnType<typeof irigTarget>,
	text: string,
	baseEtag: string | null | undefined,
): Promise<IrigWriteResult> {
	const backupId = await backupIrigBeforeOverwrite(target.key, target.backupsPrefix, baseEtag);
	let etag: string | null;
	try {
		etag = await putObjectText(target.key, text, 'application/json', precondition(baseEtag));
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
		// The current tag rides along so "overwrite with mine" can retry CONDITIONALLY on exactly the
		// version the author was shown, rather than dropping the precondition — an unconditional
		// retry would silently eat any save landing between the prompt and the click.
		const current = await headObject(target.key);
		return {
			ok: false,
			response: json(
				{
					ok: false,
					error: 'conflict',
					etag: current ? current.etag : null,
					message:
						baseEtag === null
							? `"${target.stem}.irig" was created by someone else while you were editing. ` +
								'Your changes are still here — reload to see theirs first.'
							: `Someone else saved "${target.stem}.irig" while you were editing. ` +
								'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			),
		};
	}
	await pruneIrigBackups(target.backupsPrefix).catch((e) =>
		console.warn('[rigger] irig backup prune failed (extra backups kept):', e),
	);

	const { spinesPrefix, dir, stem } = target;
	// Re-derive the index so the `.irig` is listed — preserving, so THIS save can never drop a
	// DIFFERENT atlas-less rig.
	const outcome = await reindexProjectSkeletons(clientKey, projectKey, spinesPrefix);

	// The rig has no atlas AND no source to rebuild one: writing the rebuilt index would list it
	// pointing at a missing atlas. Fail LOUDLY — the `.irig` is already saved, so no edit is lost;
	// leave the prior index untouched so nothing else is dropped either. The new `etag` rides
	// along: the write DID land, and a client still holding the old one would 409 against itself.
	if (outcome.atlasMissingFolders.includes(dir)) {
		return {
			ok: false,
			response: json(
				{
					ok: false,
					error: 'atlas-missing',
					saved: true,
					etag,
					message:
						`"${stem}" has no atlas and no source to rebuild it — re-sync an atlas first ` +
						`(⟳ source…), then save again. Your edit was saved to storage and will list once ` +
						`the atlas is restored.`,
				},
				{ status: 400 },
			),
		};
	}
	await writeSkeletonsIndex(spinesPrefix, outcome.index);
	return { ok: true, etag, backupId, count: outcome.index.skeletons.length };
}
