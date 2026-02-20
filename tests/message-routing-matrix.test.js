import fs from 'fs';

function extractRouterActions(source) {
  const mapMatch = source.match(/const ACTION_HANDLERS = \{([\s\S]*?)\n\};/);
  if (!mapMatch) return [];

  const actions = [];
  const keyRegex = /^\s*([a-zA-Z0-9_]+)\s*:/gm;
  let match = keyRegex.exec(mapMatch[1]);
  while (match) {
    actions.push(match[1]);
    match = keyRegex.exec(mapMatch[1]);
  }
  return actions;
}

function extractDocumentedActions(markdown) {
  const actions = [];
  const rowRegex = /^\|\s*`([^`]+)`\s*\|/gm;
  let match = rowRegex.exec(markdown);
  while (match) {
    actions.push(match[1]);
    match = rowRegex.exec(markdown);
  }
  return actions;
}

describe('message routing matrix', () => {
  it('should document all registered router actions', () => {
    const routerSource = fs.readFileSync(
      new URL('../background/message-router.js', import.meta.url),
      'utf8',
    );
    const matrixSource = fs.readFileSync(
      new URL('../arch-docs/message-routing-matrix.md', import.meta.url),
      'utf8',
    );

    const routerActions = extractRouterActions(routerSource).sort();
    const documentedActions = extractDocumentedActions(matrixSource).sort();

    expect(documentedActions).toEqual(routerActions);
  });
});
