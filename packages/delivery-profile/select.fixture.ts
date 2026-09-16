/**
 * Offline fixture for SELECTING a delivery profile at launch (`?rgs_profile=<id>`). Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/delivery-profile/select.fixture.ts
 *
 * The shared `_runtime/*` bundle is one artifact that has to reach several RGSs — our own test
 * server while developing, a partner's for real play — without a rebuild per target. So a build can
 * compile a REGISTRY of profiles and the launch URL picks one. FIVE claims:
 *
 *  1. NOTHING SELECTED IS THE OLD BEHAVIOUR. No registry and no param ⇒ the built-in default (our
 *     RGS through `?rgs_url=`), silently. This is the parity gate for every game already live.
 *  2. A SELECTED ID IS APPLIED. `?rgs_profile=2complex` against a compiled registry resolves to that
 *     partner's transport.
 *  3. `internal` IS ALWAYS AVAILABLE AND MEANS OURS. It is the reserved id for development mode on a
 *     bundle that also carries partner profiles — the third option, named rather than implied.
 *  4. AN ID THIS BUILD DOES NOT CARRY REFUSES LOUDLY. It falls back to ours AND warns, listing what
 *     is available: a silent fallback would be a game that looks fine while playing somewhere the
 *     launch never intended.
 *  5. A BAKED PROFILE CANNOT BE REPOINTED BY THE URL. A delivered build is pinned on purpose, so the
 *     param is refused and reported — otherwise the host page could move a wallet we fixed.
 */

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const PARTNER = {
	id: '2complex-bookof',
	rgs: { baseUrl: 'https://gs.2-complex.science', endpoint: '/webnode/engine' },
	session: { param: 'sid', required: true },
};

type Scenario = {
	search: string;
	registry?: Record<string, unknown> | undefined;
	baked?: unknown;
};

/** Load a FRESH copy of the resolver under the given globals. The module resolves at import time,
 *  so each scenario needs its own module instance — hence the cache-busting query. */
let caseId = 0;
const run = async (scenario: Scenario) => {
	const g = globalThis as Record<string, unknown>;
	g.window = { location: { search: scenario.search, href: 'https://game.example/play/' } };
	if (scenario.registry === undefined) delete g.__IE_DELIVERY_PROFILES__;
	else g.__IE_DELIVERY_PROFILES__ = scenario.registry;
	if (scenario.baked === undefined) delete g.__IE_DELIVERY_PROFILE__;
	else g.__IE_DELIVERY_PROFILE__ = scenario.baked;

	// `config.json` is only read for a BAKED profile; answer 404 so that path stays a clean no-op.
	g.fetch = async () => new Response('', { status: 404 });

	const warnings: string[] = [];
	const realWarn = console.warn;
	const realInfo = console.info;
	console.warn = (msg: unknown) => void warnings.push(String(msg));
	console.info = () => {};
	try {
		const mod = await import(`./src/resolve.ts?case=${caseId++}`);
		await mod.loadDeliveryProfile();
		return { profile: mod.getDeliveryProfile(), warnings };
	} finally {
		console.warn = realWarn;
		console.info = realInfo;
	}
};

const REGISTRY = { '2complex': PARTNER };

const main = async () => {
	console.log('\n1. nothing selected is the old behaviour');
	{
		const r = await run({ search: '' });
		check('our RGS via the launch URL', r.profile.rgs.baseUrl, '');
		check('the stock endpoint', r.profile.rgs.endpoint, '/rgs/engine');
		check('?rgs_url= still wins', r.profile.rgs.allowUrlOverride, true);
		check('no token required', r.profile.session.required, false);
		check('and it says nothing', r.warnings, []);
	}

	console.log('\n2. a selected id is applied');
	{
		const r = await run({ search: '?rgs_profile=2complex', registry: REGISTRY });
		check('id', r.profile.id, '2complex-bookof');
		check('RGS', `${r.profile.rgs.baseUrl}${r.profile.rgs.endpoint}`, 'https://gs.2-complex.science/webnode/engine'); // prettier-ignore
		check('session param', r.profile.session.param, 'sid');
		check('a missing token is fatal', r.profile.session.required, true);
		check('cleanly', r.warnings, []);
	}

	console.log('\n3. `internal` is always available and means ours');
	{
		const r = await run({ search: '?rgs_profile=internal', registry: REGISTRY });
		check('falls back to the built-in default', r.profile.rgs.endpoint, '/rgs/engine');
		check('...and to the launch URL', r.profile.rgs.baseUrl, '');
		check('quietly — it is a legitimate choice', r.warnings, []);
	}

	console.log('\n4. an id this build does not carry refuses loudly');
	{
		const r = await run({ search: '?rgs_profile=nope', registry: REGISTRY });
		check('falls back to ours', r.profile.rgs.endpoint, '/rgs/engine');
		check('warns once', r.warnings.length, 1);
		check('names what IS available', r.warnings[0].includes('internal, 2complex'), true);
		const noRegistry = await run({ search: '?rgs_profile=2complex' });
		check('a build with no registry at all also refuses', noRegistry.profile.rgs.baseUrl, '');
		check('...and says so', noRegistry.warnings.length, 1);
	}

	console.log('\n5. a baked profile cannot be repointed by the URL');
	{
		const r = await run({ search: '?rgs_profile=internal', baked: PARTNER, registry: REGISTRY });
		check('the delivery stays pinned', r.profile.rgs.baseUrl, 'https://gs.2-complex.science');
		check('and the attempt is reported', r.warnings.some((w) => w.includes('pinned')), true); // prettier-ignore
		const same = await run({ search: '?rgs_profile=2complex-bookof', baked: PARTNER });
		check('asking for the one it already is passes quietly', same.warnings, []);
	}

	console.log(
		failures === 0 ? '\nAll profile-selection claims hold.\n' : `\n${failures} FAILED.\n`,
	);
	process.exit(failures === 0 ? 0 : 1);
};

void main();
