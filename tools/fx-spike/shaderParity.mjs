#!/usr/bin/env node
/**
 * SHADER PARITY — proves a change to the Element FX shaders draws exactly what it drew before.
 *
 * Renders every Element FX kind posed at eight moments, plus every starting side of the spreading
 * kinds, on WebGL1 and WebGL2 in headless Chromium with fixed random seeds; then compares two
 * renders pixel by pixel. A refactor of a built-in (Invisible Shader Graph step 1) must come out
 * IDENTICAL; a graph twin of a built-in (step 6) is compared the same way.
 *
 *   # the base, from a worktree of it, then your change:
 *   git worktree add --detach /tmp/base origin/main
 *   pnpm --filter fx-spike shader-parity shoot /tmp/before --root /tmp/base
 *   pnpm --filter fx-spike shader-parity shoot /tmp/after
 *   pnpm --filter fx-spike shader-parity diff /tmp/before /tmp/after
 *
 * Options: `--root <checkout>` renders that checkout's engine (default: this one); `--chromium
 * <path>` launches that browser (default: Playwright's). Playwright is not a dependency of the
 * repo: install it (`pnpm add -D -w playwright && npx playwright install chromium`) or pass
 * `--playwright <path>` to an installed copy. A renderer can't see its own change: run `diff` on a
 * deliberately changed build once (a digit in a shared constant) to see that it reports one.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const CELL_H = 190;
const BATCH = 10;

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};

const loadPlaywright = async () => {
	const local = arg('playwright');
	if (local) return createRequire(import.meta.url)(resolve(local));
	return import('playwright').catch(() => {
		console.error(
			'playwright is not installed: pnpm add -D -w playwright && npx playwright install chromium (or pass --playwright <path to an installed copy>)',
		);
		process.exit(2);
	});
};

const launch = async () => {
	const { chromium } = await loadPlaywright();
	const executablePath = arg('chromium');
	return chromium.launch({
		...(executablePath ? { executablePath } : {}),
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
	});
};

/** Bundle the page for `root`: `@fxroot/` and the workspace's own packages resolve inside it. */
const bundle = async (root, outFile) => {
	const { build } = await import('esbuild');
	await build({
		entryPoints: [join(HERE, 'shaderParity.entry.ts')],
		bundle: true,
		format: 'iife',
		outfile: outFile,
		logLevel: 'error',
		nodePaths: [join(REPO, 'packages/pixi-svelte/node_modules'), join(REPO, 'node_modules')],
		plugins: [
			{
				name: 'fxroot',
				setup(b) {
					b.onResolve({ filter: /^@fxroot\// }, (a) => ({
						path: resolveTs(join(root, a.path.slice(8))),
					}));
					b.onResolve({ filter: /^constants-shared(\/|$)/ }, (a) => ({
						path: resolveTs(
							join(
								root,
								'packages',
								a.path === 'constants-shared' ? 'constants-shared/index' : a.path,
							),
						),
					}));
				},
			},
		],
	});
};

const resolveTs = (path) => {
	for (const candidate of [path, `${path}.ts`, join(path, 'index.ts')]) {
		try {
			readFileSync(candidate);
			return candidate;
		} catch {
			// next
		}
	}
	return path;
};

const shoot = async (outDir) => {
	const root = resolve(arg('root') ?? REPO);
	mkdirSync(outDir, { recursive: true });
	const script = join(outDir, 'page.js');
	await bundle(root, script);
	writeFileSync(
		join(outDir, 'page.html'),
		`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script src="page.js"></script></body></html>`,
	);
	const kinds = [
		...readFileSync(join(root, 'packages/constants-shared/elementFx.ts'), 'utf8').matchAll(
			/\n\t\tkind: '(\w+)',/g,
		),
	].map((m) => m[1]);
	const sheets = [];
	for (let b = 0; b < kinds.length; b += BATCH)
		sheets.push({
			name: String(b).padStart(2, '0'),
			query: `only=${kinds.slice(b, b + BATCH).join(',')}`,
		});
	sheets.push({ name: 'sides', query: 'sides=1' });
	const browser = await launch();
	const rows = {};
	const errors = [];
	for (const gl of [1, 2]) {
		for (const sheet of sheets) {
			const page = await browser.newPage({ viewport: { width: 1360, height: 2000 } });
			page.on('pageerror', (e) => errors.push(`gl${gl} ${sheet.name}: ${e.message}`));
			await page.addInitScript(() => {
				let s = 123456789;
				Math.random = () => {
					s = (s * 16807) % 2147483647;
					return (s - 1) / 2147483646;
				};
			});
			await page.goto(`${pathToFileURL(join(outDir, 'page.html')).href}?gl=${gl}&${sheet.query}`);
			await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
			rows[sheet.name] = await page.evaluate(() => window.rows);
			await page.locator('canvas').screenshot({ path: join(outDir, `gl${gl}-${sheet.name}.png`) });
			await page.close();
		}
	}
	await browser.close();
	writeFileSync(join(outDir, 'rows.json'), JSON.stringify(rows, null, '\t'));
	if (errors.length) {
		console.error(errors.join('\n'));
		process.exit(1);
	}
	console.log(`shot ${kinds.length} kinds and the sides sheet, WebGL1 and WebGL2, into ${outDir}`);
};

const diff = async (a, b) => {
	const rows = JSON.parse(readFileSync(join(b, 'rows.json'), 'utf8'));
	const browser = await launch();
	const page = await browser.newPage();
	let total = 0;
	for (const file of readdirSync(a)
		.filter((f) => f.endsWith('.png'))
		.sort()) {
		const sheet = file.replace(/^gl\d-/, '').replace(/\.png$/, '');
		const [da, db] = [a, b].map(
			(d) => `data:image/png;base64,${readFileSync(join(d, file)).toString('base64')}`,
		);
		const result = await page.evaluate(
			async ([da, db, cellH]) => {
				const load = (src) =>
					new Promise((ok) => {
						const img = new Image();
						img.onload = () => ok(img);
						img.src = src;
					});
				const [ia, ib] = await Promise.all([load(da), load(db)]);
				if (ia.width !== ib.width || ia.height !== ib.height) return null;
				const pixels = (img) => {
					const canvas = document.createElement('canvas');
					canvas.width = img.width;
					canvas.height = img.height;
					const ctx = canvas.getContext('2d');
					ctx.drawImage(img, 0, 0);
					return ctx.getImageData(0, 0, img.width, img.height).data;
				};
				const [pa, pb] = [pixels(ia), pixels(ib)];
				const out = [];
				for (let r = 0; r < Math.round(ia.height / cellH); r++) {
					let count = 0;
					let max = 0;
					for (let y = r * cellH; y < (r + 1) * cellH; y++) {
						for (let x = 0; x < ia.width; x++) {
							const i = (y * ia.width + x) * 4;
							let m = 0;
							for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs(pa[i + k] - pb[i + k]));
							if (m) {
								count++;
								max = Math.max(max, m);
							}
						}
					}
					out.push([count, max]);
				}
				return out;
			},
			[da, db, CELL_H],
		);
		if (!result) {
			console.log(`${file}: the sheets differ in size`);
			total++;
			continue;
		}
		result.forEach(([count, max], r) => {
			if (!count) return;
			total += count;
			console.log(
				`${file} ${rows[sheet]?.[r] ?? `row ${r}`}: ${count} px differ (max delta ${max})`,
			);
		});
	}
	await browser.close();
	if (total) {
		console.log(`DIFFERENT: ${total} px (a break's pieces can fly into the next row)`);
		process.exit(1);
	}
	console.log('IDENTICAL: every kind, every moment, every side, WebGL1 and WebGL2');
};

const [command, ...paths] = process.argv
	.slice(2)
	.filter((v, i, all) => !v.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (command === 'shoot' && paths[0]) await shoot(resolve(paths[0]));
else if (command === 'diff' && paths[1]) await diff(resolve(paths[0]), resolve(paths[1]));
else {
	console.error(
		'usage: shaderParity.mjs shoot <outDir> [--root <checkout>] [--chromium <path>] [--playwright <path>] | diff <dirA> <dirB>',
	);
	process.exit(2);
}
