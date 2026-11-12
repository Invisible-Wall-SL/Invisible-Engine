// The engine's STOCK AUDIO in a standalone game repo's `static/assets/audio/`, brought up to the
// engine's own before a build (pull-project-assets.mjs). Node builtins only: it runs inside a game
// repo, where the engine submodule's node_modules is never installed.
//
// `new-game.mjs` copied `apps/lines/static` into the repo once, so a repo scaffolded before the stock
// audiosprite was split into banks still carries the old single sprite: its build would ship all
// 17 MB of it and every game would load all of it. The repo's copy is replaced with the engine's
// whenever it IS the engine's — banks, or a sprite whose every region is an engine sound. A sprite
// naming a sound the engine never shipped is the game's own audio and is left alone; the runtime
// still loads it whole.

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** The old sprite's media, beside its `sounds.json`. */
export const LEGACY_STOCK_MEDIA = ['sounds.ogg', 'sounds.m4a', 'sounds.mp3', 'sounds.ac3'];

/**
 * Bring `repoDir` (a game's `static/assets/audio`) up to `engineDir` (the engine's). Returns what was
 * done: `{ refreshed: true, banks, removed }`, or `{ refreshed: false, why }`. `dryRun` writes nothing.
 */
export async function refreshStockAudio(engineDir, repoDir, { dryRun = false } = {}) {
	const engine = JSON.parse(await readFile(join(engineDir, 'sounds.json'), 'utf8'));
	if (!Array.isArray(engine.banks)) return { refreshed: false, why: 'the engine ships no banks' };
	const engineNames = new Set(engine.banks.flatMap((bank) => Object.keys(bank.sprite)));
	const text = await readFile(join(repoDir, 'sounds.json'), 'utf8').catch(() => null);
	let repo;
	try {
		repo = text === null ? null : JSON.parse(text);
	} catch {
		return { refreshed: false, why: 'the repo’s audio/sounds.json is not JSON' };
	}
	const own =
		repo && !Array.isArray(repo.banks)
			? Object.keys(repo.sprite ?? {}).filter((name) => !engineNames.has(name))
			: [];
	if (own.length)
		return {
			refreshed: false,
			why: `the repo’s audiosprite carries its own sounds: ${own.join(', ')}`,
		};
	const removed = LEGACY_STOCK_MEDIA.filter((name) => existsSync(join(repoDir, name)));
	if (!dryRun) {
		for (const name of removed) await rm(join(repoDir, name), { force: true });
		await rm(join(repoDir, 'stock'), { recursive: true, force: true });
		await mkdir(repoDir, { recursive: true });
		await cp(join(engineDir, 'sounds.json'), join(repoDir, 'sounds.json'));
		await cp(join(engineDir, 'stock'), join(repoDir, 'stock'), { recursive: true });
	}
	return { refreshed: true, banks: engine.banks.length, removed };
}
