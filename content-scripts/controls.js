const colorCore = window.TextHighlighterColorCore;

// Highlight controller UI container
let highlightControlsContainer = null;
let activeHighlightElement = null;
// Flag to know when the native <input type="color"> picker is open
let colorPickerOpen = false;
// Track the last added color to apply animation only to new colors
let lastAddedColor = null;

// Selection controls feature
let selectionControlsEnabled = false;
let selectionIcon = null;
let selectionControlsContainer = null;
let currentSelection = null;
let uiMountRoot = null;
let selectionViewportListenersAdded = false;
let selectionScrollRestoreTimer = null;
let selectionIconHiddenForScroll = false;

// One-click highlighting: an opt-in setting (default off) that turns the
// selection icon into "paint with the colour used last" instead of "open the
// palette". The palette is not lost by it - clicking the highlight that press
// created opens the same bar, which is also where a mispressed one is deleted.
let oneClickHighlightEnabled = false;
let lastUsedColorValue = null;
let lastUsedColorWatcherAdded = false;

const SELECTION_SCROLL_RESTORE_DELAY_MS = 220;

// Mobile platform detection
let isMobilePlatform = false;
const CONTROL_DRAG_PADDING = 10;

function getUiMountRoot() {
  if (uiMountRoot && uiMountRoot.isConnected) {
    return uiMountRoot;
  }

  const root = document.createElement('div');
  root.className = 'text-highlighter-ui-root';
  root.style.all = 'initial';
  root.style.display = 'contents';
  document.documentElement.appendChild(root);
  uiMountRoot = root;
  return root;
}

function enableTouchDragForControls(container) {
  if (!container || container.dataset.touchDragEnabled === 'true') return;
  container.dataset.touchDragEnabled = 'true';
  container.style.touchAction = 'none';

  let dragging = false;
  let moved = false;
  let startedInScroller = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;

    dragging = true;
    moved = false;
    // A touch that starts on an overflowing colour strip scrolls it
    // horizontally (touch-action: pan-x), so only its vertical component
    // moves the bar. Otherwise the two gestures fight over the first pixels.
    const scroller = e.target && typeof e.target.closest === 'function'
      ? e.target.closest('.text-highlighter-color-buttons')
      : null;
    startedInScroller = !!(scroller && scroller.classList.contains('is-scrollable'));
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;

    const rect = container.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    if (typeof container.setPointerCapture === 'function') {
      container.setPointerCapture(pointerId);
    }
  }, { passive: true });

  container.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;

    const dx = startedInScroller ? 0 : e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      moved = true;
    }
    if (!moved) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    let minLeft = CONTROL_DRAG_PADDING;
    let maxLeft = window.innerWidth - width - CONTROL_DRAG_PADDING;
    if (maxLeft < minLeft) {
      minLeft = maxLeft;
      maxLeft = CONTROL_DRAG_PADDING;
    }

    const minTop = CONTROL_DRAG_PADDING;
    const maxTop = Math.max(CONTROL_DRAG_PADDING, window.innerHeight - height - CONTROL_DRAG_PADDING);

    const nextLeft = clamp(startLeft + dx, Math.min(minLeft, maxLeft), Math.max(minLeft, maxLeft));
    const nextTop = clamp(startTop + dy, minTop, maxTop);

    container.style.left = `${nextLeft}px`;
    container.style.top = `${nextTop}px`;
    e.preventDefault();
  }, { passive: false });

  const finishDrag = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;

    if (moved) {
      container.dataset.justDragged = 'true';
      setTimeout(() => {
        if (container.dataset.justDragged === 'true') {
          delete container.dataset.justDragged;
        }
      }, 180);
    }

    dragging = false;
    moved = false;
    startedInScroller = false;

    if (typeof container.releasePointerCapture === 'function') {
      try {
        container.releasePointerCapture(pointerId);
      } catch (err) {
        // Ignore release errors when capture state changed externally.
      }
    }
    pointerId = null;
  };

  container.addEventListener('pointerup', finishDrag);
  container.addEventListener('pointercancel', finishDrag);

  container.addEventListener('click', (e) => {
    if (container.dataset.justDragged === 'true') {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

function getContentApi() {
  return window.TextHighlighterContentAPI || null;
}

function removeHighlightViaApi(element) {
  const contentApi = getContentApi();
  if (contentApi && typeof contentApi.removeHighlightByElement === 'function') {
    contentApi.removeHighlightByElement(element);
    return;
  }
  if (typeof removeHighlight === 'function') {
    removeHighlight(element);
  }
}

function changeHighlightColorViaApi(element, color) {
  const contentApi = getContentApi();
  if (contentApi && typeof contentApi.changeHighlightColor === 'function') {
    contentApi.changeHighlightColor(element, color);
    return;
  }
  if (typeof changeHighlightColor === 'function') {
    changeHighlightColor(element, color);
  }
}

function highlightSelectionViaApi(color) {
  const contentApi = getContentApi();
  if (contentApi && typeof contentApi.highlightSelection === 'function') {
    contentApi.highlightSelection(color);
    return;
  }
  if (typeof highlightSelectedText === 'function') {
    highlightSelectedText(color);
  }
}

// Helper function for jelly animation
function addJellyAnimation(btn) {
  btn.addEventListener('click', function () {
    btn.classList.remove('jelly-animate');
    void btn.offsetWidth;
    btn.classList.add('jelly-animate');
  });
  btn.addEventListener('animationend', function (e) {
    if (e.animationName === 'jelly-bounce') {
      btn.classList.remove('jelly-animate');
    }
  });
}

// Create highlight controller UI
function createHighlightControls() {
  if (highlightControlsContainer) return;
  highlightControlsContainer = document.createElement('div');
  highlightControlsContainer.className = 'text-highlighter-controls';
  const deleteButton = document.createElement('div');
  deleteButton.className = 'text-highlighter-control-button delete-highlight';
  deleteButton.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="4" y1="4" x2="12" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
  deleteButton.title = getMessage('deleteHighlight');
  deleteButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      removeHighlightViaApi(activeHighlightElement);
    }
    e.stopPropagation();
  });
  // The colours sit in a horizontally scrollable strip so the bar never grows
  // past the viewport on narrow screens. The delete and '+' buttons stay
  // outside the strip and are always reachable.
  const colorScrollWrapper = document.createElement('div');
  colorScrollWrapper.className = 'text-highlighter-color-scroll';
  const colorButtonsContainer = document.createElement('div');
  colorButtonsContainer.className = 'text-highlighter-color-buttons';
  appendColorButtons(colorButtonsContainer);
  colorScrollWrapper.appendChild(colorButtonsContainer);
  highlightControlsContainer.appendChild(deleteButton);
  highlightControlsContainer.appendChild(colorScrollWrapper);
  highlightControlsContainer.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  // -------------- '+' button (add new color) --------------
  const addColorBtn = createAddColorButton();
  highlightControlsContainer.appendChild(addColorBtn);
  getUiMountRoot().appendChild(highlightControlsContainer);
  enableTouchDragForControls(highlightControlsContainer);
  bindColorScrollHints(highlightControlsContainer);
  // A rotation can make a strip that fitted overflow (or the reverse) while a
  // bar is open, and the touch-action handoff depends on knowing which.
  window.addEventListener('resize', refreshOpenColorScrollHints, { passive: true });
}

function refreshOpenColorScrollHints() {
  if (highlightControlsContainer && highlightControlsContainer.classList.contains('visible')) {
    updateColorScrollHints(highlightControlsContainer);
  }
  if (selectionControlsContainer && selectionControlsContainer.isConnected) {
    updateColorScrollHints(selectionControlsContainer);
  }
}

// Fill a colour strip: the five defaults, a separator, then the custom colours.
function appendColorButtons(colorButtonsContainer) {
  currentColors.forEach((colorInfo, idx) => {
    if (idx === 5 && currentColors.length > 5) {
      appendColorSeparator(colorButtonsContainer);
    }
    const colorButton = createColorButton(colorInfo);
    colorButtonsContainer.appendChild(colorButton);
  });
}

// Show a fade on whichever side of the colour strip still has colours hidden,
// and hand horizontal touch gestures to the strip only while it overflows.
function updateColorScrollHints(container) {
  if (!container) return;
  const scroller = container.querySelector('.text-highlighter-color-buttons');
  if (!scroller) return;
  const maxScroll = scroller.scrollWidth - scroller.clientWidth;
  const scrollable = maxScroll > 1;
  scroller.classList.toggle('is-scrollable', scrollable);
  const wrapper = scroller.parentElement;
  if (wrapper && wrapper.classList.contains('text-highlighter-color-scroll')) {
    wrapper.classList.toggle('can-scroll-left', scrollable && scroller.scrollLeft > 1);
    wrapper.classList.toggle('can-scroll-right', scrollable && scroller.scrollLeft < maxScroll - 1);
  }
}

function bindColorScrollHints(container) {
  if (!container) return;
  const scroller = container.querySelector('.text-highlighter-color-buttons');
  if (!scroller) return;
  scroller.addEventListener('scroll', () => {
    const wrapper = scroller.parentElement;
    if (wrapper && scroller.scrollLeft > 1) {
      wrapper.classList.add('has-scrolled');
    }
    updateColorScrollHints(container);
  }, { passive: true });
}

// The bar is display: none until it gets the visible class, so it has to be
// laid out briefly to know how wide it is.
function measureControlsWidth(container) {
  const previousDisplay = container.style.display;
  const previousVisibility = container.style.visibility;
  container.style.display = 'flex';
  container.style.visibility = 'hidden';
  const width = container.getBoundingClientRect().width;
  container.style.display = previousDisplay;
  container.style.visibility = previousVisibility;
  return width;
}

// The name a colour goes by in a tooltip: the one it was renamed to, the
// numbered default for a custom colour, or the translated name of a built-in.
function colorDisplayName(colorInfo) {
  if (!colorInfo) return '';
  if (colorInfo.customName) return colorInfo.customName;
  if (colorInfo.id && colorInfo.id.startsWith('custom_')) {
    const baseName = getMessage('customColor') || 'Custom Color';
    return colorInfo.colorNumber ? `${baseName} ${colorInfo.colorNumber}` : baseName;
  }
  return getMessage(colorInfo.nameKey);
}

// create colorButton (reusable function)
function createColorButton(colorInfo) {
  const colorButton = document.createElement('div');
  colorButton.className = 'text-highlighter-control-button color-button';
  colorButton.style.backgroundColor = colorInfo.color;
  colorButton.title = colorDisplayName(colorInfo);
  colorButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      changeHighlightColorViaApi(activeHighlightElement, colorInfo.color);
    }
    e.stopPropagation();
  });
  
  addJellyAnimation(colorButton);
  
  // Add animation effect only to the newly added color
  if (lastAddedColor && colorInfo.color === lastAddedColor) {
    colorButton.classList.add('new-color-animate');
    // Remove class after animation completion
    colorButton.addEventListener('animationend', function(e) {
      if (e.animationName === 'pop-in-new-color') {
        colorButton.classList.remove('new-color-animate');
        lastAddedColor = null; // Initialize after animation completion
      }
    });
  }
  
  return colorButton;
}

// create addColorBtn (reusable function)
//
// `onColorSelect` is what a picked colour does: the highlight bar adds it to the
// palette, the selection bar adds it and paints the selection with it.
function createAddColorButton(onColorSelect = addCustomColor) {
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="8" y1="3" x2="8" y2="13" stroke="#999" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="8" x2="13" y2="8" stroke="#999" stroke-width="2" stroke-linecap="round"/></svg>`;
  addColorBtn.title = getMessage('addColor') || '+';

  // A mousedown the page never sees leaves the text selection where it is.
  addColorBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  // Add custom color picker event
  addColorBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Ignore if color picker is already open
    const existingPicker = document.querySelector('.custom-color-picker');
    if (existingPicker) {
      return;
    }
    
    colorPickerOpen = true;
    showCustomColorPicker(addColorBtn, onColorSelect);
  });
  
  return addColorBtn;
}

// Variable to track the currently active closeHandler
let currentCloseHandler = null;

// Common color picker UI creation function
function createColorPickerUI() {
  // Color preset array
  const presetColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F39C12', '#E74C3C', '#9B59B6', '#3498DB', '#1ABC9C',
    '#2ECC71', '#F1C40F', '#E67E22', '#FF90A0', '#A8E6CF'
  ];
  
  // Create custom color picker
  const customColorPicker = document.createElement('div');
  customColorPicker.className = 'custom-color-picker';

  // Dragging the sliders must not start a page selection, and clicking the
  // header must not collapse the one the selection bar is about to paint.
  // Cancelling mousedown keeps the browser out of the selection entirely; the
  // sliders' own mousedown handlers still run, and the buttons still click.
  customColorPicker.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  // Create header
  const header = document.createElement('div');
  header.className = 'color-picker-header';
  header.textContent = browserAPI.i18n.getMessage('selectColor');
  customColorPicker.appendChild(header);
  
  // Create color preset grid
  const presetGrid = document.createElement('div');
  presetGrid.className = 'color-preset-grid';
  
  presetColors.forEach(color => {
    const colorDiv = document.createElement('div');
    colorDiv.className = 'color-preset';
    colorDiv.style.backgroundColor = color;
    colorDiv.dataset.color = color;
    presetGrid.appendChild(colorDiv);
  });
  
  customColorPicker.appendChild(presetGrid);
  
  // Create custom color section
  const customSection = document.createElement('div');
  customSection.className = 'custom-color-section';
  
  // Hue slider container
  const hueContainer = document.createElement('div');
  hueContainer.className = 'hue-slider-container';
  
  const hueSlider = document.createElement('div');
  hueSlider.className = 'hue-slider';
  hueSlider.id = 'hueSlider';
  
  const hueHandle = document.createElement('div');
  hueHandle.className = 'hue-handle';
  hueHandle.id = 'hueHandle';
  
  hueSlider.appendChild(hueHandle);
  hueContainer.appendChild(hueSlider);
  customSection.appendChild(hueContainer);
  
  // Saturation-Value picker
  const svPicker = document.createElement('div');
  svPicker.className = 'saturation-value-picker';
  svPicker.id = 'svPicker';
  
  const svHandle = document.createElement('div');
  svHandle.className = 'sv-handle';
  svHandle.id = 'svHandle';
  
  svPicker.appendChild(svHandle);
  customSection.appendChild(svPicker);
  
  // Color preview
  const colorPreview = document.createElement('div');
  colorPreview.className = 'color-preview';
  colorPreview.id = 'colorPreview';
  colorPreview.style.backgroundColor = '#FF6B6B';
  customSection.appendChild(colorPreview);
  
  customColorPicker.appendChild(customSection);
  
  // Create buttons section
  const buttonsSection = document.createElement('div');
  buttonsSection.className = 'color-picker-buttons';
  
  const applyButton = document.createElement('button');
  applyButton.className = 'color-picker-apply';
  applyButton.id = 'applyColor';
  applyButton.textContent = browserAPI.i18n.getMessage('apply');
  
  const cancelButton = document.createElement('button');
  cancelButton.className = 'color-picker-close';
  cancelButton.textContent = browserAPI.i18n.getMessage('cancel');
  
  buttonsSection.appendChild(applyButton);
  buttonsSection.appendChild(cancelButton);
  customColorPicker.appendChild(buttonsSection);
  
  return customColorPicker;
}

// Color picker common event handling function
function setupColorPickerEvents(customColorPicker, triggerButton, onColorSelect, onClose) {
  // Color selection event
  customColorPicker.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-preset')) {
      e.stopPropagation();
      const color = e.target.dataset.color;
      onColorSelect(color);
      onClose();
    } else if (e.target.classList.contains('color-picker-close')) {
      e.stopPropagation();
      onClose();
    } else if (e.target.classList.contains('color-picker-apply')) {
      e.stopPropagation();
      const preview = customColorPicker.querySelector('.color-preview');
      const color = rgbToHex(preview.style.backgroundColor);
      onColorSelect(color);
      onClose();
    }
  });
  
  // Close on outside click
  setTimeout(() => {
    currentCloseHandler = function(e) {
      if (!customColorPicker.contains(e.target) && !triggerButton.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('click', currentCloseHandler);
  }, 10);
}

// Create and display custom color picker (reusable function)
function showCustomColorPicker(triggerButton, onColorSelect = addCustomColor) {
  // Remove existing color picker if any
  const existingPicker = document.querySelector('.custom-color-picker');
  if (existingPicker) {
    existingPicker.remove();
  }
  
  // Remove previous closeHandler if any
  if (currentCloseHandler) {
    document.removeEventListener('click', currentCloseHandler);
    currentCloseHandler = null;
  }
  
  // Create color picker UI
  const customColorPicker = createColorPickerUI();

  getUiMountRoot().appendChild(customColorPicker);

  // Position setting: align picker to the right edge of controls by default,
  // then clamp inside viewport to keep it fully reachable on small screens.
  const controlsContainer = triggerButton.closest('.text-highlighter-controls');
  const anchorRect = controlsContainer
    ? controlsContainer.getBoundingClientRect()
    : triggerButton.getBoundingClientRect();
  const pickerWidth = customColorPicker.offsetWidth;
  const pickerHeight = customColorPicker.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewportPadding = 8;
  const gap = 5;

  const belowTop = anchorRect.bottom + gap;
  const aboveTop = anchorRect.top - pickerHeight - gap;
  const canPlaceBelow = belowTop + pickerHeight <= viewportHeight - viewportPadding;
  const preferredTop = canPlaceBelow ? belowTop : aboveTop;
  const topPosition = Math.min(
    Math.max(preferredTop, viewportPadding),
    viewportHeight - pickerHeight - viewportPadding
  );
  const rightAlignedLeft = anchorRect.right - pickerWidth;
  const clampedLeft = Math.min(
    Math.max(rightAlignedLeft, viewportPadding),
    viewportWidth - pickerWidth - viewportPadding
  );

  customColorPicker.style.top = `${topPosition}px`;
  customColorPicker.style.left = `${clampedLeft}px`;
  
  // Initialize HSV sliders
  initHSVSliders(customColorPicker);
  
  // Remove closeHandler and close picker common function
  const closeColorPicker = () => {
    customColorPicker.remove();
    colorPickerOpen = false;
    if (currentCloseHandler) {
      document.removeEventListener('click', currentCloseHandler);
      currentCloseHandler = null;
    }
  };

  // Set events
  setupColorPickerEvents(customColorPicker, triggerButton, onColorSelect, closeColorPicker);
}

// Custom color addition function. Resolves once the palette has been updated,
// or once the attempt has failed - either way the caller may go on.
function addCustomColor(color) {
  lastAddedColor = color;
  return browserAPI.runtime.sendMessage({ action: 'addColor', color: color })
    .then(response => {
      if (response && response.colors) {
        currentColors = response.colors;
        refreshHighlightControlsColors();
      }
    })
    .catch(error => debugLog('Failed to add custom color:', error));
}

// The selection bar's '+': paint the selection with the colour, and add it to
// the palette. Whoever opened a picker from a selection meant to highlight in
// that colour, so there is no second step of finding it in the strip.
//
// The paint comes first and does not wait for the palette write. The picker
// has closed by now, so nothing keeps the stored range safe while a waking
// background takes its time to answer - and a highlight is saved by its colour
// value, not by the palette, so it needs nothing from that answer.
function addCustomColorAndHighlight(color) {
  createHighlightWithColor(color);
  return addCustomColor(color);
}

// HSV to RGB conversion function
// Colour maths lives in color-core.js, which the manifest loads first. These
// stay as names the rest of this file already calls.
function hsvToRgb(h, s, v) {
  return colorCore.hsvToRgb(h, s, v);
}

function rgbToHex(rgb) {
  return colorCore.rgbToHex(rgb);
}

function hslToHex(hsl) {
  return colorCore.hslToHex(hsl);
}

function initHSVSliders(picker) {
  // Check if elements exist
  const hueSlider = picker.querySelector('#hueSlider');
  const hueHandle = picker.querySelector('#hueHandle');
  const svPicker = picker.querySelector('#svPicker');
  const svHandle = picker.querySelector('#svHandle');
  const colorPreview = picker.querySelector('#colorPreview');
  
  if (!hueSlider || !hueHandle || !svPicker || !svHandle || !colorPreview) {
    return; // Do not initialize if required elements are missing
  }
  
  let currentHue = 0;
  let currentSaturation = 100;
  let currentValue = 100;
  
  // Hue slider events
  let isDraggingHue = false;

  function updateHueAt(clientX) {
    const rect = hueSlider.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    currentHue = (x / rect.width) * 360;
    hueHandle.style.left = `${x}px`;
    updateSVBackground();
    updateColorPreview();
  }

  // Mouse handlers for hue slider
  const hueMouseMoveHandler = (e) => { if (isDraggingHue) updateHueAt(e.clientX); };
  const hueMouseUpHandler = () => {
    isDraggingHue = false;
    document.removeEventListener('mousemove', hueMouseMoveHandler);
    document.removeEventListener('mouseup', hueMouseUpHandler);
  };

  hueSlider.addEventListener('mousedown', (e) => {
    isDraggingHue = true;
    updateHueAt(e.clientX);
    document.addEventListener('mousemove', hueMouseMoveHandler);
    document.addEventListener('mouseup', hueMouseUpHandler);
  });

  // Touch handlers for hue slider
  const hueTouchMoveHandler = (e) => {
    if (isDraggingHue) {
      e.preventDefault();
      updateHueAt(e.touches[0].clientX);
    }
  };
  const hueTouchEndHandler = () => {
    isDraggingHue = false;
    document.removeEventListener('touchmove', hueTouchMoveHandler);
    document.removeEventListener('touchend', hueTouchEndHandler);
  };

  hueSlider.addEventListener('touchstart', (e) => {
    isDraggingHue = true;
    updateHueAt(e.touches[0].clientX);
    document.addEventListener('touchmove', hueTouchMoveHandler, { passive: false });
    document.addEventListener('touchend', hueTouchEndHandler);
  }, { passive: true });

  // Saturation/Value picker events
  let isDraggingSV = false;

  function updateSVAt(clientX, clientY) {
    const rect = svPicker.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    // x-axis: 0 (left/low saturation) -> 100 (right/high saturation)
    currentSaturation = (x / rect.width) * 100;
    // y-axis: 100 (top/high value) -> 0 (bottom/low value)
    currentValue = 100 - (y / rect.height) * 100;
    svHandle.style.left = `${x}px`;
    svHandle.style.top = `${y}px`;
    updateColorPreview();
  }

  // Mouse handlers for SV picker
  const svMouseMoveHandler = (e) => { if (isDraggingSV) updateSVAt(e.clientX, e.clientY); };
  const svMouseUpHandler = () => {
    isDraggingSV = false;
    document.removeEventListener('mousemove', svMouseMoveHandler);
    document.removeEventListener('mouseup', svMouseUpHandler);
  };

  svPicker.addEventListener('mousedown', (e) => {
    isDraggingSV = true;
    updateSVAt(e.clientX, e.clientY);
    document.addEventListener('mousemove', svMouseMoveHandler);
    document.addEventListener('mouseup', svMouseUpHandler);
  });

  // Touch handlers for SV picker
  const svTouchMoveHandler = (e) => {
    if (isDraggingSV) {
      e.preventDefault();
      updateSVAt(e.touches[0].clientX, e.touches[0].clientY);
    }
  };
  const svTouchEndHandler = () => {
    isDraggingSV = false;
    document.removeEventListener('touchmove', svTouchMoveHandler);
    document.removeEventListener('touchend', svTouchEndHandler);
  };

  svPicker.addEventListener('touchstart', (e) => {
    isDraggingSV = true;
    updateSVAt(e.touches[0].clientX, e.touches[0].clientY);
    document.addEventListener('touchmove', svTouchMoveHandler, { passive: false });
    document.addEventListener('touchend', svTouchEndHandler);
  }, { passive: true });
  
  function updateSVBackground() {
    svPicker.style.background = `
      linear-gradient(to bottom, transparent 0%, black 100%),
      linear-gradient(to right, white 0%, hsl(${currentHue}, 100%, 50%) 100%)`;
  }
  
  function updateColorPreview() {
    const rgb = hsvToRgb(currentHue, currentSaturation, currentValue);
    const color = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    colorPreview.style.backgroundColor = color;
  }
  
  // Initial setup
  updateSVBackground();
  updateColorPreview();
  
  // Initial handle position setting (high saturation, high value)
  setTimeout(() => {
    const svRect = svPicker.getBoundingClientRect();
    const initialX = svRect.width * 0.8;
    const initialY = svRect.height * 0.2;
    
    currentSaturation = 80;
    currentValue = 80;
    
    svHandle.style.left = `${initialX}px`;
    svHandle.style.top = `${initialY}px`;
    updateColorPreview();
  }, 10);
}

function appendColorSeparator(container) {
  const separator = document.createElement('div');
  separator.className = 'color-separator';
  container.appendChild(separator);
}

// -------- Helper: regenerate color buttons inside a container --------
function refreshHighlightControlsColors() {
  if (!highlightControlsContainer) return;
  const colorButtonsContainer = highlightControlsContainer.querySelector('.text-highlighter-color-buttons');
  if (!colorButtonsContainer) return;

  // Clear existing buttons
  colorButtonsContainer.innerHTML = '';

  // Re-create color buttons (the '+' button lives outside the strip and stays)
  appendColorButtons(colorButtonsContainer);
  updateColorScrollHints(highlightControlsContainer);
}

// Display highlight controller UI
function showControlUi(highlightElement, e) {
  if (!highlightControlsContainer) createHighlightControls();

  activeHighlightElement = highlightElement;
  const controlsHeight = 44;
  // jsdom reports 0, so keep the old estimate as the fallback.
  const controlsWidth = measureControlsWidth(highlightControlsContainer) || 320;
  const highlightControlsVerticalOffset = 52;
  const highlightControlsSpacing = 8;
  const viewportPadding = 10;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isPortrait = isMobilePlatform && window.innerWidth < window.innerHeight;
  const highlightRect = highlightElement && typeof highlightElement.getBoundingClientRect === 'function'
    ? highlightElement.getBoundingClientRect()
    : null;
  let topPosition = e.clientY - highlightControlsVerticalOffset;

  if (isMobilePlatform && highlightRect) {
    const preferredTop = highlightRect.top - controlsHeight - highlightControlsSpacing;
    const fallbackTop = highlightRect.bottom + highlightControlsSpacing;
    const canPlaceAboveHighlight = preferredTop >= viewportPadding;
    const canPlaceBelowHighlight = fallbackTop + controlsHeight <= viewportHeight - viewportPadding;

    if (canPlaceAboveHighlight) {
      topPosition = preferredTop;
    } else if (canPlaceBelowHighlight) {
      topPosition = fallbackTop;
    }
  }

  if (topPosition + controlsHeight > viewportHeight - viewportPadding) {
    topPosition = viewportHeight - controlsHeight - viewportPadding;
  }
  if (topPosition < viewportPadding) {
    topPosition = viewportPadding;
  }

  let leftPosition = isPortrait ? viewportPadding : e.clientX - 40;
  if (leftPosition < viewportPadding) {
    leftPosition = viewportPadding;
  }
  if (leftPosition + controlsWidth > viewportWidth - viewportPadding) {
    leftPosition = Math.max(viewportPadding, viewportWidth - controlsWidth - viewportPadding);
  }

  highlightControlsContainer.style.top = `${topPosition}px`;
  highlightControlsContainer.style.left = `${leftPosition}px`;
  const colorScroller = highlightControlsContainer.querySelector('.text-highlighter-color-buttons');
  if (colorScroller) {
    colorScroller.scrollLeft = 0;
  }
  // remove/add visible class to ensure pop animation always plays
  highlightControlsContainer.classList.remove('visible');
  void highlightControlsContainer.offsetWidth; // Force reflow to initialize
  setTimeout(() => {
    highlightControlsContainer.classList.add('visible');
    updateColorScrollHints(highlightControlsContainer);
  }, 10);
}

// Hide highlight controller UI
function hideHighlightControls() {
  if (highlightControlsContainer) {
    highlightControlsContainer.classList.remove('visible');
  }
  activeHighlightElement = null;
}

// ============ SELECTION CONTROLS FUNCTIONS ============

// Detect the platform, then load the stored setting it decides the default for.
// A background that never answers leaves the setting at its initial value, the
// same as the early return this replaced.
async function loadSelectionControlsSetting() {
  let response;
  try {
    response = await browserAPI.runtime.sendMessage({ action: 'getPlatformInfo' });
  } catch (error) {
    debugLog('Error getting platform info:', error);
    return;
  }

  if (response && response.isMobile) {
    isMobilePlatform = true;
    debugLog('Mobile platform detected in controls.js');
  }

  const result = await browserAPI.storage.local.get([
    'selectionControlsVisible',
    'oneClickHighlightEnabled',
    'lastUsedColor',
  ]);
  if (isMobilePlatform) {
    // On mobile, always enable - controls are essential for operation
    selectionControlsEnabled = true;
  } else {
    selectionControlsEnabled = result.selectionControlsVisible !== false;
  }

  oneClickHighlightEnabled = result.oneClickHighlightEnabled === true;
  lastUsedColorValue = result.lastUsedColor || null;
  debugLog('Selection controls enabled:', selectionControlsEnabled);
}

// The palette entry a one-click press paints with - or null when the setting is
// off, or the palette has not arrived yet. Null leaves the icon opening the
// palette the way it always has, so every uncertain case is the old behaviour.
function getOneClickColor() {
  if (!oneClickHighlightEnabled) return null;
  const palette = Array.isArray(currentColors) ? currentColors : null;
  if (!palette || palette.length === 0) return null;
  return colorCore.resolveLastUsedColor(palette, lastUsedColorValue);
}

// Called by the settings broadcast, the way setSelectionControlsVisibility is.
function setOneClickHighlightEnabled(enabled) {
  oneClickHighlightEnabled = enabled === true;
  debugLog('One-click highlight enabled:', oneClickHighlightEnabled);
}

// The last used colour is written by whichever tab painted last, so this tab
// learns it from storage rather than from a message: the icon then offers the
// same colour in every open tab, including the ones the paint did not happen in.
function watchLastUsedColor() {
  if (lastUsedColorWatcherAdded) return;
  if (!browserAPI.storage || !browserAPI.storage.onChanged) return;
  lastUsedColorWatcherAdded = true;

  browserAPI.storage.onChanged.addListener((changes, areaName) => {
    if (areaName && areaName !== 'local') return;
    if (changes && changes.lastUsedColor) {
      lastUsedColorValue = changes.lastUsedColor.newValue || null;
    }
  });
}

// Initialize selection controls feature
function initializeSelectionControls() {
  // Not awaited: the listeners below have to be in place before the round trip
  // finishes, the way they were when this was a callback.
  loadSelectionControlsSetting();
  watchLastUsedColor();

  // Add mouseup event listener to detect text selection
  document.addEventListener('mouseup', handleSelectionMouseUp);
  document.addEventListener('selectionchange', handleSelectionChange);

  // Add touch event support for mobile
  document.addEventListener('touchend', handleSelectionTouchEnd);

  if (!selectionViewportListenersAdded) {
    window.addEventListener('scroll', handleSelectionScroll, { passive: true });
    window.addEventListener('resize', handleSelectionViewportChange, { passive: true });
    selectionViewportListenersAdded = true;
  }
}

function calculateSelectionIconPosition(mouseX, mouseY) {
  const iconWidth = isMobilePlatform ? 48 : 29;
  const iconHeight = isMobilePlatform ? 48 : 29;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const selectionRect = currentSelection && currentSelection.range
    ? currentSelection.range.getBoundingClientRect()
    : null;

  let leftPosition;
  let topPosition;
  if (isMobilePlatform) {
    const defaultTopPosition = mouseY + 30;
    const isBottomOverflow = defaultTopPosition + iconHeight > viewportHeight - 10;

    if (isBottomOverflow) {
      topPosition = selectionRect ? selectionRect.top : mouseY;

      const preferredLeftPosition = (selectionRect ? selectionRect.left : mouseX) - iconWidth - 30;
      if (preferredLeftPosition >= 10) {
        leftPosition = preferredLeftPosition;
      } else {
        leftPosition = (selectionRect ? selectionRect.right : mouseX) + 30;
      }
    } else {
      topPosition = defaultTopPosition;
      leftPosition = mouseX - iconWidth - 10;

      if (selectionRect) {
        leftPosition = Math.max(leftPosition, selectionRect.left);
      }
    }

    leftPosition = Math.max(10, Math.min(leftPosition, viewportWidth - iconWidth - 10));
    topPosition = Math.max(10, Math.min(topPosition, viewportHeight - iconHeight - 10));
  } else {
    leftPosition = mouseX + 10;

    if (mouseX > viewportWidth * 0.7) {
      leftPosition = mouseX - iconWidth - 10;

      if (leftPosition < 10) {
        leftPosition = 10;
      }
    }

    topPosition = mouseY - 30;
    if (mouseY - 30 < 0) {
      topPosition = mouseY + 10;

      if (topPosition + iconHeight > viewportHeight - 10) {
        topPosition = viewportHeight - iconHeight - 10;
      }
    }
  }

  return {
    left: leftPosition,
    top: topPosition
  };
}

function positionSelectionIcon(mouseX, mouseY) {
  if (!selectionIcon) return;
  const pos = calculateSelectionIconPosition(mouseX, mouseY);
  selectionIcon.style.left = `${pos.left}px`;
  selectionIcon.style.top = `${pos.top}px`;
}

function hideSelectionIconForScroll() {
  if (!selectionIcon || selectionIconHiddenForScroll) return;
  selectionIcon.style.visibility = 'hidden';
  selectionIcon.style.pointerEvents = 'none';
  selectionIconHiddenForScroll = true;
}

function showSelectionIconAfterScroll() {
  if (!selectionIcon || !selectionIconHiddenForScroll) return;
  selectionIcon.style.visibility = '';
  selectionIcon.style.pointerEvents = '';
  selectionIconHiddenForScroll = false;
}

function getSelectionAnchorFromCurrentRange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const rect = currentSelection && currentSelection.range && typeof currentSelection.range.getBoundingClientRect === 'function'
    ? currentSelection.range.getBoundingClientRect()
    : null;

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }

  return {
    x: isMobilePlatform ? rect.left + rect.width / 2 : rect.right,
    y: isMobilePlatform ? rect.bottom : rect.top
  };
}

function handleSelectionScroll() {
  if (!selectionIcon || !currentSelection || selectionControlsContainer) return;

  if (!isMobilePlatform) {
    handleSelectionViewportChange();
    return;
  }

  hideSelectionIconForScroll();

  if (selectionScrollRestoreTimer) {
    clearTimeout(selectionScrollRestoreTimer);
  }

  selectionScrollRestoreTimer = setTimeout(() => {
    selectionScrollRestoreTimer = null;

    if (!selectionIcon || !currentSelection || selectionControlsContainer) return;

    const anchor = getSelectionAnchorFromCurrentRange();
    if (!anchor) {
      hideSelectionIcon();
      return;
    }

    currentSelection.mouseX = anchor.x;
    currentSelection.mouseY = anchor.y;
    positionSelectionIcon(anchor.x, anchor.y);
    showSelectionIconAfterScroll();
  }, SELECTION_SCROLL_RESTORE_DELAY_MS);
}

function handleSelectionViewportChange() {
  if (!selectionIcon || !currentSelection || selectionControlsContainer) return;
  const anchor = getSelectionAnchorFromCurrentRange();
  if (!anchor) {
    hideSelectionIcon();
    return;
  }

  currentSelection.mouseX = anchor.x;
  currentSelection.mouseY = anchor.y;
  positionSelectionIcon(anchor.x, anchor.y);
  showSelectionIconAfterScroll();
}

// Handle mouse up event to detect text selection
function handleSelectionMouseUp(e) {
  if (!selectionControlsEnabled) return;
  
  // Check if the click was on an existing highlight or control
  if (e.target.classList.contains('text-highlighter-extension') || 
      e.target.closest('.text-highlighter-controls') ||
      e.target.closest('.text-highlighter-selection-controls') ||
      e.target.closest('.text-highlighter-selection-icon') ||
      e.target.closest('.custom-color-picker')) {
    return;
  }

  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    if (selectedText && selectedText.length > 0 && selection.rangeCount > 0) {
      // Store a copy of the range to avoid issues with selection changes
      const range = selection.getRangeAt(0).cloneRange();
      currentSelection = {
        selection: selection,
        range: range,
        text: selectedText,
        mouseX: e.clientX,
        mouseY: e.clientY
      };
      showSelectionIcon(e.clientX, e.clientY);
    } else {
      hideSelectionIcon();
      hideSelectionControls();
    }
  }, 10);
}

// Handle touch end event to detect text selection on mobile
function handleSelectionTouchEnd(e) {
  if (!selectionControlsEnabled) return;
  if (selectionControlsContainer) return;

  const target = e.target;
  if (target.classList.contains('text-highlighter-extension') ||
      target.closest('.text-highlighter-controls') ||
      target.closest('.text-highlighter-selection-controls') ||
      target.closest('.text-highlighter-selection-icon')) {
    return;
  }

  // Delay to let the browser finalize the selection after touch
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText && selectedText.length > 0 && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0).cloneRange();
      const rect = range.getBoundingClientRect();

      currentSelection = {
        selection: selection,
        range: range,
        text: selectedText,
        mouseX: rect.left + rect.width / 2,
        mouseY: rect.bottom
      };

      showSelectionIcon(rect.left + rect.width / 2, rect.bottom);
    } else {
      hideSelectionIcon();
      hideSelectionControls();
    }
  }, 300);
}

// Handle selection change event
function handleSelectionChange() {
  if (!selectionControlsEnabled) return;
  // While a colour picker is open the stored range is the selection that
  // matters. Whatever the live one does meanwhile - a touch on the picker can
  // still collapse it - must not throw that range away.
  if (colorPickerOpen) return;

  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (!selectedText || selectedText.length === 0) {
    hideSelectionIcon();
    hideSelectionControls();
    currentSelection = null;
  } else if (currentSelection && selection.rangeCount > 0) {
    // Update stored range to reflect the latest selection (e.g. after handle adjustment)
    currentSelection.range = selection.getRangeAt(0).cloneRange();
    currentSelection.text = selectedText;
  }
}

// Show selection icon near mouse position
function showSelectionIcon(mouseX, mouseY) {
  if (selectionControlsContainer) return;
  hideSelectionIcon(); // Remove any existing icon

  let iconUrl;
  try {
    iconUrl = browserAPI.runtime.getURL('images/icon48.png');
  } catch (e) {
    // Extension context has been invalidated (e.g. after reload); abort silently.
    return;
  }

  selectionIcon = document.createElement('div');
  selectionIcon.className = 'text-highlighter-selection-icon';

  const iconImg = document.createElement('img');
  iconImg.src = iconUrl;
  iconImg.alt = 'Highlight';
  iconImg.style.width = '19px';
  iconImg.style.height = '19px';
  selectionIcon.appendChild(iconImg);

  // In one-click mode the press paints instead of opening the palette, so the
  // icon has to say which colour it will paint with before it is pressed. The
  // colour goes on a strip under the logo rather than behind it: a custom
  // colour can be any value, and the logo has to stay legible over all of them.
  const oneClickColor = getOneClickColor();
  if (oneClickColor) {
    selectionIcon.classList.add('one-click');
    const swatch = document.createElement('div');
    swatch.className = 'text-highlighter-selection-icon-swatch';
    swatch.style.backgroundColor = oneClickColor.color;
    selectionIcon.appendChild(swatch);
    selectionIcon.title = `${getMessage('highlightText')} (${colorDisplayName(oneClickColor)})`;
  } else {
    selectionIcon.title = getMessage('highlightText');
  }

  positionSelectionIcon(mouseX, mouseY);

  // What a press on the icon does. In one-click mode it paints the stored
  // selection with the last used colour; otherwise it opens the palette, as it
  // always has. The colour is resolved again here rather than reused from the
  // render above so a palette that changed while the icon was up cannot paint
  // with a colour that is no longer in it.
  const activateIcon = (clientX, clientY) => {
    const color = getOneClickColor();
    if (color) {
      createHighlightWithColor(color.color);
      return;
    }
    showSelectionControls(clientX, clientY);
  };

  let pointerHandled = false;
  // Use pointerdown so we act before selection can collapse on click.
  selectionIcon.addEventListener('pointerdown', function(e) {
    pointerHandled = true;
    e.preventDefault();
    e.stopPropagation();
    activateIcon(e.clientX, e.clientY);
  });

  // Keep click as a fallback for environments where pointer events are limited.
  selectionIcon.addEventListener('click', function(e) {
    if (pointerHandled) {
      pointerHandled = false;
      return;
    }
    e.stopPropagation();
    activateIcon(e.clientX, e.clientY);
  });
  
  getUiMountRoot().appendChild(selectionIcon);
}

// Hide selection icon
function hideSelectionIcon() {
  if (selectionScrollRestoreTimer) {
    clearTimeout(selectionScrollRestoreTimer);
    selectionScrollRestoreTimer = null;
  }
  selectionIconHiddenForScroll = false;
  if (selectionIcon) {
    selectionIcon.remove();
    selectionIcon = null;
  }
}

// Show selection controls (reusing existing controls.js UI without delete button)
function showSelectionControls(mouseX, mouseY) {
  if (!currentSelection) return;
  const iconRect = selectionIcon ? selectionIcon.getBoundingClientRect() : null;
  
  hideSelectionControls(); // Remove any existing controls
  
  // Create a modified version of the existing highlight controls
  if (!highlightControlsContainer) createHighlightControls();
  
  // Clone the existing controls container but modify it for selection mode
  selectionControlsContainer = highlightControlsContainer.cloneNode(true);
  selectionControlsContainer.className = 'text-highlighter-controls text-highlighter-selection-controls';
  // cloneNode copies data attributes, but not event listeners.
  // Clear drag flags so selection controls can bind fresh pointer handlers.
  delete selectionControlsContainer.dataset.touchDragEnabled;
  delete selectionControlsContainer.dataset.justDragged;
  
  // Remove the delete button from the cloned container
  const deleteButton = selectionControlsContainer.querySelector('.delete-highlight');
  if (deleteButton) {
    deleteButton.remove();
  }

  // cloneNode dropped the '+' button's listeners with the rest. Replace it with
  // one that paints the selection with the picked colour, before the bar is
  // measured so the strip's overflow hints count the button that ends up there.
  const clonedAddColorButton = selectionControlsContainer.querySelector('.add-color-button');
  if (clonedAddColorButton) {
    clonedAddColorButton.replaceWith(createAddColorButton(addCustomColorAndHighlight));
  }
  
  // Temporarily position off-screen to get dimensions
  selectionControlsContainer.style.left = '-9999px';
  selectionControlsContainer.style.top = '-9999px';
  selectionControlsContainer.style.visibility = 'hidden';
  getUiMountRoot().appendChild(selectionControlsContainer);
  
  // Position the controls with viewport boundary checking
  const controlsRect = selectionControlsContainer.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Calculate horizontal position
  let leftPosition;
  const isPortrait = isMobilePlatform && window.innerWidth < window.innerHeight;

  if (isPortrait) {
    // In portrait mode, always align to left edge
    leftPosition = 10;
  } else {
    leftPosition = mouseX + 10;

    // Check if mouse is in the right 30% of the viewport (70% threshold)
    if (mouseX > viewportWidth * 0.7) {
      leftPosition = mouseX - controlsRect.width - 10;

      if (leftPosition < 10) {
        leftPosition = 10;
      }
    }
  }
  if (leftPosition + controlsRect.width > viewportWidth - 10) {
    leftPosition = Math.max(10, viewportWidth - controlsRect.width - 10);
  }
  
  // Calculate vertical position
  let topPosition = mouseY - 20;
  
  // Check if controls would go beyond bottom edge of viewport
  if (mouseY + controlsRect.height - 20 > viewportHeight) {
    // Position above mouse cursor instead
    topPosition = mouseY - controlsRect.height - 10;
    
    // If still beyond top edge, align to top edge with some padding
    if (topPosition < 10) {
      topPosition = 10;
    }
  }
  
  // Ensure controls cover the icon center point so follow-up click
  // at icon coordinates lands inside controls.
  if (iconRect) {
    const iconCenterX = iconRect.left + iconRect.width / 2;
    const iconCenterY = iconRect.top + iconRect.height / 2;
    const minLeft = 0;
    const minTop = 0;
    const maxLeft = Math.max(0, viewportWidth - controlsRect.width);
    const maxTop = Math.max(0, viewportHeight - controlsRect.height);
    leftPosition = Math.min(Math.max(iconCenterX - controlsRect.width / 2, minLeft), maxLeft);
    topPosition = Math.min(Math.max(iconCenterY - controlsRect.height / 2, minTop), maxTop);
  }

  // Set final position and make visible
  selectionControlsContainer.style.left = `${leftPosition}px`;
  selectionControlsContainer.style.top = `${topPosition}px`;
  selectionControlsContainer.style.visibility = 'visible';
  enableTouchDragForControls(selectionControlsContainer);
  // cloneNode dropped the scroll listener along with the rest.
  bindColorScrollHints(selectionControlsContainer);
  updateColorScrollHints(selectionControlsContainer);

  // Guard against ghost clicks: on Firefox Mobile, a synthetic click fires at the
  // pointerdown coordinates even after preventDefault(), hitting color buttons that
  // now occupy the same position as the former selection icon. Ignore clicks for
  // 300 ms after the controls appear.
  // Capture the current container instance so the timer always clears the flag
  // on this specific container, not whatever selectionControlsContainer points
  // to when the timeout fires (which may be a newer instance).
  const thisContainer = selectionControlsContainer;
  thisContainer.dataset.justShown = 'true';
  setTimeout(() => {
    delete thisContainer.dataset.justShown;
  }, 300);

  // Update event listeners for color buttons to create highlights instead of changing existing ones
  const colorButtons = selectionControlsContainer.querySelectorAll('.color-button');
  colorButtons.forEach((colorButton, idx) => {
    // Remove existing event listeners by cloning the node
    const newColorButton = colorButton.cloneNode(true);
    colorButton.parentNode.replaceChild(newColorButton, colorButton);

    // Add new event listener for creating highlights
    newColorButton.addEventListener('click', function(e) {
      e.stopPropagation();
      if (thisContainer.dataset.justShown) {
        return;
      }
      const colorInfo = currentColors[idx];
      if (colorInfo) {
        createHighlightWithColor(colorInfo.color);
      }
    });
  });
  
  // Add click event to stop propagation
  selectionControlsContainer.addEventListener('click', function(e) {
    e.stopPropagation();
  });
  
  // Apply the visible animation
  selectionControlsContainer.classList.remove('visible');
  void selectionControlsContainer.offsetWidth; // reflow
  // The bar can be gone again before this fires - a pick that paints at once
  // closes it - so it is this bar that becomes visible, not whatever the
  // variable points to by then.
  setTimeout(() => {
    thisContainer.classList.add('visible');
  }, 10);

  // Hide icon when controls are shown
  hideSelectionIcon();
}

// Hide selection controls
function hideSelectionControls() {
  if (selectionControlsContainer) {
    selectionControlsContainer.remove();
    selectionControlsContainer = null;
  }
}

// Set selection controls visibility
function setSelectionControlsVisibility(visible) {
  selectionControlsEnabled = visible;
  if (!selectionControlsEnabled) {
    hideSelectionIcon();
    hideSelectionControls();
  }
}


// Helper function to create highlight with selected color
function createHighlightWithColor(color) {
  if (currentSelection && (currentSelection.range || currentSelection.selection)) {
    // Restore the selection using the stored range
    const selection = window.getSelection();
    selection.removeAllRanges();
    
    try {
      if (currentSelection.range) {
        selection.addRange(currentSelection.range);
      } else if (currentSelection.selection.getRangeAt) {
        selection.addRange(currentSelection.selection.getRangeAt(0));
      }
      
      highlightSelectionViaApi(color);
      hideSelectionControls();
      hideSelectionIcon();
      currentSelection = null;
    } catch (error) {
      debugLog('Could not restore selection:', error);
      hideSelectionControls();
      hideSelectionIcon();
      currentSelection = null;
    }
  }
}

// Global click event handler - only add once
let globalClickListenerAdded = false;

function addGlobalClickListener() {
  if (globalClickListenerAdded) return;
  
  document.addEventListener('click', function (e) {
    // Handle existing highlight controls
    if (highlightControlsContainer) {
      // While a colour picker is open, keep whichever bar opened it visible.
      if (colorPickerOpen) {
        return; 
      }

      const isClickOnHighlight = activeHighlightElement &&
        (activeHighlightElement.contains(e.target) || activeHighlightElement === e.target);
      const isClickOnControls = highlightControlsContainer.contains(e.target) ||
        highlightControlsContainer === e.target;

      if (!isClickOnHighlight && !isClickOnControls) {
        hideHighlightControls();
      }
    }

    // Handle selection controls
    if (!selectionControlsEnabled) return;
    
    if (selectionIcon && !selectionIcon.contains(e.target)) {
      hideSelectionIcon();
    }
    
    if (selectionControlsContainer && !selectionControlsContainer.contains(e.target)) {
      hideSelectionControls();
    }
  }, true); // Use capture phase to handle this before other handlers
  
  globalClickListenerAdded = true;
}

// Auto-initialize selection controls when the script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeSelectionControls();
    addGlobalClickListener();
  });
} else {
  // DOM is already ready
  initializeSelectionControls();
  addGlobalClickListener();
}
