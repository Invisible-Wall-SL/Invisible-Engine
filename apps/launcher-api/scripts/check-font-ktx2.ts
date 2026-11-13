/**
 * A bitmap font's pages get KTX2 twins on export (`exportEditorFonts`), so phones on the
 * compressed tier hold them compressed like every other page (`bakedFontAssets`).
 *
 *   1. a page big enough gets a premultiplied `.pm.ktx2` twin, padded to whole 4×4 blocks;
 *   2. the twin descriptor names it at that size and moves no glyph;
 *   3. the shipped catalog records the twin descriptor; a font whose pages earn none records none;
 *   4. an unchanged font is not encoded again, and its twin survives the export's prune;
 *   5. a changed page is encoded again;
 *   6. with encoding off nothing is encoded and the old twin is pruned.
 *
 * Runs the real export and the real encoder over an in-memory R2.
 *   pnpm --filter launcher-api check:font-ktx2
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import sharp from 'sharp';

process.env.KTX2_ENCODE = '1';

const bucket = new Map<string, Uint8Array>();
const encoded: string[] = [];
const text = (key: string) => {
	const body = bucket.get(key);
	return body === undefined ? null : Buffer.from(body).toString('utf8');
};
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
mock.module(r2Url, {
	namedExports: {
		...(await import(r2Url)),
		getObjectText: async (key: string) => text(key),
		getObjectBytes: async (key: string) => {
			const body = bucket.get(key);
			return body ? { body: new Uint8Array(body), contentType: '', etag: null } : null;
		},
		headObject: async (key: string) => {
			const body = bucket.get(key);
			if (!body) return null;
			const etag = `"${Buffer.from(body).toString('base64').slice(-24)}"`;
			return { etag, size: body.length, lastModified: 0 };
		},
		objectExists: async (key: string) => bucket.has(key),
		listAllKeys: async (prefix: string) => [...bucket.keys()].filter((k) => k.startsWith(prefix)),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		putObjectText: async (key: string, value: string) => {
			bucket.set(key, Buffer.from(value));
			return '"etag"';
		},
		putObjectBytes: async (key: string, body: Uint8Array) => {
			bucket.set(key, body);
			encoded.push(key);
			return '"etag"';
		},
		copyObject: async (from: string, to: string) => {
			const body = bucket.get(from);
			if (body === undefined) return false;
			bucket.set(to, body);
			return true;
		},
	},
});

const { exportEditorFonts } = await import('../src/lib/server/fontExport.ts');
const { ENV } = await import('../src/lib/server/env.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
	if (!ok) failures += 1;
};

const STOCK = new URL('../../lines/static/assets/fonts/goldFont/', import.meta.url);
const page = readFileSync(new URL('mm_gold.webp', STOCK));
const descriptor = readFileSync(new URL('mm_gold.xml', STOCK), 'utf8');
const small = await sharp({
	create: { width: 120, height: 40, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
})
	.png()
	.toBuffer();

const OWN = 'invisible_wall/test6/fonts';
const DEPLOY = 'invisible_wall/test6/deploy/editor-fonts';
const bitmap = (id: string, pageFile: string) => ({
	id,
	name: id,
	kind: 'bitmap',
	folder: id,
	descriptorFile: `${id}.xml`,
	descriptorFormat: 'xml',
	pageFiles: [pageFile],
});
bucket.set(
	`${OWN}/fonts.json`,
	Buffer.from(
		JSON.stringify({
			prefix: OWN,
			fonts: [bitmap('Golden', 'mm_gold.webp'), bitmap('Small', 'small.png')],
		}),
	),
);
bucket.set(`${OWN}/Golden/Golden.xml`, Buffer.from(descriptor));
bucket.set(`${OWN}/Golden/mm_gold.webp`, page);
bucket.set(`${OWN}/Small/Small.xml`, Buffer.from(descriptor.replace('mm_gold.webp', 'small.png')));
bucket.set(`${OWN}/Small/small.png`, small);

const ktx2Size = (bytes: Uint8Array) => {
	const view = Buffer.from(bytes);
	return `${view.readUInt32LE(20)}x${view.readUInt32LE(24)}`;
};
const glyphs = (xml: string) => xml.match(/<char\b[^>]*>/g)?.join('\n') ?? '';

console.log('1–3. the first export');
let index = await exportEditorFonts('Invisible_Wall', 'test6');
const twin = bucket.get(`${DEPLOY}/Golden/mm_gold.pm.ktx2`);
check('a premultiplied twin of the page is written beside it', !!twin);
check(
	'padded to whole blocks: 1482x214 → 1484x216',
	!!twin && ktx2Size(twin) === '1484x216',
	twin ? ktx2Size(twin) : 'none',
);
const twinXml = text(`${DEPLOY}/Golden/Golden.ktx2.xml`) ?? '';
check(
	'the twin descriptor names the twin',
	/file="mm_gold\.pm\.ktx2"/.test(twinXml),
	twinXml.slice(0, 200),
);
check('at its padded size', /scaleW="1484"/.test(twinXml) && /scaleH="216"/.test(twinXml));
check(
	'and moves no glyph',
	glyphs(twinXml) === glyphs(descriptor) && glyphs(descriptor).length > 0,
);
const golden = index.catalog.fonts.find((f) => f.id === 'Golden');
const smallFont = index.catalog.fonts.find((f) => f.id === 'Small');
check('the catalog records the twin descriptor', golden?.ktx2DescriptorFile === 'Golden.ktx2.xml');
check('a font whose page is too small records none', !!smallFont && !smallFont.ktx2DescriptorFile);
check(
	'… and writes no twin for it',
	![...bucket.keys()].some((k) => k.startsWith(`${DEPLOY}/Small/`) && /ktx2/.test(k)),
);

console.log('4. an unchanged font');
encoded.length = 0;
index = await exportEditorFonts('Invisible_Wall', 'test6');
check('is not encoded again', encoded.length === 0, encoded.join(', '));
check('keeps its twin through the prune', bucket.has(`${DEPLOY}/Golden/mm_gold.pm.ktx2`));
check(
	'still records it',
	index.catalog.fonts.find((f) => f.id === 'Golden')?.ktx2DescriptorFile === 'Golden.ktx2.xml',
);

console.log('5. a changed page');
bucket.set(`${OWN}/Golden/mm_gold.webp`, await sharp(page).flop().webp().toBuffer());
encoded.length = 0;
await exportEditorFonts('Invisible_Wall', 'test6');
check('is encoded again', encoded.includes(`${DEPLOY}/Golden/mm_gold.pm.ktx2`), encoded.join(', '));

console.log('6. encoding off');
process.env.KTX2_ENCODE = '0';
check('(the switch is read live)', ENV.KTX2_ENCODE === false);
index = await exportEditorFonts('Invisible_Wall', 'test6');
check(
	'records no twin',
	index.catalog.fonts.every((f) => !f.ktx2DescriptorFile),
);
check(
	'and the old twin is pruned',
	![...bucket.keys()].some((k) => k.startsWith(DEPLOY) && /ktx2|\.meta\.json$/.test(k)),
	[...bucket.keys()].filter((k) => k.startsWith(DEPLOY)).join(', '),
);

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
