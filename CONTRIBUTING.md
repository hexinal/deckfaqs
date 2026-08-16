# Contributing to DeckFAQs

## Development setup

Requirements: Node 22 (see `.nvmrc`), [pnpm](https://pnpm.io) (version pinned via `packageManager` in `package.json`), optionally [go-task](https://taskfile.dev). Easiest setup with [fnm](https://github.com/Schniz/fnm) — it switches Node automatically from `.nvmrc`, and Corepack provides the pinned pnpm:

```sh
curl -fsSL https://fnm.vercel.app/install | bash   # then restart your shell
fnm install 22 && corepack enable pnpm
```

```sh
pnpm install          # also installs the git hooks (husky)
pnpm build            # bundle src/index.tsx -> dist/index.js
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint .            (lint:fix to auto-fix)
pnpm format           # prettier --write .   (format:check in CI)
pnpm package          # build output -> deckfaqs.zip / deckfaqs.tar.gz (or: task package)
```

There is no Python backend and no test suite; changes are verified on a Steam Deck.

## Testing on a Steam Deck

Either unzip `deckfaqs.zip` into `/home/deck/homebrew/plugins/` (or use Decky → Developer → _Install Plugin from ZIP_), or copy `plugin.json`, `package.json` and `dist/index.js` into `/home/deck/homebrew/plugins/deckfaqs/` (bundle at `dist/index.js`) and run `sudo systemctl restart plugin_loader`. `scripts/uninstall.sh` removes the plugin again.

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

Dependency updates: Dependabot only opens **security** PRs here (`.github/dependabot.yml`); they use `fix(deps)`/`chore(deps)`/`ci(deps)` prefixes so a vulnerable runtime dependency ships as a patch release while dev-dependency/Actions bumps don't release. Regular version bumps are done by hand.

## Pull requests

- Branch off `main`, open a PR against `main`. CI runs format check, ESLint, type-check, build and packaging; the built zip is available as a workflow artifact. Merging requires those checks to be green.
- ESLint (`eslint.config.js`: `@eslint/js` + `typescript-eslint` recommended + `react-hooks`, prettier-compatible) currently runs _warn-first_: rules that fire on the existing code (`no-explicit-any`, `ban-ts-comment`, `prefer-const`, …) are warnings until the code is cleaned up. Don't add new warnings; fixing existing ones is welcome.
- Keep the code style: 4-space indent, single quotes, es5 trailing commas (`.prettierrc.json`, `.editorconfig`); CSS modules don't work under Decky's router, so styling is inline.
- When GameFAQs markup changes, the extraction scripts in `src/utils.ts` (`getGuideCode`), `src/components/ResultList.tsx` and `faqsNightmareRegex` in `src/constants.ts` are the usual suspects.
