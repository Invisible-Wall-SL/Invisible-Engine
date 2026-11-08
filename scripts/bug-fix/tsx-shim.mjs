// `tsx` inside a fix run's sandbox (bug-fix.yml; collect.mjs `prepare` installs it). tsx's own CLI
// always opens a Unix socket for its parent-child messages, and the sandbox refuses every Unix
// socket — the CLI's own messaging socket among them — so the CLI cannot start there. Its loader
// needs no socket: this runs the script under `node --import <tsx loader>` with the same meaning
// for the flags the repository's scripts use — `--tsconfig <file>` (TSX_TSCONFIG_PATH), node's own
// flags, and `--import <module>`.
//
//   node tsx-shim.mjs <tsx loader.mjs> [--tsconfig f] [node flags] <script> [args]

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The tsx-style argument list as node's: [env additions, node argv]. */
export function translate(loader, argv) {
	const env = {};
	const flags = [];
	let i = 0;
	for (; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--') {
			i++;
			break;
		}
		if (a === '--tsconfig' || a === '--import') {
			if (a === '--tsconfig') env.TSX_TSCONFIG_PATH = argv[++i];
			else flags.push('--import', argv[++i]);
			continue;
		}
		if (a.startsWith('--tsconfig=')) {
			env.TSX_TSCONFIG_PATH = a.slice('--tsconfig='.length);
			continue;
		}
		if (!a.startsWith('-')) break;
		flags.push(a);
	}
	return [env, ['--import', pathToFileURL(loader).href, ...flags, ...argv.slice(i)]];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [loader, ...argv] = process.argv.slice(2);
	const [env, args] = translate(loader, argv);
	const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
	process.exit(r.status ?? (r.signal ? 128 + 1 : 1));
}
