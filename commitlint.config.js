// Conventional commits are what drive semantic-release (see .releaserc.json):
// fix -> patch, feat -> minor, "feat!:" / "BREAKING CHANGE:" -> major.
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'header-max-length': [2, 'always', 100],
        // Release notes / long URLs in bodies are fine.
        'body-max-line-length': [0],
        'footer-max-line-length': [0],
    },
};
