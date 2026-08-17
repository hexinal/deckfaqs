import {
    DialogButton,
    Focusable,
    Navigation,
    QuickAccessTab,
    Router,
} from '@decky/ui';
import { routerHook } from '@decky/api';
import {
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
} from 'react';
import {
    AppContext,
    AppContextProvider,
    type GuideContents,
} from '../../context/AppContext';
import parse, {
    type HTMLReactParserOptions,
    Element,
    domToReact,
    type DOMNode,
} from 'html-react-parser';
import { ActionType } from '../../reducers/AppReducer';
import { getGuideHtml, request } from '../../utils';
import {
    imageOrigins,
    pageOf,
    pageUrl,
    sourceOf,
    tocSectionFor,
} from '../../sources/source';
import {
    type AnchorTop,
    getPosition,
    pickAnchor,
    restoreTarget,
    savePosition,
} from '../../positions';
import { TocDropdown } from '../Nav/TocDropdown';
import { Search } from '../Nav/Search';
import { ScrollPanel } from '../ScrollPanel';
import { ErrorMessage } from '../ErrorMessage';
import Mark from './mark';

type GuideProps = {
    fullscreen?: boolean;
};

export const Guide = ({ fullscreen }: GuideProps) => {
    const { state, dispatch, browserView } = useContext(AppContext);
    const { currentGuide, search, isLoading, error } = state;
    const guideDiv = useRef<HTMLDivElement>(null);
    const stateRef = useRef(state);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // Parsing a guide is the expensive part (single-page FAQs run to megabytes),
    // so `options` must stay stable across anchor jumps, TOC changes and
    // restores: handlers read the live guide through stateRef, and only the
    // guide's URL (which decides the site rules) is a dependency.
    const guideUrl = currentGuide?.guideUrl;
    const options: HTMLReactParserOptions = useMemo(
        () => ({
            replace: (domNode) => {
                if (
                    domNode instanceof Element &&
                    domNode.attribs &&
                    domNode.attribs.style
                ) {
                    delete domNode.attribs.style;
                }
                if (
                    domNode instanceof Element &&
                    domNode.name === 'a' &&
                    domNode.attribs &&
                    domNode.attribs.href
                ) {
                    const children = domNode.children;
                    // html-react-parser hands over raw attributes: keep the guide's own
                    // class (e.g. Neoseeker's prev/next links) next to ours.
                    const { class: linkClass, ...linkAttribs } =
                        domNode.attribs;
                    const className = linkClass
                        ? `deckfaqs-link ${linkClass}`
                        : 'deckfaqs-link';
                    let anchor = '';
                    if (domNode.attribs.href.startsWith('#')) {
                        anchor = domNode.attribs.href.substring(1);
                        return (
                            <a
                                {...linkAttribs}
                                className={className}
                                onClick={(e) => {
                                    e.preventDefault();
                                    dispatch({
                                        type: ActionType.UPDATE_GUIDE,
                                        payload: {
                                            ...stateRef.current.currentGuide,
                                            anchor,
                                            restore: undefined,
                                        },
                                    });
                                }}
                            >
                                {domToReact(children as DOMNode[], options)}
                            </a>
                        );
                    } else {
                        anchor = domNode.attribs.href;
                        return (
                            <a
                                {...linkAttribs}
                                className={className}
                                onClick={(e) => {
                                    e.preventDefault();
                                    const guide = stateRef.current.currentGuide;
                                    const baseUrl = guide?.guideUrl ?? '';
                                    request(
                                        { browserView, dispatch },
                                        (ctx) => {
                                            dispatch({
                                                type: ActionType.UPDATE_LOADING,
                                                payload: true,
                                            });
                                            return getGuideHtml(
                                                pageUrl(baseUrl, anchor),
                                                ctx
                                            );
                                        },
                                        ({ html }) => {
                                            const target = pageOf(
                                                baseUrl,
                                                anchor
                                            );
                                            dispatch({
                                                type: ActionType.UPDATE_GUIDE,
                                                payload: {
                                                    ...guide,
                                                    guideHtml: html,
                                                    anchor: target.anchor,
                                                    page: target.page,
                                                    // Keep the TOC dropdown on the page we landed on.
                                                    currentTocSection:
                                                        tocSectionFor(
                                                            guide?.guideToc,
                                                            baseUrl,
                                                            target.page
                                                        ) ??
                                                        guide?.currentTocSection,
                                                    restore: undefined,
                                                },
                                            });
                                        }
                                    );
                                }}
                            >
                                {domToReact(children as DOMNode[], options)}
                            </a>
                        );
                    }
                } else if (
                    domNode instanceof Element &&
                    domNode.name === 'div' &&
                    domNode.attribs &&
                    domNode.attribs.class === 'ftoc'
                ) {
                    return <span></span>;
                } else if (
                    domNode instanceof Element &&
                    domNode.name === 'img' &&
                    domNode.attribs &&
                    domNode.attribs.src
                ) {
                    // Resolve relative image paths against the guide's site; drop
                    // anything outside that source's image hosts.
                    const allowed = imageOrigins(sourceOf(guideUrl ?? ''));
                    let src: string;
                    try {
                        src = new URL(domNode.attribs.src, allowed[0]).href;
                    } catch {
                        return <></>;
                    }
                    if (!allowed.some((origin) => src.startsWith(`${origin}/`)))
                        return <></>;
                    const { class: className, ...attribs } = domNode.attribs;
                    return <img {...attribs} className={className} src={src} />;
                }
                return domNode;
            },
        }),
        [guideUrl, browserView, dispatch]
    );

    // The parsed guide: recomputed only when the HTML (or the site rules) change.
    const guideHtml = currentGuide?.guideHtml ?? '';
    const content = useMemo(
        () => parse(guideHtml, options),
        [guideHtml, options]
    );

    const handleDismiss = useCallback(
        (updatedGuide: GuideContents) => {
            // Re-apply the position the fullscreen view left off at.
            const pos = updatedGuide.guideUrl
                ? getPosition(updatedGuide.guideUrl)
                : undefined;
            dispatch({
                type: ActionType.UPDATE_GUIDE,
                payload: {
                    ...updatedGuide,
                    restore:
                        pos && pos.page === (updatedGuide.page ?? '')
                            ? pos
                            : undefined,
                },
            });
        },
        [dispatch]
    );

    // The element that actually scrolls: Steam's ScrollPanel wrapping guideDiv.
    const getScrollElement = useCallback((): HTMLElement | null => {
        let el = guideDiv.current?.parentElement ?? null;
        while (el) {
            const overflow = getComputedStyle(el).overflowY;
            if (overflow === 'auto' || overflow === 'scroll') return el;
            el = el.parentElement;
        }
        return guideDiv.current?.parentElement ?? null;
    }, []);

    // Every `[name]`/`[id]` in the guide with its top in scroll-container
    // coordinates, sorted — the candidates for anchor-based positions.
    const getAnchorTops = useCallback((el: HTMLElement): AnchorTop[] => {
        const root = guideDiv.current;
        if (!root) return [];
        const base = el.getBoundingClientRect().top - el.scrollTop;
        const out: AnchorTop[] = [];
        for (const node of root.querySelectorAll('[name], [id]')) {
            const name = node.getAttribute('name') || node.getAttribute('id');
            if (!name) continue;
            out.push({ name, top: node.getBoundingClientRect().top - base });
        }
        return out.sort((a, b) => a.top - b.top);
    }, []);

    // Reads the guide through stateRef so the callback identity stays stable
    // and the anchor effect below only re-runs when anchor/html change.
    const scrollToAnchor = useCallback(
        (anchor: string = '') => {
            if (anchor.length > 0) {
                // Anchors come from guide markup; escape so odd characters can't
                // break the selector and throw. Like a browser, try the
                // percent-decoded form first (wiki links encode UTF-8 fragments).
                const candidates = [anchor];
                try {
                    const decoded = decodeURIComponent(anchor);
                    if (decoded !== anchor) candidates.unshift(decoded);
                } catch {
                    // not percent-encoded
                }
                let elementToScrollTo: globalThis.Element | null = null;
                for (const candidate of candidates) {
                    const escaped = CSS.escape(candidate);
                    elementToScrollTo =
                        guideDiv.current?.querySelector(
                            `[name="${escaped}"]`
                        ) ??
                        guideDiv.current?.querySelector(`[id="${escaped}"]`) ??
                        null;
                    if (elementToScrollTo) break;
                }
                const guide = stateRef.current.currentGuide;
                if (elementToScrollTo) {
                    elementToScrollTo.scrollIntoView();
                } else if (
                    guide?.page &&
                    sourceOf(guide.guideUrl ?? '') === 'gamefaqs'
                ) {
                    // GameFAQs only: a bare #anchor may live on the guide's first
                    // page. Wiki fragments are page-local, so a miss stays put.
                    const baseUrl = guide.guideUrl ?? '';
                    request(
                        { browserView, dispatch },
                        (ctx) =>
                            getGuideHtml(pageUrl(baseUrl, `#${anchor}`), ctx),
                        ({ html }) => {
                            dispatch({
                                type: ActionType.UPDATE_GUIDE,
                                payload: {
                                    ...guide,
                                    guideHtml: html,
                                    anchor,
                                    page: '',
                                    restore: undefined,
                                },
                            });
                        }
                    );
                }
            } else {
                guideDiv.current?.querySelector('#faqwrap')?.scrollIntoView();
            }
        },
        [browserView, dispatch]
    );

    useEffect(() => {
        scrollToAnchor(currentGuide?.anchor);
    }, [currentGuide?.anchor, currentGuide?.guideHtml, scrollToAnchor]);

    useEffect(() => {
        if (guideDiv.current) {
            const searchText = search.searchText;
            const mark = new Mark(guideDiv.current?.querySelector('#faqwrap'));
            if (searchText) {
                mark.unmark({
                    done: () => {
                        mark.mark(searchText, {
                            className: 'deckfaqs_highlight',
                            separateWordSearch: false,
                            acrossElements: true,
                            done: (numMatches: number) => {
                                dispatch({
                                    type: ActionType.UPDATE_SEARCH,
                                    payload: {
                                        ...stateRef.current.search,
                                        anchorIndex: 0,
                                        searchAnchorLength: numMatches,
                                    },
                                });
                            },
                        });
                    },
                });
            }
        }
    }, [search.searchText, dispatch]);

    useEffect(() => {
        const elements = guideDiv.current?.querySelectorAll(
            '[class="deckfaqs_highlight"]'
        );
        if (
            elements &&
            search.anchorIndex >= 0 &&
            elements.length > search.anchorIndex
        ) {
            elements[search.anchorIndex]?.scrollIntoView();
        }
    }, [search.anchorIndex]);

    useEffect(() => {
        if (!fullscreen) {
            routerHook.addRoute('/deckfaqs-fullscreen', () => {
                return (
                    <AppContextProvider
                        incomingState={stateRef.current}
                        browserView={browserView}
                    >
                        <FullScreenGuide onDismiss={handleDismiss} />
                    </AppContextProvider>
                );
            });
        }
        scrollToAnchor(currentGuide?.anchor);
        return function cleanup() {
            if (!fullscreen) routerHook.removeRoute('/deckfaqs-fullscreen');
        };
        // Mount-only: register the fullscreen route once and scroll to the
        // initial anchor; later anchor changes are handled by the effect above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Remember the reading position (per guide + page) as the user scrolls,
    // and flush the last known one when this view goes away (Back, fullscreen
    // dismiss, plugin unload). Layout effect: its cleanup runs while the
    // element is still in the document, so the final measurement is real.
    const page = currentGuide?.page ?? '';
    useLayoutEffect(() => {
        const el = getScrollElement();
        if (!el || !guideUrl || isLoading || error) return;
        let last: number | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Anchor lookup walks the whole guide, so do it at most every 250ms.
        const record = (immediate: boolean) => {
            timer = undefined;
            const range = el.scrollHeight - el.clientHeight;
            if (range <= 0) return;
            last = Math.min(1, Math.max(0, el.scrollTop / range));
            savePosition(
                guideUrl,
                {
                    page,
                    ratio: last,
                    ...pickAnchor(
                        getAnchorTops(el),
                        el.scrollTop,
                        el.clientHeight
                    ),
                },
                immediate
            );
        };
        const onScroll = () => {
            if (!timer) timer = setTimeout(() => record(false), 250);
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            el.removeEventListener('scroll', onScroll);
            if (timer) clearTimeout(timer);
            if (el.isConnected) {
                if (timer || last !== undefined) record(true);
            } else if (last !== undefined) {
                // Detached elements measure as 0: just flush the last ratio.
                savePosition(guideUrl, { page, ratio: last }, true);
            }
        };
    }, [guideUrl, page, isLoading, error, getScrollElement, getAnchorTops]);

    // Restore a saved position: `restore` is set when the guide is opened
    // from the list (or handed back from fullscreen); on first mount fall back
    // to the in-memory cache so fullscreen starts where the panel was. Anchors
    // win — they mean the user asked for a specific section.
    const restoredFor = useRef<GuideContents | undefined>(undefined);
    useEffect(() => {
        if (!currentGuide || currentGuide === restoredFor.current) return;
        const first = restoredFor.current === undefined;
        restoredFor.current = currentGuide;
        let position = currentGuide.restore;
        if (position === undefined && first && currentGuide.guideUrl) {
            const pos = getPosition(currentGuide.guideUrl);
            if (pos && pos.page === (currentGuide.page ?? '')) position = pos;
        }
        if (position === undefined || currentGuide.anchor) return;
        const el = getScrollElement();
        if (!el) return;
        const target = position;
        const apply = () => {
            el.scrollTop = restoreTarget(
                target,
                getAnchorTops(el),
                el.scrollHeight,
                el.clientHeight
            );
        };
        apply();
        // Once more after layout settles (fonts/images can change the height).
        const raf = requestAnimationFrame(apply);
        return () => cancelAnimationFrame(raf);
    }, [currentGuide, getScrollElement, getAnchorTops]);
    return useMemo(
        () =>
            error ? (
                <ErrorMessage />
            ) : isLoading ? (
                <div className="lds-ring">
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                </div>
            ) : (
                <>
                    <style>
                        {`
                      @keyframes deckfaqs_outline_grow {
                        0% {
                          outline: 12px solid;
                        }
                        100% {
                          outline: 2px solid;
                        }
                      }
                      @keyframes deckfaqs_outline_fade {
                        0% {
                          outline-color: rgba(255, 255, 255, 0);
                        }
                        100% {
                          outline-color: rgba(255, 255, 255, 0.6);
                        }
                      }
                      @keyframes deckfaqs_blinker {
                        50% {
                          outline-color: rgba(255, 255, 255, 0.0);
                        }
                      }
                      .deckfaqs_highlight {
                        background-color: #FFFF00;
                      }
                      .deckfaqs_scrollpanel:focus {
                        outline: 2px solid rgba(255, 255, 255, 0.6);
                        outline-offset: 2px;
                        animation: deckfaqs_outline_grow 0.4s ease, deckfaqs_outline_fade 0.4s ease, deckfaqs_blinker 1.2s ease-in-out 0.4s 20;
                      }
                      .deckfaqs_dark {
                        filter: invert(1)
                      }
                      .deckfaqs_dark img:not(.ignore-color-scheme),video:not(.ignore-color-scheme) {
                        filter: brightness(50%) invert(100%);
                      }
                      .deckfaqs_dark .deckfaqs_highlight {
                        filter: invert(1)
                      }
                      .ffaq {
                        font-size: 14px;
                        word-wrap: break-word;
                        color: #000;
                      }
                      .ffaq p {
                        line-height: 20px;
                      }
                      .deckfaqs-link {
                        color: blue !important;
                      }
                      .ffaq div.section_box,
                      .ffaq div.spoiler_box,
                      .ffaq blockquote {
                        background-color: #999;
                        border-style: solid;
                        border-width: 1px;
                        clear: left;
                        color: #0d0d0d;
                        display: table;
                        margin: 15px 15px 18px 0;
                        overflow: hidden;
                        padding: 5px;
                        width: 66%;
                      }
                      .deckfaqs_guide_compact .ffaq div.section_box,
                      .deckfaqs_guide_compact .ffaq div.spoiler_box,
                      .deckfaqs_guide_compact .ffaq blockquote {
                        overflow: auto;
                      }
                      .deckfaqs_guide_compact .ffaq div.section_box,
                      .deckfaqs_guide_compact .ffaq div.spoiler_box,
                      .deckfaqs_guide_compact .ffaq blockquote {
                        display: block;
                        overflow-x: scroll;
                        width: auto;
                      }
                      .ffaq div.section_box p:last-child,
                      .ffaq div.section_box ul:last-child,
                      .ffaq div.section_box ol:last-child,
                      .ffaq div.section_box dl:last-child,
                      .ffaq div.spoiler_box p:last-child,
                      .ffaq div.spoiler_box ul:last-child,
                      .ffaq div.spoiler_box ol:last-child,
                      .ffaq div.spoiler_box dl:last-child,
                      .ffaq blockquote p:last-child,
                      .ffaq blockquote ul:last-child,
                      .ffaq blockquote ol:last-child,
                      .ffaq blockquote dl:last-child {
                        margin-bottom: 0;
                      }
                      .ffaq div.spoiler_box,
                      .ffaq i[data-spoiler="inline"],
                      .ffaq .fspoiler,
                      .ffaq .fspoiler a {
                        background-color: #bbb;
                        border-color: #d9d9d9;
                        color: #bbb;
                      }
                      .ffaq i[data-spoiler="inline"] {
                        font-style: normal;
                      }
                      .ffaq i[data-spoiler="inline"] h6 {
                        color: #b31a1a;
                      }
                      .ffaq i[data-underline="inline"] {
                        font-style: normal;
                        text-decoration: underline;
                      }
                      .ffaq hr,
                      .ffaq pre {
                        margin-bottom: 18px;
                      }
                      .ffaq table {
                        border: 1px solid #000;
                        margin-bottom: 18px;
                        margin-right: 5px;
                        table-layout: fixed;
                        width: auto;
                      }
                      .ffaq table {
                        clear: both;
                      }
                      .deckfaqs_guide_compact .ffaq table {
                        width: 100% !important;
                      }
                      .deckfaqs_guide_compact .ffaq table {
                        display: inline-table;
                        overflow-x: scroll;
                      }
                      .ffaq table tr:nth-child(2n + 1),
                      .ffaq table tr:nth-child(2n + 1) td {
                        background-color: #d3d3d3;
                      }
                      .ffaq table td,
                      .ffaq table th {
                        background-color: #d3d3d3;
                        border: 1px solid #000;
                        color: #0d0d0d;
                        box-shadow: none;
                        font: inherit;
                        padding: 3px 5px;
                        text-shadow: none;
                        vertical-align: middle;
                      }
                      .deckfaqs_guide_compact .ffaq table td,
                      .deckfaqs_guide_compact .ffaq table th {
                        font-size: 10px;
                        padding: 1px;
                      }
                      .ffaq table td.l,
                      .ffaq table th.l {
                        text-align: left;
                      }
                      .ffaq table td.c,
                      .ffaq table th.c {
                        text-align: center;
                      }
                      .ffaq table td.r,
                      .ffaq table th.r {
                        text-align: right;
                      }
                      .ffaq table td img,
                      .ffaq table th img {
                        max-width: none !important;
                      }
                      .ffaq table td p:last-child,
                      .ffaq table th p:last-child {
                        margin-bottom: 0;
                      }
                      .ffaq table tr {
                        border: 1px solid #000;
                      }
                      .ffaq table th,
                      .ffaq table thead td {
                        background-color: #999999 !important;
                        font-weight: bold;
                        text-align: center;
                      }
                      .ffaq table.unmargin {
                        display: inline-table;
                      }
                      .ffaq div.fimg_small,
                      .ffaq div.fimg_smallleft,
                      .ffaq div.fimg_smallright,
                      .ffaq div.fimg_large,
                      .ffaq div.fimg_largeleft,
                      .ffaq div.cimg_s,
                      .ffaq div.cimg_l {
                        font-size: 10px;
                        border-style: solid;
                        border-width: 1px;
                        padding: 2px;
                      }
                      .ffaq div.fimg_small,
                      .ffaq div.cimg_s {
                        clear: right;
                        float: right;
                        margin: 10px 10px 18px;
                        max-width: 300px;
                      }
                      .deckfaqs_guide_compact .ffaq div.fimg_small,
                      .deckfaqs_guide_compact .ffaq div.cimg_s {
                        clear: both;
                        display: inline-block;
                        float: none;
                        margin: 0 0 10px;
                      }
                      .ffaq div.fimg_smallleft,
                      .ffaq div.cimg_sleft {
                        clear: left;
                        float: left;
                        margin: 10px 20px 10px 10px;
                        max-width: 300px;
                      }
                      .deckfaqs_guide_compact .ffaq div.fimg_smallleft,
                      .deckfaqs_guide_compact .ffaq div.cimg_sleft {
                        clear: both;
                        display: inline-block;
                        float: none;
                        margin: 0 0 10px;
                      }
                      .ffaq div.fimg_smallright,
                      .ffaq div.cimg_sright {
                        clear: right;
                        float: right;
                        margin: 10px 10px 10px 20px;
                        max-width: 300px;
                      }
                      .deckfaqs_guide_compact .ffaq div.fimg_smallright,
                      .deckfaqs_guide_compact .ffaq div.cimg_sright {
                        clear: both;
                        display: inline-block;
                        float: none;
                        margin: 0 0 10px;
                      }
                      .ffaq div.fimg_largeleft {
                        clear: left;
                        float: left;
                        margin: 10px 10px 18px;
                        max-width: 750px;
                      }
                      .deckfaqs_guide_compact .ffaq div.fimg_largeleft {
                        margin: 0;
                        max-width: 100%;
                      }
                      .ffaq div.fimg_large,
                      .ffaq div.cimg_l {
                        clear: both;
                        float: left;
                        margin: 10px 10px 18px;
                        max-width: 750px;
                      }
                      .deckfaqs_guide_compact .ffaq div.fimg_large,
                      .deckfaqs_guide_compact .ffaq div.cimg_l {
                        margin: 0;
                      }
                      .ffaq div.clear {
                        clear: left;
                      }
                      .ffaq img.fimg_small,
                      .ffaq img.fimg_large,
                      .ffaq img.cimg_s,
                      .ffaq img.cimg_l {
                        height: auto;
                        max-width: 100% !important;
                        width: auto;
                      }
                      .ffaq img.imgleft {
                        float: left;
                        margin-right: 10px;
                      }
                      .ffaq img.imgright {
                        float: right;
                        margin-left: 10px;
                      }
                      .ffaq img.imgnofloat {
                        float: none;
                        margin-right: 2px;
                        vertical-align: middle;
                      }
                      .deckfaqs_guide_compact .ffaq img.bigresize {
                        height: 100% !important;
                        width: 100% !important;
                      }
                      .deckfaqs_guide_compact .ffaq table img.bigresize {
                        height: auto !important;
                        width: auto !important;
                        max-height: 100% !important;
                        max-width: 100% !important;
                      }
                      .ffaq ol,
                      .ffaq ul {
                        margin-bottom: 18px;
                        padding-left: 40px;
                      }
                      .ffaq ol li,
                      .ffaq ul li {
                        line-height: 18px;
                        margin-bottom: 0;
                        padding: 3px 0;
                      }
                      .ffaq ol li ol,
                      .ffaq ol li ul,
                      .ffaq ul li ol,
                      .ffaq ul li ul {
                        margin-bottom: 0;
                      }
                      .ffaq:not(.faq_menu_wrap) ul + li,
                      .ffaq:not(.faq_menu_wrap) ol + li {
                        margin-top: -20px;
                      }
                      .ffaq dl dl {
                        text-indent: 15px;
                      }
                      .ffaq dl dl dl {
                        text-indent: 40px;
                      }
                      .ffaq dl dl dl dl {
                        text-indent: 65px;
                      }
                      .ffaq .faqtext {
                        margin: 0 auto !important;
                        background: #fff;
                      }
                      .deckfaqs_guide_compact .ffaq .faqtext {
                        overflow-x: auto;
                      }
                      .deckfaqs_guide_wide .ffaq .faqtext {
                        padding: 25px 100px;
                      }
                      .deckfaqs_guide_compact .ffaq .faqtext {
                        padding: 6px 8px;
                      }
                      .deckfaqs_guide_compact .ffaq .faqtext {
                        background: none !important;
                      }
                      .ffaq .faqtext pre {
                        margin: 0px !important;
                        white-space: pre-wrap;
                        font: 14px "Courier New", "Courier", monospace !important;
                      }
                      .deckfaqs_guide_compact .ffaq .faqtext pre {
                        font: 11px "Courier New", "Courier", monospace !important;
                      }
                      .ffaq.imgmain {
                        display: table;
                        margin: 0 auto;
                      }
                      .ffaq.imgmain p {
                        font-size: 12px;
                        margin-bottom: 0;
                      }
                      .ffaq.imgmain img.imgresize {
                        max-width: 100%;
                        width: 100%;
                      }
                      /* Neoseeker: wiki walkthrough pages (MediaWiki markup) */
                      .ffaq.neo-wiki h1 { font-size: 20px; margin: 0 0 10px; }
                      .ffaq.neo-wiki h2 { font-size: 17px; margin: 16px 0 6px; }
                      .ffaq.neo-wiki h3 { font-size: 15px; margin: 14px 0 6px; }
                      .ffaq.neo-wiki h4 { font-size: 14px; margin: 12px 0 4px; }
                      .ffaq.neo-wiki center { display: block; text-align: center; }
                      .ffaq.neo-wiki hr { margin: 12px 0; }
                      .ffaq.neo-wiki img { max-width: 100%; height: auto; }
                      .ffaq.neo-wiki .img-icon { vertical-align: middle; }
                      .ffaq.neo-wiki .icon { display: none; }
                      .ffaq.neo-wiki .alert {
                        border: 1px solid #999;
                        border-left-width: 5px;
                        padding: 6px 10px;
                        margin: 10px 0;
                        background: #eee;
                      }
                      .ffaq.neo-wiki .alert-primary,
                      .ffaq.neo-wiki .alert-info { background: #d9edf7; border-left-color: #3a87ad; }
                      .ffaq.neo-wiki .alert-success { background: #dff0d8; border-left-color: #468847; }
                      .ffaq.neo-wiki .alert-error,
                      .ffaq.neo-wiki .alert-danger { background: #f2dede; border-left-color: #b94a48; }
                      .ffaq.neo-wiki .alert-secondary { border-left-color: #777; }
                      .ffaq.neo-wiki .section-info {
                        border: 1px solid #999;
                        padding: 6px;
                        margin: 10px 0;
                      }
                      .ffaq.neo-wiki table.wikitable,
                      .ffaq.neo-wiki table.table-list {
                        width: 100%;
                        border-collapse: collapse;
                      }
                      .deckfaqs_guide_compact .ffaq.neo-wiki table {
                        display: block;
                        overflow-x: auto;
                      }
                      .ffaq .neo-nav {
                        display: flex;
                        justify-content: space-between;
                        gap: 12px;
                        margin: 16px 0;
                        font-weight: bold;
                      }
                      .ffaq .neo-nav .neo-next { margin-left: auto; text-align: right; }
                      /* Neoseeker: user-submitted FAQs (GameFAQs-style markup) */
                      .ffaq.neo-faq h1 { font-size: 18px; margin: 0 0 6px; }
                      .ffaq.neo-faq .author_area { font-size: 12px; color: #444; margin-bottom: 10px; }
                      .ffaq.neo-faq .copyright { font-size: 11px; margin-top: 16px; }
                      .ffaq.neo-faq .table-wrapper { overflow-x: auto; }
                      .ffaq.neo-faq img { max-width: 100%; height: auto; }
                      /* Neoseeker: map images */
                      .ffaq.neo-image img {
                        display: block;
                        max-width: 100%;
                        height: auto;
                        margin: 0 auto;
                      }
                      .deckfaqs_dark .ffaq.neo-image img { filter: invert(1); }`}
                    </style>
                    <ScrollPanel
                        onOKButton={() => {
                            guideDiv.current?.focus();
                        }}
                        style={{
                            flexGrow: '1',
                            overflow: 'auto',
                            height: '100%',
                            margin: fullscreen ? '10px' : '0px',
                        }}
                        className={
                            fullscreen ? undefined : 'deckfaqs_scrollpanel'
                        }
                        noFocusRing={!fullscreen}
                    >
                        <Focusable
                            focusableIfNoChildren={true}
                            style={{ background: '#fff' }}
                            className={[
                                'deckfaqs_guide',
                                fullscreen
                                    ? 'deckfaqs_guide_wide'
                                    : 'deckfaqs_guide_compact',
                                state.darkMode ? 'deckfaqs_dark' : '',
                            ].join(' ')}
                            ref={guideDiv}
                        >
                            {content}
                        </Focusable>
                    </ScrollPanel>
                </>
            ),
        [content, isLoading, error, fullscreen, state.darkMode]
    );
};

const navButtonStyle = {
    width: '200px',
    padding: '10px 12px',
};

type FullScreenGuideProps = {
    onDismiss: (updatedGuide: GuideContents) => void;
};
const FullScreenGuide = ({ onDismiss }: FullScreenGuideProps) => {
    const { state } = useContext(AppContext);
    const guide = useRef(state.currentGuide);
    const onDismissRef = useRef(onDismiss);

    useEffect(() => {
        guide.current = state.currentGuide;
    }, [state.currentGuide]);
    useEffect(() => {
        onDismissRef.current = onDismiss;
    }, [onDismiss]);

    // Hand the latest guide state back to the panel when the route unmounts.
    useEffect(() => {
        return function cleanup() {
            if (guide.current) onDismissRef.current(guide.current);
        };
    }, []);
    return (
        <div
            style={{
                display: 'flex',
                flexFlow: 'column',
                marginTop: '50px',
                flexGrow: '1',
                overflow: 'auto',
                color: '#000',
            }}
        >
            <div
                style={{
                    margin: '0 10px',
                    display: 'flex',
                }}
            >
                <Focusable style={{ display: 'flex', width: '100%' }}>
                    {Router.MainRunningApp !== undefined && (
                        <DialogButton
                            disableNavSounds={true}
                            style={{ minWidth: '0px', marginRight: '10px' }}
                            onClick={() => {
                                setTimeout(
                                    () => Router.NavigateToRunningApp(),
                                    200
                                );
                            }}
                        >
                            Back to Game
                        </DialogButton>
                    )}
                    <DialogButton
                        disableNavSounds={true}
                        style={{ ...navButtonStyle, marginRight: '10px' }}
                        onClick={() => {
                            Navigation.NavigateBack();
                            setTimeout(() => {
                                Navigation.OpenQuickAccessMenu(
                                    QuickAccessTab.Decky
                                );
                            }, 200);
                        }}
                    >
                        Back to DeckFAQs
                    </DialogButton>
                    {state.currentGuide &&
                        state.currentGuide.guideToc!.length > 0 && (
                            <TocDropdown
                                style={{
                                    minWidth: '200px',
                                    marginRight: '10px',
                                }}
                            />
                        )}
                    <Search fullScreen={true} />
                </Focusable>
            </div>
            <Guide fullscreen={true} />
        </div>
    );
};
