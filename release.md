## DeckFAQs, a GameFAQs browser for the Steam Deck (v2.0.0)

-   Migrated to the current Decky Loader plugin API (`@decky/api` / `@decky/ui`, `api_version` 1, ESM bundle). Requires Decky Loader v3 or newer.
-   Fixes guide fetching on current Decky Loader (the legacy `executeInTab` shim changed its return shape).
-   Updated toolchain: rollup 4, TypeScript 5, React 19 typings, html-react-parser 5, react-icons 5, DOMPurify 3.
