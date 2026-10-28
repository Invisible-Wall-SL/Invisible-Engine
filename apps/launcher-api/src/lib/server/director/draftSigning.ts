import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The draft-player wire signature, a port of `services/draft-player/src/signing.mjs` (both
 * directions, one shared `DRAFT_PLAYER_SECRET`; `check-director-adapters.ts` cross-checks the two):
 *
 *   X-Draft-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>\n<METHOD> <path+query>\n<raw body>")>
 *
 * The request line is in the MAC so a signature for one request cannot be replayed on another.
 */

export const SIGNATURE_HEADER = 'x-draft-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const mac = (secret: string, t: string | number, method: string, target: string, body: string) =>
	createHmac('sha256', secret)
		.update(`${t}\n${method.toUpperCase()} ${target}\n`)
		.update(body)
		.digest('hex');

/** The header value for a request; `target` is the path and query, as sent. */
export function signDraftRequest(
	secret: string,
	method: string,
	target: string,
	body = '',
	now: number = Date.now(),
): string {
	const t = Math.floor(now / 1000);
	return `t=${t},v1=${mac(secret, t, method, target, body)}`;
}

/** True when `header` signs exactly this method, target and raw body, within the tolerance. */
export function verifyDraftRequest(
	secret: string,
	method: string,
	target: string,
	body: string,
	header: string | null | undefined,
	now: number = Date.now(),
): boolean {
	const fields = new Map<string, string>();
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
