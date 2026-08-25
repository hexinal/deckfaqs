import { callable } from '@decky/api';
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

// The positions live in a file the backend (main.py) owns under Decky's
// settings dir: SteamClient.Storage (Steam's localconfig.vdf) is only flushed
// now and then, so a hard power-off or a reinstall lost them. `null` = no file.
const loadStore = callable<[], unknown>('load_positions');
const saveStore = callable<[Positions], void>('save_positions');

// In-memory copy so the QAM and fullscreen Guide instances share one view and
// reads don't race the (async) storage.
let cache: Positions | undefined;
let loading: Promise<Positions> | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
// Writes are chained so two coalesced saves can never land out of order.
let writing: Promise<void> = Promise.resolve();

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

/** Keep only well-formed entries of a stored map. */
const parsePositions = (parsed: unknown): Positions => {
    const out: Positions = {};
    if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
            if (isPosition(v)) out[k] = v;
        }
    }
    return out;
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

/** What versions before the backend file kept in SteamClient.Storage; {} if none. */
const loadLegacy = (): Promise<Positions> =>
    SteamClient.Storage.GetJSON(POSITIONS)
        .then((raw) => parsePositions(JSON.parse(raw as string)))
        .catch((): Positions => ({}));

/**
 * Load (once) the saved positions from the backend; {} on any error. Keyed on
 * the load itself, not on `cache`: a save made before the file is read
 * already fills `cache`, and a write must still wait for the load.
 */
export const loadPositions = (): Promise<Positions> => {
    if (!loading) {
        let migrate = false;
        loading = loadStore()
            .then(async (stored) => {
                if (stored !== null && stored !== undefined) {
                    return parsePositions(stored);
                }
                // No file yet: carry over what an older version saved in Steam's storage.
                const legacy = await loadLegacy();
                migrate = Object.keys(legacy).length > 0;
                return legacy;
            })
            .catch((e: unknown): Positions => {
                console.warn('[DeckFAQs] could not load reading positions', e);
                return {};
            })
            .then((p) => {
                // A save may have happened while loading; it wins over storage.
                cache = { ...p, ...(cache ?? {}) };
                if (migrate) void write();
                return cache;
            });
    }
    // The live map, not the one the load resolved with: saves replace `cache`.
    return loading.then(() => cache ?? {});
};

/** Saved position for a guide, if any (undefined until loadPositions resolved). */
export const getPosition = (guideUrl: string): GuidePosition | undefined =>
    cache?.[guideUrl];

const write = (): Promise<void> => {
    writing = writing
        // Never write a partial map over a full one: wait for the load first.
        .then(() => loadPositions())
        .then(() => {
            if (!cache) return;
            const entries = Object.entries(cache).sort(
                (a, b) => b[1].ts - a[1].ts
            );
            if (entries.length > MAX_POSITIONS) {
                cache = Object.fromEntries(entries.slice(0, MAX_POSITIONS));
            }
            return saveStore(cache);
        })
        .catch((e: unknown) => {
            console.warn('[DeckFAQs] could not save reading positions', e);
        });
    return writing;
};

const flush = (): Promise<void> => {
    writeTimer = undefined;
    return write();
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
    if (immediate) void flush();
    else writeTimer = setTimeout(() => void flush(), 1000);
};

/**
 * Write a pending (coalesced) save now — before the plugin unloads or the
 * panel is hidden. Resolves once every write so far has landed.
 */
export const flushPositions = (): Promise<void> => {
    if (writeTimer) {
        clearTimeout(writeTimer);
        return flush();
    }
    return writing;
};

/** Test-only: forget the in-memory cache and pending write. */
export const resetPositionsCache = () => {
    cache = undefined;
    loading = undefined;
    writing = Promise.resolve();
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = undefined;
};
