import { useCallback, useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { ActionType } from '../../reducers/AppReducer';
import { List } from './List';
import { getGuideHtml, request } from '../../utils';

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
                (ctx) => {
                    dispatch({
                        type: ActionType.UPDATE_PLUGIN_STATE,
                        payload: { pluginState: 'guide', isLoading: true },
                    });
                    return getGuideHtml(url, ctx);
                },
                ({ html, toc }) => {
                    dispatch({
                        type: ActionType.UPDATE_GUIDE,
                        payload: {
                            guideHtml: html,
                            guideUrl: url,
                            guideToc: toc,
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
