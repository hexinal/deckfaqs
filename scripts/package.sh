#!/usr/bin/env bash
# Package the built plugin into deckfaqs.zip and deckfaqs.tar.gz using the
# layout Decky Loader expects (unzip into /home/deck/homebrew/plugins/).
# Run `pnpm build` first. Used by CI (semantic-release) and `task package`.
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=deckfaqs
rm -rf "$STAGE" deckfaqs.zip deckfaqs.tar.gz SHA256SUMS
mkdir -p "$STAGE/dist"
# Decky needs package.json ("type": "module") next to plugin.json to load the ESM bundle.
cp plugin.json package.json LICENSE "$STAGE/"
cp dist/index.js dist/index.js.map "$STAGE/dist/"
zip -qr deckfaqs.zip "$STAGE"
tar -czf deckfaqs.tar.gz "$STAGE"
rm -rf "$STAGE"
# Checksums are attached to the GitHub release; scripts/install_plugin.sh verifies against them.
sha256sum deckfaqs.zip deckfaqs.tar.gz > SHA256SUMS
echo "Created deckfaqs.zip, deckfaqs.tar.gz and SHA256SUMS"
