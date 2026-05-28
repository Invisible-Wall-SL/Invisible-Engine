import fs from 'node:fs';
import path from 'node:path';

import type { GameSpec } from './schema';
import { generatePaytable, generateInfoManifest } from './generate';

const IGNORE = new Set(['node_modules', '.git', '.svelte-kit', 'dist', 'build', 'ComfyUI', '.turbo']);
const TEXT_EXT = new Set([
	'.ts', '.tsx', '.js', '.mjs', '.cjs', '.svelte', '.json', '.jsonc', '.md', '.html', '.css', '.scss',
	'.env', '.example', '.gitignore', '.gitmodules', '.cjs', '.yaml', '.yml', '.txt',
]);

const slug = (s: string) =>
	s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const isText = (file: string) =>
	TEXT_EXT.has(path.extname(file)) || /(^|[\\/])(\.env|\.gitignore|\.gitmodules)$/.test(file);

const copyDir = (src: string, dst: string) => {
	fs.mkdirSync(dst, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		if (IGNORE.has(entry.name)) continue;
		const from = path.join(src, entry.name);
		const to = path.join(dst, entry.name);
		if (entry.isDirectory()) copyDir(from, to);
		else fs.copyFileSync(from, to);
	}
};

const walkFiles = (dir: string, fn: (file: string) => void) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (IGNORE.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkFiles(full, fn);
		else fn(full);
	}
};

const tokens = (spec: GameSpec, ports: { frontend: number; backend: number }): Record<string, string> => ({
	'{{GAME_NAME}}': spec.meta.name,
	'{{GAME_ID}}': spec.meta.id,
	'{{GAME_SLUG}}': slug(spec.meta.name),
	'{{PROVIDER}}': spec.meta.provider,
	'{{CLIENT}}': spec.meta.client ?? '',
	'{{GAME_TYPE}}': spec.type,
	'{{FRONTEND_PORT}}': String(ports.frontend),
	'{{BACKEND_PORT}}': String(ports.backend),
});

// Backend mock script + facade game key by game type.
const backendFor = (spec: GameSpec) =>
	spec.type === 'bookOf'
		? { cmd: 'node scripts/mock-rgs-server-book.mjs', game: 'book' }
		: { cmd: 'node scripts/mock-rgs-server.mjs', game: 'lines' };

const allocatePorts = (cfg: LauncherConfig): { frontend: number; backend: number } => {
	const used = new Set<number>();
	for (const p of cfg.projects ?? []) {
		if (p.game?.frontend?.port) used.add(p.game.frontend.port);
		if (p.game?.backend?.port) used.add(p.game.backend.port);
	}
	let frontend = 3001;
	while (used.has(frontend)) frontend++;
	used.add(frontend);
	let backend = 7777;
	while (used.has(backend)) backend++;
	return { frontend, backend };
};

type LauncherProject = {
	name: string;
	root: string;
	base: string;
	game?: {
		backend?: { cwd: string; cmd: string; port: number };
		frontend?: { cwd: string; cmd: string; env?: Record<string, string>; port: number; open?: boolean; open_path?: string };
	};
};
type LauncherConfig = { projects?: LauncherProject[]; [k: string]: unknown };

/** Add (or replace) the game's entry in the launcher's comfyui_manager_config.json. */
export const registerLauncher = (
	spec: GameSpec,
	targetRoot: string,
	launcherConfigPath: string,
	ports: { frontend: number; backend: number },
): void => {
	const cfg: LauncherConfig = JSON.parse(fs.readFileSync(launcherConfigPath, 'utf8'));
	cfg.projects = (cfg.projects ?? []).filter((p) => p.name !== spec.meta.name);
	const backend = backendFor(spec);
	cfg.projects.push({
		name: spec.meta.name,
		root: targetRoot,
		base: path.join(targetRoot, 'ComfyUI'),
		game: {
			backend: { cwd: 'engine', cmd: backend.cmd, port: ports.backend },
			frontend: {
				cwd: '.',
				cmd: 'pnpm dev',
				env: { PUBLIC_RGS_TRANSPORT: 'play4fun', PUBLIC_RGS_GAME: backend.game },
				port: ports.frontend,
				open: true,
				open_path: `/?sessionID=dev&rgs_url=localhost:${ports.backend}&lang=en&currency=USD&device=desktop`,
			},
		},
	});
	fs.writeFileSync(launcherConfigPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
};

export type ScaffoldOptions = {
	spec: GameSpec;
	templateDir: string;
	targetRoot: string;
	launcherConfigPath?: string;
};

export const scaffold = ({ spec, templateDir, targetRoot, launcherConfigPath }: ScaffoldOptions): void => {
	if (fs.existsSync(targetRoot) && fs.readdirSync(targetRoot).length) {
		throw new Error(`target is not empty: ${targetRoot}`);
	}
	// 1. copy template
	copyDir(templateDir, targetRoot);

	// 2. tokenize text files (ports allocated from the launcher config if present)
	let ports = { frontend: 3001, backend: 7777 };
	if (launcherConfigPath && fs.existsSync(launcherConfigPath)) {
		ports = allocatePorts(JSON.parse(fs.readFileSync(launcherConfigPath, 'utf8')));
	}
	const tok = tokens(spec, ports);
	walkFiles(targetRoot, (file) => {
		if (!isText(file)) return;
		let text = fs.readFileSync(file, 'utf8');
		let changed = false;
		for (const [k, v] of Object.entries(tok)) {
			if (text.includes(k)) {
				text = text.split(k).join(v);
				changed = true;
			}
		}
		if (changed) fs.writeFileSync(file, text, 'utf8');
	});

	// 3. write the spec + generated frontend artifacts
	const gameDir = path.join(targetRoot, 'src', 'game');
	fs.mkdirSync(gameDir, { recursive: true });
	fs.writeFileSync(path.join(gameDir, 'game.spec.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');
	fs.writeFileSync(path.join(gameDir, 'paytable.ts'), generatePaytable(spec), 'utf8');
	fs.writeFileSync(path.join(gameDir, 'infoManifest.ts'), generateInfoManifest(spec), 'utf8');

	// 4. register in the launcher (the contract shared with the pipeline/Atlas Maker)
	if (launcherConfigPath) registerLauncher(spec, targetRoot, launcherConfigPath, ports);
};
