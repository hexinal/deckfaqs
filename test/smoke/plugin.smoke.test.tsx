/**
 * End-to-end smoke test of the BUILT plugin (dist/index.js) in jsdom: renders
 * the real bundle with fake Steam/Decky globals and drives the user flow
 * games -> search -> guide list -> guide, with the plugin's own in-tab
 * extraction scripts running against saved GameFAQs pages. Run `pnpm build`
 * first (CI does). If a dependency upgrade breaks the plugin at runtime, this
 * is what fails.
 */
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
    type RenderResult,
} from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Navigation,
    backend,
    cef,
    deckyApi,
    loadPlugin,
    qam,
    routes,
    steam,
} from './env';

type Plugin = Awaited<ReturnType<typeof loadPlugin>>;
let plugin: Plugin;

// A fresh bundle per test: its module-level caches (visited pages, reading
// positions) must not leak from one scenario into the next.
beforeEach(async () => {
    vi.resetModules();
    plugin = await loadPlugin();
});
afterEach(() => {
    cleanup();
    document.querySelectorAll('[data-modal]').forEach((el) => el.remove());
    cef.reset();
    // Settings are read on every panel mount: reseed so one test's toggles
    // cannot leak into the next; the backend's positions file likewise.
    steam.storage.set('deckfaqs_settings', { darkMode: true });
    backend.clear();
    qam.set(true);
});

const openPanel = () => render(plugin.content);

// First match: e.g. the running game appears both in its own row and the list.
const clickButton = (name: string | RegExp) =>
    fireEvent.click(screen.getAllByRole('button', { name })[0]!);

/** Games list -> search results for the given game. */
const searchGame = async (name: string) => {
    await screen.findByRole('button', { name: /chrono trigger/i });
    clickButton(new RegExp(name, 'i'));
    await screen.findByText('Search Results');
};

/** ... -> guide list of the first search hit. */
const openGuideList = async () => {
    await searchGame('final fantasy x');
    clickButton(/^Final Fantasy X$/);
    await screen.findByText('Guides');
    await screen.findAllByText(/FFX FAQ\/Walkthrough/);
};

/** ... -> the first guide rendered. */
const openGuide = async () => {
    await openGuideList();
    clickButton(/FFX FAQ\/Walkthrough/);
    await waitFor(() =>
        expect(document.querySelector('#faqwrap')).not.toBeNull()
    );
};

describe('DeckFAQs bundle', () => {
    it('defines the plugin and creates the hidden BrowserView', () => {
        expect(plugin.name).toBe('DeckFAQs');
        expect(plugin.content).toBeTruthy();
    });

    it('lists installed Steam + non-Steam games, filtered and sorted, with the running game on top', async () => {
        openPanel();
        await screen.findByText('Installed Games');
        const buttons = (await screen.findAllByRole('button')).map(
            (b) => b.textContent
        );
        // Running game row + list (sorted by sort_as: chrono trigger, final fantasy x).
        expect(buttons).toEqual([
            'Search games',
            'Final Fantasy X',
            'Chrono Trigger',
            'Final Fantasy X',
        ]);
        expect(buttons).not.toContain('RetroArch');
        expect(buttons).not.toContain('Steamworks Common Redistributables');
        // Dark mode restored from SteamClient.Storage.
        expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('persists the dark-mode toggle immediately', async () => {
        openPanel();
        const toggle = await screen.findByRole('checkbox');
        fireEvent.click(toggle);
        expect(steam.storage.get('deckfaqs_settings')).toEqual({
            darkMode: false,
            source: 'both',
        });
        fireEvent.click(toggle);
        expect(steam.storage.get('deckfaqs_settings')).toEqual({
            darkMode: true,
            source: 'both',
        });
    });

    it('searches GameFAQs through the BrowserView and lists the results', async () => {
        openPanel();
        await searchGame('chrono trigger');
        expect(cef.loadUrl).toHaveBeenCalledWith(
            'https://gamefaqs.gamespot.com/ajax/home_game_search?term=Chrono+Trigger'
        );
        expect(
            await screen.findByRole('button', { name: /^Final Fantasy X$/ })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /^Final Fantasy X-2$/ })
        ).toBeInTheDocument();
        // The view is parked on a blank page afterwards.
        expect(cef.currentUrl.startsWith('data:text/html')).toBe(true);
    });

    it('searches via the search dialog (Enter submits)', async () => {
        openPanel();
        await screen.findByText('Installed Games');
        clickButton(/search games/i);
        const input = await screen.findByLabelText('search');
        fireEvent.change(input, { target: { value: "Baldur's Gate" } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await screen.findByText('Search Results');
        expect(cef.loadUrl).toHaveBeenCalledWith(
            "https://gamefaqs.gamespot.com/ajax/home_game_search?term=Baldur's+Gate"
        );
    });

    it('searches Neoseeker alongside GameFAQs and groups the results', async () => {
        openPanel();
        await searchGame('chrono trigger');
        // Neoseeker's quick-search is fetched straight from its CDN, never in the view.
        expect(cef.qsRequests).toEqual(['chrono_trigger']);
        expect(cef.loadUrl).not.toHaveBeenCalledWith(
            expect.stringContaining('neoseeker')
        );
        expect(
            await screen.findByRole('button', { name: /^Chrono Trigger$/ })
        ).toBeInTheDocument();
        const headers = screen
            .getAllByText(/^(GameFAQs|Neoseeker)$/)
            .map((el) => el.textContent);
        expect(headers).toEqual(['GameFAQs', 'Neoseeker']);
    });

    it('shortens long Steam names until Neoseeker finds the game', async () => {
        openPanel();
        await screen.findByText('Installed Games');
        clickButton(/search games/i);
        const input = await screen.findByLabelText('search');
        fireEvent.change(input, {
            target: {
                value: 'DRAGON QUEST XI S: Echoes of an Elusive Age - Definitive Edition',
            },
        });
        fireEvent.keyDown(input, { key: 'Enter' });
        await screen.findByText('Search Results');
        await screen.findByRole('button', {
            name: /^Dragon Quest XI: Echoes of an Elusive Age$/,
        });
        // All keyword candidates are requested at once; the first with hits wins.
        expect(cef.qsRequests).toEqual([
            'dragon_quest_xi_s_echoes',
            'dragon_quest_xi_s',
            'dragon_quest_xi',
            'dragon_quest',
        ]);
    });

    it('keeps GameFAQs results and offers a retry when Neoseeker is down', async () => {
        cef.offline.add('cdn.staticneo.com');
        openPanel();
        await searchGame('chrono trigger');
        expect(
            await screen.findByRole('button', { name: /^Final Fantasy X$/ })
        ).toBeInTheDocument();
        expect(screen.getByText(/Couldn't load Neoseeker/)).toBeInTheDocument();
        expect(screen.queryByText('Neoseeker')).toBeNull();
        cef.offline.clear();
        clickButton(/^Retry$/);
        await screen.findByRole('button', { name: /^Chrono Trigger$/ });
        expect(screen.queryByText(/Couldn't load Neoseeker/)).toBeNull();
    });

    it('persists the guide-source setting and honours it when searching', async () => {
        openPanel();
        const picker = await screen.findByRole('combobox', {
            name: 'Guide source',
        });
        fireEvent.change(picker, { target: { value: 'gamefaqs' } });
        expect(steam.storage.get('deckfaqs_settings')).toEqual({
            darkMode: true,
            source: 'gamefaqs',
        });
        await searchGame('chrono trigger');
        expect(cef.qsRequests).toEqual([]);
        expect(screen.queryByText('GameFAQs')).toBeNull(); // no groups for one site
        clickButton(/^Back$/);
        fireEvent.change(
            await screen.findByRole('combobox', { name: 'Guide source' }),
            { target: { value: 'neoseeker' } }
        );
        cef.loadUrl.mockClear();
        await searchGame('chrono trigger');
        expect(cef.qsRequests).toEqual(['chrono_trigger']);
        expect(cef.loadUrl).not.toHaveBeenCalled();
        await screen.findByRole('button', { name: /^Chrono Trigger$/ });
    });

    it('lists Neoseeker walkthroughs, FAQs and maps by category', async () => {
        openPanel();
        await searchGame('chrono trigger');
        clickButton(/^Chrono Trigger$/);
        await screen.findByText('Guides');
        // Loaded with the trailing slash (the site redirects /faqs, which the
        // exact CEF tab match could not follow).
        expect(cef.loadUrl).toHaveBeenCalledWith(
            'https://www.neoseeker.com/chrono-trigger/faqs/'
        );
        const rows = (await screen.findAllByRole('button'))
            .map((b) => b.textContent ?? '')
            .filter((t) => /\d{4}$/.test(t));
        expect(rows).toContain(
            '(Import) FAQ/Walkthrough Final (PSX) - Feb 16, 2001'
        );
        expect(rows).toContain('FAQ/Walkthrough (PSX) - v1.01 - May 24, 2006');
        expect(rows.some((r) => /2D Map|Map \(/.test(r))).toBe(true);
        expect(rows.some((r) => /Spanish/.test(r))).toBe(true);
        expect(rows.some((r) => /StrategyWiki/.test(r))).toBe(false);
        expect(screen.getByText('General FAQs/Guides')).toBeInTheDocument();
        expect(screen.getByText('Maps FAQs/Guides')).toBeInTheDocument();
        expect(
            screen.getByText('Non-English Walkthroughs & FAQs')
        ).toBeInTheDocument();
    });

    /** ... -> Neoseeker guide list of Dragon Quest XI (found via the search dialog). */
    const openNeoGuideList = async () => {
        await screen.findByText('Installed Games');
        clickButton(/search games/i);
        const input = await screen.findByLabelText('search');
        fireEvent.change(input, { target: { value: 'Dragon Quest XI' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await screen.findByText('Search Results');
        clickButton(/^Dragon Quest XI: Echoes of an Elusive Age$/);
        await screen.findByText('Guides');
        await screen.findByRole('button', { name: /^Walkthrough \(PS4\)/ });
    };

    /**
     * jsdom has no layout: fake a 1000px-tall guide in a 200px viewport whose
     * content shifts up by the scroll offset (as the GameFAQs positions test
     * does). Returns the undo function.
     */
    const fakeLayout = () => {
        const fake = (name: 'scrollHeight' | 'clientHeight', value: number) =>
            Object.defineProperty(HTMLElement.prototype, name, {
                configurable: true,
                get: () => value,
            });
        fake('scrollHeight', 1000);
        fake('clientHeight', 200);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const realRect = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function (
            this: HTMLElement
        ) {
            const scroller = this.closest('.deckfaqs_guide')?.parentElement;
            const top = scroller ? -scroller.scrollTop : 0;
            return { ...realRect.call(this), top, y: top, bottom: top };
        };
        return () => {
            HTMLElement.prototype.getBoundingClientRect = realRect;
            Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
            Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
        };
    };

    it('renders a Neoseeker wiki walkthrough with its TOC, sub-pages and positions', async () => {
        const undoLayout = fakeLayout();
        const guideUrl =
            'https://www.neoseeker.com/dragon-quest-xi/walkthrough';
        const subPage =
            'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue';
        const scroller = () =>
            document.querySelector('.deckfaqs_guide')!.parentElement!;
        try {
            openPanel();
            await openNeoGuideList();
            clickButton(/^Walkthrough \(PS4\)/);
            await waitFor(() =>
                expect(
                    document.querySelector('#faqwrap.neo-wiki')
                ).not.toBeNull()
            );
            expect(cef.loadUrl).toHaveBeenCalledWith(guideUrl);
            const faq = document.querySelector('#faqwrap')!;
            expect(faq.querySelector('h1')?.textContent).toMatch(
                /Dragon Quest XI.*Walkthrough and Guide/
            );
            expect(
                faq.querySelector('img[src^="https://cdn.staticneo.com/"]')
            ).not.toBeNull();
            const next = faq.querySelector('.neo-nav a')!;
            expect(next.textContent).toMatch(/^Next: /);
            expect(next.classList.contains('neo-next')).toBe(true);
            // Guide images are resolved to the site and load lazily.
            const img = faq.querySelector(
                'img[src^="https://cdn.staticneo.com/"]'
            )!;
            expect(img.getAttribute('loading')).toBe('lazy');
            const toc = screen.getByRole('combobox', { name: 'TOC' });
            const labels = within(toc)
                .getAllByRole('option')
                .map((o) => o.textContent);
            expect(labels).toContain('Guide Home');
            expect(labels).toContain('Coming of Age: The Prologue');
            expect(labels).toContain('Fun-Size Forge');
            expect(toc).toHaveValue(guideUrl); // "Guide Home" selected

            // Sub-page via the TOC: loaded by its absolute URL, sanitised, TOC follows.
            cef.loadUrl.mockClear();
            fireEvent.change(toc, { target: { value: subPage } });
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(subPage)
            );
            await waitFor(() =>
                expect(document.querySelector('#fixture-unsafe')).not.toBeNull()
            );
            const page = document.querySelector('#faqwrap')!;
            expect(page.querySelector('script, [style], [onclick]')).toBeNull();
            expect(page.querySelector('img[src*="evil.example"]')).toBeNull();
            expect(
                page.querySelector('img[src^="https://cdn.staticneo.com/"]')
            ).not.toBeNull();
            expect(
                page.querySelector('#fixture-links a[href*="example.com"]')
            ).toBeNull();
            expect(page.querySelector('#fixture-links')?.textContent).toContain(
                'an external site'
            );
            expect(page.querySelector('.neo-nav a')?.textContent).toBe(
                '« Home'
            );
            // An absolute link to a section of this very page scrolls without a reload.
            cef.loadUrl.mockClear();
            const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
            fireEvent.click(
                screen.getByText("this page's Cobblestone Tor section")
            );
            await waitFor(() => expect(scroll).toHaveBeenCalled());
            expect(scroll.mock.instances[0]).toBe(
                document.querySelector('#faqwrap [id="Cobblestone_Tor"]')
            );
            expect(cef.loadUrl).not.toHaveBeenCalled();
            scroll.mockRestore();
            expect(screen.getByRole('combobox', { name: 'TOC' })).toHaveValue(
                subPage
            );

            // Scroll, Back: the position remembers the sub-page; reopening returns to it.
            scroller().scrollTop = 400;
            fireEvent.scroll(scroller());
            clickButton(/^Back$/);
            await screen.findByText('Guides');
            expect(backend.get('positions')).toMatchObject({
                [guideUrl]: { page: subPage, ratio: 0.5 },
            });
            // Reopening lands on the remembered sub-page — from the page cache,
            // without another load — and restores the position there.
            cef.loadUrl.mockClear();
            clickButton(/^Walkthrough \(PS4\)/);
            await waitFor(() =>
                expect(document.querySelector('#fixture-links')).not.toBeNull()
            );
            await waitFor(() => expect(scroller().scrollTop).toBe(400));
            expect(cef.loadUrl).not.toHaveBeenCalled();
            // In-guide link back to the landing page — clicked on an element
            // nested inside the <a> (links are handled by delegation); the
            // landing page was seen before, so it comes from the cache too.
            expect(screen.getByText('« Home')).toBeInTheDocument();
            fireEvent.click(screen.getByText('the guide home in bold'));
            await waitFor(() =>
                expect(
                    document.querySelector('#faqwrap h1')?.textContent
                ).toMatch(/Walkthrough and Guide/)
            );
            expect(cef.loadUrl).not.toHaveBeenCalled();
        } finally {
            undoLayout();
        }
    });

    it('opens guide images and clips in a lightbox', async () => {
        const subPage =
            'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue';
        const modal = () => document.querySelector('[data-modal]');
        openPanel();
        await openNeoGuideList();
        clickButton(/^Walkthrough \(PS4\)/);
        await waitFor(() =>
            expect(document.querySelector('#faqwrap.neo-wiki')).not.toBeNull()
        );
        fireEvent.change(screen.getByRole('combobox', { name: 'TOC' }), {
            target: { value: subPage },
        });
        await waitFor(() =>
            expect(document.querySelector('#fixture-media')).not.toBeNull()
        );
        const page = document.querySelector('#faqwrap')!;

        // A wiki thumbnail opens as its full-size file; tap toggles 1:1.
        const thumb = page.querySelector<HTMLImageElement>(
            'img[data-full^="https://cdn.staticneo.com/ew/6/61/"]'
        )!;
        fireEvent.click(thumb);
        const big = modal()!.querySelector('img')!;
        expect(big.getAttribute('src')).toBe(thumb.dataset.full);
        const zoomState = () =>
            modal()!.querySelector('[data-zoom]')!.getAttribute('data-zoom');
        expect(zoomState()).toBe('fit');
        // A tap (pointer down/up without moving) zooms to actual size, a
        // second one back to fit; a drag is not a tap.
        const view = big.parentElement!;
        fireEvent.pointerDown(view, { pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.pointerUp(view, { pointerId: 1, clientX: 10, clientY: 10 });
        expect(zoomState()).toBe('zoomed');
        expect(big.style.transform).toMatch(/scale\(2\)/);
        fireEvent.pointerDown(view, { pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.pointerMove(view, { pointerId: 1, clientX: 60, clientY: 40 });
        fireEvent.pointerUp(view, { pointerId: 1, clientX: 60, clientY: 40 });
        expect(zoomState()).toBe('zoomed');
        fireEvent.pointerDown(view, { pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.pointerUp(view, { pointerId: 1, clientX: 10, clientY: 10 });
        expect(zoomState()).toBe('fit');
        expect(big.style.transform).toMatch(/scale\(1\)/);
        // Pinch: two pointers moving apart zoom in.
        fireEvent.pointerDown(view, {
            pointerId: 1,
            clientX: 100,
            clientY: 100,
        });
        fireEvent.pointerDown(view, {
            pointerId: 2,
            clientX: 200,
            clientY: 100,
        });
        fireEvent.pointerMove(view, {
            pointerId: 2,
            clientX: 300,
            clientY: 100,
        });
        expect(big.style.transform).toMatch(/scale\(2\)/);
        fireEvent.pointerUp(view, { pointerId: 2, clientX: 300, clientY: 100 });
        fireEvent.pointerUp(view, { pointerId: 1, clientX: 100, clientY: 100 });
        expect(zoomState()).toBe('zoomed');
        Navigation.OpenQuickAccessMenu.mockClear();
        fireEvent.click(within(modal() as HTMLElement).getByText('Close'));
        expect(modal()).toBeNull();
        // The Steam modal hid the Quick Access Menu; it is reopened.
        expect(Navigation.OpenQuickAccessMenu).toHaveBeenCalled();
        // The guide itself is untouched.
        expect(document.querySelector('#fixture-media')).not.toBeNull();

        // A clip: poster with a play badge inline, <video> in the lightbox.
        const media = page.querySelector('#fixture-media')!;
        const poster = media.querySelector<HTMLImageElement>(
            '.neo-video-wrap img[src$="Fixture_Clip.jpg"]'
        )!;
        expect(poster).not.toBeNull();
        fireEvent.click(poster);
        const video = modal()!.querySelector('video')!;
        expect(video.getAttribute('poster')).toBe(poster.getAttribute('src'));
        expect(
            [...video.querySelectorAll('source')].map((s) => [
                s.getAttribute('type'),
                s.getAttribute('src'),
            ])
        ).toEqual([
            [
                'video/webm',
                'https://cdn.staticneo.com/ew/f/f1/Fixture_Clip.webm',
            ],
            ['video/mp4', 'https://cdn.staticneo.com/ew/f/f1/Fixture_Clip.mp4'],
        ]);
        expect(modal()!.textContent).toContain('Fixture_Clip.mp4');
        fireEvent.click(within(modal() as HTMLElement).getByText('Close'));
        expect(modal()).toBeNull();

        // Off-site clip sources and full-size URLs are dropped: the poster is
        // a plain image, the thumbnail opens as itself.
        const evilPoster = media.querySelector<HTMLImageElement>(
            'img[src$="Evil_Clip.jpg"]'
        )!;
        expect(evilPoster.getAttribute('data-video-mp4')).toBeNull();
        expect(evilPoster.getAttribute('data-video-webm')).toBeNull();
        expect(evilPoster.closest('.neo-video-wrap')).toBeNull();
        const evilThumb = media.querySelector<HTMLImageElement>(
            'img[src*="Evil_Full"]'
        )!;
        expect(evilThumb.getAttribute('data-full')).toBeNull();
        fireEvent.click(evilThumb);
        expect(modal()!.querySelector('img')?.getAttribute('src')).toBe(
            evilThumb.getAttribute('src')
        );
        expect(modal()!.innerHTML).not.toContain('evil.example');
        fireEvent.click(within(modal() as HTMLElement).getByText('Close'));
        expect(modal()).toBeNull();
    });

    it('lists just the walkthrough for a Neoseeker game whose /faqs/ page is a 404', async () => {
        openPanel();
        await screen.findByText('Installed Games');
        clickButton(/search games/i);
        const input = await screen.findByLabelText('search');
        fireEvent.change(input, { target: { value: 'ELDEN RING' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await screen.findByText('Search Results');
        clickButton(/^Elden Ring$/);
        await screen.findByText('Guides');
        const walkthrough = await screen.findByRole('button', {
            name: /^Walkthrough$/,
        });
        expect(cef.loadUrl).toHaveBeenCalledWith(
            'https://www.neoseeker.com/elden-ring/faqs/'
        );
        fireEvent.click(walkthrough);
        await waitFor(() =>
            expect(document.querySelector('#faqwrap.neo-wiki')).not.toBeNull()
        );
        expect(cef.loadUrl).toHaveBeenCalledWith(
            'https://www.neoseeker.com/elden-ring/walkthrough'
        );
    });

    it('follows a same-site redirect when opening a wiki page', async () => {
        // Neoseeker redirects renamed wiki titles; the tab is then found by id.
        cef.redirects.set(
            'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue',
            'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age'
        );
        openPanel();
        await openNeoGuideList();
        clickButton(/^Walkthrough \(PS4\)/);
        await waitFor(() =>
            expect(document.querySelector('#faqwrap.neo-wiki')).not.toBeNull()
        );
        const toc = screen.getByRole('combobox', { name: 'TOC' });
        fireEvent.change(toc, {
            target: {
                value: 'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue',
            },
        });
        await waitFor(() =>
            expect(document.querySelector('#fixture-links')).not.toBeNull()
        );
        expect(cef.currentUrl.startsWith('data:text/html')).toBe(true);
    });

    it('prefetches the next wiki page and serves visited pages from the cache', async () => {
        const g = globalThis as { __deckfaqsPrefetchDelayMs?: number };
        g.__deckfaqsPrefetchDelayMs = 50;
        try {
            openPanel();
            await openNeoGuideList();
            clickButton(/^Walkthrough \(PS4\)/);
            await waitFor(() =>
                expect(
                    document.querySelector('#faqwrap.neo-wiki')
                ).not.toBeNull()
            );
            // The landing page's "Next" is fetched in the background…
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(
                    'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue'
                )
            );
            await waitFor(() =>
                expect(cef.currentUrl.startsWith('data:text/html')).toBe(true)
            );
            // …so clicking Next needs no load at all.
            cef.loadUrl.mockClear();
            fireEvent.click(screen.getByText(/^Next: Coming of Age/));
            await waitFor(() =>
                expect(document.querySelector('#fixture-links')).not.toBeNull()
            );
            expect(cef.loadUrl).not.toHaveBeenCalled();
            // The sub-page's Next is prefetched in turn.
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(
                    'https://www.neoseeker.com/dragon-quest-xi/Adventures_with_Erik'
                )
            );
        } finally {
            g.__deckfaqsPrefetchDelayMs = 60_000;
        }
    });

    it('lets a user click reclaim the view from a running prefetch', async () => {
        const g = globalThis as { __deckfaqsPrefetchDelayMs?: number };
        g.__deckfaqsPrefetchDelayMs = 50;
        // The landing's Next never finishes loading (offline page).
        cef.blackhole.add(
            'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue'
        );
        try {
            openPanel();
            await openNeoGuideList();
            clickButton(/^Walkthrough \(PS4\)/);
            await waitFor(() =>
                expect(
                    document.querySelector('#faqwrap.neo-wiki')
                ).not.toBeNull()
            );
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(
                    'https://www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue'
                )
            );
            // The user picks another page while the prefetch is polling: the
            // prefetch is cancelled and the user's page loads.
            cef.loadUrl.mockClear();
            fireEvent.change(screen.getByRole('combobox', { name: 'TOC' }), {
                target: {
                    value: 'https://www.neoseeker.com/dragon-quest-xi/Fun-Size_Forge',
                },
            });
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(
                    'https://www.neoseeker.com/dragon-quest-xi/Fun-Size_Forge'
                )
            );
            await waitFor(() =>
                expect(
                    document.querySelector('#faqwrap.neo-wiki')
                ).not.toBeNull()
            );
            expect(screen.getByRole('combobox', { name: 'TOC' })).toHaveValue(
                'https://www.neoseeker.com/dragon-quest-xi/Fun-Size_Forge'
            );
        } finally {
            g.__deckfaqsPrefetchDelayMs = 60_000;
        }
    });

    it('renders Neoseeker HTML and text FAQs and map images', async () => {
        openPanel();
        await openNeoGuideList();
        // HTML FAQ: GameFAQs-style markup with an anchor TOC.
        clickButton(/^Bestiary \(PS4\)/);
        await waitFor(() =>
            expect(document.querySelector('#faqwrap.neo-faq')).not.toBeNull()
        );
        expect(cef.loadUrl).toHaveBeenCalledWith(
            'https://www.neoseeker.com/dragon-quest-xi/faqs/3043257-bestiary.html'
        );
        expect(document.querySelector('#faqwrap table.ffaq')).not.toBeNull();
        expect(
            document.querySelector(
                '#faqwrap img[src^="https://i.neoseeker.com/"]'
            )
        ).not.toBeNull();
        const toc = screen.getByRole('combobox', { name: 'TOC' });
        cef.loadUrl.mockClear();
        fireEvent.change(toc, {
            target: { value: '#Regional Bestiary Notes' },
        });
        expect(cef.loadUrl).not.toHaveBeenCalled(); // same page: an anchor scroll
        expect(
            document.querySelector('#faqwrap a[name="Regional Bestiary Notes"]')
        ).not.toBeNull();
        clickButton(/^Back$/);
        await screen.findByText('Guides');
        // Map image: no page load at all, just the file.
        cef.loadUrl.mockClear();
        clickButton(/Caverns Under Octagonia Part 1 2D Map/);
        await waitFor(() =>
            expect(
                document.querySelector('#faqwrap.neo-image img')
            ).not.toBeNull()
        );
        expect(
            document
                .querySelector('#faqwrap.neo-image img')
                ?.getAttribute('src')
        ).toBe(
            'https://faqs.neoseeker.com/Games/Switch/dragon_quest_xi_s_octagonia_caverns_2d_01.jpg'
        );
        expect(cef.loadUrl).not.toHaveBeenCalled();
        clickButton(/^Back$/);
        await screen.findByText('Guides');
        clickButton(/^Back$/);
        await screen.findByText('Search Results');
        clickButton(/^Back$/);
        // Text FAQ (Chrono Trigger): plain <pre>, links removed.
        await searchGame('chrono trigger');
        clickButton(/^Chrono Trigger$/);
        await screen.findByRole('button', {
            name: /^FAQ\/Walkthrough \(PSX\) - v1.01/,
        });
        clickButton(/^FAQ\/Walkthrough \(PSX\) - v1.01/);
        await waitFor(() =>
            expect(
                document.querySelector('#faqwrap.neo-faq-text')
            ).not.toBeNull()
        );
        const pre = document.querySelector('#faqwrap .faqtext pre')!;
        expect(pre.textContent).toContain('Chrono Trigger');
        expect(pre.querySelector('a')).toBeNull();
    });

    it('extracts the guide list from the real /faqs page', async () => {
        openPanel();
        await openGuideList();
        const guides = screen
            .getAllByRole('button')
            .map((b) => b.textContent ?? '')
            .filter((t) => / - /.test(t));
        expect(guides).toHaveLength(125);
        expect(guides[0]).toBe('FFX FAQ/Walkthrough - v.v1.10 - 05/06/2014');
        expect(
            guides.some((t) =>
                t.startsWith('Guide and Walkthrough - 03/14/2002')
            )
        ).toBe(true);
    });

    it('renders a sanitised guide with a TOC, navigates anchors and pages', async () => {
        openPanel();
        await openGuide();
        const faq = document.querySelector('#faqwrap')!;
        expect(faq.textContent).toContain('Notes on This FAQ');
        // #fixture-unsafe carries an inline style, onclick, <script> and an
        // off-site <img>; DOMPurify + the parser must strip all of them.
        const unsafe = faq.querySelector('#fixture-unsafe');
        expect(unsafe).not.toBeNull();
        expect(unsafe!.textContent).toContain('Fixture-injected unsafe markup');
        expect(faq.querySelector('script')).toBeNull();
        expect(faq.querySelector('[style]')).toBeNull();
        expect(faq.querySelector('[onclick]')).toBeNull();
        expect(faq.querySelector('img[src*="evil.example"]')).toBeNull();
        // Relative image paths are resolved against GameFAQs and load lazily.
        const image = faq.querySelector('img.fimg_large')!;
        expect(image.getAttribute('src')).toBe(
            'https://gamefaqs.gamespot.com/a/faqs/37/69037-4.png'
        );
        expect(image.getAttribute('loading')).toBe('lazy');
        // Tapping it opens the lightbox (no full-size variant on GameFAQs).
        fireEvent.click(image);
        expect(
            document.querySelector('[data-modal] img')?.getAttribute('src')
        ).toBe(image.getAttribute('src'));
        fireEvent.click(
            within(
                document.querySelector('[data-modal]') as HTMLElement
            ).getByText('Close')
        );
        expect(document.querySelector('[data-modal]')).toBeNull();
        expect(document.title).not.toBe('pwned');
        expect(faq.querySelector('.ftoc')).toBeNull(); // TOC block replaced by the dropdown
        // Dark mode class applied from settings.
        expect(document.querySelector('.deckfaqs_dark')).not.toBeNull();

        // TOC dropdown populated (nested entries flattened by the stub).
        const toc = screen.getByRole('combobox', { name: 'TOC' });
        const labels = within(toc)
            .getAllByRole('option')
            .map((o) => o.textContent);
        expect(labels).toContain('Notes on This FAQ');
        expect(labels).toContain('Besaid Island');

        // Same-page anchor: no reload.
        cef.loadUrl.mockClear();
        fireEvent.change(toc, { target: { value: '#section3' } });
        expect(cef.loadUrl).not.toHaveBeenCalled();

        // Anchor on another page: reload of `${guideUrl}/?page=1#section48`.
        fireEvent.change(toc, { target: { value: '?page=1#section48' } });
        await waitFor(() =>
            expect(cef.loadUrl).toHaveBeenCalledWith(
                'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs/69037/?page=1#section48'
            )
        );
        await waitFor(() =>
            expect(document.querySelector('#faqwrap')).not.toBeNull()
        );
    });

    it('registers the fullscreen route; in-guide search highlights matches', async () => {
        openPanel();
        await openGuide();
        const Fullscreen = routes.get('/deckfaqs-fullscreen');
        expect(Fullscreen).toBeDefined();
        const view: RenderResult = render(React.createElement(Fullscreen!));
        const buttons = view.getAllByRole('button').map((b) => b.textContent);
        expect(buttons).toContain('Back to DeckFAQs');
        expect(buttons).toContain('Back to Game');
        // The search button is the one holding an icon only, right after the TOC.
        const search = view
            .getAllByRole('button')
            .find(
                (b) =>
                    b.textContent === '' &&
                    b.previousElementSibling?.tagName === 'DIV'
            );
        expect(search).toBeDefined();
        fireEvent.click(search!);
        const input = await screen.findByLabelText('search');
        fireEvent.change(input, { target: { value: 'Besaid' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() =>
            expect(
                view.container.querySelectorAll('.deckfaqs_highlight').length
            ).toBeGreaterThan(5)
        );
    });

    it('remembers the reading position per guide and restores it on reopen', async () => {
        // jsdom has no layout: fake a 1000px-tall guide in a 200px viewport.
        const fake = (name: 'scrollHeight' | 'clientHeight', value: number) =>
            Object.defineProperty(HTMLElement.prototype, name, {
                configurable: true,
                get: () => value,
            });
        fake('scrollHeight', 1000);
        fake('clientHeight', 200);
        // ...and, like a browser, shift guide content up by the scroll offset.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const realRect = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function (
            this: HTMLElement
        ) {
            const scroller = this.closest('.deckfaqs_guide')?.parentElement;
            const top = scroller ? -scroller.scrollTop : 0;
            return { ...realRect.call(this), top, y: top, bottom: top };
        };
        const guideUrl =
            'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs/69037';
        const scroller = () =>
            document.querySelector('.deckfaqs_guide')!.parentElement!;
        try {
            openPanel();
            await openGuide();
            // Fresh guide (no saved position): stays at the top.
            expect(scroller().scrollTop).toBe(0);
            // Scroll halfway; Back flushes the position to the backend.
            scroller().scrollTop = 400;
            fireEvent.scroll(scroller());
            clickButton(/^Back$/);
            await screen.findByText('Guides');
            expect(backend.get('positions')).toMatchObject({
                [guideUrl]: {
                    page: '',
                    ratio: 0.5,
                    // jsdom has no layout, so every anchor sits at 0 and the
                    // last one wins; 400px past it in a 200px viewport.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    anchor: expect.any(String),
                    offset: 2,
                },
            });
            // Reopen: same guide lands where we left off.
            clickButton(/FFX FAQ\/Walkthrough/);
            await waitFor(() =>
                expect(document.querySelector('#faqwrap')).not.toBeNull()
            );
            await waitFor(() => expect(scroller().scrollTop).toBe(400));
            // The fullscreen view starts at the panel's position too.
            const Fullscreen = routes.get('/deckfaqs-fullscreen');
            const view: RenderResult = render(React.createElement(Fullscreen!));
            const fsScroller =
                view.container.querySelector('.deckfaqs_guide')!.parentElement!;
            await waitFor(() => expect(fsScroller.scrollTop).toBe(400));

            // Navigating to another page (TOC) records that page; reopening
            // fetches it directly and restores the ratio there.
            view.unmount();
            const toc = screen.getByRole('combobox', { name: 'TOC' });
            cef.loadUrl.mockClear();
            fireEvent.change(toc, { target: { value: '?page=1#section48' } });
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(
                    `${guideUrl}/?page=1#section48`
                )
            );
            await waitFor(() =>
                expect(document.querySelector('#faqwrap')).not.toBeNull()
            );
            scroller().scrollTop = 200;
            fireEvent.scroll(scroller());
            clickButton(/^Back$/);
            await screen.findByText('Guides');
            expect(backend.get('positions')).toMatchObject({
                [guideUrl]: { page: '?page=1', ratio: 0.25 },
            });
            // The remembered page was loaded as `?page=1#section48` and comes
            // back from the cache (keys ignore the fragment): no load.
            cef.loadUrl.mockClear();
            clickButton(/FFX FAQ\/Walkthrough/);
            await waitFor(() =>
                expect(document.querySelector('#faqwrap')).not.toBeNull()
            );
            await waitFor(() => expect(scroller().scrollTop).toBe(200));
            expect(cef.loadUrl).not.toHaveBeenCalled();
            // Reload always goes back to the first page, bypasses the cache,
            // and records that.
            const reload = screen
                .getAllByRole('button')
                .filter((b) => b.textContent === '')[1]!;
            cef.loadUrl.mockClear();
            fireEvent.click(reload);
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(guideUrl)
            );
            await waitFor(() =>
                expect(document.querySelector('#faqwrap')).not.toBeNull()
            );
            scroller().scrollTop = 0;
            fireEvent.scroll(scroller());
            clickButton(/^Back$/);
            await screen.findByText('Guides');
            expect(backend.get('positions')).toMatchObject({
                [guideUrl]: { page: '', ratio: 0 },
            });
        } finally {
            HTMLElement.prototype.getBoundingClientRect = realRect;
            delete (HTMLElement.prototype as { scrollHeight?: number })
                .scrollHeight;
            delete (HTMLElement.prototype as { clientHeight?: number })
                .clientHeight;
        }
    });

    it('carries positions over from SteamClient.Storage the first time there is no file', async () => {
        const undoLayout = fakeLayout();
        const guideUrl =
            'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs/69037';
        steam.storage.set('deckfaqs_positions', {
            [guideUrl]: { page: '', ratio: 0.5, ts: 1 },
        });
        try {
            openPanel();
            await openGuide();
            const scroller =
                document.querySelector('.deckfaqs_guide')!.parentElement!;
            await waitFor(() => expect(scroller.scrollTop).toBe(400));
            await waitFor(() =>
                expect(backend.get('positions')).toMatchObject({
                    [guideUrl]: { page: '', ratio: 0.5 },
                })
            );
        } finally {
            undoLayout();
            steam.storage.delete('deckfaqs_positions');
        }
    });

    it('ignores scrolls while the Quick Access Menu is closed and puts the position back when it reopens', async () => {
        const undoLayout = fakeLayout();
        const guideUrl =
            'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs/69037';
        const scroller = () =>
            document.querySelector('.deckfaqs_guide')!.parentElement!;
        try {
            openPanel();
            await openGuide();
            scroller().scrollTop = 400;
            fireEvent.scroll(scroller());
            await waitFor(
                () =>
                    expect(backend.get('positions')).toMatchObject({
                        [guideUrl]: { page: '', ratio: 0.5 },
                    }),
                { timeout: 3000 }
            );
            // Menu closed: the panel stays mounted and Steam may snap the
            // hidden scroller back to the top — that is not the user's doing.
            act(() => qam.set(false));
            scroller().scrollTop = 0;
            fireEvent.scroll(scroller());
            await new Promise((r) => setTimeout(r, 1500));
            expect(backend.get('positions')).toMatchObject({
                [guideUrl]: { page: '', ratio: 0.5 },
            });
            // Reopened: the saved position is restored...
            act(() => qam.set(true));
            await waitFor(() => expect(scroller().scrollTop).toBe(400));
            // ...and scrolling is recorded again.
            scroller().scrollTop = 800;
            fireEvent.scroll(scroller());
            clickButton(/^Back$/);
            await screen.findByText('Guides');
            expect(backend.get('positions')).toMatchObject({
                [guideUrl]: { page: '', ratio: 1 },
            });
        } finally {
            undoLayout();
        }
    }, 15_000);

    it('Back walks guide -> guides -> results -> games and Home jumps to games', async () => {
        openPanel();
        await openGuide();
        clickButton(/^Back$/);
        await screen.findByText('Guides');
        clickButton(/^Back$/);
        await screen.findByText('Search Results');
        clickButton(/^Back$/);
        await screen.findByText('Installed Games');
    });

    it('shows an error with Retry when GameFAQs cannot be reached, and recovers', async () => {
        openPanel();
        await searchGame('final fantasy x');
        const faqsUrl =
            'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs';
        // Make the tab list report no matching tab so the poll loop gives up.
        cef.fetchNoCors.mockImplementationOnce(() =>
            Promise.resolve({ ok: false })
        );
        cef.blackhole.add(faqsUrl);
        clickButton(/^Final Fantasy X$/);
        // Poll loop is 100 x 100 ms; give it time.
        await screen.findByText(
            /Couldn't load GameFAQs/,
            {},
            { timeout: 15000 }
        );
        // Fix the "network" and retry.
        cef.blackhole.delete(faqsUrl);
        clickButton(/^Retry$/);
        await screen.findAllByText(
            /FFX FAQ\/Walkthrough/,
            {},
            { timeout: 15000 }
        );
    }, 40000);

    it('cleans up on dismount', () => {
        act(() => plugin.onDismount());
        expect(cef.destroyed).toHaveBeenCalledWith(steam.browserView);
        expect(deckyApi.routerHook.removeRoute).toHaveBeenCalledWith(
            '/deckfaqs-fullscreen'
        );
    });
});
