import { main as base } from 'config-storybook';
import type { StorybookConfig } from '@storybook/sveltekit';

const main: StorybookConfig = {
	...base,
	viteFinal: async (config, options) => {
		const upstream = (base as { viteFinal?: StorybookConfig['viteFinal'] }).viteFinal;
		const next = upstream ? await upstream(config, options) : config;
		next.server = {
			...(next.server ?? {}),
			proxy: {
				...(next.server?.proxy ?? {}),
				// EAGaming probe target — see apps/hotfruits/src/stories/EAGamingProbe.stories.svelte
				'/eag': {
					target: 'https://eagaming.com',
					changeOrigin: true,
					secure: true,
					rewrite: (path) => path.replace(/^\/eag/, ''),
				},
			},
		};
		return next;
	},
};

export default main;
