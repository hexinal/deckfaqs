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
    ...tseslint.configs.recommendedTypeChecked,
    reactHooks.configs.flat.recommended,
    {
        files: ['**/*.{ts,tsx,js,mjs,cjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                // Type-aware rules (no-floating-promises, ...) via the tsconfig.
                projectService: {
                    // Root config files are not part of tsconfig.json.
                    allowDefaultProject: ['*.js'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.browser,
                // Ambient Steam client globals (see src/SteamClient.d.ts / @decky/ui).
                SteamClient: 'readonly',
                appStore: 'readonly',
                collectionStore: 'readonly',
            },
        },
        rules: {
            // React's own recommendation is warn; CI is kept at 0 occurrences.
            'react-hooks/exhaustive-deps': 'warn',
            // tsc (noUnusedLocals/noUnusedParameters) already enforces this.
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
            // Required by verbatimModuleSyntax; auto-fixable. Separate imports so
            // an all-types import is dropped entirely instead of leaving a
            // side-effect `import 'module'` behind.
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { fixStyle: 'separate-type-imports' },
            ],
            '@typescript-eslint/no-import-type-side-effects': 'error',
            // Fire-and-forget promises silently drop errors and ordering.
            '@typescript-eslint/no-floating-promises': 'error',
        },
    },
    {
        // Node-side config files: plain JS, no type information.
        files: ['*.config.js', 'rollup.config.js', 'commitlint.config.js'],
        ...tseslint.configs.disableTypeChecked,
        languageOptions: { globals: globals.node },
    },
    // Must be last: disables stylistic rules that conflict with prettier.
    eslintConfigPrettier,
]);
