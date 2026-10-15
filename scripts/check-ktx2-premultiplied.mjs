/**
 * Guard the premultiplied-KTX2 contract between the launcher (which writes twins) and the game
 * (which loads them).
 *
 *     node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/check-ktx2-premultiplied.mjs
 *
 * WHY THIS GUARD EXISTS. Pixi marks every KTX2 texture straight-alpha and answers it with its `-npm`
 * blends, which apply a node's alpha twice — so on the compressed tier (every phone) a glow at 50%
 * opacity drew at 25%. Owner-reported 2026-10-15: a pink backdrop glow missing on a Pixel and present
 * with `?quality=high`. The fix spans two packages that cannot import each other: the launcher
 * encodes twins premultiplied and names them `.pm.ktx2` (`apps/launcher-api` `ktx2Alpha.ts`), and
 * the game marks a texture with that name premultiplied (`pixi-svelte` `ktx2AlphaMode.ts`). If the
 * name drifts on either side, nothing errors: the game reads premultiplied bytes as straight and
 * every soft edge darkens, or the reverse. This pins the two halves together.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
	PREMULTIPLIED_KTX2_EXT,
	atlasPremultipliedPages,
	premultiplyRgba,
} from '../apps/launcher-api/src/lib/server/ktx2Alpha.ts';
import { KTX2_ENCODER_REVISION } from '../apps/launcher-api/src/lib/server/ktx2Dimensions.ts';
import { isPremultipliedKtx2 } from '../packages/pixi-svelte/src/lib/ktx2Premultiplied.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (f) => readFileSync(`${ROOT}/${f}`, 'utf8');

let checks = 0;
const ok = (label, condition, detail = '') => {
	if (!condition) {
		console.error(`\n  FAIL  ${label}${detail ? `\n        ${detail}` : ''}\n`);
		process.exit(1);
	}
	checks += 1;
	console.log(`  [ok] ${label}`);
};

console.log('1. every name the launcher writes, the game reads as premultiplied');
for (const url of [
	`0a1b2c${PREMULTIPLIED_KTX2_EXT}`,
	`../../_pages/0a1b2c${PREMULTIPLIED_KTX2_EXT}`,
	`https://app.invisiblewall.org/api/deploy/f/tok/acme/game/_pages/0a1b2c${PREMULTIPLIED_KTX2_EXT}`,
	`../../_pages/0a1b2c${PREMULTIPLIED_KTX2_EXT}?k=abc`,
	`R_Board${PREMULTIPLIED_KTX2_EXT}`,
]) {
	ok(`premultiplied: ${url}`, isPremultipliedKtx2(url));
}

console.log('\n2. a twin from before the convention stays straight');
for (const url of [
	'../../_pages/0a1b2c.ktx2',
	'https://app.invisiblewall.org/api/deploy/f/tok/acme/game/_pages/0a1b2c.ktx2?k=abc',
	'R_Board.ktx2',
	'editor-art/ui/ui.3.ktx2.json',
	'spm.ktx2',
]) {
	ok(`straight: ${url}`, !isPremultipliedKtx2(url));
}

console.log('\n3. the exporters name twins through the shared constant, never a bare `.ktx2`');
{
	const pageStore = read('apps/launcher-api/src/lib/server/pageStore.ts');
	const rig = read('apps/launcher-api/src/lib/server/rig.ts');
	ok(
		'PageStore names its twin `${hash}${PREMULTIPLIED_KTX2_EXT}`',
		/`\$\{hash\}\$\{PREMULTIPLIED_KTX2_EXT\}`/.test(pageStore),
	);
	ok('PageStore writes no `${hash}.ktx2` twin', !/`\$\{hash\}\.ktx2`/.test(pageStore));
	ok(
		'the per-bundle rig twin is named with PREMULTIPLIED_KTX2_EXT',
		/const ktx2Name = pageName\.replace\(.*PREMULTIPLIED_KTX2_EXT\)/.test(rig),
	);
	ok("rig.ts derives no bare '.ktx2' page twin", !/pageName\.replace\(.*'\.ktx2'\)/.test(rig));
	ok(
		'the per-bundle rig cache re-encodes a twin from an older encoder',
		/m\.enc === KTX2_ENCODER_REVISION/.test(rig),
	);
	ok(
		'the encoder revision moved past 2, so existing twins re-encode',
		KTX2_ENCODER_REVISION >= 3,
		`KTX2_ENCODER_REVISION = ${KTX2_ENCODER_REVISION}`,
	);
}

console.log('\n4. premultiply matches the browser’s 8-bit PNG premultiply');
{
	const px = new Uint8Array([
		255,
		128,
		0,
		255, // opaque — untouched
		255,
		128,
		0,
		128, // half alpha
		200,
		100,
		50,
		0, // fully transparent — colour must vanish
		255,
		255,
		255,
		1, // a faint edge pixel
	]);
	premultiplyRgba(px);
	ok('opaque pixel unchanged', px.slice(0, 4).join() === '255,128,0,255', px.slice(0, 4).join());
	ok('half-alpha pixel halved', px.slice(4, 8).join() === '128,64,0,128', px.slice(4, 8).join());
	ok('transparent pixel is black', px.slice(8, 12).join() === '0,0,0,0', px.slice(8, 12).join());
	ok(
		'faint pixel scaled, not zeroed',
		px.slice(12, 16).join() === '1,1,1,1',
		px.slice(12, 16).join(),
	);
}

console.log('\n5. pages already premultiplied are found, so they are not premultiplied twice');
{
	const spine4 = [
		'R_Board.png',
		'size: 2048,2048',
		'filter: Linear,Linear',
		'pma: true',
		'board',
		'  bounds: 0,0,100,100',
		'heart_shadow.png',
		'  bounds: 100,0,10,10',
		'',
		'R_Board_2.png',
		'size: 1024,1024',
		'filter: Linear,Linear',
		'glow',
		'  bounds: 0,0,10,10',
	].join('\n');
	const pages = atlasPremultipliedPages(spine4);
	ok('the `pma: true` page is found', pages.has('R_Board.png'), [...pages].join());
	ok('the page without it is not', !pages.has('R_Board_2.png'));
	ok('a region named like an image is never a page', !pages.has('heart_shadow.png'));
	ok('exactly one page', pages.size === 1, [...pages].join());

	const legacy =
		'old.png\nsize: 512,512\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nregion\n  xy: 0, 0';
	ok(
		'an atlas with no `pma` line has no premultiplied page',
		atlasPremultipliedPages(legacy).size === 0,
	);
	ok(
		'`pma: false` is not premultiplied',
		atlasPremultipliedPages('a.png\nsize: 4,4\npma: false\nr\n  xy: 0,0').size === 0,
	);
}

console.log('\n6. the encoder premultiplies unless told the source already is');
{
	const encode = read('apps/launcher-api/src/lib/server/ktx2Encode.ts');
	ok(
		'the decoder premultiplies exactly when `sourcePremultiplied` is not set',
		/makeDecoder\(resize,\s*!opts\.sourcePremultiplied\)/.test(encode),
	);
	ok(
		'the decoder calls premultiplyRgba',
		/if \(premultiply\) premultiplyRgba\(data\)/.test(encode),
	);
}

console.log('\n7. the game installs the loader patch and marks premultiplied twins');
{
	const init = read('packages/pixi-svelte/src/lib/components/InitialiseApplication.svelte');
	const patch = read('packages/pixi-svelte/src/lib/ktx2AlphaMode.ts');
	ok('InitialiseApplication installs it', /honourPremultipliedKtx2\(\);/.test(init));
	ok(
		'it marks a `.pm.ktx2` (or a declared-`pma`) texture premultiplied-alpha',
		/isPremultipliedKtx2\(url\)/.test(patch) && /alphaMode = 'premultiplied-alpha'/.test(patch),
	);
}

console.log(`\nPASS: ${checks} checks.\n`);
