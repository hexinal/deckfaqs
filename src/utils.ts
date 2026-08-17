import { executeInTab, fetchNoCors } from '@decky/api';
import type { Dispatch } from 'react';
import { BLANK_PAGE } from './constants';
import type { BrowserView, TableOfContentEntry } from './context/AppContext';
import { ActionType, type AppActions } from './reducers/AppReducer';
import { sanitizeGuideHtml } from './sanitize';
import {
    gamefaqsSearchUrl,
    getGamesCode,
    getGuideCode,
    parseSearchResults,
} from './sources/gamefaqs';
import {
    isNeoImageUrl,
    neoGameSearch,
    neoGuideCode,
    neoImagePage,
} from './sources/neoseeker';
import {
    badPayloadError,
    isAllowedScrapeUrl,
    notFoundError,
    SOURCE_LABEL,
    sourceOf,
    unreachableError,
    type GuideSource,
    type Source,
} from './sources/source';
import type { ListItem } from './components/List/List';

async function delay(ms: number, state = null) {
    return new Promise((resolve, _reject) => {
        window.setTimeout(() => resolve(state), ms);
    });
}

const MAX_POLLING = 100;
const CEF_TABS_URL = 'http://localhost:8080/json';

export const ERROR_NO_BROWSER_VIEW =
    "Steam's browser view is unavailable. Restart Steam and try again.";
// Fallback for rejections that are not Errors; site-specific messages come from sources/source.ts.
const ERROR_UNREACHABLE =
    "Couldn't load the guide. Check the connection and retry.";

type CefTab = { id?: string; url: string; title: string };

/** True for the URL the hidden view is parked on between loads. */
const isParkedUrl = (url: string): boolean => url.startsWith('data:text/html');

// CEF reports the loaded URL percent-encoded (including apostrophes);
// don't re-encode URLs that already contain escapes.
export const toCefTabUrl = (url: string): string => {
    const alreadyEncoded = /%[0-9a-f]{2}/i.test(url);
    return (alreadyEncoded ? url : encodeURI(url)).replace(/'/g, '%27');
};

// Lists the tabs of Steam's CEF instance via its remote-debugging endpoint.
const getDebuggerTabs = async (): Promise<CefTab[]> => {
    try {
        const response = await fetchNoCors(CEF_TABS_URL);
        if (!response.ok) return [];
        return (await response.json()) as CefTab[];
    } catch (e) {
        console.error('[DeckFAQs] CEF debugger query failed', e);
        return [];
    }
};

// Runs `code` in the tab with the given title and returns its string result ('' on failure).
const runInTab = async (title: string, code: string): Promise<string> => {
    try {
        const res = await executeInTab(title, true, code);
        return res.success && typeof res.result === 'string' ? res.result : '';
    } catch (e) {
        console.error('[DeckFAQs] executeInTab failed', e);
        return '';
    }
};

// ---------------------------------------------------------------------------
// Request bookkeeping: "latest wins". Every user-initiated fetch goes through
// request(); a newer request (or Back, via cancelPendingRequests) supersedes
// older ones so their late results can't yank the UI forward again.
// ---------------------------------------------------------------------------

export type RequestContext = {
    browserView?: BrowserView;
    /** True once a newer request has started (or Back was pressed). */
    cancelled: () => boolean;
};

type RequestDeps = {
    browserView?: BrowserView;
    dispatch: Dispatch<AppActions>;
};

let latestRequest = 0;
let lastRequest: (() => void) | undefined;

/** Drop the results of any in-flight request (e.g. when navigating Back). */
export const cancelPendingRequests = () => {
    latestRequest++;
    lastRequest = undefined;
};

/** Re-run the most recent request (used by the error/retry UI). */
export const retryLastRequest = () => {
    lastRequest?.();
};

/**
 * Runs `run` as the newest request. `run` is invoked synchronously (so it can
 * dispatch a loading state first); `onResult` only fires if no newer request
 * started meanwhile. Errors surface as UPDATE_ERROR under the same rule.
 */
export const request = <T>(
    { browserView, dispatch }: RequestDeps,
    run: (ctx: RequestContext) => Promise<T>,
    onResult: (result: T) => void
): void => {
    const id = ++latestRequest;
    const ctx: RequestContext = {
        browserView,
        cancelled: () => id !== latestRequest,
    };
    lastRequest = () => request({ browserView, dispatch }, run, onResult);
    run(ctx)
        .then((result) => {
            if (!ctx.cancelled()) onResult(result);
        })
        .catch((e: unknown) => {
            if (ctx.cancelled()) return;
            console.error('[DeckFAQs] request failed', e);
            dispatch({
                type: ActionType.UPDATE_ERROR,
                payload: e instanceof Error ? e.message : ERROR_UNREACHABLE,
            });
        });
};

// ---------------------------------------------------------------------------
// Scraping through the hidden BrowserView. There is exactly one view, so
// scrapes are serialised through `scrapeQueue`; a cancelled request gives the
// view up early instead of polling for the full MAX_POLLING window.
// ---------------------------------------------------------------------------

let scrapeQueue: Promise<unknown> = Promise.resolve();

// Loads `url` in the hidden BrowserView, waits for its tab to appear, then runs
// `code` in it. Resolves '' if the request was cancelled; throws on failure.
const doScrape = async (
    url: string,
    { browserView, cancelled }: RequestContext,
    code: string
): Promise<string> => {
    if (cancelled()) return '';
    if (!browserView) throw new Error(ERROR_NO_BROWSER_VIEW);
    // The BrowserView shares Steam's CEF profile: only ever point it at the guide sites.
    if (!isAllowedScrapeUrl(url)) {
        throw new Error(`Refusing to load off-origin URL ${url}`);
    }
    const tabUrl = toCefTabUrl(url);
    // Our view is the (single) tab parked on the blank page. Remembering its
    // id lets a same-site redirect (wiki title renamed, apostrophes dropped)
    // still be found once the exact URL match fails.
    const parked = (await getDebuggerTabs()).filter((t) => isParkedUrl(t.url));
    const ownId = parked.length === 1 ? parked[0]?.id : undefined;
    let result = '';
    browserView.LoadURL(url);
    try {
        for (let i = 0; i < MAX_POLLING && !cancelled(); i++) {
            const tabs = await getDebuggerTabs();
            const tab =
                tabs.find((t) => t.url === tabUrl) ??
                (ownId
                    ? tabs.find(
                          (t) =>
                              t.id === ownId &&
                              !isParkedUrl(t.url) &&
                              isAllowedScrapeUrl(t.url)
                      )
                    : undefined);
            if (tab?.title) result = await runInTab(tab.title, code);
            if (result) break;
            await delay(100);
        }
    } finally {
        browserView.LoadURL(BLANK_PAGE);
    }
    if (!result && !cancelled()) {
        console.warn(`[DeckFAQs] no content retrieved for ${url}`);
        throw new Error(unreachableError(sourceOf(url)));
    }
    return result;
};

// ---------------------------------------------------------------------------
// Guide page cache + prefetch. Loading a page in the hidden view takes
// seconds (real page, ads and all), so pages already seen are kept in a small
// LRU and the next page of a walkthrough is fetched ahead while the current
// one is being read. Keys are the requested URL without its fragment.
// ---------------------------------------------------------------------------

type CacheEntry = { page: GuidePage; bytes: number; ts: number };
const CACHE_MAX_ENTRIES = 8;
const CACHE_MAX_BYTES = 6 * 1024 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1000;
const guideCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<GuidePage>>();
let cacheBytes = 0;
/** The one prefetch that may be running (or queued) at a time. */
let prefetch: { key: string; cancelled: boolean } | undefined;

/** Cache identity of a page load: the URL minus its fragment. */
const cacheKey = (url: string): string => {
    try {
        const u = new URL(url);
        u.hash = '';
        return u.href;
    } catch {
        return url;
    }
};

/** Forget every cached page (Reload, tests). */
export const resetGuideCache = (): void => {
    guideCache.clear();
    cacheBytes = 0;
};

const cacheGet = (key: string): GuidePage | undefined => {
    const entry = guideCache.get(key);
    if (!entry) return undefined;
    guideCache.delete(key);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        cacheBytes -= entry.bytes;
        return undefined;
    }
    guideCache.set(key, entry); // most recently used last
    return entry.page;
};

const cacheSet = (key: string, page: GuidePage): void => {
    const bytes = page.html.length;
    if (bytes > CACHE_MAX_BYTES) return;
    const old = guideCache.get(key);
    if (old) {
        guideCache.delete(key);
        cacheBytes -= old.bytes;
    }
    guideCache.set(key, { page, bytes, ts: Date.now() });
    cacheBytes += bytes;
    while (
        guideCache.size > CACHE_MAX_ENTRIES ||
        cacheBytes > CACHE_MAX_BYTES
    ) {
        const oldest = guideCache.entries().next().value;
        if (!oldest) break;
        guideCache.delete(oldest[0]);
        cacheBytes -= oldest[1].bytes;
    }
};

/** Stop the running/queued prefetch (it releases the view at its next poll). */
export const cancelPrefetch = (): void => {
    if (prefetch) prefetch.cancelled = true;
    prefetch = undefined;
};

/** Delay before a shown page's next page is prefetched (overridable for tests). */
export const prefetchDelayMs = (): number =>
    (globalThis as { __deckfaqsPrefetchDelayMs?: number })
        .__deckfaqsPrefetchDelayMs ?? 1500;

const scrapeUrl = (
    url: string,
    ctx: RequestContext,
    code: string,
    isPrefetch = false
): Promise<string> => {
    // A user's load reclaims the view from a prefetch of another page.
    if (!isPrefetch && prefetch && prefetch.key !== cacheKey(url)) {
        cancelPrefetch();
    }
    const run = scrapeQueue.then(() => doScrape(url, ctx, code));
    scrapeQueue = run.catch(() => undefined);
    return run;
};

/** Raw string result of running `code` in the loaded page. */
export const getContent = (
    url: string,
    ctx: RequestContext,
    code: string
): Promise<string> => scrapeUrl(url, ctx, code);

export type GuidePage = { html: string; toc: TableOfContentEntry[] };

// Loads and sanitises one page; '' html when the request was cancelled.
const loadGuidePage = async (
    url: string,
    ctx: RequestContext,
    isPrefetch = false
): Promise<GuidePage> => {
    const code = sourceOf(url) === 'neoseeker' ? neoGuideCode : getGuideCode;
    const raw = await scrapeUrl(url, ctx, code, isPrefetch);
    if (!raw) return { html: '', toc: [] };
    let body: { guide?: string; toc?: unknown; notFound?: boolean };
    try {
        body = JSON.parse(raw) as typeof body;
    } catch (e) {
        console.error('[DeckFAQs] failed to parse guide payload', e);
        throw new Error(badPayloadError(sourceOf(url)), { cause: e });
    }
    if (body.notFound) throw new Error(notFoundError(sourceOf(url)));
    return {
        html: sanitizeGuideHtml(body.guide ?? ''),
        toc: Array.isArray(body.toc) ? (body.toc as TableOfContentEntry[]) : [],
    };
};

/**
 * Sanitised guide HTML plus its table of contents — from the cache, a
 * running prefetch of the same page, or a fresh load. `fresh` (Reload) drops
 * the whole cache first. Cancelled loads resolve to an empty page, which is
 * never cached.
 */
export const getGuideHtml = async (
    url: string,
    ctx: RequestContext,
    { fresh = false }: { fresh?: boolean } = {}
): Promise<GuidePage> => {
    // Map images are plain files: nothing to load in the view.
    if (isNeoImageUrl(url)) return neoImagePage(url);
    const key = cacheKey(url);
    if (fresh) {
        resetGuideCache();
    } else {
        const cached = cacheGet(key);
        if (cached) return cached;
        const running = inflight.get(key);
        if (running) {
            const joined = await running;
            // An empty result means that prefetch was cancelled: load for real.
            if (joined.html) return joined;
        }
    }
    const page = await loadGuidePage(url, ctx);
    if (page.html) cacheSet(key, page);
    return page;
};

/**
 * Loads `url` in the background so a later getGuideHtml is instant. Only one
 * prefetch runs at a time; a user's load of another page cancels it, and a
 * page that got cached meanwhile is skipped. Errors are swallowed.
 */
export const prefetchGuidePage = (
    url: string,
    browserView: BrowserView | undefined
): void => {
    if (!browserView || isNeoImageUrl(url) || !isAllowedScrapeUrl(url)) return;
    const key = cacheKey(url);
    if (guideCache.has(key) || inflight.has(key)) return;
    cancelPrefetch();
    const token = { key, cancelled: false };
    prefetch = token;
    const ctx: RequestContext = {
        browserView,
        cancelled: () => token.cancelled || guideCache.has(key),
    };
    const run = (async () => {
        try {
            const page = await loadGuidePage(url, ctx, true);
            if (page.html) cacheSet(key, page);
            return page;
        } catch (e) {
            console.warn(`[DeckFAQs] prefetch of ${url} failed`, e);
            return { html: '', toc: [] };
        } finally {
            if (prefetch === token) prefetch = undefined;
            inflight.delete(key);
        }
    })();
    inflight.set(key, run);
};

export type SearchOutcome = {
    results: ListItem[];
    term: string;
    /** Set when one site failed but the other still returned results. */
    notice?: string;
};

// Merges the per-site outcomes: GameFAQs first, then Neoseeker, each under
// its own group when both were asked. A failed site becomes a notice as long
// as the other one had results; otherwise the failure is reported as usual.
const mergeSearchResults = (
    term: string,
    source: GuideSource,
    sides: Array<[Source, PromiseSettledResult<ListItem[]>]>
): SearchOutcome => {
    const results: ListItem[] = [];
    const failures: Error[] = [];
    for (const [site, settled] of sides) {
        if (settled.status === 'fulfilled') {
            for (const item of settled.value) {
                results.push(
                    source === 'both'
                        ? { ...item, group: SOURCE_LABEL[site] }
                        : item
                );
            }
        } else {
            console.error(`[DeckFAQs] ${site} search failed`, settled.reason);
            failures.push(
                settled.reason instanceof Error
                    ? settled.reason
                    : new Error(unreachableError(site))
            );
        }
    }
    const failure = failures[0];
    if (failure && results.length === 0) throw failure;
    return { results, term, notice: failure?.message };
};

/** Searches the selected site(s) for a game name and shows the results step. */
export const gameSearch = (
    game: string,
    browserView: BrowserView | undefined,
    dispatch: Dispatch<AppActions>,
    source: GuideSource = 'both'
) => {
    const searchUrl = gamefaqsSearchUrl(game);
    const none = (): Promise<ListItem[]> => Promise.resolve([]);
    request(
        { browserView, dispatch },
        async (ctx) => {
            dispatch({
                type: ActionType.UPDATE_PLUGIN_STATE,
                payload: { pluginState: 'results', isLoading: true },
            });
            const [gamefaqs, neoseeker] = await Promise.allSettled([
                source === 'neoseeker'
                    ? none()
                    : getContent(searchUrl, ctx, getGamesCode).then(
                          parseSearchResults
                      ),
                source === 'gamefaqs' ? none() : neoGameSearch(game, ctx),
            ]);
            return mergeSearchResults(game, source, [
                ['gamefaqs', gamefaqs],
                ['neoseeker', neoseeker],
            ]);
        },
        (outcome) => {
            dispatch({ type: ActionType.UPDATE_RESULTS, payload: outcome });
        }
    );
};
