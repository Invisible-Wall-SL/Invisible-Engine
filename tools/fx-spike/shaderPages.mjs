/**
 * The pages the shader scripts draw (`shaderParity.mjs`, `shaderCompile.mjs`): the built-in kinds
 * (`shaderParity.entry.ts`) and the shader graphs (`shaderGraphs.entry.ts`), bundled for a
 * checkout, and the sheets they draw.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../..');
const BATCH = 10;

const resolveTs = (path) => {
	for (const candidate of [path, `${path}.ts`, join(path, 'index.ts')]) {
		if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
	}
	return path;
};

/** Bundle `entry` for `root`: `@fxroot/` and the workspace's own packages resolve inside it. */
const bundle = async (root, entry, outFile) => {
	const { build } = await import('esbuild');
	await build({
		entryPoints: [join(HERE, entry)],
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

/** `entry` bundled for `root` as `<outDir>/<name>.html` and its script. */
export const writePage = async (root, outDir, entry, name) => {
	await bundle(root, entry, join(outDir, `${name}.js`));
	writeFileSync(
		join(outDir, `${name}.html`),
		`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script src="${name}.js"></script></body></html>`,
	);
};

/**
 * Bundle the pages for `root` into `outDir` and list the sheets they draw: the kinds ten at a time,
 * every starting side of the spreading kinds, every signed number param at its minimum and, when
 * `root` has the shader graph package, its reference graphs (as filters, played as custom Element
 * FX, and, once it has subgraphs, each moved into a subgraph called one and two deep) and every
 * node; once it has the Custom GLSL node, its bodies (`shaderGlsl.entry.ts`: samples, examples,
 * random bodies) and the runtime's fail-safe for a pass the GPU refuses. A sheet is
 * `{ name, page, query }`: `<page>.html?gl=<1|2>&<query>`.
 *
 * `optionalGraphs`: a base older than the graph page (its package lacks what the page imports) has
 * no graph sheets, rather than failing the shoot; `diff` skips graph sheets one side lacks.
 */
export async function writeSheets(root, outDir, { optionalGraphs = false } = {}) {
	await writePage(root, outDir, 'shaderParity.entry.ts', 'page');
	const kinds = [
		...readFileSync(join(root, 'packages/constants-shared/elementFx.ts'), 'utf8').matchAll(
			/\n\t\tkind: '(\w+)',/g,
		),
	].map((m) => m[1]);
	const sheets = [];
	for (let b = 0; b < kinds.length; b += BATCH)
		sheets.push({
			name: String(b).padStart(2, '0'),
			page: 'page',
			query: `only=${kinds.slice(b, b + BATCH).join(',')}`,
		});
	sheets.push({ name: 'sides', page: 'page', query: 'sides=1' });
	sheets.push({ name: 'signed', page: 'page', query: 'signed=1' });
	let graphs = existsSync(join(root, 'packages/engine-shadergraph'));
	if (graphs) {
		try {
			await writePage(root, outDir, 'shaderGraphs.entry.ts', 'graphs');
		} catch (error) {
			if (!optionalGraphs) throw error;
			console.log(`no graph sheets: ${root}'s shader graph package predates the graph page`);
			graphs = false;
		}
	}
	if (graphs) {
		sheets.push({ name: 'graphs', page: 'graphs', query: 'graphs=1' });
		sheets.push({ name: 'custom', page: 'graphs', query: 'custom=1' });
		sheets.push({ name: 'nodes', page: 'graphs', query: 'nodes=1' });
		if (existsSync(join(root, 'packages/engine-shadergraph/src/subgraph.ts')))
			sheets.push({ name: 'subgraphs', page: 'graphs', query: 'subgraphs=1' });
		if (existsSync(join(root, 'packages/engine-shadergraph/customGlsl.samples.ts'))) {
			await writePage(root, outDir, 'shaderGlsl.entry.ts', 'glsl');
			sheets.push({ name: 'glsl', page: 'glsl', query: 'glsl=1' });
			sheets.push({ name: 'failsafe', page: 'glsl', query: 'failsafe=1' });
		}
	}
	return { kinds, sheets, graphs };
}
