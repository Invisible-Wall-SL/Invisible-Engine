/**
 * Offline fixture for the `?particles=` switch of the particle budget (`particleBudget.ts`) — run
 * with:
 *   pnpm check:all --only particleBudget
 *
 * Pins: `off` is its own value (every emitter and baked effect off, the budget pinned), not a
 * number clamped to the floor; a number still pins the quality within 0.25..1; no switch or a
 * word leaves the budget adaptive at the tier's cap; nothing is off until a game configures the
 * budget (the tools never do). The render-quality ladder's cap (`capParticleBudget`): it lowers the
 * quality at once and holds an adaptive budget under it, lifting it lets the budget climb back,
 * never above the tier's cap, clamped to the floor; a pin and an unconfigured budget ignore it.
 */

import {
	PARTICLE_BUDGET_FLOOR,
	capParticleBudget,
	configureParticleBudget,
	parseParticlesParam,
	particleQuality,
	particlesOff,
	sampleParticleFrame,
} from '../src/lib/particleBudget.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

console.log('parsing');
check('`off` is off', parseParticlesParam('off') === 'off');
check('0.5 pins half', parseParticlesParam('0.5') === 0.5);
check('0.1 clamps to the floor', parseParticlesParam('0.1') === PARTICLE_BUDGET_FLOOR);
check('2 clamps to 1', parseParticlesParam('2') === 1);
check('absent is no pin', parseParticlesParam(null) === undefined);
check('a word is no pin', parseParticlesParam('none') === undefined);

const boot = (search: string) => {
	Object.defineProperty(globalThis, 'window', {
		value: { location: { search } },
		configurable: true,
	});
	Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
};

/** Slow frames for 3 s: an adaptive budget steps down. */
const slowFrames = () => {
	for (let i = 0; i < 90; i++) sampleParticleFrame(1000 + i * 40, 40, 0);
};

let clock = 1_000_000;
/** `seconds` of 60 fps frames: an adaptive budget climbs back towards its cap. */
const fastFrames = (seconds: number) => {
	for (let i = 0; i < seconds * 60; i++) sampleParticleFrame((clock += 16.7), 16.7, 0);
};

console.log('the game');
boot('?particles=off');
check('before a game configures it, nothing is off', !particlesOff());
capParticleBudget(0.5);
check('…and a cap does nothing (the tools never configure it)', particleQuality() === 1);
configureParticleBudget({ tier: 'full' });
check('?particles=off turns the particles off', particlesOff());
slowFrames();
check('…and pins the budget (slow frames step nothing)', particleQuality() === 1);

boot('?particles=0.5');
configureParticleBudget({ tier: 'full' });
check('?particles=0.5 is not off', !particlesOff());
slowFrames();
check('…and pins the quality at 0.5', particleQuality() === 0.5, String(particleQuality()));

boot('');
configureParticleBudget({ tier: 'full' });
check('no switch: on', !particlesOff());
slowFrames();
check('…and adaptive', particleQuality() < 1, String(particleQuality()));

console.log('the render-quality cap');
boot('');
configureParticleBudget({ tier: 'full' });
capParticleBudget(0.5);
check('a cap lowers the quality at once', particleQuality() === 0.5, String(particleQuality()));
slowFrames();
const capped = particleQuality();
check('…the budget still steps down under it', capped < 0.5, String(capped));
fastFrames(60);
check(
	'…and climbs back no higher than the cap',
	particleQuality() === 0.5,
	String(particleQuality()),
);
capParticleBudget(1);
check('lifting it leaves the quality to climb', particleQuality() === 0.5);
fastFrames(60);
check('…which it does, back to 1', particleQuality() === 1, String(particleQuality()));
capParticleBudget(0.1);
check(
	'a cap under the floor is the floor',
	particleQuality() === PARTICLE_BUDGET_FLOOR,
	String(particleQuality()),
);
capParticleBudget(1);

configureParticleBudget({ tier: 'reduced' });
capParticleBudget(1);
fastFrames(60);
check('lifting the cap never goes above the tier', particleQuality() === 0.5);
capParticleBudget(0.25);
check('a cap under the tier lowers it', particleQuality() === 0.25);

configureParticleBudget({ tier: 'full', adaptive: false });
capParticleBudget(0.5);
check('a fixed budget takes the cap', particleQuality() === 0.5);
capParticleBudget(1);
check('…and gives it back', particleQuality() === 1);

boot('?particles=0.75');
configureParticleBudget({ tier: 'full' });
capParticleBudget(0.25);
check('a ?particles= pin ignores the cap', particleQuality() === 0.75, String(particleQuality()));

boot('');
configureParticleBudget({ tier: 'full' });
check('configuring again starts uncapped', particleQuality() === 1);

if (failures) throw new Error(`particleBudget.fixture: ${failures} FAILED`);
console.log('\nparticleBudget.fixture: all ok');
