import { toCatalogueView, type CatalogueView } from '$lib/blueprintCatalogue';
import { ENV } from './env';
import { toolHandoff } from './toolLaunch';
import { sessionProjectScope } from './toolScope';

export class CatalogueError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * Every image pipeline and its card, read from atlas-tool as the signed-in person
 * (`GET /blueprints?kind=image&all=1`, an `api` token in the header). Cards are shared across
 * projects; the session's project only satisfies the token's scope. Read-only: the cards are
 * edited in the Atlas Maker's own card editor, which owns the compare-and-swap and the review.
 */
export async function readCatalogue(
	user: NonNullable<App.Locals['user']>,
	sessionToken: string | undefined,
): Promise<CatalogueView> {
	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (!base) throw new CatalogueError(503, 'The Atlas Maker is not configured (ATLAS_TOOL_URL).');
	const { clientKey, projectKey } = await sessionProjectScope(user, sessionToken);
	const { params, headers } = await toolHandoff({
		tool: 'atlas',
		user,
		clientKey,
		projectKey,
		via: 'header',
		withPublish: false,
	});
	params.set('kind', 'image');
	params.set('all', '1');
	let res: Response;
	try {
		res = await fetch(`${base}/blueprints?${params.toString()}`, {
			headers: { ...headers, accept: 'application/json' },
			redirect: 'manual',
			signal: AbortSignal.timeout(20_000),
		});
	} catch (e) {
		throw new CatalogueError(503, `Could not reach the Atlas Maker: ${(e as Error).message}`);
	}
	const body: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const why =
			typeof body === 'object' && body !== null && 'error' in body
				? String((body as { error: unknown }).error)
				: `HTTP ${res.status}`;
		throw new CatalogueError(res.status === 503 ? 503 : 502, `The Atlas Maker answered: ${why}`);
	}
	return toCatalogueView(body);
}
