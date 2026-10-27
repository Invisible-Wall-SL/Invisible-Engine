import arcade from '../../../../../../scripts/current-games/screens/arcade.json';
import bookOf from '../../../../../../scripts/current-games/screens/bookOf.json';
import cluster from '../../../../../../scripts/current-games/screens/cluster.json';
import holdAndWin from '../../../../../../scripts/current-games/screens/holdAndWin.json';
import lines from '../../../../../../scripts/current-games/screens/lines.json';
import match3 from '../../../../../../scripts/current-games/screens/match3.json';
import scatter from '../../../../../../scripts/current-games/screens/scatter.json';
import ways from '../../../../../../scripts/current-games/screens/ways.json';

/**
 * The screens each game kind's play script captures (`scripts/current-games/screens/<kind>.json`,
 * read only): the launcher presigns one screenshot upload per (scenario, screen), because the
 * player holds no storage credential. `scriptNameFor` is `scriptFor` of `lib/plan.mjs`, which
 * `check-director-adapters.ts` holds it to.
 */

interface Script {
	scenarios: { id: string; steps: { op: string; screen?: string }[] }[];
}

const SCRIPTS: Record<string, Script> = {
	arcade,
	bookOf,
	cluster,
	holdAndWin,
	lines,
	match3,
	scatter,
	ways,
};

export const scriptNameFor = (gameType: string): string =>
	gameType in SCRIPTS && gameType !== 'lines' ? gameType : 'lines';

/** Every (scenario, screen) the play may capture, for the scenarios asked for (all when null). */
export function screenshotSlots(
	gameType: string,
	scenarios: readonly string[] | null,
): { scenario: string; screen: string }[] {
	const script = SCRIPTS[scriptNameFor(gameType)];
	return script.scenarios
		.filter((sc) => !scenarios || scenarios.includes(sc.id))
		.flatMap((sc) =>
			sc.steps
				.filter((s) => s.op === 'capture' && s.screen)
				.map((s) => ({ scenario: sc.id, screen: s.screen as string })),
		);
}
