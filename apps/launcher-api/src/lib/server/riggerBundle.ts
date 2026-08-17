import { error } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';

/**
 * Resolve a Rigger request's `dir` (the base64url-encoded bundle folder every `/api/rigger/*`
 * endpoint already speaks) to its full R2 bundle prefix, with the same path guards those
 * endpoints hand-rolled. Extracted so a new endpoint cannot ship a weaker guard than the
 * existing ones — the decode and the `..` refusal live in ONE place.
 */
export function riggerBundlePrefix(clientKey: string, projectKey: string, dirB64: unknown): string {
	let dir = '';
	if (typeof dirB64 === 'string' && dirB64) {
		try {
			dir = Buffer.from(dirB64, 'base64url').toString('utf8');
		} catch {
			throw error(400, 'bad dir');
		}
	}
	if (dir.includes('..')) throw error(403, 'forbidden');
	const spinesPrefix = SUB.spines(clientKey, projectKey);
	return dir ? `${spinesPrefix}/${dir}` : spinesPrefix;
}

/** A bundle-relative `.atlas` filename from a request body — single segment, no escapes. */
export function riggerAtlasFile(value: unknown): string {
	const atlasFile = typeof value === 'string' ? value : '';
	if (!atlasFile || atlasFile.includes('..') || atlasFile.includes('/')) {
		throw error(400, 'missing or bad atlasFile');
	}
	return atlasFile;
}
