import { error } from '@sveltejs/kit';
import { getObjectBytes, getObjectText } from '$lib/server/r2';
import { SPINE_PREFIX, atlasPreferPng, requireSpineAccess } from '$lib/server/spine';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	await requireSpineAccess(locals);

	const dirB64 = url.searchParams.get('dir') ?? '';
	const name = url.searchParams.get('name') ?? '';
	const preferPng = url.searchParams.get('pp') === '1';
	if (!dirB64 || !name) throw error(400, 'missing dir/name');

	let folder: string;
	try {
		folder = Buffer.from(dirB64, 'base64url').toString('utf8');
	} catch {
		throw error(400, 'bad dir');
	}
	if (folder.includes('..') || name.includes('..') || name.includes('/')) {
		throw error(403, 'forbidden');
	}

	const key = `${SPINE_PREFIX}/${folder}/${name}`;

	if (name.toLowerCase().endsWith('.atlas')) {
		let text = await getObjectText(key);
		if (text === null) throw error(404, 'not found');
		if (preferPng) text = await atlasPreferPng(text, folder);
		return new Response(text, {
			headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
		});
	}

	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');
	return new Response(obj.body, {
		headers: { 'content-type': obj.contentType, 'cache-control': 'no-store' },
	});
};
