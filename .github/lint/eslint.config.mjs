// eslint config for the build check's step "Lint (warnings only)", issue #1343.
// Every rule is "warn", so eslint never exits 1 over a finding. No imports,
// because scripts/dev/Lint.ps1 keeps the pinned eslint in its own folder under
// -Tools (by default %LOCALAPPDATA%\Thornswood\lint-tools\eslint-<version>),
// away from this repository, and a plugin import from here would not resolve.
// Bug patterns only, no style rules.
export default [
  { ignores: ['engine/**', '**/node_modules/**', '**/*.min.js', 'launcher/**/bin/**', 'launcher/**/obj/**'] },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-unreachable': 'warn',
      'no-dupe-keys': 'warn',
      'no-duplicate-case': 'warn',
      'no-self-assign': 'warn',
      'no-self-compare': 'warn',
      'no-cond-assign': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-redeclare': 'warn',
      'no-unsafe-finally': 'warn',
      'use-isnan': 'warn',
      'valid-typeof': 'warn',
    },
  },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module' } },
  // A harness or a tool is a CommonJS module, and one that cannot go on stops
  // with a top-level return after setting process.exitCode, since node's exit
  // function can hang on Node 24 (#6036).
  { files: ['tests/**/*.js', '**/tests/**/*.js', 'scripts/**/*.js', 'site/server.js'], languageOptions: { sourceType: 'commonjs' } },
];
