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
// Fixtures: URL path -> HTML the hidden BrowserView "loads".
// ---------------------------------------------------------------------------
const fixture = (name: string) => readFileSync(`test/fixtures/${name}`, 'utf8');

const searchPayload = JSON.stringify([
    { product_name: 'Final Fantasy X', url: '/ps2/197344-final-fantasy-x' },
    { product_name: 'Final Fantasy X-2', url: '/ps2/919845-final-fantasy-x-2' },
]);

const pages: Record<string, () => string> = {
    '/ajax/home_game_search': () =>
        `<html><body>${searchPayload}</body></html>`,
    '/ps2/197344-final-fantasy-x/faqs': () =>
        fixture('faqs-final-fantasy-x.html'),
    '/ps2/197344-final-fantasy-x/faqs/69037': () =>
        fixture('guide-ffx-69037.html'),
};

// ---------------------------------------------------------------------------
// Fake CEF / hidden BrowserView.
// ---------------------------------------------------------------------------
export const cef = {
    currentUrl: '',
    /** URLs that never finish loading (simulates an offline GameFAQs). */
    blackhole: new Set<string>(),
    loadUrl: vi.fn((url: string) => {
        cef.currentUrl = url;
    }),
    executeInTab: vi.fn(),
    fetchNoCors: vi.fn(),
    destroyed: vi.fn(),
    reset() {
        cef.currentUrl = '';
        cef.blackhole.clear();
        cef.loadUrl.mockClear();
        cef.executeInTab.mockClear();
        cef.fetchNoCors.mockClear();
        cef.destroyed.mockClear();
    },
};

const pageFor = (url: string): string | undefined => {
    if (cef.blackhole.has(url)) return undefined;
    let path: string;
    try {
        path = new URL(url).pathname.replace(/\/$/, '');
    } catch {
        return undefined;
    }
    return pages[path]?.();
};

// CEF reports tab URLs percent-encoded (apostrophes included) — mirror utils.ts.
const cefEncode = (url: string) => {
    const alreadyEncoded = /%[0-9a-f]{2}/i.test(url);
    return (alreadyEncoded ? url : encodeURI(url)).replace(/'/g, '%27');
};

cef.fetchNoCors.mockImplementation((url: string) => {
    if (!url.startsWith('http://localhost:8080/json')) {
        return Promise.resolve({ ok: false });
    }
    const tabs = cef.currentUrl
        ? [{ url: cefEncode(cef.currentUrl), title: 'DeckFAQs tab' }]
        : [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(tabs) });
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
    useQuickAccessVisible: () => true,
};

// ---------------------------------------------------------------------------
// @decky/ui stubs (global DFL). Minimal DOM equivalents that keep the props the
// plugin relies on (onClick/onChange/children/ref/className/style).
// ---------------------------------------------------------------------------
const passthrough =
    (tag: 'div' | 'span' | 'button') =>
    ({ children, className, style, onClick, ref }: Props) =>
        React.createElement(
            tag,
            {
                className: className as string | undefined,
                style: style as React.CSSProperties | undefined,
                onClick: onClick as React.MouseEventHandler | undefined,
                ref: ref as React.Ref<HTMLElement> | undefined,
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

const Dropdown = ({ rgOptions, selectedOption, onChange }: Props) => {
    const flat = flattenOptions((rgOptions as Option[]) ?? []);
    return React.createElement(
        'select',
        {
            'aria-label': 'TOC',
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

const Navigation = {
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
    ToggleField,
    TextField,
    showModal,
    findSP: () => window,
    Router,
    Navigation,
    QuickAccessTab: { Decky: 999 },
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

/** Loads the built bundle (dist/index.js) and returns its definePlugin result. */
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
