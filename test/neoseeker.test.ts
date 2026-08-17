import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNoCors } from '@decky/api';
import type { RequestContext } from '../src/utils';
import {
    isNeoImageUrl,
    neoGameSearch,
    parseNeoGuideList,
    parseQsPayload,
    qsCandidates,
    qsEscape,
    qsUrl,
} from '../src/sources/neoseeker';
import { badPayloadError, unreachableError } from '../src/sources/source';

// Observed on the live site (2026-08): the header quick-search's own escaping.
describe('qsEscape', () => {
    it.each([
        ['ELDEN RING', 'elden_ring'],
        ['Hades', 'hades'],
        ["Baldur's Gate 3", 'baldurs_gate_3'],
        ['The Witcher 3: Wild Hunt', 'witcher_3_wild_hunt'],
        ['Sekiro™: Shadows Die Twice', 'sekiro_shadows_die_twic'],
        [
            'DRAGON QUEST XI S: Echoes of an Elusive Age - Definitive Edition',
            'dragon_quest_xi_s_echoes',
        ],
        ['Final Fantasy X/X-2 HD Remaster', 'final_fantasy_xx2_hd_re'],
        // Only the first run of underscores is collapsed (site quirk).
        [
            'The Legend of Zelda: Tears of the Kingdom',
            'legend_zelda_tears___ki',
        ],
        ['Pokémon Violet', 'pokmon_violet'],
        // Stop words only / no leading alphanumeric: the site would not search.
        ['The Guide', ''],
        ['- nope', ''],
    ])('%s -> %s', (name, kw) => {
        expect(qsEscape(name)).toBe(kw);
    });
});

describe('qsCandidates', () => {
    it('tries the full name, then the title before a subtitle, then fewer words', () => {
        expect(
            qsCandidates(
                'DRAGON QUEST XI S: Echoes of an Elusive Age - Definitive Edition'
            )
        ).toEqual([
            'dragon_quest_xi_s_echoes',
            'dragon_quest_xi_s',
            'dragon_quest_xi',
            'dragon_quest',
        ]);
        expect(qsCandidates('Final Fantasy X/X-2 HD Remaster')).toEqual([
            'final_fantasy_xx_2_hd_re',
            'final_fantasy_x',
            'final_fantasy',
        ]);
        expect(qsCandidates('Hades')).toEqual(['hades']);
        expect(qsCandidates('Sekiro™: Shadows Die Twice')).toEqual([
            'sekiro_shadows_die_twic',
            'sekiro',
        ]);
    });
    it('folds diacritics and treats hyphens as word breaks', () => {
        expect(qsCandidates('God of War Ragnarök')).toEqual([
            'god_war_ragnarok',
            'god_war',
        ]);
        expect(qsCandidates("Marvel's Spider-Man Remastered")).toEqual([
            'marvels_spider_man_remas',
            'marvels_spider_man',
        ]);
        expect(qsCandidates('Half-Life 2')).toEqual(['half_life_2']);
        expect(qsCandidates('Half-Life: Alyx')).toEqual([
            'half_life_alyx',
            'half_life',
        ]);
        expect(qsCandidates('Pokémon Legends: Arceus')).toEqual([
            'pokemon_legends_arceus',
            'pokemon_legends',
        ]);
        // A subtitle after " - " is still cut off first.
        expect(
            qsCandidates('The Witcher 3: Wild Hunt - Complete Edition')
        ).toEqual(['witcher_3_wild_hunt___co', 'witcher_3']);
    });

    it('never derives single-word keywords and stops at four', () => {
        expect(
            qsCandidates('The Legend of Zelda: Tears of the Kingdom')
        ).toEqual(['legend_zelda_tears___ki', 'legend_zelda']);
        expect(qsCandidates('One Two Three Four Five Six Seven')).toHaveLength(
            4
        );
        expect(qsCandidates('The Guide')).toEqual([]);
    });
});

describe('qsUrl', () => {
    it('shards by the first character', () => {
        expect(qsUrl('elden_ring')).toBe(
            'https://cdn.staticneo.com/neoassets/data/qs/e/elden_ring.json'
        );
    });
});

const QS_HADES =
    'qs({"keywords":"hades","timestamp":1,"products":[' +
    '{"id":76869,"name":"Hades II","url":"\\/\\/www.neoseeker.com\\/hades-ii\\/walkthrough","image":null},' +
    '{"id":76068,"name":"Hades","url":"\\/\\/www.neoseeker.com\\/hades-2020\\/walkthrough","image":"\\/\\/cdn.staticneo.com\\/x.jpg"},' +
    '{"id":1,"name":"Dupe","url":"\\/\\/www.neoseeker.com\\/hades-2020\\/walkthrough"},' +
    '{"id":2,"name":"Elsewhere","url":"\\/\\/evil.example\\/hades"},' +
    '{"id":33648,"name":"Saint Seiya 2: The Hades","url":"\\/\\/www.neoseeker.com\\/saint-seiya-2-the-hades\\/"}' +
    '],"forums":[{"id":103368,"name":"Hades","url":"\\/\\/www.neoseeker.com\\/forums\\/103368\\/"}]});';

describe('parseQsPayload', () => {
    it('unwraps the JSONP and keeps de-duplicated Neoseeker games', () => {
        expect(parseQsPayload(QS_HADES)).toEqual([
            {
                text: 'Hades II',
                url: 'https://www.neoseeker.com/hades-ii/walkthrough',
            },
            {
                text: 'Hades',
                url: 'https://www.neoseeker.com/hades-2020/walkthrough',
            },
            {
                text: 'Saint Seiya 2: The Hades',
                url: 'https://www.neoseeker.com/saint-seiya-2-the-hades/',
            },
        ]);
    });
    it('treats non-JSONP bodies (the CDN 404 page) as no hits', () => {
        expect(
            parseQsPayload('<!DOCTYPE html><title>Error 404</title>')
        ).toEqual([]);
        expect(parseQsPayload('')).toEqual([]);
        expect(parseQsPayload('qs({"products":[]});')).toEqual([]);
        expect(parseQsPayload('qs({"nope":1});')).toEqual([]);
    });
    it('rejects broken JSONP', () => {
        expect(() => parseQsPayload('qs({oops);')).toThrow(
            badPayloadError('neoseeker')
        );
    });
});

describe('neoGameSearch', () => {
    const ctx: RequestContext = { cancelled: () => false };
    const response = (status: number, body = '') =>
        ({
            ok: status >= 200 && status < 300,
            status,
            text: () => Promise.resolve(body),
        }) as unknown as Response;
    const requested = () =>
        vi.mocked(fetchNoCors).mock.calls.map((call) => String(call[0]));

    beforeEach(() => {
        vi.mocked(fetchNoCors).mockReset();
    });

    it('requests every keyword at once and takes the first (in order) with hits', async () => {
        const hit =
            'qs({"products":[{"name":"Dragon Quest XI","url":"//www.neoseeker.com/dragon-quest-xi/walkthrough"}]});';
        // The later, broader keyword answers first with unrelated hits: the
        // earlier candidate still wins.
        vi.mocked(fetchNoCors)
            .mockResolvedValueOnce(response(200, 'qs({"products":[]});'))
            .mockResolvedValueOnce(response(200, 'qs({"products":[]});'))
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve(response(200, hit)), 20)
                    )
            )
            .mockResolvedValueOnce(
                response(
                    200,
                    'qs({"products":[{"name":"Dragon Quest","url":"//www.neoseeker.com/dragon-quest/"}]});'
                )
            );
        const items = await neoGameSearch(
            'DRAGON QUEST XI S: Echoes of an Elusive Age - Definitive Edition',
            ctx
        );
        expect(items).toEqual([
            {
                text: 'Dragon Quest XI',
                url: 'https://www.neoseeker.com/dragon-quest-xi/walkthrough',
            },
        ]);
        expect(requested()).toEqual([
            qsUrl('dragon_quest_xi_s_echoes'),
            qsUrl('dragon_quest_xi_s'),
            qsUrl('dragon_quest_xi'),
            qsUrl('dragon_quest'),
        ]);
    });
    it('resolves [] when nothing matches (404s count as no hits)', async () => {
        vi.mocked(fetchNoCors)
            .mockResolvedValueOnce(response(404, '<html>'))
            .mockResolvedValueOnce(response(200, 'qs({"products":[]});'))
            .mockResolvedValueOnce(response(200, 'qs({"products":[]});'));
        await expect(
            neoGameSearch('Final Fantasy X/X-2 HD Remaster', ctx)
        ).resolves.toEqual([]);
        expect(requested()).toHaveLength(3);
    });
    it('reports an unreachable CDN instead of empty results', async () => {
        vi.mocked(fetchNoCors).mockRejectedValueOnce(new Error('offline'));
        await expect(neoGameSearch('Hades', ctx)).rejects.toThrow(
            unreachableError('neoseeker')
        );
        vi.mocked(fetchNoCors).mockResolvedValueOnce(response(503));
        await expect(neoGameSearch('Hades', ctx)).rejects.toThrow(
            unreachableError('neoseeker')
        );
    });
    it('gives up quietly once the request was cancelled', async () => {
        await expect(
            neoGameSearch('Hades', { cancelled: () => true })
        ).resolves.toEqual([]);
        expect(fetchNoCors).not.toHaveBeenCalled();
    });
});

describe('parseNeoGuideList', () => {
    const wt = 'https://www.neoseeker.com/dragon-quest-xi/walkthrough';
    it('formats rows like the GameFAQs list and groups them by category', () => {
        const raw = JSON.stringify([
            {
                kind: 'walkthrough',
                href: wt,
                title: 'Walkthrough',
                category: 'General FAQs/Guides',
                platform: 'PS4',
                author: 'MasterJG',
                date: 'Sep 4, 2018',
                size: '',
                version: '',
            },
            {
                kind: 'faq',
                href: 'https://www.neoseeker.com/dragon-quest-xi/faqs/3043257-bestiary.html',
                title: 'Bestiary',
                category: 'Topic Specific FAQs/Guides',
                platform: 'PS4',
                author: 'Jadebell',
                date: 'Sep 27, 2019',
                size: '1,929.4 kb',
                version: '0.4',
            },
            {
                kind: 'faq',
                href: 'https://www.neoseeker.com/chrono-trigger/faqs/42520-b.html',
                title: 'CT FAQ',
                category: '',
                platform: '',
                author: 'x',
                date: 'Aug 13, 2002',
                size: '',
                version: 'Final',
            },
            {
                kind: 'image',
                href: 'https://faqs.neoseeker.com/Games/Switch/map_01.jpg',
                title: 'Octagonia Map (JPG)',
                category: 'Maps FAQs/Guides',
                platform: '',
                author: 'stahlbaum',
                date: 'Oct 16, 2019',
                size: '405.6 kb',
                version: '1.0',
            },
            {
                kind: 'faq',
                href: 'http://strategywiki.org/x',
                title: 'External',
            },
            { kind: 'faq', title: 'no href' },
        ]);
        expect(parseNeoGuideList(raw, wt)).toEqual([
            {
                text: 'Walkthrough (PS4) - Sep 4, 2018',
                url: wt,
                group: 'General FAQs/Guides',
            },
            {
                text: 'Bestiary (PS4) - v0.4 - Sep 27, 2019',
                url: 'https://www.neoseeker.com/dragon-quest-xi/faqs/3043257-bestiary.html',
                group: 'Topic Specific FAQs/Guides',
            },
            {
                text: 'CT FAQ - Final - Aug 13, 2002',
                url: 'https://www.neoseeker.com/chrono-trigger/faqs/42520-b.html',
                group: undefined,
            },
            {
                text: 'Octagonia Map (JPG) - v1.0 - Oct 16, 2019',
                url: 'https://faqs.neoseeker.com/Games/Switch/map_01.jpg',
                group: 'Maps FAQs/Guides',
            },
        ]);
    });
    it('adds the walkthrough when the search hit was one but the list lacks it', () => {
        expect(parseNeoGuideList('[]', wt)).toEqual([
            { text: 'Walkthrough', url: wt },
        ]);
        expect(
            parseNeoGuideList('[]', 'https://www.neoseeker.com/chrono-trigger/')
        ).toEqual([]);
    });
    it('rejects garbage', () => {
        expect(() => parseNeoGuideList('<html>', wt)).toThrow(
            badPayloadError('neoseeker')
        );
        expect(
            parseNeoGuideList('{"a":1}', 'https://www.neoseeker.com/x/')
        ).toEqual([]);
    });
});

describe('isNeoImageUrl', () => {
    it('recognises the file hosts only', () => {
        expect(
            isNeoImageUrl('https://faqs.neoseeker.com/Games/Switch/map.jpg')
        ).toBe(true);
        expect(isNeoImageUrl('https://i.neoseeker.com/ffi/1/2.png')).toBe(true);
        expect(isNeoImageUrl('https://www.neoseeker.com/x/faqs/1-a.html')).toBe(
            false
        );
        expect(isNeoImageUrl('nope')).toBe(false);
    });
});
