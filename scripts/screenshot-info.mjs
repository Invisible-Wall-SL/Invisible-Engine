#!/usr/bin/env node
/**
 * Automated info-page screenshots, per locale, with the red payline overlay.
 *
 * Drives a real browser (Playwright/Chromium) to the running game, opens the
 * PAYTABLE and INFO pages deterministically via the `window.__info` hook that
 * InfoOverlay exposes in screenshot mode (?screenshotLines=1), and captures a
 * PNG per page per locale.
 *
 * Prerequisites (one-time):
 *   pnpm add -D -w playwright && npx playwright install chromium
 *   # and have the game dev server + the mock RGS running, e.g.:
 *   #   PUBLIC_RGS_TRANSPORT=play4fun pnpm --filter lines dev      (port 3001)
 *   #   node scripts/mock-rgs-server-book.mjs                      (port 7788)
 *
 * Usage:
 *   node scripts/screenshot-info.mjs --url http://localhost:3001 --game lines \
 *        --langs en,zh,de,ja --out ./screenshots --rgs localhost:7788
 */

import fs from 'node:fs';
import path from 'node:path';

const arg = (name, def) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};

const baseUrl = arg('url', 'http://localhost:3001');
const game = arg('game', 'game');
const rgs = arg('rgs', 'localhost:7788');
const sid = arg('sid', 'shot');
const outDir = path.resolve(arg('out', './screenshots'));
const langs = arg('langs', 'en').split(',').map((s) => s.trim()).filter(Boolean);
const device = arg('device', 'desktop');

const { chromium } = await import('playwright').catch(() => {
	console.error('playwright is not installed. Run: pnpm add -D -w playwright && npx playwright install chromium');
	process.exit(1);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });

// pages to capture: [filename suffix, async setup using the in-page __info hook]
const PAGES = [
	['paytable', `window.__info.open('payTable')`],
	['paylines', `window.__info.open('gameRules'); window.__info.page(0)`],
	['rules', `window.__info.open('gameRules'); window.__info.page(1)`],
];

const run = async () => {
	const browser = await chromium.launch();
	try {
		for (const lang of langs) {
			const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
			const url = `${baseUrl}/?sessionID=${sid}&rgs_url=${rgs}&lang=${lang}&device=${device}&screenshotLines=1`;
			console.log(`[shot] ${game} ${lang}: ${url}`);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

			// wait for the canvas, then dismiss the loading/splash screen by
			// clicking it until InfoOverlay mounts and exposes window.__info.
			await page.waitForSelector('canvas', { timeout: 120000 });
			const canvas = await page.$('canvas');
			let ready = false;
			for (let i = 0; i < 30 && !ready; i++) {
				const box = await canvas.boundingBox();
				if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
				await sleep(1000);
				ready = await page.evaluate(() => typeof window.__info?.open === 'function');
			}
			if (!ready) {
				console.warn(`  ! __info hook not ready for ${lang} (is the game past the loading screen?)`);
				await page.close();
				continue;
			}

			for (const [name, setup] of PAGES) {
				await page.evaluate(setup);
				await sleep(700);
				const file = path.join(outDir, `${game}_${name}_${lang}.png`);
				const el = await page.$('canvas');
				await el.screenshot({ path: file });
				console.log(`  saved ${path.relative(process.cwd(), file)}`);
			}
			await page.evaluate(() => window.__info.open(null));
			await page.close();
		}
	} finally {
		await browser.close();
	}
	console.log('[shot] done');
};

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
