// 🗺 From my sheet: the head under a 3D capture (the owner, 2026-11-26: "my head is still not
// rotating … the facial bones are working perfectly, but the head is not moving like them"),
// headless on the SHIPPED code: the rig 🗺 From my sheet makes of the committed sheet fixture
// (`fixtures/sheet-rig/`, Half body) under the owner's own region names (S_NellyAnimTest's
// Photoshop Export Layers names, mapped by the dialog's first guess `suggestSheet`), its face drawn
// apart as the owner's is (pupils, lids, nose, lips, teeth), glasses and an earring worn on the head;
// a synthetic performer (`performer3d.mjs`) whose face's 3D pose is known, solved, keyed, imported
// into the sidecar and baked as the page does (`rig3dImport.ts` → `rig2p5d.ts`), and posed by
// engine-rig as a game does. Asserted:
//  - roll: a capture's head roll turns the head's whole drawing about the head by the roll (its
//    outline and its middle alike, nothing left on the neck), and the features and the glasses with
//    it — drawn apart, and with a face found on the head;
//  - gain: the import's Head gain reaches a 3D import's head turn (2× turns it twice as far, 0.5×
//    half as far), as it does a 2D import's head controls;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-head.mjs [--only <guard>] [--no-mutants]
import * as P from './performer3d.mjs';
import {
	END,
	drawn,
	faceTrack,
	imported,
	middle,
	ownerRig,
	player,
	runGate,
	turnOf,
	turned,
} from './owner-sheet.mjs';

const r1 = (v) => Math.round(v * 10) / 10;

/** The capture's roll (degrees, counter-clockwise in the picture). */
const ROLL = 20;
/** How far off the capture's roll the head's drawing may turn (degrees); off its turn, rig units. */
const TURN_KEPT = 0.75;
const WHOLE = 0.5;
/** The face's own parts and the glasses a roll carries round the head with it. */
const CARRIED = ['pupil_l', 'pupil_r', 'lid_upper_l', 'lid_lower_r', 'nose', 'lip_upper'];

const GUARDS = {
	/** A capture's head roll turns the head's whole drawing by the roll, its features with it. */
	roll(M, ok, log) {
		let good = true;
		const rows = [];
		for (const face of [false, true]) {
			const what = face ? 'a face found on the head' : 'the face drawn apart';
			const rig = ownerRig(M, { face });
			const at = player(
				imported(
					rig,
					faceTrack((k) => P.rz(ROLL * k)),
				).irig,
			);
			const [rest, end] = [at(0), at(END)];
			const head = turnOf(drawn(rest, 'head'), drawn(end, 'head'));
			const pivot = [rest.findBone('head').worldX, rest.findBone('head').worldY];
			const parts = [
				...(face ? [] : CARRIED),
				...rig.irig.slots.filter((s) => /glasses/.test(s.name)).map((s) => s.name),
			];
			const slip = parts.map((s) => {
				const want = turned(middle(drawn(rest, s)), pivot, ROLL);
				const got = middle(drawn(end, s));
				return [s, Math.hypot(got[0] - want[0], got[1] - want[1])];
			});
			const worst = slip.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
			rows.push(`${what}: ${r1(head.deg)}° (off ${head.off.toFixed(2)}), parts ≤ ${r1(worst[1])}`);
			good =
				ok(
					`roll (${what}): the head's drawing turns by the capture's ${ROLL}° roll`,
					Math.abs(head.deg - ROLL) <= TURN_KEPT,
					`${r1(head.deg)}°`,
				) &&
				ok(
					`roll (${what}): the head's drawing turns whole (its outline and its middle alike, none of it left on the neck)`,
					head.off <= WHOLE,
					`${head.off.toFixed(2)} units off`,
				) &&
				ok(
					`roll (${what}): the face's parts and the glasses turn round the head with it`,
					parts.some((s) => /glasses/.test(s)) && worst[1] <= 1,
					`${worst[0]} ${r1(worst[1])} units off`,
				) &&
				good;
		}
		log(`a ${ROLL}° roll: ${rows.join('; ')}`);
		return good;
	},

	/** The import's Head gain scales a 3D import's head turn, as it does a 2D import's controls. */
	gain(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const rows = [];
		for (const g of [2, 0.5]) {
			const at = player(
				imported(
					rig,
					faceTrack((k) => P.rz(ROLL * k)),
					{ gain: { head: g } },
				).irig,
			);
			const { deg } = turnOf(drawn(at(0), 'head'), drawn(at(END), 'head'));
			rows.push(`${g}× ${r1(deg)}°`);
			good =
				ok(
					`gain: Head ${g}× turns the head ${g} times the capture's ${ROLL}° roll`,
					Math.abs(deg - g * ROLL) <= TURN_KEPT * Math.max(1, g),
					`${r1(deg)}°`,
				) && good;
		}
		log(`a ${ROLL}° roll at Head ${rows.join(', ')}`);
		return good;
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	[
		'roll',
		'the face’s 3D pose not read: the head never turns',
		[
			[
				'rigMotion3d.ts',
				'if (faceTurn[i] && faceSmooth) turn = localTurn(parent, setup, matOf(faceSmooth[i]));',
				'if (faceTurn[i] && faceSmooth) turn = null;',
			],
		],
	],
	[
		'roll',
		'the head’s outline kept upright: square to the viewer, it loses the head’s roll',
		[['rigMotion3d.ts', 'Math.atan2(up[1], up[0]) - Math.PI / 2', '0']],
	],
	[
		'roll',
		'the head drawn on the neck at its joint: its bottom stays as the rest turns',
		[
			[
				'rigFrameFit.ts',
				"torso: ['spine', 'clavicle_l', 'clavicle_r'],",
				"torso: ['spine', 'clavicle_l', 'clavicle_r'],\n\thead: ['neck'],",
			],
		],
	],
	[
		'gain',
		'the Head gain not passed to the 3D solve',
		[['rigMotion.ts', 'headGain: opts.gain?.head ?? 1,', '']],
	],
	[
		'gain',
		'the 3D solve ignores the Head gain',
		[
			[
				'rigMotion3d.ts',
				'turnTimes(quatOf(mul3(m, transpose3(matOf(rest0)))), headGain)',
				'quatOf(mul3(m, transpose3(matOf(rest0))))',
			],
		],
	],
];

await runGate('sheet-head', GUARDS, MUTANTS);
