import { useContext, useMemo } from 'react';
import { AppContext } from '../../context/AppContext';
import { Guide } from '../Guide/Guide';
import { GameList } from '../List/GameList';
import { GuideList } from '../List/GuideList';
import { ResultList } from '../List/ResultList';

export const MainView = () => {
    const {
        state: { pluginState },
    } = useContext(AppContext);
    return useMemo(() => {
        switch (pluginState) {
            case 'games':
                return <GameList />;
            case 'results':
                return <ResultList />;
            case 'guides':
                return <GuideList />;
            case 'guide':
                return <Guide />;
        }
    }, [pluginState]);
};
