import { vi } from 'vitest';

// @decky/api connects to the running Decky loader at import time; stub what
// the modules under test use so they can load. Individual tests override the
// implementations via `vi.mocked(...)`: `callable(route)` forwards to `call`,
// so mocking `call` fakes the backend (main.py) for every route.
vi.mock('@decky/api', () => {
    const call =
        vi.fn<(route: string, ...args: unknown[]) => Promise<unknown>>();
    return {
        fetchNoCors: vi.fn(),
        executeInTab: vi.fn(),
        call,
        callable: vi.fn(
            (route: string) =>
                (...args: unknown[]) =>
                    call(route, ...args)
        ),
    };
});
