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
//   node scripts/seed-game-editor.mjs --client borut --project book_of_borut \
//     --tp "C:/Invisible Wall SL/Projects/iGaming/Borut/Book of Borut/static/assets/sprites/reelsFrame/reels_frame.json" \
//     --page "C:/Invisible Wall SL/Projects/iGaming/Borut/Book of Borut/static/assets/sprites/reelsFrame/reels_frame.png" \
//     [--dry-run]
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

function buildDoc(updatedAt) {
	return {
		version: 1,
		projectKey: r2Slug(PROJECT),
		gameType: 'bookOf',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{ id: 'background', name: 'Background', nodes: [anchor('bg', 'background', 'Background', 'Background', { zIndex: -10 })] },
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
			{ id: 'freeSpinCounter', name: 'Free-spin counter', nodes: [anchor('fs-counter', 'freeSpinCounter', 'Free-spin counter', 'FreeSpinCounter')] },
			{ id: 'freeSpinIntro', name: 'Free-spin intro', nodes: [anchor('fs-intro', 'freeSpinIntro', 'Free-spin intro', 'FreeSpinIntro')] },
			{ id: 'freeSpinOutro', name: 'Free-spin outro', nodes: [anchor('fs-outro', 'freeSpinOutro', 'Free-spin outro', 'FreeSpinOutro')] },
		],
		updatedAt,
	};
}

async function main() {
	const manifest = await buildManifest();
	const doc = buildDoc(new Date().toISOString());

	console.info(`\nTarget project prefix: ${PREFIX}`);
	console.info(`  manifest → ${manifestKey}  (${manifest.regions.length} regions, ${manifest.width}×${manifest.height})`);
	console.info(`  page     → ${pageKey}  (from ${PAGE_PATH})`);
	console.info(`  doc      → ${editorDocKey}  (${doc.scenes.length} scenes)`);
	const fb = manifest.regions.find((r) => r.name === 'frame_bg.png');
	if (fb) console.info(`  frame_bg.png: rect ${fb.x},${fb.y} ${fb.w}×${fb.h} rotated=${fb.rotated} off ${fb.offX},${fb.offY} orig ${fb.origW}×${fb.origH}`);

	if (dryRun) {
		console.info('\n--dry-run: no uploads. Manifest + doc previews:\n');
		console.info('MANIFEST', JSON.stringify(manifest, null, 2).slice(0, 1200), '…');
		console.info('\nDOC basegame', JSON.stringify(doc.scenes.find((s) => s.id === 'basegame'), null, 2));
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

	await put(pageKey, await readFile(PAGE_PATH), pageName.endsWith('.webp') ? 'image/webp' : 'image/png');
	await put(manifestKey, JSON.stringify(manifest, null, 2), 'application/json');
	await put(editorDocKey, JSON.stringify(doc, null, 2), 'application/json');
	console.info(`\n✅ Uploaded page + manifest + scenes.json under ${bucket}/${PREFIX}/. Reload the editor on this project.`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
