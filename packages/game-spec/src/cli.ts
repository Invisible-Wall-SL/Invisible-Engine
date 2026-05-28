#!/usr/bin/env tsx
/**
 * Game Spec CLI.
 *
 *   pnpm --filter game-spec cli validate <spec.ts|spec.json>
 *   pnpm --filter game-spec cli generate <spec.ts|spec.json> --out <gameSrcDir>
 *
 * `generate` writes the spec-owned frontend artifacts into <out>/game/:
 *   - paytable.ts      (display paytable + line count)
 *   - infoManifest.ts  (feeds the shared InfoOverlay; rules + theme from spec)
 *
 * config.ts generation is intentionally NOT done here yet: config.ts also holds
 * math data (reel strips / paddingReels) that is not part of the frontend spec.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseGameSpec, type GameSpec } from './schema';
import { generatePaytable, generateInfoManifest } from './generate';
import { scaffold } from './scaffold';

const args = process.argv.slice(2);
const cmd = args[0];
const specArg = args[1];
const flag = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const outArg = flag('out');

const die = (msg: string) => {
	console.error(msg);
	process.exit(1);
};

const loadSpec = async (file: string): Promise<unknown> => {
	const abs = path.resolve(file);
	if (!fs.existsSync(abs)) die(`spec not found: ${abs}`);
	if (abs.endsWith('.json')) return JSON.parse(fs.readFileSync(abs, 'utf8'));
	const mod = await import(pathToFileURL(abs).href);
	return mod.default ?? Object.values(mod).find((v) => v && typeof v === 'object');
};

const validate = (raw: unknown): GameSpec => {
	const result = parseGameSpec(raw);
	console.log(`✓ valid spec: ${result.meta.name} (${result.meta.id}) — type=${result.type}, symbols=${result.symbols.length}`);
	return result;
};

const main = async () => {
	if (!cmd || !['validate', 'generate', 'scaffold'].includes(cmd) || !specArg) {
		die('usage: cli <validate|generate|scaffold> <spec> [--out <dir>] [--template <dir> --root <dir> --launcher-config <path>]');
	}

	const raw = await loadSpec(specArg);
	let spec: GameSpec;
	try {
		spec = validate(raw);
	} catch (err) {
		die(`✗ invalid spec:\n${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	if (cmd === 'generate') {
		if (!outArg) die('generate requires --out <gameSrcDir>');
		const gameDir = path.join(path.resolve(outArg!), 'game');
		fs.mkdirSync(gameDir, { recursive: true });

		const files: Array<[string, string]> = [
			['paytable.ts', generatePaytable(spec)],
			['infoManifest.ts', generateInfoManifest(spec)],
		];
		for (const [name, content] of files) {
			const dest = path.join(gameDir, name);
			fs.writeFileSync(dest, content, 'utf8');
			console.log(`  wrote ${path.relative(process.cwd(), dest)}`);
		}
		console.log('✓ generated');
	}

	if (cmd === 'scaffold') {
		const templateDir = flag('template');
		const root = flag('root');
		const launcherConfigPath = flag('launcher-config');
		if (!templateDir || !root) die('scaffold requires --template <dir> --root <targetRoot>');
		scaffold({
			spec,
			templateDir: path.resolve(templateDir!),
			targetRoot: path.resolve(root!),
			launcherConfigPath: launcherConfigPath ? path.resolve(launcherConfigPath) : undefined,
		});
		console.log(`✓ scaffolded ${spec.meta.name} -> ${path.resolve(root!)}`);
		if (launcherConfigPath) console.log(`  registered in launcher config: ${path.resolve(launcherConfigPath)}`);
	}
};

main().catch((err) => die(err instanceof Error ? err.stack ?? err.message : String(err)));
