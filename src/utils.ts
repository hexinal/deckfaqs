import { executeInTab, fetchNoCors } from '@decky/api';
import DOMPurify from 'dompurify';
import type { Dispatch } from 'react';
import { SearchResult } from './components/List/GameList';
import { ListItem } from './components/List/List';
import { ActionType, AppActions } from './reducers/AppReducer';

const getGuideCode = `function parseList(list) {
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

type CefTab = { url: string; title: string };

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

// Loads `url` in the hidden BrowserView, waits for its tab to appear, then runs `code` in it.
const scrapeUrl = async (
    url: string,
    browserView: any,
    code: string
): Promise<string> => {
    let result = '';
    // CEF reports the loaded URL percent-encoded (including apostrophes);
    // don't re-encode URLs that already contain escapes.
    const alreadyEncoded = /%[0-9a-f]{2}/i.test(url);
    const tabUrl = (alreadyEncoded ? url : encodeURI(url)).replace(/'/g, '%27');
    browserView.LoadURL(url);
    let maxPolling = 0;
    while (maxPolling < MAX_POLLING) {
        maxPolling++;
        const tab = (await getDebuggerTabs()).find((t) => t.url === tabUrl);
        if (tab?.title) result = await runInTab(tab.title, code);
        if (result) break;
        await delay(100);
    }
    if (!result) console.warn(`[DeckFAQs] no content retrieved for ${url}`);
    browserView.LoadURL(BLANK_PAGE);
    return result;
};

export const getContent = async (
    url: string,
    browserView: any,
    code: string,
    handleResult: Function
) => {
    const htmlResult = await scrapeUrl(url, browserView, code);
    handleResult(htmlResult);
};

export const getGuideHtml = async (
    url: string,
    browserView: any,
    handleResult: Function
) => {
    let htmlResult = '';
    let toc = '';
    const raw = await scrapeUrl(url, browserView, getGuideCode);
    if (raw) {
        try {
            const htmlBody = JSON.parse(raw);
            htmlResult = DOMPurify.sanitize(htmlBody.guide ?? '');
            toc = htmlBody.toc;
        } catch (e) {
            console.error('[DeckFAQs] failed to parse guide payload', e);
        }
    }
    handleResult(htmlResult, toc);
};

export const gameSearch = async (
    game: string,
    browserView: any,
    dispatch: Dispatch<AppActions>
) => {
    game = game.trim().replace(/\s+/g, '+');
    const searchUrl = `https://gamefaqs.gamespot.com/ajax/home_game_search?term=${game}`;
    const home = 'https://gamefaqs.gamespot.com';
    dispatch({
        type: ActionType.UPDATE_PLUGIN_STATE,
        payload: { pluginState: 'results', isLoading: true },
    });
    getContent(
        searchUrl,
        browserView,
        // Only report the page once it actually holds the JSON search payload;
        // anything else (still loading, Cloudflare interstitial, ...) keeps
        // the caller polling until MAX_POLLING is reached.
        `function get_games() {
            const text = document.documentElement?.innerText ?? '';
            try {
                JSON.parse(text);
                return text;
            } catch (e) {
                return '';
            }
        }
    get_games()`,
        (result: string) => {
            let searchResults: ListItem[] = [];
            let results: SearchResult[] = [];
            try {
                if (result) results = JSON.parse(result);
            } catch (e) {
                console.error('[DeckFAQs] unexpected search response', e);
            }
            if (Array.isArray(results)) {
                results.forEach((result) => {
                    if (result.product_name) {
                        const url = `${home}${result.url}`;
                        searchResults.push({
                            text: `${result.product_name}`,
                            url: url,
                        });
                    }
                });
            }
            dispatch({
                type: ActionType.UPDATE_RESULTS,
                payload: searchResults,
            });
        }
    );
};
