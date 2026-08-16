import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getPosition,
    loadPositions,
    pickAnchor,
    resetPositionsCache,
    restoreTarget,
    savePosition,
} from '../src/positions';
import { MAX_POSITIONS, POSITIONS } from '../src/constants';

const storage = new Map<string, unknown>();
const SetObject = vi.fn((key: string, value: unknown) => {
    storage.set(key, value);
    return Promise.resolve(undefined);
});
const GetJSON = vi.fn((key: string) =>
    storage.has(key)
        ? Promise.resolve(JSON.stringify(storage.get(key)))
        : Promise.reject(new Error('missing'))
);

beforeEach(() => {
    storage.clear();
    SetObject.mockClear();
    GetJSON.mockClear();
    resetPositionsCache();
    vi.useFakeTimers();
    vi.stubGlobal('SteamClient', { Storage: { GetJSON, SetObject } });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('positions', () => {
    it('loads {} when nothing is stored or the JSON is bad', async () => {
        expect(await loadPositions()).toEqual({});
        resetPositionsCache();
        storage.set(POSITIONS, 'garbage');
        GetJSON.mockResolvedValueOnce('{not json');
        expect(await loadPositions()).toEqual({});
    });

    it('drops malformed entries and reads once', async () => {
        storage.set(POSITIONS, {
            'https://g/faqs/1': { page: '', ratio: 0.5, ts: 1 },
            'https://g/faqs/2': { ratio: 'x' },
            'https://g/faqs/3': { page: '', ratio: 0.5, ts: 1, anchor: 5 },
        });
        await loadPositions();
        await loadPositions();
        expect(GetJSON).toHaveBeenCalledTimes(1);
        expect(getPosition('https://g/faqs/1')).toEqual({
            page: '',
            ratio: 0.5,
            ts: 1,
        });
        expect(getPosition('https://g/faqs/2')).toBeUndefined();
        expect(getPosition('https://g/faqs/3')).toBeUndefined();
    });

    it('coalesces writes and flushes immediately on request', async () => {
        await loadPositions();
        savePosition('https://g/faqs/1', { page: '', ratio: 0.1 });
        savePosition('https://g/faqs/1', { page: '', ratio: 0.2 });
        expect(SetObject).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(SetObject).toHaveBeenCalledTimes(1);
        expect(getPosition('https://g/faqs/1')?.ratio).toBe(0.2);

        savePosition('https://g/faqs/1', { page: '?page=1', ratio: 0.9 }, true);
        expect(SetObject).toHaveBeenCalledTimes(2);
        const stored = storage.get(POSITIONS) as Record<
            string,
            { page: string; ratio: number }
        >;
        expect(stored['https://g/faqs/1']).toMatchObject({
            page: '?page=1',
            ratio: 0.9,
        });
    });

    it('keeps a save made before storage finished loading', async () => {
        storage.set(POSITIONS, {
            'https://g/faqs/1': { page: '', ratio: 0.5, ts: 1 },
        });
        const loading = loadPositions();
        savePosition('https://g/faqs/2', { page: '', ratio: 0.3 });
        await loading;
        expect(getPosition('https://g/faqs/1')?.ratio).toBe(0.5);
        expect(getPosition('https://g/faqs/2')?.ratio).toBe(0.3);
    });

    it('evicts the oldest entries beyond MAX_POSITIONS', async () => {
        await loadPositions();
        for (let i = 0; i < MAX_POSITIONS + 5; i++) {
            vi.setSystemTime(1000 + i);
            savePosition(`https://g/faqs/${i}`, { page: '', ratio: 0 }, true);
        }
        const stored = storage.get(POSITIONS) as Record<string, unknown>;
        expect(Object.keys(stored)).toHaveLength(MAX_POSITIONS);
        expect(stored['https://g/faqs/0']).toBeUndefined();
        expect(stored[`https://g/faqs/${MAX_POSITIONS + 4}`]).toBeDefined();
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
