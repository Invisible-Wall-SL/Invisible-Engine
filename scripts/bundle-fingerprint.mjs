// Normalized fingerprint of an apps/* build: strips the SvelteKit version timestamp
// (inlined once into the bundle + version.json), which is the ONLY source of
// build-to-build non-determinism measured on this repo. Everything else must match.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'build/_app';
const version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).version;

const walk = (d) =>
	readdirSync(d).flatMap((e) => {
		const p = join(d, e);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});

const out = [];
for (const f of walk(root).sort()) {
	if (f.endsWith('version.json')) continue;
	// Content-hashed filenames change with the timestamp, so key on the stable stem.
	const name = f
		.replace(/\.[A-Za-z0-9_-]{8,}\.(js|css)$/, '.$1')
		.split('\\')
		.join('/');
	const body = readFileSync(f, 'utf8')
		.split(version)
		.join('__VERSION__')
		// SvelteKit mints a random app id per build (`__sveltekit_dhfji1`).
		.replace(/__sveltekit_[a-z0-9]+/g, '__sveltekit_ID__')
		// The ie-build-stamp's wall-clock `builtAt` is the ROOT non-determinism: it changes
		// every build, which changes the content hash, which changes the bundle's own
		// filename -- which the bundle embeds self-referentially. Both must be normalized.
		.replace(/builtAt:"[^"]*"/g, 'builtAt:"__BUILT_AT__"')
		.replace(/bundle\.[A-Za-z0-9_-]{8,}\.js/g, 'bundle.__HASH__.js');
	out.push(`${createHash('sha256').update(body).digest('hex')}  ${name}`);
}
console.log(out.join('\n'));
