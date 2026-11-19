// Runs the arena determinism page (`scripts/arena-3d-page.mjs`) in Chromium and WebKit (Safari's
// engine, JavaScriptCore) through a Playwright install, and fails unless each makes the same level
// bytes and replay as Node's fixture. Not part of check:all: it needs Playwright's browsers, which
// CI does not install. Playwright-core is found in the npx cache (the Playwright MCP server's) or
// passed with --playwright <dir of playwright-core>.
//
// Run: node scripts/arena-3d-browsers.mjs [--playwright <dir>]

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { buildArena3dPage } from './arena-3d-page.mjs';

const { values: opt } = parseArgs({ options: { playwright: { type: 'string' } } });

const require = createRequire(import.meta.url);

/** A playwright-core whose build of `browser` is installed (each cached one pins its own builds). */
function playwrightFor(browser) {
	if (opt.playwright) return require(opt.playwright);
	const local = process.env.LOCALAPPDATA ?? '';
	const cache = join(local, 'npm-cache', '_npx');
	const installed = join(local, 'ms-playwright');
	const found = (existsSync(cache) ? readdirSync(cache) : [])
		.map((d) => join(cache, d, 'node_modules', 'playwright-core'))
		.filter((d) => existsSync(join(d, 'browsers.json')))
		.filter((d) => {
			const entry = JSON.parse(readFileSync(join(d, 'browsers.json'), 'utf8')).browsers.find(
				(x) => x.name === browser,
			);
			return (
				entry && existsSync(join(installed, `${browser.replace(/-/g, '_')}-${entry.revision}`))
			);
		})
		.sort();
	if (!found.length)
		throw new Error(`no playwright-core with ${browser} installed: pass --playwright`);
	return require(found.at(-1));
}

const fixture = JSON.parse(
	readFileSync(
		new URL('../packages/engine-mechanics/fixtures/arena-3d.json', import.meta.url),
		'utf8',
	),
);
const dir = mkdtempSync(join(tmpdir(), 'arena-3d-'));
const page = join(dir, 'arena-3d.html');
writeFileSync(page, buildArena3dPage(fixture).html);

let failed = false;
try {
	for (const [name, type, args] of [
		['Chromium', playwrightFor('chromium-headless-shell').chromium, ['--mute-audio']],
		['WebKit', playwrightFor('webkit').webkit, []],
	]) {
		const browser = await type.launch({ headless: true, args });
		try {
			const tab = await browser.newPage();
			await tab.goto(pathToFileURL(page).href);
			const result = await tab.waitForFunction(() => window.__ARENA3D__, null, {
				timeout: 120_000,
			});
			const r = await result.jsonValue();
			const line = r.runs.map((run) => `${run.seeds}/${run.replay} ${run.ms} ms`).join(', ');
			console.log(`${r.ok ? '✓' : '✗'} ${name} (${browser.version()}): ${line}`);
			if (!r.ok) failed = true;
		} finally {
			await browser.close();
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
console.log(`expected ${fixture.seeds.code}/${fixture.replay.code}`);
process.exit(failed ? 1 : 0);
