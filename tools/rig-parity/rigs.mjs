// Finds skeleton + atlas pairs under a folder, de-duplicated by content, for the render gates.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, basename, extname } from 'node:path';

const SKIP = ['node_modules', '.git', '.turbo', '.svelte-kit', 'build', 'dist'];

/** `[{ rel, skeleton, atlas, animations }]` — URLs are root-relative to `dir`; `animations` is null
 * for a binary skeleton (its names are not read here). */
export function findRigs(dir, filter = null) {
	const rigs = [];
	const seen = new Set();
	(function walk(d) {
		for (const n of readdirSync(d)) {
			if (SKIP.includes(n)) continue;
			const p = join(d, n);
			const s = statSync(p);
			if (s.isDirectory()) {
				walk(p);
				continue;
			}
			const isSkel = n.endsWith('.skel');
			if (!isSkel && !(n.endsWith('.json') && s.size > 200 && s.size < 20e6)) continue;
			let json = null;
			if (!isSkel) {
				try {
					json = JSON.parse(readFileSync(p, 'utf8'));
				} catch {
					continue;
				}
				if (!json?.skeleton || !json.bones) continue;
			}
			const atlases = readdirSync(dirname(p)).filter((f) => f.endsWith('.atlas'));
			const atlas =
				atlases.find((a) => basename(a, '.atlas') === basename(n, extname(n))) ?? atlases[0];
			if (!atlas) continue;
			const rel = relative(dir, p);
			if (filter && !rel.includes(filter)) continue;
			const hash = createHash('sha1')
				.update(readFileSync(p))
				.update(readFileSync(join(dirname(p), atlas)))
				.digest('hex');
			if (seen.has(hash)) continue;
			seen.add(hash);
			rigs.push({
				rel,
				skeleton: '/' + rel,
				atlas: '/' + relative(dir, join(dirname(p), atlas)),
				animations: json ? Object.keys(json.animations ?? {}) : null,
			});
		}
	})(dir);
	return rigs;
}

/** Up to three animations per rig at two times each (a binary rig: its setup pose). */
export function poseCases(rigs, { all = false } = {}) {
	const cases = [];
	for (const r of rigs) {
		const anims = r.animations?.length ? r.animations.slice(0, all ? undefined : 3) : [null];
		for (const animation of anims)
			for (const time of animation ? (all ? [0.05, 0.3, 0.7, 1.3] : [0.1, 0.55]) : [0])
				cases.push({ rig: r.rel, atlas: r.atlas, skeleton: r.skeleton, animation, time });
	}
	return cases;
}
