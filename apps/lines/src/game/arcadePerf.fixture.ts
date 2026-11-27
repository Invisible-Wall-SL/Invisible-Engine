/**
 * Offline fixture for the arcade probe's phases (`arcadePerf.ts`) — run with:
 *   pnpm check:all --only arcadePerf
 *
 * Pins: a frame is `lobby` when no tick named a phase, else the phase the tick named (`play`,
 * `spectate`); a level's mount opens `loading`, which lasts until the first ticked frame and
 * {@link LOADING_TAIL_MS} after it, then hands back to the tick's phase; a second mount opens it
 * again; the room's phase is the frame's state; the counts clear on read; the socket tally keeps
 * bytes by kind and the steps run.
 */

import { LOADING_TAIL_MS, arcadePerf, takeArcadeFrame } from './arcadePerf.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

arcadePerf.on = true;

console.log('phases without a mount');
check('no tick is lobby', takeArcadeFrame(100).phase === 'lobby');
arcadePerf.phase = 'play';
check('a tick names its phase', takeArcadeFrame(116).phase === 'play');
arcadePerf.phase = 'spectate';
arcadePerf.room = 'running';
const spectating = takeArcadeFrame(132);
check(
	'spectate, with the room phase as state',
	spectating.phase === 'spectate' && spectating.state === 'running',
);
check('the tick phase clears on read', takeArcadeFrame(148).phase === 'lobby');
arcadePerf.room = undefined;

console.log('loading');
arcadePerf.mount();
check('a mount with no tick yet is loading', takeArcadeFrame(1000).phase === 'loading');
arcadePerf.phase = 'lobby';
check('the first ticked frame is still loading', takeArcadeFrame(1016).phase === 'loading');
arcadePerf.phase = 'lobby';
check('and the second after it', takeArcadeFrame(1016 + LOADING_TAIL_MS - 1).phase === 'loading');
arcadePerf.phase = 'play';
check(
	'then the tick’s own phase',
	takeArcadeFrame(1016 + LOADING_TAIL_MS + 1).phase === 'play' &&
		arcadePerf.mountedAt === undefined,
);
arcadePerf.phase = 'lobby';
check('…and stays there', takeArcadeFrame(5000).phase === 'lobby');
arcadePerf.mount();
arcadePerf.phase = 'play';
check('a second mount opens loading again', takeArcadeFrame(6000).phase === 'loading');

console.log('counts and the socket tally');
arcadePerf.counts.simSteps = 3;
const frame = takeArcadeFrame(6016);
check(
	'a read takes the counts and clears them',
	frame.work.simSteps === 3 && frame.work.simCatchUp === 1 && arcadePerf.counts.simSteps === 0,
);
arcadePerf.message(false, 500, true, 'patch');
arcadePerf.message(false, 40, false, 'events');
arcadePerf.message(true, 10, false, 'input');
arcadePerf.steps(4);
const socket = arcadePerf.socket;
check(
	'bytes by kind in and out, and the fixed steps',
	socket?.inByCode?.patch?.bytes === 500 &&
		socket.inByCode.events?.messages === 1 &&
		socket.outByCode?.input?.bytes === 10 &&
		socket.steps === 4 &&
		socket.states === 1,
	JSON.stringify(socket),
);

if (failures) throw new Error(`arcadePerf.fixture: ${failures} check(s) failed`);
console.log('\narcadePerf.fixture: all ok');
