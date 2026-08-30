import '../content-scripts/color-core.js';

describe('color-core', () => {
  const core = window.TextHighlighterColorCore;

  describe('hsvToRgb', () => {
    it('maps each sixth of the hue circle to its primary or secondary', () => {
      const fullyBright = { s: 100, v: 100 };
      const at = hue => core.hsvToRgb(hue, fullyBright.s, fullyBright.v);

      expect(at(0)).toEqual({ r: 255, g: 0, b: 0 });
      expect(at(60)).toEqual({ r: 255, g: 255, b: 0 });
      expect(at(120)).toEqual({ r: 0, g: 255, b: 0 });
      expect(at(180)).toEqual({ r: 0, g: 255, b: 255 });
      expect(at(240)).toEqual({ r: 0, g: 0, b: 255 });
      expect(at(300)).toEqual({ r: 255, g: 0, b: 255 });
    });

    it('returns black at zero value, whatever the hue', () => {
      expect(core.hsvToRgb(0, 100, 0)).toEqual({ r: 0, g: 0, b: 0 });
      expect(core.hsvToRgb(210, 40, 0)).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('returns a grey at zero saturation, whatever the hue', () => {
      expect(core.hsvToRgb(0, 0, 100)).toEqual({ r: 255, g: 255, b: 255 });
      expect(core.hsvToRgb(210, 0, 50)).toEqual({ r: 128, g: 128, b: 128 });
    });

    it('treats a full turn as the start of the circle', () => {
      expect(core.hsvToRgb(360, 100, 100)).toEqual(core.hsvToRgb(0, 100, 100));
    });
  });

  describe('hslToHex', () => {
    it('converts the primaries', () => {
      expect(core.hslToHex('hsl(0, 100%, 50%)')).toBe('#ff0000');
      expect(core.hslToHex('hsl(120, 100%, 50%)')).toBe('#00ff00');
      expect(core.hslToHex('hsl(240, 100%, 50%)')).toBe('#0000ff');
    });

    it('converts the achromatic ends', () => {
      expect(core.hslToHex('hsl(0, 0%, 0%)')).toBe('#000000');
      expect(core.hslToHex('hsl(0, 0%, 100%)')).toBe('#ffffff');
      expect(core.hslToHex('hsl(210, 0%, 50%)')).toBe('#808080');
    });

    it('pads a single-digit channel so the result is always six digits', () => {
      expect(core.hslToHex('hsl(0, 100%, 2%)')).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('falls back rather than returning something unusable', () => {
      expect(core.hslToHex('hsl(not a colour)')).toBe(core.FALLBACK_HEX);
    });
  });

  describe('rgbToHex', () => {
    it('passes a hex string straight through', () => {
      expect(core.rgbToHex('#AABBCC')).toBe('#AABBCC');
    });

    it('converts what a computed style hands back', () => {
      expect(core.rgbToHex('rgb(255, 107, 107)')).toBe('#ff6b6b');
      expect(core.rgbToHex('rgb(0, 0, 0)')).toBe('#000000');
    });

    it('pads single-digit channels', () => {
      expect(core.rgbToHex('rgb(1, 2, 3)')).toBe('#010203');
    });

    it('ignores the alpha channel of an rgba string', () => {
      expect(core.rgbToHex('rgba(255, 107, 107, 0.5)')).toBe('#ff6b6b');
    });

    it('hands an hsl string to the hsl conversion', () => {
      expect(core.rgbToHex('hsl(120, 100%, 50%)')).toBe('#00ff00');
    });

    it('falls back rather than returning something unusable', () => {
      expect(core.rgbToHex('transparent')).toBe(core.FALLBACK_HEX);
    });
  });

  // The picker reads a colour back out of the DOM after writing it, so a value
  // that does not survive the round trip shifts every time it is reopened.
  it('round-trips a picked colour through rgb and back', () => {
    const { r, g, b } = core.hsvToRgb(210, 60, 80);

    expect({ r, g, b }).toEqual({ r: 82, g: 143, b: 204 });
    expect(core.rgbToHex(`rgb(${r}, ${g}, ${b})`)).toBe('#528fcc');
  });
});
