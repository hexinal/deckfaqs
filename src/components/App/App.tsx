import { useEffect, useContext, useRef } from 'react';
import type { ListItem } from '../List/List';
import { Router } from '@decky/ui';
import { AppContext } from '../../context/AppContext';
import { ActionType } from '../../reducers/AppReducer';
import { SETTINGS, ignoreNonSteam, ignoreSteam } from '../../constants';
import { Nav } from '../Nav/Nav';
import { MainView } from './MainView';

// This used to use css modules, but with the way the new React Based router works,
// I have yet to figure out how to import css properly

export const App = () => {
    const {
        state: { pluginState },
        dispatch,
    } = useContext(AppContext);
    const mainDiv = useRef<HTMLDivElement>(null);
    useEffect(() => {
        mainDiv.current?.scrollTo({ top: 0 });
    }, [pluginState]);

    useEffect(() => {
        dispatch({
            type: ActionType.UPDATE_PLUGIN_STATE,
            payload: { pluginState: 'games', isLoading: true },
        });

        // This would work for Steam games but does not for non-steam games so we just use this for cleraing the running game
        const handleSteamAppStateChange = ({ bRunning }: AppState) => {
            if (!bRunning) {
                dispatch({
                    type: ActionType.UPDATE_RUNNING_GAME,
                    payload: undefined,
                });
            }
        };

        // This works for both Steam and non-Steam games
        const handleGameActionStart = (
            _actionType: number,
            strAppId: string,
            actionName: string
        ) => {
            let newRunningGame: string | undefined = undefined;
            const appId = parseInt(strAppId);
            if (actionName == 'LaunchApp') {
                const gameInfo: AppOverview =
                    appStore.GetAppOverviewByGameID(appId);
                if (
                    gameInfo &&
                    !ignoreSteam.includes(appId) &&
                    !ignoreNonSteam.includes(gameInfo.display_name)
                ) {
                    newRunningGame = gameInfo.display_name;
                }
            }
            dispatch({
                type: ActionType.UPDATE_RUNNING_GAME,
                payload: newRunningGame,
            });
        };

        const getGames = async (): Promise<{
            games: ListItem[];
            runningGame?: string;
        }> => {
            // Steam Games
            const installFolders =
                await SteamClient.InstallFolder.GetInstallFolders();
            const games: { appName: string; sortAsName: string }[] = [];
            const currentRunningGame = Router.MainRunningApp?.display_name;
            let runningGame: string | undefined = undefined;
            installFolders.forEach((folder: InstallFolder) => {
                folder.vecApps.forEach((app) => {
                    if (!ignoreSteam.includes(app.nAppID)) {
                        if (
                            !runningGame &&
                            currentRunningGame == app.strAppName
                        )
                            runningGame = currentRunningGame;
                        games.push({
                            sortAsName: app.strSortAs,
                            appName: app.strAppName,
                        });
                    }
                });
            });

            // Non-Steam Games
            const shortcuts = collectionStore.deckDesktopApps.allApps;
            shortcuts.forEach(({ sort_as, display_name }) => {
                if (!ignoreNonSteam.includes(display_name)) {
                    if (!runningGame && currentRunningGame == display_name)
                        runningGame = currentRunningGame;
                    games.push({ sortAsName: sort_as, appName: display_name });
                }
            });
            const apps = games.map((o) => o.appName);
            const unique = games.filter(
                ({ appName }, index) => !apps.includes(appName, index + 1)
            );
            return {
                games: unique
                    .sort((a, b) => a.sortAsName.localeCompare(b.sortAsName))
                    .map(({ appName }): ListItem => {
                        return { text: appName };
                    }),
                runningGame,
            };
        };

        getGames()
            .then(({ games, runningGame }) => {
                dispatch({
                    type: ActionType.UPDATE_GAMES,
                    payload: { games, runningGame },
                });
            })
            .catch((e: unknown) => {
                console.error('[DeckFAQs] failed to list installed games', e);
                dispatch({
                    type: ActionType.UPDATE_GAMES,
                    payload: { games: [] },
                });
            });

        SteamClient.Storage.GetJSON(SETTINGS)
            .then((result) => {
                const settings = JSON.parse(result as string) as {
                    darkMode: boolean;
                };
                dispatch({
                    type: ActionType.UPDATE_DARK_MODE,
                    payload: settings.darkMode,
                });
            })
            .catch(() => {
                dispatch({
                    type: ActionType.UPDATE_DARK_MODE,
                    payload: false,
                });
            });

        const onAppStateChange =
            SteamClient.GameSessions.RegisterForAppLifetimeNotifications(
                handleSteamAppStateChange
            );

        const onGameActionStart = SteamClient.Apps.RegisterForGameActionStart(
            handleGameActionStart
        );
        return function cleanup() {
            onAppStateChange.unregister();
            onGameActionStart.unregister();
        };
    }, [dispatch]);

    return (
        <div
            style={{
                height: '80vh',
                display: 'flex',
                flexFlow: 'column',
                flex: 1,
            }}
        >
            <style>
                {`
                .lds-ring {
                    display: block;
                    position: relative;
                    margin-left: auto;
                    margin-right: auto;
                    width: 80px;
                    height: 80px;
                }
                .lds-ring div {
                    box-sizing: border-box;
                    display: block;
                    position: absolute;
                    width: 64px;
                    height: 64px;
                    margin: 8px;
                    border: 8px solid #fff;
                    border-radius: 50%;
                    animation: lds-ring 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
                    border-color: #fff transparent transparent transparent;
                }
                .lds-ring div:nth-child(1) {
                    animation-delay: -0.45s;
                }
                .lds-ring div:nth-child(2) {
                    animation-delay: -0.3s;
                }
                .lds-ring div:nth-child(3) {
                    animation-delay: -0.15s;
                }
                @keyframes lds-ring {
                    0% {
                    transform: rotate(0deg);
                    }
                    100% {
                    transform: rotate(360deg);
                    }
                }
`}
            </style>
            <Nav />
            <div ref={mainDiv} style={{ padding: '10px', overflow: 'auto' }}>
                <MainView />
            </div>
        </div>
    );
};
