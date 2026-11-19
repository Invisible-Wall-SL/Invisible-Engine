import { captureError } from 'error-tracking';

/**
 * Stop a 3D game that cannot run here (no WebGL 2, the 3D chunk did not load, a room level the
 * device cannot read), on a screen that says so — compiled only into the `arcade3d` runtime. The
 * shared boot dead end (`editor-scenes.ts`) always blames the server, which would send a player on
 * a WebGL 1 device to reload forever, and changing it would change every runtime's bytes.
 *
 * Covers the whole page, HUD included, like the shared one; built node by node, never `innerHTML`.
 */
export function showUnplayable3d(reason: string): void {
	console.error(`[engine-3d] the 3D field could not start — ${reason}`);
	captureError(new Error(`3D field could not start: ${reason}`), {
		tags: { area: 'boot', view: '3d' },
		fingerprint: ['boot', 'arcade3d'],
	});
	if (document.getElementById(SCREEN_ID)) return;
	const screen = document.createElement('div');
	screen.id = SCREEN_ID;
	screen.setAttribute(
		'style',
		'position:fixed;inset:0;z-index:2147483647;background:#0b0b0ff2;color:#fff;display:flex;' +
			'flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;' +
			'text-align:center;font:400 15px/1.5 system-ui,sans-serif',
	);
	const title = document.createElement('div');
	title.textContent = 'This game cannot run here';
	title.setAttribute('style', 'font:600 20px/1.3 system-ui,sans-serif');
	const body = document.createElement('div');
	body.textContent = `It draws in 3D, and ${reason}.`;
	body.setAttribute('style', 'max-width:440px;opacity:.85');
	screen.append(title, body);
	document.body.appendChild(screen);
}

const SCREEN_ID = 'ie-unplayable-3d';
