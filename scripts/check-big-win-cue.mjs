/**
 * Placement guard for the BIG-WIN RUN-UP (Invisible Symbols State Machine → Win amount text →
 * "Count up to cue the big win").
 *
 * WHY THIS EXISTS — the feature shipped once already and was dead on the only path that matters.
 * The cue was invoked from the coded `setWin` handler and from the v2 `winShow` EFFECT, and both
 * are wrong for a FLOW-DRIVEN game:
 *
 *   - a v2 flow that OWNS `setWin` never reaches `bookEventHandlerMap`, so the coded hook never ran;
 *   - the authored choreography is `seq(broadcast('winShow'), effect('winShow', …), …)`, so by the
 *     time the effect runs the overlay is already on screen — and it wires no `amount`, so the cue
 *     self-gated to a no-op anyway.
 *
 * The fix is placement, not logic: the cue belongs at `dispatchBookEvent` in `game/utils.ts`, the
 * ONE seam every dispatch path crosses (the same seam `showAllWinLines` and `recordWinCycleWins`
 * live on, for the same reason). These assertions pin that, because nothing else would notice the
 * cue going quiet — a silent no-op looks exactly like "the author didn't turn it on".
 *
 * Run:  node scripts/check-big-win-cue.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lfReaderFrom } from './lib/read-lf.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = lfReaderFrom(root);

const utils = read('apps/lines/src/game/utils.ts');
const handlers = read('apps/lines/src/game/bookEventHandlerMap.ts');
const effects = read('apps/lines/src/game/flowEffects.ts');
const gate = read('apps/lines/src/components/WinGate.svelte');
const provider = read('packages/components-pixi/src/components/WinCountUpProvider.svelte');

let failures = 0;
let checks = 0;
const check = (ok, what, why) => {
	checks += 1;
	if (ok) {
		console.log(`  ok   ${what}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL ${what}\n       ${why}`);
};

console.log('\nbig-win run-up — placement\n');

// The seam. `dispatchBookEvent` is the only function in this file that fans out to all three
// dispatch paths, so the call has to be inside it and it has to be awaited.
const seam = utils.slice(utils.indexOf('const dispatchBookEvent'));
check(
	/if \(bookEvent\.type === 'setWin'\)[\s\S]{0,200}await cueBigWinCountUp\(/.test(seam),
	'the cue is awaited at the dispatchBookEvent seam',
	"expected `if (bookEvent.type === 'setWin') { await cueBigWinCountUp({…}) }` in " +
		'apps/lines/src/game/utils.ts — a flow that owns `setWin` never reaches the coded handler.',
);

// One caller, or the coded path fires it twice.
const callers = [utils, handlers, effects].filter((src) => /\bawait cueBigWinCountUp\(/.test(src));
check(
	callers.length === 1 && callers[0] === utils,
	'exactly one caller, and it is the seam',
	'the cue must be invoked from utils.ts ONLY — a second call site double-fires the run-up on ' +
		'whichever path reaches both.',
);

check(
	!/cueBigWinCountUp/.test(handlers),
	'the coded setWin handler does not invoke the cue',
	'bookEventHandlerMap.ts must not call it — that path is skipped entirely under a v2 flow that ' +
		'owns `setWin`.',
);

const winShowEffect = effects.slice(
	effects.indexOf('\twinShow: '),
	effects.indexOf('\twinUpdate: '),
);
check(
	winShowEffect.length > 0 && !/cueBigWinCountUp/.test(winShowEffect),
	'the v2 winShow effect does not invoke the cue',
	'the authored choreography broadcasts `winShow` BEFORE this effect, so a cue here runs with the ' +
		'overlay already on screen.',
);

console.log('\nbig-win run-up — the handoff\n');

// The whole point of the run-up: the overlay CONTINUES the number, it does not restart it.
check(
	/winState\.cueHandoffAmount = target;/.test(effects),
	'the cue publishes where it stopped',
	'`cueBigWinCountUp` must set `winState.cueHandoffAmount` so the overlay can continue from it.',
);
check(
	/startFrom=\{winState\.cueHandoffAmount\}/.test(gate),
	'WinGate seeds the count-up from the handoff',
	'`<WinCountUpProvider startFrom={winState.cueHandoffAmount}>` — without it the overlay restarts ' +
		'the count at zero, which is the bug the owner reported.',
);
check(
	/startFrom\?: number;/.test(provider) &&
		/new Tween\(Math\.max\(0, props\.startFrom \?\? 0\)\)/.test(provider),
	'the provider honours startFrom',
	'WinCountUpProvider must seed its tween at `startFrom` (default 0 ⇒ byte-identical).',
);

// The clear has to be on `winHide`. On `winShow` it would wipe the value the cue just handed over,
// because the cue runs BEFORE the overlay shows.
const winShowHandler = gate.slice(
	gate.indexOf('\t\twinShow: () => {'),
	gate.indexOf('\t\twinHide: () => {'),
);
check(
	winShowHandler.length > 0 && !/cueHandoffAmount/.test(winShowHandler),
	'winShow does NOT clear the handoff',
	'the cue runs before `winShow`, so clearing there throws away the number this win was handed.',
);
check(
	/winHide: \(\) => \{[\s\S]{0,600}winState\.cueHandoffAmount = 0;/.test(gate),
	'winHide clears the handoff',
	'without the reset a later non-big win would start its count at the previous big win threshold.',
);

console.log('\nwin overlay — park until pressed\n');

const vocab = read('packages/engine-flow-v2/src/reference/standardVocab.ts');
const winEvent = read('apps/lines/src/components/Win.svelte');

// The chain is: /flow inspector -> node payload -> flow effect -> emitter event -> WinGate.
// Each link is asserted, because a missing one fails silently.
check(
	/name: 'waitForPress'/.test(vocab),
	'the /flow winUpdate node offers waitForPress',
	'standardVocab.ts must declare the param, or the author has no box to tick.',
);
check(
	/waitForPress\?: boolean;/.test(winEvent),
	'the winUpdate emitter event carries waitForPress',
	'Win.svelte declares the event shape the gate reads.',
);
check(
	/waitForPress: payload\.waitForPress === true,/.test(effects),
	'the flow effect forwards waitForPress',
	'flowEffects.ts must pass the authored value into the broadcast.',
);
check(
	/waitForPress = emitterEvent\.waitForPress \?\? false;/.test(gate),
	'WinGate reads waitForPress off the event',
	"without this the gate never sees the author's intent.",
);

// Arming. The two guards are load-bearing: a slam means the player asked to move on, and an
// authored container that already holds the beat must not get a second tap surface under it.
check(
	/if \(waitForPress && !roundSkip\.isSkipped\(\) && !winState\.flowHoldsPresentation\)/.test(gate),
	'the park arms only when it should',
	'arming must be gated on the switch, on NOT being slammed, and on the flow not already holding.',
);
check(
	/if \(winState\.awaitingDismiss && waitForPress\) await waitForDismissPress\(\);/.test(gate),
	'concludePresentation holds for the press',
	'the conclude must wait, or the overlay closes itself exactly as before.',
);
check(
	/winState\.dismissPressed = true;/.test(gate) &&
		/if \(winState\.dismissPressed\) return Promise\.resolve\(\);/.test(gate),
	'the press is LATCHED, and the wait honours the latch',
	'a press that lands before the wait is wired would otherwise hold the round for the whole cap.',
);
check(
	/const PARK_HOLD_CAP_MS = /.test(gate) && /waitForTimeout\(PARK_HOLD_CAP_MS\)/.test(gate),
	'the park is bounded',
	'the spin button is locked during the celebration, so an abandoned parked win must still release.',
);

const state = read('apps/lines/src/game/winState.svelte.ts');

// PAIRING. Every `PressToContinue` fires its OWN Space hotkey directly, but the POINTER is
// routed by `<ContinuePressMask>` to the TOP registered press alone. So when an authored
// tapToContinue outranks the gate's dismiss, a click reaches only the authored tap — and unless
// that tap also releases the park, the mouse looks dead while the keyboard still works.
check(
	/winState\.dismissPressed = true;/.test(state),
	'the authored tap releases a PARKED win too',
	'releaseWinDismissHold() must set `dismissPressed`, not just `escalationOutroComplete` — ' +
		'otherwise the pointer and the Space key disagree about whether the win was dismissed.',
);

console.log(
	failures === 0 ? `\nbig-win cue: OK (${checks} checks)\n` : `\nbig-win cue: ${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
