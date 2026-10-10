(() => {
  // The colour picker, shared by the in-page controls and the settings page.
  //
  // Neither uses the browser's <input type="color">: Firefox for Android shows
  // it as a short list of fixed colours with no way to pick anything between
  // them. This picker draws its own hue strip and saturation/value square, so
  // every colour is reachable by touch as well as by mouse.
  //
  // It only builds the picker and keeps it consistent. Where it goes, what
  // closes it and what Apply does are the caller's - the buttons and presets
  // carry the class names callers delegate clicks on.
  const colorCore = window.TextHighlighterColorCore;

  const PRESET_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F39C12', '#E74C3C', '#9B59B6', '#3498DB', '#1ABC9C',
    '#2ECC71', '#F1C40F', '#E67E22', '#FF90A0', '#A8E6CF'
  ];

  // Where the picker opens with no colour to start from: strong but not harsh.
  const DEFAULT_HSV = { h: 0, s: 80, v: 80 };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hsvToHex({ h, s, v }) {
    const { r, g, b } = colorCore.hsvToRgb(h, s, v);
    return colorCore.rgbToHex(`rgb(${r}, ${g}, ${b})`);
  }

  function createElement(tag, className) {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  }

  /**
   * Build a picker.
   *
   * @param {object} options
   * @param {(key: string) => string} options.getMessage the page's i18n lookup
   * @param {string} [options.initialColor] colour code to open on
   * @param {boolean} [options.hexInput] add a field to type a colour code into
   * @param {boolean} [options.presetsEdit] a preset loads into the sliders for
   *   adjusting, instead of being left to the caller to apply on the spot
   * @returns {{element: HTMLElement, getColor: () => string, setColor: (hex: string) => boolean}}
   */
  function createColorPicker({
    getMessage,
    initialColor = null,
    hexInput = false,
    presetsEdit = false,
  } = {}) {
    const message = key => (getMessage && getMessage(key)) || '';

    const picker = createElement('div', 'custom-color-picker');

    const header = createElement('div', 'color-picker-header');
    header.textContent = message('selectColor');
    picker.appendChild(header);

    const presetGrid = createElement('div', 'color-preset-grid');
    PRESET_COLORS.forEach(color => {
      const preset = createElement('div', 'color-preset');
      preset.style.backgroundColor = color;
      preset.dataset.color = color;
      presetGrid.appendChild(preset);
    });
    picker.appendChild(presetGrid);

    const customSection = createElement('div', 'custom-color-section');

    const hueContainer = createElement('div', 'hue-slider-container');
    const hueSlider = createElement('div', 'hue-slider');
    const hueHandle = createElement('div', 'hue-handle');
    hueSlider.appendChild(hueHandle);
    hueContainer.appendChild(hueSlider);
    customSection.appendChild(hueContainer);

    const svPicker = createElement('div', 'saturation-value-picker');
    const svHandle = createElement('div', 'sv-handle');
    svPicker.appendChild(svHandle);
    customSection.appendChild(svPicker);

    // Alone under the square, or beside the colour code field when there is one.
    const colorPreview = createElement('div', 'color-preview');

    let hexField = null;
    if (hexInput) {
      const hexRow = createElement('label', 'color-picker-hex-row');
      const hexLabel = createElement('span', 'color-picker-hex-label');
      hexLabel.textContent = message('colorHexCode') || 'HEX';
      hexField = createElement('input', 'color-picker-hex');
      hexField.type = 'text';
      hexField.maxLength = 7;
      hexField.spellcheck = false;
      hexField.autocomplete = 'off';
      hexField.setAttribute('autocapitalize', 'off');
      hexField.setAttribute('autocorrect', 'off');
      hexRow.appendChild(colorPreview);
      hexRow.appendChild(hexLabel);
      hexRow.appendChild(hexField);
      customSection.appendChild(hexRow);
    } else {
      customSection.appendChild(colorPreview);
    }

    picker.appendChild(customSection);

    const buttons = createElement('div', 'color-picker-buttons');
    const applyButton = createElement('button', 'color-picker-apply');
    applyButton.type = 'button';
    applyButton.textContent = message('apply');
    const cancelButton = createElement('button', 'color-picker-close');
    cancelButton.type = 'button';
    cancelButton.textContent = message('cancel');
    buttons.appendChild(applyButton);
    buttons.appendChild(cancelButton);
    picker.appendChild(buttons);

    // HSV is what the sliders move; the colour code is what the picker
    // answers with. A code that was set directly - typed, a preset, the
    // starting colour - is kept as given rather than rebuilt from HSV, which
    // can come back one step off in a channel.
    let hsv = { ...DEFAULT_HSV };
    let currentHex = hsvToHex(hsv);

    // Handles are placed in percent, so they are right before the picker has
    // been laid out - and stay right if it is resized.
    function render({ keepHexField = false } = {}) {
      hueHandle.style.left = `${(hsv.h / 360) * 100}%`;
      svHandle.style.left = `${hsv.s}%`;
      svHandle.style.top = `${100 - hsv.v}%`;
      svPicker.style.background = `
      linear-gradient(to bottom, transparent 0%, black 100%),
      linear-gradient(to right, white 0%, hsl(${hsv.h}, 100%, 50%) 100%)`;
      colorPreview.style.backgroundColor = currentHex;
      if (hexField && !keepHexField) {
        hexField.value = currentHex.toUpperCase();
        hexField.removeAttribute('aria-invalid');
      }
    }

    function moveTo(nextHsv) {
      hsv = nextHsv;
      currentHex = hsvToHex(hsv);
      render();
    }

    function setColor(color, renderOptions) {
      const normalized = colorCore.normalizeHexColor(color);
      if (!normalized) return false;
      const next = colorCore.hexToHsv(normalized);
      // A grey has no hue of its own; keep the strip where it was rather than
      // jumping it back to red.
      if (next.s === 0) next.h = hsv.h;
      hsv = next;
      currentHex = normalized;
      render(renderOptions);
      return true;
    }

    function updateHueAt(clientX) {
      const rect = hueSlider.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = clamp(clientX - rect.left, 0, rect.width);
      moveTo({ ...hsv, h: (x / rect.width) * 360 });
    }

    function updateSVAt(clientX, clientY) {
      const rect = svPicker.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = clamp(clientX - rect.left, 0, rect.width);
      const y = clamp(clientY - rect.top, 0, rect.height);
      // x: 0 (left, no saturation) to 100; y: 100 (top, full value) to 0.
      moveTo({ ...hsv, s: (x / rect.width) * 100, v: 100 - (y / rect.height) * 100 });
    }

    // Drags are heard on the document while they last, so leaving the strip
    // mid-drag keeps it going. Mouse and touch are wired separately rather than
    // with pointer events: the in-page controls cancel mousedown on the picker
    // to keep the page selection, and that has to stay a mousedown.
    function makeDraggable(target, update) {
      const onMouseMove = (e) => update(e);
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      target.addEventListener('mousedown', (e) => {
        update(e);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      const onTouchMove = (e) => {
        e.preventDefault();
        update(e.touches[0]);
      };
      const onTouchEnd = () => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        document.removeEventListener('touchcancel', onTouchEnd);
      };
      target.addEventListener('touchstart', (e) => {
        update(e.touches[0]);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
        document.addEventListener('touchcancel', onTouchEnd);
      }, { passive: true });
    }

    makeDraggable(hueSlider, point => updateHueAt(point.clientX));
    makeDraggable(svPicker, point => updateSVAt(point.clientX, point.clientY));

    if (presetsEdit) {
      presetGrid.addEventListener('click', (e) => {
        const preset = e.target.closest('.color-preset');
        if (preset) setColor(preset.dataset.color);
      });
    }

    if (hexField) {
      // Each keystroke that makes a whole code moves the picker; anything in
      // between is left alone to be finished. Leaving the field puts back the
      // colour the picker is actually on.
      hexField.addEventListener('input', () => {
        if (setColor(hexField.value, { keepHexField: true })) {
          hexField.removeAttribute('aria-invalid');
        } else {
          hexField.setAttribute('aria-invalid', 'true');
        }
      });
      hexField.addEventListener('blur', () => render());
    }

    if (!initialColor || !setColor(initialColor)) render();

    return {
      element: picker,
      getColor: () => currentHex,
      setColor: color => setColor(color),
    };
  }

  window.TextHighlighterColorPicker = {
    PRESET_COLORS,
    createColorPicker,
  };
})();
