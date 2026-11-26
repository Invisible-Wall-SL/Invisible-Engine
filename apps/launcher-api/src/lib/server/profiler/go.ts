import { captureGoTarget, isCapturableGameUrl } from '$lib/profiler';
import { captureSigningKey, verifyCaptureToken } from './captureToken';

/**
 * A capture GO link (`/profiler/go/<link id>/<token>`, `captureGoUrl`) → the capture link it
 * stands for: the token's game's published URL with `perf=1`, `perfsession=<token>` and the
 * link's switch. The token is the only authority, exactly as on the capture link itself, so a
 * phone that is not signed in to the launcher follows it.
 */
export type CaptureGoResult =
	{ ok: true; url: string } | { ok: false; status: number; why: string };

export interface CaptureGoDeps {
	key?: string;
	now?: number;
	gameOf(key: string): Promise<{ projectKey: string | null; url: string } | undefined>;
}

export async function resolveCaptureGo(
	linkId: string,
	token: string,
	deps: CaptureGoDeps,
): Promise<CaptureGoResult> {
	const claims = verifyCaptureToken(deps.key ?? captureSigningKey(), token, deps.now);
	if (!claims) {
		return {
			ok: false,
			status: 410,
			why: 'This capture link has expired (they last 24 hours) or was changed. Open a new capture in Invisible Profiler.',
		};
	}
	if (!claims.game) {
		return {
			ok: false,
			status: 410,
			why: 'This capture session names no game. Open a new capture in Invisible Profiler.',
		};
	}
	const game = await deps.gameOf(claims.game);
	if (!game || game.projectKey !== claims.project || !isCapturableGameUrl(game.url)) {
		return {
			ok: false,
			status: 404,
			why: 'The game this capture link was made for is no longer published.',
		};
	}
	const url = captureGoTarget(game.url, linkId, token);
	return url
		? { ok: true, url }
		: { ok: false, status: 404, why: 'This is not a capture link Invisible Profiler made.' };
}

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function captureGoRefusalPage(why: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Capture link</title>
<style>
body { margin: 0; padding: 32px 16px; font: 16px/1.5 system-ui, sans-serif; background: #111318; color: #e8eaf0; }
main { max-width: 32rem; margin: 0 auto; }
</style>
</head>
<body><main><h1>Invisible Profiler</h1><p>${escapeHtml(why)}</p></main></body>
</html>`;
}
