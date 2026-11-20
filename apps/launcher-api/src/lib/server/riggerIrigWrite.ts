import { createHash } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { RIG3D_SIDECAR } from '../rig3d';
import { conflictJson } from './conflict';
import { SUB } from './projectPaths';
import {
	ConflictError,
	deleteObject,
	getObjectTextWithEtag,
	headObject,
	precondition,
	putObjectText,
} from './r2';
import { backupIrigBeforeOverwrite, irigBackupsPrefix, pruneIrigBackups } from './riggerIrig';
import { reindexProjectSkeletons, writeSkeletonsIndex } from './rigReindex';

/**
 * Decode + path-guard the `{ dir, stem }` pair every `.irig` endpoint takes. `dir` is the
 * base64url bundle folder ('' = the rigs root); `stem` is a single file-name segment.
 */
export function irigTarget(
	clientKey: string,
	projectKey: string,
	dirB64: unknown,
	stemRaw: unknown,
): {
	dir: string;
	stem: string;
	key: string;
	rig3dKey: string;
	backupsPrefix: string;
	rigsPrefix: string;
} {
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
	const rigsPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${rigsPrefix}/${dir}` : rigsPrefix;
	return {
		dir,
		stem,
		key: `${bundlePrefix}/${stem}.irig`,
		rig3dKey: `${bundlePrefix}/${RIG3D_SIDECAR}`,
		backupsPrefix: irigBackupsPrefix(clientKey, projectKey, dir, stem),
		rigsPrefix,
	};
}

export type IrigTarget = ReturnType<typeof irigTarget>;

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

/**
 * The 409 for a `.irig` write that lost its race. The current tag rides along so "overwrite with
 * mine" can retry CONDITIONALLY on exactly the version the author was shown, rather than dropping
 * the precondition — an unconditional retry would silently eat any save landing between the prompt
 * and the click.
 */
export function irigConflict(
	target: IrigTarget,
	baseEtag: string | null | undefined,
	current: string | null,
): Response {
	return conflictJson(
		baseEtag === null
			? `"${target.stem}.irig" was created by someone else while you were editing. ` +
					'Your changes are still here — reload to see theirs first.'
			: `Someone else saved "${target.stem}.irig" while you were editing. ` +
					'Your changes are still here — reload to get their version first.',
		{ extra: { etag: current } },
	);
}

/**
 * The bundle's `rig3d.json` as an `.irig` write sees it (docs/design/rig-2p5d.md §3.1), and what
 * the write does to it. The two objects are written by one request: the sidecar first, under its
 * own precondition, then the `.irig`; when the `.irig` loses its race the sidecar is put back, so a
 * refused save leaves the stored pair as it was. A removal is checked first and done last.
 *
 * Every sidecar a write stores carries `irig`, the {@link pairMark} of the `.irig` text written
 * with it — so its own sidecar is rewritten with every `.irig` write that changes the text, and a
 * pair left torn (a save that died between its two writes, or is between them now) is told apart
 * from a whole one by reading the two, not guessed.
 */
export interface SidecarPlan {
	/** As read before the write (any content), or null when there is none. */
	read: { text: string; etag: string | null } | null;
	/** It belongs to this rig: its backup keeps it, and the write re-marks it. */
	ours: boolean;
	/** What to store: its new text, `null` to remove it, absent to keep its content as read. */
	next?: string | null;
}

/** The mark a sidecar carries of the `.irig` text it was written with. */
export const pairMark = (irigText: string): string =>
	createHash('sha256').update(irigText).digest('hex').slice(0, 32);

/** `sidecarText` marked as written with `irigText`, or itself when it is no JSON object. */
function marked(sidecarText: string, irigText: string): string {
	try {
		const doc: unknown = JSON.parse(sidecarText);
		if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return sidecarText;
		return JSON.stringify({ ...doc, irig: pairMark(irigText) });
	} catch {
		return sidecarText;
	}
}

/** The object at `key` holds exactly `text` (a write whose answer was lost may well have landed). */
async function holds(key: string, text: string): Promise<{ etag: string | null } | null> {
	const now = await getObjectTextWithEtag(key).catch(() => null);
	return now && now.text === text ? { etag: now.etag } : null;
}

/** The bundle's `rig3d.json` as it is now, for a writer that changes nothing of it. */
export async function readSidecar(target: IrigTarget): Promise<SidecarPlan['read']> {
	return getObjectTextWithEtag(target.rig3dKey);
}

/** Whose `rig3d.json` this is: its `rig`, or undefined when that cannot be read. */
export function sidecarOwner(text: string | undefined): string | undefined {
	if (text === undefined) return undefined;
	try {
		const doc: unknown = JSON.parse(text);
		const rig = typeof doc === 'object' && doc !== null ? (doc as { rig?: unknown }).rig : null;
		return typeof rig === 'string' ? rig : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Store the sidecar's new text under the ETag it was read at (its new ETag). For a removal
 * (`null`) only check that it is still as read: it is removed once the `.irig` has landed
 * (`removeSidecar`), because R2 has no conditional delete, and a delete put back after a lost race
 * could land over a sidecar someone else wrote meanwhile.
 */
async function putSidecar(
	target: IrigTarget,
	read: SidecarPlan['read'],
	next: string | null,
): Promise<string | null> {
	const base = read ? read.etag : null;
	if (next === null) {
		const head = await headObject(target.rig3dKey);
		if (head && head.etag !== base) throw new ConflictError(target.rig3dKey);
		return head ? head.etag : null;
	}
	try {
		return await putObjectText(target.rig3dKey, next, 'application/json', precondition(base));
	} catch (e) {
		const landed = await holds(target.rig3dKey, next);
		if (landed) return landed.etag;
		throw e;
	}
}

/** Remove the sidecar after its `.irig` landed — unless it was written since it was read. */
async function removeSidecar(target: IrigTarget, read: SidecarPlan['read']) {
	const head = await headObject(target.rig3dKey);
	if (!head) return null;
	if (head.etag !== (read ? read.etag : null)) return head.etag;
	await deleteObject(target.rig3dKey);
	return null;
}

/**
 * Put the sidecar back as it was read, after the `.irig` write it was paired with failed. Only
 * over the version this request wrote: if anyone has written it since — or R2 named no version to
 * check against — theirs stays, and a torn pair is refused by its mark rather than overwritten.
 */
async function undoSidecar(target: IrigTarget, read: SidecarPlan['read'], wrote: string | null) {
	if (wrote === null) return;
	try {
		if (read) {
			await putObjectText(target.rig3dKey, read.text, 'application/json', { ifMatch: wrote });
		} else {
			const head = await headObject(target.rig3dKey);
			if (head && head.etag === wrote) await deleteObject(target.rig3dKey);
		}
	} catch (e) {
		if (e instanceof ConflictError) return;
		console.error(`[rigger] could not put ${target.rig3dKey} back after a refused save:`, e);
	}
}

export type IrigWriteResult =
	| {
			ok: true;
			etag: string | null;
			backupId: string | null;
			count: number;
			/** The sidecar's ETag after the write; null when the rig has none. */
			rig3dEtag: string | null;
	  }
	| { ok: false; response: Response };

/**
 * Back up the current `.irig` (and the rig's `rig3d.json` with it), write `text` under the caller's
 * precondition, prune old backups, and re-derive `skeletons.json`. `baseEtag` follows
 * `precondition()`: a string = CAS update, `null` = create (`If-None-Match: *`), `undefined` = the
 * author's explicit force. `sidecar` is the rig's `rig3d.json` as the caller read it, and what to
 * do to it (`server/rigger3d.ts` decides); without it the sidecar is read here and only re-marked.
 */
export async function writeIrig(
	clientKey: string,
	projectKey: string,
	target: IrigTarget,
	text: string,
	baseEtag: string | null | undefined,
	sidecar?: SidecarPlan,
): Promise<IrigWriteResult> {
	const plan: SidecarPlan = sidecar ?? (await ownSidecar(target));
	// A doomed write touches nothing: no backup, no sidecar to put back.
	if (baseEtag !== undefined) {
		const head = await headObject(target.key);
		if ((head ? head.etag : null) !== baseEtag)
			return { ok: false, response: irigConflict(target, baseEtag, head ? head.etag : null) };
	}
	// What the sidecar becomes, marked with this `.irig`; unchanged text is not written again.
	const kept = plan.ours && plan.read ? plan.read.text : undefined;
	const wanted =
		plan.next === null
			? null
			: plan.next !== undefined
				? marked(plan.next, text)
				: kept !== undefined
					? marked(kept, text)
					: undefined;
	const next =
		wanted === null || (wanted !== undefined && wanted !== plan.read?.text) ? wanted : undefined;
	const backupId = await backupIrigBeforeOverwrite(
		target.key,
		target.backupsPrefix,
		baseEtag,
		kept,
	);
	let rig3dEtag = kept !== undefined && plan.read ? plan.read.etag : null;
	if (next !== undefined) {
		try {
			rig3dEtag = await putSidecar(target, plan.read, next);
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
			const [irig, side] = await Promise.all([headObject(target.key), headObject(target.rig3dKey)]);
			return {
				ok: false,
				response: conflictJson(
					`Someone else saved the 3D data of "${target.stem}" while you were editing. ` +
						'Your changes are still here — reload to get their version first.',
					{ extra: { etag: irig ? irig.etag : null, rig3dEtag: side ? side.etag : null } },
				),
			};
		}
	}
	let etag: string | null;
	try {
		etag = await putObjectText(target.key, text, 'application/json', precondition(baseEtag));
	} catch (e) {
		// Its answer may be what was lost: an SDK retry of a PUT that landed meets its own write.
		const landed = await holds(target.key, text);
		if (landed) etag = landed.etag;
		else {
			if (typeof next === 'string') await undoSidecar(target, plan.read, rig3dEtag);
			if (!(e instanceof ConflictError)) throw e;
			const current = await headObject(target.key);
			return {
				ok: false,
				response: irigConflict(target, baseEtag, current ? current.etag : null),
			};
		}
	}
	if (next === null) rig3dEtag = await removeSidecar(target, plan.read);
	await pruneIrigBackups(target.backupsPrefix).catch((e) =>
		console.warn('[rigger] irig backup prune failed (extra backups kept):', e),
	);

	const { rigsPrefix, dir, stem } = target;
	// Re-derive the index so the `.irig` is listed — preserving, so THIS save can never drop a
	// DIFFERENT atlas-less rig.
	const outcome = await reindexProjectSkeletons(clientKey, projectKey, rigsPrefix);

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
					rig3dEtag,
					message:
						`"${stem}" has no atlas and no source to rebuild it — re-sync an atlas first ` +
						`(⟳ source…), then save again. Your edit was saved to storage and will list once ` +
						`the atlas is restored.`,
				},
				{ status: 400 },
			),
		};
	}
	await writeSkeletonsIndex(rigsPrefix, outcome.index);
	return { ok: true, etag, backupId, count: outcome.index.skeletons.length, rig3dEtag };
}

/** The rig's sidecar for a writer that leaves it alone: read so the backup keeps a copy. */
async function ownSidecar(target: IrigTarget): Promise<SidecarPlan> {
	const read = await readSidecar(target);
	return { read, ours: read !== null && sidecarOwner(read.text) === target.stem };
}
