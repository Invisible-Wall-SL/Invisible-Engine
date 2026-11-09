import {
	importSpine42Json,
	isIrigDocument,
	skeletonDataSnapshot,
	writeIrig as writeIrigText,
	type IrigIssue,
} from 'engine-rig';
import { getObjectTextWithEtag, listAllKeys } from './r2';
import { irigTarget, writeIrig } from './riggerIrigWrite';

/**
 * Phase 5 of docs/design/irig-format.md: upgrade the `.irig` files on R2 that no save has imported
 * yet. A rig is written only when its import drops nothing but keys the 4.2 reader ignores AND
 * the runtime builds the same `SkeletonData` from the irig document as from the 4.2 file; anything
 * else is reported and left as it is.
 */
export type IrigVerdict =
	| { kind: 'already' }
	| { kind: 'upgrade'; text: string; dropped: string[] }
	| { kind: 'changes-a-value'; issues: IrigIssue[] }
	| { kind: 'poses-differ'; why: string }
	| { kind: 'unreadable'; why: string };

export function irigMigrationVerdict(text: string): IrigVerdict {
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		return { kind: 'unreadable', why: 'not JSON' };
	}
	if (isIrigDocument(doc)) return { kind: 'already' };
	if (!doc || typeof doc !== 'object' || Array.isArray(doc))
		return { kind: 'unreadable', why: 'not a JSON object' };
	let before: string;
	try {
		before = skeletonDataSnapshot(doc);
	} catch (e) {
		return { kind: 'unreadable', why: `the 4.2 reader refuses it: ${(e as Error).message}` };
	}
	let imported: ReturnType<typeof importSpine42Json>;
	try {
		imported = importSpine42Json(doc);
	} catch (e) {
		return { kind: 'unreadable', why: (e as Error).message };
	}
	const changing = imported.issues.filter((i) => i.reason !== 'not an irig field');
	if (changing.length) return { kind: 'changes-a-value', issues: changing };
	const out = writeIrigText(imported.doc);
	let after: string;
	try {
		after = skeletonDataSnapshot(out);
	} catch (e) {
		return { kind: 'poses-differ', why: `the irig reader refuses it: ${(e as Error).message}` };
	}
	if (after !== before) return { kind: 'poses-differ', why: 'the runtime builds a different rig' };
	return { kind: 'upgrade', text: out, dropped: imported.issues.map((i) => i.path) };
}

export interface IrigMigrationRow {
	key: string;
	verdict: IrigVerdict['kind'];
	detail?: string;
	/** With `write`: what happened to an `upgrade`. */
	outcome?: 'written' | 'saved-meanwhile' | 'not-a-project-rig' | 'written-not-indexed';
}

/** `<client>/<project>/spines/<dir…>/<stem>.irig` → the pieces a save takes; null elsewhere. */
function rigAt(
	key: string,
): { client: string; project: string; dirB64: string; stem: string } | null {
	const m = /^([^/]+)\/([^/]+)\/spines\/(?:(.+)\/)?([^/]+)\.irig$/.exec(key);
	if (!m) return null;
	return {
		client: m[1],
		project: m[2],
		dirB64: m[3] ? Buffer.from(m[3], 'utf8').toString('base64url') : '',
		stem: m[4],
	};
}

const describe = (v: IrigVerdict): string | undefined => {
	switch (v.kind) {
		case 'upgrade':
			return v.dropped.length
				? `drops ${v.dropped.length}: ${v.dropped.slice(0, 5).join(', ')}`
				: undefined;
		case 'changes-a-value':
			return v.issues
				.slice(0, 5)
				.map((i) => `${i.path}: ${i.reason}`)
				.join('; ');
		case 'poses-differ':
		case 'unreadable':
			return v.why;
		default:
			return undefined;
	}
};

/**
 * Every `.irig` under `prefix`, with its verdict. With `write`, each `upgrade` goes through the
 * Rigger save's own write (`writeIrig`): backed up first, written only if the file is still the one
 * read (a save landing meanwhile wins), backups pruned, the project's index re-derived.
 */
export async function migrateIrigs(opts: {
	prefix?: string;
	write?: boolean;
}): Promise<IrigMigrationRow[]> {
	const keys = (await listAllKeys(opts.prefix ?? '')).filter((k) => k.endsWith('.irig')).sort();
	const rows: IrigMigrationRow[] = [];
	for (const key of keys) {
		const got = await getObjectTextWithEtag(key);
		if (!got) continue;
		const verdict = irigMigrationVerdict(got.text);
		const row: IrigMigrationRow = { key, verdict: verdict.kind, detail: describe(verdict) };
		rows.push(row);
		if (!opts.write || verdict.kind !== 'upgrade') continue;
		const at = rigAt(key);
		if (!at || got.etag === null) {
			row.outcome = 'not-a-project-rig';
			continue;
		}
		const target = irigTarget(at.client, at.project, at.dirB64, at.stem);
		if (target.key !== key) {
			row.outcome = 'not-a-project-rig';
			continue;
		}
		const res = await writeIrig(at.client, at.project, target, verdict.text, got.etag);
		if (res.ok) row.outcome = 'written';
		else row.outcome = res.response.status === 409 ? 'saved-meanwhile' : 'written-not-indexed';
	}
	return rows;
}
