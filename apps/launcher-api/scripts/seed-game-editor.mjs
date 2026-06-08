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
// The canonical bookOf scene set — generated from the engine's TS reference
// layout (`packages/engine-layout/src/lib/referenceLayouts/bookof.ts`) by
// `engine-layout`'s `gen:scenes`, so the seed and the editor/game share ONE
// source and can't drift. The seed only overrides `basegame` (its board-frame
// region sprites depend on the uploaded manifest); every other scene
// (loading/background/overlays/free-spins/HUD) comes straight from here.
import bookofSceneSet from 'engine-layout/scenes/bookof.json' with { type: 'json' };
import { tpFrameToEditorRegion } from './lib/tpRegions.mjs';

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
const r2Slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}`;
const pageName = basename(PAGE_PATH);
const manifestKey = `${PREFIX}/manifests/reels_frame.json`;
const pageKey = `${PREFIX}/manifests/${pageName}`;
const editorDocKey = `${PREFIX}/editor/scenes.json`;

// ---------- TexturePacker (json-hash) → Invisible manifest ----------
// Per-region Invisible fields (see lib/server/editorRegions.ts + the editor's
// drawRegionSprite): x,y = on-page rect top-left; w,h = UNROTATED trimmed size
// (the editor swaps to (h,w) on-page for rotated frames); offX,offY = trim offset
// within origW,origH = original untrimmed size. The frame→region mapping is the
// shared `lib/tpRegions.mjs` (camelCase editor variant).
async function buildManifest() {
	const tp = JSON.parse(await readFile(TP_PATH, 'utf8'));
	const frames = tp.frames ?? {};
	const regions = Object.entries(frames).map(([name, f]) => tpFrameToEditorRegion(name, f));
	const size = tp.meta?.size ?? {};
	if (!size.w || !size.h) {
		console.warn(
			'⚠ TexturePacker meta.size missing — page width/height left 0 (region geometry still works).',
		);
	}
	return {
		atlas: { source_image_path: pageKey, width: size.w ?? 0, height: size.h ?? 0 },
		width: size.w ?? 0,
		height: size.h ?? 0,
		regions,
	};
}

// ---------- editor doc ----------
// Single source: the board-frame geometry below AND the doc's `mainSizesMap`
// both read from the shared generated scene set, so they can't diverge.
const MAIN_SIZES_MAP = bookofSceneSet.mainSizesMap;
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

function buildDoc(updatedAt) {
	// The board frame is the one MANIFEST-dependent piece, so the seed builds it
	// as REGION sprites pointing at the uploaded manifest. EVERY other scene
	// (loading / background / overlays / free-spins / HUD) comes verbatim from the
	// shared generated scene set — one source of truth, no drift (see the import).
	const basegame = {
		id: 'basegame',
		name: 'Base game',
		nodes: [
			frameNode('frame-bg', 'boardFrame', 'Board frame background', 'frame_bg.png'),
			frameNode('frame-edge', 'boardFrameEdge', 'Board frame edge', 'frame_edge.png'),
		],
	};
	return {
		version: 1,
		projectKey: r2Slug(PROJECT),
		gameType: 'bookOf',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: bookofSceneSet.scenes.map((scene) => (scene.id === 'basegame' ? basegame : scene)),
		updatedAt,
	};
}

async function main() {
	const manifest = await buildManifest();
	console.info(`\nTarget project prefix: ${PREFIX}`);
	console.info(
		`  manifest → ${manifestKey}  (${manifest.regions.length} regions, ${manifest.width}×${manifest.height})`,
	);
	console.info(`  page     → ${pageKey}  (from ${PAGE_PATH})`);
	const fb = manifest.regions.find((r) => r.name === 'frame_bg.png');
	if (fb)
		console.info(
			`  frame_bg.png: rect ${fb.x},${fb.y} ${fb.w}×${fb.h} rotated=${fb.rotated} off ${fb.offX},${fb.offY} orig ${fb.origW}×${fb.origH}`,
		);

	if (dryRun) {
		const doc = buildDoc(new Date().toISOString());
		console.info('\n--dry-run: no uploads. Doc previews:\n');
		console.info('MANIFEST', JSON.stringify(manifest, null, 2).slice(0, 800), '…');
		console.info('\nDOC scenes', doc.scenes.map((s) => `${s.id}(${s.nodes.length})`).join(' '));
		// Print every scene's nodes. Overlay anchors are now PLAIN binds with no baked
		// `preview.art` — the editor adds each component's stand-in art live from the
		// shared catalog. Any leftover `preview.art` here would be an explicit override.
		for (const s of doc.scenes) {
			console.info(`\nSCENE ${s.id} (${s.name}) [space=${s.space ?? 'game'}]`);
			for (const n of s.nodes) {
				const art = n.preview?.art;
				const artDesc = art
					? `art=${art.kind}:${art.fit ?? 'natural'}${art.region ? ` region=${art.region}` : ''}`
					: n.preview?.style
						? `chip=${n.preview.style}`
						: n.bind
							? 'art=(catalog/live)'
							: '';
				console.info(
					`  • ${n.id} [${n.kind}]${n.bind ? ` bind=${n.bind.component}` : ''}${
						n.slotId ? ` slot=${n.slotId}` : ''
					}${artDesc ? ` ${artDesc}` : ''}`,
				);
			}
		}
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
	const s3 = new S3Client({
		region: 'auto',
		endpoint,
		credentials: { accessKeyId, secretAccessKey },
	});
	const put = (Key, Body, ContentType) =>
		s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType }));

	// Overlay anchors carry NO baked preview art — the editor resolves each coded
	// component's stand-in from the shared catalog (by component name) against the
	// project's R2 assets at render time, so no spine listing is needed here.
	const doc = buildDoc(new Date().toISOString());
	console.info(
		`  doc      → ${editorDocKey}  (${doc.scenes.map((s) => `${s.id}:${s.nodes.length}`).join(' ')})`,
	);

	await put(
		pageKey,
		await readFile(PAGE_PATH),
		pageName.endsWith('.webp') ? 'image/webp' : 'image/png',
	);
	await put(manifestKey, JSON.stringify(manifest, null, 2), 'application/json');
	await put(editorDocKey, JSON.stringify(doc, null, 2), 'application/json');
	console.info(
		`\n✅ Uploaded page + manifest + scenes.json under ${bucket}/${PREFIX}/. Reload the editor on this project.`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
