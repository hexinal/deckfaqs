import { useCallback, useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { ActionType } from '../../reducers/AppReducer';
import { List } from './List';
import { getGuideHtml, request, type GuidePage } from '../../utils';
import { loadPositions } from '../../positions';
import { pageUrl, sourceOf, tocSectionFor } from '../../sources/source';

export const GuideList = () => {
    const {
        state: { guides },
        dispatch,
        browserView,
    } = useContext(AppContext);

    const openGuide = useCallback(
        (url: string) => {
            request(
                { browserView, dispatch },
                async (ctx) => {
                    dispatch({
                        type: ActionType.UPDATE_PLUGIN_STATE,
                        payload: { pluginState: 'guide', isLoading: true },
                    });
                    // Resume where the user left off: same page of a
                    // paginated guide, then the saved scroll ratio.
                    const pos = (await loadPositions())[url];
                    let page = pos?.page ?? '';
                    let res: GuidePage;
                    try {
                        res = await getGuideHtml(pageUrl(url, page), ctx);
                    } catch (e) {
                        // A remembered Neoseeker wiki sub-page may have been renamed:
                        // fall back to the guide itself. (GameFAQs `?page=N` never moves.)
                        if (
                            !page ||
                            ctx.cancelled() ||
                            sourceOf(url) !== 'neoseeker'
                        )
                            throw e;
                        console.warn(
                            '[DeckFAQs] saved page failed, opening the guide',
                            e
                        );
                        page = '';
                        res = await getGuideHtml(url, ctx);
                    }
                    return {
                        ...res,
                        page,
                        restore: page === (pos?.page ?? '') ? pos : undefined,
                    };
                },
                ({ html, toc, page, restore }) => {
                    dispatch({
                        type: ActionType.UPDATE_GUIDE,
                        payload: {
                            guideHtml: html,
                            guideUrl: url,
                            guideToc: toc,
                            currentTocSection: tocSectionFor(toc, url, page),
                            page,
                            restore,
                        },
                    });
                }
            );
        },
        [browserView, dispatch]
    );
    return useMemo(
        () => (
            <List header="Guides" data={guides} handleClick={openGuide}></List>
        ),
        [guides, openGuide]
    );
};
