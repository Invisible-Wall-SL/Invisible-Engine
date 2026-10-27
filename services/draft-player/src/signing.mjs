// The draft-player wire signature (ADR-0010 §3), both directions, one shared secret
// (`DRAFT_PLAYER_SECRET`). Same shape as the atlas callback (`atlasCallback.ts`), with the request
// line in the MAC so a signature for one request cannot be replayed on another:
//
//   X-Draft-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>\n<METHOD> <path+query>\n<raw body>")>
//
// Launcher → player: `POST /play`, `POST /cancel`, `GET /progress?jobRef=` (body empty on a GET).
// Player → launcher: the callback POST, `<METHOD> <path+query>` being the callback URL's own.
// A request more than 300 s from the verifier's clock is refused.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-draft-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const mac = (secret, t, method, target, body) =>
	createHmac('sha256', secret)
		.update(`${t}\n${method.toUpperCase()} ${target}\n`)
		.update(body)
		.digest('hex');

/** The header value for a request. `target` is the path and query, as sent. */
export function signRequest(secret, method, target, body = '', now = Date.now()) {
	const t = Math.floor(now / 1000);
	return `t=${t},v1=${mac(secret, t, method, target, body)}`;
}

/** True when `header` signs exactly this method, target and raw body, within the tolerance. */
export function verifyRequest(secret, method, target, body, header, now = Date.now()) {
	const fields = new Map();
	for (const part of String(header ?? '').split(',')) {
		const at = part.indexOf('=');
		if (at > 0) fields.set(part.slice(0, at), part.slice(at + 1));
	}
	const tRaw = fields.get('t') ?? '';
	if (!/^\d+$/.test(tRaw)) return false;
	if (Math.abs(now / 1000 - Number(tRaw)) > SIGNATURE_TOLERANCE_SECONDS) return false;
	const want = Buffer.from(mac(secret, tRaw, method, target, body));
	const got = Buffer.from(fields.get('v1') ?? '');
	return want.length === got.length && timingSafeEqual(want, got);
}
