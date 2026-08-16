# DeckFAQs

## Description

A GameFAQs browser for the Steam Deck. This plugin supports both Steam and non-Steam games (like things setup with Steam Rom Manager for example)

Built with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader).

> This is a maintained fork of the original (now abandoned) [hulkrelax/deckfaqs](https://github.com/hulkrelax/deckfaqs), updated for the current Decky Loader plugin API (v2.0.0+ requires Decky Loader v3 or newer).

## How to Install

1. Install [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader#installation) first.
2. Download `deckfaqs.zip` from the [latest release](https://github.com/hexinal/deckfaqs/releases/latest) and install it either
    - from the Steam Deck UI: Decky settings (⚙) → **Developer** → **Install Plugin from ZIP**, or
    - from a terminal on the Deck: `sh scripts/install_plugin.sh` (downloads the latest release, unzips it into `/home/deck/homebrew/plugins/` and restarts the plugin loader; `scripts/uninstall.sh` removes it).

The version on the Decky store (1.8.x) is the old upstream release and no longer works with current Decky Loader.

## Development

- `pnpm install`, then `pnpm build` (or `task build`) bundles `src/index.tsx` into `dist/index.js`.
- `task package` builds and zips the plugin into `deckfaqs.zip`, ready to install as above.

## Features

DeckFAQs supports both rich-text and plain-text guides from GameFAQs.

### Game List

![](images/001_games.jpeg)

### Search Results

![](images/002_results.png)

### Guides

![](images/003_guides.png)

### Rich-text Guide

![](images/rich_text.jpg)

### Plain-text Guide

![](images/005_plain.png)

### Fullscreen Guide

![](images/006_fullscreen.png)

![](images/fullscreen.jpg)

### Dark Mode

![](images/dark_mode.jpg)

### Search

![](images/search.jpg)

## Known Issues

-   It is possible that some non-game games (thins like Chrome) will show up in your list of games. I have a filter to remove some obvious non-games but the list is non-exhaustive. We can always expand the filter to remove them over time. In any case, it doesn't really break anything as far as I know and hopefully you have more games than non-games :smile:

Report issues or feature requests [here](https://github.com/hulkrelax/deckfaqs/issues).
