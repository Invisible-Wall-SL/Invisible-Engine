/**
 * Offline fixture for the level the renderer starts at (`renderTier.ts`) and texture residency
 * (`textureResidency.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/fixtures/renderTier.fixture.ts
 *
 * Pins: every device starts at the full level whatever memory it reports (Brave reported a 16 GB
 * Pixel 9 Pro as 4 GB or less, and the old tier believed it), so the art tier reads the full cap
 * too; only `?render=` changes the start; reported memory decides only whether textures stay
 * resident (4 GB or less: left to Pixi's collector; no figure, as in Safari: resident).
 */

import { readRenderPin, renderPin, renderSettings, renderTier } from '../src/lib/renderTier.ts';
import { lowMemoryDevice } from '../src/lib/textureResidency.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const brave = { isBrave: () => Promise.resolve(true) };

const boot = (search: string, nav: object) => {
	Object.defineProperty(globalThis, 'window', {
		value: { location: { search } },
		configurable: true,
	});
	Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
};
const tierFor = (search: string, nav: object) => {
	boot(search, nav);
	return renderTier();
};

console.log('start level');
check('8 GB starts full', tierFor('', { deviceMemory: 8 }) === 'full');
check('4 GB starts full', tierFor('', { deviceMemory: 4 }) === 'full');
check('2 GB starts full', tierFor('', { deviceMemory: 2 }) === 'full');
check('Brave reporting 4 GB starts full', tierFor('', { deviceMemory: 4, brave }) === 'full');
check('Safari (no figure) starts full', tierFor('', {}) === 'full');
boot('', { deviceMemory: 2 });
check('the art tier reads the full cap on a 2 GB device', renderSettings().maxResolution === 2);
check(
	'?render=reduced pins reduced',
	tierFor('?render=reduced', { deviceMemory: 8 }) === 'reduced',
);
check('?render=full pins full', tierFor('?render=full', { deviceMemory: 2 }) === 'full');
boot('?render=full', {});
check('?render=full is a pin', renderPin() === 'full');
boot('', {});
check('no ?render= is no pin', renderPin() === undefined);
check('an unknown ?render= is no pin', readRenderPin('?render=low') === undefined);
check('the pin reads among other params', readRenderPin('?perf=1&render=reduced') === 'reduced');

const reduced = renderSettings('reduced');
check('reduced draws at 1.5, no MSAA', reduced.maxResolution === 1.5 && !reduced.antialias);
const full = renderSettings('full');
check('full draws at 2 with MSAA', full.maxResolution === 2 && full.antialias);

console.log('\ntexture residency');
check('4 GB is low on memory', lowMemoryDevice({ deviceMemory: 4 }));
check('0.25 GB is low on memory', lowMemoryDevice({ deviceMemory: 0.25 }));
check('8 GB is not', !lowMemoryDevice({ deviceMemory: 8 }));
check('no figure (Safari, Firefox) is not', !lowMemoryDevice({}));
check('a figure that is not a number is not', !lowMemoryDevice({ deviceMemory: '4' }));
check('no navigator is not', !lowMemoryDevice(undefined));
boot('', { deviceMemory: 2 });
check('it reads this page navigator by default', lowMemoryDevice());

if (failures) throw new Error(`renderTier fixture: ${failures} check(s) FAILED`);
console.log('\nrenderTier fixture: ok');
