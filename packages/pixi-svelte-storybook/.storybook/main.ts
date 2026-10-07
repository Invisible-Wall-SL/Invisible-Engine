import { main as base } from 'config-storybook';
import type { StorybookConfig } from '@storybook/sveltekit';

// The rig stories draw the reference game's own art (`/assets/...`) plus the small demo rigs in
// `static/rigs`, which reuse that art's atlas pages.
const main: StorybookConfig = {
	...base,
	staticDirs: [
		...(base.staticDirs ?? []),
		{ from: '../../../apps/lines/static/assets', to: '/assets' },
	],
};

export default main;
