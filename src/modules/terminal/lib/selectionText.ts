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

/**
 * Tracks which buffer lines were created by a \n that occurred
 * when the cursor was at the terminal column boundary. These are
 * "hard wraps" - the program output \n because it ran out of
 * column space, not because it wanted a paragraph break.
 *
 * Uses xterm.js's onLineFeed event and cursorX position to detect
 * this at the stream level, before the buffer is finalized.
 * This is more reliable than inferring from buffer content.
 */
export class HardWrapTracker {
  private _hardWrappedLines = new Set<number>();
  private _dispose: import("@xterm/xterm").IDisposable | null = null;

  attach(term: Terminal): void {
    this.detach();
    this._hardWrappedLines.clear();

    this._dispose = term.onLineFeed(() => {
      const buf = term.buffer.active;
      // cursorX after line feed points to the start of the NEW line.
      // The PREVIOUS line's index is cursorY - 1 (cursor already advanced).
      // But we need the cursor position BEFORE the \n, which is the
      // column where \n was encountered.
      //
      // After xterm.js processes \n:
      // - cursorY has advanced to the new line
      // - cursorX is 0 on the new line
      // - The previous line is at cursorY - 1
      //
      // The cursor was at some column X before \n, causing the line feed.
      // If the cursor was at cols (0-indexed: position cols, which means
      // the line filled all cols cells), this \n is a hard wrap.
      const prevY = buf.cursorY - 1;
      if (prevY < 0) return;

      // Check the previous line: if it filled the terminal width,
      // the \n that created this line feed was a hard wrap.
      const prevLine = buf.getLine(prevY);
      if (!prevLine) return;

      // A line fills the width if its last non-space cell is at
      // position >= cols - 1. We check the cell at cols - 1.
      const lastCell = prevLine.getCell(term.cols - 1);
      if (!lastCell) return;

      const lastCode = lastCell.getCode();
      const lastWidth = lastCell.getWidth();
      // Non-space content or wide-char continuation at the last column
      // means the line was hard-wrapped
      if (lastCode > 32 || lastWidth === 0) {
        this._hardWrappedLines.add(prevY);
      }
    });
  }

  detach(): void {
    if (this._dispose) {
      this._dispose.dispose();
      this._dispose = null;
    }
  }

  isHardWrapped(lineIndex: number): boolean {
    return this._hardWrappedLines.has(lineIndex);
  }

  clear(): void {
    this._hardWrappedLines.clear();
  }
}

function isParagraphStart(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("- ")) return true;
  if (t.startsWith("* ")) return true;
  if (t.startsWith("\u2022 ")) return true;
  if (/^\d+\.\s/.test(t)) return true;
  return false;
}

export function getSelectionText(
  term: Terminal,
  tracker?: HardWrapTracker,
): string | null {
  const pos = term.getSelectionPosition();
  if (!pos) return null;

  const { start, end } = pos;
  const buf = term.buffer.active;

  const parts: {
    text: string;
    wrapped: boolean;
    hardWrapped: boolean;
  }[] = [];

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

    const hardWrapped = tracker ? tracker.isHardWrapped(y) : false;

    parts.push({
      text,
      wrapped: line.isWrapped,
      hardWrapped,
    });
  }

  if (parts.length === 0) return null;

  let result = parts[0].text;
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1];
    const curr = parts[i];

    if (curr.wrapped) {
      result += curr.text;
    } else if (
      !prev.wrapped &&
      prev.hardWrapped &&
      curr.text !== "" &&
      !isParagraphStart(curr.text)
    ) {
      const trimmedPrev = result.trimEnd();
      const trimmedNext = curr.text.trimStart();
      result = trimmedPrev + " " + trimmedNext;
    } else {
      result += "\n" + curr.text;
    }
  }

  return result;
}