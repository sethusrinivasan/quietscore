import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
function luminance(hex: string): number {
  const values = hex
    .slice(1)
    .match(/../g)!
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
test('normal-sized semantic text meets WCAG AA contrast on light, dark, and high-contrast surfaces', () => {
  const patterns = [
    /^:root\s*\{([^}]+)\}/,
    /:root\[data-theme=['"']dark['"']\]\s*\{([^}]+)\}/,
    /:root\[data-theme=['"']contrast['"']\]\s*\{([^}]+)\}/,
  ];
  for (const [index, pattern] of patterns.entries()) {
    const block = css.match(pattern)![1];
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]),
    );
    for (const color of ['ink', 'muted', 'blue', 'critical', 'high', 'medium', 'low'])
      assert.ok(
        contrast(tokens[color], tokens.surface) >= 4.5,
        `theme ${index}: ${color} on surface`,
      );
    for (const color of ['ink', 'muted'])
      for (const background of ['paper', 'surface-soft', 'soft'])
        assert.ok(
          contrast(tokens[color], tokens[background]) >= 4.5,
          `theme ${index}: ${color} on ${background}`,
        );
    assert.ok(contrast('#ffffff', tokens.button) >= 4.5, `theme ${index}: primary label`);
  }
});
