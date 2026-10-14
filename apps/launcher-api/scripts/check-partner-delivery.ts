/**
 * Contract check for the partner delivery upload (`$lib/server/partnerDelivery`), run over the REAL
 * module: `pnpm --filter launcher-api check:partner-delivery`.
 *
 * The upload writes keys built from an alias, a versionPath and a path the CLIENT chooses, into a
 * bucket that is the partner's live CDN. A weakened check would let one delivery write into another
 * game's folder, another version's folder, or out of `{brand}/games/` altogether — so the escape
 * cases are asserted, not assumed.
 */
import {
	deliveryObjectKey,
	deliveryPrefix,
	nextVersionPath,
	servedUrl,
} from '../src/lib/server/partnerDelivery.ts';

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	if (actual !== expected) {
		failures++;
		console.error(
			`FAIL  ${label}\n        expected ${String(expected)}\n        got      ${String(actual)}`,
		);
	}
}

function rejects(label: string, fn: () => unknown): void {
	checks++;
	try {
		const got = fn();
		failures++;
		console.error(`FAIL  ${label} — was ACCEPTED as ${String(got)}`);
	} catch {
		/* refused, as required */
	}
}

// ── The folder is the partner's URL convention ────────────────────────────────
check('folder layout', deliveryPrefix('BookOfBorut', 'v3', 'eanew'), 'eanew/games/v3/BookOfBorut/');
check(
	'entry key',
	deliveryObjectKey('BookOfBorut', 'v3', 'game.js', 'eanew'),
	'eanew/games/v3/BookOfBorut/game.js',
);
check(
	'nested asset key',
	deliveryObjectKey('BookOfBorut', 'v1.0', 'assets/sprites/S_A/S_A.webp', 'eanew'),
	'eanew/games/v1.0/BookOfBorut/assets/sprites/S_A/S_A.webp',
);
check(
	'served url',
	servedUrl('BookOfBorut', 'v3', 'https://cdn.example'),
	'https://cdn.example/eanew/games/v3/BookOfBorut/game.js',
);

// ── Paths stay inside their own version folder ────────────────────────────────
rejects('parent traversal into another version', () =>
	deliveryObjectKey('G', 'v3', '../../v2/G/game.js', 'eanew'),
);
rejects('absolute path', () => deliveryObjectKey('G', 'v3', '/game.js', 'eanew'));
rejects('backslash separator', () => deliveryObjectKey('G', 'v3', 'assets\\a.png', 'eanew'));
rejects('windows drive path', () => deliveryObjectKey('G', 'v3', 'C:/a.png', 'eanew'));
rejects('dot-slash path', () => deliveryObjectKey('G', 'v3', './game.js', 'eanew'));
rejects('empty path', () => deliveryObjectKey('G', 'v3', '', 'eanew'));
rejects('folder path', () => deliveryObjectKey('G', 'v3', 'assets/', 'eanew'));
rejects('the host page never goes on the CDN', () =>
	deliveryObjectKey('G', 'v3', 'embed.html', 'eanew'),
);
rejects('nor a nested copy of it', () => deliveryObjectKey('G', 'v3', 'x/embed.html', 'eanew'));

// ── Alias and versionPath are single, plain segments ──────────────────────────
rejects('alias with a slash', () => deliveryPrefix('Book/Borut', 'v3', 'eanew'));
rejects('alias with traversal', () => deliveryPrefix('..', 'v3', 'eanew'));
rejects('alias with a space', () => deliveryPrefix('Book Borut', 'v3', 'eanew'));
rejects('empty alias', () => deliveryPrefix('', 'v3', 'eanew'));
rejects('version with a slash', () => deliveryPrefix('G', 'v3/x', 'eanew'));
rejects('version that is traversal', () => deliveryPrefix('G', '..', 'eanew'));
rejects('version with embedded traversal', () => deliveryPrefix('G', 'v1..2', 'eanew'));
rejects('version starting with a dot', () => deliveryPrefix('G', '.v3', 'eanew'));
rejects('empty version', () => deliveryPrefix('G', '', 'eanew'));

// ── The suggested versionPath never reuses a delivered one ────────────────────
check('first delivery', nextVersionPath([]), 'v1');
check('one past the highest', nextVersionPath(['v1', 'v2', 'v7']), 'v8');
check('foreign names do not move the count', nextVersionPath(['v1.0', '2026-10']), 'v1');
check('mixed', nextVersionPath(['v1.0', 'v2']), 'v3');

console.info(`partner-delivery: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
