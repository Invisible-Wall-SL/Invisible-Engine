// Resolves a dependency the way the workspace package that declares it does, so a spike never
// hard-codes a `.pnpm/<name>@<version>/…` store path that the next bump deletes.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `name`'s entry file and package dir, resolved from `packages/<anchor>`. A git worktree has no
 * node_modules of its own until someone installs in it, so each ancestor checkout's
 * `packages/<anchor>` is tried in turn.
 */
export function resolveFromPackage(name, anchor) {
	for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
		const anchorJson = join(dir, 'packages', anchor, 'package.json');
		if (existsSync(anchorJson)) {
			let entry = null;
			try {
				entry = createRequire(anchorJson).resolve(name);
			} catch {}
			if (entry) {
				let pkgDir = dirname(entry);
				while (!existsSync(join(pkgDir, 'package.json'))) pkgDir = dirname(pkgDir);
				return { entry, pkgDir };
			}
		}
		if (dirname(dir) === dir) {
			console.error(`✗ ${name} not found from any packages/${anchor} — run pnpm install`);
			process.exit(1);
		}
	}
}
