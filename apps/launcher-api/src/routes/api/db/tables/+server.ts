import { error, json } from '@sveltejs/kit';
import { gateFull } from '$lib/server/ftpScope';
import { listTables } from '$lib/server/dbBrowser';
import type { RequestHandler } from './$types';

/** Admin-only: the browsable Postgres tables (Railway tab of the FTP browser). */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	await gateFull(locals, cookies);
	return json({ tables: await listTables() });
};

export const fallback: RequestHandler = () => {
	throw error(405, 'method not allowed');
};
