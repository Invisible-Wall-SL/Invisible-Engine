#!/usr/bin/env node
/**
 * Secret scanner. Zero deps. Reports file, line and secret TYPE — never the value.
 *
 *   node scripts/check-secrets.mjs                 staged content (the pre-commit hook)
 *   node scripts/check-secrets.mjs --diff <base>   lines ADDED in <base>...HEAD (CI); a value
 *                                                  containing `..` is used as the range as-is
 *   node scripts/check-secrets.mjs --history [rev-list args]
 *                                                  lines added by every commit (default --all)
 *
 * Enable the hook once per clone:  git config core.hooksPath scripts/git-hooks
 * Tests:                           node scripts/check-secrets.test.mjs
 *
 * To intentionally allow a flagged line, add the marker  // pragma: allowlist secret
 * on that line. Use sparingly.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const ALLOW = 'pragma: allowlist secret';

// [label, regex]. Keep these specific to avoid false positives: a vendor prefix, or a
// well-known variable name, or both. Order matters only for the reported label.
export const PATTERNS = [
	['Private key block', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
	['Anthropic API key', /\bsk-ant-(?:api|admin|oat|ort)\d{2}-[A-Za-z0-9_-]{32,}/],
	['OpenAI key', /\bsk-(?:proj|svcacct|admin|None)-[A-Za-z0-9_-]{32,}/],
	['OpenAI key (legacy)', /\bsk-[A-Za-z0-9]{32,}\b/],
	['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
	['GitHub fine-grained PAT', /\bgithub_pat_[A-Za-z0-9_]{60,}/],
	['RunPod API key', /\brpa_[A-Za-z0-9]{30,}\b/],
	['Cloudflare API token', /\bcf(?:k|ut|at)_[A-Za-z0-9_-]{30,}/],
	[
		'Cloudflare API token/key env',
		/\b(?:CLOUDFLARE|CF)_(?:API_)?(?:TOKEN|KEY|API_KEY)\s*[:=]\s*["']?[A-Za-z0-9_-]{37,}/,
	],
	['Cloudflare tunnel token', /(?:--token[\s=]+|TUNNEL_TOKEN\s*[:=]\s*["']?)eyJ[A-Za-z0-9_-]{50,}/],
	['CF Access client secret env', /CF_ACCESS_CLIENT_SECRET\s*[:=]\s*["']?[0-9a-f]{40,}/i],
	['AWS/R2 access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
	[
		'AWS/R2 secret access key env',
		/\b(?:AWS|R2|S3)_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{20,}/,
	],
	['R2 access key id env', /\b(?:R2|S3)_ACCESS_KEY_ID\s*[:=]\s*["']?[0-9a-f]{32}\b/],
	['Slack token', /\bxox[abeoprs]-[0-9A-Za-z-]{10,}\b/],
	['Slack webhook', /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/],
	['Discord webhook', /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{50,}/],
	['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
	['Stripe live key', /\b(?:sk|rk)_live_[0-9A-Za-z]{24,}\b/],
	['Hugging Face token', /\bhf_[A-Za-z0-9]{34,}\b/],
	['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
	['comfy.org API key', /\bcomfyui-[0-9a-f]{32,}\b/],
	['Civitai token env', /\bCIVITAI_(?:API_)?(?:TOKEN|KEY)\s*[:=]\s*["']?[0-9a-f]{32}\b/],
	[
		'Database URL with password',
		/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^:\s/@]+:[^@\s/]+@/,
	],
	// A pip `--hash=sha256:<hex>` pin (hash-checked requirements) is a public checksum, not a secret.
	['Generic 40+ hex secret', /(?<!--hash=sha(?:256|384|512):)\b[0-9a-f]{40,}\b/],
];

// A match that reads like documentation, not a credential: `sk-ant-api03-xxxx…`, `<token>`,
// `${VAR}`, `postgres://user:password@…`. Only suppresses the match it is part of.
const PLACEHOLDER =
	/x{6,}|X{6,}|\*{4,}|\.\.\.|…|<[^>]*>|\$\{|\$[A-Z_]{3,}|\{\{|your[_-]|example|changeme|placeholder|redacted|:password@|:pass@|:secret@/i;

// Files we never scan (binaries, lockfiles, this scanner, .env.example which is
// intentionally empty).
const SKIP = [
	/(^|\/)pnpm-lock\.yaml$/,
	/(^|\/)package-lock\.json$/,
	/\.(png|jpg|jpeg|webp|gif|ico|svg|woff2?|ttf|otf|atlas|skel|mp3|mp4|ogg|wav|pdf|ktx2|zip)$/i,
	/(^|\/)scripts\/check-secrets\.mjs$/,
	/\.env\.example$/,
];

export function skipFile(file) {
	return SKIP.some((re) => re.test(file));
}

/** The label of the first pattern a line matches, or null. */
export function scanLine(line) {
	if (line.includes(ALLOW)) return null;
	for (const [label, re] of PATTERNS) {
		const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
		for (const m of line.matchAll(global)) {
			if (!PLACEHOLDER.test(m[0])) return label;
		}
	}
	return null;
}

/** Findings for a whole file's content: [{ file, line, label }]. */
export function scanContent(file, content) {
	if (skipFile(file)) return [];
	const findings = [];
	content.split('\n').forEach((line, i) => {
		const label = scanLine(line);
		if (label) findings.push({ file, line: i + 1, label });
	});
	return findings;
}

/**
 * Parses `git diff`/`git log -p` output (with --unified=0 or more) line by line and yields
 * one finding per ADDED line that matches. Commit headers (`commit <sha>`) set `commit`.
 */
export function createDiffScanner(onFinding) {
	let commit = null;
	let file = null;
	let lineNo = 0;
	return (raw) => {
		const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		if (line.startsWith('commit ')) {
			commit = line.slice(7, 47);
			file = null;
		} else if (line.startsWith('+++ ')) {
			const path = line.slice(4);
			file = path === '/dev/null' ? null : path.replace(/^b\//, '').replace(/^"b\/(.*)"$/, '$1');
		} else if (line.startsWith('@@')) {
			const m = /\+(\d+)/.exec(line);
			lineNo = m ? Number(m[1]) : 0;
		} else if (line.startsWith('+') && file) {
			if (!skipFile(file)) {
				const label = scanLine(line.slice(1));
				if (label) onFinding({ commit, file, line: lineNo, label });
			}
			lineNo++;
		} else if (line.startsWith(' ')) {
			lineNo++;
		}
	};
}

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function scanStaged() {
	const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);
	const findings = [];
	for (const file of files) {
		if (skipFile(file)) continue;
		let content = '';
		try {
			content = git(['show', `:${file}`]);
		} catch {
			continue;
		}
		findings.push(...scanContent(file, content));
	}
	return findings;
}

function scanDiff(base) {
	const range = base.includes('..') ? base : `${base}...HEAD`;
	const findings = [];
	const scan = createDiffScanner((f) => findings.push(f));
	git(['diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', range])
		.split('\n')
		.forEach(scan);
	return findings;
}

function scanHistory(revArgs) {
	return new Promise((resolve, reject) => {
		const findings = [];
		const scan = createDiffScanner((f) => findings.push(f));
		const child = spawn(
			'git',
			[
				'log',
				'-p',
				'--unified=0',
				'--no-color',
				'--no-ext-diff',
				'--no-renames',
				'--format=commit %H',
				...(revArgs.length ? revArgs : ['--all']),
			],
			{ stdio: ['ignore', 'pipe', 'inherit'] },
		);
		createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', scan);
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve(findings) : reject(new Error(`git log exited ${code}`)),
		);
	});
}

function report(findings, blocked) {
	if (!findings.length) return;
	console.error(`\n\x1b[31m✖ ${blocked} — possible secret(s) detected:\x1b[0m\n`);
	for (const f of findings) {
		const at = f.commit ? `${f.commit.slice(0, 12)} ` : '';
		console.error(`  ${at}${f.file}:${f.line}  — ${f.label}`);
	}
	console.error(
		'\nMove the value to an environment variable. If this is a genuine false ' +
			`positive, add "${ALLOW}" on that line.\n`,
	);
	process.exitCode = 1;
}

async function main(argv) {
	const [mode, ...rest] = argv;
	if (mode === '--diff') {
		if (!rest[0]) throw new Error('--diff needs a base ref or range');
		report(scanDiff(rest[0]), 'Diff rejected');
	} else if (mode === '--history') {
		report(await scanHistory(rest), 'History scan');
	} else {
		report(scanStaged(), 'Commit blocked');
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err.message);
		process.exit(2);
	});
}
