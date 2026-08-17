import type { ListItem } from '../components/List/List';
import { GAMEFAQS_ORIGIN } from '../constants';
import { badPayloadError } from './source';

// ---------------------------------------------------------------------------
// GameFAQs: in-tab extraction scripts (plain JS strings evaluated inside the
// hidden BrowserView) and the parsers for what they return. Contract shared
// by every script: return undefined/'' while the page has not rendered yet
// (keeps utils.ts polling), a JSON string otherwise.
// ---------------------------------------------------------------------------

const ERROR_BAD_PAYLOAD = badPayloadError('gamefaqs');

/** Builds the GameFAQs quick-search URL for a game name. */
export const gamefaqsSearchUrl = (game: string): string => {
    const term = encodeURIComponent(game.trim()).replace(/%20/g, '+');
    return `${GAMEFAQS_ORIGIN}/ajax/home_game_search?term=${term}`;
};

/** Shape of one hit of GameFAQs' home_game_search JSON. */
type SearchResult = {
    product_name: string | undefined;
    url: string | undefined;
};

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

type GuideEntry = {
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
