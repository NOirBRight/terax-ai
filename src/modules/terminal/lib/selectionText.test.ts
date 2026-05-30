import { describe, expect, it } from "vitest";
import { getSelectionText, HardWrapTracker } from "./selectionText";
import type { IBufferCell, IBufferLine, Terminal } from "@xterm/xterm";

function mockCell(code: number, width: number): IBufferCell {
  return { getCode: () => code, getWidth: () => width } as unknown as IBufferCell;
}

function mockLine(
  content: string,
  wrapped: boolean,
  cols: number,
  trailingSpaces = 0,
): IBufferLine {
  const fullContent = content + " ".repeat(trailingSpaces);
  const cells: IBufferCell[] = [];
  for (let i = 0; i < cols; i++) {
    cells.push(
      i < fullContent.length
        ? mockCell(fullContent.charCodeAt(i), 1)
        : mockCell(32, 1),
    );
  }
  return {
    isWrapped: wrapped,
    translateToString(trimRight: boolean, start?: number, end?: number) {
      let s = fullContent;
      if (trimRight) s = s.trimEnd();
      if (start !== undefined && end !== undefined) s = s.slice(start, end);
      else if (start !== undefined) s = s.slice(start);
      return s;
    },
    getCell: (x: number) => (x >= 0 && x < cells.length ? cells[x] : undefined),
    length: cols,
  } as unknown as IBufferLine;
}

function mockTerm(
  lines: IBufferLine[],
  selection:
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined,
  cols = 80,
) {
  return {
    hasSelection: () => selection !== undefined,
    getSelectionPosition: () => selection,
    cols,
    buffer: {
      active: {
        getLine: (y: number) =>
          y >= 0 && y < lines.length ? lines[y] : undefined,
      },
    },
  } as unknown as Terminal;
}

function mockTracker(hardWrappedLines: number[]): HardWrapTracker {
  const t = new HardWrapTracker();
  for (const y of hardWrappedLines) {
    // Directly populate the tracker's internal set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t as any)._hardWrappedLines.add(y);
  }
  return t;
}

describe("getSelectionText", () => {
  it("returns null when no selection", () => {
    expect(getSelectionText(mockTerm([], undefined))).toBeNull();
  });

  it("returns full single-line selection", () => {
    const term = mockTerm([mockLine("hello", false, 80)], {
      start: { x: 0, y: 0 }, end: { x: 5, y: 0 },
    });
    expect(getSelectionText(term)).toBe("hello");
  });

  it("returns partial single-line selection", () => {
    const term = mockTerm([mockLine("hello world", false, 80)], {
      start: { x: 2, y: 0 }, end: { x: 7, y: 0 },
    });
    expect(getSelectionText(term)).toBe("llo w");
  });

  // ====== SOFT WRAPS ======
  it("joins soft-wrapped lines without newline", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("abcdef");
  });

  it("soft-wrapped then real line: join soft, break at real", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80), mockLine("ghi", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abcdef\nghi");
  });

  // ====== SHORT REAL LINES: always preserved ======
  it("separates two short real lines (no tracker)", () => {
    const term = mockTerm(
      [mockLine("ls", false, 80), mockLine("cd", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("ls\ncd");
  });

  it("separates short real lines (with tracker, no hard wraps)", () => {
    const term = mockTerm(
      [mockLine("ls", false, 80), mockLine("cd", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
    );
    expect(getSelectionText(term, mockTracker([]))).toBe("ls\ncd");
  });

  it("preserves empty line between content", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abc\n\ndef");
  });

  // ====== HARD WRAPS via HardWrapTracker ======
  it("joins lines marked as hard-wrapped by tracker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqrst", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    const tracker = mockTracker([0]); // line 0 was hard-wrapped
    expect(getSelectionText(term, tracker)).toBe("abcdefghij klmnopqrst");
  });

  it("detects hard wrap from full line even when selection starts mid-line", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqr", false, 10)],
      { start: { x: 5, y: 0 }, end: { x: 8, y: 1 } },
      10,
    );
    const tracker = mockTracker([0]); // full line 0 was hard-wrapped
    expect(getSelectionText(term, tracker)).toBe("fghij klmnopqr");
  });

  it("word-boundary hard wrap is joined via tracker", () => {
    // Line with trailing spaces (code=32) - can't detect from buffer,
    // but tracker knows it was hard-wrapped
    const term = mockTerm(
      [mockLine("hello", false, 10, 5), mockLine("world", false, 10, 5)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    const tracker = mockTracker([0]);
    expect(getSelectionText(term, tracker)).toBe("hello world");
  });

  it("does NOT join without tracker (falls back to isWrapped only)", () => {
    const term = mockTerm(
      [mockLine("hello", false, 10, 5), mockLine("world", false, 10, 5)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    // No tracker → word-boundary hard wraps can't be detected → preserved
    expect(getSelectionText(term)).toBe("hello\nworld");
  });

  // ====== PARAGRAPH BREAKS ======
  it("does not join before paragraph marker even with tracker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("- item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    const tracker = mockTracker([0]);
    expect(getSelectionText(term, tracker)).toBe("abcdefghij\n- item");
  });

  it("does not join before numbered list marker even with tracker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("2. item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 7, y: 1 } },
      10,
    );
    const tracker = mockTracker([0]);
    expect(getSelectionText(term, tracker)).toBe("abcdefghij\n2. item");
  });

  it("does not join before bullet marker even with tracker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("\u2022 item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    const tracker = mockTracker([0]);
    expect(getSelectionText(term, tracker)).toBe("abcdefghij\n\u2022 item");
  });

  it("hard-wrapped line before paragraph break is joined, break is preserved", () => {
    // Line 0: hard-wrapped (joins with line 1)
    // Line 1: short (last line of paragraph)
    // Line 2: new paragraph (short)
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("uv", false, 10), mockLine("New", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
      10,
    );
    const tracker = mockTracker([0]);
    expect(getSelectionText(term, tracker)).toBe("abcdefghij uv\nNew");
  });

  // ====== REAL-LIFE: git log ======
  it("git log: soft-wrapped long line + new commit (real break)", () => {
    const term = mockTerm(
      [
        mockLine("abc1234 (HEAD) A very long commit message t", false, 80),
        mockLine("hat wraps across the terminal width", true, 80),
        mockLine("def5678 Fix something", false, 80),
      ],
      { start: { x: 0, y: 0 }, end: { x: 21, y: 2 } },
    );
    expect(getSelectionText(term)).toBe(
      "abc1234 (HEAD) A very long commit message that wraps across the terminal width\ndef5678 Fix something",
    );
  });

  // ====== EDGE CASES ======
  it("returns null when all lines in range are undefined", () => {
    const term = mockTerm([], { start: { x: 0, y: 5 }, end: { x: 0, y: 7 } });
    expect(getSelectionText(term)).toBeNull();
  });

  it("handles partial columns across soft-wrapped and real lines", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 80), mockLine("klmnopqrst", true, 80), mockLine("uvwxyz", false, 80)],
      { start: { x: 2, y: 0 }, end: { x: 5, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("cdefghijklmnopqrst\nuvwxy");
  });
});