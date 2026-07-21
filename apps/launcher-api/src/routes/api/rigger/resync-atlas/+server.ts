import { error, json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { getObjectText } from '$lib/server/r2';
import { ensureBundleAtlasFresh } from '$lib/server/spineBundleSync';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Re-sync a rig's atlas: re-pull the latest packed page image AND re-synthesise the
 * `.atlas` from the SOURCE atlas (manifest) into the rig's self-contained bundle,
 * leaving its `.irig` (bones + animations + attachments) untouched. This is what
 * fixes "the rig still shows the OLD colour after I recoloured the source atlas" —
 * the bundle holds a COPY of the page snapshotted at creation, never auto-updated.
 *
 * The source atlas is REMEMBERED in `<bundle>/source.json` (written by `new`), so a
 * re-sync is one click. For rigs created before that sidecar existed, the client
 * passes `manifestKey` (picked once); this re-sync then writes the sidecar so it is
 * one click thereafter. `rigger`-gated; path-guarded; does NOT reindex skeletons.json
 * (the skeleton list + atlas filename are unchanged).
 *
 * Body: `{ dir: <base64url bundle dir, '' = spines root>, atlasFile: <.atlas name in
 *          the bundle>, manifestKey?: <override / picked source> }`.
 *
 * Returns `{ ok:false, needsAtlas:true }` (HTTP 200) when no source is known yet, so
 * the client can prompt for one.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	const dirB64 = typeof body.dir === 'string' ? body.dir : '';
	const atlasFile = typeof body.atlasFile === 'string' ? body.atlasFile : '';
	if (!atlasFile || atlasFile.includes('..') || atlasFile.includes('/')) {
		throw error(400, 'missing or bad atlasFile');
	}

	let dir = '';
	if (dirB64) {
		try {
			dir = Buffer.from(dirB64, 'base64url').toString('utf8');
		} catch {
			throw error(400, 'bad dir');
		}
	}
	if (dir.includes('..')) throw error(403, 'forbidden');

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${spinesPrefix}/${dir}` : spinesPrefix;

	// Resolve the source manifest: body override (the re-pick picker), else the remembered
	// sidecar — used only to decide the `needsAtlas` prompt. The actual source resolution +
	// the sidecar (re)write happen inside `ensureBundleAtlasFresh`, which writes it ONLY on a
	// successful sync (no revision-less window on a bail).
	let sidecarKey = '';
	const sidecar = await getObjectText(`${bundlePrefix}/source.json`);
	if (sidecar) {
		try {
			const parsed = JSON.parse(sidecar) as { manifestKey?: unknown };
			if (typeof parsed.manifestKey === 'string') sidecarKey = parsed.manifestKey;
		} catch {
			/* corrupt sidecar → fall through to the picker */
		}
	}
	const manifestKey = typeof body.manifestKey === 'string' ? body.manifestKey : sidecarKey;
	// No source known (e.g. an upload-image rig, or a rig from before the sidecar) →
	// tell the client to show the atlas picker. Not a 4xx: this is an expected path.
	if (!manifestKey) return json({ ok: false, needsAtlas: true });

	// `force` because this is the explicit user action: always re-pull, even when the revision
	// matches. The shared helper re-synthesises the bundle `.atlas` + page from the live
	// manifest and stamps a fresh revision into `source.json` (one writer, shared with `new`
	// + the self-healing read/bake paths).
	const res = await ensureBundleAtlasFresh(clientKey, projectKey, bundlePrefix, atlasFile, {
		force: true,
		manifestKey,
	});
	if (!res) {
		throw error(400, "that atlas has no regions, or its page image couldn't be resolved");
	}

	return json({ ok: true, regions: res.regions });
};
