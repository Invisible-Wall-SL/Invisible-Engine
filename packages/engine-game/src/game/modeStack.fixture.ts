/**
 * Offline fixture for the MODE STACK (`docs/design/hold-and-win.md` §4.5) — run with node:
 *   node --experimental-strip-types packages/engine-game/src/game/modeStack.fixture.ts
 *
 * Claims:
 *  1. Nest plays now and hands back to the mode underneath; queue waits for base.
 *  2. Back at base with a queue, the next queued mode starts; `allFinished` only when the stack AND
 *     the queue are empty.
 *  3. Two triggers of one mode merge into one entry, wherever it is (on the stack or queued).
 *  4. An exit for a mode that is not there is a no-op (a resume starting mid-feature), and the base
 *     game is never pushed nor popped.
 *  5. The free-spin events ARE `modeEnter freeSpins` / `modeExit freeSpins` (aliases), flagged as
 *     owning their own game-type write; the Hold and Win pair carries mode fields; unrelated events
 *     do not move the stack.
 *  6. A restore rebuilds the stack from the kept events with no transitions.
 */

import {
	activeModeId,
	emptyModeStack,
	enterMode,
	exitMode,
	restoreModes,
	type ModeStackState,
	type ModeTransition,
} from './modeStack.ts';
import { modeOpOf } from './modeEvents.ts';

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

const kinds = (transitions: ModeTransition[]) =>
	transitions.map((t) => ('mode' in t ? `${t.kind}:${t.mode.id}` : t.kind));
const ids = (s: ModeStackState) => ({
	stack: s.stack.map((e) => e.id),
	queue: s.queue.map((e) => e.id),
});

console.log('\n1. nest and queue');
let s = emptyModeStack();
check('an empty stack is the base game', activeModeId(s), 'basegame');
let step = enterMode(s, 'freeSpins');
check('enter from base', kinds(step.transitions), ['enter:freeSpins']);
check('...from the base game', (step.transitions[0] as { from: string }).from, 'basegame');
s = step.state;
step = enterMode(s, 'holdAndWin', { policy: 'nest', cause: 'count' });
check('nest plays now', kinds(step.transitions), ['enter:holdAndWin']);
s = step.state;
check('the nested mode is on screen', activeModeId(s), 'holdAndWin');
step = exitMode(s, 'holdAndWin', { total: 12 });
check('exiting the nested mode resumes the one below', kinds(step.transitions), [
	'exit:holdAndWin',
	'resume:freeSpins',
]);
check('...carrying the total', (step.transitions[0] as { total?: number }).total, 12);
s = step.state;

step = enterMode(s, 'wheel', { policy: 'queue' });
check('queue waits while a mode plays', kinds(step.transitions), ['queued:wheel']);
s = step.state;
check('...so free spins are still on screen', activeModeId(s), 'freeSpins');
check('queue at base starts at once', kinds(enterMode(emptyModeStack(), 'wheel', { policy: 'queue' }).transitions), ['enter:wheel']);

console.log('\n2. back at base, the queue drains, then everything has finished');
s = enterMode(s, 'holdAndWin', { policy: 'queue' }).state;
check('two queued in order', ids(s), { stack: ['freeSpins'], queue: ['wheel', 'holdAndWin'] });
step = exitMode(s, 'freeSpins');
check('exit to base pops the first queued', kinds(step.transitions), ['exit:freeSpins', 'enter:wheel']);
s = step.state;
step = exitMode(s);
check('an unnamed exit closes the mode on screen', kinds(step.transitions), ['exit:wheel', 'enter:holdAndWin']);
s = step.state;
step = exitMode(s, 'holdAndWin');
check('nothing left: all modes finished', kinds(step.transitions), ['exit:holdAndWin', 'allFinished']);
s = step.state;
check('...and the stack is the base game', ids(s), { stack: [], queue: [] });

console.log('\n3. same-mode merge');
s = enterMode(emptyModeStack(), 'holdAndWin', { cause: 'count', payload: { coins: 6 } }).state;
step = enterMode(s, 'holdAndWin', { cause: 'meter:pot1', payload: { pots: ['pot1'] } });
check('a second trigger on the stack merges', kinds(step.transitions), ['merge:holdAndWin']);
check('...keeping the first cause and both payloads', step.state.stack, [
	{ id: 'holdAndWin', payload: { coins: 6, pots: ['pot1'] }, cause: 'count' },
]);
s = enterMode(enterMode(emptyModeStack(), 'freeSpins').state, 'holdAndWin', { policy: 'queue' }).state;
step = enterMode(s, 'holdAndWin', { policy: 'queue', payload: { boost: 2 } });
check('a second trigger in the queue merges there', kinds(step.transitions), ['merge:holdAndWin']);
check('...and queues once', ids(step.state), { stack: ['freeSpins'], queue: ['holdAndWin'] });

console.log('\n4. no underflow, the base is implicit');
check('exit of an absent mode is a no-op', kinds(exitMode(emptyModeStack(), 'freeSpins').transitions), []);
check('an unnamed exit at base is a no-op', kinds(exitMode(emptyModeStack()).transitions), []);
check('the base game is never pushed', kinds(enterMode(emptyModeStack(), 'basegame').transitions), []);
step = exitMode(s, 'holdAndWin');
check('exiting a queued-only mode drops it without playing', [kinds(step.transitions), ids(step.state)], [
	[],
	{ stack: ['freeSpins'], queue: [] },
]);
s = enterMode(enterMode(emptyModeStack(), 'freeSpins').state, 'holdAndWin').state;
step = exitMode(s, 'freeSpins');
check('exiting a suspended mode removes it, the top keeps playing', [kinds(step.transitions), activeModeId(step.state)], [
	['exit:freeSpins'],
	'holdAndWin',
]);

console.log('\n5. which events move the stack');
check('freeSpinTrigger is modeEnter freeSpins', modeOpOf({ type: 'freeSpinTrigger', index: 3, totalFs: 10, positions: [] } as never), {
	op: 'enter',
	id: 'freeSpins',
	policy: 'nest',
	payload: { totalFs: 10, positions: [] },
	legacyGameType: true,
});
check('freeSpinEnd is modeExit freeSpins with its amount', modeOpOf({ type: 'freeSpinEnd', amount: 40, winLevel: 2 } as never), {
	op: 'exit',
	id: 'freeSpins',
	total: 40,
	legacyGameType: true,
});
check('modeEnter carries policy, cause and payload', modeOpOf({ type: 'modeEnter', mode: 'wheel', policy: 'queue', cause: 'luckySpin', payload: { segments: 8 } } as never), {
	op: 'enter',
	id: 'wheel',
	policy: 'queue',
	cause: 'luckySpin',
	payload: { segments: 8 },
	legacyGameType: false,
});
check('modeEnter without a mode is ignored', modeOpOf({ type: 'modeEnter' }), undefined);
check('holdAndWinTrigger defaults to the holdAndWin mode', modeOpOf({ type: 'holdAndWinTrigger', cause: 'count', respins: 3 } as never), {
	op: 'enter',
	id: 'holdAndWin',
	policy: 'nest',
	cause: 'count',
	payload: { respins: 3 },
	legacyGameType: false,
});
check('holdAndWinEnd exits it with its total', modeOpOf({ type: 'holdAndWinEnd', total: 25, coins: [] } as never), {
	op: 'exit',
	id: 'holdAndWin',
	total: 25,
	legacyGameType: false,
});
for (const type of ['reveal', 'winInfo', 'updateFreeSpin', 'freeSpinRetrigger', 'setTotalWin']) {
	check(`${type} does not move the stack`, modeOpOf({ type }), undefined);
}

console.log('\n6. restore');
const restored = restoreModes([
	{ op: 'enter', id: 'freeSpins' },
	{ op: 'enter', id: 'holdAndWin', policy: 'nest', payload: { coins: 6 } },
	{ op: 'enter', id: 'wheel', policy: 'queue' },
]);
check('the stack and queue come back in order', ids(restored), { stack: ['freeSpins', 'holdAndWin'], queue: ['wheel'] });
check('...with each mode its payload', restored.stack[1].payload, { coins: 6 });
check('an exit kept in the snapshot is replayed', ids(restoreModes([{ op: 'enter', id: 'holdAndWin' }, { op: 'exit', id: 'holdAndWin' }, { op: 'enter', id: 'freeSpins' }])), {
	stack: ['freeSpins'],
	queue: [],
});

console.log(failures === 0 ? '\nAll mode-stack assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
