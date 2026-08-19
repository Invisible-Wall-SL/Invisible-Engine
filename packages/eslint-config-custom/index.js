import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier/flat';
import turbo from 'eslint-config-turbo/flat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

/**
 * Shared flat config for the monorepo. A single `eslint.config.mjs` at the repo
 * root re-exports this; ESLint 9 walks up from each workspace to find it, so
 * per-package config files are not needed.
 */
export default [
	{
		ignores: [
			'**/node_modules/',
			'**/build/',
			'**/dist/',
			'**/.svelte-kit/',
			'**/.turbo/',
			'**/storybook-static/',
			'**/static/',
			'**/*.generated.ts',
			// Book fixtures pasted verbatim out of the math package — 22MB in
			// apps/lines alone. Building an AST for them OOMs eslint, and they are
			// data literals, so there is nothing to lint.
			'**/src/stories/data/',
			// Vendored Emscripten build of the KTX transcoder, shipped next to its
			// .wasm. Machine-generated, so its 144 core-rule hits are not ours.
			'**/transcoders/',
		],
	},

	js.configs.recommended,
	...turbo,

	{
		languageOptions: {
			// 'latest', not a fixed year: the repo already uses import attributes
			// (`with { type: 'json' }`), which a pinned 2022 cannot parse.
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.browser, ...globals.node },
		},
	},

	{
		files: ['**/*.{ts,mts,cts}'],
		languageOptions: { parser: tsParser },
		plugins: { '@typescript-eslint': tsPlugin },
		rules: {
			...tsPlugin.configs.recommended.rules,
			// TS itself reports undefined/unused identifiers with type awareness;
			// the core rules only produce false positives on type-only syntax.
			'no-undef': 'off',
			'no-unused-vars': 'off',
			// Reads `export type { X }` as an assignment to the imported binding.
			// TS already rejects a real write to an import.
			'no-import-assign': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
			],
		},
	},

	...svelte.configs['flat/recommended'],
	{
		// The svelte plugin claims rune modules (*.svelte.ts/js) as well as
		// components, and parses all of them with svelte-eslint-parser. Without
		// handing it a TS sub-parser, every `type`/`interface` in those files is a
		// parse error.
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: { parser: tsParser },
		},
		rules: {
			'no-undef': 'off',
			'no-unused-vars': 'off',
			'no-import-assign': 'off',
		},
	},

	{
		// `turbo/no-undeclared-env-vars` guards turbo's cache keys: a task that
		// reads an undeclared env var caches wrongly. Standalone CLI scripts are
		// never run as turbo tasks, so the rule has nothing to protect there.
		files: ['**/scripts/**', 'services/**', '**/*.config.{js,mjs,ts}'],
		rules: { 'turbo/no-undeclared-env-vars': 'off' },
	},

	prettier,
	...svelte.configs['flat/prettier'],
];
