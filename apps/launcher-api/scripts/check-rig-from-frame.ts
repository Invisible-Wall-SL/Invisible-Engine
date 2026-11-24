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
 *  6. The edits a page keeps with a cut (F2d): a prop's ✓ / ✗, motion and the bone it hangs from
 *     (a template bone, not a control); a prop added (prop_ named, over a part, drawn over it) and
 *     removed (only with its label map); the parts never moved; a part taken from another kept
 *     cut and back; each name's size counted off the label map.
 *  7. ✂ Edit cut / 🔄 Update rig (F2j): an update writes the rig's sheet its bundle is NOT drawn
 *     from; a save takes the rig's `frame-source.json` on its ETag and refuses a stale, malformed or
 *     other rig's one, or one drawn from a sheet not the rig's or made again since; once stored, the
 *     bundle is synced from the sheet it names, and left alone when it already is.
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
// §7: R2 in memory, the bundle's atlas sync recorded, a sidecar's owner read as the save reads it.
const RIG_SHEET_A = `${PREFIX}/manifests/atlas_manifest_Nelly_parts.json`;
const RIG_SHEET_B = `${PREFIX}/manifests/atlas_manifest_Nelly_parts_b.json`;
for (const key of [RIG_SHEET_A, RIG_SHEET_B])
	SETS[key] = {
		pageKey: key.replace('.json', '.png'),
		regions: [{ name: 'torso', x: 0, y: 0, w: 9, h: 9 }],
	};
const store = new Map<string, { text: string; etag: string }>();
const remade = new Map<string, number>();
const synced: { bundle: string; atlas: string; manifestKey?: string }[] = [];
let syncFails = false;
mock.module(server('r2.ts'), {
	namedExports: {
		getObjectText: async (k: string) => store.get(k)?.text ?? null,
		getObjectTextWithEtag: async (k: string) => store.get(k) ?? null,
		getObjectBytes: async () => null,
		headObject: async (k: string) =>
			store.has(k) ? { etag: store.get(k)!.etag, size: 1, lastModified: 0 } : null,
		listAllKeys: async (p: string) => [...store.keys()].filter((k) => k.startsWith(p)),
	},
});
mock.module(server('rigBundleSync.ts'), {
	namedExports: {
		bundleRevision: async (rs: { assetKey: string }) =>
			`rev:${rs.assetKey}:${remade.get(rs.assetKey) ?? 0}`,
		ensureBundleAtlasFresh: async (
			_c: string,
			_p: string,
			bundle: string,
			atlas: string,
			opts: { manifestKey?: string },
		) => {
			if (syncFails) throw new Error('R2 is down');
			synced.push({ bundle, atlas, manifestKey: opts.manifestKey });
			return { changed: true };
		},
	},
});
mock.module(server('riggerIrigWrite.ts'), {
	namedExports: {
		sidecarOwner: (text: string) => {
			try {
				return (JSON.parse(text) as { rig?: string }).rig;
			} catch {
				return undefined;
			}
		},
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
	applyCutEdits,
	labelCounts,
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

// 6. The prop editor and per-part frames (F2d): the edits a page keeps with a cut.
const TPL = {
	slots: HALF.map((name) => ({ name, bone: name === 'torso' ? 'torso_image' : name })),
	bones: [
		...HALF.map((name) => ({ name })),
		{ name: 'chest' },
		{ name: 'torso_image', parent: 'chest' },
		{ name: 'hand_ik_l' },
	],
};
const base = cutOf({
	job: 'f2r-main-0001',
	names: ['head', 'torso', 'hand_l', 'prop_chain', 'prop_ring_l'],
	parts: ['head', 'torso', 'hand_l'].map((name) => ({ name, px: 10 })),
	props: [
		{
			name: 'prop_chain',
			bone: 'chest',
			after: 'neck',
			host: 'torso',
			take: true,
			motion: 'rides',
		},
		{ name: 'prop_ring_l', bone: 'hand_l', after: 'thumb_3_l', host: 'hand_l', take: true },
	],
});
const edit = (e: Parameters<typeof applyCutEdits>[1], relabelled = false) =>
	applyCutEdits(base, e, TPL, relabelled);
const set = edit({
	props: [{ name: 'prop_chain', take: false, motion: 'swings', bone: 'torso_image' }],
});
const chain = set.ok ? set.value.cut.props.find((p) => p.name === 'prop_chain') : null;
check(
	"6. a prop's ✓ / ✗, motion and the bone it hangs from are kept, the bone as the author's",
	!!chain &&
		chain.take === false &&
		chain.motion === 'swings' &&
		chain.bone === 'torso_image' &&
		chain.boneSet === true &&
		base.props[0].bone === 'chest',
	JSON.stringify(chain),
);
check(
	'6. … not a control, nor a bone the template has not, nor another prop',
	!edit({ props: [{ name: 'prop_chain', bone: 'hand_ik_l' }] }).ok &&
		!edit({ props: [{ name: 'prop_chain', bone: 'tail' }] }).ok &&
		!edit({ props: [{ name: 'prop_chain', bone: 'prop_ring_l' }] }).ok &&
		!edit({ props: [{ name: 'prop_chain', motion: 'flies' }] }).ok,
);
const added = edit({
	names: [...base.names, 'prop_watch', 'prop_hat'],
	props: [
		{ name: 'prop_watch', host: 'hand_l' },
		{ name: 'prop_hat', host: 'head' },
	],
});
const watch = added.ok ? added.value.cut.props.find((p) => p.name === 'prop_watch') : null;
const hat = added.ok ? added.value.cut.props.find((p) => p.name === 'prop_hat') : null;
check(
	'6. a prop added is drawn just over the part it is painted on, after the last finger on an arm, riding that part’s bone',
	added.ok &&
		added.value.cut.names.length === 7 &&
		watch?.after === 'thumb_3_l' &&
		watch.bone === 'hand_l' &&
		watch.take === true &&
		hat?.after === 'head' &&
		hat.host === 'head',
	JSON.stringify(added),
);
check(
	'6. a prop added needs a prop_ name, a part under it and a place in the names',
	!edit({ names: [...base.names, 'watch'], props: [{ name: 'watch', host: 'hand_l' }] }).ok &&
		!edit({ names: [...base.names, 'prop_w'], props: [{ name: 'prop_w', host: 'prop_chain' }] })
			.ok &&
		!edit({ props: [{ name: 'prop_w', host: 'hand_l' }] }).ok,
);
const dropped = { names: ['head', 'torso', 'hand_l', 'prop_ring_l'] };
const gone2 = edit(dropped, true);
check(
	'6. a prop removed goes with its label map (its pixels given back), never without',
	!edit(dropped).ok &&
		gone2.ok &&
		gone2.value.cut.props.map((p) => p.name).join() === 'prop_ring_l',
);
check(
	"6. the cut's parts stay as they are, first and in order; a prop is named once",
	!edit({ names: ['torso', 'head', 'hand_l', 'prop_chain', 'prop_ring_l'] }, true).ok &&
		!edit({ names: [...base.names, 'prop_chain'] }, true).ok,
);
const src = edit({ sources: { torso: 'f2r-other-0002', head: null } });
const undone = src.ok
	? applyCutEdits(src.value.cut, { sources: { torso: null } }, TPL, false)
	: null;
check(
	'6. a part is taken from another kept cut and back; the cut checks that cut exists',
	src.ok &&
		src.value.cut.sources?.torso === 'f2r-other-0002' &&
		src.value.jobs.join() === 'f2r-other-0002' &&
		!!undone?.ok &&
		undone.value.cut.sources === undefined,
	JSON.stringify(src),
);
check(
	'6. … a part, not a prop, from another cut, not its own',
	!edit({ sources: { prop_chain: 'f2r-other-0002' } }).ok &&
		!edit({ sources: { torso: 'f2r-main-0001' } }).ok &&
		!edit({ sources: { torso: '../x' } }).ok,
);
check(
	"6. each name's size is counted off the label map",
	labelCounts(Uint8Array.from([0, 0, 1, 255, 2, 2, 2]), 3).join() === '2,1,3',
);

// 7. ✂ Edit cut / 🔄 Update rig (F2j): the sheet an update writes, and what a save does with the
//    rig's frame-source.json. The bundle re-syncs from its source sheet on every read, so an update
//    writes the rig's OTHER sheet and the save points the bundle at it once the `.irig` is stored.
const F = await import('../src/lib/server/rigFrameSourceStore');
check(
	"7. an update writes the rig's sheet its bundle is not drawn from, the two in turn",
	F.updateSheet('acme', 'game1', 'Nelly', RIG_SHEET_A) === 'Nelly_parts_b' &&
		F.updateSheet('acme', 'game1', 'Nelly', RIG_SHEET_B) === 'Nelly_parts' &&
		F.updateSheet('acme', 'game1', 'Nelly', '') === 'Nelly_parts' &&
		F.updateSheet('acme', 'game1', 'Nelly', SHEET_A) === 'Nelly_parts',
);
const bundle = `${PREFIX}/spines/Nelly`;
const target = {
	dir: 'Nelly',
	stem: 'Nelly',
	key: `${bundle}/Nelly.irig`,
	rigsPrefix: `${PREFIX}/spines`,
	backupsPrefix: '',
	sidecarKeys: {
		rig3d: `${bundle}/rig3d.json`,
		controls: `${bundle}/controls.json`,
		frame: `${bundle}/frame-source.json`,
	},
};
const source = {
	frameSource: 1,
	rig: 'Nelly',
	template: { id: 'half-body', version: 1 },
	clip: { id: 'nelly', frame: 1 },
	job: 'f2r-main-0001',
	cutEtag: '"c1"',
	sources: {},
	frames: {},
	props: [],
	parts: { torso: { slot: 'torso', hash: 'abc' } },
	art: RIG_SHEET_B,
	artRevision: `rev:${RIG_SHEET_B}:0`,
	made: '2026-11-24T00:00:00Z',
};
store.set(`${bundle}/source.json`, {
	text: JSON.stringify({ manifestKey: RIG_SHEET_A }),
	etag: '"s1"',
});
store.set(target.sidecarKeys.frame, {
	text: JSON.stringify({ ...source, art: RIG_SHEET_A }),
	etag: '"f1"',
});
store.set(`${bundle}/Nelly.atlas`, { text: 'Nelly_parts.png', etag: '"a1"' });
const planOf = async (doc: unknown, baseEtag: string | null | undefined) => {
	const p = await F.framePlan('acme', 'game1', target as never, '"r1"', { doc, baseEtag });
	if (p.ok) return { ok: true as const, p };
	return {
		ok: false as const,
		status: p.response.status,
		body: (await p.response.json()) as { error?: string; frameEtag?: string; message?: string },
	};
};
const good = await planOf(source, '"f1"');
check(
	"7. a save takes an update's frame source on its ETag, marked as the rig's",
	good.ok &&
		good.p.ok &&
		good.p.doc?.art === RIG_SHEET_B &&
		JSON.parse(good.p.plan?.next ?? '{}').rig === 'Nelly' &&
		good.p.plan?.ours === true,
	JSON.stringify(good),
);
const kept = await F.framePlan('acme', 'game1', target as never, '"r1"');
check(
	'7. a save that sends none keeps the stored one',
	kept.ok && kept.doc === null && kept.plan === undefined,
);
const stale = await planOf(source, '"f0"');
check(
	'7. … refuses one sent on an older ETag (a 409 naming the stored one)',
	!stale.ok &&
		stale.status === 409 &&
		stale.body.error === 'conflict' &&
		stale.body.frameEtag === '"f1"',
	JSON.stringify(stale),
);
const bad = await planOf({ ...source, job: '../x', extra: 1 }, '"f1"');
check(
	'7. … a malformed one (422)',
	!bad.ok && bad.status === 422 && bad.body.error === 'frame-invalid',
	JSON.stringify(bad),
);
const foreign = await planOf({ ...source, art: SHEET_A, artRevision: `rev:${SHEET_A}:0` }, '"f1"');
check(
	"7. … one drawn from a sheet that is not the rig's",
	!foreign.ok &&
		foreign.status === 409 &&
		foreign.body.error === 'frame-art' &&
		/not this rig's/.test(foreign.body.message ?? ''),
	JSON.stringify(foreign),
);
remade.set(RIG_SHEET_B, 1);
const again = await planOf(source, '"f1"');
check(
	'7. … one whose sheet a later update made again (its meshes are for other art)',
	!again.ok && again.status === 409 && /made again/.test(again.body.message ?? ''),
	JSON.stringify(again),
);
remade.delete(RIG_SHEET_B);
// An undo across two updates: the source names the sheet the bundle is drawn from, made again since.
const onLive = { ...source, art: RIG_SHEET_A, artRevision: `rev:${RIG_SHEET_A}:0` };
const liveOk = await planOf(onLive, '"f1"');
remade.set(RIG_SHEET_A, 1);
const liveRemade = await planOf(onLive, '"f1"');
remade.delete(RIG_SHEET_A);
check(
	'7. … one drawn from the sheet the bundle already draws, when that sheet was made again since',
	liveOk.ok &&
		!liveRemade.ok &&
		liveRemade.status === 409 &&
		/made again/.test(liveRemade.body.message ?? ''),
	JSON.stringify({ liveOk, liveRemade }),
);
store.set(`${PREFIX}/spines/Villain/source.json`, {
	text: JSON.stringify({ manifestKey: RIG_SHEET_B }),
	etag: '"v1"',
});
const drawnBy = await F.rigsDrawnFrom('acme', 'game1', RIG_SHEET_B, bundle);
const notOwn = await F.rigsDrawnFrom('acme', 'game1', RIG_SHEET_A, bundle);
store.delete(`${PREFIX}/spines/Villain/source.json`);
check(
	"7. an update refuses a sheet another rig draws from (⟳ source…), never counting the rig's own",
	drawnBy.join() === 'Villain' && notOwn.length === 0,
	JSON.stringify({ drawnBy, notOwn }),
);
store.set(target.sidecarKeys.frame, {
	text: JSON.stringify({ ...source, rig: 'Other' }),
	etag: '"f1"',
});
const theirs = await planOf(source, '"f1"');
check(
	"7. … and another rig's source in the folder",
	!theirs.ok && theirs.body.error === 'frame-other-rig',
	JSON.stringify(theirs),
);
const switched = await F.switchFrameArt('acme', 'game1', target as never, source as never);
const same = await F.switchFrameArt(
	'acme',
	'game1',
	target as never,
	{ ...source, art: RIG_SHEET_A } as never,
);
check(
	'7. once stored, the bundle is synced from the sheet the source names, and left alone when it is drawn from it',
	switched &&
		same &&
		synced.length === 1 &&
		synced[0].manifestKey === RIG_SHEET_B &&
		synced[0].atlas === 'Nelly.atlas' &&
		synced[0].bundle === bundle,
	JSON.stringify(synced),
);
remade.set(RIG_SHEET_B, 1);
const lateRemade = await F.switchFrameArt('acme', 'game1', target as never, source as never);
remade.delete(RIG_SHEET_B);
syncFails = true;
const failing = await F.switchFrameArt('acme', 'game1', target as never, source as never);
syncFails = false;
check(
	'7. … not synced from a sheet made again since the save checked it, and a failing sync answers false, never throws',
	!lateRemade && !failing && synced.length === 1,
	JSON.stringify({ lateRemade, failing, synced: synced.length }),
);

if (failed) {
	console.error(`\n${failed} failed`);
	process.exit(1);
}
console.log('\nall passed');
