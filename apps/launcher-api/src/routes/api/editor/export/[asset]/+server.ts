import { handleExport } from '$lib/server/exportRoute';
import type { RequestHandler } from './$types';

/** `POST /api/editor/export/<asset>`: one deploy exporter, by its id in `exporters.ts`. */
export const POST: RequestHandler = ({ params, url }) => handleExport(params.asset, url);
