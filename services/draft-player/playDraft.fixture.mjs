// The draft player's report reduction (`src/playDraft.mjs`), offline: no browser, no runtime build.
// A harness `result.json` becomes ADR-0010 §4's per-scenario entry — screens reached and missing, the
// stall (op, frames, probe state), the last 20 console errors cut to 300 characters and redacted —
// and a draft that cannot be played is refused before any browser starts. The browser half (a real
// draft played against a real runtime) is `playDraft.browser.mjs`.
//
//   node services/draft-player/playDraft.fixture.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadScript } from '../../scripts/current-games/lib/plan.mjs';
import { expectedScreens, playDraft, reduceScenario, stallOf } from './src/playDraft.mjs';

const lines = loadScript('lines');
const base = lines.scenarios.find((sc) => sc.id === 'base');
const unit = { id: 'g--base--head' };
const result = (over = {}) => ({
	unit,
	screens: {},
	errors: 0,
	stalls: 0,
	console: [],
	seconds: 3.04,
	...over,
});
const shot = (file) => ({ file, frame: 1, screens: [] });

// ---- expected = the script's capture list, in order ----
assert.deepEqual(expectedScreens(base), ['loaded', 'idle', 'spin', 'settled']);

// ---- a complete play ----
{
	const r = reduceScenario(
		base,
		result({
			screens: {
				loaded: shot('loaded.png'),
				idle: shot('idle.png'),
				spin: shot('spin.png'),
				settled: shot('settled.png'),
			},
		}),
		'units',
	);
	assert.deepEqual(r.reached, r.expected);
	assert.deepEqual(r.missing, []);
	assert.equal(r.stall, null);
	assert.equal(r.error, null);
	assert.equal(r.seconds, 3);
	assert.equal(r.shots.spin, 'units/g--base--head/spin.png');
}

// ---- a stall: the harness's "not reached" text becomes op, frames and probe state ----
{
	const probe = { frame: 7210, screens: ['loading'], idle: false, loaded: false, stalls: 0 };
	const error = `step 5 (waitFor spin): not reached — ${JSON.stringify(probe)}`;
	const r = reduceScenario(
		base,
		result({ error, screens: { loaded: shot('loaded.png'), idle: shot('idle.png') } }),
		'units',
	);
	assert.deepEqual(r.reached, ['loaded', 'idle']);
	assert.deepEqual(r.missing, ['spin', 'settled']);
	assert.deepEqual(r.stall, { step: 5, op: 'waitFor', screen: 'spin', frames: 7210, probe });
	assert.equal(r.error, null, 'a stall is not also a generic error');
	assert.deepEqual(Object.keys(r.shots), ['loaded', 'idle']);
	// An op with no screen named.
	assert.equal(
		stallOf(result({ error: 'step 2 (settle): not reached — {"frame":9}' })).screen,
		undefined,
	);
	// A probe the redaction cut mid-JSON is kept as text, not lost.
	assert.deepEqual(stallOf(result({ error: 'step 2 (settle): not reached — {oops}' })).probe, {
		raw: '{oops}',
	});
}

// ---- the page's own stalls count, with no script step named ----
{
	const s = stallOf(result({ stalls: 2, errors: 1, frame: 120 }));
	assert.deepEqual(s, { step: null, op: null, frames: 120, probe: { stalls: 2, errors: 1 } });
	assert.equal(stallOf(result()), null);
}

// ---- a refused boot is not a stall; other failures keep their text ----
{
	const refused = reduceScenario(
		base,
		result({ bootStopped: 'runtime bundle shape invalid', error: 'the runtime refused to boot' }),
		'units',
	);
	assert.equal(refused.stall, null);
	assert.equal(refused.error, null);
	assert.deepEqual(refused.missing, refused.expected);
	const other = reduceScenario(
		base,
		result({ error: "the page rendered with Pixi's canvas renderer" }),
		'units',
	);
	assert.match(other.error, /canvas renderer/);
	assert.equal(other.stall, null);
}

// ---- console errors: the last 20, each cut to 300 characters, secrets redacted ----
{
	process.env.PIPELINE_CI_TOKEN = 'tok-0123-secret-value';
	const lots = Array.from({ length: 30 }, (_v, i) => `[error] line ${i}`);
	lots[29] = `[error] ${'x'.repeat(500)} tok-0123-secret-value`;
	lots[28] = '[exception] used tok-0123-secret-value to fetch';
	const r = reduceScenario(base, result({ console: lots }), 'units');
	assert.equal(r.consoleErrors.length, 20);
	assert.equal(r.consoleErrors[0], '[error] line 10');
	assert.ok(r.consoleErrors.every((l) => l.length <= 300));
	assert.ok(!r.consoleErrors.join('\n').includes('tok-0123-secret-value'), 'secrets are masked');
	assert.match(r.consoleErrors[18], /^\[exception\] used \*\*\* to fetch$/);
	delete process.env.PIPELINE_CI_TOKEN;
}

// ---- a draft that cannot be played is refused before a browser starts ----
{
	const work = mkdtempSync(join(tmpdir(), 'draft-player-'));
	try {
		const draft = join(work, 'draft');
		mkdirSync(draft);
		writeFileSync(join(draft, 'draft.json'), JSON.stringify({ draftId: 'd1' }));
		const args = {
			draftDir: draft,
			runtimeDir: work,
			contract: { protocol: 'lines' },
			kind: 'lines',
			out: join(work, 'out'),
		};
		await assert.rejects(playDraft(args), /no runtime\.json/);
		writeFileSync(join(draft, 'runtime.json'), '{}');
		await assert.rejects(playDraft({ ...args, scenarios: ['nope'] }), /no scenario "nope"/);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

console.log('playDraft.fixture: ok');
