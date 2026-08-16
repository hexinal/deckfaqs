import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    getGuidesCode,
    getGuideCode,
    getGamesCode,
} from '../src/sources/gamefaqs';
import { neoGuidesCode } from '../src/sources/neoseeker';

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

describe('neoGuidesCode (Neoseeker /<slug>/faqs/ page)', () => {
    const run = (name: string) => {
        const raw = runInPage(neoGuidesCode, fixture(`neoseeker/${name}`));
        return JSON.parse(raw as string) as Array<Record<string, string>>;
    };

    it('lists the wiki walkthrough, FAQs and map images with their metadata', () => {
        const entries = run('faqs-dragon-quest-xi.html');
        expect(entries.map((e) => e.kind)).toEqual([
            'walkthrough',
            'faq',
            'faq',
            ...Array<string>(6).fill('image'),
        ]);
        expect(entries[0]).toEqual({
            kind: 'walkthrough',
            href: 'https://www.neoseeker.com/dragon-quest-xi/walkthrough',
            title: 'Walkthrough',
            category: 'General FAQs/Guides',
            platform: 'PS4',
            author: 'MasterJG',
            date: 'Sep 4, 2018',
            size: '',
            version: '',
        });
        expect(entries[1]).toMatchObject({
            kind: 'faq',
            href: 'https://www.neoseeker.com/dragon-quest-xi/faqs/3043257-bestiary.html',
            title: 'Bestiary',
            category: 'Topic Specific FAQs/Guides',
            author: 'Jadebell',
            date: 'Sep 27, 2019',
            size: '1,929.4 kb',
            version: '0.4',
        });
        // Map images: the full-size file is the thumbnail without `_thumb`.
        expect(entries[3]).toMatchObject({
            kind: 'image',
            href: 'https://faqs.neoseeker.com/Games/Switch/dragon_quest_xi_s_octagonia_caverns_2d_01.jpg',
            category: 'Maps FAQs/Guides',
            author: 'stahlbaum',
            version: '1.0',
        });
        expect(entries[3]!.title).toMatch(
            /Caverns Under Octagonia Part 1 2D Map/
        );
    });

    it('walks every table, drops external rows and keeps blank versions', () => {
        const entries = run('faqs-chrono-trigger.html');
        expect(entries.some((e) => e.href?.includes('strategywiki'))).toBe(
            false
        );
        expect(entries.filter((e) => e.kind === 'image')).toHaveLength(3);
        // The "Non-English" table is a second table.table-list on the page.
        const spanish = entries.filter((e) => /Spanish/.test(e.title ?? ''));
        expect(spanish).toHaveLength(4);
        expect(spanish[0]).toMatchObject({
            href: 'https://www.neoseeker.com/chrono-trigger/faqs/33554-spanish.html',
            category: 'Non-English Walkthroughs & FAQs',
            platform: 'PSX',
            author: 'Lord Zero',
            date: 'Apr 20, 2001',
            version: '1.2',
        });
        expect(entries[0]).toMatchObject({
            title: '(Import) FAQ/Walkthrough Final',
            version: '',
            date: 'Feb 16, 2001',
        });
        expect(new Set(entries.map((e) => e.category)).size).toBeGreaterThan(5);
    });

    it('keeps polling until the page is complete, then reports empty lists', () => {
        expect(
            runInPage(neoGuidesCode, '<html><body><h1>FAQs</h1></body></html>')
        ).toBeUndefined();
        expect(
            runInPage(neoGuidesCode, '<title>Just a moment...</title>')
        ).toBeUndefined();
        expect(
            runInPage(
                neoGuidesCode,
                '<h1>Walkthroughs, FAQs, Guides and Maps</h1><footer id="footer"></footer>'
            )
        ).toBe('[]');
    });
});
