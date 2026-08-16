import { useCallback, useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { ActionType } from '../../reducers/AppReducer';
import { List } from './List';
import { getGuideHtml, request } from '../../utils';
import { loadPositions } from '../../positions';

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
                    const page = pos?.page ?? '';
                    const res = await getGuideHtml(
                        page ? `${url}/${page}` : url,
                        ctx
                    );
                    return { ...res, page, restore: pos };
                },
                ({ html, toc, page, restore }) => {
                    dispatch({
                        type: ActionType.UPDATE_GUIDE,
                        payload: {
                            guideHtml: html,
                            guideUrl: url,
                            guideToc: toc,
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
