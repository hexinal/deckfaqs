import { describe, expect, it } from 'vitest';
import {
    GAMEFAQS_ORIGIN,
    NEOSEEKER_IMAGE_ORIGINS,
    SCRAPE_ORIGINS,
} from '../src/constants';
import {
    badPayloadError,
    guideListUrl,
    imageOrigins,
    isGuideSource,
    pageOf,
    pageUrl,
    sourceOf,
    tocSectionFor,
    unreachableError,
} from '../src/sources/source';

const GF_GUIDE =
    'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs/69037';
const NEO_GUIDE = 'https://www.neoseeker.com/dragon-quest-xi/walkthrough';
const NEO_PAGE =
    'https://www.neoseeker.com/dragon-quest-xi/Adventures_with_Erik';

describe('sourceOf', () => {
    it('recognises every Neoseeker host and defaults to GameFAQs', () => {
        expect(sourceOf(NEO_GUIDE)).toBe('neoseeker');
        expect(
            sourceOf('https://faqs.neoseeker.com/Games/Switch/map.jpg')
        ).toBe('neoseeker');
        expect(sourceOf('https://cdn.staticneo.com/ew/x.jpg')).toBe(
            'neoseeker'
        );
        expect(sourceOf('https://i.neoseeker.com/ffi/1/2.png')).toBe(
            'neoseeker'
        );
        expect(sourceOf(GF_GUIDE)).toBe('gamefaqs');
        expect(sourceOf('not a url')).toBe('gamefaqs');
    });
    it('keeps the allow-lists consistent', () => {
        for (const origin of NEOSEEKER_IMAGE_ORIGINS) {
            expect(sourceOf(`${origin}/x`)).toBe('neoseeker');
        }
        expect(SCRAPE_ORIGINS).toContain(GAMEFAQS_ORIGIN);
        expect(imageOrigins('gamefaqs')).toEqual([GAMEFAQS_ORIGIN]);
        expect(imageOrigins('neoseeker')).toBe(NEOSEEKER_IMAGE_ORIGINS);
    });
});

describe('isGuideSource', () => {
    it('accepts the three settings only', () => {
        expect(isGuideSource('both')).toBe(true);
        expect(isGuideSource('gamefaqs')).toBe(true);
        expect(isGuideSource('neoseeker')).toBe(true);
        expect(isGuideSource('all')).toBe(false);
        expect(isGuideSource(undefined)).toBe(false);
    });
});

describe('guideListUrl', () => {
    it('appends /faqs for GameFAQs games', () => {
        expect(
            guideListUrl(
                'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x'
            )
        ).toBe('https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs');
    });
    it('builds /<slug>/faqs/ (with the slash) for Neoseeker games', () => {
        expect(guideListUrl(NEO_GUIDE)).toBe(
            'https://www.neoseeker.com/dragon-quest-xi/faqs/'
        );
        expect(guideListUrl('https://www.neoseeker.com/chrono-trigger/')).toBe(
            'https://www.neoseeker.com/chrono-trigger/faqs/'
        );
    });
});

describe('pageUrl / pageOf', () => {
    it('keeps GameFAQs page fragments under the guide URL', () => {
        expect(pageUrl(GF_GUIDE)).toBe(GF_GUIDE);
        expect(pageUrl(GF_GUIDE, '?page=1')).toBe(`${GF_GUIDE}/?page=1`);
        expect(pageUrl(GF_GUIDE, '?page=1#section48')).toBe(
            `${GF_GUIDE}/?page=1#section48`
        );
        expect(pageUrl(GF_GUIDE, '#s1')).toBe(`${GF_GUIDE}/#s1`);
        expect(pageOf(GF_GUIDE, '?page=2#s5')).toEqual({
            page: '?page=2',
            anchor: 's5',
        });
        expect(pageOf(GF_GUIDE, '?page=2')).toEqual({
            page: '?page=2',
            anchor: '',
        });
        expect(pageOf(GF_GUIDE, '#s5')).toEqual({ page: '', anchor: 's5' });
    });
    it('treats Neoseeker pages as absolute URLs, the landing page as ""', () => {
        expect(pageUrl(NEO_GUIDE)).toBe(NEO_GUIDE);
        expect(pageUrl(NEO_GUIDE, NEO_PAGE)).toBe(NEO_PAGE);
        expect(
            pageUrl(NEO_GUIDE, '/dragon-quest-xi/Adventures_with_Erik')
        ).toBe(NEO_PAGE);
        expect(pageUrl(NEO_GUIDE, '#Heliodor')).toBe(`${NEO_GUIDE}#Heliodor`);
        expect(pageOf(NEO_GUIDE, `${NEO_PAGE}#Cobblestone_Tor`)).toEqual({
            page: NEO_PAGE,
            anchor: 'Cobblestone_Tor',
        });
        expect(pageOf(NEO_GUIDE, NEO_GUIDE)).toEqual({ page: '', anchor: '' });
        expect(pageOf(NEO_GUIDE, '#Intro')).toEqual({
            page: '',
            anchor: 'Intro',
        });
    });
});

describe('tocSectionFor', () => {
    const toc = [
        { data: NEO_GUIDE, label: 'Guide Home' },
        {
            label: 'Act 1',
            options: [
                {
                    data: 'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age',
                    label: 'Prologue',
                },
                { data: NEO_PAGE, label: 'Erik' },
            ],
        },
    ];
    it('finds the entry for the loaded page (nested groups included)', () => {
        expect(tocSectionFor(toc, NEO_GUIDE, NEO_PAGE)).toBe(NEO_PAGE);
        expect(tocSectionFor(toc, NEO_GUIDE, '')).toBe(NEO_GUIDE);
        expect(
            tocSectionFor(toc, NEO_GUIDE, 'https://www.neoseeker.com/x/y')
        ).toBeUndefined();
        expect(tocSectionFor(undefined, NEO_GUIDE, '')).toBeUndefined();
    });
    it('ignores anchor entries, so GameFAQs guides are unaffected', () => {
        const gfToc = [
            { data: '?page=1#s1', label: 'Intro' },
            { data: '#s2', label: 'Two' },
        ];
        expect(tocSectionFor(gfToc, GF_GUIDE, '?page=1')).toBeUndefined();
        expect(tocSectionFor(gfToc, GF_GUIDE, '')).toBeUndefined();
    });
});

describe('error strings', () => {
    it('name the site', () => {
        expect(unreachableError('gamefaqs')).toBe(
            "Couldn't load GameFAQs. Check the connection and retry."
        );
        expect(unreachableError('neoseeker')).toMatch(
            /^Couldn't load Neoseeker\./
        );
        expect(badPayloadError('gamefaqs')).toBe(
            'GameFAQs returned something unexpected. Retry, or update DeckFAQs if it keeps happening.'
        );
    });
});
