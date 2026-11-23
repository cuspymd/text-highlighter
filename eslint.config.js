import fs from 'node:fs';
import globals from 'globals';

// Deliberately small: only rules that point at a bug or dead code, none about
// style. See arch-docs/code-review-2026-11.md (Test/CI).
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', {
    // `_message` keeps a handler's signature readable where the router passes
    // arguments the handler does not need.
    argsIgnorePattern: '^_',
    // `catch (error)` with the error unread is a choice, not a mistake.
    caughtErrors: 'none',
    // `const { spans, ...rest } = group` is how a key gets dropped.
    ignoreRestSiblings: true,
  }],
};

// Extension pages talk to the background through sendToBackground, which turns
// a background that is not listening into null. A bare runtime.sendMessage
// rejects there instead, and the click or page setup that awaited it stops
// silently. Content scripts are not modules and cannot import the helper.
const noBareRuntimeSendMessage = ['error', {
  selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='sendMessage'][callee.object.type='MemberExpression'][callee.object.property.name='runtime']",
  message: 'Send to the background with sendToBackground() from shared/runtime-message.js.',
}];

// The manifest injects the content scripts into one shared scope, in order, so
// they call each other's top-level functions without imports. Each script lists
// what it shares in a `/* exported a, b */` comment at its top; that comment
// tells no-unused-vars the names are used elsewhere, and here it becomes the
// globals every other content script may use. A name nobody exports is then
// undefined, exactly as it would be at runtime.
const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const contentScripts = manifest.content_scripts.flatMap(entry => entry.js);

function exportedNames(file) {
  const source = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
  const comment = source.match(/\/\*\s*exported\s+([^*]+)\*\//);
  const names = comment ? comment[1].split(',').map(name => name.trim()).filter(Boolean) : [];
  // A name left in the list after its declaration is gone would stay a global
  // here and hide every call to it from no-undef.
  for (const name of names) {
    const declared = new RegExp(`^(?:async\\s+)?(?:function\\s*\\*?|class|var|let|const)\\s+${name}\\b`, 'm');
    if (!declared.test(source)) {
      throw new Error(`${file} lists "${name}" in /* exported */ but does not declare it at the top level.`);
    }
  }
  return names;
}

const contentScriptGlobals = Object.fromEntries(
  contentScripts.flatMap(exportedNames).map(name => [name, 'writable']),
);

const extensionPageGlobals = { ...globals.browser, ...globals.webextensions };

export default [
  {
    ignores: ['node_modules/', 'dist/', 'dist-firefox/', 'outputs/', 'test-results/', 'worker/.wrangler/', '.artifacts/'],
  },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules,
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['background.js', 'background/**', 'constants/**', 'shared/**'],
    languageOptions: { globals: extensionPageGlobals },
  },
  {
    files: ['popup.js', 'settings.js', 'pages-list.js', 'onboarding.js'],
    languageOptions: { globals: extensionPageGlobals },
    rules: { 'no-restricted-syntax': noBareRuntimeSendMessage },
  },
  {
    files: ['content-scripts/**'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...extensionPageGlobals, ...contentScriptGlobals },
    },
  },
  {
    files: ['docs/**'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    files: ['tests/**', 'mocks/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.jest } },
  },
  {
    // page.evaluate() callbacks run in the extension, where chrome/browser exist.
    files: ['e2e-tests/**', 'e2e-tests-firefox/**'],
    languageOptions: { globals: { ...extensionPageGlobals, ...globals.node } },
    rules: {
      // Playwright sets up only the fixtures a test names, so a test may name
      // one (the background worker, say) just to have it running.
      'no-unused-vars': ['error', { ...rules['no-unused-vars'][1], args: 'none' }],
    },
  },
  {
    files: ['worker/**'],
    languageOptions: { globals: globals.serviceworker },
  },
];
