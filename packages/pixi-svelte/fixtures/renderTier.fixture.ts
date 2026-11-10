/**
 * Offline fixture for the render tier (`renderTier.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/fixtures/renderTier.fixture.ts
 *
 * Pins: 4 GB or less of reported memory is the reduced tier, more is full; no figure (Safari) is
 * full; Brave's figure is not believed, so a Brave device is full whatever it reports; `?render=`
 * beats the memory either way; the reduced tier draws at 1.5 without MSAA.
 */

import { renderSettings, renderTier, reportedMemoryGb } from '../src/lib/renderTier.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const brave = { isBrave: () => Promise.resolve(true) };

check('a reported figure is read', reportedMemoryGb({ deviceMemory: 8 }) === 8);
check('no figure is unknown', reportedMemoryGb({}) === undefined);
check('Brave at 2 GB is unknown', reportedMemoryGb({ deviceMemory: 2, brave }) === undefined);
check('Brave at 8 GB is unknown', reportedMemoryGb({ deviceMemory: 8, brave }) === undefined);

const boot = (search: string, nav: object) => {
	Object.defineProperty(globalThis, 'window', {
		value: { location: { search } },
		configurable: true,
	});
	Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
	return renderTier();
};

check('4 GB is reduced', boot('', { deviceMemory: 4 }) === 'reduced');
check('8 GB is full', boot('', { deviceMemory: 8 }) === 'full');
check('Safari (no figure) is full', boot('', {}) === 'full');
check('Brave reporting 4 GB is full', boot('', { deviceMemory: 4, brave }) === 'full');
check('?render=reduced beats 8 GB', boot('?render=reduced', { deviceMemory: 8 }) === 'reduced');
check('?render=reduced holds in Brave', boot('?render=reduced', { brave }) === 'reduced');
check('?render=full beats 2 GB', boot('?render=full', { deviceMemory: 2 }) === 'full');

const reduced = renderSettings('reduced');
check('reduced draws at 1.5, no MSAA', reduced.maxResolution === 1.5 && !reduced.antialias);
const full = renderSettings('full');
check('full draws at 2 with MSAA', full.maxResolution === 2 && full.antialias);

if (failures) throw new Error(`renderTier fixture: ${failures} check(s) FAILED`);
console.log('\nrenderTier fixture: ok');
