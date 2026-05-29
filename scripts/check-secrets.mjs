#!/usr/bin/env node
/**
 * Pre-commit secret scanner. Zero deps. Scans STAGED content for likely
 * secrets and blocks the commit if any are found.
 *
 * Enable once per clone:  git config core.hooksPath scripts/git-hooks
 * Manual run:             node scripts/check-secrets.mjs
 *
 * To intentionally allow a flagged line, add the marker  // pragma: allowlist secret
 * on that line. Use sparingly.
 */
import { execSync } from 'node:child_process';

const ALLOW = 'pragma: allowlist secret';

// [label, regex]. Keep these specific to avoid false positives.
const PATTERNS = [
	['AWS/R2 access key id', /\bAKIA[0-9A-Z]{16}\b/],
	['Generic 40+ hex secret', /\b[0-9a-f]{40,}\b/],
	['comfy.org API key', /\bcomfyui-[0-9a-f]{32,}\b/],
	['OpenAI key', /\bsk-[A-Za-z0-9]{20,}\b/],
	['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
	['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
	['Postgres URL with password', /\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/],
	['CF Access client secret env', /CF_ACCESS_CLIENT_SECRET\s*[:=]\s*["']?[0-9a-f]{40,}/i],
	['R2 secret env', /R2_SECRET_ACCESS_KEY\s*[:=]\s*["']?[^\s"']{20,}/],
];

// Files we never scan (binaries, lockfiles, this scanner, the docs that
// document patterns, .env.example which is intentionally empty).
const SKIP = [
	/(^|\/)pnpm-lock\.yaml$/,
	/\.(png|jpg|jpeg|webp|gif|ico|svg|woff2?|ttf|atlas|skel|mp3|wav|pdf)$/i,
	/scripts\/check-secrets\.mjs$/,
	/\.env\.example$/,
];

function staged() {
	const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
		encoding: 'utf8',
	});
	return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function stagedContent(file) {
	try {
		return execSync(`git show :"${file}"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	} catch {
		return '';
	}
}

const findings = [];
for (const file of staged()) {
	if (SKIP.some((re) => re.test(file))) continue;
	const content = stagedContent(file);
	if (!content) continue;
	const lines = content.split('\n');
	lines.forEach((line, i) => {
		if (line.includes(ALLOW)) return;
		for (const [label, re] of PATTERNS) {
			if (re.test(line)) {
				findings.push({ file, line: i + 1, label });
				break;
			}
		}
	});
}

if (findings.length) {
	console.error('\n\x1b[31m✖ Commit blocked — possible secret(s) detected:\x1b[0m\n');
	for (const f of findings) {
		console.error(`  ${f.file}:${f.line}  — ${f.label}`);
	}
	console.error(
		'\nMove the value to an environment variable. If this is a genuine false ' +
			`positive, add "${ALLOW}" on that line.\n`,
	);
	process.exit(1);
}
