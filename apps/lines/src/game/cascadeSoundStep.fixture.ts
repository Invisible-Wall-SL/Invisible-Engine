/**
 * Offline fixture for the CASCADE SOUND POSITION — which rung of the tumble-explosion ladder a pop
 * plays, and whether it should sound at all.
 *
 *   node apps/lines/src/game/cascadeSoundStep.fixture.ts
 *
 * The module under test has no imports on purpose, so this runs under bare Node type-stripping —
 * the same trick `symbolCell.fixture.ts` next door uses, for the same reason: the rule is the piece
 * of the sound wiring with a WRONG ANSWER NOBODY WOULD HEAR. Everything else in `soundBindings.ts`
 * is a lookup that either finds a name or does not; this is a small state machine fed by the book
 * event stream, and both of its failure modes are silent ones — a pop that stays quiet, or a win
 * ladder celebrating a spin that has not happened yet.
 *
 * THREE claims:
 *
 *  1. THE LADDER CLIMBS WITHIN A ROUND AND RESTARTS BETWEEN THEM. A four-step cascade plays rungs
 *     1-2-3-4; the next spin starts again at 1. Without the reset the ladder would climb across a
 *     whole session and every spin after the first few would sound identical (pinned to the top
 *     rung by the clamp in `resolveSounds().pick`).
 *  2. THE BOARD CLEAR IS SILENT. `tumbleBoardExplode` also fires for `clearOutgoingSymbols` — the
 *     outgoing board popping away before a drop-in reveal — where nothing has won. Same cue, same
 *     animation, and a win ladder there celebrates a spin that has not happened. That clear runs
 *     under a `reveal`, which is what separates the two.
 *  3. A STALE CASCADE FLAG CANNOT LEAK. Any event that is not a `tumbleBoard` closes the window, so
 *     a clear that happens LATER in the round — after a real cascade has already run — is still
 *     silent. Leaving the flag alone on unrelated events would have passed claim 2 and failed here.
 */

import { cascadeSoundRung, resetCascadeSoundStep, trackCascadeStep } from './cascadeSoundStep.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** Feed a book-event sequence and collect the rung at each step — `null` where the pop is silent. */
const play = (...events: string[]): (number | null)[] => {
	resetCascadeSoundStep();
	return events.map((e) => {
		trackCascadeStep(e);
		return cascadeSoundRung();
	});
};

console.log('\n1. the ladder climbs within a round and restarts between them');
check(
	'a four-step cascade climbs 0,1,2,3 (rungs 1-4)',
	play('reveal', 'tumbleBoard', 'tumbleBoard', 'tumbleBoard', 'tumbleBoard'),
	[null, 0, 1, 2, 3],
);
check(
	'the next spin restarts at the bottom',
	play('reveal', 'tumbleBoard', 'tumbleBoard', 'reveal', 'tumbleBoard'),
	[null, 0, 1, null, 0],
);
check(
	'a nine-step cascade keeps counting (the CLAMP, not this, holds it at the top rung)',
	play('reveal', ...Array(9).fill('tumbleBoard')).slice(-1),
	[8],
);
check(
	'events between cascade steps do not advance the ladder',
	play('reveal', 'tumbleBoard', 'winInfo', 'tumbleBoard'),
	[null, 0, null, 1],
);

console.log('\n2. the board CLEAR is silent — nothing has won yet');
check('a clear during the opening reveal', play('reveal'), [null]);
check('...and it stays silent however many cues the reveal fires', play('reveal', 'reveal'), [
	null,
	null,
]);
check('a round that never cascades is silent throughout', play('reveal', 'winInfo', 'setTotalWin', 'finalWin'), [null, null, null, null]); // prettier-ignore

console.log('\n3. a stale cascade flag cannot leak into a later clear');
check('a reveal AFTER a real cascade is silent again', play('reveal', 'tumbleBoard', 'reveal'), [
	null,
	0,
	null,
]);
check(
	'an unrelated event closes the window, so a clear behind it is silent',
	play('reveal', 'tumbleBoard', 'winInfo'),
	[null, 0, null],
);
check(
	'...and the ladder resumes where it left off when the cascade continues',
	play('reveal', 'tumbleBoard', 'winInfo', 'setTotalWin', 'tumbleBoard'),
	[null, 0, null, null, 1],
);
check(
	'a cascade with no reveal in front of it still starts at the bottom rung',
	play('tumbleBoard'),
	[0],
);

console.log(
	failures === 0
		? '\nAll cascade-sound-position claims hold.\n'
		: `\n${failures} FAILED claim(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
