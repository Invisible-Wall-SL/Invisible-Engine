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
		],
	},

	js.configs.recommended,
	...turbo,

	{
		languageOptions: {
			ecmaVersion: 2022,
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
		},
	},

	prettier,
	...svelte.configs['flat/prettier'],
];
