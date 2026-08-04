import { error, json } from '@sveltejs/kit';
import type { FontCatalog } from 'engine-layout';
import { parseFontTarget, resolveFontTarget } from '$lib/server/fonts';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import {
	ConflictError,
	deleteObjects,
	getObjectTextWithEtag,
	precondition,
	putObjectText,
} from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

interface DeleteRequest {
	id?: unknown;
	target?: unknown;
}

function isSafeName(name: string): boolean {
	if (!name || name.length > 255) return false;
	if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
	return true;
}

/**
 * Delete a font from the target catalog: collect its files (bitmap: descriptor +
 * pages; web: each `files[].file`), `assertAllowed` every key, `deleteObjects` them,
 * drop the entry from `fonts.json`, and write the catalog back. `target`
 * (`project` default | `shared`) routes the bundle + catalog; a `shared` target
 * requires the `fontPublish` capability (enforced in `resolveFontTarget`) — the
 * shared prefix is readable by every Font Maker user, so `assertAllowed` alone is
 * NOT a sufficient gate for a shared delete. 404 when no entry has the given id.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'fontMaker',
		forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
		includeSharedFonts: true,
	});

	let body: DeleteRequest;
	try {
		body = (await request.json()) as DeleteRequest;
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const id = body.id;
	if (typeof id !== 'string' || !id) throw error(400, 'Expected an `id` string.');

	const role = locals.user!.role;
	const roleOverrides = await getRoleOverrides(role);
	const userOverrides = await getToolOverrides(locals.user!.id);
	const dest = resolveFontTarget(
		parseFontTarget(body.target),
		clientKey,
		projectKey,
		role,
		roleOverrides,
		userOverrides,
	);

	const existing = await getObjectTextWithEtag(dest.catalogKey);
	if (!existing) throw error(404, `No font catalog at this target.`);
	let catalog: FontCatalog;
	try {
		catalog = JSON.parse(existing.text) as FontCatalog;
	} catch {
		throw error(500, 'Font catalog is corrupt.');
	}
	const fonts = Array.isArray(catalog.fonts) ? catalog.fonts : [];

	const entry = fonts.find((f) => f.id === id);
	if (!entry) throw error(404, `No font with id "${id}".`);

	// `bundleFor` validates the folder segment (throws on escapes / bad chars).
	let bundle: string;
	try {
		bundle = dest.bundleFor(entry.folder);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid folder.');
	}

	const fileNames: string[] = [];
	if (entry.kind === 'bitmap') {
		if (entry.descriptorFile) fileNames.push(entry.descriptorFile);
		for (const page of entry.pageFiles ?? []) fileNames.push(page);
	} else {
		for (const f of entry.files ?? []) fileNames.push(f.file);
	}

	const keys: string[] = [];
	for (const name of fileNames) {
		if (!isSafeName(name)) throw error(400, `Invalid file name in entry: ${name}`);
		const key = `${bundle}/${name}`;
		assertAllowed(key, prefixes);
		keys.push(key);
	}

	await deleteObjects(keys);

	// Rewrite the catalog under `If-Match`, retrying on a lost CAS so a concurrent
	// save/delete of a DIFFERENT font can't be clobbered by dropping this entry
	// (Phase 0, docs/design/multi-user-concurrency.md). The blob deletion above is
	// idempotent and already done; only the catalog pointer needs the guard.
	let current = catalog;
	let etag = existing.etag;
	for (let attempt = 1; ; attempt++) {
		if (attempt > 1) {
			const reread = await getObjectTextWithEtag(dest.catalogKey);
			// Vanished under us (a concurrent delete removed the whole catalog): the
			// entry is already gone, so there is nothing left to rewrite.
			if (!reread) return json({ ok: true, removed: id });
			try {
				current = JSON.parse(reread.text) as FontCatalog;
			} catch {
				current = { prefix: dest.prefix, fonts: [] };
			}
			etag = reread.etag;
		}
		const remaining = (Array.isArray(current.fonts) ? current.fonts : []).filter(
			(f) => f.id !== id,
		);
		try {
			await putObjectText(
				dest.catalogKey,
				JSON.stringify({ ...current, fonts: remaining }),
				'application/json',
				// The catalog exists (404'd above otherwise) ⇒ ifMatch; unconditional only
				// in the impossible no-etag case, to avoid an ifNoneMatch create over it.
				precondition(etag ?? undefined),
			);
			return json({ ok: true, removed: id });
		} catch (e) {
			if (e instanceof ConflictError && attempt < CATALOG_MAX_ATTEMPTS) continue;
			if (e instanceof ConflictError) {
				return json(
					{ error: 'conflict', message: 'The font catalog changed while deleting — please retry.' },
					{ status: 409 },
				);
			}
			throw e;
		}
	}
};

/** Bounded CAS retries when two Font Maker users mutate the same catalog at once. */
const CATALOG_MAX_ATTEMPTS = 6;
