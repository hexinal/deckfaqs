import { useCallback, useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { ActionType } from '../../reducers/AppReducer';
import {
    getContent,
    getGuidesCode,
    parseGuideList,
    request,
} from '../../utils';
import { List } from './List';

export const ResultList = () => {
    const {
        state: { searchResults },
        dispatch,
        browserView,
    } = useContext(AppContext);

    const getGuides = useCallback(
        (url: string) => {
            request(
                { browserView, dispatch },
                (ctx) => {
                    dispatch({
                        type: ActionType.UPDATE_PLUGIN_STATE,
                        payload: { pluginState: 'guides', isLoading: true },
                    });
                    return getContent(`${url}/faqs`, ctx, getGuidesCode);
                },
                (raw) => {
                    dispatch({
                        type: ActionType.UPDATE_GUIDES,
                        payload: parseGuideList(raw),
                    });
                }
            );
        },
        [browserView, dispatch]
    );

    return useMemo(
        () => (
            <List
                header="Search Results"
                data={searchResults}
                handleClick={getGuides}
            ></List>
        ),
        [searchResults, getGuides]
    );
};
