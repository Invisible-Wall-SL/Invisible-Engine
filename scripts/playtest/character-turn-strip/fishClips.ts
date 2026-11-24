/**
 * THE STAND-IN FOR A TOP-DOWN CHARACTER OF FRAME CLIPS (`character-turn-strip.mjs`): a fish seen
 * from straight above, a four-frame swim for each of the five facings an artist draws (the
 * western three are their twins mirrored). Seen from above a facing is the same drawing turned,
 * which is the subject a LEAN is right for.
 */

export const FISH_FACINGS = ['n', 'ne', 'e', 'se', 's'] as const;
export const FISH_FRAMES = 4;
export const FISH_SIZE = 96;

/** One frame: the fish heading `facing`, its tail at `step` of its wag. */
export function drawFish(facing: (typeof FISH_FACINGS)[number], step: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = FISH_SIZE;
	const g = canvas.getContext('2d');
	if (!g) throw new Error('no 2d context');
	g.translate(FISH_SIZE / 2, FISH_SIZE / 2);
	g.rotate((FISH_FACINGS.indexOf(facing) * Math.PI) / 4);
	const wag = Math.sin((step / FISH_FRAMES) * Math.PI * 2) * 0.5;
	g.fillStyle = '#d9643a';
	g.save();
	g.translate(0, 22);
	g.rotate(wag);
	g.beginPath();
	g.moveTo(0, -4);
	g.lineTo(-13, 20);
	g.lineTo(13, 20);
	g.closePath();
	g.fill();
	g.restore();
	for (const fin of [-1, 1]) {
		g.beginPath();
		g.ellipse(fin * 15, -2, 8, 4, fin * (0.6 + wag * 0.4), 0, Math.PI * 2);
		g.fill();
	}
	g.fillStyle = '#f08a4b';
	g.beginPath();
	g.ellipse(0, 0, 14, 28, 0, 0, Math.PI * 2);
	g.fill();
	g.fillStyle = '#ffd9b0';
	g.beginPath();
	g.ellipse(0, -4, 5, 14, 0, 0, Math.PI * 2);
	g.fill();
	g.fillStyle = '#1a1a1a';
	for (const eye of [-1, 1]) {
		g.beginPath();
		g.arc(eye * 7, -19, 2.4, 0, Math.PI * 2);
		g.fill();
	}
	return canvas;
}

export const fishClipId = (facing: string) => `fish_swim_${facing}`;
export const fishFrame = (facing: string, step: number) => `fish_${facing}_${step}`;

/** The sheet: a top-down view of eight facings, its feet at the middle of its box. */
export const fishSheet = (turn: object | undefined) => ({
	view: { kind: 'topDown', facings: 8, ...(turn ? { turn } : {}) },
	source: { kind: 'clips', prefix: 'fish' },
	draw: { width: 80, feet: 0.5 },
	actions: [{ id: 'swim', when: [{ motion: 'still' }, { motion: 'moving' }] }],
});
