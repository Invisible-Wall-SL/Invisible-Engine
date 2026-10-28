/**
 * Contract check for the cloud tool → launcher relay token ("Ask the AI" on the Atlas and Sheet
 * Maker bars), run over the REAL verifier:
 *   pnpm --filter launcher-api check:tool-relay-token
 *
 * `iw_common/ask_ai.py` mints it, so the format is a byte-for-byte contract: the fixed vector
 * below is the one `services/atlas-tool/test_ask_ai.py` asserts. What must hold: the vector
 * verifies within its life and names its tool; an edited, expired, over-long, wrongly signed or
 * wrongly typed token — a launch token among them — is refused.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyRelayToken } from '../src/lib/server/toolRelay.ts';

const SECRET = 'test-signing-secret-0123456789';
const IAT = 1790000000;
const VECTOR =
	'v1.eyJ2IjoxLCJ0eXAiOiJyZWxheSIsImF1ZCI6ImxhdW5jaGVyIiwiaXNzIjoiYXRsYXMiLCJ1aWQiOiJ1LTEyMyIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDAwMDYwfQ.QKf4hgs9cveYGmgkxJIhRB9YL7NIjM-kH2THIKy6ysU';
const LAUNCH_VECTOR =
	'v1.eyJ2IjoxLCJ0eXAiOiJsYXVuY2giLCJhdWQiOiJhdGxhcyIsInN1YiI6InVfMTIzIiwidWlkIjoidS0xMjMiLCJuYW1lIjoiVGVzdCBVc2VyIiwicm9sZSI6ImFydGlzdCIsImNsaWVudCI6ImFjbWUiLCJwcm9qZWN0Ijoic2xvdHNfb25lIiwiY2FwcyI6WyJibHVlcHJpbnRQdWJsaXNoIl0sImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDAwMTIwfQ.0CSIb51eucrRLmsjC7Hnu62y1QKY7u3r5-nUWzeWCq4';

const secrets = () => SECRET;
const at = (s: number) => (IAT + s) * 1000;

function sign(payload: Record<string, unknown>, secret = SECRET): string {
	const input = `v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
	return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}
const relay = (extra: Record<string, unknown> = {}) => ({
	v: 1,
	typ: 'relay',
	aud: 'launcher',
	iss: 'atlas',
	uid: 'u-123',
	iat: IAT,
	exp: IAT + 60,
	...extra,
});

test('the shared vector verifies within its life and names the Atlas Maker', () => {
	assert.deepEqual(verifyRelayToken(VECTOR, at(10), secrets), { uid: 'u-123', tool: 'atlasTool' });
});

test('a Sheet Maker token names the Sheet Maker', () => {
	const tok = sign(relay({ iss: 'sheet' }));
	assert.deepEqual(verifyRelayToken(tok, at(10), secrets), { uid: 'u-123', tool: 'sheetMaker' });
});

test('expired, early, or over-long tokens are refused', () => {
	assert.equal(verifyRelayToken(VECTOR, at(60), secrets), null);
	assert.equal(verifyRelayToken(VECTOR, at(-120), secrets), null);
	assert.equal(verifyRelayToken(sign(relay({ exp: IAT + 3600 })), at(10), secrets), null);
});

test('a wrong secret, an edited payload or an unknown issuer is refused', () => {
	assert.equal(
		verifyRelayToken(VECTOR, at(10), () => `${SECRET}x`),
		null,
	);
	const [v, , sig] = VECTOR.split('.');
	const edited = Buffer.from(JSON.stringify(relay({ uid: 'admin' }))).toString('base64url');
	assert.equal(verifyRelayToken(`${v}.${edited}.${sig}`, at(10), secrets), null);
	assert.equal(verifyRelayToken(sign(relay({ iss: 'rig' })), at(10), secrets), null);
	assert.equal(verifyRelayToken(sign(relay({ iss: 'toString' })), at(10), secrets), null);
});

test('only a relay token for the launcher is accepted — never a launch token', () => {
	assert.equal(verifyRelayToken(LAUNCH_VECTOR, at(10), secrets), null);
	assert.equal(verifyRelayToken(sign(relay({ typ: 'api' })), at(10), secrets), null);
	assert.equal(verifyRelayToken(sign(relay({ aud: 'atlas' })), at(10), secrets), null);
	assert.equal(verifyRelayToken(sign(relay({ uid: '' })), at(10), secrets), null);
});

test('a tool whose secret is unset relays nothing', () => {
	assert.equal(
		verifyRelayToken(VECTOR, at(10), () => ''),
		null,
	);
});

test('garbage never throws', () => {
	for (const t of [null, '', 'v1', 'v1.a.b', 'v2.x.y', `v1.${'%%%'}.sig`, 'v1.bnVsbA.sig']) {
		assert.equal(verifyRelayToken(t, at(10), secrets), null);
	}
});
