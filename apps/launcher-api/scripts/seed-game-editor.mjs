// Seed a game's editor setup into R2 so the Invisible Editor opens it laid out
// AND renders the real board-frame art:
//   1. Converts a TexturePacker (json-hash) atlas → the editor's Invisible
//      manifest format and uploads manifest + page to `<client>/<project>/manifests/`.
//   2. Writes `<client>/<project>/editor/scenes.json` — the bookOf scene set, with
//      the board-frame nodes as REGION sprites pointing at that manifest (in-game
//      identical: <Sprite key="frame_bg.png"> either way) and the responsive
//      scenery (background, FS counter, intro/outro, Win/Transition) as no-op bind
//      anchors. Mirrors `Book of Borut/src/game/defaultLayout.ts`.
//
//   node scripts/seed-game-editor.mjs --client borut --project bookofborut \
//     --tp "C:/Invisible Wall SL/Projects/iGaming/Borut/Book of Borut/static/assets/sprites/reelsFrame/reels_frame.json" \
//     --page "C:/Invisible Wall SL/Projects/iGaming/Borut/Book of Borut/static/assets/sprites/reelsFrame/reels_frame.png" \
//     [--dry-run]
//
//   (--project defaults to `bookofborut` — the project KEY the editor reads.
//    NOTE: the doc now also includes the HUD scenes, so re-seeding restores the
//    board/spine art AND the editable HUD in one go.)
//
// --dry-run prints the converted manifest + scenes.json and skips all uploads.
// Real upload env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

// NOTE: --project is the project's KEY (as stored in the launcher DB / shown in
// the R2 path), NOT the display name. Book of Borut's key is `bookofborut`
// (r2Slug of the key is itself). Passing the display name `book_of_borut` writes
// to the wrong prefix and the editor won't see it.
const CLIENT = opt('client', 'borut');
const PROJECT = opt('project', 'bookofborut');
const TP_PATH = opt('tp', null);
const PAGE_PATH = opt('page', null);
if (!TP_PATH || !PAGE_PATH) {
	console.error('Required: --tp <reels_frame.json> --page <reels_frame.png>');
	process.exit(1);
}

/** Slug rule — byte-identical to `r2Slug` in the launcher + the Python tools. */
const r2Slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) || 'default';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}`;
const pageName = basename(PAGE_PATH);
const manifestKey = `${PREFIX}/manifests/reels_frame.json`;
const pageKey = `${PREFIX}/manifests/${pageName}`;
const editorDocKey = `${PREFIX}/editor/scenes.json`;

// ---------- TexturePacker (json-hash) → Invisible manifest ----------
// Per-region Invisible fields (see lib/server/editorRegions.ts + the editor's
// drawRegionSprite): x,y = on-page rect top-left; w,h = UNROTATED trimmed size
// (the editor swaps to (h,w) on-page for rotated frames); offX,offY = trim offset
// within origW,origH = original untrimmed size.
//
// ASSUMPTION (true for reels_frame.json): TexturePacker reports `frame.w/h` as the
// UNROTATED size (frame.w/h == spriteSourceSize.w/h), not the on-sheet (rotated)
// rect. If a rotated frame renders sideways/offset in the editor, this is the knob
// to flip — tell me and I'll swap it.
function tpToRegion(name, f) {
	const fr = f.frame ?? {};
	const sss = f.spriteSourceSize ?? { x: 0, y: 0, w: fr.w, h: fr.h };
	const src = f.sourceSize ?? { w: fr.w, h: fr.h };
	return {
		name,
		x: fr.x ?? 0,
		y: fr.y ?? 0,
		w: fr.w ?? 0,
		h: fr.h ?? 0,
		rotated: Boolean(f.rotated),
		offX: sss.x ?? 0,
		offY: sss.y ?? 0,
		origW: src.w ?? fr.w ?? 0,
		origH: src.h ?? fr.h ?? 0,
	};
}

async function buildManifest() {
	const tp = JSON.parse(await readFile(TP_PATH, 'utf8'));
	const frames = tp.frames ?? {};
	const regions = Object.entries(frames).map(([name, f]) => tpToRegion(name, f));
	const size = tp.meta?.size ?? {};
	if (!size.w || !size.h) {
		console.warn('⚠ TexturePacker meta.size missing — page width/height left 0 (region geometry still works).');
	}
	return {
		atlas: { source_image_path: pageKey, width: size.w ?? 0, height: size.h ?? 0 },
		width: size.w ?? 0,
		height: size.h ?? 0,
		regions,
	};
}

// ---------- editor doc (mirrors Book of Borut's defaultLayout) ----------
const MAIN_SIZES_MAP = {
	desktop: { width: 1422, height: 800 },
	tablet: { width: 1000, height: 1000 },
	landscape: { width: 1600, height: 900 },
	portrait: { width: 800, height: 1422 },
};
const POS_ADJ = 1.01;
const FRAME_WIDTH = 750;
const FRAME_HEIGHT = 432;
const centre = (s) => ({ x: s.width * 0.5 * POS_ADJ, y: s.height * 0.5 * POS_ADJ });
const frameOverrides = {
	tablet: centre(MAIN_SIZES_MAP.tablet),
	landscape: centre(MAIN_SIZES_MAP.landscape),
	portrait: centre(MAIN_SIZES_MAP.portrait),
};
const c = centre(MAIN_SIZES_MAP.desktop);

const frameNode = (id, slotId, label, region) => ({
	id,
	slotId,
	label,
	kind: 'sprite',
	assetKey: manifestKey, // region sprite: editor resolves the manifest; in-game uses `region`
	region,
	anchor: { x: 0.5, y: 0.5 },
	x: c.x,
	y: c.y,
	width: FRAME_WIDTH,
	height: FRAME_HEIGHT,
	overrides: frameOverrides,
});
const anchor = (id, slotId, label, component, extra = {}) => ({
	id,
	slotId,
	label,
	kind: 'container',
	x: 0,
	y: 0,
	bind: { component },
	children: [],
	...extra,
});
const spineNode = (id, label, slotId, key, t) => ({
	id,
	label,
	slotId,
	kind: 'spine',
	assetKey: key,
	anchor: t.anchor ?? { x: 0.5, y: 0.5 },
	x: t.x,
	y: t.y,
	width: t.width,
	height: t.height,
	defaultAnimation: t.anim ?? '',
	loop: true,
	...(t.zIndex !== undefined ? { zIndex: t.zIndex } : {}),
});
const regionNode = (id, label, slotId, region, t) => ({
	id,
	label,
	slotId,
	kind: 'sprite',
	assetKey: manifestKey,
	region,
	anchor: t.anchor ?? { x: 0, y: 0 },
	x: t.x,
	y: t.y,
	width: t.width,
	height: t.height,
});
const textNode = (id, label, text, t) => ({
	id,
	label,
	kind: 'text',
	text,
	anchor: { x: 0.5, y: 0.5 },
	x: t.x,
	y: t.y,
	style: { fontFamily: t.font ?? 'gold', fontSize: t.size ?? 30, fontWeight: '600', fill: 0xffffff },
});

// ---------- HUD scenes ----------
// MIRROR of `engine-layout/src/lib/referenceLayouts/hud.ts` (the source of
// truth) — inlined because this plain `node` script can't import the TS package.
// Keep in sync if the HUD layout changes. Positions are computed from the same
// constants as the `Layout*.svelte` files; the game ignores `preview`/`anchor`.
function hudScenes() {
	const D = 150 * 0.9;
	const D_SUM = D * (188 / 116) + 800 + 350 + D * (340 / 116);
	const dOX = 1920 * 0.5 - 0.5 * D_SUM;
	const dOY = 1080 - D - 10;
	const dLabelY = dOY + D * 0.5 - 160;
	const dBtnY = dOY + D * 0.5;
	const d = (lx, y) => ({ x: dOX + lx, y });
	const L = 150 * 1.1;
	const L_SUM = L * (188 / 116) + 1000 + L * (373 / 116);
	const lO1X = 1920 * 0.5 - 0.5 * L_SUM;
	const lO1Y = 1080 - L - 40;
	const lLabelY = lO1Y + L * 0.5;
	const lBtnY = lO1Y + L * 0.5 - 90;
	const l1 = (lx, y) => ({ x: lO1X + lx, y });
	const lO2X = 1920 - 60 - L;
	const lO2Y = 1080 * 0.5 - L * 0.5;
	const l2 = (cy) => ({ x: lO2X + L * 0.5, y: lO2Y + cy });
	const tOX = 1920 * 0.5 - 0.5 * D_SUM;
	const tOY = 1920 - D - 30;
	const tLabelY = tOY + D * 0.5 - 220;
	const tBtnY = tOY + D * 0.5;
	const t = (lx, y) => ({ x: tOX + lx, y });
	const LABEL_W = D * 0.3 * 3 * (326 / 73);
	const LABEL_H = D * 0.3 * 3;
	const LABEL = { stacked: true };
	const BTN = { anchor: 0.5 };
	const bar = (id, label, component, props, dd, ll, tt) => {
		const isLabel = props === LABEL;
		return {
			id,
			label,
			kind: 'container',
			x: dd.x,
			y: dd.y,
			anchor: isLabel ? { x: 0.5, y: 0 } : { x: 0.5, y: 0.5 },
			scale: { x: 0.8, y: 0.8 },
			bind: { component, props },
			overrides: {
				landscape: { x: ll.x, y: ll.y },
				tablet: { x: tt.x, y: tt.y, scale: { x: 1, y: 1 } },
			},
			preview: isLabel
				? { w: LABEL_W, h: LABEL_H, style: 'label' }
				: { w: 150, h: 150, style: 'button' },
			children: [],
		};
	};
	return [
		{
			id: 'hudBar',
			name: 'HUD — bottom bar',
			space: 'standard',
			nodes: [
				bar('hud-balance', 'Balance', 'UiLabelBalance', LABEL, d(900 - 500, dLabelY), l1(420, lLabelY), t(880 - 640, tLabelY)),
				bar('hud-win', 'Win', 'UiLabelWin', LABEL, d(900, dLabelY), l1(910, lLabelY), t(880, tLabelY)),
				bar('hud-bet', 'Bet', 'UiLabelBet', LABEL, d(900 + 500, dLabelY), l1(1400, lLabelY), t(880 + 640, tLabelY)),
				bar('hud-btn-menu', 'Menu', 'UiButtonMenu', BTN, d(220, dBtnY), l1(85 + 20, lBtnY), t(20, tBtnY)),
				bar('hud-btn-buybonus', 'Buy bonus', 'UiButtonBuyBonus', BTN, d(220 + 150, dBtnY), l1(220 + 20, lBtnY), t(20 + 180, tBtnY)),
				bar('hud-btn-autospin', 'Auto spin', 'UiButtonAutoSpin', BTN, d(160 + 150 * 4, dBtnY), l2(L * 0.5 - 140), t(-10 + 180 * 4, tBtnY)),
				bar('hud-btn-bet', 'Spin / Bet', 'UiButtonBet', BTN, d(160 + 150 * 5, dBtnY), l2(L * 0.5), t(-10 + 180 * 5, tBtnY)),
				bar('hud-btn-turbo', 'Turbo', 'UiButtonTurbo', BTN, d(160 + 150 * 6, dBtnY), l2(L * 0.5 + 140), t(-10 + 180 * 6, tBtnY)),
				bar('hud-btn-decrease', 'Decrease', 'UiButtonDecrease', BTN, d(1440, dBtnY), l1(1580, lBtnY), t(1560, tBtnY)),
				bar('hud-btn-increase', 'Increase', 'UiButtonIncrease', BTN, d(1440 + 150, dBtnY), l1(1715, lBtnY), t(1560 + 180, tBtnY)),
			],
		},
		{
			id: 'hudCorners',
			name: 'HUD — corners',
			space: 'canvas',
			nodes: [
				{ id: 'hud-gamename', label: 'Game name', kind: 'container', screenAnchor: { x: 0, y: 0 }, x: 20, y: 0, anchor: { x: 0, y: 0 }, bind: { component: 'HudGameName' }, preview: { w: 260, h: 56, style: 'text' }, children: [] },
				{ id: 'hud-logo', label: 'Logo', kind: 'container', screenAnchor: { x: 1, y: 0 }, x: -20, y: 0, anchor: { x: 1, y: 0 }, bind: { component: 'HudLogo' }, preview: { w: 220, h: 56, style: 'text' }, children: [] },
			],
		},
	];
}

// `spineKeys` maps a bundle name → its R2 key (from listSpineKeys). When a bundle
// isn't present we fall back to the no-op bind anchor (still positionable).
function buildDoc(updatedAt, spineKeys = {}) {
	const ms = MAIN_SIZES_MAP.desktop;
	// Background: foregroundAnimation spine, sized to fill the frame (preview).
	const backgroundNodes = spineKeys.foregroundAnimation
		? [
				spineNode('bg-art', 'Background', 'background', spineKeys.foregroundAnimation, {
					x: ms.width / 2,
					y: ms.height / 2,
					width: ms.width,
					height: ms.height,
					anim: 'idle',
					zIndex: -10,
				}),
			]
		: [anchor('bg', 'background', 'Background', 'Background', { zIndex: -10 })];

	// Free-spin counter: the panel frame (a reels_frame region) + a static label.
	const fsCounterNodes = [
		regionNode('fs-frame', 'Free-spin counter frame', 'freeSpinCounter', 'Frame_FSCounter.png', {
			x: 87,
			y: 220,
			width: 240,
			height: 290,
		}),
		textNode('fs-text', 'Free-spin label', 'FREE SPIN\n1 OF 10', { x: 207, y: 365, size: 33 }),
	];

	const introNodes = spineKeys.fsIntro
		? [
				spineNode('fs-intro-art', 'Free-spin intro', 'freeSpinIntro', spineKeys.fsIntro, {
					x: ms.width / 2,
					y: ms.height / 2,
					width: 520,
					height: 420,
				}),
			]
		: [anchor('fs-intro', 'freeSpinIntro', 'Free-spin intro', 'FreeSpinIntro')];

	const outroKey = spineKeys.fsOutro ?? spineKeys.fsOutroNumber;
	const outroNodes = outroKey
		? [
				spineNode('fs-outro-art', 'Free-spin outro', 'freeSpinOutro', outroKey, {
					x: ms.width / 2,
					y: ms.height / 2,
					width: 520,
					height: 420,
				}),
			]
		: [anchor('fs-outro', 'freeSpinOutro', 'Free-spin outro', 'FreeSpinOutro')];

	return {
		version: 1,
		projectKey: r2Slug(PROJECT),
		gameType: 'bookOf',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{ id: 'background', name: 'Background', nodes: backgroundNodes },
			{
				id: 'basegame',
				name: 'Base game',
				nodes: [
					frameNode('frame-bg', 'boardFrame', 'Board frame background', 'frame_bg.png'),
					frameNode('frame-edge', 'boardFrameEdge', 'Board frame edge', 'frame_edge.png'),
				],
			},
			{
				id: 'basegameOverlays',
				name: 'Base game overlays',
				nodes: [
					anchor('bound-win', 'Win', 'Win overlay (coded)', 'Win'),
					anchor('bound-transition', 'Transition', 'Transition overlay (coded)', 'Transition'),
				],
			},
			{ id: 'freeSpinCounter', name: 'Free-spin counter', nodes: fsCounterNodes },
			{ id: 'freeSpinIntro', name: 'Free-spin intro', nodes: introNodes },
			{ id: 'freeSpinOutro', name: 'Free-spin outro', nodes: outroNodes },
			// HUD layer (logo/name corners + bottom bar) — editor-positionable; the
			// game's <UI hud=…> renders from these. Restores HUD alongside the art.
			...hudScenes(),
		],
		updatedAt,
	};
}

/** List the project's spine bundles in R2 → `{ bundleName: r2Key }`. The editor
 * renders a spine node whose `assetKey` is the bundle prefix (same value the
 * Library drag uses). */
async function listSpineKeys(s3, bucket) {
	const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
	const out = {};
	const prefix = `${PREFIX}/spines/`;
	let token;
	do {
		const r = await s3.send(
			new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token }),
		);
		for (const cp of r.CommonPrefixes ?? []) {
			const p = cp.Prefix;
			const name = p.slice(prefix.length).replace(/\/$/, '');
			if (name) out[name] = p;
		}
		token = r.IsTruncated ? r.NextContinuationToken : undefined;
	} while (token);
	return out;
}

async function main() {
	const manifest = await buildManifest();
	console.info(`\nTarget project prefix: ${PREFIX}`);
	console.info(`  manifest → ${manifestKey}  (${manifest.regions.length} regions, ${manifest.width}×${manifest.height})`);
	console.info(`  page     → ${pageKey}  (from ${PAGE_PATH})`);
	const fb = manifest.regions.find((r) => r.name === 'frame_bg.png');
	if (fb) console.info(`  frame_bg.png: rect ${fb.x},${fb.y} ${fb.w}×${fb.h} rotated=${fb.rotated} off ${fb.offX},${fb.offY} orig ${fb.origW}×${fb.origH}`);

	if (dryRun) {
		const doc = buildDoc(new Date().toISOString(), {});
		console.info('\n--dry-run: no uploads (spine bundles not listed without creds). Doc previews:\n');
		console.info('MANIFEST', JSON.stringify(manifest, null, 2).slice(0, 800), '…');
		console.info('\nDOC scenes', doc.scenes.map((s) => `${s.id}(${s.nodes.length})`).join(' '));
		console.info('DOC basegame', JSON.stringify(doc.scenes.find((s) => s.id === 'basegame'), null, 2));
		return;
	}

	const endpoint = process.env.R2_ENDPOINT;
	const bucket = process.env.R2_BUCKET;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
		console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
		process.exit(1);
	}
	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
	const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
	const put = (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType }));

	const spineKeys = await listSpineKeys(s3, bucket);
	console.info(`  spines   → ${Object.keys(spineKeys).length} bundle(s): ${Object.keys(spineKeys).join(', ') || '(none)'}`);
	for (const want of ['foregroundAnimation', 'fsIntro', 'fsOutro']) {
		if (!spineKeys[want]) console.warn(`  ⚠ spine "${want}" not found in R2 — that screen falls back to an anchor.`);
	}
	const doc = buildDoc(new Date().toISOString(), spineKeys);
	console.info(`  doc      → ${editorDocKey}  (${doc.scenes.map((s) => `${s.id}:${s.nodes.length}`).join(' ')})`);

	await put(pageKey, await readFile(PAGE_PATH), pageName.endsWith('.webp') ? 'image/webp' : 'image/png');
	await put(manifestKey, JSON.stringify(manifest, null, 2), 'application/json');
	await put(editorDocKey, JSON.stringify(doc, null, 2), 'application/json');
	console.info(`\n✅ Uploaded page + manifest + scenes.json under ${bucket}/${PREFIX}/. Reload the editor on this project.`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
