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

// ---------------------------------------------------------------------------
// Guide list: runs in a game's /<slug>/faqs/ page. Rows are the wiki
// walkthrough, user-submitted FAQs and map images (thumb URL minus `_thumb`
// is the full-size image); external rows (StrategyWiki) are dropped.
// Contract: undefined while the page (or Cloudflare's check) is still loading
// — the footer is the last element of a real page — else a JSON array of
// {kind, href, title, category, platform, author, date, size, version}.
// ---------------------------------------------------------------------------
export const neoGuidesCode = `function get_neo_guides() {
    if (!document.getElementById('footer')) return undefined;
    const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const out = [];
    for (const table of document.querySelectorAll('table.table-list')) {
      // A secondary table ("Non-English Walkthroughs & FAQs") is introduced by
      // an <h2>; use that as the category instead of its repeated dividers.
      const prev = table.previousElementSibling;
      const section = prev && prev.tagName === 'H2' ? clean(prev.textContent) : '';
      let category = section;
      for (const tr of table.querySelectorAll('tr')) {
        if (tr.classList.contains('table-divider')) {
            if (!section) category = clean(tr.textContent);
            continue;
        }
        const cells = Array.prototype.filter.call(tr.children, (c) => c.tagName === 'TD');
        if (cells.length < 2) continue;
        const first = cells[0];
        let kind = 'faq';
        let href = '';
        let title = '';
        const img = first.querySelector('a.image_faq img');
        if (img) {
            kind = 'image';
            href = (img.getAttribute('src') || '').replace(/_thumb(\\.[a-z0-9]+)$/i, '$1');
            const label = first.querySelector('a:not(.image_faq)');
            title = clean((label && label.textContent) || img.getAttribute('alt'));
        } else {
            const a = first.querySelector('a[href]');
            if (!a) continue;
            let u;
            try {
                u = new URL(a.getAttribute('href') || '', location.href);
            } catch (e) {
                continue;
            }
            if (u.hostname !== 'www.neoseeker.com') continue;
            if (/\\/walkthrough\\/?$/.test(u.pathname)) kind = 'walkthrough';
            else if (!/\\/faqs\\/\\d+/.test(u.pathname)) continue;
            href = u.href;
            title = clean(a.textContent);
        }
        const small = first.querySelector('small');
        const platform = small ? clean(small.textContent).replace(/^\\(|\\)$/g, '') : '';
        const dateNode = cells[1].firstChild;
        const date = clean(dateNode && dateNode.nodeType === 3 ? dateNode.textContent : cells[1].textContent);
        const text = (i) => (cells[i] ? clean(cells[i].textContent) : '');
        out.push({
            kind,
            href,
            title,
            category,
            platform,
            author: text(2),
            date,
            size: text(3),
            version: text(4),
        });
      }
    }
    return JSON.stringify(out);
}
get_neo_guides()`;

type NeoGuideEntry = {
    kind: 'walkthrough' | 'faq' | 'image';
    href: string;
    title: string;
    category: string;
    platform: string;
    author: string;
    date: string;
    size: string;
    version: string;
};

// Map images live on these file hosts; anything there opens as an image guide.
const NEO_FILE_HOSTS = new Set(['faqs.neoseeker.com', 'i.neoseeker.com']);

/** A Neoseeker map/image guide (rendered as a single <img>, nothing to scrape). */
export const isNeoImageUrl = (url: string): boolean => {
    try {
        return NEO_FILE_HOSTS.has(new URL(url).hostname);
    } catch {
        return false;
    }
};

/**
 * Turns the JSON emitted by neoGuidesCode into list items grouped by the
 * page's categories. `gameUrl` is the search hit that led here: when it is
 * the wiki walkthrough itself but the list has no such row, one is added.
 */
export const parseNeoGuideList = (raw: string, gameUrl: string): ListItem[] => {
    let entries: unknown;
    try {
        entries = raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('[DeckFAQs] unexpected Neoseeker guide list payload', e);
        throw new Error(badPayloadError('neoseeker'), { cause: e });
    }
    if (!Array.isArray(entries)) return [];
    const items: ListItem[] = [];
    let hasWalkthrough = false;
    for (const entry of entries as Partial<NeoGuideEntry>[]) {
        if (!entry?.href || !entry.title) continue;
        let url: URL;
        try {
            url = new URL(entry.href);
        } catch {
            continue;
        }
        if (
            url.origin !== NEOSEEKER_ORIGIN &&
            !NEO_FILE_HOSTS.has(url.hostname)
        )
            continue;
        if (entry.kind === 'walkthrough') hasWalkthrough = true;
        const version = entry.version
            ? /^\d/.test(entry.version)
                ? `v${entry.version}`
                : entry.version
            : '';
        const text = [
            entry.title + (entry.platform ? ` (${entry.platform})` : ''),
            version,
            entry.date,
        ]
            .filter(Boolean)
            .join(' - ');
        items.push({ text, url: url.href, group: entry.category || undefined });
    }
    if (!hasWalkthrough && /\/walkthrough\/?$/.test(gameUrl)) {
        items.unshift({ text: 'Walkthrough', url: gameUrl });
    }
    return items;
};
