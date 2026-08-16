import { executeInTab, fetchNoCors } from '@decky/api';
import DOMPurify from 'dompurify';
import type { Dispatch } from 'react';
import type { SearchResult } from './components/List/GameList';
import type { ListItem } from './components/List/List';
import { GAMEFAQS_ORIGIN } from './constants';
import type { BrowserView, TableOfContentEntry } from './context/AppContext';
import { ActionType, AppActions } from './reducers/AppReducer';

export const getGuideCode = `function parseList(list) {
    let newT = [];
    for (let element of list.children) {
        const tagName = element.tagName;
        switch (tagName) {
            case 'LI':
                const a = element.getElementsByTagName('a')[0];
                if (a)
                    newT.push({
                        data: a.getAttribute('href'),
                        label: a.textContent,
                    });
                break;
            case 'OL':
                let label = element.previousSibling?.textContent;
                let res = parseList(element);
                newT.push({ label, options: res });
                break;
        }
    }

    return newT;
}

function get_guide() {
    let faq = document.getElementById('faqwrap');
    let tocObjc = [];
    if (faq) {
        let toc = faq.getElementsByClassName('ftoc');
        if (toc.length > 0) {
            let mainList = toc[0].getElementsByTagName('ol');
            if (mainList.length > 0) {
                tocObjc = parseList(mainList[0]);
            }
        }
        return JSON.stringify({ guide: faq.outerHTML, toc: tocObjc });
    }
    return undefined;
}
get_guide();
`;

async function delay(ms: number, state = null) {
    return new Promise((resolve, _reject) => {
        window.setTimeout(() => resolve(state), ms);
    });
}

const MAX_POLLING = 100;
const CEF_TABS_URL = 'http://localhost:8080/json';
const BLANK_PAGE = 'data:text/html,<body><%2Fbody>';

export const ERROR_NO_BROWSER_VIEW =
    "Steam's browser view is unavailable. Restart Steam and try again.";
export const ERROR_UNREACHABLE =
    "Couldn't load GameFAQs. Check the connection and retry.";
export const ERROR_BAD_PAYLOAD =
    'GameFAQs returned something unexpected. Retry, or update DeckFAQs if it keeps happening.';

type CefTab = { url: string; title: string };

export const isGameFaqsUrl = (url: string): boolean => {
    try {
        return new URL(url).origin === GAMEFAQS_ORIGIN;
    } catch {
        return false;
    }
};

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
    // The BrowserView shares Steam's CEF profile: only ever point it at GameFAQs.
    if (!isGameFaqsUrl(url)) {
        throw new Error(`Refusing to load off-origin URL ${url}`);
    }
    const tabUrl = toCefTabUrl(url);
    let result = '';
    browserView.LoadURL(url);
    try {
        for (let i = 0; i < MAX_POLLING && !cancelled(); i++) {
            const tab = (await getDebuggerTabs()).find((t) => t.url === tabUrl);
            if (tab?.title) result = await runInTab(tab.title, code);
            if (result) break;
            await delay(100);
        }
    } finally {
        browserView.LoadURL(BLANK_PAGE);
    }
    if (!result && !cancelled()) {
        console.warn(`[DeckFAQs] no content retrieved for ${url}`);
        throw new Error(ERROR_UNREACHABLE);
    }
    return result;
};

const scrapeUrl = (
    url: string,
    ctx: RequestContext,
    code: string
): Promise<string> => {
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

/** Sanitised guide HTML plus its table of contents. */
export const getGuideHtml = async (
    url: string,
    ctx: RequestContext
): Promise<GuidePage> => {
    const raw = await scrapeUrl(url, ctx, getGuideCode);
    if (!raw) return { html: '', toc: [] };
    try {
        const body = JSON.parse(raw) as { guide?: string; toc?: unknown };
        return {
            html: DOMPurify.sanitize(body.guide ?? ''),
            toc: Array.isArray(body.toc)
                ? (body.toc as TableOfContentEntry[])
                : [],
        };
    } catch (e) {
        console.error('[DeckFAQs] failed to parse guide payload', e);
        throw new Error(ERROR_BAD_PAYLOAD, { cause: e });
    }
};

// Only report the page once it actually holds the JSON search payload;
// anything else (still loading, Cloudflare interstitial, ...) keeps
// the caller polling until MAX_POLLING is reached.
export const getGamesCode = `function get_games() {
    const text = document.body?.textContent ?? '';
    try {
        JSON.parse(text);
        return text;
    } catch (e) {
        return '';
    }
}
get_games()`;

/** Turns the raw GameFAQs search payload into list items. */
export const parseSearchResults = (raw: string): ListItem[] => {
    let results: unknown;
    try {
        results = raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('[DeckFAQs] unexpected search response', e);
        throw new Error(ERROR_BAD_PAYLOAD, { cause: e });
    }
    if (!Array.isArray(results)) return [];
    return (results as SearchResult[]).flatMap((r) =>
        r.product_name && r.url
            ? [{ text: `${r.product_name}`, url: `${GAMEFAQS_ORIGIN}${r.url}` }]
            : []
    );
};

// Runs in the game's /faqs page. Returns undefined while the guide lists have
// not rendered yet (keeps polling), '[]' for games without guides, else a JSON
// array of {href, title, version, date} for every guide entry.
export const getGuidesCode = `function get_guides() {
    const lists = document.querySelectorAll('ol.guides');
    if (lists.length === 0) {
        const text = document.body?.textContent ?? '';
        return text.includes('Want to Write Your Own Guide?') ? '[]' : undefined;
    }
    const out = [];
    for (const li of document.querySelectorAll('ol.guides li')) {
        const a = li.querySelector('a[href*="/faqs/"]');
        if (!a) continue;
        const href = a.getAttribute('href') || '';
        if (!/\\/faqs\\/\\d+/.test(href)) continue;
        const meta = li.querySelector('.meta.float_r');
        const metaText = meta ? (meta.textContent || '').trim() : '';
        const version = metaText.startsWith('v.') ? metaText.split(',')[0].trim() : '';
        const dateEl = li.querySelector('.guide_date');
        const date = dateEl
            ? dateEl.getAttribute('title') || (dateEl.textContent || '').trim()
            : '';
        out.push({ href, title: (a.textContent || '').trim(), version, date });
    }
    return JSON.stringify(out);
}
get_guides()`;

export type GuideEntry = {
    href: string;
    title: string;
    version: string;
    date: string;
};

/** Turns the JSON emitted by getGuidesCode into list items. */
export const parseGuideList = (raw: string): ListItem[] => {
    let entries: unknown;
    try {
        entries = raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('[DeckFAQs] unexpected guide list payload', e);
        throw new Error(ERROR_BAD_PAYLOAD, { cause: e });
    }
    if (!Array.isArray(entries)) return [];
    return (entries as Partial<GuideEntry>[]).flatMap((entry) => {
        if (!entry?.href || !entry.title) return [];
        let url: string;
        try {
            url = new URL(entry.href, GAMEFAQS_ORIGIN).href;
        } catch {
            return [];
        }
        const text = [entry.title, entry.version, entry.date]
            .filter(Boolean)
            .join(' - ');
        return [{ text, url }];
    });
};

export const gameSearch = (
    game: string,
    browserView: BrowserView | undefined,
    dispatch: Dispatch<AppActions>
) => {
    const term = encodeURIComponent(game.trim()).replace(/%20/g, '+');
    const searchUrl = `${GAMEFAQS_ORIGIN}/ajax/home_game_search?term=${term}`;
    request(
        { browserView, dispatch },
        (ctx) => {
            dispatch({
                type: ActionType.UPDATE_PLUGIN_STATE,
                payload: { pluginState: 'results', isLoading: true },
            });
            return getContent(searchUrl, ctx, getGamesCode);
        },
        (raw) => {
            dispatch({
                type: ActionType.UPDATE_RESULTS,
                payload: parseSearchResults(raw),
            });
        }
    );
};
