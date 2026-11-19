import { createHash } from 'node:crypto';
import { ENV } from '../env';
import { getGame, isOnlineRuntimeGameUrl } from '../games';
import { clientKeyOf } from '../projectLookup';
import { projectExists } from '../projects';
import { hasOwnBuiltBundle } from '../publishGame';
import {
	captureSigningKey,
	LAB_OPENER,
	mintCaptureToken,
	newCaptureSessionId,
} from './captureToken';

/**
 * A lab run's capture session (`docs/design/invisible-profiler.md` §6): CI opens one per game with
 * `PIPELINE_CI_TOKEN` (`POST /api/pipeline/profiler-lab`), plays the game headless and posts the
 * reading with the token, which `reportOrigin` keeps as `source: lab`. Short-lived, as a run takes
 * minutes; rotating or unsetting `PIPELINE_CI_TOKEN` on the launcher ends every open one.
 */
export const LAB_SESSION_TTL_SECONDS = 2 * 60 * 60;

/**
 * Which `PIPELINE_CI_TOKEN` opened a lab session: a short digest carried in the token (never the
 * token), so rotating the CI token ends every lab session it opened, not only unsetting it.
 */
export const ciFingerprint = (ciToken: string): string =>
	createHash('sha256').update(`iw-profiler-lab:${ciToken}`).digest('hex').slice(0, 16);

export interface LabSession {
	sid: string;
	token: string;
	expiresAt: string;
	game: { key: string; name: string; projectKey: string; url: string };
}

export type LabSessionResult = { ok: true; session: LabSession } | { ok: false; error: string };

export async function openLabSession(
	gameKey: string,
	label: string | null,
	now: number = Date.now(),
): Promise<LabSessionResult> {
	const game = await getGame(gameKey);
	if (!game?.projectKey) return { ok: false, error: `No project game "${gameKey}".` };
	if (!(await projectExists(game.projectKey))) {
		return { ok: false, error: `The project of "${gameKey}" has been deleted.` };
	}
	// The answer carries the card URL, read token and all: only for what the lab plays — an
	// online runtime game, not a desktop build serving its own bundle.
	if (!isOnlineRuntimeGameUrl(game.url) || (await hasOwnBuiltBundle(game.key))) {
		return { ok: false, error: `"${gameKey}" is not an online runtime game.` };
	}
	const sid = newCaptureSessionId();
	const token = mintCaptureToken(
		captureSigningKey(),
		{
			sid,
			client: await clientKeyOf(game.projectKey),
			project: game.projectKey,
			game: game.key,
			uid: LAB_OPENER,
			label,
			lab: ciFingerprint(ENV.PIPELINE_CI_TOKEN),
		},
		now,
		LAB_SESSION_TTL_SECONDS,
	);
	const exp = Math.floor(now / 1000) + LAB_SESSION_TTL_SECONDS;
	return {
		ok: true,
		session: {
			sid,
			token,
			expiresAt: new Date(exp * 1000).toISOString(),
			game: { key: game.key, name: game.name, projectKey: game.projectKey, url: game.url },
		},
	};
}
