import { fetchNoCors } from '@decky/api';
import type { ListItem } from '../components/List/List';
import { NEOSEEKER_CDN_ORIGIN, NEOSEEKER_ORIGIN } from '../constants';
import { sanitizeGuideHtml } from '../sanitize';
import type { GuidePage, RequestContext } from '../utils';
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
 * Diacritics are folded and hyphens count as word breaks: the index knows
 * "god war ragnarok" and "marvels spider man", not "ragnark"/"spiderman".
 */
export const qsCandidates = (name: string): string[] => {
    const out: string[] = [];
    const push = (candidate: string, derived = false) => {
        const kw = qsEscape(
            candidate
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[-–—]/g, ' ')
        );
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
// Games without user-submitted FAQs have no /faqs/ page at all (404) even
// when they have a wiki walkthrough: that counts as an empty list.
// ---------------------------------------------------------------------------
export const neoGuidesCode = `function get_neo_guides() {
    if (/^Neoseeker - Error 404/.test(document.title)) return '[]';
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

// ---------------------------------------------------------------------------
// Guide pages. One script for both kinds (detected in the DOM): wiki
// walkthrough pages (`#wiki-content .mw-parser-output` + sidebar TOC +
// prev/next) and user-submitted FAQs (`#markupfaq`, GameFAQs-style markup).
// Both are normalised into `<div id="faqwrap" class="ffaq neo-…">` so the
// renderer (mark.js root, scroll target, .ffaq CSS) needs no site branches.
// Links that would leave the guide are unwrapped to plain text; same-guide
// wiki links stay absolute. Contract: undefined until the footer exists,
// else JSON {guide, toc}, or {notFound: true} for the site's 404 page.
// ---------------------------------------------------------------------------
export const neoGuideCode = `function get_neo_guide() {
    if (/^Neoseeker - Error 404/.test(document.title)) return JSON.stringify({ notFound: true });
    if (!document.getElementById('footer')) return undefined;
    const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const esc = (s) =>
        clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const canonical = document.querySelector('link[rel="canonical"]');
    const pageUrl = (canonical && canonical.getAttribute('href')) || location.href;
    const slug = new URL(pageUrl, location.href).pathname.split('/').filter(Boolean)[0] || '';
    const SKIP = /^(faqs|cheats|screenshots|boxshots|fanart|reviews|forums|members|news|videos|index\\.php)$/;
    const strip = (root) => {
        for (const el of Array.from(root.querySelectorAll('script, style, iframe, form, input, button, select, textarea, .mw-editsection, .noprint'))) el.remove();
    };
    // Same-guide page link? (same slug, not a file/special page or a site section)
    const isPageLink = (a, u) => {
        const seg = u.pathname.split('/').filter(Boolean);
        if (u.hostname !== 'www.neoseeker.com' || seg[0] !== slug || seg.length < 2) return false;
        if (a.classList.contains('image') || a.classList.contains('new')) return false;
        if (SKIP.test(seg[1]) || /^(File|Special|Category|Template|Talk):/i.test(decodeURIComponent(seg[1]))) return false;
        return true;
    };
    const cleanLinks = (root, keepPages) => {
        for (const a of Array.from(root.querySelectorAll('a[href]'))) {
            const href = a.getAttribute('href') || '';
            let keep = href.charAt(0) === '#';
            if (!keep && keepPages && href) {
                try {
                    const u = new URL(href, pageUrl);
                    if (u.protocol === 'http:') u.protocol = 'https:';
                    if (isPageLink(a, u)) {
                        keep = true;
                        a.setAttribute('href', u.href);
                    }
                } catch (e) {
                    keep = false;
                }
            }
            if (!keep) a.replaceWith(...a.childNodes);
        }
    };

    const article = document.querySelector('#wiki-content .mw-parser-output');
    if (article) {
        const titleEl = document.querySelector('#page-title h1');
        const body = article.cloneNode(true);
        strip(body);
        cleanLinks(body, true);
        let nav = '';
        for (const a of Array.from(document.querySelectorAll('#nav_prev_next a[href]'))) {
            const next = !!a.querySelector('.next');
            const labelEl = a.querySelector('.smaller-xs');
            const label = esc(labelEl ? labelEl.textContent : a.textContent);
            nav += '<a href="' + esc(a.href) + '" class="' + (next ? 'neo-next' : 'neo-prev') + '">' +
                (next ? 'Next: ' + label + ' \\u00bb' : '\\u00ab ' + label) + '</a>';
        }
        const guide = '<div id="faqwrap" class="ffaq neo-wiki">' +
            (titleEl ? '<h1>' + esc(titleEl.textContent) + '</h1>' : '') +
            body.innerHTML +
            (nav ? '<div class="neo-nav">' + nav + '</div>' : '') +
            '</div>';
        // Sidebar TOC -> dropdown entries: heading groups, accordion sub-groups.
        // The li's own link (a real page or a red link to a missing page), as
        // opposed to the accordion toggles (#toc…).
        const ownLink = (li) => Array.from(li.children).find((c) => c.tagName === 'A' && (c.getAttribute('href') || '').charAt(0) !== '#');
        // Page links only: no red links to missing pages.
        const linkOf = (li) => {
            const a = ownLink(li);
            return a && !a.classList.contains('new') ? a : undefined;
        };
        const entryOf = (li) => {
            const nested = Array.from(li.children).find((c) => c.tagName === 'UL');
            const page = linkOf(li);
            if (nested) {
                // Label: the group's own link (even a red one), else the toggle that carries text.
                const toggles = Array.from(li.children).filter((c) => c.tagName === 'A' && c.classList.contains('accordion-toggle') && clean(c.textContent));
                const labelEl = ownLink(li) || toggles[toggles.length - 1] || li;
                const label = clean(labelEl.textContent);
                const options = page ? [{ data: page.href, label }] : [];
                for (const child of Array.from(nested.children)) {
                    if (child.tagName !== 'LI') continue;
                    const entry = entryOf(child);
                    if (entry) options.push(entry);
                }
                return options.length ? { label, options } : null;
            }
            return page ? { data: page.href, label: clean(page.textContent) } : null;
        };
        const toc = [];
        const home = document.querySelector('#wiki-navigation a[title="Home"]');
        if (home) toc.push({ data: home.href, label: 'Guide Home' });
        // A heading opens a group that continues through following <ul>s
        // until the next heading (the sidebar splits long groups this way).
        let group = null;
        for (const ul of Array.from(document.querySelectorAll('#wiki-navigation .wiki-toc > ul'))) {
            for (const li of Array.from(ul.children)) {
                if (li.tagName !== 'LI') continue;
                if (li.classList.contains('heading')) {
                    group = { label: clean(li.textContent), options: [] };
                    toc.push(group);
                    continue;
                }
                const entry = entryOf(li);
                if (entry) (group ? group.options : toc).push(entry);
            }
        }
        return JSON.stringify({ guide, toc: toc.filter((e) => !e.options || e.options.length) });
    }

    const markup = document.getElementById('markupfaq');
    const faqtxt = markup && markup.querySelector('#faqtxt');
    if (faqtxt) {
        const h1 = markup.querySelector('h1');
        const author = markup.querySelector('.author_area');
        const copyright = markup.querySelector('.copyright');
        const body = faqtxt.cloneNode(true);
        strip(body);
        cleanLinks(body, false);
        const textOnly = faqtxt.classList.contains('text_only');
        let guide = '<div id="faqwrap" class="ffaq neo-faq' + (textOnly ? ' neo-faq-text' : '') + '">';
        if (h1) guide += '<h1>' + esc(h1.textContent) + '</h1>';
        if (author) guide += '<div class="author_area">' + esc(author.textContent) + '</div>';
        guide += textOnly ? '<div class="faqtext">' + body.innerHTML + '</div>' : body.innerHTML;
        if (copyright) guide += '<div class="copyright">' + esc(copyright.textContent) + '</div>';
        guide += '</div>';
        const parseOl = (ol) => {
            const out = [];
            for (const li of Array.from(ol.children)) {
                if (li.tagName !== 'LI') continue;
                const a = Array.from(li.children).find((c) => c.tagName === 'A');
                const sub = Array.from(li.children).find((c) => c.tagName === 'OL');
                if (!a) continue;
                const item = { data: a.getAttribute('href') || '', label: clean(a.textContent) };
                if (sub) out.push({ label: item.label, options: [item].concat(parseOl(sub)) });
                else out.push(item);
            }
            return out;
        };
        const tocOl = markup.querySelector('.toc ol');
        return JSON.stringify({ guide, toc: tocOl ? parseOl(tocOl) : [] });
    }
    return undefined;
}
get_neo_guide()`;

/** A map/image guide needs no page load: a single <img> pointing at the file. */
export const neoImagePage = (url: string): GuidePage => ({
    html: sanitizeGuideHtml(
        `<div id="faqwrap" class="ffaq neo-image"><img src="${url.replace(/"/g, '%22')}" alt=""></div>`
    ),
    toc: [],
});
