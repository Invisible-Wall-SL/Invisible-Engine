import QRCode from 'qrcode';
import {
	CAPTURE_SESSION_TTL_SECONDS,
	captureLinks,
	isCapturableGameUrl,
	type CaptureLink,
} from '$lib/profiler';
import { listGamesOwnedByProject } from '../games';
import { captureSigningKey, mintCaptureToken, newCaptureSessionId } from './captureToken';

export interface CaptureGame {
	key: string;
	name: string;
	links: (CaptureLink & { qr: string })[];
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
	now?: number;
}): Promise<CaptureSession> {
	const now = input.now ?? Date.now();
	const sid = newCaptureSessionId();
	const key = captureSigningKey();
	const games = await Promise.all(
		(await listGamesOwnedByProject(input.projectKey))
			.filter((g) => isCapturableGameUrl(g.url))
			.map(async (g) => ({
				key: g.key,
				name: g.name,
				links: await Promise.all(
					captureLinks(
						g.url,
						// One token per game: the reading then names the game it was taken on.
						mintCaptureToken(
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
						),
					).map(async (link) => ({
						...link,
						qr: await QRCode.toString(link.url, {
							type: 'svg',
							margin: 1,
							errorCorrectionLevel: 'L',
						}),
					})),
				),
			})),
	);
	const exp = Math.floor(now / 1000) + CAPTURE_SESSION_TTL_SECONDS;
	return { sid, expiresAt: new Date(exp * 1000).toISOString(), games };
}
