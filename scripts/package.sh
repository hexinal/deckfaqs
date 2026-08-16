#!/usr/bin/env bash
# Package the built plugin into deckfaqs.zip and deckfaqs.tar.gz using the
# layout Decky Loader expects (unzip into /home/deck/homebrew/plugins/).
# Run `pnpm build` first. Used by CI (semantic-release) and `task package`.
#
# The archives are reproducible: file mtimes are pinned to SOURCE_DATE_EPOCH
# (defaults to the HEAD commit time), entries are sorted, and owner/uid/extra
# fields are stripped, so the same commit + lockfile yields identical bytes.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SOURCE_DATE_EPOCH:=$(git log -1 --format=%ct 2>/dev/null || date +%s)}"
export SOURCE_DATE_EPOCH

STAGE=deckfaqs
rm -rf "$STAGE" deckfaqs.zip deckfaqs.tar.gz SHA256SUMS
mkdir -p "$STAGE/dist"
# Decky needs package.json ("type": "module") next to plugin.json to load the ESM bundle.
cp plugin.json package.json LICENSE "$STAGE/"
cp dist/index.js dist/index.js.map "$STAGE/dist/"
find "$STAGE" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

# zip: -X drops uid/gid/extended timestamps; sorted input keeps entry order stable.
find "$STAGE" | LC_ALL=C sort | TZ=UTC zip -qX deckfaqs.zip -@
# tar: sorted, numeric root ownership, no gzip name/timestamp header.
tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner \
    -cf - "$STAGE" | gzip -n > deckfaqs.tar.gz
rm -rf "$STAGE"
# Checksums are attached to the GitHub release; scripts/install_plugin.sh verifies against them.
sha256sum deckfaqs.zip deckfaqs.tar.gz > SHA256SUMS
echo "Created deckfaqs.zip, deckfaqs.tar.gz and SHA256SUMS"
