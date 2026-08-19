/**
 * Invisible Game Config — the RUNTIME half of the win model (Phase D of
 * docs/design/game-type-templates.md).
 *
 *   pnpm --filter game-config-spike run winmodel
 *
 * docModel.ts covers the DOC contract (schema, normalize, validate). This covers what the ENGINE
 * does with it: createGameConfig is instantiated against the real apps/lines config, once as a
 * lines game and once declaring ways, and the two are compared.
 *
 * Verified offline rather than in the browser for a specific reason: the dev server does not watch
 * symlinked workspace packages, so a running game happily serves stale engine-game code and a
 * live check can pass or fail for reasons that have nothing to do with the change.
 *
 * Both PARITY checks matter as much as the new behaviour — a lines game must keep colouring its
 * win lines, and must NOT gain the ways warning.
 */
import { createGameConfig } from '../../packages/engine-game/src/game/gameConfig';
import linesRaw from '../../apps/lines/src/game/config';

const mk = (winModel: unknown) => {
	const raw = { ...(linesRaw as Record<string, unknown>) };
	if (winModel === undefined) delete raw.winModel;
	else raw.winModel = winModel;
	// Author a colour on the first payline so we can see whether it is honoured.
	// Author on the FIRST REAL payline id (they start at '1'), since normalizePaylineColors
	// drops a colour keyed to a line that does not exist.
	const firstId = Object.keys((raw.paylines ?? {}) as object)[0];
	raw.paylineColors = { ...(raw.paylineColors as object), [firstId]: '#ff0000' };
	return createGameConfig({ bakedConfig: () => null, compiledConfig: raw });
};

const lines = mk(undefined);
const ways = mk({ type: 'ways', direction: 'ltr', minKind: 3 });

let bad = 0;
const check = (ok: boolean, msg: string) => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
	if (!ok) bad++;
};

check(lines.activeWinModel().type === 'lines', 'lines config → activeWinModel() is lines');
check(ways.activeWinModel().type === 'ways', 'ways config → activeWinModel() is ways');
check(
	lines.paylineColor(0) === '#ff0000',
	'lines: an authored payline colour is still honoured (parity)',
);
check(
	ways.paylineColor(0) === undefined,
	'ways: the payline colour stands down (lineIndex is not a payline id)',
);

console.log('\ncapturing the boot warning for a ways config:');
const seen: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => {
	seen.push(String(a[0]));
};
ways.warnOnGameConfigIssues({});
console.warn = realWarn;
const hit = seen.find((l) => l.includes("declares a 'ways' win model"));
check(!!hit, 'ways config warns at boot that no runtime implements it');
if (hit) console.log(`     → ${hit.slice(0, 120)}…`);

const seen2: string[] = [];
console.warn = (...a: unknown[]) => {
	seen2.push(String(a[0]));
};
lines.warnOnGameConfigIssues({});
console.warn = realWarn;
check(!seen2.some((l) => l.includes('win model')), 'a lines config emits NO such warning (parity)');

process.exit(bad ? 1 : 0);
