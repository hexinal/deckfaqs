import { fetchNoCors } from '@decky/api';
import type { ListItem } from '../components/List/List';
import { NEOSEEKER_CDN_ORIGIN, NEOSEEKER_ORIGIN } from '../constants';
import type { RequestContext } from '../utils';
import { badPayloadError, unreachableError } from './source';

// ---------------------------------------------------------------------------
// Neoseeker (www.neoseeker.com). Search goes straight to the site's static
// quick-search JSON on its CDN (fetchNoCors, no cookies, never behind the
// Cloudflare check); everything else loads in the hidden BrowserView.
// ---------------------------------------------------------------------------

const QS_TIMEOUT_MS = 10_000;
const MAX_QS_CANDIDATES = 4;

const delay = (ms: number): Promise<null> =>
    new Promise((resolve) => {
        window.setTimeout(() => resolve(null), ms);
    });

/**
 * Mirror of the site's own `qs_escape` (header quick-search), quirks
 * included: stop words dropped, 25 chars max, spaces to `_`, only the first
 * run of underscores collapsed. '' when the site would not search at all.
 */
export const qsEscape = (name: string): string => {
    let kw = name
        .replace(
            /\b(walkthrough|cheat|faq|p?review|forum|hint|tip|guide|manual|help|of|the|on)s?\b/gi,
            ''
        )
        .trim();
    kw = kw
        .substring(0, 25)
        .toLowerCase()
        .replace(/\s/g, '_')
        .replace(/\W/g, '');
    kw = encodeURIComponent(kw).trim().replace(/_+/, '_').replace(/_$/, '');
    return /^[a-z0-9]/.test(kw) ? kw : '';
};

/**
 * Keywords to try, best first: the name as is, then cut at a subtitle
 * separator, then with trailing words dropped (never down to one word: the
 * index matches word-wise and single words return unrelated games).
 */
export const qsCandidates = (name: string): string[] => {
    const out: string[] = [];
    const push = (candidate: string, derived = false) => {
        const kw = qsEscape(candidate);
        if (!kw || out.includes(kw)) return;
        if (derived && !kw.includes('_')) return;
        out.push(kw);
    };
    const clean = name.replace(/[™®©]/g, ' ');
    push(clean);
    const head = clean.split(/\s[-–—|]\s|[:(/[]/)[0]?.trim() ?? '';
    push(head);
    const words = head.split(/\s+/).filter(Boolean);
    for (let n = words.length - 1; n >= 2; n--) {
        if (out.length >= MAX_QS_CANDIDATES) break;
        push(words.slice(0, n).join(' '), true);
    }
    return out.slice(0, MAX_QS_CANDIDATES);
};

export const qsUrl = (kw: string): string =>
    `${NEOSEEKER_CDN_ORIGIN}/neoassets/data/qs/${kw.charAt(0)}/${kw}.json`;

type QsProduct = { name?: unknown; url?: unknown };

/** Turns the JSONP quick-search body into list items (games only, de-duplicated). */
export const parseQsPayload = (text: string): ListItem[] => {
    const match = /^\s*qs\((.*)\)\s*;?\s*$/s.exec(text);
    // Not the JSONP we expect (e.g. the CDN's HTML 404): no hits.
    if (!match) return [];
    let payload: unknown;
    try {
        payload = JSON.parse(match[1] ?? '');
    } catch (e) {
        console.error('[DeckFAQs] unexpected Neoseeker search payload', e);
        throw new Error(badPayloadError('neoseeker'), { cause: e });
    }
    const products = (payload as { products?: unknown }).products;
    if (!Array.isArray(products)) return [];
    const out: ListItem[] = [];
    const seen = new Set<string>();
    for (const product of products as QsProduct[]) {
        if (
            typeof product?.name !== 'string' ||
            typeof product.url !== 'string'
        )
            continue;
        let url: URL;
        try {
            // URLs are protocol-relative (`//www.neoseeker.com/<slug>/walkthrough`).
            url = new URL(product.url, NEOSEEKER_ORIGIN);
        } catch {
            continue;
        }
        if (url.origin !== NEOSEEKER_ORIGIN || seen.has(url.href)) continue;
        seen.add(url.href);
        out.push({ text: product.name, url: url.href });
    }
    return out;
};

const unreachable = (cause?: unknown) =>
    new Error(unreachableError('neoseeker'), { cause });

/**
 * Searches Neoseeker for a game name, trying shorter keywords until one hits.
 * Resolves [] when nothing matches (or the request was cancelled); throws
 * when the CDN cannot be reached.
 */
export const neoGameSearch = async (
    game: string,
    ctx: RequestContext
): Promise<ListItem[]> => {
    for (const kw of qsCandidates(game)) {
        if (ctx.cancelled()) return [];
        let response: Response | null;
        try {
            response = await Promise.race([
                fetchNoCors(qsUrl(kw)),
                delay(QS_TIMEOUT_MS),
            ]);
        } catch (e) {
            throw unreachable(e);
        }
        if (!response) throw unreachable('timeout');
        // Only over-long keys 404 (as HTML); anything else non-OK is an outage.
        if (response.status === 404) continue;
        if (!response.ok) throw unreachable(response.status);
        let text: string;
        try {
            text = await response.text();
        } catch (e) {
            throw unreachable(e);
        }
        const items = parseQsPayload(text);
        if (items.length > 0) return items;
    }
    return [];
};
