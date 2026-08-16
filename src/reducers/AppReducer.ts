import type { ListItem } from '../components/List/List';
import type {
    GuideContents,
    GuideSearch,
    PluginState,
    TAppState,
} from '../context/AppContext';

export const ActionType = {
    UPDATE_PLUGIN_STATE: 'UPDATE_PLUGIN_STATE',
    UPDATE_RESULTS: 'UPDATE_RESULTS',
    UPDATE_GAMES: 'UPDATE_GAMES',
    UPDATE_GUIDES: 'UPDATE_GUIDES',
    UPDATE_RUNNING_GAME: 'UPDATE_RUNNING_GAME',
    UPDATE_GUIDE: 'UPDATE_GUIDE',
    BACK: 'BACK',
    BACK_TO_STATE: 'BACK_TO_STATE',
    UPDATE_DARK_MODE: 'UPDATE_DARK_MODE',
    UPDATE_LOADING: 'UPDATE_LOADING',
    UPDATE_SEARCH: 'UPDATE_SEARCH',
    UPDATE_ERROR: 'UPDATE_ERROR',
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export type AppActions =
    | UpdatePluginStateAction
    | UpdateResultsAction
    | UpdateGuidesAction
    | UpdateGamesAction
    | UpdateRunningGameAction
    | UpdateGuideAction
    | BackAction
    | BackToStateAction
    | UpdateDarkModeAction
    | UpdateLoadingAction
    | UpdateSearchAction
    | UpdateErrorAction;

/** A user-facing fetch error; cleared by the next navigation/result. */
type UpdateErrorAction = {
    type: typeof ActionType.UPDATE_ERROR;
    payload: string;
};

type UpdateSearchAction = {
    type: typeof ActionType.UPDATE_SEARCH;
    payload: GuideSearch;
};

type UpdateLoadingAction = {
    type: typeof ActionType.UPDATE_LOADING;
    payload: boolean;
};

type UpdatePluginState = {
    pluginState: PluginState;
    isLoading: boolean;
};

type UpdatePluginStateAction = {
    type: typeof ActionType.UPDATE_PLUGIN_STATE;
    payload: UpdatePluginState;
};

type UpdateResultsAction = {
    type: typeof ActionType.UPDATE_RESULTS;
    payload: ListItem[];
};

type UpdateGamesAction = {
    type: typeof ActionType.UPDATE_GAMES;
    payload: { games: ListItem[]; runningGame?: string };
};

type UpdateGuidesAction = {
    type: typeof ActionType.UPDATE_GUIDES;
    payload: ListItem[];
};

type UpdateRunningGameAction = {
    type: typeof ActionType.UPDATE_RUNNING_GAME;
    payload?: string;
};

type UpdateGuideAction = {
    type: typeof ActionType.UPDATE_GUIDE;
    payload: GuideContents;
};

type BackAction = {
    type: typeof ActionType.BACK;
};

type BackToStateAction = {
    type: typeof ActionType.BACK_TO_STATE;
    payload: PluginState;
};
type UpdateDarkModeAction = {
    type: typeof ActionType.UPDATE_DARK_MODE;
    payload: boolean;
};

export const appReducer = (state: TAppState, action: AppActions): TAppState => {
    switch (action.type) {
        case ActionType.UPDATE_PLUGIN_STATE:
            return {
                ...state,
                ...action.payload,
                error: undefined,
            };
        case ActionType.UPDATE_GAMES:
            return {
                ...state,
                error: undefined,
                games: action.payload.games,
                runningGame: action.payload.runningGame,
                pluginState: 'games',
                isLoading: false,
            };
        case ActionType.UPDATE_RESULTS:
            return {
                ...state,
                error: undefined,
                isLoading: false,
                searchResults: action.payload,
                pluginState: 'results',
            };
        case ActionType.UPDATE_GUIDES:
            return {
                ...state,
                error: undefined,
                isLoading: false,
                guides: action.payload,
                pluginState: 'guides',
            };
        case ActionType.UPDATE_RUNNING_GAME:
            return {
                ...state,
                runningGame: action.payload,
            };
        case ActionType.UPDATE_GUIDE:
            return {
                ...state,
                error: undefined,
                isLoading: false,
                currentGuide: action.payload,
                search: {
                    searchText: '',
                    searchAnchorLength: 0,
                    anchorIndex: -1,
                },
                pluginState: 'guide',
            };
        case ActionType.BACK: {
            let newPluginState: PluginState;
            switch (state.pluginState) {
                case 'guides':
                    newPluginState = 'results';
                    break;
                case 'guide':
                    newPluginState = 'guides';
                    break;
                default:
                    newPluginState = 'games';
                    break;
            }
            return {
                ...state,
                pluginState: newPluginState,
                currentGuide: undefined,
                isLoading: false,
                error: undefined,
            };
        }
        case ActionType.BACK_TO_STATE:
            return {
                ...state,
                pluginState: action.payload,
                isLoading: false,
                error: undefined,
            };
        case ActionType.UPDATE_DARK_MODE:
            return {
                ...state,
                darkMode: action.payload,
            };
        case ActionType.UPDATE_LOADING:
            return {
                ...state,
                isLoading: action.payload,
                error: action.payload ? undefined : state.error,
            };
        case ActionType.UPDATE_ERROR:
            return {
                ...state,
                isLoading: false,
                error: action.payload,
            };
        case ActionType.UPDATE_SEARCH:
            return {
                ...state,
                search: action.payload,
            };
        default:
            return state;
    }
};
