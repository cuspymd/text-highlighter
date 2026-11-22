import fs from 'fs';

// Chrome and Firefox each get their own manifest, and every entry they share is
// kept in step by hand. A content script, permission or command added to one
// file only would leave that feature missing on the other browser, with nothing
// failing until someone tried it there.
//
// What is meant to differ is left out: `background` (service worker vs. event
// page), `browser_specific_settings`, and the commands' suggested keys (Firefox
// assigns the highlight navigation shortcuts; Chrome allows only four).
const root = new URL('../', import.meta.url);

function readJson(path) {
  return JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
}

const chrome = readJson('manifest.json');
const firefox = readJson('manifest-firefox.json');

describe('Chrome and Firefox manifests', () => {
  it.each([
    'version',
    'default_locale',
    'permissions',
    'host_permissions',
    'content_scripts',
    'web_accessible_resources',
    'action',
    'icons',
  ])('declare the same %s', key => {
    expect(firefox[key]).toEqual(chrome[key]);
  });

  it('declare the same commands with the same descriptions', () => {
    const descriptions = manifest => Object.fromEntries(
      Object.entries(manifest.commands).map(([name, command]) => [name, command.description]),
    );
    expect(descriptions(firefox)).toEqual(descriptions(chrome));
  });

  // The build copies files and checks nothing, so a manifest naming a file that
  // is not there only shows up when the browser refuses to load the extension.
  it.each([
    ['manifest.json', chrome],
    ['manifest-firefox.json', firefox],
  ])('%s names only files that exist', (_name, manifest) => {
    const files = [
      manifest.background.service_worker,
      ...(manifest.background.scripts || []),
      manifest.action.default_popup,
      ...Object.values(manifest.action.default_icon || {}),
      ...Object.values(manifest.icons || {}),
      ...manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])]),
      ...manifest.web_accessible_resources.flatMap(entry => entry.resources),
    ].filter(Boolean);

    expect(files.length).toBeGreaterThan(10);
    const missing = files.filter(file => !fs.existsSync(new URL(file, root)));
    expect(missing).toEqual([]);
  });
});
