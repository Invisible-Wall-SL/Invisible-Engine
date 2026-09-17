/**
 * Authored game kind → mock RGS protocol. THE one mapping, extracted from
 * `mockContract.ts` so the desktop-launcher profile derivation (`launcherProfile.ts`)
 * can share it without importing the whole contract resolver — which reads R2 and
 * imports `projects.ts`, and would therefore make the two modules circular.
 *
 * Deliberately a LEAF: no IO, no DB, one type-only import. Both callers must agree,
 * because they describe the same game to the same test server from different ends —
 * the online publish writes the protocol into `test_server/games.json`, and the desktop
 * build derives its `PUBLIC_RGS_GAME` symbol mapping from it.
 */
import type { MockProtocol } from './testServerManifest';

/**
 * Book-of games use the `book` mock (buy-feature + free spins); `ways` uses the lines
 * mock with its ways win evaluator (Phase D of `docs/design/game-type-templates.md`);
 * everything else — including any author-created custom kind (§21.6), which has no mock
 * of its own — uses the plain `lines` mock.
 */
export function protocolFor(gameType: string): MockProtocol {
	if (gameType === 'bookOf') return 'book';
	if (gameType === 'ways') return 'ways';
	// `cluster` reuses the lines mock too, swapping only how wins are DECIDED (a flood fill instead of
	// a payline walk). It is TEST infrastructure — the mock's paytable is keyed by payline run lengths,
	// so a cluster's payout is approximated; see `evaluateClusters`.
	if (gameType === 'cluster') return 'cluster';
	// `scatter` likewise — a count-anywhere evaluator. Its pricing is by COUNT rather than run length,
	// which is why the project's own paytable (shipped for every model) matters most here.
	if (gameType === 'scatter') return 'scatter';
	return 'lines';
}
