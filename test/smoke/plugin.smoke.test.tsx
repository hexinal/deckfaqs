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
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cef, deckyApi, loadPlugin, routes, steam } from './env';

type Plugin = Awaited<ReturnType<typeof loadPlugin>>;
let plugin: Plugin;

beforeAll(async () => {
    plugin = await loadPlugin();
});
afterEach(() => {
    cleanup();
    document.querySelectorAll('[data-modal]').forEach((el) => el.remove());
    cef.reset();
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
        });
        fireEvent.click(toggle);
        expect(steam.storage.get('deckfaqs_settings')).toEqual({
            darkMode: true,
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
        const guideUrl =
            'https://gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs/69037';
        const scroller = () =>
            document.querySelector('.deckfaqs_guide')!.parentElement!;
        try {
            openPanel();
            await openGuide();
            // Fresh guide (no saved position): stays at the top.
            expect(scroller().scrollTop).toBe(0);
            // Scroll halfway; Back flushes the position to storage.
            scroller().scrollTop = 400;
            fireEvent.scroll(scroller());
            clickButton(/^Back$/);
            await screen.findByText('Guides');
            expect(steam.storage.get('deckfaqs_positions')).toMatchObject({
                [guideUrl]: { page: '', ratio: 0.5 },
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
            expect(steam.storage.get('deckfaqs_positions')).toMatchObject({
                [guideUrl]: { page: '?page=1', ratio: 0.25 },
            });
            cef.loadUrl.mockClear();
            clickButton(/FFX FAQ\/Walkthrough/);
            await waitFor(() =>
                expect(cef.loadUrl).toHaveBeenCalledWith(`${guideUrl}/?page=1`)
            );
            await waitFor(() =>
                expect(document.querySelector('#faqwrap')).not.toBeNull()
            );
            await waitFor(() => expect(scroller().scrollTop).toBe(200));
            // Reload always goes back to the first page and records that.
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
            expect(steam.storage.get('deckfaqs_positions')).toMatchObject({
                [guideUrl]: { page: '', ratio: 0 },
            });
        } finally {
            delete (HTMLElement.prototype as { scrollHeight?: number })
                .scrollHeight;
            delete (HTMLElement.prototype as { clientHeight?: number })
                .clientHeight;
        }
    });

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
