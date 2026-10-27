// Write the build breakdown of a finished DESKTOP build — the report the Invisible Launcher opens
// after ☁ Publish and 📦 Deliver. Run from a game repo (engine at `engine/`) or the engine itself:
//
//   node engine/scripts/build-breakdown.mjs --build build --report-dir <dir> [--out <dir>]
//        [--kind publish|delivery] [--profile <p>] [--debug] [--optimize] [--json <result.json>]
//
//   --build       the finished build folder (what gets uploaded or packaged)
//   --report-dir  the folder the build steps wrote their notes into (`IE_BUILD_REPORT_DIR`):
//                 pull.json (pull:assets), bake.json (bake:doc), images.json (the launcher's
//                 🗜 Optimize image pass). Defaults to $IE_BUILD_REPORT_DIR.
//   --out         where to write build-breakdown.html + build-breakdown.json (default: report dir)
//   --json        also write a small result record there — `{ ok, html, json, totals, issues }` —
//                 so the launcher never scrapes console output
//
// Runs AFTER the launcher's image pass, so it describes exactly the bytes that leave the machine.
// See scripts/lib/build-breakdown.mjs for what it reports and why.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
	analyzeDesktopBuild,
	formatBytes,
	renderBreakdownHtml,
	SCANNED_EXT,
} from './lib/build-breakdown.mjs';

const MAX_SCANNED_BYTES = 8 * 1024 * 1024;

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const buildArg = flag('build');
const reportDir = flag('report-dir') ?? process.env.IE_BUILD_REPORT_DIR;
const resultPath = flag('json');

async function writeResult(result) {
	if (resultPath) await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, 'utf8');
}

function readJson(path) {
	if (!path || !existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

async function walk(root) {
	const out = [];
	const visit = async (dir) => {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) await visit(abs);
			else if (entry.isFile()) out.push(abs);
		}
	};
	await visit(root);
	return out;
}

async function main() {
	if (!buildArg || !reportDir) {
		throw new Error(
			'Usage: build-breakdown.mjs --build <dir> --report-dir <dir> [--out <dir>] [--json <file>]',
		);
	}
	const buildDir = resolve(buildArg);
	if (!existsSync(buildDir) || !statSync(buildDir).isDirectory()) {
		throw new Error(`No build folder at ${buildDir}`);
	}
	const outDir = resolve(flag('out') ?? reportDir);
	const toRel = (abs) => relative(buildDir, abs).split(sep).join('/');

	const paths = await walk(buildDir);
	const files = [];
	const texts = new Map();
	for (const abs of paths) {
		const rel = toRel(abs);
		const bytes = (await stat(abs)).size;
		files.push({ rel, bytes, abs });
		if (SCANNED_EXT.test(rel) && bytes <= MAX_SCANNED_BYTES) {
			texts.set(rel, await readFile(abs, 'utf8'));
		}
	}
	// Content hashes only where a duplicate is possible: two files of the same size.
	const bySize = new Map();
	for (const f of files) bySize.set(f.bytes, (bySize.get(f.bytes) ?? 0) + 1);
	for (const f of files) {
		if (f.bytes > 0 && bySize.get(f.bytes) > 1) {
			f.hash = createHash('sha1')
				.update(await readFile(f.abs))
				.digest('hex');
		}
	}

	const bake = readJson(join(reportDir, 'bake.json'));
	const breakdown = analyzeDesktopBuild({
		files: files.map(({ rel, bytes, hash }) => ({ rel, bytes, hash })),
		texts,
		bundle: readJson(bake?.bundle),
		assetsPrefix: existsSync(join(buildDir, 'assets')) ? 'assets/' : '',
		pull: readJson(join(reportDir, 'pull.json')),
		images: readJson(join(reportDir, 'images.json')),
		buildInfo: readJson(join(buildDir, 'build-info.json')),
		build: {
			kind: flag('kind') ?? 'publish',
			profile: flag('profile') ?? null,
			debug: has('debug'),
			optimize: has('optimize'),
			project: bake?.project ?? null,
		},
	});

	await mkdir(outDir, { recursive: true });
	const htmlPath = join(outDir, 'build-breakdown.html');
	const jsonPath = join(outDir, 'build-breakdown.json');
	await writeFile(jsonPath, JSON.stringify(breakdown), 'utf8');
	await writeFile(htmlPath, renderBreakdownHtml(breakdown), 'utf8');

	const count = (level) => breakdown.issues.filter((i) => i.level === level).length;
	const t = breakdown.totals;
	console.info(
		`Build breakdown: ${t.files} files, ${formatBytes(t.bytes)} shipped, ` +
			`${formatBytes(t.removedBytes)} left out, ${count('error')} error(s), ` +
			`${count('warn')} warning(s) → ${htmlPath}`,
	);
	await writeResult({
		ok: true,
		html: htmlPath,
		json: jsonPath,
		totals: t,
		issues: { error: count('error'), warn: count('warn'), info: count('info') },
	});
}

main().catch(async (e) => {
	const message = e instanceof Error ? e.message : String(e);
	console.error(`build-breakdown: ${message}`);
	await writeResult({ ok: false, error: message }).catch(() => undefined);
	process.exit(1);
});
