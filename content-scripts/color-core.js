(() => {
  // What the picker falls back to when it is handed something it cannot parse.
  const FALLBACK_HEX = '#FF6B6B';

  function toHexPair(value) {
    const hex = value.toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  }

  /**
   * HSV as the picker's sliders express it - hue in degrees, saturation and
   * value in percent - to 8-bit RGB.
   *
   * @param {number} h 0-360
   * @param {number} s 0-100
   * @param {number} v 0-100
   * @returns {{r: number, g: number, b: number}}
   */
  function hsvToRgb(h, s, v) {
    const hue = h / 360;
    const saturation = s / 100;
    const value = v / 100;

    const c = value * saturation;
    const x = c * (1 - Math.abs((hue * 6) % 2 - 1));
    const m = value - c;

    let r, g, b;

    if (hue >= 0 && hue < 1 / 6) {
      r = c; g = x; b = 0;
    } else if (hue >= 1 / 6 && hue < 2 / 6) {
      r = x; g = c; b = 0;
    } else if (hue >= 2 / 6 && hue < 3 / 6) {
      r = 0; g = c; b = x;
    } else if (hue >= 3 / 6 && hue < 4 / 6) {
      r = 0; g = x; b = c;
    } else if (hue >= 4 / 6 && hue < 5 / 6) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  /**
   * An `hsl(...)` string to `#rrggbb`.
   *
   * @param {string} hsl
   * @returns {string}
   */
  function hslToHex(hsl) {
    const match = hsl.match(/\d+/g);
    if (!match) return FALLBACK_HEX;

    const h = parseInt(match[0], 10) / 360;
    const s = parseInt(match[1], 10) / 100;
    const l = parseInt(match[2], 10) / 100;

    const hue2rgb = (p, q, t) => {
      let shifted = t;
      if (shifted < 0) shifted += 1;
      if (shifted > 1) shifted -= 1;
      if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
      if (shifted < 1 / 2) return q;
      if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
      return p;
    };

    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return `#${toHexPair(Math.round(r * 255))}${toHexPair(Math.round(g * 255))}${toHexPair(Math.round(b * 255))}`;
  }

  /**
   * Whatever a computed style or a picker hands back - `#rrggbb`, `rgb(...)`,
   * `hsl(...)` - as `#rrggbb`. Anything unparseable becomes the fallback rather
   * than an invalid colour, since the result goes straight into a style.
   *
   * @param {string} rgb
   * @returns {string}
   */
  function rgbToHex(rgb) {
    if (rgb.startsWith('#')) return rgb;
    if (rgb.startsWith('hsl')) return hslToHex(rgb);

    const match = rgb.match(/\d+/g);
    if (!match) return FALLBACK_HEX;

    const channels = [match[0], match[1], match[2]].map(value => parseInt(value, 10));
    return `#${channels.map(toHexPair).join('')}`;
  }

  /**
   * Which palette entry a one-click highlight paints with.
   *
   * The last used colour is remembered as a hex value rather than a colour id
   * because the palette refuses duplicate values, which makes the value itself
   * the unique key - and makes "no longer in the palette" the fallback
   * condition. A colour that was removed, or edited to a different value, stops
   * matching and the first palette entry takes over rather than a colour the
   * user can no longer see.
   *
   * @param {{color: string}[]} colors the palette, in display order
   * @param {string|null|undefined} lastUsedColor hex value, `#rrggbb`
   * @returns {object|null} the palette entry, or null for an empty palette
   */
  function resolveLastUsedColor(colors, lastUsedColor) {
    if (!Array.isArray(colors) || colors.length === 0) return null;

    if (typeof lastUsedColor === 'string' && lastUsedColor) {
      const wanted = lastUsedColor.toLowerCase();
      const match = colors.find(
        entry => entry && typeof entry.color === 'string' && entry.color.toLowerCase() === wanted
      );
      if (match) return match;
    }

    return colors[0];
  }

  // Marks a highlight whose text styles.css turns white. Absent, the
  // stylesheet's black applies - and nothing on the host page can change that.
  const TEXT_TONE_ATTRIBUTE = 'data-th-text-tone';
  const TEXT_ON_DARK = '#fff';

  // Below this contrast black text stops being readable at all. Anything above
  // it stays black on purpose: an earlier rule that picked white whenever white
  // won (YIQ brightness under 128) turned mid-tones like #E74C3C and #9B59B6
  // white, which read worse than black, and was taken out for it. 3:1 is the
  // WCAG floor for large text - past it the choice is taste, and black it is.
  const MIN_BLACK_TEXT_CONTRAST = 3;

  /**
   * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or a complete `rgb[a](r, g, b[, a])`
   * as 8-bit channels plus alpha (1 when absent). Anything with trailing text is unparseable, so
   * a value CSS would reject is never read as a colour.
   *
   * @param {string} color
   * @returns {{r: number, g: number, b: number, a: number}|null} null when unparseable
   */
  function parseRgb(color) {
    if (typeof color !== 'string') return null;
    const value = color.trim();

    const hexMatch = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length <= 4) hex = hex.split('').map(digit => digit + digit).join('');
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }

    const rgbMatch = value.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)(%?)\s*)?\)$/i
    );
    if (rgbMatch) {
      const [r, g, b] = rgbMatch.slice(1, 4).map(channel => Math.min(255, parseInt(channel, 10)));
      let a = 1;
      if (rgbMatch[4] !== undefined) {
        a = parseFloat(rgbMatch[4]) / (rgbMatch[5] ? 100 : 1);
        a = Math.max(0, Math.min(1, a));
      }
      return { r, g, b, a };
    }

    return null;
  }

  // WCAG 2 relative luminance, 0 (black) to 1 (white).
  function relativeLuminance({ r, g, b }) {
    const linear = channel => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  }

  /**
   * The text colour a highlight with this background gets: white only when
   * black would be unreadable, black otherwise - including for a value that
   * cannot be parsed, which is what every highlight had before.
   *
   * Only an opaque background can earn white. A translucent one shows the page
   * through it, and on a light page - the usual case - white text on a mostly
   * transparent fill would vanish, where black was merely dim.
   *
   * @param {string} background
   * @returns {'#000'|'#fff'}
   */
  function highlightTextColor(background) {
    const rgb = parseRgb(background);
    if (!rgb || rgb.a < 1) return '#000';
    const blackContrast = (relativeLuminance(rgb) + 0.05) / 0.05;
    return blackContrast < MIN_BLACK_TEXT_CONTRAST ? TEXT_ON_DARK : '#000';
  }

  /**
   * Paint a highlight span: its background, and the text colour that goes with
   * it. Every place that sets or changes a highlight's colour goes through here
   * so the two cannot drift apart. The text colour is derived, never stored.
   *
   * @param {HTMLElement} element
   * @param {string} color
   */
  function paintHighlight(element, color) {
    // Important, so a page rule like `span { background-color: #fff !important }`
    // cannot repaint the highlight - an inline important declaration outranks
    // any stylesheet one. Otherwise the tone below would be chosen for a
    // background that is not the one on screen: white text on the page's white.
    //
    // Cleared first: CSS ignores an invalid assignment and would otherwise keep
    // the previous colour, which is not what is stored. A value CSS rejects
    // (the stored colour can be any string an import carried) then leaves no
    // background at all, and white text would sit on the page itself.
    element.style.removeProperty('background-color');
    element.style.setProperty('background-color', color, 'important');
    const accepted = element.style.getPropertyValue('background-color') !== '';
    if (accepted && highlightTextColor(color) === TEXT_ON_DARK) {
      element.setAttribute(TEXT_TONE_ATTRIBUTE, 'light');
    } else {
      element.removeAttribute(TEXT_TONE_ATTRIBUTE);
    }
  }

  window.TextHighlighterColorCore = {
    FALLBACK_HEX,
    TEXT_TONE_ATTRIBUTE,
    hsvToRgb,
    hslToHex,
    rgbToHex,
    resolveLastUsedColor,
    parseRgb,
    highlightTextColor,
    paintHighlight,
  };
})();
