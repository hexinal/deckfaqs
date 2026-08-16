import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getPosition,
    loadPositions,
    resetPositionsCache,
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
