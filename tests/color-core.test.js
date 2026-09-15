import '../content-scripts/color-core.js';

describe('color-core', () => {
  const core = window.TextHighlighterColorCore;

  describe('parseRgb', () => {
    it('reads long and short hex, in either case', () => {
      expect(core.parseRgb('#1E3A8A')).toEqual({ r: 30, g: 58, b: 138 });
      expect(core.parseRgb('#fa0')).toEqual({ r: 255, g: 170, b: 0 });
    });

    it('reads rgb() and rgba(), ignoring alpha', () => {
      expect(core.parseRgb('rgb(0, 100, 0)')).toEqual({ r: 0, g: 100, b: 0 });
      expect(core.parseRgb('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30 });
    });

    it('returns null for anything else', () => {
      expect(core.parseRgb('yellow')).toBeNull();
      expect(core.parseRgb('#12345')).toBeNull();
      expect(core.parseRgb('')).toBeNull();
      expect(core.parseRgb(undefined)).toBeNull();
    });
  });

  describe('highlightTextColor', () => {
    it('keeps black on every default and picker preset colour', () => {
      const palette = [
        '#FFFF00', '#AAFFAA', '#AAAAFF', '#FFAAFF', '#FFAA55',
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
        '#F39C12', '#E74C3C', '#9B59B6', '#3498DB', '#1ABC9C',
        '#2ECC71', '#F1C40F', '#E67E22', '#FF90A0', '#A8E6CF',
      ];
      palette.forEach(color => expect(core.highlightTextColor(color)).toBe('#000'));
    });

    it('keeps black on mid-tones where white would merely win', () => {
      // White has the higher contrast on both, but black is still readable.
      expect(core.highlightTextColor('#666666')).toBe('#000');
      expect(core.highlightTextColor('#808080')).toBe('#000');
    });

    it('switches to white only once black falls under 3:1', () => {
      expect(core.highlightTextColor('#555555')).toBe('#fff');
      expect(core.highlightTextColor('#8B0000')).toBe('#fff');
      expect(core.highlightTextColor('#1E3A8A')).toBe('#fff');
      expect(core.highlightTextColor('rgb(0, 100, 0)')).toBe('#fff');
      expect(core.highlightTextColor('#000')).toBe('#fff');
    });

    it('stays black for a value it cannot read', () => {
      expect(core.highlightTextColor('yellow')).toBe('#000');
      expect(core.highlightTextColor('not a colour')).toBe('#000');
    });
  });

  describe('paintHighlight', () => {
    it('sets the background and leaves the text to the stylesheet on a light colour', () => {
      const span = document.createElement('span');
      core.paintHighlight(span, '#FFFF00');

      expect(span.style.backgroundColor).toBe('rgb(255, 255, 0)');
      expect(span.style.getPropertyValue(core.TEXT_COLOR_PROPERTY)).toBe('');
    });

    it('sets white text on a dark colour, and takes it back off when recoloured light', () => {
      const span = document.createElement('span');

      core.paintHighlight(span, '#1E3A8A');
      expect(span.style.getPropertyValue(core.TEXT_COLOR_PROPERTY)).toBe('#fff');

      core.paintHighlight(span, '#AAFFAA');
      expect(span.style.backgroundColor).toBe('rgb(170, 255, 170)');
      expect(span.style.getPropertyValue(core.TEXT_COLOR_PROPERTY)).toBe('');
    });
  });

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


  // Which colour a one-click highlight paints with. Stored as a value rather
  // than an id, so a colour that leaves the palette stops being offered.
  describe('resolveLastUsedColor', () => {
    const palette = [
      { id: 'yellow', color: '#FFFF00' },
      { id: 'green', color: '#AAFFAA' },
      { id: 'custom_1', color: '#123456' },
    ];

    it('returns the palette entry the remembered value belongs to', () => {
      expect(core.resolveLastUsedColor(palette, '#123456')).toBe(palette[2]);
    });

    it('matches regardless of the case the value was written in', () => {
      expect(core.resolveLastUsedColor(palette, '#aaffaa')).toBe(palette[1]);
    });

    it('falls back to the first colour when nothing has been used yet', () => {
      expect(core.resolveLastUsedColor(palette, null)).toBe(palette[0]);
    });

    it('falls back to the first colour when the remembered one has been removed', () => {
      expect(core.resolveLastUsedColor(palette, '#DEAD00')).toBe(palette[0]);
    });

    it('has nothing to offer from an empty palette', () => {
      expect(core.resolveLastUsedColor([], '#FFFF00')).toBeNull();
      expect(core.resolveLastUsedColor(null, '#FFFF00')).toBeNull();
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
