export const COLORS = [
  { id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' },
  { id: 'green', nameKey: 'greenColor', color: '#AAFFAA' },
  { id: 'blue', nameKey: 'blueColor', color: '#AAAAFF' },
  { id: 'pink', nameKey: 'pinkColor', color: '#FFAAFF' },
  { id: 'orange', nameKey: 'orangeColor', color: '#FFAA55' }
];

export function getMessage(key, substitutions = null) {
  return browser.i18n.getMessage(key, substitutions);
}
