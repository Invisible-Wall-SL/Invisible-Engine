import { error, json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { addNode, readNodeList, removeNode, resolveNode, setNodeProd } from '$lib/server/nodeList';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/** Who the commit is attributed to. The launcher user — this is their change, not a bot's. */
function author(locals: App.Locals): { name: string; email: string } {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');
	return { name: user.name?.trim() || user.email, email: user.email };
}

/** The list, minus the internals. Any ComfyUI user may look at what is on the image. */
export const GET: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);
	const list = await readNodeList();
	return json(
		{
			configured: list.configured,
			nodes: list.nodes,
			skipRequirements: list.skipRequirements,
			error: list.error,
		},
		{ headers: NO_STORE },
	);
};

/**
 * `{ url }` alone RESOLVES (a dry run — what would be pinned), `{ url, commit: true }` writes.
 *
 * Two steps on purpose. The resolve step is what lets the panel show the commit's subject and
 * date before anything is written, so nobody pins a ref they have not looked at — and pinning
 * blind is exactly the drift the node SHAs exist to prevent.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAdmin(locals);
	const body = (await request.json().catch(() => ({}))) as {
		url?: unknown;
		note?: unknown;
		commit?: unknown;
	};
	const url = typeof body.url === 'string' ? body.url.trim() : '';
	if (!url) throw error(400, 'Missing url.');
	const note = typeof body.note === 'string' ? body.note : undefined;

	if (body.commit !== true) {
		const resolved = await resolveNode(url);
		return json(resolved, { status: resolved.error ? 400 : 200, headers: NO_STORE });
	}

	const result = await addNode(url, note, author(locals));
	return json(
		{ ...result, list: await readNodeList().then((l) => l.nodes) },
		{ status: result.ok ? 200 : 400, headers: NO_STORE },
	);
};

/** Remove one by name (`?name=`). Vendored entries are refused — they are files, not a row. */
export const DELETE: RequestHandler = async ({ locals, url }) => {
	await requireComfyAdmin(locals);
	const name = (url.searchParams.get('name') ?? '').trim();
	if (!name) throw error(400, 'Missing name.');

	const result = await removeNode(name, author(locals));
	return json(
		{ ...result, list: await readNodeList().then((l) => l.nodes) },
		{ status: result.ok ? 200 : 400, headers: NO_STORE },
	);
};

/**
 * PROMOTE or demote (`{ name, prod }`) — whether the node is also baked into the serverless
 * worker, the Atlas Maker's generation path.
 *
 * Its own verb rather than a field on add, because it is its own decision: the standing rule
 * is to promote only after a pod off the R&D image has rendered clean, and the commit this
 * writes rebuilds the PROD image by itself.
 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	await requireComfyAdmin(locals);
	const body = (await request.json().catch(() => ({}))) as { name?: unknown; prod?: unknown };
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, 'Missing name.');
	if (typeof body.prod !== 'boolean') throw error(400, 'Expected prod: true | false.');

	const result = await setNodeProd(name, body.prod, author(locals));
	return json(
		{ ...result, list: await readNodeList().then((l) => l.nodes) },
		{ status: result.ok ? 200 : 400, headers: NO_STORE },
	);
};
