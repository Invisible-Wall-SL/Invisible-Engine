// The browser every real-clock playtest script drives: Playwright's headless shell over
// --remote-debugging-pipe (CDP on fds 3/4, no network listener) with the GPU on, so the page is
// `visible`, focused and runs the real frame clock. Where the shell differs by machine — its binary
// name, running as root — is in docs/playtest/README.md ("The headless real clock").
//
//   const chrome = spawnHeadlessShell(headlessShell(opt.chrome), { profile, width, height });

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Chrome-for-Testing builds name it `chrome-headless-shell`; older Chromium builds (the Claude Code
// cloud image's under /opt/pw-browsers) name it `headless_shell`.
const NAMES = ['chrome-headless-shell', 'headless_shell'].map((name) =>
	process.platform === 'win32' ? `${name}.exe` : name,
);

const entries = (dir) => {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
};
const revision = (build) => Number(/-(\d+)$/.exec(build)?.[1] ?? -1);

/** The newest Playwright headless shell on this machine, under either name. */
export function findHeadlessShell() {
	const roots = [
		process.env.PLAYWRIGHT_BROWSERS_PATH,
		process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
		join(homedir(), '.cache', 'ms-playwright'),
		join(homedir(), 'Library', 'Caches', 'ms-playwright'),
	].filter((root) => root && existsSync(root));
	for (const root of roots) {
		const builds = entries(root).sort((a, b) => revision(b) - revision(a));
		for (const build of builds)
			for (const platformDir of entries(join(root, build)))
				for (const name of NAMES) {
					const path = join(root, build, platformDir, name);
					if (existsSync(path)) return path;
				}
	}
	return undefined;
}

/** `override` (a `--chrome <exe>`) or the newest headless shell; exits when there is neither. */
export function headlessShell(override) {
	const path = override ?? findHeadlessShell();
	if (path) return path;
	console.error(
		'No Playwright headless shell found — `npx playwright install chromium-headless-shell`.',
	);
	process.exit(1);
}

// Without the GPU flags the shell renders WebGL in software at ~12 fps. Measured on Windows (ANGLE
// on D3D11); elsewhere check the `fps` the run prints first. On a machine with no GPU (a CI
// runner), WebGL needs SwiftShader, which newer Chrome builds no longer fall back to on their own:
// without `--enable-unsafe-swiftshader` the page gets no WebGL at all and Pixi silently falls back
// to its Canvas renderer, a path no player's browser takes.
const GPU_FLAGS =
	process.platform === 'win32'
		? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
		: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

/**
 * Start the shell on a blank page with CDP on `stdio[3]` (to Chrome) and `stdio[4]` (from it).
 * `stderrTail()` is the end of what it printed — the reason when it exits before answering.
 */
export function spawnHeadlessShell(path, { profile, width, height }) {
	const chrome = spawn(
		path,
		[
			'--headless',
			'--remote-debugging-pipe',
			`--user-data-dir=${profile}`,
			`--window-size=${width},${height}`,
			'--no-first-run',
			'--no-default-browser-check',
			'--autoplay-policy=no-user-gesture-required',
			...GPU_FLAGS,
			// Chromium will not start its sandbox as root, a cloud container's default user.
			...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
			'about:blank',
		],
		{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
	);
	let stderr = '';
	chrome.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
	chrome.stderrTail = () => stderr.trim();
	return chrome;
}
