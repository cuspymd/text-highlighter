import '../content-scripts/color-core.js';
import '../content-scripts/color-picker.js';

describe('color-picker', () => {
  const { createColorPicker, PRESET_COLORS } = window.TextHighlighterColorPicker;
  const getMessage = key => key;

  // jsdom lays nothing out, so a drag needs the target to report a size.
  function giveSize(element, { left = 0, top = 0, width = 200, height = 100 } = {}) {
    element.getBoundingClientRect = () => ({
      left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    });
  }

  function part(picker, selector) {
    return picker.element.querySelector(selector);
  }

  // Where the hue handle sits along the strip, 0 to 1.
  function huePosition(picker) {
    return parseFloat(part(picker, '.hue-handle').style.getPropertyValue('--th-hue-position'));
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('builds the parts callers delegate on', () => {
    const picker = createColorPicker({ getMessage });

    expect(picker.element.classList.contains('custom-color-picker')).toBe(true);
    expect(part(picker, '.color-picker-header').textContent).toBe('selectColor');
    expect(picker.element.querySelectorAll('.color-preset')).toHaveLength(PRESET_COLORS.length);
    expect(part(picker, '.color-picker-apply').textContent).toBe('apply');
    expect(part(picker, '.color-picker-close').textContent).toBe('cancel');
    // No colour code field unless asked for.
    expect(part(picker, '.color-picker-hex')).toBeNull();
  });

  it('opens on a strong red with no colour to start from', () => {
    const picker = createColorPicker({ getMessage });

    expect(picker.getColor()).toBe('#cc2929');
    expect(part(picker, '.sv-handle').style.left).toBe('80%');
    expect(part(picker, '.sv-handle').style.top).toBe('20%');
    expect(huePosition(picker)).toBe(0);
  });

  it('opens on the colour it is given, handles already in place', () => {
    const picker = createColorPicker({ getMessage, initialColor: '#00FF00', hexInput: true });

    expect(picker.getColor()).toBe('#00ff00');
    expect(part(picker, '.color-picker-hex').value).toBe('#00FF00');
    expect(huePosition(picker)).toBeCloseTo(120 / 360);
    expect(part(picker, '.sv-handle').style.left).toBe('100%');
    expect(part(picker, '.sv-handle').style.top).toBe('0%');
  });

  it('falls back to the default for a starting colour it cannot read', () => {
    const picker = createColorPicker({ getMessage, initialColor: 'rgb(1, 2, 3)' });

    expect(picker.getColor()).toBe('#cc2929');
  });

  it('follows a drag across the saturation/value square', () => {
    const picker = createColorPicker({ getMessage, initialColor: '#ff0000' });
    document.body.appendChild(picker.element);
    const square = part(picker, '.saturation-value-picker');
    giveSize(square, { left: 10, top: 10, width: 200, height: 100 });

    square.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
    expect(picker.getColor()).toBe('#ffffff');

    // Still heard on the document, and held to the square past its edge.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }));
    expect(picker.getColor()).toBe('#000000');

    document.dispatchEvent(new MouseEvent('mouseup'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 210, clientY: 10 }));
    expect(picker.getColor()).toBe('#000000');
  });

  it('moves the hue under the square', () => {
    const picker = createColorPicker({ getMessage, initialColor: '#ff0000' });
    const strip = part(picker, '.hue-slider');
    giveSize(strip, { width: 360, height: 12 });

    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 240, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(picker.getColor()).toBe('#0000ff');
    expect(huePosition(picker)).toBeCloseTo(240 / 360);
  });

  it('reads the hue along the track the handle travels', () => {
    const picker = createColorPicker({ getMessage, initialColor: '#ff0000' });
    const strip = part(picker, '.hue-slider');
    giveSize(strip, { width: 240, height: 20 });
    Object.defineProperty(part(picker, '.hue-handle'), 'offsetWidth', { value: 20 });

    // Grabbing the handle at its centre, where it sits at red, keeps red.
    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(picker.getColor()).toBe('#ff0000');
    expect(huePosition(picker)).toBe(0);

    // The handle's centre at the right end is the end of the hue.
    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 230, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(huePosition(picker)).toBe(1);
  });

  it('keeps the hue where it was when set to a grey', () => {
    const picker = createColorPicker({ getMessage, initialColor: '#0000ff' });

    picker.setColor('#808080');

    expect(huePosition(picker)).toBeCloseTo(240 / 360);
    expect(picker.getColor()).toBe('#808080');
  });

  it('loads a preset into the sliders only when asked to', () => {
    const editing = createColorPicker({ getMessage, presetsEdit: true });
    editing.element.querySelector('[data-color="#3498DB"]').click();
    expect(editing.getColor()).toBe('#3498db');

    const plain = createColorPicker({ getMessage });
    plain.element.querySelector('[data-color="#3498DB"]').click();
    expect(plain.getColor()).toBe('#cc2929');
  });

  it('keeps a typed code as typed while it is being edited', () => {
    const picker = createColorPicker({ getMessage, hexInput: true });
    const field = part(picker, '.color-picker-hex');

    field.value = 'abc';
    field.dispatchEvent(new Event('input'));
    expect(picker.getColor()).toBe('#aabbcc');
    expect(field.value).toBe('abc');

    field.dispatchEvent(new Event('blur'));
    expect(field.value).toBe('#AABBCC');
  });

  it('holds Apply while the code is half-typed, until the picker moves', () => {
    const picker = createColorPicker({
      getMessage, initialColor: '#123456', hexInput: true, presetsEdit: true,
    });
    const field = part(picker, '.color-picker-hex');
    const apply = part(picker, '.color-picker-apply');

    field.value = '#12';
    field.dispatchEvent(new Event('input'));
    expect(apply.disabled).toBe(true);

    // Leaving the field does not swap the half-typed code for the old colour.
    field.dispatchEvent(new Event('blur'));
    expect(field.value).toBe('#12');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(apply.disabled).toBe(true);

    // A preset replaces it.
    picker.element.querySelector('[data-color="#3498DB"]').click();
    expect(field.value).toBe('#3498DB');
    expect(apply.disabled).toBe(false);
  });
});
