import { ButtonItem, PanelSection, PanelSectionRow } from '@decky/ui';
import { useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { gameSearch } from '../../utils';
import { List } from './List';

export type SearchResult = {
    product_name: string | undefined;
    url: string | undefined;
};

export const GameList = () => {
    const { state, dispatch, browserView } = useContext(AppContext);

    const search = (game: string) => {
        gameSearch(game, browserView, dispatch);
    };

    const { runningGame, games } = state;
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
        [runningGame, games]
    );
};
