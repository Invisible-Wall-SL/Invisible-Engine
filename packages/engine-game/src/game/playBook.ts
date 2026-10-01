import { stateBet, stateUi } from 'state-shared';
import { createPlayBookUtils, type BookEventHandlerMap } from 'utils-book';
import { sequence } from 'utils-shared/sequence';
import { roundSkip } from 'utils-shared/skipToken';

import type {
	GameBet as Bet,
	GameBookEvent as BookEvent,
	GameBookEventContext,
	GameBookEventOfType as BookEventOfType,
} from './bookEvents';
import type { WinLevelData } from './winLevelMap';
import { HOLD_AND_WIN_SNAPSHOT_EVENTS } from './holdAndWin';
import { MODE_EVENT_TYPES } from './modeEvents';
import type { ModeController } from './modeController.svelte';

/**
 * What a game hands the play pipeline. Every entry is a presentation hook the ROUND SEAM calls
 * whichever path drives an event (coded, v1 flow, v2 flow) — named exactly as the game names it, so
 * the composition root is a plain list of the game's own functions. Each is typed by what the seam
 * consumes, not by the module it comes from.
 */
export type PlayBookDeps<TWins> = {
	/** The coded dispatch — the game's mechanic, run when no flow owns the event. */
	bookEventHandlerMap: BookEventHandlerMap<BookEvent, GameBookEventContext>;
	getFlowInterpreter: () =>
		| { dispatchBookEvent: (bookEvent: BookEvent, context: GameBookEventContext) => Promise<void> }
		| undefined;
	getFlowV2: () =>
		| {
				ownsEvent: (eventType: string) => boolean;
				dispatch: (
					eventName: string,
					payload: Record<string, unknown>,
					context?: Record<string, unknown>,
				) => Promise<void>;
		  }
		| undefined;
	eventEmitter: { broadcast: (event: { type: 'stopButtonEnable' }) => void };

	/** The slam policy around one event's whole dispatch. */
	runBookEventPresentation: (
		bookEventType: string,
		dispatch: () => Promise<void>,
		opensCelebration?: boolean,
	) => Promise<void>;
	startsCelebration: (bookEvent: BookEvent) => boolean;

	/** The idle win-symbol cycle and the per-spin pop. */
	recordWinCycleWins: (bookEvent: BookEvent) => void;
	forgetWinCycleWins: () => void;
	stopWinCycle: () => void;
	startWinCycle: () => Promise<void>;
	explodeSpinWinners: () => Promise<void>;
	explodeWinnersBeforeBoardChange: (bookEvent: BookEvent) => Promise<void>;

	/** The all-at-once win lines. */
	bakedWinLineConfig: () => { line: { allAtOnce: boolean } };
	winsOnThisBoard: (bookEvent: BookEventOfType<'winInfo'>, bookEvents: BookEvent[]) => TWins;
	showAllWinLines: (wins: TWins) => Promise<unknown>;

	/** The big-win run-up. */
	activeWinLevelData: (winLevel: number) => WinLevelData | undefined;
	cueBigWinCountUp: (args: {
		amount: number;
		winLevelData: WinLevelData | undefined;
	}) => Promise<void>;

	/** Free spins: the flow path's award line and the between-spins hold. */
	setPendingScatterAwardFs: (totalFs: number | undefined) => void;
	holdAfterBigWin: (bookEvent: BookEvent, bookEvents: BookEvent[]) => Promise<void>;
	clearSpinHold: () => void;

	/** The tumble-explosion sound ladder. */
	trackCascadeStep: (bookEvent: BookEvent) => void;

	/**
	 * The game's MODE STACK (`modeController.svelte.ts`). Optional: a game without one plays exactly
	 * as before. Moved here, at the seam, so a flow-owned `freeSpinTrigger` enters free spins exactly
	 * as the coded one does.
	 */
	modes?: Pick<ModeController, 'before' | 'after' | 'reset' | 'restore'>;
};

/**
 * THE PLAY PIPELINE — how a round is played, for every game type: which seams every book event
 * crosses, which dispatch path presents it, and what a round does before and after its book.
 *
 * It reads book-event arms (`winInfo.totalWin`, `setWin.{amount,winLevel}`, …) off the game's own
 * union, registered through `BookEventRegistry` (`bookEvents.ts`), so nothing is cast.
 */
export function createPlayBook<TWins>(deps: PlayBookDeps<TWins>) {
	const {
		bookEventHandlerMap,
		getFlowInterpreter,
		getFlowV2,
		eventEmitter,
		runBookEventPresentation,
		startsCelebration,
		recordWinCycleWins,
		forgetWinCycleWins,
		stopWinCycle,
		startWinCycle,
		explodeSpinWinners,
		explodeWinnersBeforeBoardChange,
		bakedWinLineConfig,
		winsOnThisBoard,
		showAllWinLines,
		activeWinLevelData,
		cueBigWinCountUp,
		setPendingScatterAwardFs,
		holdAfterBigWin,
		clearSpinHold,
		trackCascadeStep,
		modes,
	} = deps;

	const coded = createPlayBookUtils({ bookEventHandlerMap });

	/**
	 * GAME MODES around one event's presentation, on every path. A resume snapshot rebuilds the stack
	 * silently (no intro replays). An event that ENTERS a mode opens it first — the event belongs to
	 * the mode it opens, so the active-mode-first flow dispatch already sees that mode — and an event
	 * that EXITS one is that mode's last beat, so the mode closes once the event has been presented.
	 * No mode controller, or an event that moves no mode ⇒ just the presentation.
	 */
	const withModes = async (bookEvent: BookEvent, present: () => Promise<void>): Promise<void> => {
		if (!modes) return present();
		if (bookEvent.type === 'createBonusSnapshot') {
			modes.restore((bookEvent as BookEventOfType<'createBonusSnapshot'>).bookEvents);
		}
		await modes.before(bookEvent);
		await present();
		await modes.after(bookEvent);
	};

	/**
	 * Play one book event. When the Invisible Flow interpreter is active (a FlowDoc is authored)
	 * it OWNS dispatch — it runs the event's authored choreography or falls through to the coded
	 * `bookEventHandlerMap` for an un-authored event, AND lets the macro graph take a `bookEvent`
	 * transition (design doc §6.1, §7). ABSENT interpreter (no FlowDoc — the default) ⇒ the coded
	 * `playBookEvent` runs unchanged.
	 */
	const playBookEvent = (
		bookEvent: BookEvent,
		context: { bookEvents: BookEvent[] },
	): Promise<void> =>
		// The UNSKIPPABLE carve-out is opened HERE, around the whole dispatch, so it covers whichever of
		// the three paths below drives the event (coded / v1 flow / v2 flow) — the book reveal and the
		// free-spin intro run to completion under a slam on all of them. `startsCelebration` additionally
		// re-arms the slam token before a big win / free-spin outro / retrigger, so those present un-slammed
		// (the same three paths) — celebrations are never fast-forwarded.
		runBookEventPresentation(
			bookEvent.type,
			() => withModes(bookEvent, () => dispatchBookEvent(bookEvent, context)),
			startsCelebration(bookEvent),
		);

	/**
	 * THE RUNNING WIN METER — every `winInfo` moves it, not just the round's closing `setTotalWin`.
	 *
	 * A `winInfo` already carries `totalWin`: the round's payout INCLUDING this win. On the Play4Fun
	 * facade every shipped game runs on, one event is flushed per win, so that figure is a genuine
	 * running total — it climbs across a spin's several paying lines AND across every board a cascade
	 * scores (`engineFacade`'s `runningTotal` accumulates through the whole chain). Nothing consumed it:
	 * the meter was written only by `setTotalWin`, at `gameEnd`, so a five-tumble chain narrated five
	 * wins with the Win box reading 0.00 the entire time and then snapping to the total once the board
	 * had already settled. `LabelWin` tweens the value, so each step now counts up into the next.
	 *
	 * Lives at THIS seam — with `recordWinCycleWins` and the all-at-once win lines, for the same reason:
	 * a flow-owned `winInfo` never reaches the coded handler map, and the meter has to behave the same
	 * on a flow-driven game as on a coded one.
	 *
	 * FORWARD ONLY. `playBet` zeroes the meter at the start of every round, so within a round the total
	 * can only grow; a book that omits `totalWin` (or reports a stale smaller one) would otherwise walk
	 * the meter backwards mid-celebration. `setTotalWin` still assigns the closing figure unconditionally
	 * — it is the authority on what the round paid, and by then this has usually already reached it.
	 */
	const advanceWinMeter = (bookEvent: BookEvent): void => {
		if (bookEvent.type !== 'winInfo') return;
		const total = bookEvent.totalWin;
		if (!Number.isFinite(total) || total <= stateBet.winBookEventAmount) return;
		stateBet.winBookEventAmount = total;
	};

	const dispatchBookEvent = async (
		bookEvent: BookEvent,
		context: { bookEvents: BookEvent[] },
	): Promise<void> => {
		// Recorded HERE, ahead of dispatch, so the idle win-symbol cycle sees every spin's wins whichever
		// path presents them — a flow-owned `winInfo` never reaches the coded handler map.
		recordWinCycleWins(bookEvent);

		// Same seam, same reason: the WIN METER climbs with every win, instead of sitting at zero for
		// the whole round and jumping once at `setTotalWin`.
		advanceWinMeter(bookEvent);

		// Same seam, same reason: which rung of the tumble-explosion ladder the next cascade pop plays
		// (and whether the pop is a cascade at all, rather than the board CLEAR that shares its cue).
		// A flow-owned `tumbleBoard` never reaches the coded handler map either, and a flow-driven game
		// has to sound the same as a coded one.
		trackCascadeStep(bookEvent);

		// ALL-AT-ONCE WIN LINES (Symbols State Machine → "Show all win lines at once"): draw EVERY paying
		// line of this event together, up front, and leave them on screen. Placed HERE — the one seam all
		// three dispatch paths cross, the same reason `recordWinCycleWins` lives here — because a
		// flow-owned `winInfo` never reaches the coded handler map, and this mode has to look the same on
		// a flow-driven game as on a coded one. The per-win draws downstream stand down in this mode (the
		// coded handler skips them, the `showWinLine` effect returns early), and nothing hides the set
		// until the next spin. Awaited so the lines are up before the symbols celebrate — the beat order
		// the one-at-a-time narration plays. Off (the default) this is a single boolean read.
		if (bookEvent.type === 'winInfo' && bakedWinLineConfig().line.allAtOnce) {
			await showAllWinLines(winsOnThisBoard(bookEvent, context.bookEvents));
		}

		// BIG-WIN RUN-UP (Symbols State Machine → "Count up to cue the big win"): count the amount text
		// up to the tier threshold BEFORE anything shows the overlay, then hand the number over. Placed
		// HERE for the same reason as the all-at-once draw above — it is the one seam all three dispatch
		// paths cross. It cannot live in the coded `setWin` handler (a flow that OWNS `setWin` never
		// reaches it) nor in the v2 `winShow` effect (the authored choreography broadcasts `winShow`
		// BEFORE that effect, so the overlay is already up, and wires no `amount`). Off ⇒ one boolean
		// read. Awaited: the run-up IS the beat before the celebration.
		if (bookEvent.type === 'setWin') {
			await cueBigWinCountUp({
				amount: bookEvent.amount,
				winLevelData: activeWinLevelData(bookEvent.winLevel),
			});
		}

		// Capture the retrigger's extra-spins count for the `freeSpinsAdded` / `freeSpinsAddedText` value
		// sources — universally (ahead of dispatch) so it's populated whichever path presents the retrigger:
		// a flow-owned `freeSpinRetrigger` suppresses the coded handler, so the coded handler alone can't own
		// this. Purely a display value (not load-bearing game state), so a single set point here is safe.
		if (bookEvent.type === 'freeSpinRetrigger') stateUi.freeSpinsAdded = bookEvent.extraFs;

		// Free-spin AWARD line, flow path. When a v2 flow drives the trigger it mounts the intro CONTAINER
		// on `freeSpinTrigger` (a screen takeover), so the award can't be a toast fired there — it must ride
		// the scatter's `winInfo` toast on the base board (`showWinInfoMessage`). That `winInfo` arrives
		// BEFORE `freeSpinTrigger`, so look the awarded count up from the book HERE and stash it for the
		// upcoming `winInfo` dispatch; clear it for every other event so a plain zero-pay entry stays
		// suppressed. The coded (non-flow) path announces the award from its `freeSpinTrigger` handler
		// instead, so this only feeds the flow-owned branch.
		if (bookEvent.type === 'winInfo') {
			const trigger = context.bookEvents.find(
				(e): e is BookEventOfType<'freeSpinTrigger'> => e.type === 'freeSpinTrigger',
			);
			setPendingScatterAwardFs(trigger?.totalFs);
		} else {
			setPendingScatterAwardFs(undefined);
		}

		// Invisible Flow v2 — EVENT OWNERSHIP (the incremental v1→v2 migration mechanism). When a v2 flow
		// authors this event (`ownsEvent`), v2 drives it ALONE and the coded/v1 twin is SUPPRESSED — so a
		// migrated event runs through the flow with NO doubling. Un-owned events fall through unchanged to
		// the v1 interpreter (if a FlowDoc is authored) or the coded handler map (parity). This lets the
		// game hand events to v2 one at a time; with no v2 doc, `getFlowV2()` is undefined ⇒ byte-parity.
		const v2 = getFlowV2();
		if (v2?.ownsEvent(bookEvent.type)) {
			// Confirm which path drove the event — v2 is a PARITY repro of v1 so it looks identical on
			// screen; this console line is how you verify v2 (not v1/coded) actually handled it.
			if (import.meta.env.DEV) console.info(`[flow-v2] drove '${bookEvent.type}'`);
			// Pass the whole event as the trigger + the surrounding book list as `$context.bookEvents`
			// (the `reveal` mechanic reads it for the bonus-game check), matching the coded handler's args.
			await v2.dispatch(bookEvent.type, bookEvent as unknown as Record<string, unknown>, {
				bookEvents: context.bookEvents,
			});
			return;
		}

		const interpreter = getFlowInterpreter();
		if (interpreter) {
			await interpreter.dispatchBookEvent(bookEvent, context);
		} else {
			await coded.playBookEvent(bookEvent, context);
		}
	};

	const playBookEvents = async (
		bookEvents: BookEvent[],
		context?: { bookEvents?: BookEvent[] },
	): Promise<void> => {
		// v1 OR v2 flow active ⇒ run the SAME serial `sequence()` the coded path uses, routing each event
		// through `playBookEvent` (which hands an event to v2 when it OWNS it, else v1/coded — see above).
		// Neither active ⇒ the coded dispatch, event by event (`coded.playBookEvent` is exactly what
		// `coded.playBookEvents` loops over, so that branch stays byte-identical to deferring to it).
		//
		// The BETWEEN-SPINS HOLD hangs off both branches, after the event's presentation is fully awaited:
		// a big win mid-feature parks the book on its winning board until the player presses SPIN
		// (`freeSpinHold.ts`). Off by default ⇒ both branches are byte-identical to before.
		//
		// THE PER-SPIN POP (Invisible Symbols → "Winning symbols explode") hangs off the TOP of both
		// branches, for the mirror of the hold's reason: a spin's winners have to blow up while the board
		// they were scored on is still the board on screen, i.e. immediately BEFORE the `reveal` /
		// `tumbleBoard` that replaces it. Here rather than at `dispatchBookEvent` because this is the one
		// seam BOTH dispatch branches cross. `playBet`'s `finally` still pops the book's LAST spin, which
		// no board change follows. A no-op for every other event, and one boolean read with the switch
		// off ⇒ both branches are byte-identical to before.
		if (getFlowInterpreter() || getFlowV2()) {
			await sequence(bookEvents, async (bookEvent) => {
				await explodeWinnersBeforeBoardChange(bookEvent);
				await playBookEvent(bookEvent, { ...context, bookEvents });
				await holdAfterBigWin(bookEvent, bookEvents);
			});
			return;
		}
		await sequence(bookEvents, async (bookEvent) => {
			await explodeWinnersBeforeBoardChange(bookEvent);
			await withModes(bookEvent, () => coded.playBookEvent(bookEvent, { ...context, bookEvents }));
			await holdAfterBigWin(bookEvent, bookEvents);
		});
	};

	const playBet = async (bet: Bet) => {
		// The previous round's idle symbol replay is the FIRST thing a new bet ends — before the reels
		// move, so nothing keeps re-lighting cells the spin is about to overwrite.
		stopWinCycle();
		// …and the wins it replayed are dropped with it, so the per-spin pop at the top of
		// `playBookEvents` cannot open this round by exploding the PREVIOUS one's winning set.
		forgetWinCycleWins();
		// The slam token is scoped to the ROUND — re-armed here and nowhere else (owner direction). A
		// bonus book is ONE round, so a single press fast-forwards every remaining free spin in it
		// straight to the final total, rather than costing the player a press per spin.
		roundSkip.reset();
		stateBet.winBookEventAmount = 0;
		// Every round starts at the base game; a resumed one rebuilds its stack from the snapshot.
		modes?.reset();
		try {
			await playBookEvents(bet.state);
		} finally {
			// ALWAYS re-enable, even if a handler threw: `stopButtonEnable` is what clears the
			// non-persistent turbo `stopButtonClick` set (`ButtonTurbo`). Leaving it unsent on the
			// error path stuck turbo on for the rest of the session. The token is cleared here too so
			// an aborted round cannot leave the board's slam checks reading a stale trip.
			roundSkip.reset();
			// Belt-and-braces: clear the unskippable-presentation button lock. `runBookEventPresentation`
			// balances it with try/finally, so it is already false here on every normal path — but a
			// STUCK-true lock would leave the spin button permanently inert (game unplayable), so force it
			// off at round end where a stale trip is likewise cleared.
			stateUi.unskippablePresentationActive = false;
			// Same belt-and-braces reasoning: a between-spins hold left standing by a handler that threw
			// would leave the button reading SPIN with no book left to resume (`freeSpinHold.ts`).
			clearSpinHold();
			eventEmitter.broadcast({ type: 'stopButtonEnable' });
			// THE POP (Invisible Symbols → "Winning symbols explode"), for the book's LAST spin — the one
			// no `reveal` / `tumbleBoard` follows, so the per-spin seam at the top of `playBookEvents`
			// never reaches it. Every EARLIER spin has already popped there, against its own board; here
			// the winning set that is left blows up TOGETHER, once every win has narrated. In the
			// `finally`, so a slammed or aborted round reaches it too; a spin that paid nothing, or a book
			// whose last spin already popped, broadcasts nothing.
			//
			// AWAITED, and awaited BEFORE the replay starts: the cycle skips cells the pop took off, so
			// starting it first would light seats that are about to vanish. Off (the default) this is one
			// boolean read.
			await explodeSpinWinners();
			// The round is presented; keep its winning SYMBOLS animating on the resting board until the
			// next bet. Deliberately NOT awaited — it runs until `stopWinCycle` above ends it.
			void startWinCycle();
		}
	};

	const BOOK_EVENT_TYPES_TO_RESERVE_FOR_SNAPSHOT: string[] = [
		'updateGlobalMult',
		'freeSpinTrigger',
		'updateFreeSpin',
		'setTotalWin',
		...HOLD_AND_WIN_SNAPSHOT_EVENTS,
		// The mode events ride along so a resume rebuilds the WHOLE stack and queue (design §4.5), not
		// only free spins. The coded `createBonusSnapshot` handler reads only what it always read.
		...MODE_EVENT_TYPES.filter(
			(type) => type !== 'freeSpinTrigger' && type !== 'holdAndWinEnd',
		),
	];

	const convertTorResumableBet = (betToResume: Bet) => {
		const resumingIndex = Number(betToResume.event);
		const bookEventsBeforeResume = betToResume.state.filter(
			(_, eventIndex) => eventIndex < resumingIndex,
		);
		const bookEventsAfterResume = betToResume.state.filter(
			(_, eventIndex) => eventIndex >= resumingIndex,
		);

		const bookEventToCreateSnapshot: BookEventOfType<'createBonusSnapshot'> = {
			index: 0,
			type: 'createBonusSnapshot',
			bookEvents: bookEventsBeforeResume.filter((bookEvent) =>
				BOOK_EVENT_TYPES_TO_RESERVE_FOR_SNAPSHOT.includes(bookEvent.type),
			),
		};

		const stateToResume = [bookEventToCreateSnapshot, ...bookEventsAfterResume];

		return { ...betToResume, state: stateToResume };
	};

	return { playBookEvent, playBookEvents, playBet, convertTorResumableBet };
}
