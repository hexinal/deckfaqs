# Contributing to DeckFAQs

## Development setup

Requirements: Node 24 LTS (see `.nvmrc`; anything ≥ 22.13 works), [pnpm](https://pnpm.io) (version pinned via `packageManager` in `package.json`), optionally [go-task](https://taskfile.dev). Easiest setup with [fnm](https://github.com/Schniz/fnm) — it switches Node automatically from `.nvmrc`, and Corepack provides the pinned pnpm (Node ≥ 25 no longer bundles Corepack: `npm i -g corepack` first, or install pnpm any other way and it will honour `packageManager` itself):

```sh
curl -fsSL https://fnm.vercel.app/install | bash   # then restart your shell
fnm install 24 && corepack enable pnpm
```

```sh
pnpm install          # also installs the git hooks (husky)
pnpm build            # bundle src/index.tsx -> dist/index.js
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint .            (lint:fix to auto-fix)
pnpm test             # vitest run           (test:watch for watch mode)
pnpm test:smoke       # end-to-end run of the built dist/index.js in jsdom (after pnpm build)
pnpm knip             # unused files/exports/dependencies (knip.json)
pnpm format           # prettier --write .   (format:check in CI)
pnpm package          # build output -> deckfaqs.zip / deckfaqs.tar.gz (or: task package)
```

The only backend code is `main.py`, a minimal Decky Python plugin that keeps the last reading positions in `~/homebrew/settings/deckfaqs/positions.json` (`load_positions`/`save_positions`, called from `src/positions.ts` through `callable` from `@decky/api`); everything else is frontend. Unit tests (vitest + jsdom, `test/*.test.ts`) cover the reducer, URL/payload helpers, the request queue and the in-tab extraction scripts against saved GameFAQs and Neoseeker pages in `test/fixtures/` (Neoseeker pages must be saved from a real browser — the site blocks curl). `pnpm test:smoke` (`test/smoke/`) goes further: it loads the **built** `dist/index.js` in jsdom with fake `SP_REACT`/`DFL`/`SteamClient`/Decky-loader globals (`test/smoke/env.ts`) and drives the real UI through games → search → guide list → guide (incl. TOC, fullscreen search, error/retry), with the plugin's own extraction scripts running against the saved pages. CI runs both, so a dependency bump that breaks the plugin at runtime fails CI; only Steam-specific look & feel still needs a check on the Deck.

## Testing on a Steam Deck

Either unzip `deckfaqs.zip` into `/home/deck/homebrew/plugins/` (or use Decky → Developer → _Install Plugin from ZIP_), or copy `plugin.json`, `package.json`, `main.py` and `dist/index.js` into `/home/deck/homebrew/plugins/deckfaqs/` (bundle at `dist/index.js`) and run `sudo systemctl restart plugin_loader`. `scripts/uninstall.sh` removes the plugin again.

## Commit messages (this is what cuts releases)

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io) on every push to `main`. It reads [Conventional Commits](https://www.conventionalcommits.org) since the last tag and decides the version:

| Commit                                                | Release       |
| ----------------------------------------------------- | ------------- |
| `fix: …`, `perf: …`, `refactor: …`                    | patch (2.0.x) |
| `feat: …`                                             | minor (2.x.0) |
| `feat!: …` or a `BREAKING CHANGE:` footer             | major (x.0.0) |
| `chore:`, `ci:`, `docs:`, `build:`, `test:`, `style:` | no release    |

Never bump `package.json` by hand — the bot commits `chore(release): x.y.z [skip ci]`, tags, writes `CHANGELOG.md` and publishes the GitHub release with `deckfaqs.zip` / `deckfaqs.tar.gz`.

Commit messages are linted with [commitlint](https://commitlint.js.org) both locally (`.husky/commit-msg`) and in CI (`Lint commits` job); PR titles are linted as well because squash merges use the PR title as the commit message. `.husky/pre-commit` runs prettier on staged files. If you really need to skip the hooks once: `git commit --no-verify`.

Dependency updates: Dependabot opens security PRs plus one grouped minor/patch npm PR per month (majors individually; `.github/dependabot.yml`), with `fix(deps)`/`chore(deps)` prefixes so a runtime dependency bump ships as a patch release while dev-dependency bumps don't. Both Dependabot's `cooldown` and `pnpm.minimumReleaseAge` in `package.json` skip versions published less than 3 days ago (supply-chain guard), so a brand-new release may need to wait or be pinned explicitly. GitHub Actions are pinned to commit SHAs in the workflows and Dependabot keeps those pins current (`ci(deps)`, no release). Releases attach a `SHA256SUMS` file (`scripts/install_plugin.sh` verifies against it) and a build-provenance attestation (`gh attestation verify deckfaqs.zip -R hexinal/deckfaqs`); PRs get a dependency review and CI runs `pnpm audit --prod`.

## Pull requests

- Branch off `main`, open a PR against `main`. CI runs format check, ESLint, type-check, unit tests, knip, build, the bundle smoke test and packaging; the built zip is available as a workflow artifact. Merging requires those checks to be green.
- ESLint (`eslint.config.js`: `@eslint/js` + `typescript-eslint` recommended-type-checked + `react-hooks`, prettier-compatible) must pass with zero warnings (`pnpm lint`); type-only imports must use `import type` (`verbatimModuleSyntax`), promises must be awaited or explicitly `void`ed. Props/APIs the Steam client has but `@decky/ui` doesn't declare go into `src/decky-ui.d.ts` instead of `@ts-ignore`.
- Keep the code style: 4-space indent, single quotes, es5 trailing commas (`.prettierrc.json`, `.editorconfig`); CSS modules don't work under Decky's router, so styling is inline.
- When a site's markup changes, the in-tab extraction scripts and their parsers are the usual suspects: `src/sources/gamefaqs.ts` (`getGuideCode`, `getGuidesCode`, `getGamesCode`, `parseGuideList`, `parseSearchResults`) and `src/sources/neoseeker.ts` (`neoGuidesCode`, `neoGuideCode`, `parseNeoGuideList`, `parseQsPayload`) — update the fixture in `test/fixtures/` (save the page from a browser, strip `<script>` tags; Neoseeker fixtures end in a `<footer id="footer">` stub, which the extractors treat as "page fully loaded") so `test/extractors.test.ts` covers the new markup.
