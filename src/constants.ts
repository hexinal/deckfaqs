// The only origin the hidden BrowserView is allowed to load (see utils.ts scrapeUrl).
const GAMEFAQS_ORIGIN = 'https://gamefaqs.gamespot.com';

// SteamClient.Storage key for persisted settings ({ darkMode }).
const SETTINGS = 'deckfaqs_settings';

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

export { GAMEFAQS_ORIGIN, SETTINGS, ignoreSteam, ignoreNonSteam };
