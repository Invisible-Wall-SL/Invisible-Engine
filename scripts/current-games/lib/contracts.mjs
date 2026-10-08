// The mock contracts the plan pinned, frozen for the run. `test_server/games.json` is ONE live R2
// key the launcher rewrites on every publish (`upsertTestServerGame`), so a render that read it
// itself, minutes after the plan, dealt from whatever was there then: a game republished between
// the two reads failed on both sides ("the mock contract changed during the run"). The plan writes
// the contracts it hashed to `contracts.json` beside `plan.json`, and every render deals from that
// copy; the plan's hash still checks each one.
//
// The plan folder is an artifact of a PUBLIC repository, so a live game's contract never lands
// there in the clear: it is sealed with AES-256-GCM under a key derived (HKDF-SHA256) from the R2
// read secret, which only the run's jobs hold. A run whose contracts all came from the games list
// (`local.manifestEntry`, the committed stand-ins) has nothing private to hide and writes them plain.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTRACTS_FILE = 'contracts.json';
const SECRET_ENV = 'CURRENT_GAMES_R2_SECRET_ACCESS_KEY';
const INFO = 'current-games mock contracts v1';

const keyFor = (secret, salt) =>
	Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), salt, INFO, 32));

/** `contracts` (game key → contract) as the file's text: sealed with `secret`, else plain. */
export function sealContracts(contracts, secret) {
	const text = JSON.stringify(contracts);
	if (!secret) return JSON.stringify({ version: 1, contracts });
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', keyFor(secret, salt), iv);
	const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
	return JSON.stringify({
		version: 1,
		sealed: {
			salt: salt.toString('base64'),
			iv: iv.toString('base64'),
			tag: cipher.getAuthTag().toString('base64'),
			data: data.toString('base64'),
		},
	});
}

/** The contracts in `text` (from `sealContracts`); a sealed file needs the same `secret`. */
export function openContracts(text, secret) {
	const file = JSON.parse(text);
	if (file.version !== 1) throw new Error(`${CONTRACTS_FILE}: unknown version ${file.version}`);
	if (!file.sealed) return file.contracts;
	if (!secret) throw new Error(`${CONTRACTS_FILE} is sealed and ${SECRET_ENV} is not set`);
	const { salt, iv, tag, data } = file.sealed;
	const decipher = createDecipheriv(
		'aes-256-gcm',
		keyFor(secret, Buffer.from(salt, 'base64')),
		Buffer.from(iv, 'base64'),
	);
	decipher.setAuthTag(Buffer.from(tag, 'base64'));
	try {
		const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
		return JSON.parse(plain.toString('utf8'));
	} catch {
		throw new Error(`${CONTRACTS_FILE} does not open with this run's ${SECRET_ENV}`);
	}
}

/**
 * Write `contracts` to `dir`. Sealed whenever the R2 secret is set; a contract read from R2 without
 * it cannot happen (the read needs the secret), so `fromR2` without one is a bug, refused.
 */
export function writeContracts(dir, contracts, { fromR2 }) {
	const secret = process.env[SECRET_ENV];
	if (fromR2 && !secret) throw new Error(`refusing to write live mock contracts unsealed`);
	writeFileSync(join(dir, CONTRACTS_FILE), sealContracts(contracts, secret));
}

export const readContracts = (dir) =>
	openContracts(readFileSync(join(dir, CONTRACTS_FILE), 'utf8'), process.env[SECRET_ENV]);
