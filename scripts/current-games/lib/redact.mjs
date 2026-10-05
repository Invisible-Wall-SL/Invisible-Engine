// Secret redaction for everything the harness publishes OUTSIDE the job log: the commit-status
// description, the step summary and the report artifact. GitHub masks secrets in logs only — a
// status posted through the API shows its text verbatim, and an error once published the raw value
// of PIPELINE_GAMES_URL there (undici's `fetch` quotes a bad URL in its TypeError).
//
//   printf %s "$text" | node scripts/current-games/lib/redact.mjs   stdin → redacted stdout

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { LIST_ENV, R2_ENV } from './games.mjs';

export const SECRET_ENV = [...LIST_ENV, ...R2_ENV];
export const MASK = '***';

/** Below this a value is too short to be a secret worth masking everywhere it occurs. */
const MIN_SECRET = 4;
const HEX_RUN = /[0-9a-f]{32,}/gi;
const BASE64_RUN = /[A-Za-z0-9+_-]{40,}={0,2}/g;
const looksRandom = (s) => /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every set secret env's value (and its URL-encoded form), longest first. */
function secretValues(env) {
	const values = new Set();
	for (const name of SECRET_ENV) {
		const v = env[name]?.trim();
		if (!v || v.length < MIN_SECRET) continue;
		values.add(v);
		values.add(encodeURIComponent(v));
	}
	return [...values].sort((a, b) => b.length - a.length);
}

/** `text` with the value of every secret env the harness reads replaced by `***`. */
export function redactSecrets(text, env = process.env) {
	let s = String(text);
	for (const v of secretValues(env)) s = s.replace(new RegExp(escapeRe(v), 'g'), MASK);
	return s;
}

/**
 * `redactSecrets`, then the backstop for a value this process cannot name (the merge job has no
 * secrets): a 32+ hex run, or a 40+ base64 run mixing digits and both cases. It masks a commit SHA
 * inside a message too — the price of never publishing a token pasted into the wrong secret.
 */
export function redactText(text, env = process.env) {
	return redactSecrets(text, env)
		.replace(HEX_RUN, MASK)
		.replace(BASE64_RUN, (m) => (looksRandom(m) ? MASK : m));
}

/** Fields that ARE hashes/SHAs by design: secret values only, no backstop. */
const IDENTIFIER_KEYS = new Set(['sha', 'id', 'diffHash', 'snapshot', 'changedScreens']);

/** A report (any JSON value) with every string redacted; identifiers keep their hashes. */
export function redactReport(value, env = process.env, identifier = false) {
	if (typeof value === 'string')
		return identifier ? redactSecrets(value, env) : redactText(value, env);
	if (Array.isArray(value)) return value.map((v) => redactReport(v, env, identifier));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				k,
				redactReport(v, env, identifier || IDENTIFIER_KEYS.has(k)),
			]),
		);
	return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	process.stdout.write(redactText(readFileSync(0, 'utf8')));
