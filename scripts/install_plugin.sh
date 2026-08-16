#!/bin/sh
# Installs DeckFAQs from a GitHub release on a Steam Deck.
# Usage: ./install_plugin.sh [version]   (e.g. ./install_plugin.sh v2.0.0; defaults to the latest release)
set -eu

REPO="hexinal/deckfaqs"
VERSION="${1:-latest}"
PLUGINS_DIR="/home/deck/homebrew/plugins"

if [ "$VERSION" = "latest" ]; then
    URL="https://github.com/$REPO/releases/latest/download/deckfaqs.zip"
else
    URL="https://github.com/$REPO/releases/download/$VERSION/deckfaqs.zip"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading DeckFAQs ($VERSION) from $URL"
curl -fL -o "$TMP/deckfaqs.zip" "$URL"

echo "Installing to $PLUGINS_DIR/deckfaqs"
sudo rm -rf "$PLUGINS_DIR/deckfaqs"
sudo unzip -q "$TMP/deckfaqs.zip" -d "$PLUGINS_DIR"

echo "Restarting PluginLoader"
sudo systemctl restart plugin_loader

echo "DeckFAQs installed"
