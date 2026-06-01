import { error } from '@sveltejs/kit';
import { getObjectBytes } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const LAUNCHER_KEY = 'tools/invisible-launcher/Invisible_Launcher.exe';
const LAUNCHER_FILENAME = 'Invisible_Launcher.exe';

// Unauthenticated: the desktop launcher binary isn't sensitive and the launcher has no portal session.
export const GET: RequestHandler = async () => {
	const obj = await getObjectBytes(LAUNCHER_KEY);
	if (!obj) throw error(404, 'Launcher build not available yet');

	return new Response(obj.body, {
		headers: {
			'content-type': 'application/vnd.microsoft.portable-executable',
			'content-disposition': `attachment; filename="${LAUNCHER_FILENAME}"`,
		},
	});
};
