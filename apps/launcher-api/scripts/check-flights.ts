/**
 * Contract check for the Hold and Win FLIGHTS block (Invisible Symbols State Machine → Flights):
 * what the doc persists, what it refuses, and that the block — and every asset and effect it
 * names — reaches BOTH bundle paths and the game.
 *
 *   1. PARITY — `normalizeSymbolsDoc` writes NO `flights` for a project that never authored one
 *      (byte-identical to before the block existed), round-trips a real style sparsely, drops junk
 *      keys and invalid values, clamps numbers, and is a fixed point.
 *   2. REJECTION — the `.strict()` shape refuses an unknown field, an unknown head kind and an
 *      unknown ease (the values the normalizer cannot repair).
 *   3. THE CLIENT HALF — `setFlightStyle` + `docSignature` mark and unmark dirty, and a draft signs
 *      the same as the doc the server hands back.
 *   4. SHIPPING — a sprite/spine head reaches the symbols asset refs, a flipbook head's clip the
 *      clip walk; the exporter, the export endpoint and the bake all carry the block (the bake by
 *      RUNNING its `lib/bakeFlights.mjs`); the runtime bundle's and the bake's reachable-effects
 *      sources keep the same ids; the game reads it through one accessor and resolves every flight
 *      with it.
 *
 * Run:  pnpm --filter launcher-api check:flights
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { flightEffectIds } from 'engine-layout';
import { lfReaderFrom } from '../../../scripts/lib/read-lf.mjs';
import { collectClipIds } from '../src/lib/server/clipReachability.ts';
import { collectSymbolRefs } from '../src/lib/server/symbolExport.ts';
import { emptySymbolsDoc, normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	setFlightStyle,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';
import { bakedFlightEffectIds, bakeFlights } from './lib/bakeFlights.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = lfReaderFrom(ROOT);

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input);
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

const AUTHORED = {
	toTotal: {
		head: {
			kind: 'sprite',
			assetKey: 'c/p/atlases/atlas_manifest_coins.json::coin_gold',
			scale: 0.8,
		},
		trail: { effectId: 'fx-sparkle-trail' },
		arrival: { effectId: 'fx-pop' },
		path: { bend: 0.4, avoid: false },
		speed: 2,
		ease: 'easeOut',
	},
	toMeter: { head: { kind: 'spine', assetKey: 'c/p/spines/star/', animationName: 'spin' } },
	'toMeter:gold': {
		head: { kind: 'flipbook', clipId: 'clip-gold' },
		trail: { off: true },
		stagger: 40,
	},
	toCollector: { head: { kind: 'glow', tint: '#88ccff' }, arrival: { effectId: 'fx-pop' } },
};

// 1. PARITY
{
	const empty = normalizeSymbolsDoc({});
	check('an empty doc writes no flights', 'flights' in empty, false);
	check('…and is byte-identical to the never-authored doc', json(empty), json(emptySymbolsDoc()));
	check(
		'an empty block persists nothing',
		'flights' in normalizeSymbolsDoc({ flights: {} }),
		false,
	);
	check(
		'a block of empty styles persists nothing',
		'flights' in normalizeSymbolsDoc({ flights: { toTotal: {}, toMeter: { path: {} } } }),
		false,
	);
	const authored = normalizeSymbolsDoc({ flights: AUTHORED }).flights;
	check('a real block round-trips, keys in kind order', authored, {
		toTotal: AUTHORED.toTotal,
		toCollector: AUTHORED.toCollector,
		toMeter: AUTHORED.toMeter,
		'toMeter:gold': AUTHORED['toMeter:gold'],
	});
	const once = normalizeSymbolsDoc({ flights: AUTHORED });
	check('normalising twice is a fixed point', json(normalizeSymbolsDoc(once)), json(once));
	check(
		'junk keys are dropped, real ones kept',
		Object.keys(
			normalizeSymbolsDoc({
				flights: { toTotal: { speed: 2 }, bogus: { speed: 2 }, 'toMeter:': { speed: 2 } },
			}).flights ?? {},
		),
		['toTotal'],
	);
	check(
		'numbers are clamped and an impossible speed dropped',
		normalizeSymbolsDoc({
			flights: {
				toTotal: {
					speed: -3,
					minMs: -10,
					maxMs: 99_999,
					stagger: 12.6,
					path: { bend: 4, padding: 9 },
					head: { kind: 'glow', scale: 0 },
				},
			},
		}).flights,
		{
			toTotal: {
				head: { kind: 'glow' },
				path: { bend: 1, padding: 2 },
				minMs: 16,
				maxMs: 10_000,
				stagger: 13,
			},
		},
	);
	check(
		'a head missing the asset its kind needs is dropped, the rest of the style kept',
		normalizeSymbolsDoc({
			flights: { toTotal: { head: { kind: 'sprite' }, stagger: 10 } },
		}).flights,
		{ toTotal: { stagger: 10 } },
	);
	check(
		'a blank effect id is dropped',
		'flights' in normalizeSymbolsDoc({ flights: { toTotal: { trail: { effectId: '' } } } }),
		false,
	);
}

// 2. REJECTION
rejects('an unknown style field', { flights: { toTotal: { colour: 'red' } } });
rejects('an unknown head kind', { flights: { toTotal: { head: { kind: 'laser' } } } });
rejects('an unknown ease', { flights: { toTotal: { ease: 'bounce' } } });
rejects('an unknown path field', { flights: { toTotal: { path: { wobble: 2 } } } });
rejects('a non-object block', { flights: 'toTotal' });

// 3. THE CLIENT HALF
{
	const base: SymbolsDoc = { version: 1, symbols: {} };
	const authored = setFlightStyle(base, 'toTotal', { speed: 2, ease: 'linear' });
	check('setFlightStyle marks the doc dirty', docSignature(authored) !== docSignature(base), true);
	check('…and writes the style', authored.flights, { toTotal: { speed: 2, ease: 'linear' } });
	check(
		'clearing the only style restores the untouched signature',
		docSignature(setFlightStyle(authored, 'toTotal', undefined)),
		docSignature(base),
	);
	check(
		'…and leaves no flights key at all',
		'flights' in setFlightStyle(authored, 'toTotal', undefined),
		false,
	);
	check(
		'an emptied style is the same as a cleared one',
		'flights' in setFlightStyle(authored, 'toTotal', {}),
		false,
	);
	check(
		'the client clamps like the server, so the save can never come back different',
		setFlightStyle(base, 'toTotal', { maxMs: 50_000 }).flights,
		{ toTotal: { maxMs: 10_000 } },
	);
	const draft = setFlightStyle(
		setFlightStyle(base, 'toMeter:gold', AUTHORED['toMeter:gold'] as never),
		'toTotal',
		AUTHORED.toTotal as never,
	);
	check(
		'a draft signs the same as the doc the server hands back',
		docSignature(draft),
		docSignature({ ...base, flights: normalizeSymbolsDoc(draft).flights }),
	);
}

// 4. SHIPPING
{
	const doc = normalizeSymbolsDoc({ flights: AUTHORED });
	const refs = collectSymbolRefs(doc);
	check(
		'a sprite head ships its atlas through the symbols export',
		refs.spriteManifests.has('c/p/atlases/atlas_manifest_coins.json'),
		true,
	);
	check(
		'a spine head ships its bundle through the symbols export',
		refs.spineKeys.has('c/p/spines/star/'),
		true,
	);
	const clips = new Set<string>();
	collectClipIds(doc, clips);
	check('a flipbook head is a clip the art export ships', clips.has('clip-gold'), true);
	check(
		'no flights ⇒ no extra refs',
		json([...collectSymbolRefs(emptySymbolsDoc()).spineKeys]),
		json([]),
	);

	check(
		'the BAKE carries the block the export hands it, unchanged',
		bakeFlights(JSON.parse(json(doc.flights))),
		doc.flights,
	);
	check('…and an absent block bakes to no key', bakeFlights(undefined), undefined);
	check(
		'…and drops junk the bake cannot use',
		bakeFlights({ toTotal: {}, nonsense: { speed: 1 }, toCollector: 'x', toMeter: { speed: 2 } }),
		{ toMeter: { speed: 2 } },
	);
	check(
		'the runtime bundle and the bake keep the SAME effects reachable',
		[...flightEffectIds(doc.flights)].sort(),
		[...bakedFlightEffectIds(bakeFlights(doc.flights))].sort(),
	);
	check('…which are the trail and the arrivals, once each', flightEffectIds(doc.flights).sort(), [
		'fx-pop',
		'fx-sparkle-trail',
	]);

	const exporter = read('apps/launcher-api/src/lib/server/symbolExport.ts');
	check(
		'the runtime exporter carries the block into the bundle',
		exporter.includes('...(flights ? { flights } : {})'),
		true,
	);
	const endpoint = read('apps/launcher-api/src/routes/api/editor/export-symbols/+server.ts');
	check(
		'the export endpoint forwards it (destructure + response) — the bake reads it there',
		(endpoint.match(/\n\t\t\tflights,/g) ?? []).length,
		2,
	);
	const bake = read('apps/launcher-api/scripts/bake-editor-doc.mjs');
	check(
		'the BAKE assembles it into the baked `symbols` block',
		bake.includes('flights: bakeFlights(s?.flights),'),
		true,
	);
	check(
		'…and keeps its effects in the reachable set',
		bake.includes('bakedFlightEffectIds(symbols.flights)'),
		true,
	);
	const runtime = read('apps/launcher-api/src/lib/server/runtimeBundle.ts');
	check(
		'the runtime bundle keeps its effects in the reachable set',
		runtime.includes('flightEffectIds(symbols.flights)'),
		true,
	);
	const scenes = read('apps/lines/src/editor-scenes.ts');
	check(
		'the game reads it through one accessor, runtime bundle first',
		scenes.includes('export function bakedFlights(): FlightsConfig | undefined {'),
		true,
	);
	const stateApp = read('apps/lines/src/game/stateApp.ts');
	check('…and registers the heads’ assets', stateApp.includes('...bakedFlightAssets(),'), true);
	const flights = read('apps/lines/src/game/flights.svelte.ts');
	check(
		'every flyTo resolves its style through it',
		flights.includes('resolveFlightStyle(bakedFlights(), flight)'),
		true,
	);
}

console.log(
	failures === 0
		? `\nflights: OK (${checks} checks)`
		: `\nflights: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
