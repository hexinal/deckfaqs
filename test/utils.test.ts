import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppActions } from '../src/reducers/AppReducer';
import { ActionType } from '../src/reducers/AppReducer';
import type { BrowserView } from '../src/context/AppContext';
import {
    ERROR_NO_BROWSER_VIEW,
    cancelPendingRequests,
    gameSearch,
    getGuideHtml,
    request,
    retryLastRequest,
    toCefTabUrl,
} from '../src/utils';
import { parseGuideList, parseSearchResults } from '../src/sources/gamefaqs';
import {
    badPayloadError,
    isAllowedScrapeUrl,
    notFoundError,
} from '../src/sources/source';

const ERROR_BAD_PAYLOAD = badPayloadError('gamefaqs');

describe('isAllowedScrapeUrl', () => {
    it('accepts only the guide sites', () => {
        expect(
            isAllowedScrapeUrl('https://gamefaqs.gamespot.com/ps2/x/faqs')
        ).toBe(true);
        expect(
            isAllowedScrapeUrl(
                'https://www.neoseeker.com/dragon-quest-xi/faqs/'
            )
        ).toBe(true);
        expect(
            isAllowedScrapeUrl('https://gamefaqs.gamespot.com.evil.com/')
        ).toBe(false);
        expect(isAllowedScrapeUrl('http://gamefaqs.gamespot.com/')).toBe(false);
        // Neoseeker's CDN and image hosts are fetched/embedded directly, never loaded in the view.
        expect(isAllowedScrapeUrl('https://cdn.staticneo.com/x.json')).toBe(
            false
        );
        expect(isAllowedScrapeUrl('not a url')).toBe(false);
    });
});

describe('toCefTabUrl', () => {
    it('encodes like CEF reports it', () => {
        expect(toCefTabUrl("https://g/a b/it's")).toBe(
            'https://g/a%20b/it%27s'
        );
    });
    it('does not double-encode', () => {
        expect(toCefTabUrl('https://g/a%20b')).toBe('https://g/a%20b');
    });
});

describe('parseSearchResults', () => {
    it('maps GameFAQs search hits to list items', () => {
        const raw = JSON.stringify([
            {
                product_name: 'Final Fantasy X',
                url: '/ps2/197344-final-fantasy-x',
            },
            { product_name: '', url: '/nope' },
            { url: '/no-name' },
        ]);
        expect(parseSearchResults(raw)).toEqual([
            {
                text: 'Final Fantasy X',
                url: 'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x',
            },
        ]);
    });
    it('treats empty / non-array payloads as no results', () => {
        expect(parseSearchResults('')).toEqual([]);
        expect(parseSearchResults('{"a":1}')).toEqual([]);
    });
    it('throws on garbage', () => {
        expect(() => parseSearchResults('<html>')).toThrow(ERROR_BAD_PAYLOAD);
    });
});

describe('parseGuideList', () => {
    it('absolutises hrefs and joins the visible parts', () => {
        const raw = JSON.stringify([
            {
                href: '/ps2/1-x/faqs/69037',
                title: 'FAQ/Walkthrough',
                version: 'v.1.10',
                date: '05/06/2014',
            },
            {
                href: '/ps2/1-x/faqs/1',
                title: 'Guide',
                version: '',
                date: '2002',
            },
            { href: '', title: 'broken' },
        ]);
        expect(parseGuideList(raw)).toEqual([
            {
                text: 'FAQ/Walkthrough - v.1.10 - 05/06/2014',
                url: 'https://gamefaqs.gamespot.com/ps2/1-x/faqs/69037',
            },
            {
                text: 'Guide - 2002',
                url: 'https://gamefaqs.gamespot.com/ps2/1-x/faqs/1',
            },
        ]);
    });
    it('throws on garbage', () => {
        expect(() => parseGuideList('<html>')).toThrow(ERROR_BAD_PAYLOAD);
    });
});

describe('request', () => {
    const dispatched: AppActions[] = [];
    const dispatch = (a: AppActions) => {
        dispatched.push(a);
    };
    beforeEach(() => {
        dispatched.length = 0;
        cancelPendingRequests();
    });

    it('delivers the result of the latest request only', async () => {
        const first: string[] = [];
        let resolveFirst!: (v: string) => void;
        request(
            { dispatch },
            () => new Promise<string>((r) => (resolveFirst = r)),
            (r) => first.push(r)
        );
        const second: string[] = [];
        request(
            { dispatch },
            () => Promise.resolve('two'),
            (r) => second.push(r)
        );
        resolveFirst('one');
        await Promise.resolve();
        await Promise.resolve();
        expect(first).toEqual([]);
        expect(second).toEqual(['two']);
    });

    it('drops results after cancelPendingRequests (Back)', async () => {
        const got: string[] = [];
        let resolve!: (v: string) => void;
        request(
            { dispatch },
            () => new Promise<string>((r) => (resolve = r)),
            (r) => got.push(r)
        );
        cancelPendingRequests();
        resolve('late');
        await Promise.resolve();
        await Promise.resolve();
        expect(got).toEqual([]);
        expect(dispatched).toEqual([]);
    });

    it('turns failures into UPDATE_ERROR and can retry', async () => {
        let attempts = 0;
        request(
            { dispatch },
            () => {
                attempts++;
                return attempts === 1
                    ? Promise.reject(new Error('offline'))
                    : Promise.resolve('ok');
            },
            () => dispatch({ type: ActionType.UPDATE_LOADING, payload: false })
        );
        await vi.waitFor(() => expect(dispatched).toHaveLength(1));
        expect(dispatched[0]).toEqual({
            type: ActionType.UPDATE_ERROR,
            payload: 'offline',
        });
        retryLastRequest();
        await vi.waitFor(() => expect(dispatched).toHaveLength(2));
        expect(dispatched[1]).toEqual({
            type: ActionType.UPDATE_LOADING,
            payload: false,
        });
        expect(attempts).toBe(2);
    });

    it('also catches errors thrown by onResult (e.g. payload parsing)', async () => {
        request(
            { dispatch },
            () => Promise.resolve('<html>'),
            (raw) => parseSearchResults(raw)
        );
        await vi.waitFor(() => expect(dispatched).toHaveLength(1));
        expect(dispatched[0]).toMatchObject({
            type: ActionType.UPDATE_ERROR,
            payload: ERROR_BAD_PAYLOAD,
        });
    });
});

describe('getGuideHtml', () => {
    it('reports a missing BrowserView instead of hanging', async () => {
        await expect(
            getGuideHtml('https://gamefaqs.gamespot.com/x/faqs/1', {
                browserView: undefined,
                cancelled: () => false,
            })
        ).rejects.toThrow(ERROR_NO_BROWSER_VIEW);
    });
    it('refuses off-origin URLs', async () => {
        const loadUrl = vi.fn();
        const browserView = { LoadURL: loadUrl } as unknown as BrowserView;
        await expect(
            getGuideHtml('https://example.com/', {
                browserView,
                cancelled: () => false,
            })
        ).rejects.toThrow(/off-origin/);
        expect(loadUrl).not.toHaveBeenCalled();
    });
    it('sanitises the guide and passes the TOC through', async () => {
        const { fetchNoCors, executeInTab } = await import('@decky/api');
        const url = 'https://gamefaqs.gamespot.com/ps2/1-x/faqs/1';
        vi.mocked(fetchNoCors).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{ url, title: 'Guide' }]),
        } as Response);
        vi.mocked(executeInTab).mockResolvedValue({
            success: true,
            result: JSON.stringify({
                guide: '<div id="faqwrap"><p onclick="x()">hi</p><script>bad()</script></div>',
                toc: [{ data: '#s1', label: 'Intro' }],
            }),
        });
        const loadUrl = vi.fn();
        const browserView = { LoadURL: loadUrl } as unknown as BrowserView;
        const page = await getGuideHtml(url, {
            browserView,
            cancelled: () => false,
        });
        expect(page.html).toBe('<div id="faqwrap"><p>hi</p></div>');
        expect(page.toc).toEqual([{ data: '#s1', label: 'Intro' }]);
        // Loaded the guide, then parked the view on a blank page.
        expect(loadUrl.mock.calls[0]?.[0]).toBe(url);
        expect(loadUrl).toHaveBeenCalledTimes(2);
    });
    it('keeps guides to plain HTML: no media, forms, styles or svg', async () => {
        const { fetchNoCors, executeInTab } = await import('@decky/api');
        const url = 'https://gamefaqs.gamespot.com/ps2/1-x/faqs/2';
        vi.mocked(fetchNoCors).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{ url, title: 'Guide' }]),
        } as Response);
        vi.mocked(executeInTab).mockResolvedValue({
            success: true,
            result: JSON.stringify({
                guide:
                    '<div id="faqwrap"><img src="/a.png" srcset="//evil.example/b.png 2x" sizes="1px">' +
                    '<picture><source srcset="//evil.example/c.png"><img src="/d.png"></picture>' +
                    '<video src="//evil.example/v.mp4" poster="//evil.example/p.png"></video>' +
                    '<table background="//evil.example/t.png"><tr><td>x</td></tr></table>' +
                    '<style>body{display:none}</style><svg><image href="//evil.example/s.png"/></svg>' +
                    '<form action="https://evil.example"><input type="image" src="//evil.example/i.png"><button>go</button></form>' +
                    '<p>text</p></div>',
                toc: [],
            }),
        });
        const browserView = { LoadURL: vi.fn() } as unknown as BrowserView;
        const page = await getGuideHtml(url, {
            browserView,
            cancelled: () => false,
        });
        expect(page.html).not.toMatch(/evil\.example/);
        expect(page.html).not.toMatch(
            /<(video|source|picture|style|svg|form|input|button)/
        );
        expect(page.html).toContain('<img src="/a.png">');
        expect(page.html).toContain('<img src="/d.png">');
        expect(page.html).toContain('<td>x</td>');
        expect(page.html).toContain('<p>text</p>');
    });
    it('runs the Neoseeker extractor for Neoseeker pages', async () => {
        const { fetchNoCors, executeInTab } = await import('@decky/api');
        const url = 'https://www.neoseeker.com/dragon-quest-xi/walkthrough';
        vi.mocked(fetchNoCors).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{ url, title: 'Guide' }]),
        } as Response);
        vi.mocked(executeInTab).mockResolvedValue({
            success: true,
            result: JSON.stringify({
                guide: '<div id="faqwrap"></div>',
                toc: [
                    {
                        label: 'A',
                        options: [
                            { data: 'a', label: 'a' },
                            {
                                label: 'B',
                                options: [{ data: 'b', label: 'b' }],
                            },
                        ],
                    },
                ],
            }),
        });
        const browserView = { LoadURL: vi.fn() } as unknown as BrowserView;
        const page = await getGuideHtml(url, {
            browserView,
            cancelled: () => false,
        });
        const code = vi.mocked(executeInTab).mock.lastCall?.[2] ?? '';
        expect(code).toContain('get_neo_guide');
        // Nested groups are flattened for Steam's one-level Dropdown.
        expect(page.toc).toEqual([
            { label: 'A', options: [{ data: 'a', label: 'a' }] },
            { label: 'A › B', options: [{ data: 'b', label: 'b' }] },
        ]);
    });
    it('reports a missing Neoseeker page as such', async () => {
        const { fetchNoCors, executeInTab } = await import('@decky/api');
        const url = 'https://www.neoseeker.com/elden-ring/Gone';
        vi.mocked(fetchNoCors).mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve([{ url, title: 'Neoseeker - Error 404' }]),
        } as Response);
        vi.mocked(executeInTab).mockResolvedValue({
            success: true,
            result: JSON.stringify({ notFound: true }),
        });
        const browserView = { LoadURL: vi.fn() } as unknown as BrowserView;
        await expect(
            getGuideHtml(url, { browserView, cancelled: () => false })
        ).rejects.toThrow(notFoundError('neoseeker'));
    });
    it('renders Neoseeker map images without loading anything', async () => {
        const loadUrl = vi.fn();
        const browserView = { LoadURL: loadUrl } as unknown as BrowserView;
        const page = await getGuideHtml(
            'https://faqs.neoseeker.com/Games/Switch/map_2d_01.jpg',
            { browserView, cancelled: () => false }
        );
        expect(page).toEqual({
            html: '<div id="faqwrap" class="ffaq neo-image"><img src="https://faqs.neoseeker.com/Games/Switch/map_2d_01.jpg" alt=""></div>',
            toc: [],
        });
        expect(loadUrl).not.toHaveBeenCalled();
    });
});

describe('gameSearch', () => {
    const dispatched: AppActions[] = [];
    const dispatch = (a: AppActions) => {
        dispatched.push(a);
    };
    const loadUrl = vi.fn();
    const browserView = { LoadURL: loadUrl } as unknown as BrowserView;
    const gfPayload = JSON.stringify([
        { product_name: 'Hades', url: '/pc/256355-hades' },
    ]);
    const neoPayload =
        'qs({"products":[{"name":"Hades","url":"//www.neoseeker.com/hades-2020/walkthrough"}]});';
    let gfDown = false;
    let cdnDown = false;
    const cdnRequests: string[] = [];

    beforeEach(async () => {
        const { fetchNoCors, executeInTab } = await import('@decky/api');
        dispatched.length = 0;
        cdnRequests.length = 0;
        gfDown = false;
        cdnDown = false;
        loadUrl.mockReset();
        vi.mocked(fetchNoCors).mockReset();
        vi.mocked(fetchNoCors).mockImplementation((input) => {
            const url = String(input);
            if (url.startsWith('http://localhost:8080/json')) {
                const current = String(loadUrl.mock.lastCall?.[0] ?? '');
                const tabs = gfDown ? [] : [{ url: current, title: 'tab' }];
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(tabs),
                } as Response);
            }
            cdnRequests.push(url);
            if (cdnDown) return Promise.reject(new Error('offline'));
            return Promise.resolve({
                ok: true,
                status: 200,
                text: () => Promise.resolve(neoPayload),
            } as Response);
        });
        vi.mocked(executeInTab).mockResolvedValue({
            success: true,
            result: gfPayload,
        });
    });

    const results = () =>
        vi.waitFor(() => {
            const last = dispatched[dispatched.length - 1];
            expect(last?.type).not.toBe(ActionType.UPDATE_PLUGIN_STATE);
            return last!;
        });

    it('merges both sites, GameFAQs first, each under its group', async () => {
        gameSearch('Hades', browserView, dispatch, 'both');
        expect(dispatched[0]).toEqual({
            type: ActionType.UPDATE_PLUGIN_STATE,
            payload: { pluginState: 'results', isLoading: true },
        });
        expect(await results()).toEqual({
            type: ActionType.UPDATE_RESULTS,
            payload: {
                term: 'Hades',
                notice: undefined,
                results: [
                    {
                        text: 'Hades',
                        url: 'https://gamefaqs.gamespot.com/pc/256355-hades',
                        group: 'GameFAQs',
                    },
                    {
                        text: 'Hades',
                        url: 'https://www.neoseeker.com/hades-2020/walkthrough',
                        group: 'Neoseeker',
                    },
                ],
            },
        });
    });

    it('queries only the selected site (no groups)', async () => {
        gameSearch('Hades', browserView, dispatch, 'gamefaqs');
        expect(await results()).toMatchObject({
            payload: {
                results: [
                    {
                        text: 'Hades',
                        url: 'https://gamefaqs.gamespot.com/pc/256355-hades',
                    },
                ],
            },
        });
        expect(cdnRequests).toEqual([]);
        dispatched.length = 0;
        loadUrl.mockClear();
        gameSearch('Hades', browserView, dispatch, 'neoseeker');
        expect(await results()).toMatchObject({
            payload: {
                results: [
                    {
                        text: 'Hades',
                        url: 'https://www.neoseeker.com/hades-2020/walkthrough',
                    },
                ],
            },
        });
        expect(loadUrl).not.toHaveBeenCalled();
    });

    it('keeps the other site and adds a notice when one fails', async () => {
        cdnDown = true;
        gameSearch('Hades', browserView, dispatch, 'both');
        expect(await results()).toEqual({
            type: ActionType.UPDATE_RESULTS,
            payload: {
                term: 'Hades',
                notice: "Couldn't load Neoseeker. Check the connection and retry.",
                results: [
                    {
                        text: 'Hades',
                        url: 'https://gamefaqs.gamespot.com/pc/256355-hades',
                        group: 'GameFAQs',
                    },
                ],
            },
        });
    });

    it('reports an error when nothing could be loaded', async () => {
        cdnDown = true;
        const { executeInTab } = await import('@decky/api');
        vi.mocked(executeInTab).mockResolvedValue({
            success: true,
            result: '',
        });
        gfDown = true;
        vi.useFakeTimers();
        try {
            gameSearch('Hades', browserView, dispatch, 'both');
            // The BrowserView side polls MAX_POLLING x 100 ms before giving up.
            await vi.advanceTimersByTimeAsync(11_000);
        } finally {
            vi.useRealTimers();
        }
        expect(dispatched[dispatched.length - 1]).toMatchObject({
            type: ActionType.UPDATE_ERROR,
            payload: /Couldn't load GameFAQs/,
        });
    });
});
