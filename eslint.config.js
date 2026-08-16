import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores([
        'dist',
        'node_modules',
        'out',
        // Vendored fork of mark.js — treat as third-party.
        'src/components/Guide/mark.ts',
    ]),
    js.configs.recommended,
    ...tseslint.configs.recommended,
    reactHooks.configs.flat.recommended,
    {
        files: ['**/*.{ts,tsx,js,mjs,cjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                // Ambient Steam client globals (see src/SteamClient.d.ts / @decky/ui).
                SteamClient: 'readonly',
                appStore: 'readonly',
                collectionStore: 'readonly',
            },
        },
        rules: {
            // Warn-first rollout: these fire on existing code and are tracked
            // as follow-up cleanups. Flip to 'error' once src/ is clean.
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/ban-ts-comment': 'warn',
            'react-hooks/exhaustive-deps': 'warn',
            'react-hooks/immutability': 'warn',
            '@typescript-eslint/no-unused-expressions': 'warn',
            '@typescript-eslint/no-unsafe-function-type': 'warn',
            'no-useless-escape': 'warn',
            'no-useless-assignment': 'warn',
            'no-case-declarations': 'warn',
            'prefer-const': 'warn',
            // tsc (noUnusedLocals/noUnusedParameters) already enforces this.
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
        },
    },
    {
        // Node-side config files.
        files: ['*.config.js', 'rollup.config.js', 'commitlint.config.js'],
        languageOptions: { globals: globals.node },
    },
    // Must be last: disables stylistic rules that conflict with prettier.
    eslintConfigPrettier,
]);
