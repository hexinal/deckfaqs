import { MAX_POSITIONS, POSITIONS } from './constants';

/** Last reading position of a guide, keyed by its base guideUrl. */
export type GuidePosition = {
    /** Relative page path passed to getGuideHtml ('' = first page, e.g. '?page=1'). */
    page: string;
    /** scrollTop / (scrollHeight - clientHeight), 0..1 — portable across layouts. */
    ratio: number;
    /** Last write time (ms since epoch), used to evict the oldest entries. */
    ts: number;
};

type Positions = Record<string, GuidePosition>;

// In-memory copy so the QAM and fullscreen Guide instances share one view and
// reads don't race the (async) storage.
let cache: Positions | undefined;
let loading: Promise<Positions> | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

const isPosition = (v: unknown): v is GuidePosition =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as GuidePosition).page === 'string' &&
    typeof (v as GuidePosition).ratio === 'number' &&
    typeof (v as GuidePosition).ts === 'number';

/** Load (once) the saved positions from SteamClient.Storage; {} on any error. */
export const loadPositions = (): Promise<Positions> => {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
        loading = SteamClient.Storage.GetJSON(POSITIONS)
            .then((raw) => {
                const parsed = JSON.parse(raw as string) as unknown;
                const out: Positions = {};
                if (typeof parsed === 'object' && parsed !== null) {
                    for (const [k, v] of Object.entries(parsed)) {
                        if (isPosition(v)) out[k] = v;
                    }
                }
                return out;
            })
            .catch((): Positions => ({}))
            // A save may have happened while loading; it wins over storage.
            .then((p) => (cache = { ...p, ...(cache ?? {}) }));
    }
    return loading;
};

/** Saved position for a guide, if any (undefined until loadPositions resolved). */
export const getPosition = (guideUrl: string): GuidePosition | undefined =>
    cache?.[guideUrl];

const flush = () => {
    writeTimer = undefined;
    if (!cache) return;
    const entries = Object.entries(cache).sort((a, b) => b[1].ts - a[1].ts);
    if (entries.length > MAX_POSITIONS) {
        cache = Object.fromEntries(entries.slice(0, MAX_POSITIONS));
    }
    void SteamClient.Storage.SetObject(POSITIONS, cache);
};

/**
 * Remember a guide's position. Writes are coalesced (~1s) since this is called
 * from scroll events; pass `immediate` to write right away (e.g. on unmount).
 */
export const savePosition = (
    guideUrl: string,
    position: Omit<GuidePosition, 'ts'>,
    immediate = false
) => {
    cache = { ...(cache ?? {}), [guideUrl]: { ...position, ts: Date.now() } };
    if (writeTimer) clearTimeout(writeTimer);
    if (immediate) flush();
    else writeTimer = setTimeout(flush, 1000);
};

/** Test-only: forget the in-memory cache and pending write. */
export const resetPositionsCache = () => {
    cache = undefined;
    loading = undefined;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = undefined;
};
