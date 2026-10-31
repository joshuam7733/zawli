/** Picks black or white text for a background colour (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#141512" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  // Contrast with white vs. near-black; choose the higher.
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0573 ? "#ffffff" : "#141512";
}
