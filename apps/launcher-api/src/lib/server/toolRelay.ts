import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from './env';

/**
 * A cloud Python tool (Atlas Maker, Sheet Maker) calling the launcher FOR its signed-in user.
 *
 * Those tools live on another site, so the launcher's session cookie never reaches a request their
 * page makes. Instead the page asks its own server, which already knows the user from the launch
 * token it was opened with, and that server forwards the call here with a relay token in the
 * `X-IW-Relay` header — signed with the same per-tool secret as the launch handoff
 * (`toolLaunch.ts`), in the same format, minted by `iw_common/ask_ai.py`:
 *
 *   `v1.<base64url(JSON {v:1, typ:"relay", aud:"launcher", iss, uid, iat, exp})>.<base64url(HMAC)>`
 *
 * The token only names the user; what they may do is decided here, from the database, as for a
 * session.
 */
export const RELAY_HEADER = 'X-IW-Relay';

const RELAY_TTL_MAX = 120;
const CLOCK_SKEW = 60;

/** The tool behind each relay issuer, and the secret it signs with. */
const ISSUERS = {
	atlas: { tool: 'atlasTool', secret: () => ENV.ATLAS_TOOL_SIGNING_SECRET },
	sheet: { tool: 'sheetMaker', secret: () => ENV.SHEET_TOOL_SIGNING_SECRET },
} as const;

type Issuer = keyof typeof ISSUERS;

export interface RelayCaller {
	/** The launcher `users.id` the tool vouches for. */
	uid: string;
	/** The tool that relayed the call (a `TOOLS` id). */
	tool: string;
}

function sameText(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** The caller of a genuine, unexpired relay token; null for anything else. Never throws. */
export function verifyRelayToken(
	token: string | null,
	now: number = Date.now(),
	secretFor: (iss: Issuer) => string = (iss) => ISSUERS[iss].secret(),
): RelayCaller | null {
	const parts = token?.trim().split('.') ?? [];
	if (parts.length !== 3 || parts[0] !== 'v1') return null;
	let payload: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
		if (!parsed || typeof parsed !== 'object') return null;
		payload = parsed as Record<string, unknown>;
	} catch {
		return null;
	}
	const iss = payload.iss;
	if (typeof iss !== 'string' || !Object.hasOwn(ISSUERS, iss)) return null;
	const secret = secretFor(iss as Issuer);
	if (!secret) return null;
	const sig = createHmac('sha256', secret).update(`v1.${parts[1]}`).digest('base64url');
	if (!sameText(sig, parts[2])) return null;

	const { v, typ, aud, uid, iat, exp } = payload;
	if (v !== 1 || typ !== 'relay' || aud !== 'launcher') return null;
	if (typeof uid !== 'string' || !uid) return null;
	if (typeof iat !== 'number' || typeof exp !== 'number') return null;
	const t = now / 1000;
	if (iat > t + CLOCK_SKEW || exp <= t || exp - iat > RELAY_TTL_MAX) return null;
	return { uid, tool: ISSUERS[iss as Issuer].tool };
}
