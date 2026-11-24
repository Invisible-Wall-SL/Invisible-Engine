/**
 * THE STAND-IN FOR AN EIGHT-FACING CHARACTER RIG (`character-turn-strip.mjs`): one rig, one walk
 * and one idle for each of the five facings an artist draws (`n`, `ne`, `e`, `se`, `s`; the
 * western three are their twins mirrored), each showing that facing's own parts, as a rig made in
 * the Rigger from five drawings does. An upright figure seen in three-quarter view, so a turn
 * that tips it over or pops is seen as it would be on a game's character; a box of one colour
 * (the gate's fixture) shows neither.
 */

export const BEAR_FACINGS = ['n', 'ne', 'e', 'se', 's'] as const;
type Made = (typeof BEAR_FACINGS)[number];

const NAME: Record<Made, string> = {
	n: 'North',
	ne: 'NorthEast',
	e: 'East',
	se: 'SouthEast',
	s: 'South',
};

/** How far the head looks to the right of the figure, −1 (away) to 1, and how much face shows. */
const LOOK: Record<Made, { side: number; face: number }> = {
	n: { side: 0, face: 0 },
	ne: { side: 0.55, face: 0.25 },
	e: { side: 1, face: 0.6 },
	se: { side: 0.6, face: 0.9 },
	s: { side: 0, face: 1 },
};

const CELL = { w: 64, h: 64 };
const PARTS = ['body', 'head', 'legA', 'legB'] as const;
type Part = (typeof PARTS)[number];

const regionOf = (facing: Made, part: Part) => ({
	x: PARTS.indexOf(part) * CELL.w,
	y: BEAR_FACINGS.indexOf(facing) * CELL.h,
});

/** The atlas page: five rows (a facing each) of body, head and two legs. */
export function drawBearAtlas(): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = CELL.w * PARTS.length;
	canvas.height = CELL.h * BEAR_FACINGS.length;
	const g = canvas.getContext('2d');
	if (!g) throw new Error('no 2d context');
	for (const facing of BEAR_FACINGS) {
		const { side, face } = LOOK[facing];
		const at = (part: Part) => {
			const { x, y } = regionOf(facing, part);
			g.setTransform(1, 0, 0, 1, x + CELL.w / 2, y + CELL.h / 2);
		};
		at('body');
		g.fillStyle = '#7a4a26';
		g.beginPath();
		g.ellipse(0, 0, 20 + 5 * Math.abs(side), 27, 0, 0, Math.PI * 2);
		g.fill();
		// The belly shows from the front, the back's stripe from behind.
		g.fillStyle = face > 0.5 ? '#c79a6b' : '#5c3519';
		g.beginPath();
		g.ellipse(side * 9, 4, 11 - 4 * Math.abs(side), 17, 0, 0, Math.PI * 2);
		g.fill();
		at('head');
		g.fillStyle = '#8a5630';
		for (const ear of [-1, 1]) {
			g.beginPath();
			g.arc(ear * 14 - side * 4, -16, 7, 0, Math.PI * 2);
			g.fill();
		}
		g.beginPath();
		g.arc(0, 0, 20, 0, Math.PI * 2);
		g.fill();
		if (face > 0) {
			g.fillStyle = '#e2c39d';
			g.beginPath();
			g.ellipse(side * 15, 6, 10 * face, 8, 0, 0, Math.PI * 2);
			g.fill();
			g.fillStyle = '#1a1a1a';
			g.beginPath();
			g.arc(side * 19, 3, 3.2 * face, 0, Math.PI * 2);
			g.fill();
			for (const eye of [-1, 1]) {
				const x = side * 9 + eye * 8 * (1 - 0.55 * Math.abs(side));
				if (Math.abs(side) > 0.9 && eye < 0) continue;
				g.beginPath();
				g.arc(x, -6, 2.4, 0, Math.PI * 2);
				g.fill();
			}
		}
		for (const leg of ['legA', 'legB'] as const) {
			at(leg);
			g.fillStyle = leg === 'legA' ? '#5c3519' : '#6b4020';
			g.beginPath();
			g.roundRect(-8, -16, 16, 30, 6);
			g.fill();
			g.fillStyle = '#3a2412';
			g.beginPath();
			g.ellipse(side * 4, 14, 10, 5, 0, 0, Math.PI * 2);
			g.fill();
		}
	}
	g.setTransform(1, 0, 0, 1, 0, 0);
	return canvas;
}

export function bearAtlasText(page: string): string {
	const lines = [
		page,
		`size: ${CELL.w * PARTS.length},${CELL.h * BEAR_FACINGS.length}`,
		'filter: Linear,Linear',
	];
	for (const facing of BEAR_FACINGS)
		for (const part of PARTS) {
			const { x, y } = regionOf(facing, part);
			lines.push(`${part}_${facing}`, `bounds: ${x},${y},${CELL.w},${CELL.h}`);
		}
	return [...lines, ''].join('\n');
}

/**
 * The skeleton, in the 4.2 JSON the engine's runtime reads. `shared` makes a rig whose facings
 * all draw the SAME parts (the `e` row) and differ only in their pose: the case a pose mix is for.
 */
export function bearSkeleton(shared = false): object {
	const piece = (part: Part, facing: Made) => ({
		[`${part}_${facing}`]: { x: 0, y: 0, width: CELL.w, height: CELL.h },
	});
	const shown = (facing: Made) =>
		Object.fromEntries(
			PARTS.map((part) => [part, { attachment: [{ name: `${part}_${shared ? 'e' : facing}` }] }]),
		);
	const swing = (by: number) => [
		{ value: by },
		{ time: 0.3, value: -by },
		{ time: 0.6, value: by },
	];
	const walk = (facing: Made) => {
		const { side } = LOOK[facing];
		// Seen from the side the legs swing; seen from the front or behind they lift.
		const turn = 28 * Math.abs(side) + 4;
		const lift = 5 * (1 - Math.abs(side));
		const step = (sign: number) => ({
			rotate: swing(sign * turn),
			translate: [
				{ y: sign > 0 ? lift : 0 },
				{ time: 0.3, y: sign > 0 ? 0 : lift },
				{ time: 0.6, y: sign > 0 ? lift : 0 },
			],
		});
		return {
			slots: shown(facing),
			bones: {
				hip: {
					translate: [
						{ y: 0 },
						{ time: 0.15, y: 3 },
						{ time: 0.3, y: 0 },
						{ time: 0.45, y: 3 },
						{ time: 0.6, y: 0 },
					],
					...(shared ? { rotate: [{ value: -side * 30 }, { time: 0.6, value: -side * 30 }] } : {}),
				},
				legA: step(1),
				legB: step(-1),
				head: { rotate: swing(4) },
			},
		};
	};
	const idle = (facing: Made) => ({
		slots: shown(facing),
		bones: {
			body: {
				scale: [
					{ x: 1, y: 1 },
					{ time: 0.6, x: 1.03, y: 0.97 },
					{ time: 1.2, x: 1, y: 1 },
				],
			},
		},
	});
	return {
		skeleton: { spine: '4.2.0', x: -36, y: 0, width: 72, height: 104 },
		bones: [
			{ name: 'root' },
			{ name: 'hip', parent: 'root', y: 26 },
			{ name: 'legA', parent: 'hip', x: -10, y: -8 },
			{ name: 'legB', parent: 'hip', x: 10, y: -8 },
			{ name: 'body', parent: 'hip', y: 22 },
			{ name: 'head', parent: 'body', y: 34 },
		],
		slots: [
			{ name: 'legA', bone: 'legA', attachment: 'legA_s' },
			{ name: 'legB', bone: 'legB', attachment: 'legB_s' },
			{ name: 'body', bone: 'body', attachment: 'body_s' },
			{ name: 'head', bone: 'head', attachment: 'head_s' },
		],
		skins: [
			{
				name: 'default',
				attachments: Object.fromEntries(
					PARTS.map((part) => [
						part,
						Object.assign(
							{},
							...BEAR_FACINGS.map((facing) => {
								const made = piece(part, facing);
								// A leg hangs from its bone.
								if (part !== 'body' && part !== 'head')
									for (const value of Object.values(made)) value.y = -14;
								return made;
							}),
						),
					]),
				),
			},
		],
		animations: Object.fromEntries(
			BEAR_FACINGS.flatMap((facing) => [
				[`Walk_${NAME[facing]}`, walk(facing)],
				[`Idle_${NAME[facing]}`, idle(facing)],
			]),
		),
	};
}

/** The sheet of the published Salmons bear, as the owner saved it (`view.turn: {}`), on `rig`. */
export const bearSheet = (rig: string, turn: object = {}) => ({
	id: 'bearBot',
	component: 'salmonsBear',
	view: { kind: 'isometric', facings: 8, turn },
	source: { kind: 'rig', rig },
	draw: { width: 75 },
	actions: [
		{
			id: 'Walk',
			when: { motion: 'moving' },
			anim: Object.fromEntries(BEAR_FACINGS.map((f) => [f, { anim: `Walk_${NAME[f]}` }])),
		},
		{
			id: 'Idle',
			when: { motion: 'still' },
			anim: Object.fromEntries(BEAR_FACINGS.map((f) => [f, { anim: `Idle_${NAME[f]}` }])),
		},
	],
});
