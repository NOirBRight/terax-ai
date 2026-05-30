import type { Terminal } from "@xterm/xterm";

/**
 * Calculate the terminal column width of a string, treating
 * East Asian Wide (CJK) characters as 2 columns and everything
 * else as 1. This matches how terminals render text.
 */
function cellWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
      (cp >= 0x2329 && cp <= 0x232a) || // Angle brackets
      (cp >= 0x2e80 && cp <= 0x303e) || // CJK/Radical/Stroke
      (cp >= 0x3040 && cp <= 0x3247) || // Hiragana/Katakana/Bopomofo
      (cp >= 0x3250 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
      (cp >= 0xa000 && cp <= 0xa4cf) || // Yi Syllables/Radicals
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
      (cp >= 0xfe10 && cp <= 0xfe19) || // Vertical Forms
      (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
      (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth Forms
      (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth Signs
      (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Extension B-I
      (cp >= 0x30000 && cp <= 0x3fffd)  // CJK Extension G
    ) {
      w += 2;
      if (cp > 0xffff) i++; // Skip low surrogate
    } else {
      w += 1;
    }
  }
  return w;
}

export function getSelectionText(term: Terminal): string | null {
  const pos = term.getSelectionPosition();
  if (!pos) return null;

  const { start, end } = pos;
  const buf = term.buffer.active;
  const cols = term.cols;

  const parts: { text: string; wrapped: boolean }[] = [];

  for (let y = start.y; y <= end.y; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    let text: string;
    if (y === start.y && y === end.y) {
      text = line.translateToString(true, start.x, end.x);
    } else if (y === start.y) {
      text = line.translateToString(true, start.x);
    } else if (y === end.y) {
      text = line.translateToString(true, 0, end.x);
    } else {
      text = line.translateToString(true);
    }

    parts.push({ text, wrapped: line.isWrapped });
  }

  if (parts.length === 0) return null;

  let result = parts[0].text;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].wrapped) {
      // Soft wrap (xterm.js isWrapped=true): always join
      result += parts[i].text;
    } else if (
      // Hard-wrap heuristic: previous line filled terminal width but was NOT
      // a soft continuation. Programs like Pi CLI output \n at column width.
      !parts[i - 1].wrapped &&
      cellWidth(parts[i - 1].text) >= cols &&
      parts[i].text !== "" &&
      !parts[i].text.startsWith("  ") &&
      !parts[i].text.startsWith("- ") &&
      !parts[i].text.startsWith("* ") &&
      !parts[i].text.startsWith("\u2022 ")
    ) {
      result += parts[i].text;
    } else {
      result += "\n" + parts[i].text;
    }
  }

  return result;
}