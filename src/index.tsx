import { definePlugin, routerHook } from '@decky/api';
import { Router, staticClasses } from '@decky/ui';
import { FaSearch } from 'react-icons/fa';
import { App } from './components/App/App';
import { AppContextProvider } from './context/AppContext';

export default definePlugin(() => {
    const windowRouter = Router.WindowStore?.GamepadUIMainWindowInstance;
    const browserView = windowRouter?.CreateBrowserView('DeckFAQs');
    if (!browserView) {
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
            if (browserView) SteamClient.BrowserView.Destroy(browserView);
            routerHook.removeRoute('/deckfaqs-fullscreen');
        },
        alwaysRender: true,
    };
});
