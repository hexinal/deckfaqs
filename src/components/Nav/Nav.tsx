import {
    DialogButton,
    Focusable,
    ToggleField,
    findSP,
    showModal,
    QuickAccessTab,
    Navigation,
} from '@decky/ui';
import { useCallback, useContext, useMemo } from 'react';
import { BsArrowsFullscreen } from 'react-icons/bs';
import { FaHome } from 'react-icons/fa';
import { FiRotateCw } from 'react-icons/fi';
import { AppContext } from '../../context/AppContext';
import { SETTINGS } from '../../constants';
import { ActionType } from '../../reducers/AppReducer';
import {
    cancelPendingRequests,
    gameSearch,
    getGuideHtml,
    request,
} from '../../utils';
import { Search } from './Search';
import { SearchModal } from './SearchModal';
import { TocDropdown } from './TocDropdown';

const btnStyle = {
    maxWidth: '30%',
    flexGrow: 1,
    minWidth: 0,
};

export const Nav = () => {
    const {
        state: { pluginState, currentGuide, darkMode },
        dispatch,
        browserView,
    } = useContext(AppContext);
    const guideUrl = currentGuide?.guideUrl;
    const hasToc = (currentGuide?.guideToc?.length ?? 0) > 0;

    const back = useCallback(() => {
        cancelPendingRequests();
        dispatch({ type: ActionType.BACK });
    }, [dispatch]);

    const reload = useCallback(() => {
        if (guideUrl) {
            request(
                { browserView, dispatch },
                (ctx) => {
                    dispatch({
                        type: ActionType.UPDATE_LOADING,
                        payload: true,
                    });
                    return getGuideHtml(guideUrl, ctx);
                },
                ({ html, toc }) => {
                    dispatch({
                        type: ActionType.UPDATE_GUIDE,
                        payload: {
                            guideHtml: html,
                            guideUrl,
                            guideToc: toc,
                        },
                    });
                }
            );
        }
    }, [guideUrl, browserView, dispatch]);

    const backToGames = useCallback(() => {
        cancelPendingRequests();
        dispatch({ type: ActionType.BACK_TO_STATE, payload: 'games' });
    }, [dispatch]);

    const handleDarkMode = useCallback(
        (result: boolean) => {
            dispatch({ type: ActionType.UPDATE_DARK_MODE, payload: result });
            // Persist on change; the QAM panel is alwaysRender so it rarely unmounts.
            SteamClient.Storage.SetObject(SETTINGS, { darkMode: result });
        },
        [dispatch]
    );

    const handleSearch = useCallback(
        (result: string) => {
            result = result.trim();
            if (result) gameSearch(result, browserView, dispatch);
            Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
        },
        [browserView, dispatch]
    );
    return useMemo(
        () =>
            pluginState !== 'games' ? (
                <div style={{ flex: '0 1 auto', padding: '0 10px' }}>
                    <Focusable
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            marginBottom: '5px',
                        }}
                    >
                        {pluginState !== 'results' && (
                            <DialogButton
                                disableNavSounds={true}
                                style={{
                                    ...btnStyle,
                                    minWidth: '0px',
                                    marginRight: '5px',
                                }}
                                onClick={backToGames}
                            >
                                <FaHome
                                    style={{
                                        margin: '0 auto',
                                        display: 'block',
                                    }}
                                />
                            </DialogButton>
                        )}
                        {pluginState === 'guide' && (
                            <DialogButton
                                disableNavSounds={true}
                                style={btnStyle}
                                onClick={reload}
                            >
                                <FiRotateCw
                                    style={{
                                        margin: '0 auto',
                                        display: 'block',
                                    }}
                                />
                            </DialogButton>
                        )}
                        <DialogButton
                            disableNavSounds={true}
                            style={btnStyle}
                            onClick={back}
                        >
                            Back
                        </DialogButton>
                    </Focusable>
                    {pluginState == 'guide' && (
                        <Focusable
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                            }}
                        >
                            <DialogButton
                                disableNavSounds={true}
                                style={{
                                    ...btnStyle,
                                    marginRight: '5px',
                                    minWidth: '0px',
                                }}
                                onClick={() => {
                                    Navigation.CloseSideMenus();
                                    setTimeout(
                                        () =>
                                            Navigation.Navigate(
                                                '/deckfaqs-fullscreen'
                                            ),
                                        100
                                    );
                                }}
                            >
                                <BsArrowsFullscreen />
                            </DialogButton>
                            {hasToc ? (
                                <TocDropdown
                                    style={{ ...btnStyle, minWidth: '160px' }}
                                />
                            ) : (
                                <Search />
                            )}
                        </Focusable>
                    )}
                </div>
            ) : (
                <div style={{ flex: '0 1 auto', padding: '0 10px' }}>
                    <DialogButton
                        disableNavSounds={true}
                        style={{
                            marginBottom: '10px',
                        }}
                        onClick={() => {
                            showModal(
                                <SearchModal
                                    promptText="Search for a game"
                                    setModalResult={handleSearch}
                                />,
                                findSP()
                            );
                        }}
                    >
                        Search games
                    </DialogButton>
                    <ToggleField
                        label="Enable Dark Mode?"
                        description={`Enable Dark Mode for Guides`}
                        checked={darkMode}
                        onChange={handleDarkMode}
                    />
                </div>
            ),
        [
            pluginState,
            darkMode,
            hasToc,
            back,
            backToGames,
            reload,
            handleDarkMode,
            handleSearch,
        ]
    );
};
