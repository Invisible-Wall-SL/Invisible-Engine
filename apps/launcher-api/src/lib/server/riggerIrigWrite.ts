import { createHash } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { RIG_SIDECARS, type SidecarKind } from '../rigSidecars';
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
	/** The folder's authoring sidecars (`rig3d.json`, `controls.json`), by kind. */
	sidecarKeys: Record<SidecarKind, string>;
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
		sidecarKeys: Object.fromEntries(
			RIG_SIDECARS.map((s) => [s.kind, `${bundlePrefix}/${s.file}`]),
		) as Record<SidecarKind, string>,
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
 * One of the bundle's authoring sidecars (`rig3d.json`, `controls.json` — `../rigSidecars.ts`) as an
 * `.irig` write sees it (docs/design/rig-2p5d.md §3.1, rig-controls.md §5.7), and what the write
 * does to it. The `.irig` and its sidecars are written by one request: the sidecars first, each
 * under its own precondition, then the `.irig`; when any of them loses its race, every sidecar this
 * write stored is put back, so a refused save leaves the stored rig as it was. A removal is checked
 * first and done last.
 *
 * Every sidecar a write stores carries `irig`, the {@link pairMark} of the `.irig` text written
 * with it — so its own sidecars are rewritten with every `.irig` write that changes the text, and
 * a rig left torn (a save that died between its writes, or is between them now) is told apart from
 * a whole one by reading them, not guessed.
 */
export interface SidecarPlan {
	/** As read before the write (any content), or null when there is none. */
	read: { text: string; etag: string | null } | null;
	/** It belongs to this rig: its backup keeps it, and the write re-marks it. */
	ours: boolean;
	/** What to store: its new text, `null` to remove it, absent to keep its content as read. */
	next?: string | null;
}

/** A plan per sidecar; one left out is read by the write and only re-marked when it is the rig's. */
export type SidecarPlans = Partial<Record<SidecarKind, SidecarPlan>>;

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

/** One of the bundle's sidecars as it is now, for a writer that changes nothing of it. */
export async function readSidecar(
	target: IrigTarget,
	kind: SidecarKind,
): Promise<SidecarPlan['read']> {
	return getObjectTextWithEtag(target.sidecarKeys[kind]);
}

/** Whose sidecar this is: its `rig`, or undefined when that cannot be read. */
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
	key: string,
	read: SidecarPlan['read'],
	next: string | null,
): Promise<string | null> {
	const base = read ? read.etag : null;
	if (next === null) {
		const head = await headObject(key);
		if (head && head.etag !== base) throw new ConflictError(key);
		return head ? head.etag : null;
	}
	try {
		return await putObjectText(key, next, 'application/json', precondition(base));
	} catch (e) {
		const landed = await holds(key, next);
		if (landed) return landed.etag;
		throw e;
	}
}

/** Remove the sidecar after its `.irig` landed — unless it was written since it was read. */
async function removeSidecar(key: string, read: SidecarPlan['read']) {
	const head = await headObject(key);
	if (!head) return null;
	if (head.etag !== (read ? read.etag : null)) return head.etag;
	await deleteObject(key);
	return null;
}

/**
 * Put the sidecar back as it was read, after a write it was paired with failed. Only over the
 * version this request wrote: if anyone has written it since — or R2 named no version to check
 * against — theirs stays, and a torn rig is refused by its mark rather than overwritten.
 */
async function undoSidecar(key: string, read: SidecarPlan['read'], wrote: string | null) {
	if (wrote === null) return;
	try {
		if (read) {
			await putObjectText(key, read.text, 'application/json', { ifMatch: wrote });
		} else {
			const head = await headObject(key);
			if (head && head.etag === wrote) await deleteObject(key);
		}
	} catch (e) {
		if (e instanceof ConflictError) return;
		console.error(`[rigger] could not put ${key} back after a refused save:`, e);
	}
}

/** Each sidecar's ETag after a write, as `<kind>Etag`; null when the rig has none. */
type SidecarEtags = { [K in SidecarKind as `${K}Etag`]: string | null };

export type IrigWriteResult =
	| ({ ok: true; etag: string | null; backupId: string | null; count: number } & SidecarEtags)
	| { ok: false; response: Response };

/** What a write does to one sidecar. */
interface SidecarStep {
	kind: SidecarKind;
	key: string;
	what: string;
	plan: SidecarPlan;
	/** Its content as read, when it is the rig's (the backup keeps it). */
	kept: string | undefined;
	/** What is written: new text, `null` = remove, undefined = nothing (unchanged). */
	next: string | null | undefined;
	/** Its ETag as this write leaves it. */
	etag: string | null;
}

const etagsOf = (steps: SidecarStep[], etag: (s: SidecarStep, i: number) => string | null) =>
	Object.fromEntries(steps.map((s, i) => [`${s.kind}Etag`, etag(s, i)])) as SidecarEtags;

/**
 * Back up the current `.irig` (and the rig's own sidecars with it), write `text` under the caller's
 * precondition, prune old backups, and re-derive `skeletons.json`. `baseEtag` follows
 * `precondition()`: a string = CAS update, `null` = create (`If-None-Match: *`), `undefined` = the
 * author's explicit force. `sidecars` are the rig's sidecars as the caller read them, and what to do
 * to each (`server/rigger3d.ts` decides); one left out is read here and only re-marked.
 */
export async function writeIrig(
	clientKey: string,
	projectKey: string,
	target: IrigTarget,
	text: string,
	baseEtag: string | null | undefined,
	sidecars: SidecarPlans = {},
): Promise<IrigWriteResult> {
	const steps: SidecarStep[] = [];
	for (const { kind, what } of RIG_SIDECARS) {
		const plan = sidecars[kind] ?? (await ownSidecar(target, kind));
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
		const etag = kept !== undefined && plan.read ? plan.read.etag : null;
		steps.push({ kind, key: target.sidecarKeys[kind], what, plan, kept, next, etag });
	}
	// A doomed write touches nothing: no backup, no sidecar to put back.
	if (baseEtag !== undefined) {
		const head = await headObject(target.key);
		if ((head ? head.etag : null) !== baseEtag)
			return { ok: false, response: irigConflict(target, baseEtag, head ? head.etag : null) };
	}
	const backupId = await backupIrigBeforeOverwrite(
		target.key,
		target.backupsPrefix,
		baseEtag,
		Object.fromEntries(steps.flatMap((s) => (s.kept === undefined ? [] : [[s.kind, s.kept]]))),
	);
	// Every sidecar this write stored, to put back if a later write of the request loses its race.
	const wrote: SidecarStep[] = [];
	const undo = async () => {
		for (const s of wrote) await undoSidecar(s.key, s.plan.read, s.etag);
	};
	for (const step of steps) {
		if (step.next === undefined) continue;
		try {
			step.etag = await putSidecar(step.key, step.plan.read, step.next);
			if (typeof step.next === 'string') wrote.push(step);
		} catch (e) {
			await undo();
			if (!(e instanceof ConflictError)) throw e;
			const [irig, ...heads] = await Promise.all([
				headObject(target.key),
				...steps.map((s) => headObject(s.key)),
			]);
			return {
				ok: false,
				response: conflictJson(
					`Someone else saved the ${step.what} of "${target.stem}" while you were editing. ` +
						'Your changes are still here — reload to get their version first.',
					{
						extra: {
							etag: irig ? irig.etag : null,
							...etagsOf(steps, (_s, i) => heads[i]?.etag ?? null),
						},
					},
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
			await undo();
			if (!(e instanceof ConflictError)) throw e;
			const current = await headObject(target.key);
			return {
				ok: false,
				response: irigConflict(target, baseEtag, current ? current.etag : null),
			};
		}
	}
	for (const step of steps)
		if (step.next === null) step.etag = await removeSidecar(step.key, step.plan.read);
	await pruneIrigBackups(target.backupsPrefix).catch((e) =>
		console.warn('[rigger] irig backup prune failed (extra backups kept):', e),
	);
	const etags = etagsOf(steps, (s) => s.etag);

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
					...etags,
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
	return { ok: true, etag, backupId, count: outcome.index.skeletons.length, ...etags };
}

/** The rig's sidecar for a writer that leaves it alone: read so the backup keeps a copy. */
async function ownSidecar(target: IrigTarget, kind: SidecarKind): Promise<SidecarPlan> {
	const read = await readSidecar(target, kind);
	return { read, ours: read !== null && sidecarOwner(read.text) === target.stem };
}
