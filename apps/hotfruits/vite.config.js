// Don't convert this to a ts file, because of this https://github.com/vitejs/vite/issues/5370
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import baseConfig from 'config-vite';
import { mergeConfig } from 'vite';

const cfg = baseConfig();
const here = dirname(fileURLToPath(import.meta.url));

// Optional protocol switch: when PUBLIC_RGS_TRANSPORT=play4fun is set, alias
// `rgs-requests` to the Play4Fun-backed Stake-shaped facade.
//
// We point at the absolute path to the facade source rather than the package
// subpath ('rgs-translator-eagaming/stake-facade') so that resolution works
// from every consumer (utils-xstate, components-shared, utils-bet, utils-book)
// without each of them needing rgs-translator-eagaming as a declared dep.
const transport = process.env.PUBLIC_RGS_TRANSPORT;
const overrides = {};

if (transport === 'play4fun') {
	overrides.resolve = {
		alias: {
			'rgs-requests': resolve(
				here,
				'../../packages/rgs-translator-eagaming/stake-facade.ts',
			),
		},
	};
	console.info('[apps/hotfruits] PUBLIC_RGS_TRANSPORT=play4fun — using Play4Fun translator');
}

export default mergeConfig(cfg, overrides);
