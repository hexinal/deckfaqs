import { DialogButton } from '@decky/ui';
import { useCallback, useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { ActionType } from '../../reducers/AppReducer';
import { gameSearch, getContent, request } from '../../utils';
import { getGuidesCode, parseGuideList } from '../../sources/gamefaqs';
import { neoGuidesCode, parseNeoGuideList } from '../../sources/neoseeker';
import { guideListUrl, sourceOf } from '../../sources/source';
import { List } from './List';

export const ResultList = () => {
    const {
        state: {
            searchResults,
            searchTerm,
            searchNotice,
            source,
            isLoading,
            error,
        },
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
                    return getContent(
                        guideListUrl(url),
                        ctx,
                        sourceOf(url) === 'neoseeker'
                            ? neoGuidesCode
                            : getGuidesCode
                    );
                },
                (raw) => {
                    dispatch({
                        type: ActionType.UPDATE_GUIDES,
                        payload:
                            sourceOf(url) === 'neoseeker'
                                ? parseNeoGuideList(raw, url)
                                : parseGuideList(raw),
                    });
                }
            );
        },
        [browserView, dispatch]
    );

    const retrySearch = useCallback(() => {
        gameSearch(searchTerm, browserView, dispatch, source);
    }, [searchTerm, browserView, dispatch, source]);

    const showNotice = Boolean(searchNotice) && !isLoading && !error;
    return useMemo(
        () => (
            <>
                {showNotice && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '12px',
                            marginBottom: '6px',
                        }}
                    >
                        <span style={{ flex: '1 1 auto' }}>{searchNotice}</span>
                        <DialogButton
                            disableNavSounds={true}
                            style={{ flex: '0 0 auto', width: 'auto' }}
                            onClick={retrySearch}
                        >
                            Retry
                        </DialogButton>
                    </div>
                )}
                <List
                    header="Search Results"
                    data={searchResults}
                    handleClick={getGuides}
                ></List>
            </>
        ),
        [searchResults, getGuides, showNotice, searchNotice, retrySearch]
    );
};
