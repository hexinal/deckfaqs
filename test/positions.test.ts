import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { call } from '@decky/api';
import {
    flushPositions,
    getPosition,
    loadPositions,
    pickAnchor,
    resetPositionsCache,
    restoreTarget,
    savePosition,
} from '../src/positions';
import { MAX_POSITIONS, POSITIONS } from '../src/constants';

type Stored = Record<string, { page: string; ratio: number; ts: number }>;

// The backend (main.py): its positions file is `files.get('positions')`.
const files = new Map<string, unknown>();
const backend = call as unknown as Mock<
    (route: string, ...args: unknown[]) => Promise<unknown>
>;
const stored = () => files.get('positions') as Stored;
const saves = () => backend.mock.calls.filter((c) => c[0] === 'save_positions');
// Steam's storage, where versions before the backend file kept them.
const legacy = new Map<string, unknown>();
const GetJSON = vi.fn((key: string) =>
    legacy.has(key)
        ? Promise.resolve(JSON.stringify(legacy.get(key)))
        : Promise.reject(new Error('missing'))
);

beforeEach(() => {
    files.clear();
    legacy.clear();
    GetJSON.mockClear();
    backend.mockReset();
    backend.mockImplementation((route, ...args) => {
        if (route === 'load_positions') {
            return Promise.resolve(files.get('positions') ?? null);
        }
        if (route === 'save_positions') {
            files.set('positions', args[0]);
            return Promise.resolve(undefined);
        }
        return Promise.reject(new Error(`unknown route ${route}`));
    });
    resetPositionsCache();
    vi.useFakeTimers();
    vi.stubGlobal('SteamClient', { Storage: { GetJSON } });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('positions', () => {
    it('loads {} when there is no file, the file is bad, or the backend fails', async () => {
        expect(await loadPositions()).toEqual({});
        resetPositionsCache();
        files.set('positions', 'garbage');
        expect(await loadPositions()).toEqual({});
        resetPositionsCache();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        backend.mockRejectedValueOnce(new Error('no backend'));
        expect(await loadPositions()).toEqual({});
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching(/could not load/),
            expect.any(Error)
        );
    });

    it('drops malformed entries and reads once', async () => {
        files.set('positions', {
            'https://g/faqs/1': { page: '', ratio: 0.5, ts: 1 },
            'https://g/faqs/2': { ratio: 'x' },
            'https://g/faqs/3': { page: '', ratio: 0.5, ts: 1, anchor: 5 },
        });
        await loadPositions();
        await loadPositions();
        expect(
            backend.mock.calls.filter((c) => c[0] === 'load_positions')
        ).toHaveLength(1);
        expect(getPosition('https://g/faqs/1')).toEqual({
            page: '',
            ratio: 0.5,
            ts: 1,
        });
        expect(getPosition('https://g/faqs/2')).toBeUndefined();
        expect(getPosition('https://g/faqs/3')).toBeUndefined();
    });

    it('resolves to the live map, including saves made after the load', async () => {
        files.set('positions', {
            'https://g/faqs/1': { page: '', ratio: 0.5, ts: 1 },
        });
        await loadPositions();
        savePosition('https://g/faqs/1', { page: '?page=2', ratio: 0.1 }, true);
        expect((await loadPositions())['https://g/faqs/1']).toMatchObject({
            page: '?page=2',
            ratio: 0.1,
        });
    });

    it('carries positions over from SteamClient.Storage when there is no file yet', async () => {
        legacy.set(POSITIONS, {
            'https://g/faqs/1': { page: '?page=2', ratio: 0.4, ts: 1 },
            'https://g/faqs/2': { ratio: 'x' },
        });
        await loadPositions();
        expect(getPosition('https://g/faqs/1')?.ratio).toBe(0.4);
        expect(getPosition('https://g/faqs/2')).toBeUndefined();
        // ...and writes them to the file straight away.
        await flushPositions();
        expect(stored()).toEqual({
            'https://g/faqs/1': { page: '?page=2', ratio: 0.4, ts: 1 },
        });

        // Once a file exists (even an empty one), Steam's copy is left alone.
        resetPositionsCache();
        GetJSON.mockClear();
        files.set('positions', {});
        expect(await loadPositions()).toEqual({});
        expect(GetJSON).not.toHaveBeenCalled();
    });

    it('coalesces writes and flushes immediately on request', async () => {
        await loadPositions();
        savePosition('https://g/faqs/1', { page: '', ratio: 0.1 });
        savePosition('https://g/faqs/1', { page: '', ratio: 0.2 });
        expect(saves()).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1000);
        await flushPositions();
        expect(saves()).toHaveLength(1);
        expect(getPosition('https://g/faqs/1')?.ratio).toBe(0.2);
        expect(stored()['https://g/faqs/1']?.ratio).toBe(0.2);

        savePosition('https://g/faqs/1', { page: '?page=1', ratio: 0.9 }, true);
        await flushPositions();
        expect(saves()).toHaveLength(2);
        expect(stored()['https://g/faqs/1']).toMatchObject({
            page: '?page=1',
            ratio: 0.9,
        });
    });

    it('flushPositions writes a pending save now', async () => {
        await loadPositions();
        savePosition('https://g/faqs/1', { page: '', ratio: 0.7 });
        await flushPositions();
        expect(stored()['https://g/faqs/1']?.ratio).toBe(0.7);
        // The coalescing timer was consumed, not duplicated.
        await vi.advanceTimersByTimeAsync(1000);
        await flushPositions();
        expect(saves()).toHaveLength(1);
    });

    it('keeps a save made before the file finished loading and never writes a partial map over it', async () => {
        files.set('positions', {
            'https://g/faqs/1': { page: '', ratio: 0.5, ts: 1 },
        });
        const loading = loadPositions();
        savePosition('https://g/faqs/2', { page: '', ratio: 0.3 }, true);
        await loading;
        expect(getPosition('https://g/faqs/1')?.ratio).toBe(0.5);
        expect(getPosition('https://g/faqs/2')?.ratio).toBe(0.3);
        await flushPositions();
        expect(saves()).toHaveLength(1);
        expect(Object.keys(stored()).sort()).toEqual([
            'https://g/faqs/1',
            'https://g/faqs/2',
        ]);
    });

    it('serialises writes so they land in order', async () => {
        await loadPositions();
        let release!: () => void;
        backend.mockImplementationOnce(
            (route, ...args) =>
                new Promise<unknown>((resolve) => {
                    release = () => {
                        files.set('positions', args[0]);
                        resolve(undefined);
                    };
                    void route;
                })
        );
        savePosition('https://g/faqs/1', { page: '', ratio: 0.1 }, true);
        savePosition('https://g/faqs/1', { page: '', ratio: 0.2 }, true);
        // Let the write chain reach the backend; the second save queues.
        await vi.advanceTimersByTimeAsync(0);
        expect(saves()).toHaveLength(1);
        release();
        await flushPositions();
        expect(saves()).toHaveLength(2);
        expect(stored()['https://g/faqs/1']?.ratio).toBe(0.2);
    });

    it('warns when the backend cannot write', async () => {
        await loadPositions();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        backend.mockRejectedValueOnce(new Error('disk full'));
        savePosition('https://g/faqs/1', { page: '', ratio: 0.1 }, true);
        await flushPositions();
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching(/could not save/),
            expect.any(Error)
        );
        // The chain recovers: the next write goes through.
        savePosition('https://g/faqs/1', { page: '', ratio: 0.2 }, true);
        await flushPositions();
        expect(stored()['https://g/faqs/1']?.ratio).toBe(0.2);
    });

    it('evicts the oldest entries beyond MAX_POSITIONS', async () => {
        await loadPositions();
        for (let i = 0; i < MAX_POSITIONS + 5; i++) {
            vi.setSystemTime(1000 + i);
            savePosition(`https://g/faqs/${i}`, { page: '', ratio: 0 }, true);
        }
        await flushPositions();
        expect(Object.keys(stored())).toHaveLength(MAX_POSITIONS);
        expect(stored()['https://g/faqs/0']).toBeUndefined();
        expect(stored()[`https://g/faqs/${MAX_POSITIONS + 4}`]).toBeDefined();
    });
});

describe('pickAnchor / restoreTarget', () => {
    const anchors = [
        { name: 'faqwrap', top: 0 },
        { name: 'section3', top: 300 },
        { name: 'section4', top: 900 },
    ];

    it('picks the last anchor at or above the viewport top with its offset', () => {
        expect(pickAnchor(anchors, 0, 200)).toEqual({
            anchor: 'faqwrap',
            offset: 0,
        });
        expect(pickAnchor(anchors, 500, 200)).toEqual({
            anchor: 'section3',
            offset: 1,
        });
        // 1px tolerance for sub-pixel layout.
        expect(pickAnchor(anchors, 899.5, 200).anchor).toBe('section4');
        expect(pickAnchor([], 500, 200)).toEqual({});
        expect(pickAnchor(anchors, 500, 0)).toEqual({});
    });

    it('restores anchor + offset, capped at the next anchor', () => {
        const pos = { ratio: 0.5, anchor: 'section3', offset: 1 };
        expect(restoreTarget(pos, anchors, 2000, 200)).toBe(500);
        // Narrower layout: section3 is only 150px tall here → stop before section4.
        const compact = [
            { name: 'faqwrap', top: 0 },
            { name: 'section3', top: 300 },
            { name: 'section4', top: 450 },
        ];
        expect(restoreTarget(pos, compact, 2000, 200)).toBe(449);
        // Never beyond the scrollable range.
        expect(restoreTarget(pos, anchors, 600, 200)).toBe(400);
    });

    it('falls back to the ratio when the anchor is missing', () => {
        expect(
            restoreTarget({ ratio: 0.5, anchor: 'gone' }, anchors, 1200, 200)
        ).toBe(500);
        expect(restoreTarget({ ratio: 0.5 }, [], 1200, 200)).toBe(500);
        expect(restoreTarget({ ratio: 2 }, [], 1200, 200)).toBe(1000);
    });
});
