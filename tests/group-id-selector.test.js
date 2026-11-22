import { jest } from '@jest/globals';
import fs from 'fs';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// An imported backup can carry any non-empty string as a groupId. These used to
// be pasted into a `[data-group-id='…']` selector, so a quote made
// querySelectorAll throw and the highlight could not be removed, recoloured or
// drawn on the minimap. Spans are now matched by comparing the attribute value.
const AWKWARD_IDS = ["it's", 'back\\slash', 'a]b', 'x"y'];

function groupSpans(groupId, texts) {
  const paragraph = document.createElement('p');
  texts.forEach(text => {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = groupId;
    span.style.backgroundColor = '#ffff00';
    span.textContent = text;
    paragraph.appendChild(span);
    paragraph.appendChild(document.createTextNode(' '));
  });
  document.body.appendChild(paragraph);
  return [...paragraph.querySelectorAll('.text-highlighter-extension')];
}

// The harness evaluates each script in its own scope, so a class declared in
// minimap.js is not visible afterwards; evaluate it here and hand the class back.
function loadMinimapManager() {
  const source = fs.readFileSync(new URL('../content-scripts/minimap.js', import.meta.url), 'utf8');
  return window.eval(`${source}\n;MinimapManager`);
}

describe('highlight actions with a groupId that is not selector-safe', () => {
  const palette = [{ id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' }];

  beforeAll(async () => {
    jest.useFakeTimers();
    resetContentScriptEnvironment();
    respondToBackground(message => {
      if (message.action === 'getPlatformInfo') return { isMobile: false };
      if (message.action === 'getColors') return { colors: palette };
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });
    respondToStorage({ minimapVisible: false, selectionControlsVisible: false });
    chrome.i18n.getMessage.mockImplementation(key => key);
    // Globals controls.js would define; it is stubbed here.
    window.currentColors = palette.slice();
    window.activeHighlightElement = null;
    window.highlightControlsContainer = null;

    loadContentScripts(['common', 'content']);
    await jest.advanceTimersByTimeAsync(600);
  });

  afterAll(() => {
    jest.useRealTimers();
    resetContentScriptEnvironment();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it.each(AWKWARD_IDS)('removes every span of group %p and leaves other groups', groupId => {
    const spans = groupSpans(groupId, ['first', 'second']);
    const [other] = groupSpans('plain', ['kept']);

    expect(() => window.TextHighlighterContentAPI.removeHighlightByElement(spans[0])).not.toThrow();

    spans.forEach(span => expect(span.isConnected).toBe(false));
    expect(other.isConnected).toBe(true);
  });

  it.each(AWKWARD_IDS)('recolours every span of group %p', groupId => {
    const spans = groupSpans(groupId, ['first', 'second']);
    const [other] = groupSpans('plain', ['kept']);

    expect(() => window.TextHighlighterContentAPI.changeHighlightColor(spans[0], '#00ff00')).not.toThrow();

    spans.forEach(span => expect(span.style.backgroundColor).toBe('rgb(0, 255, 0)'));
    expect(other.style.backgroundColor).toBe('rgb(255, 255, 0)');
  });

  it.each(AWKWARD_IDS)('draws a minimap marker with the whole text of group %p', groupId => {
    const spans = groupSpans(groupId, ['first', 'second']);
    const manager = new (loadMinimapManager())();
    manager.container = document.createElement('div');

    expect(() => manager.createMarker(spans[0], 1000, 300)).not.toThrow();

    const marker = manager.container.querySelector('.text-highlighter-minimap-marker');
    expect(marker.dataset.minimapTooltip).toBe('first second');
  });
});
