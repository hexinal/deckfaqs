import { defineConfig } from 'vitest/config';

// Smoke test of the built bundle (dist/index.js) — run `pnpm build` first.
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['test/smoke/**/*.test.tsx'],
        setupFiles: ['test/smoke/setup.ts'],
    },
});
