import { describe, expect, it } from "vitest";
import { getSelectionText } from "./selectionText";
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

describe("getSelectionText", () => {
  // ====== NO SELECTION ======
  it("returns null when no selection", () => {
    expect(getSelectionText(mockTerm([], undefined))).toBeNull();
  });

  // ====== SINGLE LINE ======
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

  // ====== SOFT WRAPS (isWrapped=true) ======
  it("joins soft-wrapped lines without newline", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("abcdef");
  });

  it("joins 3 consecutive soft-wrapped rows", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80), mockLine("ghi", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abcdefghi");
  });

  it("soft-wrapped then real line: join soft, break at real", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80), mockLine("ghi", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abcdef\nghi");
  });

  // ====== SHORT REAL LINES: always preserved ======
  it("separates two short real lines", () => {
    const term = mockTerm(
      [mockLine("ls", false, 80), mockLine("cd", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("ls\ncd");
  });

  it("preserves empty line between content", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abc\n\ndef");
  });

  it("preserves end.x=0 on last line", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("abc\n");
  });

  // ====== LONG REAL LINES: preserved unless strong signal ======
  it("preserves long real line followed by another line (no hard-wrap signal)", () => {
    // 7 chars + 3 trailing spaces, cols=10. last cell = space (code=32).
    // No strong signal → real break preserved
    const term = mockTerm(
      [mockLine("abcdefg", false, 10, 3), mockLine("hijklmn", false, 10, 3)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefg\nhijklmn");
  });

  it("preserves long real line near paragraph break (no false join)", () => {
    // A paragraph ending that happens to be long but has trailing spaces
    const term = mockTerm(
      [mockLine("This is the end of a paragraph.", false, 80, 40), mockLine("New paragraph starts.", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 21, y: 1 } },
      80,
    );
    expect(getSelectionText(term)).toBe("This is the end of a paragraph.\nNew paragraph starts.");
  });

  // ====== HARD WRAP: mid-word (lastCell code > 32) ======
  it("joins mid-word hard-wrapped lines when last cell is content", () => {
    // "abcdefghij" fills cols=10 exactly, last cell 'j' code=106 > 32
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqrst", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij klmnopqrst");
  });

  it("detects hard wrap when selection starts mid-line (lastCellContent)", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqr", false, 10)],
      { start: { x: 5, y: 0 }, end: { x: 8, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("fghij klmnopqr");
  });

  it("path mid-word wrap is joined (like terax-ai paths)", () => {
    // Path wraps mid-word: content fills cols exactly so last cell is a real char
    const term = mockTerm(
      [mockLine("D:\\Worksta", false, 10), mockLine("tion\\ter", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 8, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("D:\\Worksta tion\\ter");
  });

  // ====== PARAGRAPH BREAKS: bullet and numbered list ======
  it("does not join before bullet marker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("\u2022 item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n\u2022 item");
  });

  it("does not join before indented bullet marker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine(" \u2022 item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 7, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n \u2022 item");
  });

  it("does not join before numbered list marker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("2. item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 7, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n2. item");
  });

  it("does not join before indented numbered list marker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine(" 3. item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 8, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n 3. item");
  });

  // ====== DASH/ASTERISK: not paragraph markers ======
  it("dash connector IS joined with hard-wrapped predecessor", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine(" - next", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 7, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij - next");
  });

  it("asterisk with hard-wrapped predecessor is joined", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("* next", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij * next");
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