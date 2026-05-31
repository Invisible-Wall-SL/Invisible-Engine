import { error, json } from '@sveltejs/kit';
import { assertAllowed, gate } from '$lib/server/ftpScope';
import { putObjectBytes } from '$lib/server/r2';
import type { RequestHandler } from './$types';

/** Per-request cap so a runaway upload can't exhaust memory (binary held in RAM). */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/** Reject anything but a bare filename (no path separators, no escapes). */
function safeName(name: string): string | null {
	const base = name.slice(name.lastIndexOf('/') + 1).trim();
	if (!base || base.includes('/') || base.includes('\\') || base.includes('..')) return null;
	return base;
}

/**
 * Multipart upload into the active project. `prefix` selects the destination
 * folder; each `file` lands at `prefix + basename`. Re-uploading the same name
 * overwrites (this doubles as "update"). Every destination key is validated
 * against the project's allowed prefixes before any write.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies);

	const form = await request.formData();
	const prefix = form.get('prefix');
	if (typeof prefix !== 'string' || !prefix) throw error(400, 'missing prefix');
	if (!prefix.endsWith('/')) throw error(400, 'prefix must end with /');
	assertAllowed(prefix, clientKey, projectKey);

	const files = form.getAll('file').filter((f): f is File => f instanceof File);
	if (files.length === 0) throw error(400, 'no files');

	let total = 0;
	for (const f of files) total += f.size;
	if (total > MAX_TOTAL_BYTES) throw error(413, 'upload too large');

	const uploaded: string[] = [];
	for (const file of files) {
		const name = safeName(file.name);
		if (!name) throw error(400, `invalid file name: ${file.name}`);
		const destKey = prefix + name;
		assertAllowed(destKey, clientKey, projectKey);
		const bytes = new Uint8Array(await file.arrayBuffer());
		await putObjectBytes(destKey, bytes, file.type || 'application/octet-stream');
		uploaded.push(destKey);
	}

	return json({ uploaded });
};
