/**
 * Fake Steam/Decky environment for running the *built* plugin bundle
 * (dist/index.js) in jsdom. Everything the bundle reaches for from the outside
 * is provided here: React via SP_REACT/SP_JSX/SP_REACTDOM, @decky/ui via DFL,
 * the Decky loader API, and the SteamClient/appStore/collectionStore globals.
 *
 * The interesting part is the fake CEF: LoadURL() records the URL, the
 * remote-debugging endpoint reports it as a tab, and executeInTab() runs the
 * plugin's own extraction script against a saved GameFAQs page in a fresh
 * jsdom window — so the real scrapers run against real markup.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as ReactJsx from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { vi } from 'vitest';

type Fn = (...args: unknown[]) => unknown;
type Props = Record<string, unknown> & { children?: React.ReactNode };

// ---------------------------------------------------------------------------
// Fixtures: host + URL path -> HTML the hidden BrowserView "loads".
// ---------------------------------------------------------------------------
const fixture = (name: string) => readFileSync(`test/fixtures/${name}`, 'utf8');

const searchPayload = JSON.stringify([
    { product_name: 'Final Fantasy X', url: '/ps2/197344-final-fantasy-x' },
    { product_name: 'Final Fantasy X-2', url: '/ps2/919845-final-fantasy-x-2' },
]);

const pages: Record<string, () => string> = {
    'gamefaqs.gamespot.com/ajax/home_game_search': () =>
        `<html><body>${searchPayload}</body></html>`,
    'gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs': () =>
        fixture('faqs-final-fantasy-x.html'),
    'gamefaqs.gamespot.com/ps2/197344-final-fantasy-x/faqs/69037': () =>
        fixture('guide-ffx-69037.html'),
    'www.neoseeker.com/chrono-trigger/faqs': () =>
        fixture('neoseeker/faqs-chrono-trigger.html'),
    'www.neoseeker.com/dragon-quest-xi/faqs': () =>
        fixture('neoseeker/faqs-dragon-quest-xi.html'),
    'www.neoseeker.com/dragon-quest-xi/walkthrough': () =>
        fixture('neoseeker/walkthrough-dragon-quest-xi.html'),
    'www.neoseeker.com/dragon-quest-xi/Coming_of_Age:_The_Prologue': () =>
        fixture('neoseeker/wiki-dqxi-coming-of-age.html'),
    // Redirect target used by the redirect smoke scenario.
    'www.neoseeker.com/dragon-quest-xi/Coming_of_Age': () =>
        fixture('neoseeker/wiki-dqxi-coming-of-age.html'),
    // Next pages reached by the prefetch scenarios.
    'www.neoseeker.com/dragon-quest-xi/Adventures_with_Erik': () =>
        fixture('neoseeker/wiki-dqxi-coming-of-age.html'),
    'www.neoseeker.com/dragon-quest-xi/Fun-Size_Forge': () =>
        fixture('neoseeker/walkthrough-dragon-quest-xi.html'),
    'www.neoseeker.com/dragon-quest-xi/faqs/3043257-bestiary.html': () =>
        fixture('neoseeker/faq-html-dqxi-bestiary.html'),
    'www.neoseeker.com/chrono-trigger/faqs/131223-o.html': () =>
        fixture('neoseeker/faq-text-chrono-trigger.html'),
    // Elden Ring: wiki walkthrough, but no user FAQs, so /faqs/ is a 404.
    'www.neoseeker.com/elden-ring/faqs': () =>
        fixture('neoseeker/not-found.html'),
    'www.neoseeker.com/elden-ring/walkthrough': () =>
        fixture('neoseeker/walkthrough-dragon-quest-xi.html'),
};

// Neoseeker's quick-search: static JSONP on its CDN, fetched with fetchNoCors
// (never through the BrowserView). Keyed by the normalised keyword.
const qsPayloads: Record<string, string> = {
    chrono_trigger:
        'qs({"keywords":"chrono trigger","timestamp":0,"products":[{"id":1,"name":"Chrono Trigger","url":"\\/\\/www.neoseeker.com\\/chrono-trigger\\/"}],"forums":[]});',
    elden_ring:
        'qs({"keywords":"elden ring","timestamp":0,"products":[{"id":76523,"name":"Elden Ring","url":"\\/\\/www.neoseeker.com\\/elden-ring\\/walkthrough","image":null}],"forums":[]});',
    dragon_quest_xi:
        'qs({"keywords":"dragon quest xi","timestamp":0,"products":[{"id":68295,"name":"Dragon Quest XI: Echoes of an Elusive Age","url":"\\/\\/www.neoseeker.com\\/dragon-quest-xi\\/walkthrough","image":null}],"forums":[]});',
};
const qsFor = (kw: string) =>
    qsPayloads[kw] ??
    `qs({"keywords":"${kw}","timestamp":0,"products":[],"forums":[]});`;

// ---------------------------------------------------------------------------
// Fake CEF / hidden BrowserView.
// ---------------------------------------------------------------------------
export const cef = {
    currentUrl: '',
    /** URLs that never finish loading (simulates an offline guide site). */
    blackhole: new Set<string>(),
    /** Hosts whose direct fetches (fetchNoCors) fail (simulates an offline CDN). */
    offline: new Set<string>(),
    /** Neoseeker quick-search keywords requested so far, in order. */
    qsRequests: [] as string[],
    /** Server-side redirects: loading `from` lands the tab on `to`. */
    redirects: new Map<string, string>(),
    loadUrl: vi.fn((url: string) => {
        cef.currentUrl = cef.redirects.get(url) ?? url;
    }),
    executeInTab: vi.fn(),
    fetchNoCors: vi.fn(),
    destroyed: vi.fn(),
    reset() {
        cef.currentUrl = '';
        cef.blackhole.clear();
        cef.offline.clear();
        cef.redirects.clear();
        cef.qsRequests.length = 0;
        cef.loadUrl.mockClear();
        cef.executeInTab.mockClear();
        cef.fetchNoCors.mockClear();
        cef.destroyed.mockClear();
    },
};

const pageFor = (url: string): string | undefined => {
    if (cef.blackhole.has(url)) return undefined;
    let key: string;
    try {
        const u = new URL(url);
        key = u.hostname + u.pathname.replace(/\/$/, '');
    } catch {
        return undefined;
    }
    return pages[key]?.();
};

// CEF reports tab URLs percent-encoded (apostrophes included) — mirror utils.ts.
const cefEncode = (url: string) => {
    const alreadyEncoded = /%[0-9a-f]{2}/i.test(url);
    return (alreadyEncoded ? url : encodeURI(url)).replace(/'/g, '%27');
};

const QS_URL =
    /^https:\/\/cdn\.staticneo\.com\/neoassets\/data\/qs\/[^/]+\/([^/]+)\.json$/;

cef.fetchNoCors.mockImplementation((url: string) => {
    if (url.startsWith('http://localhost:8080/json')) {
        const tabs = cef.currentUrl
            ? [
                  {
                      id: 'deckfaqs-view',
                      url: cefEncode(cef.currentUrl),
                      title: 'DeckFAQs tab',
                  },
              ]
            : [];
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(tabs),
        });
    }
    const qs = QS_URL.exec(url);
    if (qs) {
        const kw = decodeURIComponent(qs[1] ?? '');
        cef.qsRequests.push(kw);
        if (cef.offline.has('cdn.staticneo.com')) {
            return Promise.reject(new Error('offline'));
        }
        return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(qsFor(kw)),
        });
    }
    return Promise.resolve({ ok: false, status: 404 });
});

cef.executeInTab.mockImplementation(
    (_title: string, _async: boolean, code: string) => {
        const html = pageFor(cef.currentUrl);
        if (html === undefined) {
            // Tab exists but the page is not there (yet): script yields nothing.
            return Promise.resolve({ success: true, result: undefined });
        }
        const dom = new JSDOM(html, {
            runScripts: 'outside-only',
            url: cef.currentUrl,
        });
        try {
            const result: unknown = dom.window.eval(code);
            return Promise.resolve({ success: true, result });
        } catch (e) {
            return Promise.resolve({ success: false, result: String(e) });
        } finally {
            dom.window.close();
        }
    }
);

// ---------------------------------------------------------------------------
// Decky loader API (what @decky/api's connect() returns).
// ---------------------------------------------------------------------------
export const routes = new Map<string, React.ComponentType>();
export const deckyApi = {
    _version: 2,
    executeInTab: cef.executeInTab,
    fetchNoCors: cef.fetchNoCors,
    routerHook: {
        addRoute: vi.fn((path: string, component: React.ComponentType) => {
            routes.set(path, component);
        }),
        removeRoute: vi.fn((path: string) => {
            routes.delete(path);
        }),
    },
    call: vi.fn(),
    callable: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    toaster: { toast: vi.fn() },
    openFilePicker: vi.fn(),
    injectCssIntoTab: vi.fn(),
    removeCssFromTab: vi.fn(),
    getExternalResourceURL: vi.fn(),
    useQuickAccessVisible: () =>
        React.useSyncExternalStore(
            (cb) => {
                qamSubs.add(cb);
                return () => qamSubs.delete(cb);
            },
            () => qamVisible
        ),
};

// QAM visibility, toggled by tests via steam.setQamVisible.
let qamVisible = true;
const qamSubs = new Set<() => void>();

// ---------------------------------------------------------------------------
// @decky/ui stubs (global DFL). Minimal DOM equivalents that keep the props the
// plugin relies on (DOM event handlers/children/ref/className/style; the
// gamepad-only props such as onOKButton are dropped, as they have no DOM
// equivalent).
// ---------------------------------------------------------------------------
const DOM_HANDLER = /^on(Click|Pointer|Wheel|Scroll|Key|Touch|Mouse)/;
const passthrough =
    (tag: 'div' | 'span' | 'button') =>
    ({ children, className, style, ref, ...rest }: Props) =>
        React.createElement(
            tag,
            {
                className: className as string | undefined,
                style: style as React.CSSProperties | undefined,
                ref: ref as React.Ref<HTMLElement> | undefined,
                ...Object.fromEntries(
                    Object.entries(rest).filter(([k]) => DOM_HANDLER.test(k))
                ),
            },
            children
        );

const Button = ({ children, onClick, style, className }: Props) =>
    React.createElement(
        'button',
        {
            type: 'button',
            onClick: onClick as React.MouseEventHandler | undefined,
            style: style as React.CSSProperties | undefined,
            className: className as string | undefined,
        },
        children
    );

type Option = { data?: unknown; label?: React.ReactNode; options?: Option[] };
const flattenOptions = (opts: Option[]): Option[] =>
    opts.flatMap((o) => (o.options ? flattenOptions(o.options) : [o]));

const Dropdown = ({
    rgOptions,
    selectedOption,
    onChange,
    menuLabel,
    strDefaultLabel,
}: Props) => {
    const flat = flattenOptions((rgOptions as Option[]) ?? []);
    return React.createElement(
        'select',
        {
            'aria-label': (menuLabel ?? strDefaultLabel ?? 'TOC') as string,
            value: (selectedOption as string | undefined) ?? '',
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                const picked = flat.find(
                    (o) => String(o.data) === e.target.value
                );
                if (picked) (onChange as Fn)(picked);
            },
        },
        [
            React.createElement('option', { key: '', value: '' }, 'TOC'),
            ...flat.map((o) =>
                React.createElement(
                    'option',
                    { key: String(o.data), value: String(o.data) },
                    o.label
                )
            ),
        ]
    );
};

/** DropdownItem = a labelled Dropdown; label doubles as the accessible name. */
const DropdownItem = ({ rgOptions, selectedOption, onChange, label }: Props) =>
    React.createElement(
        'select',
        {
            'aria-label': label as string,
            value: (selectedOption as string | undefined) ?? '',
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                const picked = ((rgOptions as Option[]) ?? []).find(
                    (o) => String(o.data) === e.target.value
                );
                if (picked) (onChange as Fn)(picked);
            },
        },
        ((rgOptions as Option[]) ?? []).map((o) =>
            React.createElement(
                'option',
                { key: String(o.data), value: String(o.data) },
                o.label
            )
        )
    );

const ToggleField = ({ label, checked, onChange }: Props) =>
    React.createElement(
        'label',
        null,
        React.createElement('input', {
            type: 'checkbox',
            checked: Boolean(checked),
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                (onChange as Fn)(e.target.checked),
        }),
        label as React.ReactNode
    );

const TextField = ({ value, onChange, onKeyDown, placeholder }: Props) =>
    React.createElement('input', {
        type: 'text',
        'aria-label': 'search',
        value: value as string,
        placeholder: placeholder as string | undefined,
        onChange: onChange as React.ChangeEventHandler | undefined,
        onKeyDown: onKeyDown as React.KeyboardEventHandler | undefined,
    });

/** Renders a modal into document.body and wires closeModal like Steam does. */
const showModal = (modal: React.ReactElement, _parent?: unknown) => {
    const host = document.createElement('div');
    host.setAttribute('data-modal', '');
    document.body.appendChild(host);
    const root = createRoot(host);
    const closeModal = () => {
        act(() => root.unmount());
        host.remove();
    };
    act(() => {
        root.render(
            React.cloneElement(modal as React.ReactElement<Props>, {
                closeModal,
            })
        );
    });
    return { Close: closeModal };
};

export const steam = {
    browserView: { LoadURL: cef.loadUrl },
    storage: new Map<string, unknown>([
        ['deckfaqs_settings', { darkMode: true }],
    ]),
    runningApp: { display_name: 'Final Fantasy X' } as
        { display_name: string } | undefined,
    // The latest RegisterForControllerAnalogInputMessages callback (trackpad
    // scroll), the count of live registrations (a leaked one means the guide
    // scrolls N× too fast), and the EnableControllerAnalogInputMessages call
    // log in order (last entry = current state).
    controllerCb: undefined as
        | ((a: number, b: number, c: boolean, x: number, y: number) => void)
        | undefined,
    analogRegistrations: 0,
    analogCalls: [] as boolean[],
    setQamVisible(visible: boolean) {
        qamVisible = visible;
        qamSubs.forEach((cb) => cb());
    },
};

const Router = {
    get MainRunningApp() {
        return steam.runningApp;
    },
    NavigateToRunningApp: vi.fn(),
    WindowStore: {
        GamepadUIMainWindowInstance: {
            CreateBrowserView: vi.fn(() => steam.browserView),
        },
    },
};

export const Navigation = {
    Navigate: vi.fn(),
    NavigateBack: vi.fn(),
    CloseSideMenus: vi.fn(),
    OpenQuickAccessMenu: vi.fn(),
};

const DFL = {
    DialogButton: Button,
    ButtonItem: Button,
    PanelSection: passthrough('div'),
    PanelSectionRow: passthrough('div'),
    Focusable: passthrough('div'),
    ScrollPanel: passthrough('div'),
    ModalRoot: passthrough('div'),
    DialogBody: passthrough('div'),
    DialogFooter: passthrough('div'),
    Dropdown,
    DropdownItem,
    ToggleField,
    TextField,
    showModal,
    findSP: () => window,
    Router,
    Navigation,
    QuickAccessTab: { Decky: 999 },
    // Same values as @decky/ui's enum (the lightbox maps buttons at load time).
    GamepadButton: {
        OK: 1,
        CANCEL: 2,
        BUMPER_LEFT: 5,
        BUMPER_RIGHT: 6,
        TRIGGER_LEFT: 7,
        TRIGGER_RIGHT: 8,
        DIR_UP: 9,
        DIR_DOWN: 10,
        DIR_LEFT: 11,
        DIR_RIGHT: 12,
    },
    staticClasses: { Title: 'Title' },
};

// ---------------------------------------------------------------------------
// Steam globals used by App.tsx.
// ---------------------------------------------------------------------------
const SteamClient = {
    InstallFolder: {
        GetInstallFolders: () =>
            Promise.resolve([
                {
                    vecApps: [
                        {
                            nAppID: 1,
                            strAppName: 'Final Fantasy X',
                            strSortAs: 'final fantasy x',
                        },
                        {
                            nAppID: 228980, // Steamworks redistributables — ignored
                            strAppName: 'Steamworks Common Redistributables',
                            strSortAs: 'steamworks',
                        },
                    ],
                },
            ]),
    },
    Storage: {
        GetJSON: (key: string) =>
            steam.storage.has(key)
                ? Promise.resolve(JSON.stringify(steam.storage.get(key)))
                : Promise.reject(new Error('missing')),
        SetObject: vi.fn((key: string, value: unknown) => {
            steam.storage.set(key, value);
            return Promise.resolve();
        }),
    },
    GameSessions: {
        RegisterForAppLifetimeNotifications: () => ({ unregister: vi.fn() }),
    },
    Apps: {
        RegisterForGameActionStart: () => ({ unregister: vi.fn() }),
    },
    Input: {
        EnableControllerAnalogInputMessages: (enable: boolean) => {
            steam.analogCalls.push(enable);
        },
        RegisterForControllerAnalogInputMessages: (
            cb: NonNullable<typeof steam.controllerCb>
        ) => {
            steam.analogRegistrations++;
            steam.controllerCb = cb;
            let live = true;
            return {
                unregister: vi.fn(() => {
                    if (!live) return;
                    live = false;
                    steam.analogRegistrations--;
                    if (steam.controllerCb === cb)
                        steam.controllerCb = undefined;
                }),
            };
        },
    },
    BrowserView: {
        Destroy: cef.destroyed,
    },
};

const collectionStore = {
    deckDesktopApps: {
        allApps: [
            {
                appid: 100,
                display_name: 'Chrono Trigger',
                sort_as: 'chrono trigger',
            },
            { appid: 101, display_name: 'RetroArch', sort_as: 'retroarch' }, // ignored
        ],
    },
};

const appStore = {
    GetAppOverviewByGameID: (appid: number) => ({
        appid: String(appid),
        display_name: 'Final Fantasy X',
    }),
};

// ---------------------------------------------------------------------------
// Install everything on the global object. Must run before dist/index.js is
// imported (@decky/api connects to the loader at module-evaluation time).
// ---------------------------------------------------------------------------
const installEnvironment = () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.SP_REACT = React;
    g.SP_JSX = ReactJsx;
    g.SP_REACTDOM = ReactDOM;
    g.DFL = DFL;
    g.SteamClient = SteamClient;
    g.collectionStore = collectionStore;
    g.appStore = appStore;
    g.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit =
        { connect: () => deckyApi };
    // Background prefetch of the next page: keep it out of the way unless a
    // scenario lowers the delay explicitly.
    g.__deckfaqsPrefetchDelayMs = 60_000;
    // jsdom gaps used by the plugin.
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = () => {};
    }
    if (!Element.prototype.scrollTo) {
        Element.prototype.scrollTo = () => {};
    }
    if (typeof CSS === 'undefined' || !CSS.escape) {
        g.CSS = {
            escape: (s: string) =>
                s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
        };
    }
};

/**
 * Loads the built bundle (dist/index.js) and returns its definePlugin result.
 * Call after `vi.resetModules()` to get a bundle with fresh module state
 * (page cache, positions cache).
 */
export const loadPlugin = async () => {
    installEnvironment();
    // @ts-expect-error -- the built bundle has no type declarations (and may not exist before `pnpm build`).
    const mod = (await import('../../dist/index.js')) as {
        default: () => {
            name: string;
            content: React.ReactElement;
            onDismount: () => void;
        };
    };
    return mod.default();
};
