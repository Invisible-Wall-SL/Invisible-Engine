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

check(
	lines.getPaylines().length > 0,
	'lines: the info page still gets its payline diagram (parity)',
);
check(
	ways.getPaylines().length === 0,
	'ways: the payline diagram is suppressed (no lines to draw)',
);
check(ways.getNumLines() > 0, 'ways: numLines is NOT zeroed — it stays the bet-per-line divisor');

// The payout divisor — what a paytable multiplier is quoted against. `buildPayTableRows` computes
// `base = totalBet / divisor`, so getting this wrong misprices every row on the info page.
check(
	lines.payoutDivisor() === lines.getNumLines(),
	'lines: the divisor is still the LINE count (parity)',
	` (${lines.payoutDivisor()})`,
);
check(
	ways.payoutDivisor() === ways.activeWaysCount(),
	'ways: the divisor is the WAYS count, not the RGS payline count',
	` (${ways.payoutDivisor()} ways vs ${ways.getNumLines()} lines)`,
);
check(
	ways.activeWaysCount() === 243,
	'ways: a 5x3 grid pays 243 ways (3^5, from numRows)',
	` (${ways.activeWaysCount()})`,
);
const cluster = mk({ type: 'cluster', minCluster: 5, adjacency: 'orthogonal' });
check(
	cluster.payoutDivisor() === 1,
	'cluster: multipliers apply to the whole bet (divisor 1)',
	` (${cluster.payoutDivisor()})`,
);

// #355 warned at boot that a declared ways model had no runtime; #392 gave every model one and
// retired the warning, so no config may still claim its win model is unimplemented.
for (const [name, config] of [
	['ways', ways],
	['cluster', cluster],
	['lines', lines],
] as const) {
	const seen: string[] = [];
	const realWarn = console.warn;
	console.warn = (...a: unknown[]) => {
		seen.push(String(a[0]));
	};
	config.warnOnGameConfigIssues({});
	console.warn = realWarn;
	check(!seen.some((l) => l.includes('win model')), `a ${name} config emits NO win-model warning`);
}

process.exit(bad ? 1 : 0);
