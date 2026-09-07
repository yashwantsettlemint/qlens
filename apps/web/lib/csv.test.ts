import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  const cols = [
    { key: "n" as const, label: "Number" },
    { key: "note" as const, label: "Note" },
  ];

  it("writes a header row and a trailing newline", () => {
    expect(toCsv([{ n: "A/1", note: "ok" }], cols)).toBe("Number,Note\nA/1,ok\n");
  });

  it("quotes fields containing comma, quote or newline (RFC-4180)", () => {
    const out = toCsv([{ n: 'a,b', note: 'say "hi"\nx' }], cols);
    expect(out).toBe('Number,Note\n"a,b","say ""hi""\nx"\n');
  });

  it("renders null/undefined as empty", () => {
    expect(toCsv([{ n: null, note: undefined } as any], cols)).toBe("Number,Note\n,\n");
  });
});
