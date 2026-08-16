#!/bin/sh
# Installs DeckFAQs from a GitHub release on a Steam Deck.
# Usage: ./install_plugin.sh [version]   (e.g. ./install_plugin.sh v2.0.0; defaults to the latest release)
set -eu

REPO="hexinal/deckfaqs"
VERSION="${1:-latest}"
PLUGINS_DIR="/home/deck/homebrew/plugins"

if [ "$VERSION" = "latest" ]; then
    BASE="https://github.com/$REPO/releases/latest/download"
else
    BASE="https://github.com/$REPO/releases/download/$VERSION"
fi
URL="$BASE/deckfaqs.zip"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading DeckFAQs ($VERSION) from $URL"
curl -fL -o "$TMP/deckfaqs.zip" "$URL"
curl -fL -o "$TMP/SHA256SUMS" "$BASE/SHA256SUMS"

echo "Verifying checksum"
(cd "$TMP" && grep ' deckfaqs.zip$' SHA256SUMS | sha256sum -c -)

echo "Installing to $PLUGINS_DIR/deckfaqs"
sudo rm -rf "$PLUGINS_DIR/deckfaqs"
sudo unzip -q "$TMP/deckfaqs.zip" -d "$PLUGINS_DIR"

echo "Restarting PluginLoader"
sudo systemctl restart plugin_loader

echo "DeckFAQs installed"
