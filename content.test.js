/**
 * @jest-environment jsdom
 */

// Mock the chrome API
global.chrome = require('./mocks/chrome');

// Setup document.body
document.body = document.createElement('body');

// Setup global variables
global.highlights = [];
global.currentUrl = 'http://example.com';
global.DEBUG_MODE = false;
global.COLORS = [{ nameKey: 'yellow', color: 'yellow' }];

// Mock functions
const mockGetXPathForElement = jest.fn(element => `/mock/path/to/${element.tagName.toLowerCase()}`);
const mockAddHighlightEventListeners = jest.fn();
const mockUpdateMinimapMarkers = jest.fn();
const mockSaveHighlights = jest.fn();

// Import content.js implementation for testing
const contentModule = require('./content');
const { highlightSelectedText, highlights } = contentModule;

// Mock window.getSelection
const createMockSelection = (selectedText, range) => ({
  toString: jest.fn(() => selectedText),
  getRangeAt: jest.fn(() => range),
  removeAllRanges: jest.fn(),
  rangeCount: 1
});

describe('highlightSelectedText', () => {
  let originalGetSelection;

  beforeEach(() => {
    document.body.innerHTML = '';
    highlights.length = 0;
    jest.clearAllMocks();
    // Spy on module functions
    jest.spyOn(contentModule, 'getXPathForElement').mockImplementation(mockGetXPathForElement);
    jest.spyOn(contentModule, 'addHighlightEventListeners').mockImplementation(mockAddHighlightEventListeners);
    jest.spyOn(contentModule, 'updateMinimapMarkers').mockImplementation(mockUpdateMinimapMarkers);
    jest.spyOn(contentModule, 'saveHighlights').mockImplementation(mockSaveHighlights);

    // Mock Date.now
    jest.spyOn(Date, 'now').mockImplementation(() => 1234567890123);

    // Save original getSelection
    originalGetSelection = window.getSelection;
  });

  afterEach(() => {
    window.getSelection = originalGetSelection;
    jest.restoreAllMocks();
  });

  test('should highlight simple text within a single paragraph', () => {
    // Setup test DOM
    document.body.innerHTML = '<p id="p1">This is a test sentence.</p>';
    const p1 = document.getElementById('p1');

    // Create range for selection
    const range = document.createRange();
    range.setStart(p1.firstChild, 8);
    range.setEnd(p1.firstChild, 18);

    // Mock selection
    const removeAllRanges = jest.fn();
    range.surroundContents = (node) => {
      const content = range.extractContents();
      node.appendChild(content);
      range.insertNode(node);
    };
    window.getSelection = jest.fn(() => ({
      toString: jest.fn(() => 'a test sen'),
      getRangeAt: jest.fn(() => range),
      removeAllRanges,
      rangeCount: 1
    }));

    // Execute highlight
    highlightSelectedText('yellow');

    // Assertions
    const highlightSpan = document.querySelector('.text-highlighter-extension');
    expect(highlightSpan).not.toBeNull();
    expect(highlightSpan.textContent).toBe('a test sen');
    expect(highlightSpan.style.backgroundColor).toBe('yellow');
    expect(highlightSpan.dataset.highlightId).toBe('1234567890123');

    // Check global state
    expect(highlights.length).toBe(1);
    expect(highlights[0]).toEqual({
      id: '1234567890123',
      text: 'a test sen',
      color: 'yellow',
      xpath: expect.any(String),
      position: expect.any(Number)
    });

    // Ensure selection is cleared
    expect(window.getSelection().removeAllRanges).toHaveBeenCalled();
  });

  test('should not highlight if selection is empty after trim', () => {
    // Setup test DOM
    document.body.innerHTML = '<p id="p1">   </p>';
    const p1 = document.getElementById('p1');

    // Create range for selection
    const range = document.createRange();
    range.setStart(p1.firstChild, 0);
    range.setEnd(p1.firstChild, 3);

    // Mock selection
    window.getSelection = jest.fn(() => createMockSelection('   ', range));

    // Execute highlight
    highlightSelectedText('yellow');

    // Assertions
    expect(document.querySelector('.text-highlighter-extension')).toBeNull();
    expect(highlights.length).toBe(0);
  });

  test('should highlight text spanning multiple elements', () => {
    // Setup test DOM
    document.body.innerHTML = '<p id="p1">Part one <em>italic</em> text.</p>';
    const p1 = document.getElementById('p1');

    // Create range for selection
    const range = document.createRange();
    range.setStart(p1.firstChild, 5);
    range.setEnd(p1.lastChild, 5);

    // Mock selection
    range.surroundContents = (node) => {
      const content = range.extractContents();
      node.appendChild(content);
      range.insertNode(node);
    };
    window.getSelection = jest.fn(() => createMockSelection('one italic text', range));

    // Execute highlight
    highlightSelectedText('yellow');

    // Assertions
    const highlightSpan = document.querySelector('.text-highlighter-extension');
    expect(highlightSpan).not.toBeNull();
    expect(highlightSpan.textContent).toBe('one italic text');
    expect(highlights.length).toBe(1);
    expect(highlights[0].text).toBe('one italic text');
  });

  test('should highlight selection fully containing an element', () => {
    // Setup test DOM
    document.body.innerHTML = '<p id="p1">Text with <strong id="s1">important</strong> words.</p>';
    const strongNode = document.getElementById('s1');

    // Create range for selection
    const range = document.createRange();
    range.selectNodeContents(strongNode);

    // Mock selection
    const removeAllRanges = jest.fn();
    range.surroundContents = (node) => {
      const content = range.extractContents();
      node.appendChild(content);
      range.insertNode(node);
    };
    window.getSelection = jest.fn(() => ({
      toString: jest.fn(() => 'important'),
      getRangeAt: jest.fn(() => range),
      removeAllRanges,
      rangeCount: 1
    }));

    // Execute highlight
    highlightSelectedText('yellow');

    // Assertions
    const span = document.querySelector('.text-highlighter-extension');
    expect(span).not.toBeNull();
    expect(span.innerHTML).toContain('important');
    expect(highlights.length).toBe(1);
    expect(highlights[0].text).toBe('important');
    expect(removeAllRanges).toHaveBeenCalled();
  });

  test('should correctly highlight text within an anchor tag containing other elements', () => {
    // Setup test DOM
    document.body.innerHTML = '<p>Test <a id="link" href="https://example.com">link <em>with emphasis</em></a> end.</p>';
    const link = document.getElementById('link');
    const textNode = link.firstChild;
    const emNode = link.querySelector('em');

    // Create range for selection
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(emNode.firstChild, emNode.firstChild.length);

    // Mock selection
    const removeAllRanges = jest.fn();
    range.surroundContents = (node) => {
      const content = range.extractContents();
      node.appendChild(content);
      range.insertNode(node);
    };
    window.getSelection = jest.fn(() => ({
      toString: jest.fn(() => 'link with emphasis'),
      getRangeAt: jest.fn(() => range),
      removeAllRanges,
      rangeCount: 1
    }));

    // Execute highlight
    highlightSelectedText('orange');

    // Assertions
    const span = document.querySelector('#link > .text-highlighter-extension');
    expect(span).not.toBeNull();
    expect(span.style.backgroundColor).toBe('orange');
    expect(span.textContent).toBe('link with emphasis');
    expect(span.innerHTML).toContain('<em>with emphasis</em>');
    expect(highlights.length).toBe(1);
    expect(highlights[0].text).toBe('link with emphasis');
    expect(highlights[0].color).toBe('orange');
    expect(removeAllRanges).toHaveBeenCalled();
  });

  test('should handle selection that partially includes opening tag', () => {
    // Setup test DOM with a nested structure
    document.body.innerHTML = '<div id="d1">Start <div id="d2">Text nested</div> end</div>';
    const outerDiv = document.getElementById('d1');
    const innerDiv = document.getElementById('d2');

    // Create range for selection that includes opening tag
    const range = document.createRange();
    range.setStart(outerDiv.firstChild, 2); // "art <div"의 시작
    range.setEnd(innerDiv.firstChild, innerDiv.firstChild.length); // "Text nested"의 끝

    // Mock selection
    const removeAllRanges = jest.fn();
    range.surroundContents = () => {
      throw new Error('InvalidStateError');
    };
    range.extractContents = range.extractContents.bind(range);
    range.insertNode = range.insertNode.bind(range);
    window.getSelection = jest.fn(() => ({
      toString: jest.fn(() => 'art <div>Text nested'),
      getRangeAt: jest.fn(() => range),
      removeAllRanges,
      rangeCount: 1
    }));

    // Execute highlight
    highlightSelectedText('yellow');    // Assertions
    const span = document.querySelector('.text-highlighter-extension');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('art Text nested');
    expect(highlights.length).toBe(1);
    expect(highlights[0].text).toBe('art Text nested');
    expect(removeAllRanges).toHaveBeenCalled();
  });

  test('should handle selection that partially includes closing tag', () => {
    // Setup test DOM
    document.body.innerHTML = '<div id="d1">Start <div id="d2">text</div> end</div>';
    const innerDiv = document.getElementById('d2');
    const lastTextNode = innerDiv.nextSibling;

    // Create range for selection that includes closing tag
    const range = document.createRange();
    range.setStart(innerDiv.firstChild, 0); // "text"의 시작
    range.setEnd(lastTextNode, 4); // "</div> end"의 일부

    // Mock selection
    const removeAllRanges = jest.fn();
    range.surroundContents = () => {
      throw new Error('InvalidStateError');
    };
    range.extractContents = range.extractContents.bind(range);
    range.insertNode = range.insertNode.bind(range);
    window.getSelection = jest.fn(() => ({
      toString: jest.fn(() => 'text</div> end'),
      getRangeAt: jest.fn(() => range),
      removeAllRanges,
      rangeCount: 1
    }));

    // Execute highlight
    highlightSelectedText('yellow');    // Assertions
    const span = document.querySelector('.text-highlighter-extension');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('text end');
    expect(highlights.length).toBe(1);
    expect(highlights[0].text).toBe('text end');
    expect(removeAllRanges).toHaveBeenCalled();
  });

  test('should highlight a full single paragraph without extra placeholders', () => {
    // Setup test DOM with one paragraph
    document.body.innerHTML = '<p id="p1">A complete paragraph.</p>';
    const p1 = document.getElementById('p1');

    // Create range for selection (entire paragraph content)
    const range = document.createRange();
    range.selectNodeContents(p1);

    const removeAllRanges = jest.fn();
    range.surroundContents = node => {
      const content = range.extractContents();
      node.appendChild(content);
      range.insertNode(node);
    };
    window.getSelection = jest.fn(() => ({
      toString: jest.fn(() => 'A complete paragraph.'),
      getRangeAt: jest.fn(() => range),
      removeAllRanges,
      rangeCount: 1
    }));

    // Execute highlight
    highlightSelectedText('yellow');

    // Assertions
    const spans = document.querySelectorAll('.text-highlighter-extension');
    expect(spans.length).toBe(1);
    const span = spans[0];
    expect(span.textContent).toBe('A complete paragraph.');
    expect(span.style.backgroundColor).toBe('yellow');
    expect(span.dataset.highlightId).toBeDefined();

    // Ensure no extra paragraphs were created
    const paras = document.querySelectorAll('p');
    expect(paras.length).toBe(1);

    // Global state
    expect(highlights.length).toBe(1);
    expect(highlights[0].text).toBe('A complete paragraph.');

    // Ensure selection is cleared
    expect(removeAllRanges).toHaveBeenCalled();
  });

});
