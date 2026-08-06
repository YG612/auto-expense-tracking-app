import { colors, control } from '../theme/tokens';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('theme accessibility contracts', () => {
  it.each([
    ['muted text on surface', colors.inkMuted, colors.surface],
    ['muted text on canvas', colors.inkMuted, colors.canvas],
    ['placeholder on surface', colors.placeholder, colors.surface],
    ['brand text on soft brand', colors.brandPressed, colors.brandSoft],
    ['income text on income surface', colors.incomeText, colors.incomeSoft],
    ['expense text on expense surface', colors.expenseText, colors.expenseSoft],
    ['warning text on warning surface', colors.warningText, colors.warningSoft],
    ['white text on brand', colors.white, colors.brand],
    ['muted text on brand', colors.onBrandMuted, colors.brand],
    ['subtle text on brand', colors.onBrandSubtle, colors.brand],
    ['income text on brand', colors.incomeOnBrand, colors.brand],
    ['expense text on brand', colors.expenseOnBrand, colors.brand],
  ])('%s keeps at least 4.5:1 contrast', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps interactive targets at least 48 dp', () => {
    expect(control.minTouchTarget).toBeGreaterThanOrEqual(48);
  });
});
