// Starts the Playwright MCP server (`.mcp.json` → `playwright`) with the flags this machine needs.
// The server defaults to a headed Google Chrome. A Claude Code cloud container has no display, runs
// as root (Chromium will not start its sandbox) and ships only Playwright's Chromium, reachable as
// `$PLAYWRIGHT_BROWSERS_PATH/chromium`, so each of those adds its flag. A desktop gets the defaults.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = ['-y', '@playwright/mcp@latest'];
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
	args.push('--headless');
if (process.getuid?.() === 0) args.push('--no-sandbox');
const chromium =
	process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium');
if (chromium && existsSync(chromium)) args.push('--executable-path', chromium);

// npx is a .cmd shim on Windows, which Node spawns only through a shell.
const server = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 1));
