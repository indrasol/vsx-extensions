// @ts-check
// Reuses the repository's root ESLint config; only the type-aware root directory changes.
import config from '../../eslint.config.js';

export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Browser code is typed by tsconfig.webview.json (DOM, no node/vscode types).
    files: ['webview/**/*.ts', 'test/unit/webview/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.webview.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['media/webview.js', 'media/webview.css'],
  },
];
