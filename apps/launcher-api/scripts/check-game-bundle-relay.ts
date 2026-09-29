/**
 * Contract check for the game-bundle relay (`$lib/server/gameBundleRelay`), run over the REAL
 * module: `pnpm --filter launcher-api check:game-bundle-relay`.
 *
 * It exists because this app has no type-check — a type error compiles and ships green (see
 * `apps/launcher-api/CLAUDE.md` §Validate) — and the relay writes R2 keys built from a path the
 * CLIENT chooses. A weakened check there would let a publish escape `test_server/<key>/` and write
 * over `test_server/games.json` or a shared `_runtime/*` bundle, which is every game at once. So
 * the escape cases are asserted, not assumed.
 */
import {
	assertPublishableKey,
	bundleContentType,
	bundleObjectKey,
	MAX_RELAY_FILE_BYTES,
	relayFileLimitBytes,
} from '../src/lib/server/gameBundleRelay.ts';
import { isMockProtocol, MOCK_PROTOCOLS } from '../src/lib/server/testServerManifest.ts';

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

/** Asserts the call is REFUSED — the only acceptable outcome for a key that escapes the prefix. */
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

// ── Keys stay inside this game's prefix ───────────────────────────────────────
check(
	'nested asset path',
	bundleObjectKey('waysofwavesbuild', 'assets/sprites/S_Background/S_Background.webp'),
	'test_server/waysofwavesbuild/assets/sprites/S_Background/S_Background.webp',
);
check('index.html', bundleObjectKey('g1', 'index.html'), 'test_server/g1/index.html');

rejects('parent traversal', () => bundleObjectKey('g1', '../games.json'));
rejects('deep traversal onto the manifest', () =>
	bundleObjectKey('g1', 'a/../../../test_server/games.json'),
);
rejects('traversal into the shared runtime', () => bundleObjectKey('g1', '../_runtime/index.html'));
rejects('absolute posix path', () => bundleObjectKey('g1', '/etc/passwd'));
rejects('windows drive path', () => bundleObjectKey('g1', 'C:/windows/win.ini'));
rejects('backslash separator', () => bundleObjectKey('g1', 'assets\\art.png'));
rejects('./ prefix', () => bundleObjectKey('g1', './index.html'));
rejects('empty path', () => bundleObjectKey('g1', ''));
rejects('directory marker', () => bundleObjectKey('g1', 'assets/'));
rejects('key that escapes its prefix', () => bundleObjectKey('g1/../_runtime', 'index.html'));
rejects('uppercase key', () => bundleObjectKey('MyGame', 'index.html'));
rejects('key opening with a dash', () => assertPublishableKey('-nope'));
rejects('empty key', () => assertPublishableKey(''));

checks++;
try {
	assertPublishableKey('waysofwavesbuild');
} catch {
	failures++;
	console.error('FAIL  a valid game key was refused');
}

// ── Content types a BUNDLE needs (deployContentType covers assets, not these) ──
check('html', bundleContentType('index.html'), 'text/html; charset=utf-8');
check('js', bundleContentType('_app/immutable/bundle.js'), 'text/javascript; charset=utf-8');
check('css', bundleContentType('_app/immutable/app.css'), 'text/css; charset=utf-8');
check('ktx2', bundleContentType('assets/_pages/89b5.ktx2'), 'image/ktx2');
check('webp', bundleContentType('assets/sprites/S_Background.webp'), 'image/webp');
check('mp3', bundleContentType('assets/audio/sounds.mp3'), 'audio/mpeg');
check('unknown extension', bundleContentType('weird.zzz'), 'application/octet-stream');
check('no extension', bundleContentType('LICENSE'), 'application/octet-stream');

// ── The protocol validator tracks MOCK_PROTOCOLS, not a hand-copied list ──────
for (const protocol of MOCK_PROTOCOLS)
	check(`accepts '${protocol}'`, isMockProtocol(protocol), true);
check('rejects a near-miss', isMockProtocol('paylines'), false);
check('rejects a non-string', isMockProtocol(3), false);
check('rejects an inherited key', isMockProtocol('toString'), false);

// ── The per-file limit the publisher is told — what adapter-node REALLY enforces ──
// The launcher refuses an oversized file before uploading anything on the strength of this, so a
// number larger than the adapter's would let a publish die half way; smaller would refuse a file
// that fits.
const MB = 1024 * 1024;
check('the code default (32M)', relayFileLimitBytes('32M'), 32 * MB);
check("adapter-node's own default (512K)", relayFileLimitBytes('512K'), 512 * 1024);
check('lower-case unit', relayFileLimitBytes('16m'), 16 * MB);
check('plain bytes', relayFileLimitBytes('1000'), 1000);
check('a raised limit is still held to the cap', relayFileLimitBytes('1G'), MAX_RELAY_FILE_BYTES);
check('Infinity is held to the cap', relayFileLimitBytes('Infinity'), MAX_RELAY_FILE_BYTES);
check('unparseable reads as the adapter default', relayFileLimitBytes('lots'), 512 * 1024);

console.log(
	failures === 0
		? `\ngame-bundle relay: OK (${checks} checks)`
		: `\ngame-bundle relay: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
