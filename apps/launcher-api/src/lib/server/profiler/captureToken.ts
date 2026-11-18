import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { CAPTURE_SESSION_TTL_SECONDS } from '$lib/profiler';
import { ENV } from '../env';

/**
 * An Invisible Profiler capture session's token: what lets a phone that is not signed in to the
 * launcher send `?perf=1` readings for ONE project, for 24 hours (`docs/design/invisible-profiler.md`
 * §1). It rides the game URL as `&perfsession=<token>` and comes back in the
 * `X-IW-Perf-Session` header of `POST /api/profiler/reports` and `/uploads`.
 *
 * The tool-launch token's format (`toolLaunch.ts`, `toolRelay.ts`), with its own audience so no
 * other launcher token verifies as one:
 *
 *   `v1.<base64url(JSON {v:1, typ:"perf", aud:"profiler", sid, client, project, game, uid, label, iat, exp})>.<base64url(HMAC-SHA256)>`
 *
 * One token per game of the session (`game` = its card key), so a reading names the game it was taken
 * on and joins only that game's builds. A token minted before `game` existed verifies with `null`.
 *
 * Only the launcher mints and verifies it, so its key is the launcher's own:
 * `PROFILER_SIGNING_SECRET` when set, else a key derived from `R2_SECRET_ACCESS_KEY` under a label
 * of its own (an HMAC, so the R2 key itself is never what signs). Rotating either ends every open
 * session, which a 24-hour token can afford.
 */
export const PERF_SESSION_HEADER = 'X-IW-Perf-Session';

const CLOCK_SKEW = 60;

export interface CaptureClaims {
	/** The capture session — a fresh id per New capture. */
	sid: string;
	client: string;
	project: string;
	/** The game card the link opens — what the reading was taken on; null on a pre-P2 token. */
	game: string | null;
	/** Who opened the session (`users.id`). */
	uid: string;
	/** The device label typed at New capture, if any. */
	label: string | null;
}

export function captureSigningKey(): string {
	const own = ENV.PROFILER_SIGNING_SECRET;
	if (own) return own;
	return createHmac('sha256', ENV.R2_SECRET_ACCESS_KEY)
		.update('iw-profiler-capture-v1')
		.digest('base64url');
}

const sign = (secret: string, input: string) =>
	createHmac('sha256', secret).update(input).digest('base64url');

export function newCaptureSessionId(): string {
	return randomUUID();
}

export function mintCaptureToken(
	secret: string,
	claims: CaptureClaims,
	now: number = Date.now(),
): string {
	const iat = Math.floor(now / 1000);
	const payload = {
		v: 1,
		typ: 'perf',
		aud: 'profiler',
		sid: claims.sid,
		client: claims.client,
		project: claims.project,
		game: claims.game,
		uid: claims.uid,
		label: claims.label,
		iat,
		exp: iat + CAPTURE_SESSION_TTL_SECONDS,
	};
	const input = `v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
	return `${input}.${sign(secret, input)}`;
}

function sameText(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** The claims of a genuine, unexpired capture token; null for anything else. Never throws. */
export function verifyCaptureToken(
	secret: string,
	token: string | null | undefined,
	now: number = Date.now(),
): (CaptureClaims & { exp: number }) | null {
	if (!secret) return null;
	const parts = token?.trim().split('.') ?? [];
	if (parts.length !== 3 || parts[0] !== 'v1') return null;
	if (!sameText(sign(secret, `v1.${parts[1]}`), parts[2])) return null;
	let p: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
		if (!parsed || typeof parsed !== 'object') return null;
		p = parsed as Record<string, unknown>;
	} catch {
		return null;
	}
	if (p.v !== 1 || p.typ !== 'perf' || p.aud !== 'profiler') return null;
	const { sid, client, project, uid, label, iat, exp } = p;
	const game = p.game ?? null;
	if (game !== null && (typeof game !== 'string' || !game)) return null;
	if (typeof sid !== 'string' || !sid) return null;
	if (typeof client !== 'string' || !client) return null;
	if (typeof project !== 'string' || !project) return null;
	if (typeof uid !== 'string' || !uid) return null;
	if (label !== null && typeof label !== 'string') return null;
	if (typeof iat !== 'number' || typeof exp !== 'number') return null;
	const t = now / 1000;
	if (iat > t + CLOCK_SKEW || exp <= t || exp - iat > CAPTURE_SESSION_TTL_SECONDS) return null;
	return { sid, client, project, game, uid, label, exp };
}
