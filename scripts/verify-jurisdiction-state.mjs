/**
 * The ENGINE half of a launch's jurisdiction: what `state-shared` does with the block the RGS
 * answered `authenticate` with. The transport half — which flags reach that block — is
 * `packages/rgs-translator-eagaming/authenticate.fixture.ts`.
 *
 *   node scripts/verify-jurisdiction-state.mjs
 *
 * Runs the REAL `.svelte.ts` modules: a load hook compiles each through Svelte's own
 * `compileModule` (server output — the runes become plain values, which is all a logic check needs).
 *
 * FOUR claims:
 *
 *  1. A MISSING BLOCK IS THE DEFAULT, NOT UNDEFINED. `Authenticate` used to assign the RGS's value
 *     straight in, so an RGS that sent none left `stateConfig.jurisdiction` undefined under every
 *     reader — and `disabledFullscreen` is read on the first frame.
 *  2. A LICENCE LOCK SURVIVES THE GAME'S OWN SETTINGS. Authenticate lands BEFORE the game mounts and
 *     applies its authored feature toggles, so an authored `turbo: true` must not re-enable what the
 *     licence switched off — in either order.
 *  3. A FORBIDDEN TURBO HAS NO BACK DOOR. The button is hidden by the flag, but holding Space and
 *     the flow's turbo action set it through `updateIsTurbo` — which must now refuse.
 *  4. NO LOCK, NO CHANGE. A jurisdiction that restricts nothing leaves the authored toggles exactly
 *     as authored — the parity gate for every game running against our own RGS today.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
	'data:text/javascript,' +
		encodeURIComponent(`
			import { readFile } from 'node:fs/promises';
			import { createRequire, stripTypeScriptTypes } from 'node:module';
			import { fileURLToPath } from 'node:url';

			export async function resolve(specifier, context, next) {
				try {
					return await next(specifier, context);
				} catch (err) {
					if (!specifier.startsWith('.')) throw err;
					for (const ext of ['.ts', '/index.ts']) {
						try {
							return await next(specifier + ext, context);
						} catch {}
					}
					throw err;
				}
			}

			export async function load(url, context, next) {
				if (!url.endsWith('.svelte.ts')) return next(url, context);
				const path = fileURLToPath(url);
				const { compileModule } = createRequire(path)('svelte/compiler');
				const js = stripTypeScriptTypes(await readFile(path, 'utf8'));
				const { js: out } = compileModule(js, { filename: path, generate: 'server' });
				return { format: 'module', source: out.code, shortCircuit: true };
			}
		`),
	pathToFileURL('./'),
);

const root = new URL('../packages/state-shared/src/', import.meta.url);
const { stateConfig, setJurisdiction } = await import(new URL('stateConfig.svelte.ts', root));
const { stateUi, setUiFeatures } = await import(new URL('stateUi.svelte.ts', root));
const { stateBet, stateBetDerived } = await import(new URL('stateBet.svelte.ts', root));

let failures = 0;
const check = (label, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const ALL_ON = { turbo: true, autoplay: true, spaceHold: true };

console.log('1. a missing block is the default, not undefined');
setJurisdiction(undefined);
check('no block', stateConfig.jurisdiction.disabledFullscreen, false);
setJurisdiction({ disabledTurbo: true });
check('a partial block keeps the rest', stateConfig.jurisdiction.minimumRoundDuration, 0);

console.log("\n2. a licence lock survives the game's own settings");
setJurisdiction({ disabledTurbo: true });
setUiFeatures(ALL_ON);
check('lock first, authored after', stateUi.config.features, { ...ALL_ON, turbo: false });
setJurisdiction(undefined);
setUiFeatures({ turbo: false, autoplay: true });
setJurisdiction({ disabledAutoplay: true });
check('authored first, lock after', stateUi.config.features, { turbo: false, autoplay: false, spaceHold: false }); // prettier-ignore
setJurisdiction(undefined);
check('lifting the lock restores the authored choice', stateUi.config.features, { ...ALL_ON, turbo: false }); // prettier-ignore

console.log('\n3. a forbidden turbo has no back door');
setUiFeatures(ALL_ON);
stateBetDerived.updateIsTurbo(true, { persistent: true });
setJurisdiction({ disabledTurbo: true });
check('an engaged turbo is dropped', stateBet.isTurbo, false);
stateBetDerived.updateIsTurbo(true, { persistent: true });
check('holding Space cannot engage it', stateBet.isTurbo, false);
setJurisdiction({});
stateBetDerived.updateIsTurbo(true, { persistent: true });
check('allowed again once the lock lifts', stateBet.isTurbo, true);
stateBetDerived.updateIsTurbo(false, { persistent: true });

console.log('\n4. no lock, no change');
setUiFeatures({ turbo: false, autoplay: true, spaceHold: false });
setJurisdiction({ disabledTurbo: false, disabledAutoplay: false });
check('authored toggles stand', stateUi.config.features, { turbo: false, autoplay: true, spaceHold: false }); // prettier-ignore

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
