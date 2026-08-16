import { ButtonItem, PanelSection, PanelSectionRow } from '@decky/ui';
import { useCallback, useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { gameSearch } from '../../utils';
import { List } from './List';

export const GameList = () => {
    const { state, dispatch, browserView } = useContext(AppContext);

    const { runningGame, games, source } = state;
    const search = useCallback(
        (game: string) => {
            gameSearch(game, browserView, dispatch, source);
        },
        [browserView, dispatch, source]
    );

    return useMemo(
        () => (
            <>
                {runningGame && (
                    <PanelSection>
                        <PanelSectionRow>
                            <ButtonItem
                                layout="below"
                                onClick={() => search(runningGame)}
                            >
                                {runningGame}
                            </ButtonItem>
                        </PanelSectionRow>
                    </PanelSection>
                )}
                <List
                    header="Installed Games"
                    data={games}
                    handleClick={search}
                ></List>
            </>
        ),
        [runningGame, games, search]
    );
};
