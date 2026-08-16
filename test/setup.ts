import { vi } from 'vitest';

// @decky/api connects to the running Decky loader at import time; stub the two
// functions utils.ts uses so the module can load in tests. Individual tests
// override the implementations via `vi.mocked(...)`.
vi.mock('@decky/api', () => ({
    fetchNoCors: vi.fn(),
    executeInTab: vi.fn(),
}));
