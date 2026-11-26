import QRCode from 'qrcode';
import {
	CAPTURE_SESSION_TTL_SECONDS,
	captureGoUrl,
	captureLinks,
	isCapturableGameUrl,
	type CaptureLink,
} from '$lib/profiler';
import { listGamesOwnedByProject } from '../games';
import { captureSigningKey, mintCaptureToken, newCaptureSessionId } from './captureToken';

export interface CaptureGame {
	key: string;
	name: string;
	/** `go`: the link as a launcher redirect with no `?` or `&` (`captureGoUrl`). */
	links: (CaptureLink & { go: string; qr: string })[];
}

export interface CaptureSession {
	sid: string;
	expiresAt: string;
	games: CaptureGame[];
}

/**
 * A New capture: one session for the project, and for each of the project's own published games
 * its own token (naming the game) and capture links (`captureLinks`), with a QR code of each as
 * inline SVG. A project with no game yet gets a session with no links — the page says to publish
 * first.
 */
export async function openCaptureSession(input: {
	clientKey: string;
	projectKey: string;
	uid: string;
	label: string | null;
	/** The launcher's own origin: what a GO link starts with. */
	origin: string;
	now?: number;
}): Promise<CaptureSession> {
	const now = input.now ?? Date.now();
	const sid = newCaptureSessionId();
	const key = captureSigningKey();
	const games = await Promise.all(
		(await listGamesOwnedByProject(input.projectKey))
			.filter((g) => isCapturableGameUrl(g.url))
			.map(async (g) => {
				// One token per game: the reading then names the game it was taken on.
				const token = mintCaptureToken(
					key,
					{
						sid,
						client: input.clientKey,
						project: input.projectKey,
						game: g.key,
						uid: input.uid,
						label: input.label,
					},
					now,
				);
				return {
					key: g.key,
					name: g.name,
					links: await Promise.all(
						captureLinks(g.url, token).map(async (link) => ({
							...link,
							go: captureGoUrl(input.origin, link.id, token),
							qr: await QRCode.toString(link.url, {
								type: 'svg',
								margin: 1,
								errorCorrectionLevel: 'L',
							}),
						})),
					),
				};
			}),
	);
	const exp = Math.floor(now / 1000) + CAPTURE_SESSION_TTL_SECONDS;
	return { sid, expiresAt: new Date(exp * 1000).toISOString(), games };
}
