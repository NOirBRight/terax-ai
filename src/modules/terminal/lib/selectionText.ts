import type { Terminal, IBufferLine } from "@xterm/xterm";

function lastCellIsContent(line: IBufferLine, cols: number): boolean {
  if (cols <= 0) return false;
  const cell = line.getCell(cols - 1);
  if (!cell) return false;
  return cell.getCode() > 32 || cell.getWidth() === 0;
}

function isParagraphStart(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("\u2022 ")) return true;
  if (/^\d+\.\s/.test(t)) return true;
  return false;
}

/**
 * The current line looks like it could be a continuation of a
 * hard-wrapped paragraph (not a new paragraph start). Heuristic:
 * not a paragraph marker AND has enough content to be a continuation.
 */
function looksLikeContinuation(curr: { text: string }): boolean {
  if (curr.text === "") return false;
  if (isParagraphStart(curr.text)) return false;
  return true;
}

export function getSelectionText(term: Terminal): string | null {
  const pos = term.getSelectionPosition();
  if (!pos) return null;

  const { start, end } = pos;
  const buf = term.buffer.active;
  const cols = term.cols;

  const parts: {
    text: string;
    wrapped: boolean;
    fillsCols: boolean;
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

    parts.push({
      text,
      wrapped: line.isWrapped,
      fillsCols: lastCellIsContent(line, cols),
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
      prev.fillsCols &&
      looksLikeContinuation(curr)
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