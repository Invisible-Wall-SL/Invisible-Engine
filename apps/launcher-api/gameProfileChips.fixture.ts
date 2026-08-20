/**
 * Offline check of the two Game Maker card fixes, over the REAL modules — this app's `build` is a
 * bare `vite build` that strips types without checking them, so a green build proves neither.
 *
 * It cannot be run directly: `game-config` uses extensionless imports and `env.ts` pulls SvelteKit's
 * `$env`. Bundle it first (per `apps/launcher-api/CLAUDE.md`), from THIS directory:
 *
 *   echo "export const env = {};" > .env-stub.mjs
 *   pnpm exec esbuild gameProfileChips.fixture.ts --bundle --platform=node --format=esm \
 *     --outfile=.fixture.run.mjs "--alias:\$env/dynamic/private=./.env-stub.mjs" \
 *     --external:@aws-sdk/client-s3 --external:@aws-sdk/s3-request-presigner \
 *     --external:drizzle-orm --external:postgres
 *   node .fixture.run.mjs && rm -f .fixture.run.mjs .env-stub.mjs
 */
import { buildGameProfile } from './src/lib/server/gameProfile.ts';
import { protocolFor, SHARED_RUNTIME_ID } from './src/lib/server/testServerManifest.ts';

let bad = 0;
const check = (label: string, ok: boolean, detail = '') => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		bad++;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

// 1. protocolFor must be byte-identical to the mapping publishGame used before the move.
console.log('1. kind -> protocol mapping is unchanged by the move:');
const EXPECTED: Record<string, string> = {
	lines: 'lines',
	bookOf: 'book',
	ways: 'ways',
	cluster: 'cluster',
	scatter: 'scatter',
	somethingCustom: 'lines',
	'': 'lines',
};
for (const [kind, want] of Object.entries(EXPECTED)) {
	const got = protocolFor(kind);
	check(`${kind || '(empty)'} -> ${want}`, got === want, `got ${got}`);
}
check('shared runtime id is still "lines"', SHARED_RUNTIME_ID === 'lines', SHARED_RUNTIME_ID);

const signals = (over: Record<string, unknown> = {}) => ({
	gameTypeId: 'cluster',
	gameTypeName: 'Cluster',
	config: null,
	configSource: 'template' as const,
	symbols: { symbols: {} } as never,
	runtimeId: SHARED_RUNTIME_ID,
	protocol: 'cluster' as never,
	...over,
});
const chip = (s: ReturnType<typeof signals>, id: string) =>
	buildGameProfile(s as never).facts.find((f) => f.id === id);

// 2. the runtime chip no longer prints a game-type-looking id
console.log('\n2. runtime chip:');
check(
	'shared bundle reads "shared runtime"',
	chip(signals(), 'runtime')?.text === 'shared runtime',
	String(chip(signals(), 'runtime')?.text),
);
check(
	'a DIFFERENT bundle would still be named',
	chip(signals({ runtimeId: 'tumble' }), 'runtime')?.text === 'tumble runtime',
	String(chip(signals({ runtimeId: 'tumble' }), 'runtime')?.text),
);
check('unpublished prints nothing', chip(signals({ runtimeId: null }), 'runtime') === undefined);

// 3. the drift chip — the whole point: it fires on exactly the test4 case and stays quiet otherwise
console.log('\n3. protocol-drift chip:');
const drift = (s: ReturnType<typeof signals>) => chip(s, 'protocolDrift');
check('silent when protocol matches the kind', drift(signals()) === undefined);
check('silent when never published', drift(signals({ protocol: null })) === undefined);

const test4 = signals({ gameTypeId: 'cluster', protocol: 'lines' });
const d = drift(test4);
check('FIRES on the real test4 case (cluster kind, lines protocol)', d !== undefined);
check(
	'names both sides + the action',
	!!d && d.text.includes('lines') && d.text.includes('cluster') && d.text.includes('re-publish'),
	d?.text ?? '(absent)',
);
check('is toned as a warning so it stands out', d?.tone === 'warn', String(d?.tone));

for (const kind of ['ways', 'scatter', 'bookOf']) {
	check(
		`fires for a stale ${kind} game too`,
		drift(signals({ gameTypeId: kind, protocol: 'lines' })) !== undefined,
	);
	check(
		`silent for a correctly published ${kind} game`,
		drift(signals({ gameTypeId: kind, protocol: protocolFor(kind) as never })) === undefined,
	);
}

console.log(
	bad === 0 ? '\nPROFILE CHIP FIXTURE: PASSED' : `\nPROFILE CHIP FIXTURE: FAILED (${bad})`,
);
if (bad > 0) process.exit(1);
