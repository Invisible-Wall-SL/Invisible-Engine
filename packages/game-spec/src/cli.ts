#!/usr/bin/env tsx
/**
 * Game Spec CLI.
 *
 *   game-spec validate <spec.ts|spec.json>
 *   game-spec generate <spec.ts|spec.json> --out <outDir>
 *
 * `generate` first validates, then writes into <out>:
 *   - <id>.normalized.json  (the validated spec with every default filled in)
 *   - game/paytable.ts      (display paytable + line count)
 *   - game/infoManifest.ts  (feeds the shared InfoOverlay; rules + theme from spec)
 *
 * config.ts generation is intentionally NOT done here yet: config.ts also holds
 * math data (reel strips / paddingReels) that is not part of the frontend spec.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ZodError } from 'zod';

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
	console.log(
		`✓ valid spec: ${result.meta.name} (${result.meta.id}) — type=${result.type}, symbols=${result.symbols.length}`,
	);
	return result;
};

const main = async () => {
	if (!cmd || !['validate', 'generate', 'scaffold'].includes(cmd) || !specArg) {
		die(
			'usage: game-spec <validate|generate|scaffold> <spec> [--out <dir>] [--template <dir> --root <dir> --launcher-config <path>]',
		);
	}

	const raw = await loadSpec(specArg);
	let spec: GameSpec;
	try {
		spec = validate(raw);
	} catch (err) {
		if (err instanceof ZodError) {
			const issues = err.issues
				.map((i) => `  • ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
				.join('\n');
			die(
				`✗ invalid spec (${err.issues.length} issue${err.issues.length === 1 ? '' : 's'}):\n${issues}`,
			);
		}
		die(`✗ invalid spec:\n${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	if (cmd === 'generate') {
		if (!outArg) die('generate requires --out <outDir>');
		const outDir = path.resolve(outArg!);
		const gameDir = path.join(outDir, 'game');
		fs.mkdirSync(gameDir, { recursive: true });

		const write = (dest: string, content: string) => {
			fs.writeFileSync(dest, content, 'utf8');
			console.log(`  wrote ${path.relative(process.cwd(), dest)}`);
		};

		write(
			path.join(outDir, `${spec.meta.id}.normalized.json`),
			JSON.stringify(spec, null, 2) + '\n',
		);
		write(path.join(gameDir, 'paytable.ts'), generatePaytable(spec));
		write(path.join(gameDir, 'infoManifest.ts'), generateInfoManifest(spec));
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
		if (launcherConfigPath)
			console.log(`  registered in launcher config: ${path.resolve(launcherConfigPath)}`);
	}
};

main().catch((err) => die(err instanceof Error ? (err.stack ?? err.message) : String(err)));
