// Draw the reference mockup set in `docs/director/eval/mockups/` (ADR-0005 tests; ADR-0007's agent
// evaluation reuses it) and record each image's dominant colours in `reference.json`:
//
//   node --experimental-strip-types apps/launcher-api/scripts/generate-director-eval-mockups.mjs
//
// The images are ours: flat shapes drawn here with sharp, so the repo owns them outright and the
// "these designs belong to us" rule holds for the fixtures too. They are deliberately simple — a
// palette check needs known colours, a crop check needs known boxes — not pretty. Re-running
// rewrites the same bytes (sharp's PNG encoder is deterministic for the same input), so a diff in
// `git status` after a run means a drawing below changed.
//
// `reference.json` keeps the hand-written parts (the template, the canned analyst answers, the
// expected breakdown) and gets the computed part (`dominantColors`, sizes) refreshed in place.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../../../docs/director/eval/mockups');

/** A flat rectangle; `rx` rounds the corners. */
const rect = (x, y, w, h, fill, rx = 0) =>
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${rx ? ` rx="${rx}"` : ''}/>`;

const svg = (w, h, body) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const PALETTE = {
	deepSea: '#0E2A30',
	jade: '#3FB68B',
	coral: '#FF6F61',
	gold: '#F2C14E',
	glow: '#5CE1E6',
	violet: '#A99BFF',
};

/**
 * base-game.png (1280×800): background, logo, four jackpot plaques, a reel frame with 15 symbol
 * cells, a bet panel with a spin button, and a BUY button the template's math does not have.
 */
function baseGame() {
	const cells = [];
	for (let col = 0; col < 5; col++) {
		for (let row = 0; row < 3; row++) {
			const fill = [PALETTE.jade, PALETTE.coral, PALETTE.violet][(col + row) % 3];
			cells.push(rect(240 + col * 160 + 12, 220 + row * 150 + 12, 136, 126, fill, 10));
		}
	}
	return svg(
		1280,
		800,
		[
			rect(0, 0, 1280, 800, PALETTE.deepSea),
			rect(440, 24, 400, 110, PALETTE.gold, 18), // logo
			...[0, 1, 2, 3].map((i) => rect(60 + i * 300, 150, 260, 50, PALETTE.glow, 8)), // plaques
			rect(228, 208, 824, 464, '#1F4A52', 14), // frame
			...cells,
			rect(0, 690, 1280, 110, '#0A1D22'), // bet panel
			rect(560, 700, 160, 90, PALETTE.coral, 45), // spin
			rect(1080, 700, 160, 90, PALETTE.gold, 12), // BUY
		].join(''),
	);
}

/** big-win.png (960×600): the win banner over a dark field, a coin shower in gold. */
function bigWin() {
	const coins = [];
	for (let i = 0; i < 24; i++) {
		const x = (i * 193) % 920;
		const y = (i * 131) % 560;
		coins.push(`<circle cx="${x + 20}" cy="${y + 20}" r="14" fill="${PALETTE.gold}"/>`);
	}
	return svg(
		960,
		600,
		[
			rect(0, 0, 960, 600, PALETTE.deepSea),
			...coins,
			rect(180, 200, 600, 200, PALETTE.coral, 24), // banner
			rect(220, 240, 520, 120, PALETTE.glow, 16), // banner text plate
		].join(''),
	);
}

/** style-reference.jpg (800×500): a mood image, violet and jade, with no game elements. */
function styleReference() {
	return svg(
		800,
		500,
		[
			rect(0, 0, 800, 500, PALETTE.violet),
			rect(0, 300, 800, 200, PALETTE.jade),
			`<circle cx="620" cy="140" r="90" fill="${PALETTE.glow}"/>`,
		].join(''),
	);
}

const IMAGES = [
	{ file: 'base-game.png', draw: baseGame, encode: (s) => s.png({ compressionLevel: 9 }) },
	{ file: 'big-win.png', draw: bigWin, encode: (s) => s.png({ compressionLevel: 9 }) },
	{
		file: 'style-reference.jpg',
		draw: styleReference,
		encode: (s) => s.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }),
	},
];

const { dominantColors, imageDimensions } =
	await import('../src/lib/server/director/mockupPixels.ts');

const referencePath = join(OUT, 'reference.json');
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));

for (const image of IMAGES) {
	const bytes = await image.encode(sharp(Buffer.from(image.draw()))).toBuffer();
	writeFileSync(join(OUT, image.file), bytes);
	const entry = reference.images.find((i) => i.file === image.file);
	if (!entry) throw new Error(`reference.json has no entry for ${image.file}`);
	const { w, h } = await imageDimensions(bytes);
	entry.w = w;
	entry.h = h;
	entry.bytes = bytes.length;
	entry.dominantColors = await dominantColors(bytes);
	console.log(
		`${image.file}: ${w}×${h}, ${bytes.length} bytes, ${entry.dominantColors.length} colours`,
	);
}
writeFileSync(referencePath, `${JSON.stringify(reference, null, '\t')}\n`);
