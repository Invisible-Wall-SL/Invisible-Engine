import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The atlas-tool render completion callback, launcher side: a byte-for-byte port of
 * `mint_callback_token` / `_token_mac` / `sign_body` / `verify_signature` in
 * `services/atlas-tool/still_jobs.py`. Both sides share `ATLAS_CALLBACK_SECRET`.
 *
 *   token      `v1.<exp>.<hex HMAC-SHA256(secret, "atlas-callback.v1|<url>|<exp>")>` — binds one
 *              URL and an expiry; atlas-tool refuses `/render` with a callback it did not verify.
 *   signature  `X-Atlas-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>." + body)>` on the POST.
 */

const TOKEN_SCOPE = 'atlas-callback.v1';
/** `still_jobs.SIGNATURE_TOLERANCE_SECONDS`. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const hmacHex = (secret: string, data: string | Buffer) =>
	createHmac('sha256', secret).update(data).digest('hex');

function sameHex(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

const tokenMac = (secret: string, url: string, exp: number) =>
	hmacHex(secret, `${TOKEN_SCOPE}|${url}|${exp}`);

export function mintCallbackToken(
	secret: string,
	url: string,
	ttlSeconds: number,
	now: number = Date.now(),
): string {
	const exp = Math.floor(now / 1000) + Math.floor(ttlSeconds);
	return `v1.${exp}.${tokenMac(secret, url, exp)}`;
}

/** True when `token` was minted with `secret` for exactly `url` and has not expired. */
export function verifyCallbackToken(
	secret: string,
	url: string,
	token: string,
	now: number = Date.now(),
): boolean {
	const [v, expRaw, mac, ...rest] = token.split('.');
	if (rest.length || v !== 'v1' || !/^\d+$/.test(expRaw ?? '') || !mac) return false;
	const exp = Number(expRaw);
	if (exp < now / 1000) return false;
	return sameHex(mac, tokenMac(secret, url, exp));
}

export function signCallbackBody(secret: string, body: string, now: number = Date.now()): string {
	const t = Math.floor(now / 1000);
	return `t=${t},v1=${hmacHex(secret, Buffer.concat([Buffer.from(`${t}.`), Buffer.from(body)]))}`;
}

/** The receiver's check of `X-Atlas-Signature` over the RAW body bytes. */
export function verifyCallbackSignature(
	secret: string,
	body: string,
	header: string | null,
	now: number = Date.now(),
	tolerance: number = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
	const fields = new Map<string, string>();
	for (const part of (header ?? '').split(',')) {
		const at = part.indexOf('=');
		if (at > 0) fields.set(part.slice(0, at), part.slice(at + 1));
	}
	const tRaw = fields.get('t') ?? '';
	if (!/^-?\d+$/.test(tRaw)) return false;
	const t = Number(tRaw);
	if (Math.abs(now / 1000 - t) > tolerance) return false;
	const want = hmacHex(secret, Buffer.concat([Buffer.from(`${t}.`), Buffer.from(body)]));
	return sameHex(fields.get('v1') ?? '', want);
}
