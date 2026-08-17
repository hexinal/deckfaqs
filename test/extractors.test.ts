import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    getGuidesCode,
    getGuideCode,
    getGamesCode,
} from '../src/sources/gamefaqs';
import { neoGuideCode, neoGuidesCode } from '../src/sources/neoseeker';

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

    it('treats the site 404 page (games without user FAQs) as an empty list', () => {
        expect(
            runInPage(neoGuidesCode, fixture('neoseeker/not-found.html'))
        ).toBe('[]');
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

describe('neoGuideCode (Neoseeker wiki and FAQ pages)', () => {
    type Toc = Array<{ data?: string; label: string; options?: Toc }>;
    const run = (name: string) => {
        const raw = runInPage(neoGuideCode, fixture(`neoseeker/${name}`));
        return JSON.parse(raw as string) as { guide: string; toc: Toc };
    };
    const dom = (html: string) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div;
    };

    it('wraps a wiki landing page in #faqwrap with title, prev/next and the sidebar TOC', () => {
        const { guide, toc } = run('walkthrough-dragon-quest-xi.html');
        const root = dom(guide).firstElementChild!;
        expect(root.id).toBe('faqwrap');
        expect(root.className).toBe('ffaq neo-wiki');
        expect(root.querySelector('h1')?.textContent).toBe(
            'Dragon Quest XI: Echoes of an Elusive Age Walkthrough and Guide'
        );
        expect(root.querySelector('.mw-headline#Introduction')).not.toBeNull();
        expect(root.querySelector('script, style, .noprint')).toBeNull();
        // Landing page: only a "Next" link.
        const nav = [...root.querySelectorAll('.neo-nav a')].map((a) => [
            a.className,
            a.getAttribute('href'),
            a.textContent,
        ]);
        expect(nav).toEqual([
            [
                'neo-next',
                'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue',
                'Next: Coming of Age: The Prologue »',
            ],
        ]);
        // Same-guide links inside the article stay (absolute); image links are unwrapped.
        expect(
            root.querySelector(
                'a[href="https://www.neoseeker.com/dragon-quest-xi/Adventures_with_Erik"]'
            )
        ).not.toBeNull();
        expect(root.querySelector('a.image, a[href*="File:"]')).toBeNull();
        expect(
            root.querySelector('img[src^="https://cdn.staticneo.com/"]')
        ).not.toBeNull();

        expect(toc[0]).toEqual({
            data: 'https://www.neoseeker.com/dragon-quest-xi/walkthrough',
            label: 'Guide Home',
        });
        expect(toc[1]!.label).toBe('Walkthrough Act 1:');
        expect(toc[1]!.options![0]).toEqual({
            data: 'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue',
            label: 'Coming of Age: The Prologue',
        });
        // Accordion groups: toggle-labelled ("Quests") and page-link-labelled ("Fun-Size Forge").
        const flat = toc.flatMap((e) => e.options ?? [e]);
        const quests = flat.find((e) => e.label === 'Quests');
        expect(quests?.options?.[0]).toMatchObject({
            data: 'https://www.neoseeker.com/dragon-quest-xi/Act_1_Quests',
        });
        const forge = flat.find((e) => e.label === 'Fun-Size Forge');
        expect(forge?.options?.[0]).toEqual({
            data: 'https://www.neoseeker.com/dragon-quest-xi/Fun-Size_Forge',
            label: 'Fun-Size Forge',
        });
        expect(forge!.options!.length).toBeGreaterThan(1);
        expect(toc.every((e) => !e.options || e.options.length > 0)).toBe(true);
    });

    it('keeps in-guide links on a sub-page and unwraps everything else', () => {
        const { guide, toc } = run('wiki-dqxi-coming-of-age.html');
        const root = dom(guide);
        const links = root.querySelector('#fixture-links')!;
        expect(
            [...links.querySelectorAll('a')].map((a) => a.getAttribute('href'))
        ).toEqual([
            'https://www.neoseeker.com/dragon-quest-xi/Adventures_with_Erik',
            'https://www.neoseeker.com/dragon-quest-xi/Heliodor#Sewers',
            '#Cobblestone_Tor',
            'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue#Cobblestone_Tor',
            'https://www.neoseeker.com/dragon-quest-xi/walkthrough',
        ]);
        expect(links.textContent).toContain('the game hub');
        expect(links.textContent).toContain('an external site');
        expect(links.textContent).toContain('missing page');
        // Unsafe markup is left for DOMPurify (scripts are stripped here already).
        expect(root.querySelector('#fixture-unsafe script')).toBeNull();
        expect(root.querySelector('#fixture-unsafe')).not.toBeNull();
        expect(
            root.querySelector('span.mw-headline#Cobblestone_Tor')
        ).not.toBeNull();
        expect(root.querySelector('table.wikitable')).not.toBeNull();
        const nav = [...root.querySelectorAll('.neo-nav a')].map(
            (a) => a.textContent
        );
        expect(nav).toEqual(['« Home', 'Next: Adventures with Erik »']);
        expect(toc[0]!.label).toBe('Guide Home');
        expect(toc).toHaveLength(3); // Guide Home + the two groups kept in the fixture
    });

    it('normalises an HTML FAQ (GameFAQs-style markup) and its nested TOC', () => {
        const { guide, toc } = run('faq-html-dqxi-bestiary.html');
        const root = dom(guide).firstElementChild!;
        expect(root.className).toBe('ffaq neo-faq');
        expect(root.querySelector('h1')?.textContent).toMatch(/Bestiary/);
        expect(root.querySelector('.author_area')?.textContent).toMatch(
            /by Jadebell/
        );
        expect(root.querySelector('table.ffaq')).not.toBeNull();
        expect(root.querySelector('a[name="Introduction"]')).not.toBeNull();
        expect(
            root.querySelector('img[src^="https://i.neoseeker.com/"]')
        ).not.toBeNull();
        expect(root.querySelector('.copyright')?.textContent).toMatch(
            /copyright/
        );
        // Crumbs, product header, modal and the inline TOC are not copied.
        expect(root.querySelector('#crumbs, header, .modal, .toc')).toBeNull();
        expect(root.querySelector('a[href^="http"]')).toBeNull();
        expect(toc[0]).toEqual({
            data: '#Introduction',
            label: 'Introduction',
        });
        expect(toc[1]!.label).toBe('Regional Bestiary');
        // A parent entry stays reachable as the first option of its group.
        expect(toc[1]!.options!.slice(0, 2)).toEqual([
            { data: '#Regional Bestiary', label: 'Regional Bestiary' },
            {
                data: '#Regional Bestiary Notes',
                label: 'Regional Bestiary Notes',
            },
        ]);
    });

    it('wraps a text FAQ in .faqtext with no links', () => {
        const { guide, toc } = run('faq-text-chrono-trigger.html');
        const root = dom(guide).firstElementChild!;
        expect(root.className).toBe('ffaq neo-faq neo-faq-text');
        expect(root.querySelector('.faqtext > pre')).not.toBeNull();
        expect(root.querySelector('a')).toBeNull();
        expect(root.querySelector('pre')?.textContent).toContain(
            'Chrono Trigger'
        );
        expect(root.querySelector('.author_area')?.textContent).toMatch(
            /XMetaphysics/
        );
        expect(toc).toEqual([]);
    });

    it('drops injected ad slots and shows video clips as their poster frame', () => {
        const { guide } = run('wiki-er-boss.html');
        const root = dom(guide);
        expect(root.querySelector('h1')?.textContent).toBe(
            'Boss: Erdtree Burial Watchdogs'
        );
        expect(
            root.querySelector(
                '.section-vu, .jsad, .placeholder-ad, [id^="div-gpt-ad"], [data-ad-unit-id]'
            )
        ).toBeNull();
        expect(root.textContent).not.toMatch(/Advertisement/);
        expect(root.querySelector('video, source')).toBeNull();
        const posters = [...root.querySelectorAll('img.neo-video')];
        expect(posters).toHaveLength(6);
        expect(posters[0]?.getAttribute('src')).toMatch(
            /^https:\/\/cdn\.staticneo\.com\/.*\.jpg$/
        );
        expect(posters[0]?.getAttribute('alt')).toMatch(/^Video: .*\.mp4$/);
    });

    it('normalises http links and skips red links in the sidebar TOC', () => {
        const raw = runInPage(
            neoGuideCode,
            '<link rel="canonical" href="https://www.neoseeker.com/g/walkthrough">' +
                '<div id="page-title"><h1>G Walkthrough</h1></div>' +
                '<div id="wiki-content"><div class="mw-parser-output">' +
                '<p><a href="http://www.neoseeker.com/g/Page_One">one</a> <a href="https://www.neoseeker.com/g/Page_Two#Sect">two</a></p>' +
                '</div></div>' +
                '<div id="wiki-navigation"><div class="wiki-toc"><ul><li class="heading">Chapters</li>' +
                '<li><a href="https://www.neoseeker.com/g/Page_One">Page One</a></li>' +
                '<li><a href="https://www.neoseeker.com/g/Missing?action=edit&amp;redlink=1" class="new">Missing</a></li>' +
                // Accordion group whose own link is a red link (Elden Ring "Melee Armaments"):
                // keeps its label, is not a page itself, holds the real pages below it.
                '<li><a href="#toc1" class="accordion-toggle"><i class="icon"></i></a> ' +
                '<a href="https://www.neoseeker.com/g/Melee?edit" class="new">Melee Armaments</a> ' +
                '<ul id="toc1"><li><a href="https://www.neoseeker.com/g/Equipment/Daggers">Daggers</a></li>' +
                '<li><a href="https://www.neoseeker.com/g/Equipment/Axes?edit" class="new">Axes</a></li></ul></li>' +
                '</ul></div></div><footer id="footer"></footer>'
        );
        const { guide, toc } = JSON.parse(raw as string) as {
            guide: string;
            toc: Toc;
        };
        expect(
            [...dom(guide).querySelectorAll('a')].map((a) =>
                a.getAttribute('href')
            )
        ).toEqual([
            'https://www.neoseeker.com/g/Page_One',
            'https://www.neoseeker.com/g/Page_Two#Sect',
        ]);
        expect(toc).toEqual([
            {
                label: 'Chapters',
                options: [
                    {
                        data: 'https://www.neoseeker.com/g/Page_One',
                        label: 'Page One',
                    },
                    {
                        label: 'Melee Armaments',
                        options: [
                            {
                                data: 'https://www.neoseeker.com/g/Equipment/Daggers',
                                label: 'Daggers',
                            },
                        ],
                    },
                ],
            },
        ]);
    });

    it('reports the site 404 page instead of polling', () => {
        expect(
            JSON.parse(
                runInPage(
                    neoGuideCode,
                    fixture('neoseeker/not-found.html')
                ) as string
            )
        ).toEqual({ notFound: true });
    });

    it('keeps polling until the page is complete', () => {
        expect(
            runInPage(neoGuideCode, '<title>Just a moment...</title>')
        ).toBeUndefined();
        expect(
            runInPage(
                neoGuideCode,
                '<div id="wiki-content"><div class="mw-parser-output"><p>partial</p></div></div>'
            )
        ).toBeUndefined();
    });

    it('reports a complete page without a guide (never-written wiki page) as not found', () => {
        expect(
            JSON.parse(
                runInPage(
                    neoGuideCode,
                    fixture('neoseeker/wiki-stub.html')
                ) as string
            )
        ).toEqual({ notFound: true });
        expect(
            JSON.parse(
                runInPage(
                    neoGuideCode,
                    '<p>not a guide</p><footer id="footer"></footer>'
                ) as string
            )
        ).toEqual({ notFound: true });
    });
});
