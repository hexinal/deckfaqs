# Security policy

DeckFAQs is a frontend-only Decky Loader plugin. It loads GameFAQs pages in a
hidden Steam browser view and renders sanitised guide HTML inside the Quick
Access Menu; it has no backend and stores no credentials.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
private vulnerability reporting instead:

https://github.com/hexinal/deckfaqs/security/advisories/new

You will get a response within a few days. Fixes ship as a normal patch
release (see the release process in `CONTRIBUTING.md`).

## Supported versions

Only the latest release is supported. Install it with `scripts/install_plugin.sh`,
which verifies the download against the `SHA256SUMS` file attached to each release.
