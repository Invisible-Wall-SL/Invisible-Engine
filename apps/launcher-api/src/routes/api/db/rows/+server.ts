import { error, json } from '@sveltejs/kit';
import { gateFull } from '$lib/server/ftpScope';
import { listTables, readTable } from '$lib/server/dbBrowser';
import type { RequestHandler } from './$types';

const MAX_LIMIT = 200;

function clampInt(raw: string | null, fallback: number, max: number): number {
	const n = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(n) || n < 0) return fallback;
	return Math.min(n, max);
}

/**
 * Admin-only: one page of rows from a public-schema table. The table name is
 * validated against the live catalogue before any query, and secret columns are
 * redacted by `readTable`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	await gateFull(locals, cookies);

	const table = url.searchParams.get('table') ?? '';
	const tables = await listTables();
	if (!tables.includes(table)) throw error(404, 'unknown table');

	const limit = clampInt(url.searchParams.get('limit'), 50, MAX_LIMIT) || 50;
	const offset = clampInt(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);

	return json(await readTable(table, limit, offset));
};

export const fallback: RequestHandler = () => {
	throw error(405, 'method not allowed');
};
