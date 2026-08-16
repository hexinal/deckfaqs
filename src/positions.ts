import { MAX_POSITIONS, POSITIONS } from './constants';

/** Last reading position of a guide, keyed by its base guideUrl. */
export type GuidePosition = {
    /** Relative page path passed to getGuideHtml ('' = first page, e.g. '?page=1'). */
    page: string;
    /** scrollTop / (scrollHeight - clientHeight), 0..1 — fallback when the anchor is gone. */
    ratio: number;
    /** Nearest `[name]`/`[id]` at or above the viewport top, when the page has any. */
    anchor?: string;
    /** How far past the anchor the viewport top was, in viewport heights. */
    offset?: number;
    /** Last write time (ms since epoch), used to evict the oldest entries. */
    ts: number;
};

type Positions = Record<string, GuidePosition>;

// In-memory copy so the QAM and fullscreen Guide instances share one view and
// reads don't race the (async) storage.
let cache: Positions | undefined;
let loading: Promise<Positions> | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

const isPosition = (v: unknown): v is GuidePosition => {
    if (typeof v !== 'object' || v === null) return false;
    const p = v as GuidePosition;
    return (
        typeof p.page === 'string' &&
        typeof p.ratio === 'number' &&
        typeof p.ts === 'number' &&
        (p.anchor === undefined || typeof p.anchor === 'string') &&
        (p.offset === undefined || typeof p.offset === 'number')
    );
};

/** An anchorable element's name and its top, in scroll-container coordinates. */
export type AnchorTop = { name: string; top: number };

/**
 * The anchor to remember for a viewport whose top is at `scrollTop`: the last
 * one at or above it, plus the distance past it in viewport heights.
 * `anchors` must be sorted by `top`.
 */
export const pickAnchor = (
    anchors: readonly AnchorTop[],
    scrollTop: number,
    clientHeight: number
): Pick<GuidePosition, 'anchor' | 'offset'> => {
    let found: AnchorTop | undefined;
    for (const a of anchors) {
        if (a.top > scrollTop + 1) break;
        found = a;
    }
    if (!found || clientHeight <= 0) return {};
    return {
        anchor: found.name,
        offset: Math.max(0, (scrollTop - found.top) / clientHeight),
    };
};

/**
 * scrollTop to restore `position` from: the saved anchor plus its offset,
 * never past the next anchor (layouts differ between panel and fullscreen);
 * falls back to the ratio when the anchor isn't on this page.
 */
export const restoreTarget = (
    position: Pick<GuidePosition, 'ratio' | 'anchor' | 'offset'>,
    anchors: readonly AnchorTop[],
    scrollHeight: number,
    clientHeight: number
): number => {
    const max = Math.max(0, scrollHeight - clientHeight);
    if (position.anchor !== undefined) {
        const i = anchors.findIndex((a) => a.name === position.anchor);
        if (i >= 0) {
            const top = anchors[i]!.top;
            let target = top + (position.offset ?? 0) * clientHeight;
            const next = anchors[i + 1];
            if (next && next.top > top) target = Math.min(target, next.top - 1);
            return Math.min(max, Math.max(0, target));
        }
    }
    return Math.min(max, Math.max(0, position.ratio * max));
};

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
