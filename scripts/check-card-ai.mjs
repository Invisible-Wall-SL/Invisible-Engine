// The card AI (packages/engine-mechanics/src/cardAi.js; docs/design/card-games.md §4, C2): lethal is
// taken when it is there; the AI never makes an illegal action; each difficulty replays under a
// seed — against the committed trace in packages/engine-mechanics/fixtures/cards-ai-replay.json —
// and from its record; the AI's draws never move the match's stream and its look-ahead never reads
// it; `hard` keeps inside its `apply()` budget on a full board, at a pinned count; `normal` beats
// `easy` on seeds 1…100 with the sample decks.
//
// Run: pnpm check:card-ai            (--update rewrites the replay fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rngNext, rngSeed } from '../packages/engine-mechanics/src/board.js';
import {
	AI_DIFFICULTIES,
	AI_WEIGHT_DEFAULTS,
	MAX_LETHAL_APPLIES,
	MAX_PLAN_APPLIES,
	PLAN_DEPTH,
	PLAN_WIDTH,
	aiSettings,
	chooseAction,
	createAi,
	evaluate,
	replayMatch,
} from '../packages/engine-mechanics/src/cardAi.js';
import { apply, createMatch, legalActions } from '../packages/engine-mechanics/src/cards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'packages/engine-mechanics/fixtures');
const REPLAY_FIXTURE = join(FIXTURES, 'cards-ai-replay.json');
const SAMPLE = JSON.parse(readFileSync(join(FIXTURES, 'cards-sample.library.json'), 'utf8'));
/** The sample decks: every card of the sample library that is not a token, twice (as C1's gate). */
const DECK = SAMPLE.filter((c) => !c.token).flatMap((c) => [c.id, c.id]);
const DECKS = [DECK, DECK];
const DIFFICULTIES = ['easy', 'normal', 'hard'];

/**
 * The `hard` plan's real `apply()` counts on the two full boards below; a change to the search
 * moves them. The design's case (36 listed actions) completes well inside the budget; a hand of
 * targeted spells (95) would take 704 and is stopped at the budget.
 */
const FULL_BOARD_APPLIES = {
	designCase: { actions: 36, applies: 200 },
	worstCase: { actions: 95, applies: 600 },
};
/** The pinned score of normal against easy on seeds 1…100; a change to the AI or the rules moves it. */
const STRENGTH = { normal: 61, easy: 39 };

let passed = 0;
const failures = [];
function check(name, fn) {
	try {
		fn();
		passed++;
	} catch (error) {
		failures.push(`✗ ${name}\n    ${error.message.split('\n').join('\n    ')}`);
	}
}

const unit = (id, cost, attack, health, extra = {}) => ({
	id,
	name: id,
	type: 'unit',
	cost,
	attack,
	health,
	...extra,
});
const LIBRARY = [
	...SAMPLE,
	unit('ogre', 1, 3, 3),
	unit('wall', 1, 1, 1, { keywords: ['guard'] }),
	unit('snack', 1, 2, 1),
	unit('big', 3, 3, 3),
	unit('pup', 1, 2, 2),
	unit('hound', 2, 2, 2),
	unit('giant', 9, 9, 9),
	unit('lobber', 1, 1, 6, {
		effects: [
			{
				trigger: 'onAttack',
				verb: 'damage',
				amount: 1,
				target: { kind: 'randomEnemy', include: 'characters' },
			},
		],
	}),
];

/**
 * A match set up by hand, as C1's gate builds one: `mine` is side 0's zones (side 0 is active),
 * `theirs` side 1's. A zone lists card ids, or `{ card, ...fields }`. Units on a board arrived on
 * turn 1 and have their attack.
 */
function table({ phase = 'main', turn = 3, resource = 10, mine, theirs, seed = 'table' } = {}) {
	const { match } = createMatch({
		seed,
		decks: [[], []],
		library: LIBRARY,
		rules: { openingHand: 0 },
		first: 0,
	});
	const m = structuredClone({ ...match, library: undefined });
	m.library = match.library;
	m.phase = phase;
	m.turn = turn;
	m.nextUid = 1;
	const build = (side, spec = {}) => {
		const player = m.players[side];
		player.health = spec.health ?? 30;
		player.resource = { current: resource, max: resource };
		for (const zone of ['deck', 'hand', 'board', 'discard']) {
			player[zone] = (spec[zone] ?? []).map((entry) => {
				const { card, ...fields } = typeof entry === 'string' ? { card: entry } : entry;
				const def = m.library[card];
				const onBoard = zone === 'board';
				return {
					uid: m.nextUid++,
					cardId: card,
					owner: side,
					attack: def.attack ?? 0,
					health: def.health ?? 0,
					damage: 0,
					keywords: [...(def.keywords ?? [])],
					buffs: [],
					summonedOnTurn: onBoard ? 1 : 0,
					attacksLeft: onBoard ? 1 : 0,
					...fields,
				};
			});
		}
	};
	build(0, mine);
	build(1, theirs);
	return m;
}

/** An AI for side 0 that never makes a mistake, so a test reads the policy alone. */
function steady(difficulty, weights) {
	const ai = createAi({ seed: 'steady', side: 0, difficulty, weights });
	return { ...ai, settings: { ...ai.settings, mistakes: 0 } };
}

/** Lets the AI act until its turn is over (or the match is); every action it took, in order. */
function playTurn(ai, match) {
	const taken = [];
	const turn = match.turn;
	while (!match.result && match.turn === turn) {
		const choice = chooseAction(ai, match);
		ai = choice.ai;
		taken.push(choice.action);
		match = apply(match, choice.action).match;
	}
	return { match, taken };
}

// ---- settings ----------------------------------------------------------------------------------

check('the presets are the design table (§4.2)', () => {
	assert.deepEqual(AI_WEIGHT_DEFAULTS, {
		health: 1,
		board: 1.5,
		keyword: 0.5,
		hand: 0.7,
		win: 1000,
	});
	assert.deepEqual(
		DIFFICULTIES.map((d) => {
			const { mistakes, lethal, plan, weights } = aiSettings({ difficulty: d });
			return { mistakes, lethal, plan, board: weights.board };
		}),
		[
			{ mistakes: 0.3, lethal: false, plan: false, board: 1 },
			{ mistakes: 0.1, lethal: true, plan: false, board: 1.5 },
			{ mistakes: 0, lethal: true, plan: true, board: 1.5 },
		],
	);
	assert.deepEqual(Object.keys(AI_DIFFICULTIES), DIFFICULTIES);
	assert.equal(aiSettings().difficulty, 'normal');
	assert.deepEqual([PLAN_WIDTH, PLAN_DEPTH, MAX_PLAN_APPLIES], [4, 3, 600]);
});

check("a deck's weights override the preset's; only known weights are read", () => {
	const s = aiSettings({ difficulty: 'easy', weights: { hand: 2, board: 3, tempo: 9 } });
	assert.deepEqual(s.weights, { ...AI_WEIGHT_DEFAULTS, hand: 2, board: 3 });
	assert.throws(() => aiSettings({ difficulty: 'brutal' }), /unknown difficulty/);
	assert.throws(() => aiSettings({ weights: { hand: '2' } }), /hand must be a finite number/);
	assert.throws(() => aiSettings({ weights: { win: Infinity } }), /win must be a finite number/);
	assert.throws(() => createAi({ seed: 1, side: 2 }), /side must be 0 or 1/);
});

check('evaluate reads every term of §4.1, and units as they will be after endOfTurn', () => {
	const base = table({
		mine: { health: 20, hand: ['ogre', 'ogre'], board: [{ card: 'ogre', damage: 1 }] },
		theirs: { health: 25, hand: ['ogre'], board: ['wall', { card: 'glass-knight' }] },
	});
	// health −5; board (3+2) − (1+1 + 2+2) = −1; keywords 0 − 2; hand 2 − 1.
	assert.equal(evaluate(base, 0), -5 + 1.5 * -1 + 0.5 * -2 + 0.7 * 1);
	assert.equal(evaluate(base, 1), -evaluate(base, 0));
	assert.equal(evaluate(base, 0, { board: 0, keyword: 0 }), -5 + 0.7);
	const buffed = structuredClone({ ...base, library: undefined });
	buffed.players[0].board[0] = {
		...buffed.players[0].board[0],
		attack: 5,
		health: 5,
		buffs: [{ attack: 2, health: 2, until: 'endOfTurn' }],
	};
	assert.equal(evaluate(buffed, 0), evaluate(base, 0), 'a lapsing buff is worth nothing');
	assert.equal(
		evaluate({ ...base, result: { winner: 0, reason: 'hero' } }, 0),
		evaluate(base, 0) + 1000,
	);
	assert.equal(
		evaluate({ ...base, result: { winner: 1, reason: 'hero' } }, 0),
		evaluate(base, 0) - 1000,
	);
	assert.equal(
		evaluate({ ...base, result: { winner: 'draw', reason: 'loop' } }, 0),
		evaluate(base, 0),
	);
});

// ---- the policy ---------------------------------------------------------------------------------

/** Hero at 5, two ready 3/3s, and an enemy 2/1 the evaluation would rather trade with. */
const LETHAL_PAST_A_TRADE = () =>
	table({
		phase: 'combat',
		mine: { board: ['ogre', 'ogre'] },
		theirs: { health: 5, board: ['snack'] },
	});
const FACE_LIGHT = { health: 0.1 };

check('lethal is taken when it is there, over a trade the evaluation prefers', () => {
	const match = LETHAL_PAST_A_TRADE();
	const greedy = chooseAction(steady('easy', FACE_LIGHT), match).action;
	assert.deepEqual(greedy.target, { unit: match.players[1].board[0].uid }, 'one step trades');
	for (const difficulty of ['normal', 'hard']) {
		const { match: after, taken } = playTurn(steady(difficulty, FACE_LIGHT), match);
		assert.deepEqual(after.result, { winner: 0, reason: 'hero' }, difficulty);
		assert.ok(
			taken.every((a) => a.type === 'attack' && 'hero' in a.target),
			difficulty,
		);
	}
});

check('lethal through a guard: the guard first, then the hero', () => {
	const match = table({
		phase: 'combat',
		mine: { board: ['ogre', 'ogre', 'ogre'] },
		theirs: { health: 6, board: ['wall', 'snack'] },
	});
	const ai = steady('normal', FACE_LIGHT);
	const first = chooseAction(ai, match);
	assert.deepEqual(first.action.target, { unit: match.players[1].board[0].uid });
	assert.equal(first.applies, 3, 'the guard, then two attackers at the hero');
	const { match: after } = playTurn(ai, match);
	assert.deepEqual(after.result, { winner: 0, reason: 'hero' });
});

check('no lethal is claimed when the units cannot reach, or only a random hit would', () => {
	const short = table({
		phase: 'combat',
		mine: { board: ['ogre'] },
		theirs: { health: 4, board: [], deck: ['ogre'] },
	});
	const shortTurn = playTurn(steady('normal'), short);
	assert.equal(shortTurn.match.result, null);
	assert.equal(shortTurn.match.players[1].health, 1);
	// The lobber hits the hero for 1 and its onAttack picks one of two enemies at random: a guess.
	const random = table({
		phase: 'combat',
		mine: { board: ['lobber'] },
		theirs: { health: 2, board: ['ember-imp'] },
	});
	const choice = chooseAction(steady('normal', FACE_LIGHT), random);
	assert.equal(choice.applies, 1 + 4 + 4, 'one lethal try, then two attacks on four samples');
});

check('lethal is found past a first attacker whose attack draws', () => {
	// The lobber's onAttack hits a random enemy, so its branch is a guess; the two ogres are lethal.
	const match = table({
		phase: 'combat',
		mine: { board: ['lobber', 'ogre', 'ogre'] },
		theirs: { health: 6, board: ['pup'], deck: ['ogre', 'ogre'] },
	});
	const { match: after, taken } = playTurn(steady('normal'), match);
	assert.deepEqual(after.result, { winner: 0, reason: 'hero' });
	assert.ok(taken.every((a) => a.type === 'attack' && 'hero' in a.target));
});

check('a win in main is taken by every level that looks', () => {
	const match = table({
		mine: { hand: ['ember-imp', 'cinder-bolt'] },
		theirs: { health: 3, board: ['lantern-warden'] },
	});
	for (const difficulty of DIFFICULTIES) {
		const { action } = chooseAction(steady(difficulty), match);
		assert.deepEqual(action.target, { hero: 1 }, difficulty);
	}
});

check('hard plans a sequence: it holds the play one step would make', () => {
	// Three mana: one step plays the 3-cost 3/3 (the most board now) and has nothing left. The plan
	// sees the 1-cost and 2-cost 2/2s together are more.
	const match = table({ resource: 3, mine: { hand: ['big', 'pup', 'hound'] }, theirs: {} });
	const name = (m, a) => m.players[0].hand.find((c) => c.uid === a.uid)?.cardId;
	assert.equal(name(match, chooseAction(steady('normal'), match).action), 'big');
	const { match: after, taken } = playTurn(steady('hard'), match);
	assert.deepEqual(
		taken.filter((a) => a.type === 'play').map((a) => name(match, a)),
		['pup', 'hound'],
	);
	assert.deepEqual(
		after.players[0].board.map((u) => u.cardId),
		['pup', 'hound'],
	);
});

check('doing nothing is scored, and wins a tie', () => {
	const match = table({ mine: { hand: [] }, theirs: {} });
	for (const difficulty of DIFFICULTIES) {
		assert.deepEqual(chooseAction(steady(difficulty), match).action, { type: 'endPhase' });
	}
});

check('the AI never concedes and refuses a match it is not to move in', () => {
	const match = table({ mine: { health: 1 }, theirs: { board: ['ogre'] } });
	assert.throws(() => chooseAction(createAi({ seed: 1, side: 1 }), match), /not side 1's turn/);
	const over = { ...match, result: { winner: 1, reason: 'hero' } };
	assert.throws(() => chooseAction(createAi({ seed: 1, side: 0 }), over), /is over/);
	for (let s = 0; s < 200; s++) {
		const ai = createAi({ seed: s, side: 0, difficulty: 'easy' });
		assert.notEqual(chooseAction(ai, match).action.type, 'concede');
	}
});

// ---- legality, streams and replay -------------------------------------------------------------

/** Seeded AI-vs-AI matches, two difficulties seated by the seed's parity. */
function duel(seed, a, b) {
	const sa = seed % 2;
	return replayMatch({
		seed,
		decks: DECKS,
		library: SAMPLE,
		ai: [
			{ side: sa, difficulty: a },
			{ side: 1 - sa, difficulty: b },
		],
	});
}

check('the AI never makes an illegal action (every level, 30 seeds each)', () => {
	for (const difficulty of DIFFICULTIES) {
		for (let seed = 1; seed <= 30; seed++) {
			let match = createMatch({ seed, decks: DECKS, library: SAMPLE }).match;
			const ais = [0, 1].map((side) => createAi({ seed, side, difficulty }));
			while (!match.result) {
				const side = match.active;
				const choice = chooseAction(ais[side], match);
				ais[side] = choice.ai;
				const listed = legalActions(match).map((a) => JSON.stringify(a));
				assert.ok(
					listed.includes(JSON.stringify(choice.action)),
					`${difficulty} seed ${seed}: ${JSON.stringify(choice.action)} is not listed`,
				);
				match = apply(match, choice.action).match;
			}
		}
	}
});

check("a decision never changes the match or the AI, and moves only the AI's stream", () => {
	for (const difficulty of DIFFICULTIES) {
		let match = createMatch({ seed: 'frozen', decks: DECKS, library: SAMPLE, first: 0 }).match;
		const ais = [0, 1].map((side) => createAi({ seed: 'frozen', side, difficulty }));
		let mistakes = 0;
		while (!match.result) {
			const side = match.active;
			const before = JSON.stringify({ ...match, library: undefined });
			const aiBefore = JSON.stringify(ais[side]);
			deepFreeze(match);
			const choice = chooseAction(ais[side], match);
			assert.equal(JSON.stringify({ ...match, library: undefined }), before);
			assert.equal(JSON.stringify(ais[side]), aiBefore);
			const roll = rngNext(ais[side].rngState);
			const mistaken = roll.value < ais[side].settings.mistakes;
			const after = mistaken ? rngNext(roll.state).state : roll.state;
			assert.equal(choice.ai.rngState, after, 'one roll, and one more for a mistake');
			mistakes += mistaken ? 1 : 0;
			ais[side] = choice.ai;
			match = apply(match, choice.action).match;
		}
		assert.equal(mistakes > 0, difficulty !== 'hard', `${difficulty} made ${mistakes} mistakes`);
	}
	assert.equal(createAi({ seed: 'frozen', side: 0 }).rngState, rngSeed('frozen:ai:0'));
});

check('the sample streams start in the middle of each quarter, each the smallest that does', () => {
	const source = readFileSync(join(ROOT, 'packages/engine-mechanics/src/cardAi.js'), 'utf8');
	const SAMPLE_STATES = JSON.parse(source.match(/const SAMPLE_STATES = (\[[^\]]*\])/)[1]);
	SAMPLE_STATES.forEach((state, quarter) => {
		const mid = (s) => {
			const value = rngNext(s).value * 4 - quarter;
			return value >= 0.375 && value < 0.625;
		};
		assert.ok(mid(state), `sample ${quarter}`);
		for (let s = 0; s < state; s++) assert.ok(!mid(s), `sample ${quarter}: ${s} is smaller`);
	});
});

check("the look-ahead never reads the match's stream", () => {
	// Thorn Beast's onDamaged and the lobber's onAttack hit a random enemy: the trials draw.
	const base = table({
		phase: 'combat',
		mine: { board: ['lobber', 'ogre'] },
		theirs: { board: ['thorn-beast', 'snack', 'ember-imp'] },
	});
	for (const difficulty of DIFFICULTIES) {
		const ai = steady(difficulty);
		const picks = new Set();
		for (let s = 0; s < 64; s++) {
			const choice = chooseAction(ai, { ...base, rngState: rngSeed(`peek:${s}`) });
			picks.add(JSON.stringify(choice.action));
		}
		assert.equal(picks.size, 1, `${difficulty} chose by the match's stream`);
	}
});

check("the look-ahead never reads the deck's hidden order", () => {
	// Archive Owl draws the top card: a plan that went on to play it would read the shuffle.
	const at = (deck) =>
		table({ resource: 4, mine: { hand: ['archive-owl', 'moss-mender'], deck }, theirs: {} });
	for (const difficulty of DIFFICULTIES) {
		const picks = [['pup'], ['giant'], ['giant', 'pup'], ['pup', 'giant']].map((deck) => {
			const match = at(deck);
			const { action } = chooseAction(steady(difficulty), match);
			return match.players[0].hand.find((c) => c.uid === action.uid)?.cardId ?? action.type;
		});
		assert.equal(new Set(picks).size, 1, `${difficulty}: ${picks.join(', ')}`);
	}
});

check('the levels play differently', () => {
	const lengths = DIFFICULTIES.map((d) => duel(12, d, 'easy').log.length);
	assert.ok(new Set(lengths).size > 1, lengths.join(', '));
});

check('each difficulty replays under a seed (AI vs AI, and from a player record)', () => {
	const traces = [];
	for (const difficulty of DIFFICULTIES) {
		for (const seed of [3, 'ai-replay']) {
			const run = () =>
				replayMatch({
					seed,
					decks: DECKS,
					library: SAMPLE,
					ai: [
						{ side: 0, difficulty },
						{ side: 1, difficulty },
					],
				});
			const a = run();
			const b = run();
			assert.equal(JSON.stringify(a.events), JSON.stringify(b.events), `${difficulty} ${seed}`);
			assert.equal(JSON.stringify(a.log), JSON.stringify(b.log));
			traces.push({ difficulty, seed, ...summary(a) });
		}
		// A player's record — side 0's actions only — replays the AI's turns, which are not stored.
		const played = replayMatch({
			seed: 'record',
			decks: DECKS,
			library: SAMPLE,
			ai: [
				{ side: 0, difficulty: 'normal' },
				{ side: 1, difficulty },
			],
		});
		const actions = played.log.filter((e) => e.side === 0).map((e) => e.action);
		const again = replayMatch({
			seed: 'record',
			decks: DECKS,
			library: SAMPLE,
			ai: [{ side: 1, difficulty }],
			actions,
		});
		assert.equal(JSON.stringify(again.events), JSON.stringify(played.events), difficulty);
		const partial = replayMatch({
			seed: 'record',
			decks: DECKS,
			library: SAMPLE,
			ai: [{ side: 1, difficulty }],
			actions: actions.slice(0, 5),
		});
		assert.equal(partial.match.result, null, 'a record cut short stops on the player');
		assert.equal(partial.log.filter((e) => e.side === 0).length, 5);
		assert.throws(
			() =>
				replayMatch({
					seed: 'record',
					decks: DECKS,
					library: SAMPLE,
					ai: [{ side: 1, difficulty }],
					actions: [...actions, { type: 'endPhase' }],
				}),
			/never reached 1 recorded action/,
		);
	}
	assert.throws(
		() =>
			replayMatch({
				seed: 1,
				decks: DECKS,
				library: SAMPLE,
				ai: [
					{ side: 0, difficulty: 'easy' },
					{ side: 0, difficulty: 'hard' },
				],
			}),
		/seated twice/,
	);
	if (process.argv.includes('--update')) {
		writeFileSync(REPLAY_FIXTURE, `${JSON.stringify(traces, null, '\t')}\n`);
		return;
	}
	assert.deepEqual(
		traces,
		JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8')),
		'the AI replay drifted from cards-ai-replay.json (run with --update only if the change to the AI is meant)',
	);
});

// ---- the budget and the strength --------------------------------------------------------------

check('hard stays inside its apply() budget on a full board, at a pinned count', () => {
	const board = [
		'ember-imp',
		'lantern-warden',
		'glass-knight',
		'thorn-beast',
		'moss-mender',
		'drum-captain',
		'ogre',
	];
	const hands = {
		designCase: [
			'cinder-bolt',
			'cinder-bolt',
			'rain-of-ash',
			'rain-of-ash',
			'big',
			'big',
			'pup',
			'pup',
			'hound',
			'hound',
		],
		worstCase: [
			'cinder-bolt',
			'cinder-bolt',
			'quiet-end',
			'rally-cry',
			'second-wind',
			'rain-of-ash',
			'quiet-end',
			'rally-cry',
			'second-wind',
			'cinder-bolt',
		],
	};
	const counts = {};
	for (const [name, hand] of Object.entries(hands)) {
		const match = table({ mine: { board, hand }, theirs: { board, hand: ['ogre'] } });
		const choice = chooseAction(steady('hard'), match);
		counts[name] = { actions: legalActions(match).length, applies: choice.applies };
		assert.ok(choice.applies <= MAX_PLAN_APPLIES, name);
	}
	assert.deepEqual(counts, FULL_BOARD_APPLIES);
	let worst = 0;
	for (let seed = 1; seed <= 10; seed++) {
		let m = createMatch({ seed, decks: DECKS, library: SAMPLE }).match;
		const ais = [0, 1].map((side) => createAi({ seed, side, difficulty: 'hard' }));
		while (!m.result) {
			const choice = chooseAction(ais[m.active], m);
			ais[m.active] = choice.ai;
			worst = Math.max(worst, choice.applies);
			m = apply(m, choice.action).match;
		}
	}
	assert.ok(worst <= MAX_PLAN_APPLIES, `a sample decision made ${worst} applies`);
});

check('normal beats easy on seeds 1…100 with the sample decks', () => {
	let normal = 0;
	let easy = 0;
	for (let seed = 1; seed <= 100; seed++) {
		const { winner } = duel(seed, 'normal', 'easy').match.result;
		if (winner === seed % 2) normal++;
		else if (winner !== 'draw') easy++;
	}
	assert.ok(normal > easy, `normal won ${normal}, easy ${easy}`);
	assert.deepEqual({ normal, easy }, STRENGTH);
});

function summary({ match, events, log }) {
	return {
		result: match.result,
		turn: match.turn,
		actions: log.length,
		events: events.length,
		digest: digest(JSON.stringify(events)),
	};
}

function deepFreeze(value) {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

/** FNV-1a over the event log, so the fixture pins every event without holding thousands. */
function digest(text) {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

if (failures.length) {
	console.error(failures.join('\n'));
	console.error(`\ncheck:card-ai — ${failures.length} failed, ${passed} passed`);
	process.exit(1);
}
console.log(`check:card-ai — ${passed} checks passed`);
