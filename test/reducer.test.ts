import { describe, expect, it } from 'vitest';
import { initialState, type TAppState } from '../src/context/AppContext';
import { ActionType, appReducer } from '../src/reducers/AppReducer';

const at = (pluginState: TAppState['pluginState']): TAppState => ({
    ...initialState,
    pluginState,
});

describe('appReducer', () => {
    it('starts loading and clears a previous error', () => {
        const state = appReducer(
            { ...initialState, error: 'boom' },
            {
                type: ActionType.UPDATE_PLUGIN_STATE,
                payload: { pluginState: 'results', isLoading: true },
            }
        );
        expect(state).toMatchObject({
            pluginState: 'results',
            isLoading: true,
            error: undefined,
        });
    });

    it('stores results and stops loading', () => {
        const state = appReducer(
            { ...at('results'), isLoading: true },
            {
                type: ActionType.UPDATE_RESULTS,
                payload: {
                    results: [{ text: 'A', url: 'https://x/a' }],
                    term: 'a',
                    notice: "Couldn't load Neoseeker.",
                },
            }
        );
        expect(state.isLoading).toBe(false);
        expect(state.searchResults).toEqual([
            { text: 'A', url: 'https://x/a' },
        ]);
        expect(state.searchTerm).toBe('a');
        expect(state.searchNotice).toBe("Couldn't load Neoseeker.");
        // The next (clean) search drops the notice.
        const next = appReducer(state, {
            type: ActionType.UPDATE_RESULTS,
            payload: { results: [], term: 'b' },
        });
        expect(next.searchNotice).toBeUndefined();
    });

    it('stores the guide-source setting', () => {
        expect(initialState.source).toBe('both');
        const state = appReducer(initialState, {
            type: ActionType.UPDATE_SOURCE,
            payload: 'neoseeker',
        });
        expect(state.source).toBe('neoseeker');
    });

    it('walks BACK through guide -> guides -> results -> games', () => {
        let state: TAppState = {
            ...at('guide'),
            currentGuide: { guideHtml: '<p/>' },
        };
        state = appReducer(state, { type: ActionType.BACK });
        expect(state.pluginState).toBe('guides');
        expect(state.currentGuide).toBeUndefined();
        state = appReducer(state, { type: ActionType.BACK });
        expect(state.pluginState).toBe('results');
        state = appReducer(state, { type: ActionType.BACK });
        expect(state.pluginState).toBe('games');
        state = appReducer(state, { type: ActionType.BACK });
        expect(state.pluginState).toBe('games');
    });

    it('records an error and stops loading; navigation clears it', () => {
        let state = appReducer(
            { ...at('guides'), isLoading: true },
            { type: ActionType.UPDATE_ERROR, payload: 'offline' }
        );
        expect(state).toMatchObject({ isLoading: false, error: 'offline' });
        state = appReducer(state, {
            type: ActionType.BACK_TO_STATE,
            payload: 'games',
        });
        expect(state.error).toBeUndefined();
    });

    it('resets in-guide search when a new guide loads', () => {
        const state = appReducer(
            {
                ...at('guides'),
                search: {
                    searchText: 'x',
                    searchAnchorLength: 3,
                    anchorIndex: 1,
                },
            },
            {
                type: ActionType.UPDATE_GUIDE,
                payload: { guideHtml: '<p>hi</p>', guideUrl: 'https://g/1' },
            }
        );
        expect(state.pluginState).toBe('guide');
        expect(state.search).toEqual({
            searchText: '',
            searchAnchorLength: 0,
            anchorIndex: -1,
        });
    });
});
