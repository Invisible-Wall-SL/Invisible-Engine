/**
 * Client-side ART SLICES — the per-region 9-slice insets (`<assetKey>::<region>` →
 * `{left,top,right,bottom}`), one module-scoped store like `editorArtBounds.client.svelte.ts`: the
 * canvas draws sliced nodes with it and the Properties panel edits it. A `.svelte.ts` module because
 * `version` is a rune.
 *
 * Never a shipped file: `editorArtExport` writes each slice into the TexturePacker JSON as the
 * frame's `borders`.
 */

import { editorProjectKey, withEditorProject } from './editorProject.client';
import type { SliceInsets } from 'engine-layout';

let map: Record<string, SliceInsets> = {};
let etag: string | null = null;
let pending: Promise<void> | null = null;
let loadedFor: string | null = null;

/** Bumped on every change; a draw effect reads it to repaint on an inset edit. */
let version = $state(0);

export function artSlicesVersion(): number {
	return version;
}

export function artSliceRef(assetKey: string, region: string): string {
	return `${assetKey}::${region}`;
}

/** A region's insets, or `undefined` — a sliced node then stretches the art whole. */
export function artSliceOf(assetKey: string, region: string): SliceInsets | undefined {
	return map[artSliceRef(assetKey, region)];
}

/** Fetch the project's insets once per page load; a failed read leaves the map empty. */
export function loadArtSlices(): Promise<void> {
	if (loadedFor !== editorProjectKey()) {
		map = {};
		etag = null;
		version++;
		clearArtSlicesCache();
	}
	if (pending) return pending;
	const project = editorProjectKey();
	loadedFor = project;
	pending = (async () => {
		try {
			const res = await fetch(withEditorProject('/api/editor/art-slices'));
			if (!res.ok) return;
			const body = (await res.json()) as { slices?: Record<string, SliceInsets>; etag?: string };
			if (loadedFor !== project) return;
			map = body.slices ?? {};
			etag = body.etag ?? null;
			version++;
		} catch {
			/* offline / forbidden ⇒ no insets */
		}
	})();
	return pending;
}

/** Drop the cache so the next `loadArtSlices` re-reads (paired with "Reload art"). */
export function clearArtSlicesCache(): void {
	pending = null;
	loadedFor = null;
}

/**
 * Set (or, with `undefined`, clear) one region's insets and persist the WHOLE map under the ETag
 * the load returned. Returns an error message, or `null` on success. Same 409 handling as
 * `saveArtBounds`: a conflict reloads the other author's map, a scope mismatch rolls back.
 */
export async function saveArtSlice(
	assetKey: string,
	region: string,
	insets: SliceInsets | undefined,
): Promise<string | null> {
	const ref = artSliceRef(assetKey, region);
	const previous = map;
	const next = { ...map };
	if (insets) next[ref] = insets;
	else delete next[ref];
	map = next;
	version++;
	try {
		const res = await fetch('/api/editor/art-slices', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ slices: next, baseEtag: etag, projectKey: editorProjectKey() }),
		});
		const body = (await res.json().catch(() => ({}))) as {
			ok?: boolean;
			etag?: string;
			message?: string;
			slices?: Record<string, SliceInsets>;
			error?: string;
		};
		if (res.status === 409 && body.error === 'scope-mismatch') {
			map = previous;
			version++;
			return body.message ?? 'This tab’s project changed — reload the page.';
		}
		if (res.status === 409) {
			clearArtSlicesCache();
			await loadArtSlices();
			return (
				body.message ?? 'Someone else changed this project’s 9-slice insets — reloaded theirs.'
			);
		}
		if (!res.ok || body.ok === false) return body.message ?? 'Could not save the 9-slice insets.';
		etag = body.etag ?? null;
		if (body.slices) {
			map = body.slices;
			version++;
		}
		return null;
	} catch {
		return 'Could not reach the server to save the 9-slice insets.';
	}
}
