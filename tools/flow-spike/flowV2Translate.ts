/**
 * Invisible Flow v1→v2 TRANSLATOR harness (Phase B). The translator itself lives in the
 * `engine-flow-migrate` package; this proves it against real v1 choreographies + a whole doc.
 *
 *   pnpm --filter flow-spike run v2translate
 *
 * Asserts: real v1 choreographies (setWin + a forEach) translate to v2 graphs that VALIDATE clean
 * with the right shape; and a whole v1 doc (screens + bookEvent/complete/action transitions)
 * translates to a v2 doc with 0 ERRORS, correct containers/events/hide-show/intent.
 */

import type {
	ChoreographyNode,
	FlowAccessor,
	FlowDoc as FlowDocV1,
	FlowPayload,
} from 'engine-flow';
import { translateEventChoreography, translateFlowDoc } from 'engine-flow-migrate';
import { validateFlowDoc, BOOK_OF_VOCAB, type FlowDoc } from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

// v1 helpers (mirror flowDoc.ts).
const b = (event: string, payload?: FlowPayload, await_ = false): ChoreographyNode => ({
	kind: 'broadcast',
	event,
	...(payload ? { payload } : {}),
	...(await_ ? { async: true, await: true } : {}),
});
const e = (name: string, payload?: FlowPayload): ChoreographyNode => ({
	kind: 'effect',
	name,
	...(payload ? { payload } : {}),
});
const seqN = (...children: ChoreographyNode[]): ChoreographyNode => ({
	kind: 'sequence',
	children,
});
const trg = (path: string): FlowAccessor => ({ kind: 'trigger', path });
const lit = (value: string | number | boolean): FlowAccessor => ({ kind: 'literal', value });

const setWinChoreo = seqN(
	b('winShow'),
	e('winShow', { winLevel: trg('winLevel') }),
	e('winLevelSoundsPlay', { winLevel: trg('winLevel') }),
	e('winUpdate', { amount: trg('amount'), winLevel: trg('winLevel') }),
	e('winLevelSoundsStop'),
	b('winHide'),
	e('winHide'),
);

const winInfoChoreo = seqN(b('soundOnce', { name: lit('sfx_winlevel_small') }), {
	kind: 'forEach',
	list: trg('wins'),
	mode: 'sequence',
	body: seqN(
		b('boardShow'),
		b('boardWithAnimateSymbols', { symbolPositions: { kind: 'item', path: 'positions' } }, true),
	),
});

const EMPTY_LIB = { version: 2 as const, functions: [] };

const main = () => {
	console.log('Invisible Flow v1→v2 translator harness\n');

	console.log('1. translate `setWin` — the v2 graph validates + has the right shape:');
	{
		const g = translateEventChoreography('setWin', setWinChoreo, BOOK_OF_VOCAB);
		const doc: FlowDoc = {
			version: 2,
			templateId: 'bookOf',
			graph: g,
			containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
		};
		const issues = validateFlowDoc(doc, BOOK_OF_VOCAB, EMPTY_LIB);
		assert(
			'validates 0 issues',
			issues.length === 0,
			issues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
		const kinds = g.nodes.map((n) => n.kind);
		assert(
			'node kinds = event + (cue action action action action cue action)',
			JSON.stringify(kinds) ===
				JSON.stringify([
					'event',
					'fireCue',
					'action',
					'action',
					'action',
					'action',
					'fireCue',
					'action',
				]),
			kinds.join(','),
		);
	}

	console.log('\n2. translate `winInfo` — forEach + awaited cue compile + validate:');
	{
		const g = translateEventChoreography('winInfo', winInfoChoreo, BOOK_OF_VOCAB);
		const doc: FlowDoc = {
			version: 2,
			templateId: 'bookOf',
			graph: g,
			containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
		};
		const issues = validateFlowDoc(doc, BOOK_OF_VOCAB, EMPTY_LIB);
		assert(
			'validates 0 issues',
			issues.length === 0,
			issues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
		assert(
			'a forEach node was produced',
			g.nodes.some((n) => n.kind === 'forEach'),
		);
		const animate = g.nodes.find(
			(n) => n.kind === 'fireCue' && (n as { ref: string }).ref === 'boardWithAnimateSymbols',
		) as { await?: boolean } | undefined;
		assert('the awaited broadcast → fireCue { await: true }', animate?.await === true);
	}

	console.log('\n3. translate a whole v1 DOC — screens→containers + transitions→show/hide/intent:');
	{
		const v1: FlowDocV1 = {
			version: 1,
			projectKey: 'bookOf',
			screens: [{ id: 'loading', initial: true }, { id: 'basegame' }, { id: 'winScreen' }],
			transitions: [
				{ id: 't1', from: 'loading', to: 'basegame', trigger: { kind: 'complete' } },
				{
					id: 't2',
					from: 'basegame',
					to: 'winScreen',
					trigger: { kind: 'bookEvent', event: 'setWin' },
				},
				{
					id: 't3',
					from: 'basegame',
					to: 'basegame',
					trigger: { kind: 'action', pin: 'spin', intent: 'spin' },
				},
			],
			events: [{ event: 'setWin', choreography: setWinChoreo }],
		};
		const v2 = translateFlowDoc(v1, BOOK_OF_VOCAB);
		const errors = validateFlowDoc(v2, BOOK_OF_VOCAB, EMPTY_LIB).filter(
			(i) => i.severity === 'error',
		);
		assert(
			'translated doc validates with 0 ERRORS',
			errors.length === 0,
			errors.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
		assert(
			'screens → containers (loading z0, basegame z10, winScreen z20)',
			JSON.stringify(v2.containers) ===
				JSON.stringify([
					{ id: 'loading', sceneId: 'loading', z: 0 },
					{ id: 'basegame', sceneId: 'basegame', z: 10 },
					{ id: 'winScreen', sceneId: 'winScreen', z: 20 },
				]),
		);
		const evs = v2.graph.nodes
			.filter((n) => n.kind === 'event')
			.map((n) => (n as { ref: string }).ref)
			.sort();
		assert(
			'events = complete:loading, load, setWin, spin',
			JSON.stringify(evs) === JSON.stringify(['complete:loading', 'load', 'setWin', 'spin']),
			evs.join(','),
		);
		assert(
			'setWin (bookEvent) LAYERS winScreen — show winScreen, NO hide basegame (v1 layer semantics)',
			v2.graph.nodes.some(
				(n) => n.kind === 'showContainer' && (n as { ref: string }).ref === 'winScreen',
			) &&
				!v2.graph.nodes.some(
					(n) => n.kind === 'hideContainer' && (n as { ref: string }).ref === 'basegame',
				),
		);
		assert(
			'spin action transition → invoke-intent action startSpin',
			v2.graph.nodes.some((n) => n.kind === 'action' && (n as { ref: string }).ref === 'startSpin'),
		);
	}

	console.log(`\n${failed ? 'V2 TRANSLATE HARNESS: FAILED' : 'V2 TRANSLATE HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
