import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.ts'],
        exclude: ['test/smoke/**', 'node_modules/**'],
        setupFiles: ['test/setup.ts'],
    },
});
