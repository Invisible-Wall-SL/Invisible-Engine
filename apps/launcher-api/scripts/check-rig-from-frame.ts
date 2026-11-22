/**
 * Frame to rig's launcher half (`$lib/server/rigFromFrame`, docs/design/frame-to-rig.md F1), offline:
 *   pnpm --filter launcher-api check:rig-from-frame
 *
 *  1. A clip frame resolves to its sheet page and region on the clip's canvas: the largest
 *     untrimmed frame of the clip, as `rigger-motion`'s `clipFrames` draws every frame, so the
 *     track's normalised points land where the cut reads them; a frame on another sheet of the
 *     clip (`<sheet>::<region>`) resolves against that sheet.
 *  2. A frame not in the clip, a region its sheet lacks, a page outside the project's art, a page
 *     shared from another project and a frame past 4096 px are refused, each saying why.
 *  3. A template is cut for only when it has the Half body parts; its slots go in draw order.
 *  4. The brushed label map is taken when it moves pixels between parts, and refused when it
 *     changes the outline, names a part the cut has not, or is not the frame's size or a PNG; it is
 *     stored as the 8-bit grey map the cut writes.
 *  5. A kept cut is found again when its clip is opened (F2b): by the clip and frame it names, or,
 *     cut before cuts named them, by the page and region it was cut from.
 */
import { mock } from 'node:test';
import sharp from 'sharp';

const PREFIX = 'acme/game1';
const SHEET_A = `${PREFIX}/manifests/atlas_manifest_Walk.json`;
const SHEET_B = `${PREFIX}/manifests/atlas_manifest_Walk2.json`;
const SHARED = '_shared/sheets/library/manifests/atlas_manifest_Lib.json';
const SETS: Record<string, { pageKey: string; regions: Record<string, unknown>[] }> = {
	[SHEET_A]: {
		pageKey: `${PREFIX}/sheets/Walk/Walk.png`,
		regions: [
			{ name: 'f0', x: 0, y: 0, w: 300, h: 500, offX: 10, offY: 20, origW: 400, origH: 600 },
			{
				name: 'f1',
				x: 300,
				y: 0,
				w: 320,
				h: 480,
				rotated: true,
				offX: 5,
				offY: 0,
				origW: 420,
				origH: 590,
			},
		],
	},
	[SHEET_B]: {
		pageKey: `${PREFIX}/sheets/Walk2/Walk2.png`,
		regions: [{ name: 'g0', x: 0, y: 0, w: 640, h: 610 }],
	},
	[SHARED]: {
		pageKey: '_shared/sheets/library/Lib.png',
		regions: [{ name: 's0', x: 0, y: 0, w: 10, h: 10 }],
	},
	big: {
		pageKey: `${PREFIX}/sheets/Big/Big.png`,
		regions: [{ name: 'b0', x: 0, y: 0, w: 5000, h: 10 }],
	},
};
const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('editorRegions.ts'), {
	namedExports: {
		loadRegionSet: async (key: string) => ({
			assetKey: key,
			pageWidth: 0,
			pageHeight: 0,
			...(SETS[key] ?? { pageKey: '', regions: [] }),
		}),
	},
});
mock.module(server('projectArtScope.ts'), {
	namedExports: {
		isProjectArtAllowed: async (key: string, prefixes: string[]) =>
			prefixes.some((p) => key.startsWith(p)),
	},
});
const HALF = [
	'hair_back',
	'torso',
	'neck',
	'head',
	'hair_front',
	'upper_arm_l',
	'lower_arm_l',
	'hand_l',
	'thumb_3_l',
	'upper_arm_r',
	'lower_arm_r',
	'hand_r',
	'thumb_3_r',
];
mock.module(server('rigTemplateStore.ts'), {
	namedExports: {
		rigTemplateForNewRig: async (id: string) =>
			id === 'half-body'
				? { id, label: 'Half body', slots: HALF.map((name) => ({ name, bone: name })) }
				: id === 'bust-face'
					? {
							id,
							label: 'Bust with face',
							slots: ['body', 'head'].map((name) => ({ name, bone: name })),
						}
					: null,
	},
});
const {
	resolveClipFrame,
	cutTemplateSlots,
	checkedLabels,
	newJobId,
	jobRoot,
	JOB_ID,
	clipFrameKeys,
	cutFrameOf,
	partsSheetName,
} = await import('../src/lib/server/rigFromFrame');
type StoredCut = import('../src/lib/server/rigFromFrame').StoredCut;

let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  ' + detail}`);
	if (!ok) failed++;
}
const scope = {
	prefixes: [`${PREFIX}/`, '_shared/sheets/'],
	clientKey: 'acme',
	projectKey: 'game1',
};
const clip = { assetKey: SHEET_A, frames: ['f0', 'f1', `${SHEET_B}::g0`, 'f0'] };

// 1. Where a frame is.
const r1 = await resolveClipFrame(clip, 1, scope);
check(
	'1. the frame resolves to its page and region, turned and trimmed as packed',
	r1.ok &&
		r1.value.pageKey === SETS[SHEET_A].pageKey &&
		JSON.stringify(r1.value.region) ===
			JSON.stringify({ x: 300, y: 0, w: 320, h: 480, rotated: true, offX: 5, offY: 0 }),
	JSON.stringify(r1),
);
check(
	"1. on the clip's canvas: the largest untrimmed frame of the whole clip",
	r1.ok && r1.value.canvas[0] === 640 && r1.value.canvas[1] === 610,
	JSON.stringify(r1.ok && r1.value.canvas),
);
const r2 = await resolveClipFrame(clip, 2, scope);
check(
	'1. a frame on another sheet of the clip resolves against that sheet',
	r2.ok && r2.value.pageKey === SETS[SHEET_B].pageKey && r2.value.region.w === 640,
	JSON.stringify(r2),
);

// 2. Refusals.
const refused = async (c: typeof clip, i: number, s = scope) => {
	const r = await resolveClipFrame(c, i, s);
	return r.ok ? 0 : r.status;
};
check(
	'2. a frame not in the clip',
	(await refused(clip, 4)) === 400 && (await refused(clip, -1)) === 400,
);
check(
	'2. a region its sheet lacks',
	(await refused({ assetKey: SHEET_A, frames: ['nope'] }, 0)) === 422,
);
check(
	"2. a page outside the project's art",
	(await refused({ assetKey: SHARED, frames: ['s0'] }, 0, {
		...scope,
		prefixes: [`${PREFIX}/`],
	})) === 403,
);
check(
	'2. a page shared from another project',
	(await refused({ assetKey: SHARED, frames: ['s0'] }, 0)) === 422,
);
check('2. a frame past 4096 px', (await refused({ assetKey: 'big', frames: ['b0'] }, 0)) === 422);

// 3. Templates.
const half = await cutTemplateSlots('half-body');
check(
	'3. Half body is cut for, its slots in draw order',
	half.ok && half.value.slots.join() === HALF.join(),
	JSON.stringify(half),
);
const bust = await cutTemplateSlots('bust-face');
check(
	'3. a template without the Half body parts is refused, naming them',
	!bust.ok && bust.status === 422 && bust.message.includes('upper_arm_l'),
	JSON.stringify(bust),
);
const gone = await cutTemplateSlots('nope');
check('3. a template that is gone', !gone.ok && gone.status === 404);
const id = newJobId();
check(
	'3. a new job id is one the cut takes, under the project',
	JOB_ID.test(id) && jobRoot('acme', 'game1', id) === `${PREFIX}/rig-from-frame/${id}`,
	id,
);

// 4. The brushed label map: 6 × 4, background 255 round a character of parts 0..2.
const W = 6;
const H = 4;
const before = Uint8Array.from([
	255, 0, 0, 1, 1, 255, 255, 0, 0, 1, 1, 255, 255, 2, 2, 2, 2, 255, 255, 255, 255, 255, 255, 255,
]);
const grey = (px: Uint8Array) =>
	sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 1 } })
		.toColourspace('b-w')
		.png()
		.toBuffer();
const rgba = (px: Uint8Array, w = W, h = H) => {
	const out = Buffer.alloc(w * h * 4);
	px.forEach((v, i) => out.set([v, v, v, 255], i * 4));
	return sharp(out, { raw: { width: w, height: h, channels: 4 } })
		.png()
		.toBuffer();
};
const stored = await grey(before);
const moved = before.slice();
moved[1] = 1;
moved[7] = 2;
const okMap = await checkedLabels(await rgba(moved), stored, 3);
// sharp decodes to sRGB whatever the file holds: the file's own channels are its metadata's.
const meta = okMap.ok ? await sharp(okMap.value).metadata() : null;
const back = okMap.ok ? await sharp(okMap.value).extractChannel(0).raw().toBuffer() : null;
check(
	'4. pixels moved between parts are kept, as an 8-bit grey map',
	!!back &&
		meta?.channels === 1 &&
		meta.depth === 'uchar' &&
		Buffer.compare(back, Buffer.from(moved)) === 0,
	JSON.stringify(meta && { channels: meta.channels, space: meta.space, depth: meta.depth }),
);
const grown = before.slice();
grown[0] = 0;
const outline = await checkedLabels(await rgba(grown), stored, 3);
check(
	'4. a map that paints outside the character is refused',
	!outline.ok && outline.status === 400 && /outline/.test(outline.message),
);
const shrunk = before.slice();
shrunk[1] = 255;
check(
	'4. a map that erases part of the character is refused',
	!(await checkedLabels(await rgba(shrunk), stored, 3)).ok,
);
const unknown = before.slice();
unknown[2] = 7;
const named = await checkedLabels(await rgba(unknown), stored, 3);
check(
	'4. a map naming a part the cut has not is refused',
	!named.ok && /names a part/.test(named.message),
);
check(
	'4. a map of another size is refused',
	!(await checkedLabels(await rgba(new Uint8Array(4).fill(255), 2, 2), stored, 3)).ok,
);
check(
	'4. bytes that are not a PNG are refused',
	!(await checkedLabels(new Uint8Array([1, 2, 3]), stored, 3)).ok,
);

// 5. A kept cut found again when its clip is opened (F2b).
const keys = await clipFrameKeys(clip);
const cutOf = (extra: Partial<StoredCut>): StoredCut => ({
	job: 'f2r-test-01',
	template: 'half-body',
	size: [640, 610],
	names: [],
	parts: [],
	props: [],
	...extra,
});
const at = (frame: number) => {
	const r = clip.frames[frame].includes('::')
		? SETS[SHEET_B].regions[0]
		: SETS[SHEET_A].regions.find((x) => x.name === clip.frames[frame])!;
	const page = clip.frames[frame].includes('::') ? SETS[SHEET_B].pageKey : SETS[SHEET_A].pageKey;
	return { pageKey: page, region: r as { x: number; y: number; w: number; h: number } };
};
check(
	'5. a cut naming its clip is that clip frame',
	cutFrameOf(cutOf({ clip: { id: 'walk', frame: 2 }, source: at(1) }), 'walk', keys) === 2 &&
		cutFrameOf(cutOf({ clip: { id: 'run', frame: 2 }, source: at(1) }), 'walk', keys) === null,
);
check(
	'5. a cut from before cuts named their clip is found by the pixels it was cut from',
	cutFrameOf(cutOf({ source: at(1) }), 'walk', keys) === 1 &&
		cutFrameOf(cutOf({ source: at(2) }), 'walk', keys) === 2,
);
check(
	'5. … the first frame drawing those pixels, and none for pixels the clip does not draw',
	cutFrameOf(cutOf({ source: at(3) }), 'walk', keys) === 0 &&
		cutFrameOf(
			cutOf({ source: { pageKey: SETS[SHEET_A].pageKey, region: { x: 9, y: 9, w: 9, h: 9 } } }),
			'walk',
			keys,
		) === null,
);
check("5. a rig's images go to the sheet <name>_parts", partsSheetName('Nelly') === 'Nelly_parts');

if (failed) {
	console.error(`\n${failed} failed`);
	process.exit(1);
}
console.log('\nall passed');
