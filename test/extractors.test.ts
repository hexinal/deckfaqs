import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    getGuidesCode,
    getGuideCode,
    getGamesCode,
} from '../src/sources/gamefaqs';

// The extraction scripts run inside the GameFAQs tab via executeInTab and
// return the value of their last expression; mimic that with an indirect eval
// against the jsdom document.
const runInPage = (code: string, html: string): unknown => {
    document.open();
    document.write(html);
    document.close();
    return (0, eval)(code);
};

const fixture = (name: string) => readFileSync(`test/fixtures/${name}`, 'utf8');

describe('getGuidesCode (game /faqs page)', () => {
    it('extracts every guide entry from a real page', () => {
        const raw = runInPage(
            getGuidesCode,
            fixture('faqs-final-fantasy-x.html')
        );
        const entries = JSON.parse(raw as string) as Array<
            Record<string, string>
        >;
        expect(entries).toHaveLength(125);
        expect(entries[0]).toEqual({
            href: '/ps2/197344-final-fantasy-x/faqs/69037',
            title: 'FFX FAQ/Walkthrough',
            version: 'v.v1.10',
            date: '05/06/2014',
        });
        // Maps live under /map/ and are not guides.
        expect(entries.every((e) => /\/faqs\/\d+/.test(e.href ?? ''))).toBe(
            true
        );
        // Version-less entries still carry a date.
        const noVersion = entries.find((e) => e.version === '');
        expect(noVersion).toMatchObject({ date: '03/14/2002' });
    });
    it('returns [] for games without guides and undefined while loading', () => {
        expect(
            runInPage(
                getGuidesCode,
                '<html><body><h2>Want to Write Your Own Guide?</h2></body></html>'
            )
        ).toBe('[]');
        expect(
            runInPage(getGuidesCode, '<html><body>Just a moment…</body></html>')
        ).toBeUndefined();
    });
});

describe('getGuideCode (guide page)', () => {
    it('returns the guide HTML and a nested TOC', () => {
        const html = `<html><body><div id="faqwrap">
            <div class="ftoc"><ol>
                <li><a href="#intro">Intro</a></li>
                <li><a href="#walk">Walkthrough</a></li>
                Chapter 1
                <ol>
                    <li><a href="#c1a">Part A</a></li>
                    <li><a href="/ps2/1-x/faqs/2?page=1#c1b">Part B</a></li>
                </ol>
            </ol></div>
            <div class="ffaq"><p>text</p></div>
        </div></body></html>`;
        const raw = runInPage(getGuideCode, html) as string;
        const page = JSON.parse(raw) as { guide: string; toc: unknown };
        expect(page.guide).toContain('<div class="ffaq"><p>text</p></div>');
        expect(page.toc).toEqual([
            { data: '#intro', label: 'Intro' },
            { data: '#walk', label: 'Walkthrough' },
            {
                label: expect.stringContaining('Chapter 1') as string,
                options: [
                    { data: '#c1a', label: 'Part A' },
                    { data: '/ps2/1-x/faqs/2?page=1#c1b', label: 'Part B' },
                ],
            },
        ]);
    });
    it('returns undefined when there is no guide (still loading)', () => {
        expect(
            runInPage(getGuideCode, '<html><body>loading</body></html>')
        ).toBeUndefined();
    });
});

describe('getGamesCode (search endpoint)', () => {
    it('returns the JSON body once present', () => {
        const body = JSON.stringify([{ product_name: 'X', url: '/x' }]);
        expect(
            runInPage(getGamesCode, `<html><body>${body}</body></html>`)
        ).toBe(body);
    });
    it('returns "" while the page is not JSON yet', () => {
        expect(
            runInPage(getGamesCode, '<html><body>Just a moment</body></html>')
        ).toBe('');
    });
});
