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

  window.TextHighlighterColorCore = {
    FALLBACK_HEX,
    hsvToRgb,
    hslToHex,
    rgbToHex,
  };
})();
