import { describe, it, expect } from "vitest";
import { safeImageSrc } from "./render";

describe("safeImageSrc", () => {
  it("rejects remote URLs react-pdf would fetch server-side (SSRF)", () => {
    expect(safeImageSrc("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(safeImageSrc("https://evil.example/logo.png")).toBeNull();
    expect(safeImageSrc("file:///etc/passwd")).toBeNull();
  });

  it("rejects oversized data URLs", () => {
    expect(safeImageSrc("data:image/png;base64," + "A".repeat(3_000_001))).toBeNull();
  });

  it("allows an inline image", () => {
    expect(safeImageSrc("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("treats missing as absent, not a crash", () => {
    expect(safeImageSrc(null)).toBeNull();
    expect(safeImageSrc(undefined)).toBeNull();
  });
});
