#!/usr/bin/env node
// Seed (or repair) a project's machine-independent **launcher profile** in the portal,
// so every desktop launcher gets the same auto-deploy settings on "Sync from cloud".
//
// Why this exists: the desktop launcher normally derives a project's `repo` block from
// the LOCAL git remote of its folder at "Publish setup" time. A project synced into an
// empty `Projects/<client>/<key>` folder has no git remote yet, so the repo URL never
// gets captured — sync then can't clone, and "Build & publish" runs pnpm in an empty
// dir (ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND). This writes the profile explicitly instead,
// so the deploy is fully hands-off on any machine.
//
// Auth: logs in via POST /api/launcher/login with an OWNER (admin) account. Credentials
// come from env so they never land in shell history:
//   PORTAL_EMAIL=…  PORTAL_PASSWORD=…  (PORTAL_BASE optional, defaults to prod)
//
// Usage:
//   PORTAL_EMAIL=you@x PORTAL_PASSWORD=… node apps/launcher-api/scripts/seed-project-profile.mjs \
//     --key bookofborut --name "Book of Borut" --client borut \
//     --repo https://github.com/Invisible-Wall-SL/Book-of-Borut.git --branch main \
//     --protocol book --build-cmd "pnpm install && pnpm build" \
//     --env PUBLIC_RGS_TRANSPORT=play4fun --env PUBLIC_RGS_GAME=book
//
//   # Dump the resolved payload without sending it:
//   … --dry-run

const PORTAL_BASE = (process.env.PORTAL_BASE || 'https://app.invisiblewall.org').replace(/\/+$/, '');

function parseArgs(argv) {
	const out = { env: {} };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') {
			out.dryRun = true;
			continue;
		}
		if (a === '--env') {
			const pair = argv[++i] || '';
			const eq = pair.indexOf('=');
			if (eq < 1) {
				throw new Error(`--env expects KEY=VALUE, got "${pair}"`);
			}
			out.env[pair.slice(0, eq)] = pair.slice(eq + 1);
			continue;
		}
		const m = /^--([a-z-]+)$/.exec(a);
		if (m) {
			out[m[1]] = argv[++i];
		}
	}
	return out;
}

function die(msg) {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

const key = (args.key || '').trim();
const name = (args.name || '').trim() || key;
const client = (args.client || '').trim();
const repoUrl = (args.repo || '').trim();
const branch = (args.branch || '').trim();
const protocol = (args.protocol || 'lines').trim() === 'book' ? 'book' : 'lines';
const buildCwd = (args['build-cwd'] || '.').trim();
const buildOut = (args['build-out'] || 'build').trim();
const buildCmd = (args['build-cmd'] || 'pnpm install && pnpm build').trim();

if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) {
	die(`--key "${key}" invalid (lowercase letters/digits/_/- ; must match isValidGameKey()).`);
}
if (!repoUrl) {
	die('--repo <git-url> is required (the URL other machines clone).');
}

const profile = {
	kind: 'game',
	repo: { url: repoUrl, ...(branch ? { branch } : {}) },
	game: {
		publish: {
			key,
			name,
			protocol,
			build_cwd: buildCwd,
			build_out: buildOut,
			build_cmd: buildCmd,
			...(Object.keys(args.env).length ? { env: args.env } : {}),
		},
	},
};

const payload = { key, name, clientKey: client || null, profile };

if (args.dryRun) {
	console.log(JSON.stringify(payload, null, '\t'));
	process.exit(0);
}

const email = process.env.PORTAL_EMAIL;
const password = process.env.PORTAL_PASSWORD;
if (!email || !password) {
	die('Set PORTAL_EMAIL and PORTAL_PASSWORD (owner/admin account) in the environment.');
}

async function main() {
	const loginRes = await fetch(`${PORTAL_BASE}/api/launcher/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (!loginRes.ok) {
		const body = await loginRes.text().catch(() => '');
		die(`Login failed (${loginRes.status}). ${body}`);
	}
	const { token, role } = await loginRes.json();
	if (role !== 'admin') {
		die(`Account role is "${role}" — only the owner (admin) may publish a project profile.`);
	}

	const res = await fetch(`${PORTAL_BASE}/api/launcher/projects`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify(payload),
	});
	const text = await res.text();
	if (!res.ok) {
		die(`Publish failed (${res.status}). ${text}`);
	}
	console.log(`✓ Stored launcher profile for "${key}" (client: ${client || 'unassigned'}).`);
	console.log(`  repo: ${repoUrl}${branch ? ` (branch ${branch})` : ''}`);
	console.log('  Any machine can now: Sync from cloud → Build & publish, no typing.');
}

main().catch((e) => die(e?.message || String(e)));
