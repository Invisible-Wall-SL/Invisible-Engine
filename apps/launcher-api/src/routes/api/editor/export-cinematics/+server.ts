import { handleExport } from '$lib/server/exportRoute';
import type { RequestHandler } from './$types';

/**
 * Legacy alias of `/api/editor/export/cinematics`: the bake in a game repo's older engine submodule
 * still POSTs here.
 */
export const POST: RequestHandler = ({ url }) => handleExport('cinematics', url);
