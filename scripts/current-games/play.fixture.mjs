// The screen-script interpreter's cue anchor (`lib/play.mjs`): an `until { cue }` counts only cues
// recorded after it starts, anchors on the cue's own frame (not the batch it noticed it in), falls
// back to a fixed frame when no cue comes, and `step { from: 'cue' }` lands on anchor + N or fails
// loudly when that frame has passed. A `hold` keeps its key down for exactly its frames. Each
// family plays its own script (an arcade game is never driven with the slot one). Played against a
// fake page that answers the probe's calls.
//
//   node scripts/current-games/play.fixture.mjs

import assert from 'node:assert/strict';

import { loadScript, scriptFor } from './lib/plan.mjs';
import { cuesSince, playScenario } from './lib/play.mjs';

/** A page whose game fires `fires` ({ cue, frame }) as the frames pass, plus the cues in `boot`. */
const fakePage = ({ fires = [], boot = [] } = {}) => {
	let frame = boot.reduce((f, c) => Math.max(f, c.frame), 0);
	const cues = [...boot];
	const calls = [];
	return {
		calls,
		get frame() {
			return frame;
		},
		evaluate: async (expr) => {
			const call = expr.replace('window.__IE_DETERMINISM__.', '');
			calls.push(call);
			if (call === 'state()')
				return { frame, cues: cues.map((c) => ({ ...c })), screens: [], idle: true, win: 0 };
			const step = /^step\((\d+),/.exec(call);
			if (!step) throw new Error(`unexpected call ${call}`);
			const target = frame + Number(step[1]);
			while (frame < target) {
				frame++;
				cues.push(...fires.filter((c) => c.frame === frame));
			}
			return frame;
		},
		key: async (type, name = 'Space') => calls.push(`${type} ${name} @${frame}`),
	};
};

const play = async (steps, page) => {
	const notes = [];
	const shots = [];
	await playScenario(
		{ steps },
		{
			page,
			draw: 'last',
			note: (n) => notes.push(n),
			capture: async (screen, s) => shots.push([screen, s.frame]),
		},
	);
	return { notes, shots, steps: page.calls.filter((c) => c.startsWith('step')).length };
};

const untilCue = (cue, maxFrames = 900) => ({
	op: 'until',
	until: { cue },
	maxFrames,
	batch: 10,
	fallback: true,
});

// Anchored on the cue's own frame: noticed at 390 (batch 10), captured at 383 + 60.
{
	const page = fakePage({ fires: [{ cue: 'transition', frame: 383 }] });
	const r = await play(
		[
			untilCue('transition'),
			{ op: 'step', frames: 60, from: 'cue' },
			{ op: 'capture', screen: 'fs-transition' },
		],
		page,
	);
	assert.deepEqual(r.shots, [['fs-transition', 443]]);
	assert.deepEqual(r.notes, ['cue `transition` at frame 383']);
	assert.equal(r.steps, 40, '39 batches of 10, one step to the anchor');
}

// Several offsets from one anchor.
{
	const page = fakePage({ fires: [{ cue: 'winShow', frame: 205 }] });
	const r = await play(
		[
			untilCue('winShow'),
			{ op: 'step', frames: 12, from: 'cue' },
			{ op: 'capture', screen: 'bigwin-intro-12' },
			{ op: 'step', frames: 48, from: 'cue' },
			{ op: 'capture', screen: 'bigwin-intro-48' },
		],
		page,
	);
	assert.deepEqual(r.shots, [
		['bigwin-intro-12', 217],
		['bigwin-intro-48', 253],
	]);
}

// A cue recorded before the op starts (at boot or tap-to-start) is not the anchor.
{
	const page = fakePage({
		boot: [{ cue: 'transition', frame: 40 }],
		fires: [{ cue: 'transition', frame: 300 }],
	});
	const r = await play(
		[
			untilCue('transition'),
			{ op: 'step', frames: 60, from: 'cue' },
			{ op: 'capture', screen: 's' },
		],
		page,
	);
	assert.deepEqual(r.shots, [['s', 360]]);
}
assert.deepEqual(
	cuesSince(
		{ frame: 10, cues: [{ cue: 'a', frame: 10 }] },
		{
			cues: [
				{ cue: 'a', frame: 9 },
				{ cue: 'a', frame: 10 },
				{ cue: 'b', frame: 10 },
				{ cue: 'c', frame: 11 },
			],
		},
	).map((c) => c.cue),
	['b', 'c'],
	'a cue at the start frame counts only past the ones already listed there',
);

// No cue: the fallback at maxFrames is the anchor, 90 batches of 10, and the note says so.
{
	const page = fakePage({ boot: [{ cue: 'transition', frame: 40 }] });
	const r = await play(
		[
			untilCue('transition'),
			{ op: 'step', frames: 60, from: 'cue' },
			{ op: 'capture', screen: 's' },
		],
		page,
	);
	assert.deepEqual(r.shots, [['s', 40 + 900 + 60]]);
	assert.deepEqual(r.notes, ['cue `transition` not fired: fallback at frame 940']);
	assert.equal(r.steps, 91);
}

// An offset smaller than the overshoot fails loudly instead of capturing a later frame.
await assert.rejects(
	play(
		[untilCue('winShow'), { op: 'step', frames: 2, from: 'cue' }],
		fakePage({ fires: [{ cue: 'winShow', frame: 101 }] }),
	),
	/cue frame 101 \+ 2 is 7 frame\(s\) behind/,
);
await assert.rejects(
	play([{ op: 'step', frames: 2, from: 'cue' }], fakePage()),
	/needs a `cue` until before it/,
);

// A held key goes down, stays down for its frames, and comes up.
{
	const page = fakePage();
	await play(
		[
			{ op: 'step', frames: 5 },
			{ op: 'hold', key: 'ArrowLeft', frames: 30 },
		],
		page,
	);
	assert.deepEqual(
		page.calls.filter((c) => / @/.test(c)),
		['keyDown ArrowLeft @5', 'keyUp ArrowLeft @35'],
	);
}

for (const [gameType, script] of [
	['arcade', 'arcade'],
	['match3', 'match3'],
	['lines', 'lines'],
]) {
	assert.equal(scriptFor(gameType), script, `${gameType} plays the ${script} script`);
	assert.equal(loadScript(script).gameType, script);
}

console.log('current-games play fixture: ok');
