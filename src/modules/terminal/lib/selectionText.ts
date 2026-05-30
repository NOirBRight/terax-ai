import type { Terminal } from "@xterm/xterm";

export function cellWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2329 && cp <= 0x232a) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3040 && cp <= 0x3247) ||
      (cp >= 0x3250 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd)
    ) {
      w += 2;
      if (cp > 0xffff) i++;
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
      result += parts[i].text;
    } else if (
      !parts[i - 1].wrapped &&
      cellWidth(parts[i - 1].text) >= cols &&
      parts[i].text !== "" &&
      !parts[i].text.startsWith("- ") &&
      !parts[i].text.startsWith("* ") &&
      !parts[i].text.startsWith("\u2022 ")
    ) {
      const trimmedPrev = result.trimEnd();
      const trimmedNext = parts[i].text.trimStart();
      const hadTrailingSpace = trimmedPrev.length < result.length;
      result =
        trimmedPrev +
        (hadTrailingSpace || trimmedNext.length < parts[i].text.length
          ? " "
          : "") +
        trimmedNext;
    } else {
      result += "\n" + parts[i].text;
    }
  }

  return result;
}