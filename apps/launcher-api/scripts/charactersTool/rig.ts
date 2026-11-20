/**
 * §13 of `check:characters-tool`: the rig side of a character sheet (character pipeline C6b).
 * What a rig costs to draw and what it names, read by the runtime's own parser; the preview's
 * tiles through the game's resolver; the Rigger's link by bundle name; and the two reads
 * (`GET /api/characters/whole`, `GET /api/characters/rig`) driven for real over the gate's
 * in-memory R2, behind the real tool gate.
 */
import { readFileSync } from 'node:fs';
import { isHttpError } from '@sveltejs/kit';
import { compile } from 'svelte/compiler';
import {
	BoundingBoxAttachment,
	ClippingAttachment,
	MeshAttachment,
	PathAttachment,
	PointAttachment,
	RegionAttachment,
	SkeletonJson,
	type AttachmentLoader,
} from 'engine-rig';
import type { CharacterSheet } from 'game-config';

import {
	RIG_COST_TIP,
	rigCostOf,
	rigCostVerdict,
	rigFactsOf,
} from '../../src/lib/characters/rigCost.ts';
import type { RigCost, RigFacts } from '../../src/lib/characters/rigFacts.ts';
import {
	sheetRigCaption,
	sheetRigFrameAt,
	sheetRigLoops,
	sheetRigTileBox,
	sheetRigTiles,
} from '../../src/lib/characters/sheetRigTiles.ts';
import { riggerLinkFor, riggerRigHash } from '../../src/lib/riggerLinks.ts';
import type { Section } from './harness';
import { fakeServerModule } from './routes.ts';
import { standIns } from './routeStandIns.ts';

const src = (rel: string): string => new URL(`../../src/${rel}`, import.meta.url).href;
const text = (rel: string): string =>
	readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const lines = (rel: string): unknown =>
	JSON.parse(
		readFileSync(new URL(`../../../lines/static/assets/spines/${rel}`, import.meta.url), 'utf8'),
	);

type Slot = { name: string; blend?: string; dark?: string; color?: string; attachment?: string };

/** A 4.2 skeleton of one bone: `slots` in draw order, each showing the attachment of its own
 *  name, of `types[name]` (a region when left out). */
function rig(
	slots: Slot[],
	types: Record<string, string> = {},
	more: Record<string, unknown> = {},
): Record<string, unknown> {
	const mesh = {
		type: 'mesh',
		uvs: [0, 0, 1, 0, 1, 1],
		triangles: [0, 1, 2],
		vertices: [0, 0, 10, 0, 10, 10],
		hull: 3,
	};
	const attachment = (slot: Slot): Record<string, unknown> => {
		const type = types[slot.name];
		if (type === 'mesh') return mesh;
		// A linked mesh takes its shape from a mesh of its own slot.
		if (type === 'linkedmesh') return { type, parent: 'shape' };
		if (type === 'clipping')
			return { type, end: slot.name, vertexCount: 3, vertices: [0, 0, 9, 0, 9, 9] };
		if (type === 'boundingbox' || type === 'path')
			return { type, vertexCount: 3, vertices: [0, 0, 9, 0, 9, 9], lengths: [1, 2, 3] };
		if (type === 'point') return { type };
		return { width: 10, height: 10 };
	};
	return {
		skeleton: { spine: '4.2.0', x: -50, y: 0, width: 100, height: 200 },
		bones: [{ name: 'root' }, { name: 'hand', parent: 'root' }],
		slots: slots.map((slot) => ({
			bone: 'root',
			...slot,
			...(slot.attachment === '' ? { attachment: undefined } : { attachment: slot.name }),
		})),
		skins: [
			{
				name: 'default',
				attachments: Object.fromEntries(
					slots.map((slot) => [
						slot.name,
						{
							[slot.name]: attachment(slot),
							...(types[slot.name] === 'linkedmesh' ? { shape: mesh } : {}),
						},
					]),
				),
			},
		],
		animations: {},
		...more,
	};
}

const counts = ({ drawCalls, blendSwitches, darkTintSlots, drawnSlots }: RigCost): number[] => [
	drawCalls,
	blendSwitches,
	darkTintSlots,
	drawnSlots,
];

export const run: Section = async (t) => {
	// ── What a rig costs ───────────────────────────────────────────────────────────────────────
	t.same(
		'13. three slots of one blend mode are one draw call',
		counts(rigCostOf(rig([{ name: 'a' }, { name: 'b' }, { name: 'c' }]))),
		[1, 0, 0, 3],
	);
	t.same(
		'13. normal, additive, normal: three draw calls, two changes of blend',
		counts(rigCostOf(rig([{ name: 'a' }, { name: 'b', blend: 'additive' }, { name: 'c' }]))),
		[3, 2, 0, 3],
	);
	t.same(
		'13. two additive neighbours share a draw call',
		counts(
			rigCostOf(
				rig([
					{ name: 'a' },
					{ name: 'b', blend: 'additive' },
					{ name: 'c', blend: 'additive' },
					{ name: 'd' },
				]),
			),
		),
		[3, 2, 0, 4],
	);
	t.same(
		'13. a dark-tint slot is its own draw call and splits the slots around it',
		counts(rigCostOf(rig([{ name: 'a' }, { name: 'b', dark: 'ff0000' }, { name: 'c' }]))),
		[3, 0, 1, 3],
	);
	t.same(
		'13. … and each dark-tint slot is one more, side by side too',
		counts(
			rigCostOf(
				rig([
					{ name: 'a', dark: '000000' },
					{ name: 'b', dark: '000000' },
					{ name: 'c' },
					{ name: 'd' },
				]),
			),
		),
		[3, 0, 2, 4],
	);
	t.same(
		'13. a clipping mask, a point, a path, a bounding box, an empty slot and one of no alpha draw nothing',
		counts(
			rigCostOf(
				rig(
					[
						{ name: 'a' },
						{ name: 'clip', blend: 'additive' },
						{ name: 'point', blend: 'additive' },
						{ name: 'path', blend: 'additive' },
						{ name: 'box', blend: 'additive' },
						{ name: 'empty', blend: 'additive', attachment: '' },
						{ name: 'clear', blend: 'additive', color: 'ffffff00' },
						{ name: 'b' },
					],
					{ clip: 'clipping', point: 'point', path: 'path', box: 'boundingbox' },
				),
			),
		),
		[1, 0, 0, 2],
	);
	t.same(
		'13. a mesh and a linked mesh are drawn as a region is',
		counts(
			rigCostOf(
				rig([{ name: 'mesh' }, { name: 'linked', blend: 'screen' }], {
					mesh: 'mesh',
					linked: 'linkedmesh',
				}),
			),
		),
		[2, 1, 0, 2],
	);
	const flash = rig(
		[{ name: 'a' }, { name: 'glow', blend: 'additive', attachment: '' }, { name: 'b' }],
		{},
		{
			animations: {
				idle: { bones: { root: { rotate: [{ time: 0 }, { time: 1, value: 10 }] } } },
				flash: { slots: { glow: { attachment: [{ time: 0.5, name: 'glow' }] } } },
			},
		},
	);
	t.same(
		'13. the cost is the dearest pose: an animation that shows an additive slot is counted',
		counts(rigCostOf(flash)),
		[3, 2, 0, 3],
	);
	const skinned = rig([{ name: 'a' }, { name: 'coat', blend: 'additive' }]);
	const [base] = skinned.skins as { name: string; attachments: Record<string, unknown> }[];
	skinned.skins = [
		{ name: 'default', attachments: { a: base.attachments.a } },
		{ name: 'gold', attachments: { coat: base.attachments.coat } },
	];
	t.same(
		'13. a rig whose art is in skins is counted wearing its first',
		counts(rigCostOf(skinned)),
		[2, 1, 0, 2],
	);
	t.same('13. the bones are counted', rigCostOf(rig([{ name: 'a' }])).bones, 2);

	// The rigs the C6a cost was measured on (`docs/status/game-families.md`: 4 to 7 draw calls a
	// rig that mixes normal and additive, about 70 for the one with dark-tint slots). The exact
	// numbers are the ones `tools/rigger-spike/rig-draw-calls-browser.mjs` counts on a WebGL context.
	const light = rigFactsOf('h3', lines('symbols/h3.json'));
	const loader = rigFactsOf('loader', lines('loader/loader.json'));
	const dark = rigFactsOf('reelhouse_glow', lines('reelhouse/reelhouse_glow.json'));
	t.same(
		'13. the 23-bone rig C6a called light: 6 draw calls in its dearest pose, in the 4 to 7 measured',
		[light.cost, light.cost.drawCalls >= 4 && light.cost.drawCalls <= 7],
		[{ drawCalls: 6, blendSwitches: 5, darkTintSlots: 0, drawnSlots: 12, bones: 23 }, true],
	);
	t.same(
		'13. the 66-bone rig: 8',
		counts(loader.cost).concat(loader.cost.bones),
		[8, 7, 0, 31, 66],
	);
	t.same(
		'13. the dark-tint rig: 96 draw calls, 94 of them dark-tint slots, past the 70 measured',
		[dark.cost, dark.cost.drawCalls >= 70],
		[{ drawCalls: 96, blendSwitches: 1, darkTintSlots: 94, drawnSlots: 98, bones: 121 }, true],
	);
	t.same(
		'13. the verdicts: light, heavy (not tried in a crowd), too heavy',
		[light, loader, dark].map((f) => rigCostVerdict(f.cost).level),
		['light', 'heavy', 'tooHeavy'],
	);
	const at = (drawCalls: number, darkTintSlots = 0): ReturnType<typeof rigCostVerdict> =>
		rigCostVerdict({ drawCalls, darkTintSlots, blendSwitches: 0, drawnSlots: drawCalls, bones: 1 });
	t.same(
		'13. only what was measured is claimed: light up to 7, too heavy from 70, heavy between',
		[0, 1, 7, 8, 69, 70, 200].map((n) => at(n).level),
		['light', 'light', 'light', 'heavy', 'heavy', 'tooHeavy', 'tooHeavy'],
	);
	const oneSentence = (s: string): boolean => /^[^.]*\.$/.test(s.replace(/\([^)]*\)/g, ''));
	t.check(
		'13. a verdict is one sentence, and says where the measure was taken',
		[1, 8, 70].every(
			(n) =>
				oneSentence(at(n).text) &&
				at(n).text.includes('measured on a software rasteriser, not a phone'),
		),
		[1, 8, 70].map((n) => at(n).text).join(' | '),
	);
	t.check(
		'13. a heavy verdict says what the draw calls are for',
		at(9, 4).text.includes('4 of them for slots with a dark tint') &&
			at(9).text.includes('change of blend mode') &&
			at(1).text.includes('1 draw call a character'),
		`${at(9, 4).text} | ${at(9).text} | ${at(1).text}`,
	);
	t.check('13. the tooltip is one sentence', oneSentence(RIG_COST_TIP), RIG_COST_TIP);

	// ── What a rig names ───────────────────────────────────────────────────────────────────────
	// The game's reader, set up here on its own: the lists must be the ones it builds.
	const noArt: AttachmentLoader = {
		newRegionAttachment: (_skin, name, path) => new RegionAttachment(name, path),
		newMeshAttachment: (_skin, name, path) => new MeshAttachment(name, path),
		newBoundingBoxAttachment: (_skin, name) => new BoundingBoxAttachment(name),
		newPathAttachment: (_skin, name) => new PathAttachment(name),
		newPointAttachment: (_skin, name) => new PointAttachment(name),
		newClippingAttachment: (_skin, name) => new ClippingAttachment(name),
	};
	for (const [name, file] of [
		['M', 'symbols2/M.json'],
		['anticipation', 'anticipation/anticipation.json'],
		['reelhouse_glow', 'reelhouse/reelhouse_glow.json'],
	] as const) {
		const json = lines(file) as { animations: Record<string, unknown> };
		const data = new SkeletonJson(noArt).readSkeletonData(structuredClone(json));
		const facts = rigFactsOf(name, json);
		t.same(
			`13. ${name}: the animations and their lengths, the skins and the bones are the runtime's`,
			[facts.name, facts.animations, facts.skins, facts.bones],
			[
				name,
				data.animations.map((a) => ({ name: a.name, durationMs: Math.round(a.duration * 1000) })),
				data.skins.map((s) => s.name),
				data.bones.map((b) => b.name),
			],
		);
		t.same(
			`13. ${name}: every animation of the file is listed`,
			facts.animations.map((a) => a.name),
			Object.keys(json.animations),
		);
	}
	t.same(
		'13. a length is the last key of the animation, in ms',
		rigFactsOf('flash', flash).animations,
		[
			{ name: 'idle', durationMs: 1000 },
			{ name: 'flash', durationMs: 500 },
		],
	);
	let unread = '';
	try {
		rigFactsOf('bad', { bones: [{ name: 'a', parent: 'missing' }] });
	} catch (e) {
		unread = String(e);
	}
	t.check('13. a skeleton the runtime cannot read throws its reason', unread !== '', unread);

	// ── The preview's tiles: the game's resolver over the rigs read ────────────────────────────
	const facts = (name: string, animations: string[], skins: string[] = ['default']): RigFacts => ({
		name,
		animations: animations.map((a) => ({ name: a, durationMs: a === 'pose' ? 0 : 800 })),
		skins,
		bones: ['root'],
		cost: { drawCalls: 1, blendSwitches: 0, darkTintSlots: 0, drawnSlots: 1, bones: 1 },
	});
	const sheet: CharacterSheet = {
		view: { kind: 'isometric' },
		source: { kind: 'rig', rig: 'fox', variants: { marked: 'gold' } },
		draw: { width: 90, feet: 0.8 },
		actions: [
			{ id: 'walk', when: { motion: 'moving' } },
			{ id: 'jump', when: { event: 'jump' } },
			{ id: 'nap' },
		],
	};
	const fox = { fox: facts('fox', ['walk', 'jump_se', 'pose'], ['default', 'gold']) };
	const cells = (tiles: ReturnType<typeof sheetRigTiles>): unknown[] =>
		tiles.map((tile) => [
			tile.facing,
			tile.found?.rig ?? null,
			tile.found?.animation ?? null,
			tile.found?.flipX ?? null,
			tile.found?.skin ?? null,
		]);
	t.same(
		'13. one rig with `walk`: every facing of the view, mirrored where it looks west',
		cells(sheetRigTiles(sheet, 'walk', [], fox)),
		[
			['ne', 'fox', 'walk', false, null],
			['se', 'fox', 'walk', false, null],
			['sw', 'fox', 'walk', true, null],
			['nw', 'fox', 'walk', true, null],
		],
	);
	t.same(
		'13. an animation named for a facing is drawn as made, and its mirror twin mirrored',
		cells(sheetRigTiles(sheet, 'jump', [], fox)).slice(1, 3),
		[
			['se', 'fox', 'jump_se', false, null],
			['sw', 'fox', 'jump_se', true, null],
		],
	);
	t.same(
		'13. a status that holds wears its skin, when the rig has it',
		[
			cells(sheetRigTiles(sheet, 'walk', ['marked'], fox))[0],
			cells(sheetRigTiles(sheet, 'walk', ['marked'], { fox: facts('fox', ['walk']) }))[0],
		],
		[
			['ne', 'fox', 'walk', false, 'gold'],
			['ne', 'fox', 'walk', false, null],
		],
	);
	const none = sheetRigTiles(sheet, 'nap', [], fox);
	t.same(
		'13. an action with no animation, and a rig not read yet: every tile is empty and says "—"',
		[
			cells(none).map((c) => (c as unknown[])[1]),
			none.map((tile) => sheetRigCaption(tile, 'nap')),
			cells(sheetRigTiles(sheet, 'walk', [], {})).map((c) => (c as unknown[])[1]),
		],
		[
			[null, null, null, null],
			['—', '—', '—', '—'],
			[null, null, null, null],
		],
	);
	t.same(
		'13. a 3D view has no tile',
		sheetRigTiles({ ...sheet, view: { kind: '3d' } }, 'walk', [], fox),
		[],
	);
	const [, jumpSe, jumpSw] = sheetRigTiles(sheet, 'jump', [], fox);
	t.same(
		'13. the captions say the rig, the animation, the mirror and whose it is',
		[sheetRigCaption(jumpSe, 'jump'), sheetRigCaption(jumpSw, 'jump')],
		['fox: jump_se', 'fox: jump_se, mirrored'],
	);
	t.same(
		'13. a loop is one play; a one-shot is played again after its length and a rest',
		[
			[sheetRigLoops(sheet, 'walk'), sheetRigLoops(sheet, 'jump'), sheetRigLoops(sheet, 'nap')],
			[0, 1499, 1500, 3000].map((ms) => sheetRigFrameAt(jumpSw, false, ms).play),
			[0, 9000].map((ms) => sheetRigFrameAt(jumpSw, true, ms).play),
			sheetRigFrameAt(jumpSw, false, 0),
		],
		[
			[true, false, true],
			[0, 0, 1, 2],
			[0, 0],
			{
				rig: 'fox',
				animation: 'jump_se',
				skin: undefined,
				flipX: true,
				loop: false,
				play: 0,
				action: 'jump',
				variant: undefined,
			},
		],
	);
	t.same(
		'13. a tile holds the draw box at the size shown, with its feet where the sheet puts them',
		[sheetRigTileBox(sheet, 1, 2), sheetRigTileBox(sheet, 2, 2).width],
		[{ width: 155, height: 245, placeX: 77.5, placeY: 177 }, 290],
	);

	const preview = text('src/lib/characters/SheetRigPreview.svelte');
	const compiled = ((): string => {
		try {
			return compile(preview, { filename: 'SheetRigPreview.svelte', generate: 'client' }).js.code;
		} catch (e) {
			return `does not compile: ${String(e)}`;
		}
	})();
	t.check(
		'13. the preview draws with the game’s look, on one Pixi application, in Flipbook’s compass',
		!compiled.startsWith('does not compile') &&
			compiled.includes('createSheetRigLook') &&
			preview.includes("import('engine-layout/sheet-rig')") &&
			preview.includes('sheetRigTiles(sheet, action, statuses, rigs)') &&
			preview.includes("from '$lib/flipbook/characterSet'") &&
			preview.includes('compassAreas(') &&
			(preview.match(/new Application\(/g) ?? []).length === 1 &&
			(preview.match(/<canvas/g) ?? []).length === 1,
		compiled.slice(0, 300),
	);
	t.check(
		'13. … each tile carries what it draws for a probe, and everything is destroyed on unmount',
		['data-rig-tile=', 'data-rig=', 'data-animation=', 'data-flip=', 'data-skin='].every((a) =>
			preview.includes(a),
		) &&
			preview.includes('cell.look?.destroy()') &&
			preview.includes('app.destroy('),
	);

	// ── The Rigger's link by bundle name ───────────────────────────────────────────────────────
	t.same(
		'13. the link to the Rigger names the rig, and the project when given',
		[riggerLinkFor('fox'), riggerLinkFor('fox tail/α', 'p1')],
		['/rigger?rig=fox', '/rigger?project=p1&rig=fox+tail%2F%CE%B1'],
	);
	t.same(
		'13. `/rigger` hands the rig on as the page’s hash; no rig, no hash',
		[
			riggerRigHash(new URL(`https://x${riggerLinkFor('fox tail/α', 'p1')}`).searchParams),
			riggerRigHash(new URLSearchParams('project=p1')),
			riggerRigHash(new URLSearchParams('rig=%20')),
		],
		['#rig=fox+tail%2F%CE%B1', '', ''],
	);
	const redirect = text('src/routes/(app)/rigger/+page.server.ts');
	const view = text('static/rigger/view.html');
	t.check(
		'13. the redirect carries it, and the page opens the rig of that folder or says it has none',
		redirect.includes('${riggerRigHash(url.searchParams)}`') &&
			view.includes('const rig = h.get("rig");') &&
			view.includes('skeletons.find(x => x.folder === rig)') &&
			view.includes('This project has no rig named'),
	);
	t.same(
		'13. the page reads the hash as the link writes it',
		new URLSearchParams(riggerRigHash(new URLSearchParams({ rig: 'fox tail/α' })).slice(1)).get(
			'rig',
		),
		'fox tail/α',
	);

	// ── The two reads, for real ────────────────────────────────────────────────────────────────
	const CLIENT = 'acme';
	const PROJECT = 'cloud';
	fakeServerModule('lib/server/auth.ts', {
		SESSION_COOKIE: 'session',
		getActiveScope: async () => ({ clientKey: CLIENT, projectKey: PROJECT }),
	});
	// §10 replaced `toolScope` whole; a second copy of the module is the real gate, over the
	// stored grants `routes.ts` empties, so a role holds exactly `ROLE_TOOLS`.
	const { gate } = (await import(`${src('lib/server/toolScope.ts')}?section=13`)) as {
		gate: (...args: unknown[]) => Promise<unknown>;
	};
	standIns.gate = gate;

	const r2 = (await import(src('lib/server/r2.ts'))) as {
		putObjectText: (key: string, body: string, type: string) => Promise<string>;
		listAllObjects: (prefix: string) => Promise<{ key: string }[]>;
	};
	const put = (key: string, body: unknown): Promise<string> =>
		r2.putObjectText(key, typeof body === 'string' ? body : JSON.stringify(body), 'text/plain');
	const atlas = (page: string): string =>
		`${page}\nsize: 64, 64\nfilter: Linear, Linear\na\nbounds: 0, 0, 10, 10\n`;
	const entry = (folder: string, format: 'json' | 'skel' = 'json'): Record<string, unknown> => ({
		name: `${folder}/${folder}`,
		folder,
		skeleton_file: `${folder}.${format}`,
		atlas_file: `${folder}.atlas`,
		format,
		runtime: '4.2',
		pma: false,
		dir_b64: '',
	});
	const bundle = async (root: string, folder: string, skeleton: unknown): Promise<void> => {
		await put(`${root}/${folder}/${folder}.json`, skeleton);
		await put(`${root}/${folder}/${folder}.atlas`, atlas(`${folder}.png`));
		await put(`${root}/${folder}/${folder}.png`, 'png');
	};
	const own = `${CLIENT}/${PROJECT}/spines`;
	await bundle(own, 'fox', flash);
	await bundle(own, 'broken', '{ not json');
	await put(`${own}/unlisted/unlisted.json`, flash);
	await put(`${own}/skeletons.json`, { skeletons: [entry('fox'), entry('broken')] });
	await bundle('_shared/spines', 'crate', rig([{ name: 'a' }]));
	await bundle('_shared/spines', 'fox', rig([{ name: 'a' }]));
	await put('_shared/spines/skeletons.json', { skeletons: [entry('crate'), entry('fox')] });
	await bundle(`${CLIENT}/elsewhere/spines`, 'secret', flash);
	await put(`${CLIENT}/elsewhere/spines/skeletons.json`, { skeletons: [entry('secret')] });
	const before = (await r2.listAllObjects('')).map((o) => o.key).sort();

	const routes = {
		whole: (
			(await import(src('routes/api/characters/whole/+server.ts'))) as {
				GET: (event: never) => Promise<Response>;
			}
		).GET,
		rig: (
			(await import(src('routes/api/characters/rig/+server.ts'))) as {
				GET: (event: never) => Promise<Response>;
			}
		).GET,
	};
	type Answer = { status: number; body: Record<string, unknown> };
	const ask = async (
		route: keyof typeof routes,
		query: string,
		role: string | null = 'developer',
	): Promise<Answer> => {
		const url = new URL(`https://launcher.test/api/characters/${route}${query}`);
		try {
			const res = await routes[route]({
				url,
				request: new Request(url),
				locals: { user: role ? { id: 'u1', role } : null },
				cookies: { get: () => 'token' },
			} as never);
			return { status: res.status, body: (await res.json()) as Record<string, unknown> };
		} catch (e) {
			if (!isHttpError(e)) throw e;
			return { status: e.status, body: e.body as Record<string, unknown> };
		}
	};

	t.same(
		'13. both reads are refused without the Characters grant, and with no session',
		[
			await ask('whole', '', 'localizationReviewer'),
			await ask('rig', '?name=fox', 'localizationReviewer'),
			(await ask('whole', '', null)).status,
			(await ask('rig', '?name=fox', null)).status,
		],
		[
			{ status: 403, body: { message: 'Your role does not have access to Invisible Characters.' } },
			{ status: 403, body: { message: 'Your role does not have access to Invisible Characters.' } },
			401,
			401,
		],
	);
	t.same(
		'13. … and for a tab left on another project',
		[
			(await ask('whole', '?projectKey=elsewhere')).status,
			(await ask('rig', '?name=fox&projectKey=elsewhere')).status,
			(await ask('rig', `?name=fox&projectKey=${PROJECT}`)).status,
		],
		[409, 409, 200],
	);

	const { readCharacterClips } = await import('../../src/lib/server/characterClipsRead.ts');
	const { loadDocWithEtag } = await import('../../src/lib/server/editorStorage.ts');
	const direct = await readCharacterClips(CLIENT, PROJECT);
	const layout = await loadDocWithEtag(CLIENT, PROJECT);
	const whole = await ask('whole', '');
	t.same(
		'13. the whole read still answers what it did: components, clip ids, clips, projections',
		[
			whole.status,
			whole.body.ok,
			whole.body.components,
			whole.body.clipIds,
			whole.body.clips,
			whole.body.projections,
		],
		JSON.parse(
			JSON.stringify([
				200,
				true,
				direct.components.map(({ id, name, scope, characterClips }) => ({
					id,
					name,
					scope,
					...(characterClips ? { characterClips } : {}),
				})),
				direct.clipIds,
				direct.clips,
				[...new Set(layout.doc.scenes.flatMap((s) => (s.projection ? [s.projection] : [])))],
			]),
		),
	);
	t.same(
		'13. … and the project’s rigs by bundle name: its own, then the shared ones it does not shadow',
		[whole.body.rigs, 'rigsError' in whole.body],
		[
			[
				{ name: 'broken', shared: false },
				{ name: 'fox', shared: false },
				{ name: 'unlisted', shared: false },
				{ name: 'crate', shared: true },
			],
			false,
		],
	);
	standIns.listingFault = { under: '/spines/', message: 'R2 is not answering' };
	const faulted = await ask('whole', '');
	const rigFaulted = await ask('rig', '?name=fox').catch((e: unknown) => String(e));
	standIns.listingFault = undefined;
	t.same(
		'13. a rig listing that fails leaves the rest readable, and says why',
		[
			faulted.status,
			faulted.body.rigs,
			faulted.body.rigsError,
			faulted.body.components,
			faulted.body.clipIds,
			faulted.body.projections,
		],
		[
			200,
			[],
			"The project's rigs could not be listed: R2 is not answering",
			whole.body.components,
			whole.body.clipIds,
			whole.body.projections,
		],
	);
	t.check(
		'13. … while one rig’s read fails outright',
		typeof rigFaulted === 'string' && rigFaulted.includes('R2 is not answering'),
		JSON.stringify(rigFaulted),
	);

	const foxRig = await ask('rig', '?name=fox');
	const key = (k: string): string => `/api/editor/asset?key=${encodeURIComponent(k)}`;
	t.same(
		'13. a rig by its bundle name: its facts, read by the runtime, and where its files are',
		foxRig,
		{
			status: 200,
			body: {
				ok: true,
				found: true,
				name: 'fox',
				shared: false,
				descriptor: {
					folder: 'fox',
					format: 'json',
					runtime: '4.2',
					pma: false,
					atlasText: atlas('fox.png'),
					skeletonUrl: key(`${own}/fox/fox.json`),
					pageNames: ['fox.png'],
					pageUrls: [key(`${own}/fox/fox.png`)],
				},
				facts: JSON.parse(JSON.stringify(rigFactsOf('fox', flash))),
			},
		},
	);
	const crate = await ask('rig', '?name=crate');
	t.same(
		'13. a shared rig is read from the shared library, and a project rig shadows one of its name',
		[
			crate.body.shared,
			(crate.body.descriptor as { skeletonUrl: string }).skeletonUrl,
			(crate.body.facts as RigFacts).cost.drawnSlots,
			(foxRig.body.facts as RigFacts).animations.length,
		],
		[true, key('_shared/spines/crate/crate.json'), 1, 2],
	);
	t.same(
		'13. a name the project has not is a 404, whatever it spells',
		await Promise.all(
			[
				'ghost',
				'secret',
				'../elsewhere/spines/secret',
				`${CLIENT}/elsewhere/spines/secret`,
				'fox/',
				'skeletons.json',
			].map(async (name) => {
				const res = await ask('rig', `?name=${encodeURIComponent(name)}`);
				return [res.status, res.body.found, res.body.reason];
			}),
		),
		[
			'ghost',
			'secret',
			'../elsewhere/spines/secret',
			`${CLIENT}/elsewhere/spines/secret`,
			'fox/',
			'skeletons.json',
		].map((name) => [404, false, `This project has no rig named "${name}".`]),
	);
	t.same(
		'13. no name is a 400',
		[(await ask('rig', '')).status, (await ask('rig', '?name=%20')).status],
		[400, 400],
	);
	const unlisted = await ask('rig', '?name=unlisted');
	const broken = await ask('rig', '?name=broken');
	t.same(
		'13. a folder with no skeleton listed is not found, with what to do',
		[unlisted.status, unlisted.body.found, unlisted.body.reason],
		[404, false, 'The rig "unlisted" has no skeleton listed: open it in the Rigger and save it.'],
	);
	t.check(
		'13. a skeleton that cannot be read: the files are named, no facts, and the reason',
		broken.status === 200 &&
			broken.body.found === true &&
			!('facts' in broken.body) &&
			String(broken.body.reason).startsWith('Its skeleton could not be read: ') &&
			(broken.body.descriptor as { pageNames: string[] }).pageNames[0] === 'broken.png',
		JSON.stringify(broken),
	);
	t.same(
		'13. neither read writes or deletes anything',
		(await r2.listAllObjects('')).map((o) => o.key).sort(),
		before,
	);
	const endpoint = text('src/routes/api/characters/rig/+server.ts');
	const reader = text('src/lib/server/charactersRig.ts');
	t.check(
		'13. the rig read is a GET behind the tool’s gate, and names files by the project’s own list',
		endpoint.includes('export const GET') &&
			!/export const (POST|PUT|PATCH|DELETE)/.test(endpoint) &&
			endpoint.includes("tool: 'characters'") &&
			endpoint.includes('scopeMismatch(') &&
			reader.includes('listRigs(clientKey, projectKey)).find((r) => r.name === name)') &&
			!/putObject|deleteObject|copyObject/.test(reader),
	);
};
