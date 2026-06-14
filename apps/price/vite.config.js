// Don't convert this to a ts file, because of this https://github.com/vitejs/vite/issues/5370
import baseConfig from 'config-vite';
import { defineConfig, mergeConfig } from 'vite';

export default defineConfig(({ mode }) =>
	mergeConfig(baseConfig(), {
		define: {
			__IE_DEBUG__: JSON.stringify(mode !== 'production' || process.env.PUBLIC_IE_DEBUG === '1'),
		},
	}),
);
