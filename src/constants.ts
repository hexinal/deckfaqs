const GAMEFAQS_ORIGIN = 'https://gamefaqs.gamespot.com';
const NEOSEEKER_ORIGIN = 'https://www.neoseeker.com';
// Neoseeker's quick-search lives on its CDN as static JSONP (fetched directly, never in the BrowserView).
const NEOSEEKER_CDN_ORIGIN = 'https://cdn.staticneo.com';
// The only origins the hidden BrowserView is allowed to load (see utils.ts doScrape).
const SCRAPE_ORIGINS: readonly string[] = [GAMEFAQS_ORIGIN, NEOSEEKER_ORIGIN];
// Hosts Neoseeker guides may load <img> from (wiki thumbnails, FAQ images, maps).
const NEOSEEKER_IMAGE_ORIGINS: readonly string[] = [
    NEOSEEKER_ORIGIN,
    NEOSEEKER_CDN_ORIGIN,
    'https://faqs.neoseeker.com',
    'https://i.neoseeker.com',
];

// SteamClient.Storage key for persisted settings ({ darkMode, source }).
const SETTINGS = 'deckfaqs_settings';
// SteamClient.Storage key for last reading positions ({ [guideUrl]: GuidePosition }).
const POSITIONS = 'deckfaqs_positions';
// How many guides remember their reading position (oldest dropped first).
const MAX_POSITIONS = 50;

const ignoreSteam = [1887720, 1070560, 1391110, 228980];
const ignoreNonSteam = [
    'EmulationStation-DE-x64_SteamDeck',
    'Google Chrome',
    'Cemu',
    'Citra',
    'Dolphin (emulator)',
    'DuckStation (Emulator)',
    'PCSX2',
    'PPSSPP',
    'PrimeHack',
    'RetroArch',
    'RPCS3',
    'xemu (emulator)',
    'Yuzu',
    'Moonlight',
    'pcsx2-qt',
    'Ryujinx',
    'ScummVM',
    'Vita3K',
    'Chiaki',
    'Heroic Games Launcher',
    'MAME',
];

export {
    GAMEFAQS_ORIGIN,
    NEOSEEKER_ORIGIN,
    SCRAPE_ORIGINS,
    NEOSEEKER_IMAGE_ORIGINS,
    SETTINGS,
    POSITIONS,
    MAX_POSITIONS,
    ignoreSteam,
    ignoreNonSteam,
};
