import type { DropdownOption } from '@decky/ui';
import {
    GAMEFAQS_ORIGIN,
    NEOSEEKER_IMAGE_ORIGINS,
    NEOSEEKER_ORIGIN,
    SCRAPE_ORIGINS,
} from '../constants';

// ---------------------------------------------------------------------------
// Which site a URL belongs to, and the small set of URL rules that differ
// between the two. Everything else (list items, guides, saved positions) is
// keyed by absolute URLs, so the source is always derived, never stored.
// ---------------------------------------------------------------------------

export type Source = 'gamefaqs' | 'neoseeker';
/** The persisted "Guide source" setting: which site(s) a game search queries. */
export type GuideSource = Source | 'both';

const GUIDE_SOURCES: readonly string[] = ['both', 'gamefaqs', 'neoseeker'];
export const isGuideSource = (value: unknown): value is GuideSource =>
    typeof value === 'string' && GUIDE_SOURCES.includes(value);

export const SOURCE_LABEL: Record<Source, string> = {
    gamefaqs: 'GameFAQs',
    neoseeker: 'Neoseeker',
};

const NEOSEEKER_HOSTS = new Set(
    NEOSEEKER_IMAGE_ORIGINS.map((origin) => new URL(origin).hostname)
);

/** Unknown/unparseable URLs count as GameFAQs so legacy paths behave as before. */
export const sourceOf = (url: string): Source => {
    try {
        return NEOSEEKER_HOSTS.has(new URL(url).hostname)
            ? 'neoseeker'
            : 'gamefaqs';
    } catch {
        return 'gamefaqs';
    }
};

/** May the hidden BrowserView load this URL? (It shares Steam's CEF profile.) */
export const isAllowedScrapeUrl = (url: string): boolean => {
    try {
        return SCRAPE_ORIGINS.includes(new URL(url).origin);
    } catch {
        return false;
    }
};

/** Origins a guide from `source` may load <img> from. */
export const imageOrigins = (source: Source): readonly string[] =>
    source === 'neoseeker' ? NEOSEEKER_IMAGE_ORIGINS : [GAMEFAQS_ORIGIN];

/** The page listing a game's guides: GameFAQs `<game>/faqs`, Neoseeker `/<slug>/faqs/` (the slash matters: `/faqs` redirects). */
export const guideListUrl = (gameUrl: string): string => {
    if (sourceOf(gameUrl) === 'gamefaqs') return `${gameUrl}/faqs`;
    const slug = new URL(gameUrl).pathname.split('/').filter(Boolean)[0] ?? '';
    return `${NEOSEEKER_ORIGIN}/${slug}/faqs/`;
};

/**
 * URL to load for `page` of a guide ('' = the guide itself). GameFAQs pages
 * are `?page=N` fragments living under `<guide>/`; Neoseeker pages are ordinary
 * absolute URLs (wiki sub-pages).
 */
export const pageUrl = (guideUrl: string, page = ''): string => {
    if (!page) return guideUrl;
    if (sourceOf(guideUrl) === 'gamefaqs') return `${guideUrl}/${page}`;
    try {
        return new URL(page, guideUrl).href;
    } catch {
        return guideUrl;
    }
};

/**
 * Splits an in-guide link into the page it points at (in `GuideContents.page`
 * form) and its anchor. For Neoseeker a link back to the guide's landing page
 * yields page '' so positions/reload agree on one key.
 */
export const pageOf = (
    guideUrl: string,
    href: string
): { page: string; anchor: string } => {
    const hash = href.indexOf('#');
    const anchor = hash >= 0 ? href.substring(hash + 1) : '';
    let page = hash >= 0 ? href.substring(0, hash) : href;
    if (sourceOf(guideUrl) === 'neoseeker') {
        try {
            const abs = new URL(page, guideUrl);
            abs.hash = '';
            page = abs.href === guideUrl ? '' : abs.href;
        } catch {
            page = '';
        }
    }
    return { page, anchor };
};

/**
 * The TOC entry (its `data`) that stands for the loaded `page`, so the TOC
 * dropdown can follow prev/next navigation. Only whole-page entries (no `#`)
 * are considered — GameFAQs entries always carry an anchor, so nothing
 * changes for them.
 */
export const tocSectionFor = (
    toc: readonly DropdownOption[] | undefined,
    guideUrl: string,
    page: string
): string | undefined => {
    if (!toc) return undefined;
    const target = pageUrl(guideUrl, page);
    const walk = (entries: readonly DropdownOption[]): string | undefined => {
        for (const entry of entries) {
            if (entry.options) {
                const found = walk(entry.options);
                if (found !== undefined) return found;
            } else if (
                typeof entry.data === 'string' &&
                !entry.data.includes('#') &&
                pageUrl(guideUrl, entry.data) === target
            ) {
                return entry.data;
            }
        }
        return undefined;
    };
    return walk(toc);
};

export const unreachableError = (source: Source): string =>
    `Couldn't load ${SOURCE_LABEL[source]}. Check the connection and retry.`;
export const badPayloadError = (source: Source): string =>
    `${SOURCE_LABEL[source]} returned something unexpected. Retry, or update DeckFAQs if it keeps happening.`;
