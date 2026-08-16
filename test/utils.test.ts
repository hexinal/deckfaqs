import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppActions } from '../src/reducers/AppReducer';
import { ActionType } from '../src/reducers/AppReducer';
import type { BrowserView } from '../src/context/AppContext';
import {
    ERROR_BAD_PAYLOAD,
    ERROR_NO_BROWSER_VIEW,
    cancelPendingRequests,
    getGuideHtml,
    isGameFaqsUrl,
    parseGuideList,
    parseSearchResults,
    request,
    retryLastRequest,
    toCefTabUrl,
} from '../src/utils';

describe('isGameFaqsUrl', () => {
    it('accepts only the GameFAQs origin', () => {
        expect(isGameFaqsUrl('https://gamefaqs.gamespot.com/ps2/x/faqs')).toBe(
            true
        );
        expect(isGameFaqsUrl('https://gamefaqs.gamespot.com.evil.com/')).toBe(
            false
        );
        expect(isGameFaqsUrl('http://gamefaqs.gamespot.com/')).toBe(false);
        expect(isGameFaqsUrl('not a url')).toBe(false);
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
});
