/**
 * Contract check for the launcher → cloud tool launch token, run over the REAL module:
 *   pnpm --filter launcher-api check:tool-launch-token
 *
 * The Python tools verify this token independently, so the format is a byte-for-byte contract:
 * the fixed test vector below is the same one their check asserts. The handoff half pins the
 * transition rule — a signing secret set means ONLY the token travels; unset means the legacy
 * query is sent exactly as before.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Role } from '../src/lib/roles.ts';
import {
	buildToolHandoff,
	LAUNCH_HEADER,
	LAUNCH_QUERY_PARAM,
	mintToolLaunchToken,
	type HandoffSecrets,
	type LaunchClaims,
} from '../src/lib/server/toolLaunch.ts';

const SECRET = 'test-signing-secret-0123456789';
const NOW = 1790000000 * 1000;
const CLAIMS: LaunchClaims = {
	aud: 'atlas',
	sub: 'u_123',
	uid: 'u-123',
	name: 'Test User',
	role: 'artist' as Role,
	client: 'acme',
	project: 'slots_one',
	caps: ['blueprintPublish'],
};
const VECTOR =
	'v1.eyJ2IjoxLCJ0eXAiOiJsYXVuY2giLCJhdWQiOiJhdGxhcyIsInN1YiI6InVfMTIzIiwidWlkIjoidS0xMjMiLCJuYW1lIjoiVGVzdCBVc2VyIiwicm9sZSI6ImFydGlzdCIsImNsaWVudCI6ImFjbWUiLCJwcm9qZWN0Ijoic2xvdHNfb25lIiwiY2FwcyI6WyJibHVlcHJpbnRQdWJsaXNoIl0sImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDAwMTIwfQ.0CSIb51eucrRLmsjC7Hnu62y1QKY7u3r5-nUWzeWCq4';

function payloadOf(token: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

const USER = { id: 'U-123', email: 'test@example.com', name: 'Test User', role: 'artist' as Role };
const LEGACY_KEYS = ['k', 'client', 'project', 'user', 'bp'];

function secrets(signingSecret: string): HandoffSecrets {
	return { signingSecret, legacySecret: 'legacy-k', blueprintSecret: 'legacy-bp' };
}

test('mint reproduces the shared test vector byte for byte', () => {
	assert.equal(mintToolLaunchToken(SECRET, CLAIMS, NOW), VECTOR);
});

test('a token signed with the wrong secret differs only in its signature', () => {
	const wrong = mintToolLaunchToken(`${SECRET}x`, CLAIMS, NOW);
	assert.notEqual(wrong, VECTOR);
	assert.equal(wrong.split('.').slice(0, 2).join('.'), VECTOR.split('.').slice(0, 2).join('.'));
});

test('the token lives exactly 120 seconds', () => {
	const p = payloadOf(mintToolLaunchToken(SECRET, CLAIMS));
	assert.equal(Number(p.exp) - Number(p.iat), 120);
});

test('payload keys are in contract order', () => {
	assert.deepEqual(Object.keys(payloadOf(VECTOR)), [
		'v',
		'typ',
		'aud',
		'sub',
		'uid',
		'name',
		'role',
		'client',
		'project',
		'caps',
		'iat',
		'exp',
	]);
});

test('signing secret set: only the token travels (query)', () => {
	const h = buildToolHandoff(
		{
			tool: 'atlas',
			user: USER,
			clientKey: 'acme',
			projectKey: 'slots_one',
			canPublishBlueprints: true,
		},
		secrets(SECRET),
		'query',
		NOW,
	);
	assert.equal(h.signed, true);
	assert.deepEqual([...h.params.keys()], [LAUNCH_QUERY_PARAM]);
	for (const k of LEGACY_KEYS) assert.equal(h.params.has(k), false, `unexpected ${k}`);
	assert.deepEqual(h.headers, {});
	const p = payloadOf(h.params.get(LAUNCH_QUERY_PARAM) ?? '');
	assert.equal(p.sub, 'u_123');
	assert.equal(p.uid, 'U-123');
	assert.deepEqual(p.caps, ['blueprintPublish']);
});

test('signing secret set: server-to-server puts the token in a header, not the URL', () => {
	const h = buildToolHandoff(
		{
			tool: 'atlas',
			user: USER,
			clientKey: 'acme',
			projectKey: 'slots_one',
			canPublishBlueprints: false,
		},
		secrets(SECRET),
		'header',
		NOW,
	);
	assert.deepEqual([...h.params.keys()], []);
	assert.deepEqual(Object.keys(h.headers), [LAUNCH_HEADER]);
	assert.deepEqual(payloadOf(h.headers[LAUNCH_HEADER]).caps, []);
	assert.equal(payloadOf(h.headers[LAUNCH_HEADER]).typ, 'api');
});

test('sheet never carries caps, and a nameless user is named by their email handle', () => {
	const h = buildToolHandoff(
		{
			tool: 'sheet',
			user: { ...USER, name: null },
			clientKey: 'acme',
			projectKey: 'slots_one',
			canPublishBlueprints: true,
		},
		secrets(SECRET),
		'query',
		NOW,
	);
	const p = payloadOf(h.params.get(LAUNCH_QUERY_PARAM) ?? '');
	assert.equal(p.aud, 'sheet');
	assert.equal(p.name, 'test');
	assert.deepEqual(p.caps, []);
});

test('signing secret unset: the legacy atlas query, unchanged', () => {
	const input = { user: USER, clientKey: 'acme', projectKey: 'slots_one' };
	const holder = buildToolHandoff(
		{ ...input, tool: 'atlas', canPublishBlueprints: true },
		secrets(''),
	);
	assert.equal(holder.signed, false);
	assert.deepEqual(Object.fromEntries(holder.params), {
		k: 'legacy-k',
		client: 'acme',
		project: 'slots_one',
		user: 'u_123',
		bp: 'legacy-bp',
	});
	assert.deepEqual(holder.headers, {});

	const nonHolder = buildToolHandoff(
		{ ...input, tool: 'atlas', canPublishBlueprints: false },
		{ signingSecret: '', legacySecret: '', blueprintSecret: 'legacy-bp' },
	);
	assert.deepEqual(Object.fromEntries(nonHolder.params), {
		client: 'acme',
		project: 'slots_one',
		user: 'u_123',
	});
});

test('signing secret unset: the legacy sheet query, unchanged', () => {
	const h = buildToolHandoff(
		{
			tool: 'sheet',
			user: USER,
			clientKey: 'acme',
			projectKey: 'slots_one',
			canPublishBlueprints: true,
		},
		{ signingSecret: '', legacySecret: 'legacy-k', blueprintSecret: '' },
	);
	assert.deepEqual(Object.fromEntries(h.params), {
		k: 'legacy-k',
		client: 'acme',
		project: 'slots_one',
	});
});

function atlasCaps(
	via: 'query' | 'header',
	flags: { canPublishBlueprints: boolean; canMergePipeline?: boolean },
	tool: 'atlas' | 'sheet' = 'atlas',
): unknown {
	const h = buildToolHandoff(
		{ tool, user: USER, clientKey: 'acme', projectKey: 'slots_one', ...flags },
		secrets(SECRET),
		via,
		NOW,
	);
	return payloadOf(
		via === 'header' ? h.headers[LAUNCH_HEADER] : (h.params.get(LAUNCH_QUERY_PARAM) ?? ''),
	).caps;
}

test('a holder of both caps gets both on a browser launch, publish first', () => {
	const both = { canPublishBlueprints: true, canMergePipeline: true };
	assert.deepEqual(atlasCaps('query', both), ['blueprintPublish', 'pipelineMerge']);
	assert.deepEqual(atlasCaps('query', { canPublishBlueprints: false, canMergePipeline: true }), [
		'pipelineMerge',
	]);
});

test('a header (api) launch never carries pipelineMerge', () => {
	assert.deepEqual(atlasCaps('header', { canPublishBlueprints: true, canMergePipeline: true }), [
		'blueprintPublish',
	]);
	assert.deepEqual(
		atlasCaps('header', { canPublishBlueprints: false, canMergePipeline: true }),
		[],
	);
});

test('sheet never carries pipelineMerge', () => {
	const both = { canPublishBlueprints: true, canMergePipeline: true };
	assert.deepEqual(atlasCaps('query', both, 'sheet'), []);
	assert.deepEqual(atlasCaps('header', both, 'sheet'), []);
});

test('a non-holder gets neither cap', () => {
	assert.deepEqual(
		atlasCaps('query', { canPublishBlueprints: false, canMergePipeline: false }),
		[],
	);
	assert.deepEqual(atlasCaps('query', { canPublishBlueprints: false }), []);
});

test('signing secret unset: pipelineMerge has no legacy carrier', () => {
	const h = buildToolHandoff(
		{
			tool: 'atlas',
			user: USER,
			clientKey: 'acme',
			projectKey: 'slots_one',
			canPublishBlueprints: true,
			canMergePipeline: true,
		},
		secrets(''),
	);
	assert.deepEqual([...h.params.keys()], ['k', 'client', 'project', 'user', 'bp']);
});
