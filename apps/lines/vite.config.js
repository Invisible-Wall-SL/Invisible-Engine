// Don't convert this to a ts file, because of this https://github.com/vitejs/vite/issues/5370
import baseConfig from 'config-vite';
import { mergeConfig } from 'vite';

const cfg = baseConfig();

// Optional protocol switch: when PUBLIC_RGS_TRANSPORT=play4fun is set, alias
// `rgs-requests` to the Play4Fun-backed facade. Game code is unchanged; the
// alias swaps the implementation at build time.
const transport = process.env.PUBLIC_RGS_TRANSPORT;
const overrides = {};

if (transport === 'play4fun') {
	overrides.resolve = {
		alias: {
			'rgs-requests': 'rgs-translator-eagaming/stake-facade',
		},
	};
	console.info('[apps/lines] PUBLIC_RGS_TRANSPORT=play4fun — using Play4Fun translator');
}

export default mergeConfig(cfg, overrides);
