// Verify the BOXED inline-image message row (`InlineImageText.svelte` + `inlineImage.ts`) — the
// Invisible Win Text "show symbol as image" toast rendered in an Info Bar that carries a box width.
//
//   node scripts/test-inline-image-box.mjs
//
// Why this exists: the Info Bar's message is engine-fed and LOCALIZED, so a real bar carries a box
// width + auto-fit to keep a translation inside the plaque art. While `<TextBox>` owned every boxed
// text node, a boxed bar `stripInlineImage`d the message back to the symbol NAME — the toggle did
// nothing on exactly the bars that needed a box. `<InlineImageText>` now lays the row out itself
// using the SAME `textBoxLayout` helpers, which is what this checks.
//
// The sentinel round-trip runs against the REAL `inlineImage` module and the placement against the
// REAL `textBoxLayout` module (bundled by esbuild, same trick as test-cover-fit.mjs). The row
// arithmetic below (`layoutRow`) MIRRORS the component's derivations — `widths` / `totalWidth` /
// `rowHeight` / `originX` / `originY` / `lefts` — because those live inside a `.svelte` file Node
// can't run. It proves the geometry the component asks for, not that Svelte mounted it; the live
// render is checked in the `apps/lines` story "ENGINE-LAYOUT/InfoBar inline symbol image".
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export { textBoxPlacement, textBoxContentWidth, textBoxContentHeight } from ${JSON.stringify(
			join(HERE, '../src/lib/textBoxLayout.ts').replace(/\\/g, '/'),
		)};
		export { wrapInlineImage, parseInlineImageSegments, hasInlineImage, stripInlineImage } from ${JSON.stringify(
			join(HERE, '../src/lib/inlineImage.ts').replace(/\\/g, '/'),
		)};`,
		resolveDir: HERE,
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	write: false,
});

const outFile = join(tmpdir(), `inline-image-box-${process.pid}.mjs`);
await writeFile(outFile, bundled.outputFiles[0].text);
const {
	textBoxPlacement,
	textBoxContentWidth,
	wrapInlineImage,
	parseInlineImageSegments,
	hasInlineImage,
	stripInlineImage,
} = await import(pathToFileURL(outFile).href);

let failures = 0;
const check = (name, got, want, tolerance = 0.001) => {
	const ok =
		typeof want === 'number'
			? Math.abs(got - want) <= tolerance
			: JSON.stringify(got) === JSON.stringify(want);
	if (!ok) {
		failures += 1;
		console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
	} else {
		console.log(`ok   ${name}`);
	}
};
const assert = (name, condition) => check(name, !!condition, true);

// ---------------------------------------------------------------------------------------------
// The component's row layout, mirrored. `measure` stands in for a `<CatalogText>` `onresize`.
// ---------------------------------------------------------------------------------------------
const CHAR_W = 0.5; // width per character per font px — the component's own first-frame estimate
const measureRun = (value, fontSize) => ({
	width: value.length * fontSize * CHAR_W,
	height: fontSize,
});

function layoutRow({ text, fontSize, box }) {
	const imageHeight = fontSize * 1.1;
	const imageMargin = fontSize * 0.22;
	const imageSlot = imageHeight + imageMargin * 2;
	// Resolver knows every token here, so each image segment stays an image.
	const segments = parseInlineImageSegments(text);
	const widths = segments.map((s) =>
		s.kind === 'image' ? imageSlot : measureRun(s.value, fontSize).width,
	);
	const totalWidth = widths.reduce((sum, w) => sum + w, 0);
	const rowHeight = segments.reduce(
		(tallest, s) =>
			Math.max(tallest, s.kind === 'image' ? imageHeight : measureRun(s.value, fontSize).height),
		0,
	);
	const placement = box
		? textBoxPlacement({
				boxWidth: box.boxWidth,
				boxHeight: box.boxHeight,
				padding: box.padding,
				anchorX: box.anchorX,
				anchorY: box.anchorY,
				align: box.align,
				verticalAlign: box.verticalAlign,
				measuredWidth: totalWidth,
				measuredHeight: rowHeight,
			})
		: undefined;
	const originX = placement ? placement.offsetX : -totalWidth / 2;
	const originY = placement ? placement.offsetY + rowHeight / 2 : 0;
	const lefts = [];
	let x = originX;
	for (const w of widths) {
		lefts.push(x);
		x += w;
	}
	return {
		segments,
		widths,
		totalWidth,
		rowHeight,
		imageSlot,
		imageHeight,
		originX,
		originY,
		lefts,
	};
}

// The toast `showWinInfoMessage` builds with the toggle on: the template, localized, with
// `{symbolName}` swapped for the sentinel (symbol id + the NAME as its fallback).
const RICH = `You win $4.00 with 4 ${wrapInlineImage('H4', 'Cowboys')}`;
const FONT = 24;
// The Info Bar's own defaults: the message node is anchor-centred on its plaque, and the def
// defaults `align`/`verticalAlign` to center/middle so adding a box can't shove the text off-centre.
const CENTRED = { anchorX: 0.5, anchorY: 0.5, align: 'center', verticalAlign: 'middle' };

// 1. The sentinel survives the pipeline and is detected — the gate the boxed branch turns on.
assert('sentinel detected in the rich toast', hasInlineImage(RICH));
check('plain-text fallback is the NAME', stripInlineImage(RICH), 'You win $4.00 with 4 Cowboys');
check(
	'segments split into a text run then the image',
	parseInlineImageSegments(RICH).map((s) => s.kind),
	['text', 'image'],
);

// 2. A CENTRED box lands the row exactly where the box-less centred row does. This is the property
//    the author sees: ticking a box width to shrink-fit a translation must not move the message.
{
	const box = { ...CENTRED, boxWidth: 520, boxHeight: 60, padding: 8 };
	const boxed = layoutRow({ text: RICH, fontSize: FONT, box });
	const free = layoutRow({ text: RICH, fontSize: FONT });
	check('boxed row centre x == box-less row centre x', boxed.originX + boxed.totalWidth / 2, 0);
	check('boxed row centre y == box-less row centre y', boxed.originY, free.originY);
	check('box-less origin unchanged (parity)', free.originX, -free.totalWidth / 2);
}

// 3. Segments sit in reading order, edge to edge — the image occupies its own slot rather than
//    overlapping the words either side of it (the "2🐄" butt-up the side margin fixes).
{
	const { widths, lefts, segments, imageSlot } = layoutRow({
		text: RICH,
		fontSize: FONT,
		box: { ...CENTRED, boxWidth: 520, boxHeight: 60, padding: 8 },
	});
	for (let i = 1; i < lefts.length; i++) {
		check(
			`segment ${i} starts where segment ${i - 1} ends`,
			lefts[i],
			lefts[i - 1] + widths[i - 1],
		);
	}
	const imageIndex = segments.findIndex((s) => s.kind === 'image');
	check('image occupies the fixed square slot + margins', widths[imageIndex], imageSlot);
	assert('image slot is wider than the symbol is tall (side margins)', imageSlot > FONT * 1.1);
}

// 4. Left/top alignment starts the row at the padded box edge, measured from the anchored box —
//    the same rule `<TextBox>` follows for plain text.
{
	const box = {
		anchorX: 0,
		anchorY: 0,
		align: 'left',
		verticalAlign: 'top',
		boxWidth: 400,
		boxHeight: 80,
		padding: 12,
	};
	const { originX, originY, rowHeight } = layoutRow({ text: RICH, fontSize: FONT, box });
	check('left-aligned row starts at padding', originX, 12);
	check('top-aligned row sits a half-row below the padded top', originY, 12 + rowHeight / 2);
}

// 5. Auto-fit shrinks the WHOLE row — text runs AND the symbol — until it fits the content width,
//    which is the localization case the box exists for. Mirrors the component's shrink step.
{
	const box = { ...CENTRED, boxWidth: 300, boxHeight: 60, padding: 8 };
	const contentWidth = textBoxContentWidth(box.boxWidth, box.padding);
	const MIN_FONT = 6;
	let font = FONT;
	let row = layoutRow({ text: RICH, fontSize: font, box });
	assert('the row starts too wide for this box', row.totalWidth > contentWidth);
	const startImage = row.imageSlot;
	for (let i = 0; i < 40 && font > MIN_FONT && row.totalWidth > contentWidth + 0.5; i++) {
		const ratio = Math.min(1, row.totalWidth > 0 ? contentWidth / row.totalWidth : 1);
		const next = Math.max(MIN_FONT, Math.floor(font * (ratio >= 0.999 ? 0.9 : ratio)));
		if (next === font) break;
		font = next;
		row = layoutRow({ text: RICH, fontSize: font, box });
	}
	assert('auto-fit converges inside the box', row.totalWidth <= contentWidth + 0.5);
	assert('auto-fit shrank the font', font < FONT);
	assert('the symbol shrank with the text', row.imageSlot < startImage);
	check('the fitted row is still centred', row.originX + row.totalWidth / 2, 0);
}

// 6. A message with NO sentinel is untouched by any of this (every existing bar).
{
	const plain = 'You win $4.00 with 4 Cowboys';
	assert('no sentinel ⇒ the inline branch never runs', !hasInlineImage(plain));
	check('strip is identity for plain copy', stripInlineImage(plain), plain);
}

await rm(outFile, { force: true });
if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall inline-image box checks passed');
