import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNoCors } from '@decky/api';
import type { RequestContext } from '../src/utils';
import {
    neoGameSearch,
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
            'final_fantasy_xx2_hd_re',
            'final_fantasy_x',
            'final_fantasy',
        ]);
        expect(qsCandidates('Hades')).toEqual(['hades']);
        expect(qsCandidates('Sekiro™: Shadows Die Twice')).toEqual([
            'sekiro_shadows_die_twic',
            'sekiro',
        ]);
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

    it('stops at the first keyword with hits', async () => {
        vi.mocked(fetchNoCors)
            .mockResolvedValueOnce(response(200, 'qs({"products":[]});'))
            .mockResolvedValueOnce(response(200, 'qs({"products":[]});'))
            .mockResolvedValueOnce(
                response(
                    200,
                    'qs({"products":[{"name":"Dragon Quest XI","url":"//www.neoseeker.com/dragon-quest-xi/walkthrough"}]});'
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
