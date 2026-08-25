import { definePlugin, routerHook } from '@decky/api';
import { Router, staticClasses } from '@decky/ui';
import { FaSearch } from 'react-icons/fa';
import { App } from './components/App/App';
import { BLANK_PAGE } from './constants';
import { AppContextProvider } from './context/AppContext';
import { flushPositions } from './positions';

export default definePlugin(() => {
    const windowRouter = Router.WindowStore?.GamepadUIMainWindowInstance;
    const browserView = windowRouter?.CreateBrowserView('DeckFAQs');
    if (browserView) {
        // Park it where utils.ts expects to find it between loads.
        browserView.LoadURL(BLANK_PAGE);
    } else {
        // Every fetch will surface ERROR_NO_BROWSER_VIEW; log once for the journal.
        console.error('[DeckFAQs] could not create a BrowserView');
    }
    return {
        name: 'DeckFAQs',
        titleView: <div className={staticClasses.Title}>DeckFAQs</div>,
        content: (
            <AppContextProvider browserView={browserView}>
                <App />
            </AppContextProvider>
        ),
        icon: <FaSearch />,
        onDismount() {
            // Land a pending reading-position save before the backend goes away.
            void flushPositions();
            if (browserView) SteamClient.BrowserView.Destroy(browserView);
            routerHook.removeRoute('/deckfaqs-fullscreen');
        },
        alwaysRender: true,
    };
});
