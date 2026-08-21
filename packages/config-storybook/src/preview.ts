import type { Preview } from '@storybook/svelte';
import { INITIAL_VIEWPORTS } from 'storybook/viewport';

const preview: Preview = {
	parameters: {
		layout: 'fullscreen',
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		viewport: {
			options: {
				...INITIAL_VIEWPORTS,
				engine: {
					name: 'game iframe',
					styles: {
						width: '1200px',
						height: '675px',
					},
				},
				engineMini: {
					name: 'mini player',
					styles: {
						width: '400px',
						height: '225px',
					},
				},
				engineMiniExpanded: {
					name: 'mini player (expanded)',
					styles: {
						width: '800px',
						height: '450px',
					},
				},
			},
		},
	},
	initialGlobals: {
		viewport: { value: 'engine', isRotated: false },
	},
};

export default preview;
